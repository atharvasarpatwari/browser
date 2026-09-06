/**
 * @file tests/quic-transport.test.ts
 *
 * Tests for `QuicConnection` over the actual dgram wire. Wire-format encode/decode
 * correctness is gated by `tests/quic-wire.test.ts` (the seam that was created to
 * fix the build/parse mismatch documented by the socket-proxy Phase 5 session).
 * This file tests the class's observable behavior through that seam.
 *
 * Wire-format bugs fixed (2026-09-06): build emitted the packet type in bits 0–1
 * while parse read bits 4–5 (every long-header packet decoded as "Initial");
 * `findPayloadStart` expected a token-varint/2-byte-length/packet-number layout
 * the builder never emitted (no working self-to-self round trip); `decodeVarInt`
 * 8-byte branch's `data[4] << 24` went negative for lo ≥ 2³¹, decoding 2³² short.
 * All now route through `quic-wire.ts` and are pinned by `quic-wire.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';
import {
  QuicConnection,
  QuicConnectionState,
  QuicFrameType,
} from '../src/browser/networking/quic-transport';
import { QuicLongHeaderType, buildLongHeaderPacket } from '../src/browser/networking/quic-wire';
import { concatBytes, encodeUtf8, decodeUtf8, readUInt16BE } from '../src/browser/networking/byte-codecs';

/**
 * Wraps `frames` inside a long-header packet whose layout matches what
 * `QuicConnection` actually emits (via the `quic-wire` seam). The caller
 * chooses the packet type; connection IDs are zero-padded (8 bytes) as
 * generateConnectionId does. Packet number is always 0.
 */
function wrapAsQuicPayload(type: QuicLongHeaderType, frames: Uint8Array): Uint8Array {
  return buildLongHeaderPacket({
    type,
    destConnectionId: new Uint8Array(8),
    srcConnectionId: new Uint8Array(8),
    packetNumber: 0,
    payload: frames,
  });
}

function buildStreamFrameBytes(streamId: number, data: Uint8Array, fin = false): Uint8Array {
  return concatBytes([
    new Uint8Array([QuicFrameType.Stream | (fin ? 0x01 : 0x00) | 0x04 | 0x02]),
    new Uint8Array([streamId]),   // varint, assumes streamId < 64
    new Uint8Array([0]),          // offset varint = 0
    new Uint8Array([data.length]), // varint, assumes data.length < 64
    data,
  ]);
}

function buildCryptoFrameBytes(data: Uint8Array): Uint8Array {
  return concatBytes([
    new Uint8Array([QuicFrameType.Crypto]),
    new Uint8Array([0]),          // offset varint = 0
    new Uint8Array([data.length]), // varint, assumes data.length < 64
    data,
  ]);
}

