import type { IDisposable } from '../../app/dependency-container';

interface ISubresourceIntegrityService extends IDisposable {
  parseIntegrity(metadata: string): IntegrityHash[];
  computeDigest(algorithm: IntegrityAlgorithm, content: string | Uint8Array): string;
  verify(integrity: string, content: string | Uint8Array): IntegrityVerificationResult;
  setEnforce(enforce: boolean): void;
  isEnforce(): boolean;
  getBlockedCount(): number;
  onEvent(handler: SubresourceIntegrityEventHandler): () => void;
}

type IntegrityAlgorithm = 'sha256' | 'sha384' | 'sha512';
type IntegrityVerificationState = 'valid' | 'invalid' | 'no-integrity' | 'unsupported-algorithm';
type SubresourceIntegrityEventKind = 'verified' | 'blocked' | 'policy-changed';
type SubresourceIntegrityEventHandler = (event: SubresourceIntegrityEvent) => void;

interface SubresourceIntegrityEvent {
  readonly kind: SubresourceIntegrityEventKind;
  readonly data?: Record<string, unknown>;
}

interface IntegrityHash {
  readonly algorithm: IntegrityAlgorithm;
  readonly value: string;
}

interface IntegrityVerificationResult {
  readonly state: IntegrityVerificationState;
  readonly matched: boolean;
  readonly expected: readonly string[];
  readonly actual: string;
}

const SUPPORTED_ALGORITHMS: ReadonlyArray<IntegrityAlgorithm> = ['sha256', 'sha384', 'sha512'];
const ALGORITHM_PATTERN = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})(?:\?.*)?$/;

class SubresourceIntegrityService implements ISubresourceIntegrityService {
  private _enforce = true;
  private _blockedCount = 0;
  private _handlers = new Set<SubresourceIntegrityEventHandler>();

  parseIntegrity(metadata: string): IntegrityHash[] {
    if (!metadata) return [];
    const tokens = metadata.trim().split(/\s+/);
    const hashes: IntegrityHash[] = [];
    for (const token of tokens) {
      if (!token) continue;
      const match = token.match(ALGORITHM_PATTERN);
      if (!match) continue;
      const algorithm = match[1] as IntegrityAlgorithm;
      const value = match[2];
      if (!this.isValidBase64(value)) continue;
      hashes.push({ algorithm, value });
    }
    return hashes;
  }

  computeDigest(algorithm: IntegrityAlgorithm, content: string | Uint8Array): string {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const digest = shaDigest(algorithm, bytes);
    return bytesToBase64(digest);
  }

  verify(integrity: string, content: string | Uint8Array): IntegrityVerificationResult {
    const parsed = this.parseIntegrity(integrity);

    if (parsed.length === 0) {
      const result: IntegrityVerificationResult = {
        state: integrity ? 'unsupported-algorithm' : 'no-integrity',
        matched: false,
        expected: [],
        actual: '',
      };
      if (this._enforce && integrity) {
        this._blockedCount++;
        this.emit({ kind: 'blocked', data: { reason: 'unsupported-or-invalid-integrity', integrity } });
      } else {
        this.emit({ kind: 'verified', data: { ...result } });
      }
      return result;
    }

    const actual = this.computeDigest(parsed[0].algorithm, content);
    const matched = parsed.some((h) => this.computeDigest(h.algorithm, content) === h.value);
    const state: IntegrityVerificationState = matched ? 'valid' : 'invalid';

    if (!matched && this._enforce) {
      this._blockedCount++;
      this.emit({ kind: 'blocked', data: { reason: 'integrity-mismatch', integrity } });
    } else {
      this.emit({ kind: 'verified', data: { state } });
    }

    return {
      state,
      matched,
      expected: parsed.map((h) => `${h.algorithm}-${h.value}`),
      actual: `${parsed[0].algorithm}-${actual}`,
    };
  }

