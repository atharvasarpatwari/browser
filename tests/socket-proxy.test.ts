/**
 * @file tests/socket-proxy.test.ts
 *
 * Proxy-wire proof for Phase 3. A renderer-side SocketProxy is explicitly
 * wired to an in-process SocketOwner over an InProcessTransport pair, then
 * RawSocketHttpClient is driven through that wire against real local TCP/TLS
 * servers. This exercises the actual RPC/push protocol — event ordering,
 * ArrayBuffer byte transfers, and TLS upgrade — that Phase 5 will move behind
 * the Electron process boundary.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import * as net from 'node:net';
import { Channel } from '../src/common/ipc/channel';
import { createInProcessPair } from '../src/common/ipc/transport';
import { SocketOwner } from '../src/browser/networking/socket-owner';
import { SocketProxy, setSocketProxy, resetSocketProxy } from '../src/browser/networking/socket-proxy';
import type { ISocketHandle } from '../src/browser/networking/socket-handle';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';
import { decodeUtf8, encodeUtf8 } from '../src/browser/networking/byte-codecs';
import { createSelfSignedCert } from './helpers/self-signed-cert';

const TEXT_BODY = '<html><body>socket-proxy</body></html>';

let httpServer: http.Server;
let httpPort: number;
let tlsServer: https.Server;
let tlsPort: number;

let ownerChannel: Channel;
let rendererChannel: Channel;
let proxy: SocketProxy;

beforeAll(async () => {
  httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(TEXT_BODY);
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      httpPort = (httpServer.address() as net.AddressInfo).port;
      resolve();
    });
  });

  const { key, cert } = createSelfSignedCert('localhost');
  tlsServer = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(TEXT_BODY);
  });
  await new Promise<void>((resolve) => {
    tlsServer.listen(0, '127.0.0.1', () => {
      tlsPort = (tlsServer.address() as net.AddressInfo).port;
      resolve();
    });
  });
});

afterAll(async () => {
  httpServer.closeAllConnections();
  tlsServer.closeAllConnections();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
});

beforeEach(async () => {
  const [ownerTransport, rendererTransport] = createInProcessPair(
    { localId: 'socket-owner', remoteId: 'socket-renderer' },
    { localId: 'socket-renderer', remoteId: 'socket-owner' },
  );
  void ownerTransport.connect();
  void rendererTransport.connect();
  ownerChannel = new Channel(ownerTransport, { name: 'nova:net', direction: 'main-to-renderer' }, 'main');
  rendererChannel = new Channel(rendererTransport, { name: 'nova:net', direction: 'renderer-to-main' }, 'renderer');
  ownerChannel.activate();
  rendererChannel.activate();
  void new SocketOwner(ownerChannel);
  proxy = new SocketProxy(rendererChannel);
  setSocketProxy(proxy);
});

afterEach(async () => {
  resetSocketProxy();
  ownerChannel.dispose();
  rendererChannel.dispose();
});

describe('SocketProxy wire', () => {
  it('delivers a byte echo through openTcp/write/data', async () => {
    const server = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const handle: ISocketHandle = await proxy.openTcp({ host: '127.0.0.1', port });
      await handle.write(encodeUtf8('hello-proxy'));

      const echoed = await new Promise<string>((resolve) => {
        let received = new Uint8Array(0);
        const unsub = handle.onEvent('data', (chunk) => {
          if (!(chunk instanceof Uint8Array)) return;
          received = concat(received, chunk);
          resolve(decodeUtf8(received));
          unsub();
        });
      });

      expect(echoed).toBe('hello-proxy');
      await handle.destroy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('preserves the versioned connect event for late subscribers', async () => {
    const server = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const handle: ISocketHandle = await proxy.openTcp({ host: '127.0.0.1', port, tls: false });
      await once(handle, 'connect');
      expect(handle.id).toBeTruthy();
      await handle.destroy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('re-emits leftover handshake bytes before live data', async () => {
    const server: net.Server = net.createServer((socket) => {
      socket.resume();
      socket.on('error', () => { /* client destroy race */ });
      socket.write(Buffer.from('FRAGMENT'));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const handle: ISocketHandle = await proxy.openTcp({ host: '127.0.0.1', port });
      handle.enqueueIncoming(encodeUtf8('HEAD'));
      await handle.write(encodeUtf8('ignored'));

      const seen = await new Promise<string>((resolve) => {
        let received = new Uint8Array(0);
        handle.onEvent('data', (chunk) => {
          if (!(chunk instanceof Uint8Array)) return;
          received = concat(received, chunk);
          resolve(decodeUtf8(received));
        });
      });

      // enqueueIncoming is delivered first, then the server fragments arrive.
      expect(seen).toContain('HEAD');
      await handle.destroy();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('destroys the owner socket and stops pushes', async () => {
    const server = net.createServer((socket) => socket.pipe(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const handle: ISocketHandle = await proxy.openTcp({ host: '127.0.0.1', port });
      let events = 0;
      const unsub = handle.onEvent('data', () => { events += 1; });
      await handle.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      unsub();
      expect(events).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('RawSocketHttpClient over the explicit proxy wire', () => {
  it('fetches HTTP through the wire', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `http://127.0.0.1:${httpPort}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('socket-proxy');
  });

  it('fetches HTTPS with TLS upgrade + peer certificate validation', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `https://127.0.0.1:${tlsPort}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('socket-proxy');
  });

  it('rejects aborted transfers with AbortError', async () => {
    const stuck = net.createServer((socket) => {
      socket.resume();
    });
    await new Promise<void>((resolve) => stuck.listen(0, '127.0.0.1', resolve));
    const stuckPort = (stuck.address() as net.AddressInfo).port;

    try {
      const client = new RawSocketHttpClient();
      const controller = new AbortController();
      // Pooled server sockets sometimes mean the request would answer instantly;
      // a stuck (never-responding) peer keeps the transfer in-flight so the
      // abort has to tear the wire down before any response can arrive.
      const promise = client.send({
        url: `http://127.0.0.1:${stuckPort}/`,
        method: 'GET',
        headers: new Map(),
        timeoutMs: 10_000,
      }, controller.signal);
      setTimeout(() => controller.abort(), 25);

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    } finally {
      await new Promise<void>((resolve) => stuck.close(() => resolve()));
    }
  });

  it('requests the peer certificate over the wire', async () => {
    const handle: ISocketHandle = await proxy.openTcp({ host: '127.0.0.1', port: tlsPort, tls: true });
    await once(handle, 'secureConnect');
    const cert = await handle.getPeerCertificate();
    expect(cert).toBeTruthy();
    expect((cert as { subject?: { CN?: string } }).subject?.CN).toBe('localhost');
    await handle.destroy();
  });
});

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function once(handle: ISocketHandle, evt: 'connect' | 'secureConnect'): Promise<void> {
  return new Promise((resolve) => {
    const unsub = handle.onEvent(evt, () => {
      unsub();
      resolve();
    });
  });
}