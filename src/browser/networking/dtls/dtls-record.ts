/**
 * @file src/browser/networking/dtls/dtls-record.ts
 *
 * DTLS 1.2 record layer (RFC 6347 §4.1) with the single AEAD cipher this
 * phase supports: `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` (RFC 5288).
 *
 * Record header (13 bytes): content-type(1) + version(2, `0xFEFD`) +
 * epoch(2) + sequence_number(6) + length(2). The AAD for GCM is exactly
 * those 13 bytes with `length` set to the *plaintext* length (RFC 5246
 * §6.2.3.3, adapted to DTLS's epoch+seq in place of a bare sequence number).
 */

import { concatBytes, readUInt16BE, writeUInt16BE, toArrayBuffer } from '../byte-codecs';

export const DTLS_1_2_VERSION: readonly [number, number] = [0xfe, 0xfd];

export enum DtlsContentType {
  ChangeCipherSpec = 20,
  Alert = 21,
  Handshake = 22,
  ApplicationData = 23,
}

export interface DtlsRecordHeader {
  contentType: DtlsContentType;
  epoch: number;
  /** 48-bit DTLS sequence number — fits comfortably in a JS safe integer. */
  sequenceNumber: number;
  length: number;
}

const RECORD_HEADER_LEN = 13;

function writeUInt48BE(value: number, out: Uint8Array, offset: number): void {
  const hi = Math.floor(value / 0x10000); // top 16 bits
  const lo = value % 0x10000; // bottom 16 bits
  writeUInt16BE(out, (hi >>> 16) & 0xffff, offset);
  writeUInt16BE(out, hi & 0xffff, offset + 2);
  writeUInt16BE(out, lo, offset + 4);
}

function readUInt48BE(bytes: Uint8Array, offset: number): number {
  const hi = readUInt16BE(bytes, offset) * 0x100000000 + readUInt16BE(bytes, offset + 2) * 0x10000;
  const lo = readUInt16BE(bytes, offset + 4);
  return hi + lo;
}

/** The 8-byte `epoch || sequence_number` field DTLS uses wherever TLS 1.2 uses a bare 8-byte seq_num (incl. as the GCM explicit nonce). */
export function epochSeqBytes(epoch: number, sequenceNumber: number): Uint8Array {
  const out = new Uint8Array(8);
  writeUInt16BE(out, epoch, 0);
  writeUInt48BE(sequenceNumber, out, 2);
  return out;
}

export function buildRecordHeader(header: DtlsRecordHeader): Uint8Array {
  const out = new Uint8Array(RECORD_HEADER_LEN);
  out[0] = header.contentType;
  out[1] = DTLS_1_2_VERSION[0];
  out[2] = DTLS_1_2_VERSION[1];
  out.set(epochSeqBytes(header.epoch, header.sequenceNumber), 3);
  writeUInt16BE(out, header.length, 11);
  return out;
}

export function parseRecordHeader(bytes: Uint8Array, offset = 0): DtlsRecordHeader {
  if (bytes.length - offset < RECORD_HEADER_LEN) throw new Error('parseRecordHeader: truncated header');
  return {
    contentType: bytes[offset]!,
    epoch: readUInt16BE(bytes, offset + 3),
    sequenceNumber: readUInt48BE(bytes, offset + 5),
    length: readUInt16BE(bytes, offset + 11),
  };
}

/** Split a single UDP datagram that may carry several coalesced DTLS records. */
export function splitRecords(datagram: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let offset = 0;
  while (offset + RECORD_HEADER_LEN <= datagram.length) {
    const header = parseRecordHeader(datagram, offset);
    const end = offset + RECORD_HEADER_LEN + header.length;
    if (end > datagram.length) break; // truncated trailing record — ignore
    out.push(datagram.subarray(offset, end));
    offset = end;
  }
  return out;
}

const GCM_EXPLICIT_NONCE_LEN = 8;
const GCM_TAG_LEN = 16;

async function aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), 'AES-GCM', false, ['encrypt']);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: GCM_TAG_LEN * 8 },
    cryptoKey,
    toArrayBuffer(plaintext),
  );
  return new Uint8Array(sealed);
}

async function aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(key), 'AES-GCM', false, ['decrypt']);
  const opened = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad), tagLength: GCM_TAG_LEN * 8 },
    cryptoKey,
    toArrayBuffer(sealed),
  );
  return new Uint8Array(opened);
}

/**
 * Encrypt one DTLS record under AES-128-GCM. `writeKey`/`salt` are this
 * sender's `*_write_key`/`*_write_IV` from the key block. The 8-byte explicit
 * nonce sent on the wire is the record's own `epoch || sequence_number` —
 * simplest possible choice, and always unique per RFC 5288 §3 as long as the
 * DTLS layer never reuses a sequence number within an epoch.
 */
export async function encryptRecordGcm(
  writeKey: Uint8Array,
  salt: Uint8Array,
  epoch: number,
  sequenceNumber: number,
  contentType: DtlsContentType,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const explicitNonce = epochSeqBytes(epoch, sequenceNumber);
  const iv = concatBytes([salt, explicitNonce]);
  const aad = buildRecordHeader({ contentType, epoch, sequenceNumber, length: plaintext.length });
  const sealed = await aesGcmEncrypt(writeKey, iv, aad, plaintext);
  const outerHeader = buildRecordHeader({
    contentType,
    epoch,
    sequenceNumber,
    length: explicitNonce.length + sealed.length,
  });
  return concatBytes([outerHeader, explicitNonce, sealed]);
}

export interface DecryptedRecord {
  contentType: DtlsContentType;
  epoch: number;
  sequenceNumber: number;
  plaintext: Uint8Array;
}

/** Decrypt one on-the-wire DTLS record (header + explicit nonce + ciphertext + tag) produced by `encryptRecordGcm`. */
export async function decryptRecordGcm(readKey: Uint8Array, salt: Uint8Array, record: Uint8Array): Promise<DecryptedRecord> {
  const header = parseRecordHeader(record, 0);
  const body = record.subarray(RECORD_HEADER_LEN, RECORD_HEADER_LEN + header.length);
  const explicitNonce = body.subarray(0, GCM_EXPLICIT_NONCE_LEN);
  const sealed = body.subarray(GCM_EXPLICIT_NONCE_LEN);
  const iv = concatBytes([salt, explicitNonce]);
  const plaintextLen = sealed.length - GCM_TAG_LEN;
  const aad = buildRecordHeader({ contentType: header.contentType, epoch: header.epoch, sequenceNumber: header.sequenceNumber, length: plaintextLen });
  const plaintext = await aesGcmDecrypt(readKey, iv, aad, sealed);
  return { contentType: header.contentType, epoch: header.epoch, sequenceNumber: header.sequenceNumber, plaintext };
}

/** Build a plaintext (pre-ChangeCipherSpec) record — handshake messages before the keys exist. */
export function buildPlaintextRecord(contentType: DtlsContentType, epoch: number, sequenceNumber: number, body: Uint8Array): Uint8Array {
  const header = buildRecordHeader({ contentType, epoch, sequenceNumber, length: body.length });
  return concatBytes([header, body]);
}

export { RECORD_HEADER_LEN };