  setEnforce(enforce: boolean): void {
    this._enforce = enforce;
    this.emit({ kind: 'policy-changed', data: { enforce } });
  }

  isEnforce(): boolean {
    return this._enforce;
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: SubresourceIntegrityEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: SubresourceIntegrityEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._blockedCount = 0;
  }

  private isValidBase64(value: string): boolean {
    if (value.length === 0) return false;
    if (value.length % 4 === 1) return false;
    return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   SHA-256 / SHA-384 / SHA-512 pure-TS digests (FIPS 180-4)
   Node's crypto is preferred at runtime; these are the portable fallback.
   ───────────────────────────────────────────────────────────────────────── */

const MASK32 = (1n << 32n) - 1n;
const MASK64 = (1n << 64n) - 1n;

function rotr32(x: bigint, n: number): bigint {
  return ((x >> BigInt(n)) | (x << BigInt(32 - n))) & MASK32;
}

function rotr64(x: bigint, n: number): bigint {
  return ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK64;
}

const K256: bigint[] = [
  0x428a2f98n, 0x71374491n, 0xb5c0fbcfn, 0xe9b5dba5n, 0x3956c25bn, 0x59f111f1n, 0x923f82a4n, 0xab1c5ed5n,
  0xd807aa98n, 0x12835b01n, 0x243185ben, 0x550c7dc3n, 0x72be5d74n, 0x80deb1fen, 0x9bdc06a7n, 0xc19bf174n,
  0xe49b69c1n, 0xefbe4786n, 0x0fc19dc6n, 0x240ca1ccn, 0x2de92c6fn, 0x4a7484aan, 0x5cb0a9dcn, 0x76f988dan,
  0x983e5152n, 0xa831c66dn, 0xb00327c8n, 0xbf597fc7n, 0xc6e00bf3n, 0xd5a79147n, 0x06ca6351n, 0x14292967n,
  0x27b70a85n, 0x2e1b2138n, 0x4d2c6dfcn, 0x53380d13n, 0x650a7354n, 0x766a0abbn, 0x81c2c92en, 0x92722c85n,
  0xa2bfe8a1n, 0xa81a664bn, 0xc24b8b70n, 0xc76c51a3n, 0xd192e819n, 0xd6990624n, 0xf40e3585n, 0x106aa070n,
  0x19a4c116n, 0x1e376c08n, 0x2748774cn, 0x34b0bcb5n, 0x391c0cb3n, 0x4ed8aa4an, 0x5b9cca4fn, 0x682e6ff3n,
  0x748f82een, 0x78a5636fn, 0x84c87814n, 0x8cc70208n, 0x90befffan, 0xa4506cebn, 0xbef9a3f7n, 0xc67178f2n,
];

const K512: bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const IV256: bigint[] = [
  0x6a09e667n, 0xbb67ae85n, 0x3c6ef372n, 0xa54ff53an,
  0x510e527fn, 0x9b05688cn, 0x1f83d9abn, 0x5be0cd19n,
];

const IV512: bigint[] = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

function bytesToWords(bytes: Uint8Array, wordBits: 32 | 64): bigint[] {
  const byteLen = wordBits / 8;
  const words: bigint[] = [];
  let current = 0n;
  let count = 0;
  for (let i = 0; i < bytes.length; i++) {
    current = (current << 8n) | BigInt(bytes[i]);
    count++;
    if (count === byteLen) {
      words.push(current & (wordBits === 32 ? MASK32 : MASK64));
      current = 0n;
      count = 0;
    }
  }
  return words;
}

function sha256Core(input: Uint8Array): Uint8Array {
  const padding = padMessage(input, 64, 8);
  const words = bytesToWords(padding, 32);
  let h = [...IV256];
  for (let chunk = 0; chunk < words.length; chunk += 16) {
    const w: bigint[] = [];
    for (let t = 0; t < 16; t++) w.push(words[chunk + t]);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr32(w[t - 15], 7) ^ rotr32(w[t - 15], 18) ^ (w[t - 15] >> 3n);
      const s1 = rotr32(w[t - 2], 17) ^ rotr32(w[t - 2], 19) ^ (w[t - 2] >> 10n);
      w.push((w[t - 16] + s0 + w[t - 7] + s1) & MASK32);
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K256[t] + w[t]) & MASK32;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK32;
      hh = g; g = f; f = e;
      e = (d + temp1) & MASK32;
      d = c; c = b; b = a;
      a = (temp1 + temp2) & MASK32;
    }
    h = [
      (h[0] + a) & MASK32, (h[1] + b) & MASK32, (h[2] + c) & MASK32, (h[3] + d) & MASK32,
      (h[4] + e) & MASK32, (h[5] + f) & MASK32, (h[6] + g) & MASK32, (h[7] + hh) & MASK32,
    ];
  }
  return wordsToBytes(h, 4);
}

