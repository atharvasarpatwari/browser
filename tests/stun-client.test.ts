import { describe, it, expect, afterEach } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import {
  encodeBindingRequest,
  encodeBindingSuccessResponse,
  decodeStunMessage,
  parseMappedAddress,
  stunBindingRequest,
  respondToBindingRequest,
  StunMessageType,
  MAGIC_COOKIE,
} from '../src/browser/networking/stun-client';

describe('STUN message encode/decode', () => {
  it('round-trips a Binding Request header', () => {
    const { packet, transactionId } = encodeBindingRequest();
    expect(packet.length).toBe(20);
    expect(packet.readUInt16BE(0)).toBe(StunMessageType.BindingRequest);
    expect(packet.readUInt32BE(4)).toBe(MAGIC_COOKIE);

    const decoded = decodeStunMessage(packet);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe(StunMessageType.BindingRequest);
    expect(decoded!.transactionId.equals(transactionId)).toBe(true);
  });

  it('uses a fresh random transaction ID per call', () => {
    const a = encodeBindingRequest();
    const b = encodeBindingRequest();
    expect(a.transactionId.equals(b.transactionId)).toBe(false);
  });

  it('round-trips a Binding Success Response with XOR-MAPPED-ADDRESS', () => {
    const { transactionId } = encodeBindingRequest();
    const response = encodeBindingSuccessResponse(transactionId, { family: 4, address: '203.0.113.42', port: 54321 });

    const decoded = decodeStunMessage(response);
    expect(decoded).not.toBeNull();
    expect(decoded!.type).toBe(StunMessageType.BindingSuccessResponse);
    expect(decoded!.transactionId.equals(transactionId)).toBe(true);

    const mapped = parseMappedAddress(decoded!);
    expect(mapped).toEqual({ family: 4, address: '203.0.113.42', port: 54321 });
  });

  it('rejects a buffer that is too short', () => {
    expect(decodeStunMessage(Buffer.alloc(10))).toBeNull();
  });

  it('rejects a buffer with the wrong magic cookie', () => {
    const bad = Buffer.alloc(20);
    bad.writeUInt16BE(StunMessageType.BindingRequest, 0);
    bad.writeUInt32BE(0xdeadbeef, 4);
    expect(decodeStunMessage(bad)).toBeNull();
  });

  it('rejects a buffer whose top two header bits are set (RFC 5389 demux rule)', () => {
    const notStun = Buffer.from([0xff, 0x01, 0x02, 0x03, 0, 0, 0, 0]);
    expect(decodeStunMessage(notStun)).toBeNull();
  });
});

describe('STUN over real UDP (loopback)', () => {
  let server: dgram.Socket | null = null;
  let client: dgram.Socket | null = null;

  afterEach(() => {
    server?.close();
    client?.close();
    server = null;
    client = null;
  });

  it('gets a real Binding Success Response from an in-process STUN-shaped responder', async () => {
    server = dgram.createSocket('udp4');
    server.on('message', (msg, rinfo) => {
      const parsed = decodeStunMessage(msg);
      if (parsed && parsed.type === StunMessageType.BindingRequest) {
        respondToBindingRequest(server!, parsed, { address: rinfo.address, port: rinfo.port });
      }
    });
    await new Promise<void>((resolve) => server!.bind(0, resolve));
    const serverPort = (server.address() as AddressInfo).port;

    client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client!.bind(0, resolve));

    const mapped = await stunBindingRequest(client, '127.0.0.1', serverPort);
    expect(mapped.family).toBe(4);
    expect(mapped.address).toBe('127.0.0.1');
    expect(typeof mapped.port).toBe('number');
  });

  it('rejects after retries when nothing answers', async () => {
    client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client!.bind(0, resolve));

    // Port 1 is a well-known reserved port very unlikely to have anything
    // listening for UDP in a CI sandbox — a fast, deterministic non-answer.
    await expect(stunBindingRequest(client, '127.0.0.1', 1, { timeoutMs: 50, retries: 1 })).rejects.toThrow(/timed out/);
  }, 2000);

  it('rejects (rather than crashing) when the UDP socket errors during a request', async () => {
    client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client!.bind(0, resolve));

    // Fire a socket-level error shortly after the request starts. On a dgram
    // socket an 'error' event with no listener throws as an uncaught
    // exception and would fail the whole run; the fix must turn it into a
    // rejection instead.
    setTimeout(() => client!.emit('error', new Error('simulated socket failure')), 10);

    await expect(
      stunBindingRequest(client, '127.0.0.1', 9, { timeoutMs: 2000, retries: 1 }),
    ).rejects.toThrow(/simulated socket failure/);
  }, 3000);

  it('sends exactly retries+1 binding requests to a silent responder', async () => {
    server = dgram.createSocket('udp4');
    let received = 0;
    server.on('message', () => {
      received++;
    });
    await new Promise<void>((resolve) => server!.bind(0, resolve));
    const serverPort = (server.address() as AddressInfo).port;

    client = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => client!.bind(0, resolve));

    await expect(
      stunBindingRequest(client, '127.0.0.1', serverPort, { timeoutMs: 40, retries: 2 }),
    ).rejects.toThrow(/timed out after 2 retries/);
    expect(received).toBe(3);
  }, 3000);
});
