/**
 * @file src/browser/security/crypto-utils.ts
 *
 * Environment-agnostic crypto helpers that work in both Node.js (with
 * nodeIntegration) and browser contexts (with contextIsolation). Provides
 * randomUUID and sync hashing without depending on `import from 'crypto'`.
 */

/* -------------------------------------------------------------------------- */
/*  randomUUID                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Generate a v4 UUID. Prefers the Web Crypto API (`globalThis.crypto.randomUUID`)
 * which is available in Chromium 92+ / Node 19+. Falls back to a PRNG-based
 * implementation for older environments.
 */
export function randomUUID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* -------------------------------------------------------------------------- */
/*  Synchronous hashing                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One-shot synchronous hash. Accepts a string or Uint8Array and returns a
 * hex-encoded digest. Uses Node.js `crypto.createHash` when available,
 * otherwise falls back to `globalThis.crypto.subtle.digest` (async path is
 * not usable here — callers depend on synchronous results, so the async
 * Web Crypto path is intentionally NOT used; in a pure-browser context the
 * caller should switch to the async `hashAsync` variant).
 *
 * Supported algorithms: 'sha256', 'sha384', 'sha512', 'md5', 'md4', 'sha1'.
 */
export function hashSync(
  algorithm: string,
  data: string | Uint8Array,
  encoding: 'hex' | 'binary' = 'hex',
): string {
  // Node.js path (works with nodeIntegration or in preload)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = typeof require === 'function' ? (() => { try { return require('node:crypto') as { createHash(algo: string): { update(d: string | Uint8Array): { digest(enc?: string): string | Buffer } } }; } catch { return null; } })() : null;
  if (nodeCrypto) {
    return nodeCrypto.createHash(algorithm).update(data).digest(encoding) as string;
  }

  // Pure-JS fallback — only SHA-256 for now (SRI and telemetry are the
  // primary consumers outside Node.js).
  if (algorithm === 'sha256') {
    return sha256Hex(typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }

  throw new Error(`hashSync('${algorithm}') is not available without Node.js crypto`);
}

/**
 * One-shot synchronous hash returning raw bytes (Uint8Array).
 */
export function hashRaw(algorithm: string, data: string | Uint8Array): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = typeof require === 'function' ? (() => { try { return require('node:crypto') as { createHash(algo: string): { update(d: string | Uint8Array): { digest(): Buffer } } }; } catch { return null; } })() : null;
  if (nodeCrypto) {
    return new Uint8Array(nodeCrypto.createHash(algorithm).update(data).digest());
  }

  if (algorithm === 'sha256') {
    const hex = sha256Hex(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return Uint8Array.from(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  }

  throw new Error(`hashRaw('${algorithm}') is not available without Node.js crypto`);
}

/* -------------------------------------------------------------------------- */
/*  Minimal pure-JS SHA-256 (for environments without Node crypto)            */
/* -------------------------------------------------------------------------- */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Hex(msg: Uint8Array): string {
  const l = msg.length;
  const bitLen = l * 8;
  const padLen = ((56 - ((l + 1) % 64)) + 64) % 64;
  const padded = new Uint8Array(l + 1 + padLen + 8);
  padded.set(msg);
  padded[l] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);
  view.setUint32(padded.length - 8, (bitLen / 0x100000000) >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let off = 0; off < padded.length; off += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}