function sha512Core(input: Uint8Array): Uint8Array {
  const padding = padMessage(input, 128, 16);
  const words = bytesToWords(padding, 64);
  let h = [...IV512];
  for (let chunk = 0; chunk < words.length; chunk += 80) {
    const w: bigint[] = [];
    for (let t = 0; t < 16; t++) w.push(words[chunk + t]);
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(w[t - 15], 1) ^ rotr64(w[t - 15], 8) ^ (w[t - 15] >> 7n);
      const s1 = rotr64(w[t - 2], 19) ^ rotr64(w[t - 2], 61) ^ (w[t - 2] >> 6n);
      w.push((w[t - 16] + s0 + w[t - 7] + s1) & MASK64);
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 80; t++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K512[t] + w[t]) & MASK64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) & MASK64;
      hh = g; g = f; f = e;
      e = (d + temp1) & MASK64;
      d = c; c = b; b = a;
      a = (temp1 + temp2) & MASK64;
    }
    h = [
      (h[0] + a) & MASK64, (h[1] + b) & MASK64, (h[2] + c) & MASK64, (h[3] + d) & MASK64,
      (h[4] + e) & MASK64, (h[5] + f) & MASK64, (h[6] + g) & MASK64, (h[7] + hh) & MASK64,
    ];
  }
  return wordsToBytes(h, 8);
}

function padMessage(input: Uint8Array, blockSize: number, lengthBytes: number): Uint8Array {
  const bitLen = BigInt(input.length) * 8n;
  const paddedLength = input.length + 1;
  const total = Math.ceil((paddedLength + lengthBytes) / blockSize) * blockSize;
  const out = new Uint8Array(total);
  out.set(input);
  out[input.length] = 0x80;
  for (let i = 0; i < lengthBytes; i++) {
    out[total - 1 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  }
  return out;
}

function wordsToBytes(words: bigint[], wordBytes: number): Uint8Array {
  const out = new Uint8Array(words.length * wordBytes);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    for (let j = 0; j < wordBytes; j++) {
      out[i * wordBytes + (wordBytes - 1 - j)] = Number((w >> BigInt(j * 8)) & 0xffn);
    }
  }
  return out;
}

function shaDigest(algorithm: IntegrityAlgorithm, content: Uint8Array): Uint8Array {
  try {
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return new Uint8Array(nodeCrypto.createHash(algorithm).update(content).digest());
  } catch {
    const digest = algorithm === 'sha256' ? sha256Core(content) : sha512Core(content);
    if (algorithm === 'sha384') {
      return digest.slice(0, 48);
    }
    return digest;
  }
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += BASE64_CHARS[b0 >> 2];
    out += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return out;
}

export { SubresourceIntegrityService, SUPPORTED_ALGORITHMS, bytesToBase64 };
export type { ISubresourceIntegrityService, IntegrityAlgorithm, IntegrityHash, IntegrityVerificationResult, IntegrityVerificationState, SubresourceIntegrityEvent, SubresourceIntegrityEventKind, SubresourceIntegrityEventHandler };
