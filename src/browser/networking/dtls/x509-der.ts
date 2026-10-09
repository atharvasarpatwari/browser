/**
 * @file src/browser/networking/dtls/x509-der.ts
 *
 * Minimal pure-TS ASN.1 DER encoder/parser plus a self-signed ECDSA P-256
 * X.509 certificate builder. No `node:crypto` — signing/key generation goes
 * through Web Crypto (`subtle`), which is available in both the Electron
 * renderer (contextIsolation-safe) and Node 20 vitest.
 *
 * Scope matches the WebRTC DTLS trust model (RFC 8122/RFC 8827): certs are
 * self-signed and never chain-validated. The only thing ever checked against
 * a peer cert is (a) its SHA-256 fingerprint against the SDP `a=fingerprint`
 * line and (b) the EC public key it carries, used to verify CertificateVerify.
 */

import { concatBytes, hexFromBytes, toArrayBuffer } from '../byte-codecs';

/* -------------------------------------------------------------------------- */
/*  DER primitive encoders                                                    */
/* -------------------------------------------------------------------------- */

const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  UTC_TIME: 0x17,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

function derLength(n: number): Uint8Array {
  if (n < 0x80) return new Uint8Array([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derTLV(tag: number, content: Uint8Array): Uint8Array {
  return concatBytes([new Uint8Array([tag]), derLength(content.length), content]);
}

export function derSeq(...parts: Uint8Array[]): Uint8Array {
  return derTLV(TAG.SEQUENCE, concatBytes(parts));
}

export function derSet(...parts: Uint8Array[]): Uint8Array {
  return derTLV(TAG.SET, concatBytes(parts));
}

/** DER INTEGER. Prepends a 0x00 pad byte when the high bit would flip the sign. */
export function derInt(bytes: Uint8Array): Uint8Array {
  let content = bytes;
  // Strip redundant leading zero bytes (keep at least one byte).
  let start = 0;
  while (start < content.length - 1 && content[start] === 0x00 && (content[start + 1]! & 0x80) === 0) {
    start++;
  }
  content = content.subarray(start);
  if (content.length === 0) content = new Uint8Array([0]);
  if (content[0]! & 0x80) content = concatBytes([new Uint8Array([0x00]), content]);
  return derTLV(TAG.INTEGER, content);
}

export function derIntFromNumber(n: number): Uint8Array {
  if (n < 0) throw new Error('derIntFromNumber: negative values unsupported');
  if (n === 0) return derInt(new Uint8Array([0]));
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return derInt(new Uint8Array(bytes));
}

export function derBitString(bytes: Uint8Array, unusedBits = 0): Uint8Array {
  return derTLV(TAG.BIT_STRING, concatBytes([new Uint8Array([unusedBits]), bytes]));
}

export function derOctetString(bytes: Uint8Array): Uint8Array {
  return derTLV(TAG.OCTET_STRING, bytes);
}

export function derNull(): Uint8Array {
  return new Uint8Array([TAG.NULL, 0x00]);
}

export function derOid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map((p) => parseInt(p, 10));
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    if (part < 0x80) {
      out.push(part);
      continue;
    }
    const chunk: number[] = [];
    let v = part;
    chunk.unshift(v & 0x7f);
    v = Math.floor(v / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] = chunk[i]! | 0x80;
    out.push(...chunk);
  }
  return derTLV(TAG.OID, new Uint8Array(out));
}

export function derUtf8String(s: string): Uint8Array {
  return derTLV(TAG.UTF8_STRING, new TextEncoder().encode(s));
}

export function derPrintableString(s: string): Uint8Array {
  return derTLV(TAG.PRINTABLE_STRING, new TextEncoder().encode(s));
}

/** UTCTime, format YYMMDDHHMMSSZ (valid through 2049 per X.509 convention). */
export function derUtcTime(date: Date): Uint8Array {
  const pad = (n: number) => String(n).padStart(2, '0');
  const s =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return derTLV(TAG.UTC_TIME, new TextEncoder().encode(s));
}

/** Explicit context-tagged constructed field, e.g. `[0] { INTEGER 2 }` for the X.509 version. */
export function derContext(tagNumber: number, ...parts: Uint8Array[]): Uint8Array {
  return derTLV(0xa0 | tagNumber, concatBytes(parts));
}

/* -------------------------------------------------------------------------- */
/*  Generic DER parser                                                        */
/* -------------------------------------------------------------------------- */

export interface DerNode {
  tag: number;
  /** Offset of this node's content within the buffer it was parsed from. */
  contentStart: number;
  content: Uint8Array;
  /** The full TLV (tag+length+content) as a view into the source buffer. */
  raw: Uint8Array;
  /** End offset (exclusive) of this node within the buffer it was parsed from. */
  end: number;
}

/** Parse a single DER TLV starting at `offset`. Throws on truncated input. */
export function parseDerNode(bytes: Uint8Array, offset = 0): DerNode {
  if (offset >= bytes.length) throw new Error('parseDerNode: offset out of range');
  const tag = bytes[offset]!;
  let p = offset + 1;
  const first = bytes[p]!;
  let length: number;
  if (first & 0x80) {
    const numBytes = first & 0x7f;
    p++;
    length = 0;
    for (let i = 0; i < numBytes; i++) length = length * 256 + bytes[p + i]!;
    p += numBytes;
  } else {
    length = first;
    p++;
  }
  const contentStart = p;
  const end = contentStart + length;
  if (end > bytes.length) throw new Error('parseDerNode: truncated TLV');
  return { tag, contentStart, content: bytes.subarray(contentStart, end), raw: bytes.subarray(offset, end), end };
}

/** Parse every top-level sibling TLV in `bytes` (used to walk a SEQUENCE's content). */
export function parseDerChildren(bytes: Uint8Array): DerNode[] {
  const out: DerNode[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const node = parseDerNode(bytes, offset);
    out.push(node);
    offset = node.end;
  }
  return out;
}

/** Depth-first walk, invoking `visit` for every node (including nested ones). */
function walkDer(bytes: Uint8Array, visit: (node: DerNode) => void): void {
  for (const node of parseDerChildren(bytes)) {
    visit(node);
    // Constructed tags (bit 0x20 set) or SEQUENCE/SET contain nested TLVs.
    if ((node.tag & 0x20) !== 0) {
      try {
        walkDer(node.content, visit);
      } catch {
        // Not actually nested DER (e.g. a primitive misread as constructed) — ignore.
      }
    }
  }
}

export const OID_EC_PUBLIC_KEY = '1.2.840.10045.2.1';
export const OID_PRIME256V1 = '1.2.840.10045.3.1.7';
export const OID_ECDSA_SHA256 = '1.2.840.10045.4.3.2';
export const OID_COMMON_NAME = '2.5.4.3';

/** Compares an OID node's raw *content* bytes (no tag/length) against a dotted OID string. */
function oidBytesEqual(oidContent: Uint8Array, dotted: string): boolean {
  const expected = parseDerNode(derOid(dotted), 0).content;
  if (oidContent.length !== expected.length) return false;
  for (let i = 0; i < oidContent.length; i++) if (oidContent[i] !== expected[i]) return false;
  return true;
}

/**
 * Extract the raw EC point (uncompressed, `0x04 || X || Y`, 65 bytes for
 * P-256) from an arbitrary X.509 DER certificate's subjectPublicKeyInfo.
 * Works on peer certs we didn't generate (e.g. from a real browser) because
 * it finds the SPKI by its fixed `AlgorithmIdentifier{ecPublicKey, curve}`
 * shape rather than by a hardcoded structural offset.
 */
export function extractSpkiEcPoint(certDer: Uint8Array): Uint8Array {
  let found: Uint8Array | null = null;
  walkDer(certDer, (node) => {
    if (found) return;
    if (node.tag !== TAG.SEQUENCE) return;
    const children = parseDerChildren(node.content);
    if (children.length < 2) return;
    const [algSeq, bitString] = children;
    if (algSeq!.tag !== TAG.SEQUENCE || bitString!.tag !== TAG.BIT_STRING) return;
    const algParts = parseDerChildren(algSeq!.content);
    if (algParts.length < 1 || algParts[0]!.tag !== TAG.OID) return;
    if (!oidBytesEqual(algParts[0]!.content, OID_EC_PUBLIC_KEY)) return;
    // BIT STRING content: 1 unused-bits byte + the EC point.
    found = bitString!.content.subarray(1);
  });
  if (!found) throw new Error('extractSpkiEcPoint: no ecPublicKey SubjectPublicKeyInfo found in certificate');
  return found;
}

/** Upper-case colon-separated SHA-256 fingerprint of a DER cert (RFC 8122 `a=fingerprint` format). */
export async function certFingerprintSha256(certDer: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', toArrayBuffer(certDer)));
  return hexFromBytes(digest).toUpperCase().match(/.{2}/g)!.join(':');
}

/** Convert a Web Crypto raw ECDSA signature (`r(32) || s(32)` for P-256) into a DER `SEQUENCE{INTEGER r, INTEGER s}`. */
export function rawEcdsaSigToDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error(`rawEcdsaSigToDer: expected 64-byte raw signature, got ${raw.length}`);
  return derSeq(derInt(raw.subarray(0, 32)), derInt(raw.subarray(32, 64)));
}

