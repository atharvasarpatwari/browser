/**
 * @file src/browser/networking/byte-codecs.ts
 *
 * Pure-JS byte codecs used by the networking layer.
 *
 * These helpers never touch the Node `Buffer` global (nor Buffer instance
 * methods like `.toString('hex')` / `.writeUInt32LE`), so they are safe to
 * call under `contextIsolation: true` where `Buffer`/`require` do not exist
 * in the renderer's main world. `TextEncoder`/`TextDecoder` are standard
 * web-platform APIs and are always available.
 *
 * Anything these functions receive is treated as a PLAIN `Uint8Array` — byte
 * content, length, indexing, `.set`, `.subarray` only — which survives
 * structured-clone across the preload bridge.
 */

const HEX_CHARS = '0123456789abcdef';
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 encode a string to bytes. */
export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-8 decode bytes to a string. */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Map every byte to its latin1 char (0-255). Lossless for binary payloads. */
export function decodeLatin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

/** Encode a latin1 string (chars 0-255) back to bytes. */
export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/** UTF-16LE encode a string to bytes (NTLM auth payloads). */
export function encodeUtf16Le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return out;
}

/** Write an ASCII string into a byte buffer at `offset`. */
export function writeAscii(bytes: Uint8Array, text: string, offset: number): void {
  for (let i = 0; i < text.length; i++) {
    bytes[offset + i] = text.charCodeAt(i) & 0xff;
  }
}

/** Hex-encode bytes (lowercase). */
export function hexFromBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX_CHARS[bytes[i]! >> 4];
    out += HEX_CHARS[bytes[i]! & 0x0f];
  }
  return out;
}

/** Hex-decode a string to bytes. Ignores invalid characters. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Base64-encode bytes with padding. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/** Read an unsigned big-endian 16-bit integer at `offset`. */
export function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
}

/** Write an unsigned big-endian 16-bit integer at `offset`. Returns `offset + 2`. */
export function writeUInt16BE(bytes: Uint8Array, value: number, offset: number): number {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
  return offset + 2;
}

/** Read an unsigned big-endian 32-bit integer at `offset`. */
export function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! << 24) |
    (bytes[offset + 1]! << 16) |
    (bytes[offset + 2]! << 8) |
    bytes[offset + 3]!
  ) >>> 0;
}

/** Write an unsigned big-endian 32-bit integer at `offset`. Returns `offset + 4`. */
export function writeUInt32BE(bytes: Uint8Array, value: number, offset: number): number {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
  return offset + 4;
}

/** Byte-for-byte equality (constant-shape, not constant-time — fine for demux/matching, not for secret comparison). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Concatenate byte arrays into one flat `Uint8Array`. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Find the first index of `needle` inside `haystack` at or after `from`. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0) return from;
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * QUIC variable-length integer encoding (RFC 9000 §16). Pure, `Uint8Array`-only,
 * so it is safe under `contextIsolation: true` and shared by the QUIC wire seam
 * (`quic-wire.ts`) and `QuicConnection`.
 *
 * Values from 2⁶² up are not encodable (the 2-bit prefix leaves 62 bits) and
 * values beyond `Number.MAX_SAFE_INTEGER` (2⁵³−1) lose precision on decode
 * (`hi * 2³² + lo`), so callers should stay within the safe-integer range.
 */
export function encodeVarInt(value: number): Uint8Array {
  if (value < 64) return new Uint8Array([value]);
  if (value < 16384) {
    const buf = new Uint8Array(2);
    writeUInt16BE(buf, value | 0x4000, 0);
    return buf;
  }
  if (value < 1_073_741_824) {
    const buf = new Uint8Array(4);
    writeUInt32BE(buf, value | 0x80000000, 0);
    return buf;
  }
  const buf = new Uint8Array(8);
  const hi = Math.floor(value / 0x100000000);
  const lo = value >>> 0;
  writeUInt32BE(buf, hi, 0);
  writeUInt32BE(buf, lo, 4);
  buf[0] = buf[0]! | 0xC0;
  return buf;
}

/**
 * Decode a QUIC varint from the start of `data`. Returns `{ value, length }` or
 * `{ value: 0, length: 0 }` when there are not enough bytes for the prefix's
 * declared width.
 */
export function decodeVarInt(data: Uint8Array): { value: number; length: number } {
  if (data.length === 0) return { value: 0, length: 0 };
  const prefix = data[0]! >> 6;
  const mask = 0x3F;

  switch (prefix) {
    case 0: return { value: data[0]! & mask, length: 1 };
    case 1: {
      if (data.length < 2) return { value: 0, length: 0 };
      return { value: ((data[0]! & mask) << 8) | data[1]!, length: 2 };
    }
    case 2: {
      if (data.length < 4) return { value: 0, length: 0 };
      return { value: ((data[0]! & mask) << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!, length: 4 };
    }
    case 3: {
      if (data.length < 8) return { value: 0, length: 0 };
      const hi = ((data[0]! & mask) << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
      const lo = ((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0;
      return { value: hi * 0x100000000 + lo, length: 8 };
    }
    default: return { value: 0, length: 0 };
  }
}

/**
 * Encode a QUIC packet number to its 1/2/4-byte big-endian form based on the
 * RFC 9000 size selection thresholds (0x00–0x7F → 1, 0x80–0x7FFF → 2, else 4).
 */
export function encodePacketNumber(pn: number): Uint8Array {
  if (pn < 128) return new Uint8Array([pn]);
  if (pn < 32768) {
    const buf = new Uint8Array(2);
    writeUInt16BE(buf, pn, 0);
    return buf;
  }
  const buf = new Uint8Array(4);
  writeUInt32BE(buf, pn, 0);
  return buf;
}

/** Decode the 1/2/4-byte big-endian packet number encoded by `encodePacketNumber`. */
export function decodePacketNumber(bytes: Uint8Array): number {
  if (bytes.length === 1) return bytes[0]!;
  if (bytes.length === 2) return readUInt16BE(bytes, 0);
  if (bytes.length === 4) return readUInt32BE(bytes, 0);
  return 0;
}