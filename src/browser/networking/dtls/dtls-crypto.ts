/**
 * @file src/browser/networking/dtls/dtls-crypto.ts
 *
 * TLS 1.2 (RFC 5246 §5) key schedule primitives: the SHA-256 PRF, master
 * secret / key_expansion derivation, and Finished `verify_data`. Also wraps
 * the Web Crypto ECDH P-256 key agreement used for the ECDHE exchange.
 *
 * Everything here is a thin wrapper over `globalThis.crypto.subtle` — no
 * hand-rolled HMAC/SHA/ECDH math. `subtle` is available in both the Electron
 * renderer (contextIsolation-safe) and Node 20's global `crypto`.
 */

import { concatBytes, toArrayBuffer } from '../byte-codecs';

const subtle = (): SubtleCrypto => (globalThis as { crypto: Crypto }).crypto.subtle;

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', toArrayBuffer(data)));
}

async function hmacKey(key: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', toArrayBuffer(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await hmacKey(key);
  return new Uint8Array(await subtle().sign('HMAC', cryptoKey, toArrayBuffer(data)));
}

/**
 * TLS 1.2 `P_SHA256(secret, seed)` (RFC 5246 §5): iterates
 * `A(i) = HMAC(secret, A(i-1))`, `A(0) = seed`, emitting
 * `HMAC(secret, A(i) + seed)` chunks until `outLen` bytes are produced.
 */
export async function pHashSha256(secret: Uint8Array, seed: Uint8Array, outLen: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let produced = 0;
  let a = await hmacSha256(secret, seed);
  while (produced < outLen) {
    const chunk = await hmacSha256(secret, concatBytes([a, seed]));
    chunks.push(chunk);
    produced += chunk.length;
    a = await hmacSha256(secret, a);
  }
  return concatBytes(chunks).subarray(0, outLen);
}

/** `PRF(secret, label, seed) = P_SHA256(secret, label + seed)` (TLS 1.2 uses a single-hash PRF, RFC 5246 §5). */
export async function prf(secret: Uint8Array, label: string, seed: Uint8Array, outLen: number): Promise<Uint8Array> {
  const labelBytes = new TextEncoder().encode(label);
  return pHashSha256(secret, concatBytes([labelBytes, seed]), outLen);
}

/** `master_secret = PRF(pre_master_secret, "master secret", client_random + server_random)[0..48]` (RFC 5246 §8.1). */
export async function deriveMasterSecret(
  preMasterSecret: Uint8Array,
  clientRandom: Uint8Array,
  serverRandom: Uint8Array,
): Promise<Uint8Array> {
  return prf(preMasterSecret, 'master secret', concatBytes([clientRandom, serverRandom]), 48);
}

export interface GcmKeyBlock {
  clientWriteKey: Uint8Array;
  serverWriteKey: Uint8Array;
  /** 4-byte "salt" prefixed to the 8-byte explicit nonce to form the 12-byte GCM IV (RFC 5288 §3). */
  clientWriteIv: Uint8Array;
  serverWriteIv: Uint8Array;
}

/**
 * `key_block = PRF(master_secret, "key expansion", server_random + client_random)` (RFC 5246 §6.3).
 * AEAD ciphers (AES-GCM) have no separate MAC keys — just `client_write_key`,
 * `server_write_key`, `client_write_IV`, `server_write_IV` (RFC 5288 §3).
 */
export async function deriveGcmKeyBlock(
  masterSecret: Uint8Array,
  clientRandom: Uint8Array,
  serverRandom: Uint8Array,
  keyLen = 16,
  ivLen = 4,
): Promise<GcmKeyBlock> {
  const total = keyLen * 2 + ivLen * 2;
  const block = await prf(masterSecret, 'key expansion', concatBytes([serverRandom, clientRandom]), total);
  let offset = 0;
  const take = (n: number): Uint8Array => {
    const slice = block.subarray(offset, offset + n);
    offset += n;
    return slice;
  };
  return {
    clientWriteKey: take(keyLen),
    serverWriteKey: take(keyLen),
    clientWriteIv: take(ivLen),
    serverWriteIv: take(ivLen),
  };
}

export type FinishedLabel = 'client finished' | 'server finished';

/**
 * `verify_data = PRF(master_secret, label, SHA256(handshake_messages))[0..12]` (RFC 5246 §7.4.9).
 * `handshakeMessagesHash` must already be `sha256(concat(all handshake message bytes so far))`.
 */
export async function computeFinishedVerifyData(
  masterSecret: Uint8Array,
  label: FinishedLabel,
  handshakeMessagesHash: Uint8Array,
): Promise<Uint8Array> {
  return prf(masterSecret, label, handshakeMessagesHash, 12);
}

/* -------------------------------------------------------------------------- */
/*  ECDHE (P-256) key agreement                                               */
/* -------------------------------------------------------------------------- */

export async function generateEcdhKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as Promise<CryptoKeyPair>;
}

export async function exportEcdhRawPublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await subtle().exportKey('raw', publicKey));
}

export async function importEcdhPeerPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', toArrayBuffer(raw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

/**
 * ECDHE `pre_master_secret` = the shared X-coordinate (RFC 4492 §5.10). Web
 * Crypto's `deriveBits` for ECDH already returns exactly that (no further
 * stripping needed).
 */
export async function ecdhSharedSecret(privateKey: CryptoKey, peerPublicRaw: Uint8Array): Promise<Uint8Array> {
  const peerKey = await importEcdhPeerPublicKey(peerPublicRaw);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: peerKey }, privateKey, 256);
  return new Uint8Array(bits);
}