/** Convert a DER `SEQUENCE{INTEGER r, INTEGER s}` ECDSA signature into Web Crypto's raw `r(32) || s(32)` form. */
export function derEcdsaSigToRaw(der: Uint8Array): Uint8Array {
  const seq = parseDerNode(der, 0);
  if (seq.tag !== TAG.SEQUENCE) throw new Error('derEcdsaSigToRaw: not a SEQUENCE');
  const [r, s] = parseDerChildren(seq.content);
  if (!r || !s || r.tag !== TAG.INTEGER || s.tag !== TAG.INTEGER) throw new Error('derEcdsaSigToRaw: malformed r/s');
  const fixed32 = (v: Uint8Array): Uint8Array => {
    const trimmed = v[0] === 0x00 && v.length > 32 ? v.subarray(1) : v;
    if (trimmed.length === 32) return trimmed;
    const out = new Uint8Array(32);
    out.set(trimmed, 32 - trimmed.length);
    return out;
  };
  return concatBytes([fixed32(r.content), fixed32(s.content)]);
}

/* -------------------------------------------------------------------------- */
/*  Self-signed ECDSA P-256 certificate builder                              */
/* -------------------------------------------------------------------------- */

export interface SelfSignedCert {
  der: Uint8Array;
  fingerprintSha256: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyRaw: Uint8Array;
}

