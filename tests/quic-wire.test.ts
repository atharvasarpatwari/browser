/**
 * @file tests/quic-wire.test.ts
 *
 * Pins the QUIC long-header wire seam (`src/browser/networking/quic-wire.ts`).
 * This is the round-trip gate for the socket-proxy Phase 5 amendment's finding
 * that `quic-transport.ts` built packets its own decode path could not parse —
 * every test here drives the SHIPPED builders/parsers so fixture and
 * implementation cannot drift apart again.
 *
 * Varint and packet-number codecs live in `byte-codecs.ts` and are tested here
 * as part of the same wire surface (they are what the seam uses).
 */
import { describe, it, expect } from 'vitest';
import {
  buildLongHeaderPacket,
  parseLongHeaderPacket,
  QuicLongHeaderType,
  QUIC_LONG_HEADER_FIXED_BITS,
} from '../src/browser/networking/quic-wire';
import {
  encodeVarInt,
  decodeVarInt,
  encodePacketNumber,
  decodePacketNumber,
  concatBytes,
} from '../src/browser/networking/byte-codecs';

const CID = (): Uint8Array => new Uint8Array(8);

describe('QUIC varint codecs (byte-codecs)', () => {
  it('selects widths at the documented boundaries', () => {
    expect(encodeVarInt(0).length).toBe(1);
    expect(encodeVarInt(63).length).toBe(1);
    expect(encodeVarInt(64).length).toBe(2);
    expect(encodeVarInt(16383).length).toBe(2);
    expect(encodeVarInt(16384).length).toBe(4);
    expect(encodeVarInt(1_073_741_823).length).toBe(4);
    expect(encodeVarInt(1_073_741_824).length).toBe(8);
  });

  it('encodes the 4-byte boundary as a positive-wire, 2-bit-prefixed value (regression for the writeUInt32BE RangeError bug)', () => {
    const four = encodeVarInt(16384);
    expect(four.length).toBe(4);
    expect(four[0]!).toBe(0x80 | 0x00); // prefix 10 + high 6 bits of 0x4000
    expect(four[1]!).toBe(0x00);
    expect(four[2]!).toBe(0x40);
    expect(four[3]!).toBe(0x00);
  });

  it('round-trips values across every width (within safe-integer precision)', () => {
    const values = [0, 1, 63, 64, 16383, 16384, 0x3fffffff, 1_073_741_824, 0x100000000 + 12345, 0xffffffffff];
    for (const value of values) {
      const enc = encodeVarInt(value);
      const dec = decodeVarInt(enc);
      expect(dec.length).toBe(enc.length);
      expect(dec.value).toBe(value);
    }
  });

  it('decodes 8-byte varints whose low 32 bits have the high bit set (regression: `<< 24` signedness)', () => {
    // lo = 0x80000000 -> the old `(data[4] << 24) | ...` produced a negative
    // int32 and `hi * 2^32 + lo` came out 2^32 short.
    for (const value of [0x180000000, 0x1ffffffff, 0x100000000 + 0xffffffff, 0xffffffffff]) {
      const enc = encodeVarInt(value);
      const dec = decodeVarInt(enc);
      expect(dec.value).toBe(value);
    }
  });

  it('pins the exact 8-byte wire bytes for 2^40 - 1', () => {
    expect(Array.from(encodeVarInt(0xffffffffff))).toEqual([0xC0, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
  });

  it('encodes the 8-byte branch with the 11 prefix in the first byte', () => {
    const eight = encodeVarInt(1_073_741_824);
    expect(eight.length).toBe(8);
    expect(eight[0]!).toBe(0xC0);
    const dec = decodeVarInt(eight);
    expect(dec.length).toBe(8);
    expect(dec.value).toBe(1_073_741_824);
  });

  it('returns { value: 0, length: 0 } on truncated input', () => {
    expect(decodeVarInt(new Uint8Array([0x40, 0x00])).length).toBe(2);
    expect(decodeVarInt(new Uint8Array([0x40])).value).toBe(0);
    expect(decodeVarInt(new Uint8Array([0x80, 0x00, 0x00])).length).toBe(0);
    expect(decodeVarInt(new Uint8Array()).length).toBe(0);
    expect(decodeVarInt(new Uint8Array(0)).value).toBe(0);
  });
});

describe('QUIC packet-number codecs (byte-codecs)', () => {
  it('picks 1/2/4-byte widths', () => {
    expect(encodePacketNumber(0).length).toBe(1);
    expect(encodePacketNumber(127).length).toBe(1);
    expect(encodePacketNumber(128).length).toBe(2);
    expect(encodePacketNumber(32767).length).toBe(2);
    expect(encodePacketNumber(32768).length).toBe(4);
  });

  it('round-trips packet numbers', () => {
    const values = [0, 127, 128, 32767, 32768, 0x7fffffff];
    for (const value of values) {
      expect(decodePacketNumber(encodePacketNumber(value))).toBe(value);
    }
  });
});

describe('QUIC long-header wire seam (quic-wire)', () => {
  const TYPES = [
    QuicLongHeaderType.Initial,
    QuicLongHeaderType.ZeroRtt,
    QuicLongHeaderType.Handshake,
    QuicLongHeaderType.OneRtt,
  ];

  it('build → parse → identical frame payload for every packet type', () => {
    const payload = new Uint8Array([0x08, 0x00, 0x00, 0x03, 0x61, 0x62, 0x63]); // a STREAM frame
    for (const type of TYPES) {
      const packet = buildLongHeaderPacket({
        type,
        destConnectionId: CID(),
        srcConnectionId: CID(),
        packetNumber: 42,
        payload,
      });
      const parsed = parseLongHeaderPacket(packet);
      expect(parsed, `parse must succeed for type ${type}`).not.toBeNull();
      expect(parsed!.type).toBe(type);
      expect(parsed!.packetNumber).toBe(42);
      expect(parsed!.payloadStart).toBe(packet.length - payload.length);
      const recovered = packet.slice(parsed!.payloadStart);
      expect(Array.from(recovered)).toEqual(Array.from(payload));
    }
  });

  it('encodes the type field in bits 4–5 of the first byte (the old build/parse mismatch)', () => {
    for (const type of TYPES) {
      const packet = buildLongHeaderPacket({
        type,
        destConnectionId: CID(),
        srcConnectionId: CID(),
        packetNumber: 0,
        payload: new Uint8Array(0),
      });
      expect(packet[0]! & 0x30).toBe(type);
      expect(packet[0]! & 0xC0).toBe(QUIC_LONG_HEADER_FIXED_BITS);
    }
  });

  it('gives every type a distinct first byte (OneRtt no longer collides with Initial)', () => {
    const bytes = TYPES.map((type) => buildLongHeaderPacket({
      type,
      destConnectionId: CID(),
      srcConnectionId: CID(),
      packetNumber: 0,
      payload: new Uint8Array(0),
    })[0]!);
    expect(new Set(bytes).size).toBe(TYPES.length);
    expect(bytes).toEqual([0xC0, 0xD0, 0xE0, 0xF0]);
  });

  it('only Initial carries the 2-byte length field', () => {
    const dest = CID();
    const src = CID();
    const pn = encodePacketNumber(7);
    const payload = new Uint8Array([0x00, 0x00]);
    const initial = buildLongHeaderPacket({ type: QuicLongHeaderType.Initial, destConnectionId: dest, srcConnectionId: src, packetNumber: 7, payload });
    const handshake = buildLongHeaderPacket({ type: QuicLongHeaderType.Handshake, destConnectionId: dest, srcConnectionId: src, packetNumber: 7, payload });

    // After [type][dcidLen][dcid][scidLen][scid]:
    const headLen = 1 + 1 + dest.length + 1 + src.length;
    expect(initial.length - headLen - payload.length - pn.length).toBe(3);  // length(2) + pn-type(1)
    expect(handshake.length - headLen - payload.length - pn.length).toBe(1); // pn-type(1) only
  });

  it('skips the pn-length byte and does not misread 2/4-byte packet numbers', () => {
    const payload = new Uint8Array([0x06, 0x00, 0x00]);
    for (const pn of [0, 1, 127, 128, 32767, 32768, 1_000_000]) {
      const packet = buildLongHeaderPacket({
        type: QuicLongHeaderType.OneRtt,
        destConnectionId: CID(),
        srcConnectionId: CID(),
        packetNumber: pn,
        payload,
      });
      const parsed = parseLongHeaderPacket(packet)!;
      expect(parsed.packetNumber).toBe(pn);
      expect(parsed.payloadStart).toBe(packet.length - payload.length);
    }
  });

  it('returns null for short-header input and truncated headers', () => {
    expect(parseLongHeaderPacket(new Uint8Array([0x40, 0x00]))).toBeNull();
    expect(parseLongHeaderPacket(new Uint8Array([]))).toBeNull();
    // Truncated connection-id field
    const malformed = concatBytes([
      new Uint8Array([0xC0]),
      new Uint8Array([8]),
      new Uint8Array([1, 2, 3]),
    ]);
    expect(parseLongHeaderPacket(malformed)).toBeNull();
  });
});