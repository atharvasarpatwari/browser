/**
 * @file src/browser/networking/quic-wire.ts
 *
 * Pure QUIC long-header wire primitives, extracted from `QuicConnection` so the
 * encode and decode paths share ONE byte layout — the self-to-self round trip
 * that `quic-transport.ts` did not have before (the socket-proxy Phase 5 session
 * documented build/parse divergence; this seam fixes it).
 *
 * This is this codebase's OWN QUIC-shaped wire format, not RFC 9000
 * conformance: no AEAD, no version negotiation, no real handshake. The header
 * layout is defined exactly here and in `tests/quic-wire.test.ts`:
 *
 *   long header: [0xC0 | (type & 0x30)] [dcidLen][dcid] [scidLen][scid]
 *                [length:2 — Initial only] [type | pnLen-1][pn] payload
 *
 * where pnLen ∈ {1, 2, 4} per `encodePacketNumber`, and the Initial `length`
 * field value is written but never read back (kept byte-for-byte identical to
 * the historical build so the encode-side pins still hold).
 *
 * As with `byte-codecs.ts`, everything here is plain-`Uint8Array` byte content —
 * safe under `contextIsolation: true`.
 */
import { concatBytes, decodePacketNumber, encodePacketNumber, writeUInt16BE } from './byte-codecs';

export const QUIC_LONG_HEADER_FIXED_BITS = 0xC0;

/** Packet type as encoded in bits 4–5 of the long-header first byte. */
export enum QuicLongHeaderType {
  Initial   = 0x00,
  ZeroRtt   = 0x10,
  Handshake = 0x20,
  OneRtt    = 0x30,
}

export interface QuicLongHeaderPacket {
  readonly type: QuicLongHeaderType;
  readonly destConnectionId: Uint8Array;
  readonly srcConnectionId: Uint8Array;
  readonly packetNumber: number;
  readonly packetNumberBytes: Uint8Array;
  readonly payloadStart: number;
}

/**
 * Build a long-header QUIC packet. The Initial type gets a 2-byte length field
 * (value = `2 + 1 + dcid + scid + pn + payload`, matching the historical build
 * byte-for-byte); all other types omit it.
 */
export function buildLongHeaderPacket(opts: {
  type: QuicLongHeaderType;
  destConnectionId: Uint8Array;
  srcConnectionId: Uint8Array;
  packetNumber: number;
  payload: Uint8Array;
}): Uint8Array {
  const { type, destConnectionId, srcConnectionId, packetNumber, payload } = opts;
  const pnBytes = encodePacketNumber(packetNumber);

  const parts: Uint8Array[] = [
    new Uint8Array([QUIC_LONG_HEADER_FIXED_BITS | (type & 0x30)]),
    new Uint8Array([destConnectionId.length]),
    destConnectionId,
    new Uint8Array([srcConnectionId.length]),
    srcConnectionId,
  ];

  if (type === QuicLongHeaderType.Initial) {
    const length = 2 + 1 + destConnectionId.length + srcConnectionId.length + pnBytes.length + payload.length;
    const lengthBytes = new Uint8Array(2);
    writeUInt16BE(lengthBytes, length, 0);
    parts.push(lengthBytes);
  }

  parts.push(new Uint8Array([type | (pnBytes.length - 1)]));
  parts.push(pnBytes);

  return concatBytes([...parts, payload]);
}

/**
 * Parse a long-header QUIC packet. Returns `null` for short-header packets
 * (`data[0] & 0x80 === 0`), unknown type values, or truncated/undersized input.
 * The header layout parsed here is exactly what `buildLongHeaderPacket` emits.
 */
export function parseLongHeaderPacket(data: Uint8Array): QuicLongHeaderPacket | null {
  if (data.length === 0) return null;
  if ((data[0]! & 0x80) === 0) return null;

  const type = data[0]! & 0x30;
  if (type !== QuicLongHeaderType.Initial
    && type !== QuicLongHeaderType.ZeroRtt
    && type !== QuicLongHeaderType.Handshake
    && type !== QuicLongHeaderType.OneRtt) {
    return null;
  }

  let offset = 1;
  const destLen = data[offset]!;
  offset += 1;
  if (offset + destLen > data.length) return null;
  const destConnectionId = data.slice(offset, offset + destLen);
  offset += destLen;

  const srcLen = data[offset]!;
  offset += 1;
  if (offset + srcLen > data.length) return null;
  const srcConnectionId = data.slice(offset, offset + srcLen);
  offset += srcLen;

  if (type === QuicLongHeaderType.Initial) {
    offset += 2; // length field — value written by build, never read back
    if (offset > data.length) return null;
  }

  const pnTypeByte = data[offset]!;
  offset += 1;
  const pnLen = (pnTypeByte & 0x03) + 1;
  if (offset + pnLen > data.length) return null;
  const packetNumberBytes = data.slice(offset, offset + pnLen);
  offset += pnLen;

  return {
    type,
    destConnectionId,
    srcConnectionId,
    packetNumber: decodePacketNumber(packetNumberBytes),
    packetNumberBytes,
    payloadStart: offset,
  };
}