function buildName(commonName: string): Uint8Array {
  return derSeq(derSet(derSeq(derOid(OID_COMMON_NAME), derUtf8String(commonName))));
}

async function buildTbsCertificate(params: {
  serial: Uint8Array;
  commonName: string;
  notBefore: Date;
  notAfter: Date;
  publicKeyRaw: Uint8Array;
}): Promise<Uint8Array> {
  const version = derContext(0, derIntFromNumber(2)); // v3
  const serialNumber = derInt(params.serial);
  const signatureAlg = derSeq(derOid(OID_ECDSA_SHA256));
  const issuer = buildName(params.commonName);
  const validity = derSeq(derUtcTime(params.notBefore), derUtcTime(params.notAfter));
  const subject = buildName(params.commonName);
  const spki = derSeq(derSeq(derOid(OID_EC_PUBLIC_KEY), derOid(OID_PRIME256V1)), derBitString(params.publicKeyRaw));
  return derSeq(version, serialNumber, signatureAlg, issuer, validity, subject, spki);
}

/**
 * Generate a fresh ECDSA P-256 keypair and build a self-signed X.509 DER
 * certificate around it. No CA, no extensions beyond the bare minimum X.509
 * requires — the only thing a peer ever checks is the fingerprint + the
 * embedded public key (RFC 8122 trust model).
 */
export async function generateSelfSignedP256Cert(): Promise<SelfSignedCert> {
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

  const serial = new Uint8Array(8);
  crypto.getRandomValues(serial);
  const cnDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', publicKeyRaw));
  const commonName = hexFromBytes(cnDigest.subarray(0, 16));

  const now = new Date();
  const notBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const notAfter = new Date(now.getTime() + 365 * 24 * 3600 * 1000);

  const tbs = await buildTbsCertificate({ serial, commonName, notBefore, notAfter, publicKeyRaw });
  const sigRaw = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, toArrayBuffer(tbs)),
  );
  const sigDer = rawEcdsaSigToDer(sigRaw);

  const der = derSeq(tbs, derSeq(derOid(OID_ECDSA_SHA256)), derBitString(sigDer));
  const fingerprintSha256 = await certFingerprintSha256(der);

  return { der, fingerprintSha256, privateKey: keyPair.privateKey, publicKey: keyPair.publicKey, publicKeyRaw };
}
