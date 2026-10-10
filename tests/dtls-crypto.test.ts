/**
 * @file tests/dtls-crypto.test.ts
 *
 * Pins the TLS 1.2 key-schedule seam (`src/browser/networking/dtls/dtls-crypto.ts`):
 * HMAC-SHA256 against the RFC 4231 test vectors (the primitive the RFC 5246 §5
 * PRF is built from), then the PRF/master-secret/key-expansion/Finished
 * derivations built on top of it for determinism and documented output shapes.
 */
import { describe, it, expect } from 'vitest';
import { hexToBytes, hexFromBytes, encodeUtf8 } from '../src/browser/networking/byte-codecs';
import {
  hmacSha256,
  pHashSha256,
  prf,
  deriveMasterSecret,
  deriveGcmKeyBlock,
  computeFinishedVerifyData,
  sha256,
} from '../src/browser/networking/dtls/dtls-crypto';

describe('HMAC-SHA256 (RFC 4231 test vectors — the PRF primitive)', () => {
  it('matches RFC 4231 Test Case 2 (key shorter than block size)', async () => {
    const key = encodeUtf8('Jefe');
    const data = encodeUtf8('what do ya want for nothing?');
    const mac = await hmacSha256(key, data);
    expect(hexFromBytes(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('matches RFC 4231 Test Case 1 (20-byte key)', async () => {
    const key = hexToBytes('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b');
    const data = encodeUtf8('Hi There');
    const mac = await hmacSha256(key, data);
    expect(hexFromBytes(mac)).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });
});

describe('P_SHA256 / PRF (RFC 5246 §5)', () => {
  it('produces exactly the requested output length regardless of block alignment', async () => {
    const secret = encodeUtf8('secret');
    const seed = encodeUtf8('seed');
    for (const len of [1, 16, 32, 48, 77, 128]) {
      const out = await pHashSha256(secret, seed, len);
      expect(out.length).toBe(len);
    }
  });

  it('is a pure function of (secret, label, seed, length) — deterministic and label-sensitive', async () => {
    const secret = encodeUtf8('master-secret-like-value-000000');
    const seed = encodeUtf8('client-random+server-random');
    const a1 = await prf(secret, 'master secret', seed, 48);
    const a2 = await prf(secret, 'master secret', seed, 48);
    const b = await prf(secret, 'key expansion', seed, 48);
    expect(hexFromBytes(a1)).toBe(hexFromBytes(a2));
    expect(hexFromBytes(a1)).not.toBe(hexFromBytes(b));
  });
});

describe('TLS 1.2 key schedule (RFC 5246 §8.1, §6.3) built on the PRF', () => {
  it('derives a 48-byte master_secret deterministically from (pre_master_secret, client_random, server_random)', async () => {
    const pms = new Uint8Array(32).fill(0x11);
    const clientRandom = new Uint8Array(32).fill(0x22);
    const serverRandom = new Uint8Array(32).fill(0x33);
    const ms1 = await deriveMasterSecret(pms, clientRandom, serverRandom);
    const ms2 = await deriveMasterSecret(pms, clientRandom, serverRandom);
    expect(ms1.length).toBe(48);
    expect(hexFromBytes(ms1)).toBe(hexFromBytes(ms2));

    // Changing any input must change the master secret.
    const msDifferentRandom = await deriveMasterSecret(pms, new Uint8Array(32).fill(0x44), serverRandom);
    expect(hexFromBytes(msDifferentRandom)).not.toBe(hexFromBytes(ms1));
  });

  it('derives distinct, correctly-sized client/server GCM write keys and IVs (RFC 5288 §3 — no MAC keys for AEAD)', async () => {
    const masterSecret = new Uint8Array(48).fill(0xaa);
    const clientRandom = new Uint8Array(32).fill(0x22);
    const serverRandom = new Uint8Array(32).fill(0x33);
    const keys = await deriveGcmKeyBlock(masterSecret, clientRandom, serverRandom);
    expect(keys.clientWriteKey.length).toBe(16);
    expect(keys.serverWriteKey.length).toBe(16);
    expect(keys.clientWriteIv.length).toBe(4);
    expect(keys.serverWriteIv.length).toBe(4);
    expect(hexFromBytes(keys.clientWriteKey)).not.toBe(hexFromBytes(keys.serverWriteKey));
  });

  it('computes a 12-byte Finished verify_data from the master secret and a handshake-transcript hash', async () => {
    const masterSecret = new Uint8Array(48).fill(0x55);
    const transcriptHash = await sha256(encodeUtf8('fake handshake transcript bytes'));
    const clientVerify = await computeFinishedVerifyData(masterSecret, 'client finished', transcriptHash);
    const serverVerify = await computeFinishedVerifyData(masterSecret, 'server finished', transcriptHash);
    expect(clientVerify.length).toBe(12);
    expect(serverVerify.length).toBe(12);
    // Different labels over the same hash must diverge (client/server Finished must not collide).
    expect(hexFromBytes(clientVerify)).not.toBe(hexFromBytes(serverVerify));
  });
});