/** A raw dgram "peer" that records every datagram it receives and can await a given count. */
function makeCollectingPeer() {
  const socket = dgram.createSocket('udp4');
  const messages: Uint8Array[] = [];
  const rinfos: dgram.RemoteInfo[] = [];
  let waiter: (() => void) | null = null;
  socket.on('message', (msg, rinfo) => {
    messages.push(new Uint8Array(msg));
    rinfos.push(rinfo);
    if (waiter) { const w = waiter; waiter = null; w(); }
  });
  async function waitForCount(n: number, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (messages.length < n) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} message(s), got ${messages.length}`);
      await new Promise<void>((resolve) => { waiter = resolve; setTimeout(resolve, 20); });
    }
  }
  async function listen(): Promise<number> {
    await new Promise<void>((resolve) => socket.bind(0, resolve));
    return (socket.address() as AddressInfo).port;
  }
  return { socket, messages, rinfos, waitForCount, listen };
}

/**
 * A peer that echoes every datagram back to its sender (using the rinfo of
 * the last received message). Useful for self-to-self round-trip tests that
 * drive the `QuicConnection` handshake through its own encode→echo→decode
 * path without a hand-crafted server.
 */
function makeEchoPeer() {
  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    socket.send(new Uint8Array(msg), rinfo.port, rinfo.address);
  });
  async function listen(): Promise<number> {
    await new Promise<void>((resolve) => socket.bind(0, resolve));
    return (socket.address() as AddressInfo).port;
  }
  return { socket, listen };
}

describe('QuicConnection — encode side (exact wire bytes)', () => {
  it('sends a well-formed Initial packet carrying the handshake literal in a CRYPTO frame', async () => {
    const peer = makeCollectingPeer();
    const port = await peer.listen();

    const conn = new QuicConnection({ idleTimeout: 1000 });
    const connectPromise = conn.connect('127.0.0.1', port);
    await peer.waitForCount(1);
    const initial = peer.messages[0]!;

    // Long header, and this codebase's (broken, see file header) type-tag
    // scheme: 0xC0 | (Initial(0x00) >> 4 & 0x03) === 0xC0.
    expect(initial[0]! & 0x80).toBe(0x80);
    expect(initial[0]).toBe(0xC0);

    let offset = 1;
    const destLen = initial[offset]!; offset += 1;
    expect(destLen).toBe(8); // generateConnectionId() always returns 8 bytes
    offset += destLen;
    const srcLen = initial[offset]!; offset += 1;
    expect(srcLen).toBe(8);
    offset += srcLen;

    // buildPacket's Initial branch: 0 tokenBytes (no length-prefix at all),
    // then a 2-byte length field, then [packetType|pnLen-1], then pnBytes.
    const length = readUInt16BE(initial, offset); offset += 2;
    const pnTypeByte = initial[offset]!; offset += 1;
    const pnLen = (pnTypeByte & 0x03) + 1;
    expect(pnLen).toBe(1); // first packet: packetNumber === 0 < 128 -> 1 byte
    const packetNumber = initial[offset]!; offset += pnLen;
    expect(packetNumber).toBe(0);

    const cryptoFrameType = initial[offset]!; offset += 1;
    expect(cryptoFrameType).toBe(QuicFrameType.Crypto);
    const cryptoOffset = initial[offset]!; offset += 1;
    expect(cryptoOffset).toBe(0);
    const cryptoLen = initial[offset]!; offset += 1;
    const expectedLiteral = encodeUtf8('QUIC initial handshake');
    expect(cryptoLen).toBe(expectedLiteral.length);
    const cryptoPayload = initial.slice(offset, offset + cryptoLen);
    expect(decodeUtf8(cryptoPayload)).toBe('QUIC initial handshake');
    offset += cryptoLen;
    expect(offset).toBe(initial.length); // nothing trailing/missing

    const cryptoFrameByteLength = 1 + 1 + 1 + expectedLiteral.length;
    const expectedLength = 2 + 1 + destLen + srcLen + 0 + pnLen + cryptoFrameByteLength;
    expect(length).toBe(expectedLength);

    await expect(connectPromise).rejects.toThrow(/timed out/);
    peer.socket.close();
  }, 3000);

  it('increments the packet number across successive sends', async () => {
    const peer = makeCollectingPeer();
    const port = await peer.listen();

    const conn = new QuicConnection({ idleTimeout: 1000 });
    const connectPromise = conn.connect('127.0.0.1', port);
    await peer.waitForCount(1);
    await conn.sendCryptoData(encodeUtf8('x'));
    await peer.waitForCount(2);

    // Packet 0 (Initial, from connect()'s sendInitialPacket) goes through
    // buildPacket's Initial branch, which has a 2-byte length field between
    // the connection IDs and the packet-number byte. Packet 1 (Handshake,
    // from sendCryptoData) goes through the Handshake/OneRtt branch, which
    // has NO such field — the two shapes are read with their own offset
    // math rather than one shared helper (an earlier version of this test
    // used one shared helper and silently misread packet 1's first payload
    // byte as its packet number; caught by hand-tracing the byte layout
    // against buildPacket, not by running it).
    const initial = peer.messages[0]!;
    let offInitial = 1;
    offInitial += 1 + initial[offInitial]!; // dest len byte + dest id
    offInitial += 1 + initial[offInitial]!; // src len byte + src id
    offInitial += 2; // length field (Initial branch only)
    offInitial += 1; // pn-type byte
    expect(initial[offInitial]).toBe(0);

    const handshake = peer.messages[1]!;
    let offHandshake = 1;
    offHandshake += 1 + handshake[offHandshake]!; // dest len byte + dest id
    offHandshake += 1 + handshake[offHandshake]!; // src len byte + src id
    offHandshake += 1; // pn-type byte (no length field on this branch)
    expect(handshake[offHandshake]).toBe(1);

    await expect(connectPromise).rejects.toThrow(/timed out/);
    peer.socket.close();
  }, 3000);

  it('sends a well-formed STREAM frame for sendStreamData', async () => {
    const peer = makeCollectingPeer();
    const port = await peer.listen();

    const conn = new QuicConnection({ idleTimeout: 1000 });
    const connectPromise = conn.connect('127.0.0.1', port);
    await peer.waitForCount(1); // the Initial packet

    const stream = await conn.openStream();
    expect(stream.id).toBe(0); // first bidi stream id

    const payload = encodeUtf8('hello');
    await conn.sendStreamData(stream.id, payload);
    await peer.waitForCount(2);
    const packet = peer.messages[1]!;

    // OneRtt goes through buildPacket's Handshake/OneRtt branch: no
    // token/length fields at all, straight from the src connection id to
    // [packetType|pnLen-1] + pnBytes.
    let offset = 1;
    const destLen = packet[offset]!; offset += 1; offset += destLen;
    const srcLen = packet[offset]!; offset += 1; offset += srcLen;
    const pnTypeByte = packet[offset]!; offset += 1;
    const pnLen = (pnTypeByte & 0x03) + 1;
    offset += pnLen; // packet number(s) — value not asserted here, covered above

    expect(packet[offset]).toBe(QuicFrameType.Stream | 0x04 | 0x02); // hasOffset|hasLength, fin=0
    offset += 1;
    expect(packet[offset]).toBe(stream.id); // streamId varint (0, < 64 -> 1 byte)
    offset += 1;
    expect(packet[offset]).toBe(0); // offset varint
    offset += 1;
    expect(packet[offset]).toBe(payload.length); // length varint
    offset += 1;
    expect(decodeUtf8(packet.slice(offset, offset + payload.length))).toBe('hello');
    offset += payload.length;
    expect(offset).toBe(packet.length);

    await expect(connectPromise).rejects.toThrow(/timed out/);
    peer.socket.close();
  }, 3000);

  it('sends a ConnectionClose frame and transitions to Closed on close()', async () => {
    const peer = makeCollectingPeer();
    const port = await peer.listen();

    const conn = new QuicConnection({ idleTimeout: 1000 });
    const connectPromise = conn.connect('127.0.0.1', port).catch(() => {});
    await peer.waitForCount(1);

    await conn.close();
    expect(conn.state).toBe(QuicConnectionState.Closed);
    await peer.waitForCount(2);
    const packet = peer.messages[1]!;

    let offset = 1;
    offset += 1 + packet[offset]!; // dest
    offset += 1 + packet[offset]!; // src
    const pnTypeByte = packet[offset]!; offset += 1;
    const pnLen = (pnTypeByte & 0x03) + 1;
    offset += pnLen;

    expect(packet[offset]).toBe(QuicFrameType.ConnectionClose);

    await connectPromise;
    peer.socket.close();
  }, 3000);

  it('self-to-self round trip: sends 20KB stream data through the real dgram wire and recovers it via the class decode path', async () => {
    // Echo peer returns every datagram; the client drives the handshake
    // forward by sending a crypto frame that, once echoed, causes the client
    // to transition to Established — no hand-crafted server. The client's
    // own Initial is echoed back, moving it to Handshaking (which also proves
    // the socket is fully set up), then sendCryptoData pushes it to
    // Established, and the sent STREAM data comes back through the decode path.
    const peer = makeEchoPeer();
    const port = await peer.listen();

    const conn = new QuicConnection({ idleTimeout: 5000 });
    const connected = conn.connect('127.0.0.1', port);

    // Wait until the echoed Initial has driven us to Handshaking. This
    // guarantees the socket is bound/connected and the send loop is live.
    const deadline = Date.now() + 3000;
    while (conn.state !== QuicConnectionState.Handshaking && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(conn.state).toBe(QuicConnectionState.Handshaking);

    await conn.sendCryptoData(encodeUtf8('handshake-continue'));
    await connected; // Handshake packet echoed → Established

    const stream = await conn.openStream();
    const payload = encodeUtf8('A'.repeat(20_000));
    await conn.sendStreamData(stream.id, payload);

    // Wait for the echoed OneRtt STREAM frame to be decoded back into the
    // stream buffer before reading it.
    const readDeadline = Date.now() + 3000;
    let result: Uint8Array = new Uint8Array(0);
    while (Date.now() < readDeadline) {
      result = await conn.readStream(stream.id);
      if (result.length >= payload.length) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(result.length).toBe(payload.length);
    expect(decodeUtf8(result)).toBe(decodeUtf8(payload));

    await conn.close();
    peer.socket.close();
  }, 5000);
});

describe('QuicConnection — decode side (frame parsing)', () => {
  it('reaches Established when the peer sends an Initial then a HandshakeDone', async () => {
    const server = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => server.bind(0, resolve));
    const port = (server.address() as AddressInfo).port;

    let clientAddr: AddressInfo | null = null;
    server.on('message', (_msg, rinfo) => {
      clientAddr = { address: rinfo.address, port: rinfo.port, family: rinfo.family };
      // Answer the single Initial with our own Initial (→ Handshaking) then a
      // HandshakeDone (→ Established). `connect()` resolves on Established.
      const initial = wrapAsQuicPayload(QuicLongHeaderType.Initial, new Uint8Array(0));
      server.send(initial, clientAddr.port, clientAddr.address);
      const done = wrapAsQuicPayload(QuicLongHeaderType.Handshake, new Uint8Array([QuicFrameType.HandshakeDone]));
      server.send(done, clientAddr.port, clientAddr.address);
    });

    const conn = new QuicConnection({ idleTimeout: 2000 });
    await conn.connect('127.0.0.1', port);
    expect(conn.state).toBe(QuicConnectionState.Established);

    await conn.close();
    server.close();
  }, 3000);

  it('parses an incoming STREAM frame — readStream() returns the exact bytes', async () => {
    const server = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => server.bind(0, resolve));
    const port = (server.address() as AddressInfo).port;

    server.on('message', (_msg, rinfo) => {
      const clientAddr = { address: rinfo.address, port: rinfo.port, family: rinfo.family };
      // Complete the handshake (Initial → Handshaking, HandshakeDone → Established),
      // then deliver a STREAM frame to the client's decode path.
      const initial = wrapAsQuicPayload(QuicLongHeaderType.Initial, new Uint8Array(0));
      server.send(initial, clientAddr.port, clientAddr.address);
      const done = wrapAsQuicPayload(QuicLongHeaderType.Handshake, new Uint8Array([QuicFrameType.HandshakeDone]));
      server.send(done, clientAddr.port, clientAddr.address);
      const payload = encodeUtf8('incoming stream data');
      const streamPacket = wrapAsQuicPayload(QuicLongHeaderType.OneRtt, buildStreamFrameBytes(4, payload));
      server.send(streamPacket, clientAddr.port, clientAddr.address);
    });

    const conn = new QuicConnection({ idleTimeout: 2000 });
    // Register onStream before the handshake so we never miss the STREAM frame
    const newStream = new Promise<{ id: number }>((resolve) => { conn.onStream = (s) => resolve(s); });
    await conn.connect('127.0.0.1', port);

    const stream = await newStream;
    const result = await conn.readStream(stream.id);
    expect(decodeUtf8(result)).toBe('incoming stream data');

    await conn.close();
    server.close();
  }, 3000);

  it('correctly tracks offsets across a CRYPTO frame followed by a STREAM frame', async () => {
    const server = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => server.bind(0, resolve));
    const port = (server.address() as AddressInfo).port;

    server.on('message', (_msg, rinfo) => {
      const clientAddr = { address: rinfo.address, port: rinfo.port, family: rinfo.family };
      // Complete the handshake, then deliver CRYPTO + STREAM in one packet.
      const initial = wrapAsQuicPayload(QuicLongHeaderType.Initial, new Uint8Array(0));
      server.send(initial, clientAddr.port, clientAddr.address);
      const done = wrapAsQuicPayload(QuicLongHeaderType.Handshake, new Uint8Array([QuicFrameType.HandshakeDone]));
      server.send(done, clientAddr.port, clientAddr.address);
      const cryptoFrame = buildCryptoFrameBytes(encodeUtf8('ignored crypto data'));
      const streamPayload = encodeUtf8('after crypto');
      const streamFrame = buildStreamFrameBytes(8, streamPayload);
      const combined = wrapAsQuicPayload(QuicLongHeaderType.OneRtt, concatBytes([cryptoFrame, streamFrame]));
      server.send(combined, clientAddr.port, clientAddr.address);
    });

    const conn = new QuicConnection({ idleTimeout: 2000 });
    // Register onStream before the handshake so we never miss the STREAM frame
    const newStream = new Promise<{ id: number }>((resolve) => { conn.onStream = (s) => resolve(s); });
    await conn.connect('127.0.0.1', port);

    const stream = await newStream;
    const result = await conn.readStream(stream.id);
    expect(decodeUtf8(result)).toBe('after crypto');

    await conn.close();
    server.close();
  }, 3000);

  it('does not throw on an all-padding frame payload', async () => {
    const server = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => server.bind(0, resolve));
    const port = (server.address() as AddressInfo).port;

    server.on('message', (_msg, rinfo) => {
      const clientAddr = { address: rinfo.address, port: rinfo.port, family: rinfo.family };
      // Complete the handshake, then deliver an all-padding payload.
      const initial = wrapAsQuicPayload(QuicLongHeaderType.Initial, new Uint8Array(0));
      server.send(initial, clientAddr.port, clientAddr.address);
      const done = wrapAsQuicPayload(QuicLongHeaderType.Handshake, new Uint8Array([QuicFrameType.HandshakeDone]));
      server.send(done, clientAddr.port, clientAddr.address);
      const padding = wrapAsQuicPayload(QuicLongHeaderType.OneRtt, new Uint8Array([0x00, 0x00, 0x00, 0x00]));
      server.send(padding, clientAddr.port, clientAddr.address);
    });

    const conn = new QuicConnection({ idleTimeout: 2000 });
    await conn.connect('127.0.0.1', port);
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the padding arrive
    expect(conn.state).toBe(QuicConnectionState.Established); // unaffected

    await conn.close();
    server.close();
  }, 3000);
});
