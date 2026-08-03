/**
 * @file tests/helpers/self-signed-cert.ts
 *
 * Generate an in-memory self-signed X.509 certificate using only Node's
 * built-in `crypto` module (no openssl, no npm deps). Used by networking
 * tests that need a real TLS server.
 */

import { createSign, generateKeyPairSync } from 'node:crypto';

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len <= 0xff) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes: number[] = [parts[0]! * 40 + parts[1]!];
  for (let i = 2; i < parts.length; i++) {
    const enc: number[] = [];
    let v = parts[i]!;
    enc.unshift(v & 0x7f);
    v = Math.floor(v / 128);
    while (v > 0) {
      enc.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(...enc);
  }
  return derTag(0x06, Buffer.from(bytes));
}

function derInt(n: bigint): Buffer {
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  if (bytes[0] & 0x80) bytes = Buffer.concat([Buffer.from([0x00]), bytes]);
  return derTag(0x02, bytes);
}

function derUtcTime(d: Date): Buffer {
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.sssZ
  const utc = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return derTag(0x17, Buffer.from(utc, 'ascii')); // UTCTime tag + length
}

function derName(cn: string): Buffer {
  const cnBytes = Buffer.from(cn, 'utf-8');
  const attr = derTag(0x30, Buffer.concat([derOid('2.5.4.3'), derTag(0x0c, cnBytes)]));
  return derTag(0x30, derTag(0x31, attr));
}

/** Create a self-signed RSA cert valid for `days` (default 30). */
export function createSelfSignedCert(cn: string, days = 30): { key: string; cert: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

  // SubjectPublicKeyInfo in DER form — already exactly what TBSCertificate needs.
  const spki = publicKey.export({ type: 'spki', format: 'der' });

  // sha256WithRSAEncryption signature algorithm
  const sigAlg = derTag(0x30, Buffer.concat([
    derOid('1.2.840.113549.1.1.11'),
    derTag(0x05, Buffer.alloc(0)),
  ]));

  const now = Date.now();
  const notBefore = new Date(now - 60_000);
  const notAfter = new Date(now + days * 86_400_000);

  const tbsBody = Buffer.concat([
    derTag(0xa0, derTag(0x02, Buffer.from([0x02]))),       // [0] EXPLICIT version v3
    derInt(0x0102030405060708n),                          // serial number
    sigAlg,                                               // signature algorithm
    derName(cn),                                          // issuer
    derTag(0x30, Buffer.concat([derUtcTime(notBefore), derUtcTime(notAfter)])), // validity
    derName(cn),                                          // subject
    spki,                                                 // subjectPublicKeyInfo
  ]);
  const tbs = derTag(0x30, tbsBody);

  const signature = createSign('RSA-SHA256').update(tbs).sign(privateKey);

  const cert = derTag(0x30, Buffer.concat([
    tbs,
    sigAlg,
    derTag(0x03, Buffer.concat([Buffer.from([0x00]), signature])), // BIT STRING signature
  ]));

  const b64 = cert.toString('base64').match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    cert: `-----BEGIN CERTIFICATE-----\n${b64.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
}
