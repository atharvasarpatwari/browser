/**
 * @file tests/sctp-transport.test.ts
 *
 * Gate for WebRTC Phase 2.2 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`):
 * CRC32c against the standard test vector, an association handshake + 20KB
 * multi-fragment echo over real loopback UDP, and a loss-injection test
 * proving SACK/timeout-retransmit actually recovers a dropped DATA chunk.
 */
import { describe, it, expect } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { SctpAssociation, crc32c, PPID_WEBRTC_BINARY } from '../src/browser/networking/sctp-transport';
import { encodeUtf8 } from '../src/browser/networking/byte-codecs';

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('CRC32c (Castagnoli)', () => {
  it('matches the standard "123456789" test vector (0xE3069283)', () => {
    expect(crc32c(encodeUtf8('123456789'))).toBe(0xe3069283);
  });
});

interface UdpPair {
  clientSocket: dgram.Socket;
  serverSocket: dgram.Socket;
  clientPort: number;
  serverPort: number;
  close(): void;
}

async function createUdpPair(): Promise<UdpPair> {
  const clientSocket = dgram.createSocket('udp4');
  const serverSocket = dgram.createSocket('udp4');
  await new Promise<void>((resolve) => clientSocket.bind(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => serverSocket.bind(0, '127.0.0.1', resolve));
  return {
    clientSocket,
    serverSocket,
    clientPort: (clientSocket.address() as AddressInfo).port,
    serverPort: (serverSocket.address() as AddressInfo).port,
    close: () => {
      clientSocket.close();
      serverSocket.close();
    },
  };
}

describe('SCTP association — real loopback UDP', () => {
  it('establishes (INIT/INIT-ACK/COOKIE-ECHO/COOKIE-ACK) and exchanges a 20KB message split across many DATA fragments', async () => {
    const udp = await createUdpPair();
    let client!: SctpAssociation;
    let server!: SctpAssociation;

    const bigMessage = new Uint8Array(20 * 1024);
    for (let i = 0; i < bigMessage.length; i++) bigMessage[i] = i & 0xff;

    const serverReceived = new Promise<Uint8Array>((resolve) => {
      server = new SctpAssociation({
        role: 'server',
        send: (bytes) => udp.serverSocket.send(bytes, udp.clientPort, '127.0.0.1'),
        onMessage: (streamId, ppid, data) => {
          expect(streamId).toBe(7);
          expect(ppid).toBe(PPID_WEBRTC_BINARY);
          resolve(data);
        },
      });
    });

    const clientReceivedEcho = new Promise<Uint8Array>((resolve) => {
      client = new SctpAssociation({
        role: 'client',
        send: (bytes) => udp.clientSocket.send(bytes, udp.serverPort, '127.0.0.1'),
        onMessage: (_streamId, _ppid, data) => resolve(data),
      });
    });

    udp.clientSocket.on('message', (msg) => client.onReceive(new Uint8Array(msg)));
    udp.serverSocket.on('message', (msg) => server.onReceive(new Uint8Array(msg)));

    try {
      await withTimeout(Promise.all([client.associationEstablished, server.associationEstablished]), 5000, 'SCTP association establishment');

      client.sendMessage(7, PPID_WEBRTC_BINARY, bigMessage);
      const received = await withTimeout(serverReceived, 8000, 'server receiving 20KB message');
      expect(received.length).toBe(bigMessage.length);
      expect(Array.from(received)).toEqual(Array.from(bigMessage));

      // Echo it back over a different stream to confirm the reverse direction (and a second stream ID) also works.
      server.sendMessage(9, PPID_WEBRTC_BINARY, received);
      const echoed = await withTimeout(clientReceivedEcho, 8000, 'client receiving echoed message');
      expect(Array.from(echoed)).toEqual(Array.from(bigMessage));
    } finally {
      client.close();
      server.close();
      udp.close();
    }
  });

  it('delivers multiple ordered messages on one stream in the order they were sent, even if datagrams arrive reordered', async () => {
    const udp = await createUdpPair();
    let client!: SctpAssociation;
    let server!: SctpAssociation;

    const received: string[] = [];
    const allReceived = new Promise<void>((resolve) => {
      let count = 0;
      server = new SctpAssociation({
        role: 'server',
        send: (bytes) => udp.serverSocket.send(bytes, udp.clientPort, '127.0.0.1'),
        onMessage: (_streamId, _ppid, data) => {
          received.push(new TextDecoder().decode(data));
          count++;
          if (count === 3) resolve();
        },
      });
    });

    client = new SctpAssociation({
      role: 'client',
      send: (bytes) => udp.clientSocket.send(bytes, udp.serverPort, '127.0.0.1'),
    });

    // Reorder DATA datagrams in flight from client -> server (but not the handshake ones, which must
    // arrive in sequence) to prove ordered message delivery survives network/UDP reordering.
    let reorderEnabled = false;
    const inFlight: Uint8Array[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    udp.clientSocket.on('message', (msg) => client.onReceive(new Uint8Array(msg)));
    udp.serverSocket.on('message', (msg) => {
      const bytes = new Uint8Array(msg);
      if (!reorderEnabled) {
        server.onReceive(bytes);
        return;
      }
      inFlight.push(bytes);
      if (flushTimer) clearTimeout(flushTimer);
      if (inFlight.length >= 2) {
        // Deliver out of arrival order.
        const [a, b] = inFlight.splice(0, 2);
        server.onReceive(b!);
        server.onReceive(a!);
      } else {
        // A trailing singleton (odd count) — flush it after a short grace period instead of hanging forever.
        flushTimer = setTimeout(() => {
          const leftover = inFlight.splice(0, inFlight.length);
          for (const d of leftover) server.onReceive(d);
        }, 200);
      }
    });

    try {
      await withTimeout(Promise.all([client.associationEstablished, server.associationEstablished]), 5000, 'SCTP association establishment');
      reorderEnabled = true;
      client.sendMessage(1, PPID_WEBRTC_BINARY, encodeUtf8('first'));
      client.sendMessage(1, PPID_WEBRTC_BINARY, encodeUtf8('second'));
      client.sendMessage(1, PPID_WEBRTC_BINARY, encodeUtf8('third'));
      await withTimeout(allReceived, 8000, 'ordered delivery of 3 messages');
      expect(received).toEqual(['first', 'second', 'third']);
    } finally {
      client.close();
      server.close();
      udp.close();
    }
  });
});

describe('SCTP loss injection — SACK/timeout-retransmit recovery', () => {
  it('still delivers the full message when a DATA datagram is dropped in flight', async () => {
    const udp = await createUdpPair();
    let client!: SctpAssociation;
    let server!: SctpAssociation;

    const message = new Uint8Array(8 * 1024); // forces several DATA-chunk fragments
    for (let i = 0; i < message.length; i++) message[i] = (i * 3) & 0xff;

    let dataDatagramsSeenFromClient = 0;
    let droppedOnce = false;

    const serverReceived = new Promise<Uint8Array>((resolve) => {
      server = new SctpAssociation({
        role: 'server',
        send: (bytes) => udp.serverSocket.send(bytes, udp.clientPort, '127.0.0.1'),
        onMessage: (_streamId, _ppid, data) => resolve(data),
      });
    });

    client = new SctpAssociation({
      role: 'client',
      send: (bytes) => udp.clientSocket.send(bytes, udp.serverPort, '127.0.0.1'),
    });

    udp.clientSocket.on('message', (msg) => client.onReceive(new Uint8Array(msg)));
    udp.serverSocket.on('message', (msg) => {
      const bytes = new Uint8Array(msg);
      // A DATA chunk's type byte sits right after the 12-byte common header.
      const isDataChunk = bytes.length > 12 && bytes[12] === 0;
      if (isDataChunk) dataDatagramsSeenFromClient++;
      // Drop exactly the 3rd DATA fragment once — the retransmit timer must recover it via SACK gap reporting.
      if (isDataChunk && dataDatagramsSeenFromClient === 3 && !droppedOnce) {
        droppedOnce = true;
        return; // simulated packet loss
      }
      server.onReceive(bytes);
    });

    try {
      await withTimeout(Promise.all([client.associationEstablished, server.associationEstablished]), 5000, 'SCTP association establishment');
      client.sendMessage(1, PPID_WEBRTC_BINARY, message);
      const received = await withTimeout(serverReceived, 8000, 'message recovered despite one dropped DATA datagram');
      expect(droppedOnce).toBe(true); // sanity: the loss actually happened
      expect(Array.from(received)).toEqual(Array.from(message));
    } finally {
      client.close();
      server.close();
      udp.close();
    }
  });
});
