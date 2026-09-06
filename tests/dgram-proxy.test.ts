/**
 * @file tests/dgram-proxy.test.ts
 *
 * Proxy-wire proof for the Phase 5 dgram slice. A renderer-side SocketProxy is
 * explicitly wired to an in-process SocketOwner over an InProcessTransport
 * pair, and IDgramHandle traffic (open/bind/address/send/message/close) is
 * driven across that wire against a real loopback UDP peer. The owner is the
 * only holder of a real `node:dgram` socket — exactly what the main-process
 * socket-owner.cjs will replicate behind `contextIsolation`.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { Channel } from '../src/common/ipc/channel';
import { createInProcessPair } from '../src/common/ipc/transport';
import { SocketOwner } from '../src/browser/networking/socket-owner';
import { SocketProxy, setSocketProxy, resetSocketProxy } from '../src/browser/networking/socket-proxy';
import type { IDgramHandle } from '../src/browser/networking/dgram-handle';
import { decodeStunMessage, StunMessageType, respondToBindingRequest, stunBindingRequest } from '../src/browser/networking/stun-client';
import { decodeUtf8 } from '../src/browser/networking/byte-codecs';

let echoServer: dgram.Socket;
let echoPort: number;
let ownerChannel: Channel;
let rendererChannel: Channel;
let proxy: SocketProxy;
const openHandles: IDgramHandle[] = [];

beforeAll(async () => {
  echoServer = dgram.createSocket('udp4');
  echoServer.on('message', (msg, rinfo) => {
    echoServer.send(msg, rinfo.port, rinfo.address);
  });
  await new Promise<void>((resolve) => echoServer.bind(0, '127.0.0.1', resolve));
  echoPort = (echoServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => echoServer.close(() => resolve()));
});

afterEach(async () => {
  resetSocketProxy();
  ownerChannel.dispose();
  rendererChannel.dispose();
});

describe('DgramProxy wire', () => {
  it('binds, exposes the owner-side port, and closes cleanly', async () => {
    await setupWire();
    const handle = await proxy.openDgram();
    openHandles.push(handle);

    await handle.bind(0);
    const addr = handle.address();
    expect(addr).not.toBeNull();
    expect(addr!.port).toBeGreaterThan(0);
    expect(addr!.family).toBe('IPv4');

    handle.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    // After close the topic is unsubscribed; a further send must not throw
    // synchronously (the RPC rejects, which callers ignore fire-and-forget).
    await expect(handle.send(Buffer.from('late'))).rejects.toBeTruthy();
  });

  it('round-trips a datagram to the loopback echo server', async () => {
    await setupWire();
    const handle = await proxy.openDgram();
    openHandles.push(handle);
    await handle.bind(0);

    const reply = new Promise<{ data: string; address: string; port: number }>((resolve) => {
      handle.on('message', (msg, rinfo) => {
        resolve({ data: decodeUtf8(msg), address: rinfo.address, port: rinfo.port });
      });
    });

    await handle.send(Buffer.from('ping-through-proxy'), echoPort, '127.0.0.1');
    const echoed = await reply;

    expect(echoed.data).toBe('ping-through-proxy');
    expect(echoed.address).toBe('127.0.0.1');
    expect(echoed.port).toBe(echoPort);
    handle.close();
  });

  it('delivers binary datagrams byte-exact across the wire', async () => {
    await setupWire();
    const handle = await proxy.openDgram();
    openHandles.push(handle);
    await handle.bind(0);

    const payload = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f, 0x20]);
    const reply = new Promise<Buffer>((resolve) => {
      handle.on('message', (msg) => resolve(Buffer.from(msg)));
    });
    await handle.send(payload, echoPort, '127.0.0.1');
    const echoed = await reply;
    expect(Buffer.compare(echoed, payload)).toBe(0);
    handle.close();
  });

  it('supports connected-mode send (no explicit address)', async () => {
    await setupWire();
    const handle = await proxy.openDgram();
    openHandles.push(handle);
    await handle.bind(0);
    await handle.connect(echoPort, '127.0.0.1');

    const reply = new Promise<string>((resolve) => {
      handle.on('message', (msg) => resolve(decodeUtf8(msg)));
    });
    await handle.send(Buffer.from('connected-send'));
    const echoed = await reply;
    expect(echoed).toBe('connected-send');
    handle.close();
  });

  it('runs a STUN binding exchange through the owner wire', async () => {
    await setupWire();
    const server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
      const parsed = decodeStunMessage(msg);
      if (parsed && parsed.type === StunMessageType.BindingRequest) {
        respondToBindingRequest(server, parsed, { address: rinfo.address, port: rinfo.port });
      }
    });
    await new Promise<void>((resolve) => server.bind(0, '127.0.0.1', resolve));
    const serverPort = (server.address() as AddressInfo).port;

    const handle = await proxy.openDgram();
    openHandles.push(handle);
    await handle.bind(0);

    const mapped = await stunBindingRequest(handle, '127.0.0.1', serverPort);
    expect(mapped.family).toBe(4);
    expect(mapped.address).toBe('127.0.0.1');
    expect(typeof mapped.port).toBe('number');
    handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('buffers an error push until a listener attaches', async () => {
    await setupWire();
    const handle = await proxy.openDgram();
    openHandles.push(handle);
    await handle.bind(0);

    // Simulate an owner push that arrives before any renderer listener exists
    // (the same race the open-subscribe dance must survive). The handle must
    // hold the error and hand it to the first subscriber.
    (handle as unknown as { receive(frame: unknown): void }).receive({ evt: 'error', error: new Error('boom') });
    let got: string | undefined;
    handle.on('error', (err: Error) => { got = err.message; });
    expect(got).toBe('boom');
    handle.close();
  });
});

it('capstone: full round-trip with buffered-then-late message handler', async () => {
  await setupWire();
  const handle = await proxy.openDgram();
  openHandles.push(handle);
  // The message arrives after we send; the handler attaches before the echo so
  // ordering mirrors the real ICE flow (bind → attach STUN temp listener → send).
  await handle.bind(0);
  const got: string[] = [];
  handle.on('message', (msg) => got.push(decodeUtf8(msg)));
  await handle.send(Buffer.from('a'), echoPort, '127.0.0.1');
  await handle.send(Buffer.from('b'), echoPort, '127.0.0.1');
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(got).toEqual(['a', 'b']);
  handle.close();
});

async function setupWire(): Promise<void> {
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
}