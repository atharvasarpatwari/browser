import type { IDisposable } from '../../app/dependency-container';
import { loadNodeBuiltin } from './node-builtins';
import { encodeUtf8, encodeUtf16Le, bytesToBase64, concatBytes, hexFromBytes, hexToBytes, writeAscii } from './byte-codecs';

enum AuthScheme {
  Basic    = 'Basic',
  Digest   = 'Digest',
  Bearer   = 'Bearer',
  Ntlm     = 'NTLM',
  Negotiate = 'Negotiate',
}

interface AuthCredentials {
  readonly username: string;
  readonly password: string;
}

interface AuthChallenge {
  readonly scheme: AuthScheme;
  readonly realm: string;
  readonly params: ReadonlyMap<string, string>;
  readonly raw: string;
}

interface IHttpAuthenticator extends IDisposable {
  canHandle(challenge: string): boolean;
  parseChallenge(header: string): AuthChallenge | null;
  generateResponse(challenge: AuthChallenge, credentials: AuthCredentials, method: string, uri: string): string;
  clearCache(): void;
}

class HttpAuthenticator implements IHttpAuthenticator {
  private nonceCounters = new Map<string, number>();

  private crypto(): typeof import('node:crypto') | null {
    return loadNodeBuiltin<typeof import('node:crypto')>('node:crypto');
  }

  canHandle(challenge: string): boolean {
    const s = this.peekScheme(challenge);
    return s === AuthScheme.Digest || s === AuthScheme.Basic || s === AuthScheme.Bearer || s === AuthScheme.Ntlm || s === AuthScheme.Negotiate;
  }

  parseChallenge(header: string): AuthChallenge | null {
    if (!header) return null;
    const scheme = this.peekScheme(header);
    if (!scheme) return null;

    const rest = header.slice(scheme.length).trim();
    const params = new Map<string, string>();

    if (scheme === AuthScheme.Basic || scheme === AuthScheme.Bearer) {
      const realm = this.extractParam(rest, 'realm') ?? rest;
      const token = this.extractParam(rest, 'token');
      if (scheme === AuthScheme.Bearer && !token) {
        params.set('token', realm);
      }
      params.set('realm', realm);
      return { scheme, realm, params, raw: header };
    }

    let realm = '';
    let current = rest;
    while (current.length > 0) {
      const eqIdx = current.indexOf('=');
      if (eqIdx === -1) break;
      const key = current.slice(0, eqIdx).trim().toLowerCase();
      current = current.slice(eqIdx + 1).trim();
      let value: string;
      if (current.startsWith('"')) {
        const closeIdx = current.indexOf('"', 1);
        if (closeIdx === -1) { value = current.slice(1); current = ''; }
        else { value = current.slice(1, closeIdx); current = current.slice(closeIdx + 1).trim(); }
      } else {
        const commaIdx = current.indexOf(',');
        if (commaIdx === -1) { value = current; current = ''; }
        else { value = current.slice(0, commaIdx); current = current.slice(commaIdx + 1).trim(); }
      }
      if (key === 'realm') realm = value;
      params.set(key, value);
      if (current.startsWith(',')) current = current.slice(1).trim();
    }

    return { scheme, realm, params, raw: header };
  }

  generateResponse(challenge: AuthChallenge, credentials: AuthCredentials, method: string, uri: string): string {
    switch (challenge.scheme) {
      case AuthScheme.Basic:
        return this.generateBasic(credentials);
      case AuthScheme.Digest:
        return this.generateDigest(challenge, credentials, method, uri);
      case AuthScheme.Bearer:
        return this.generateBearer(challenge);
      case AuthScheme.Ntlm:
        return this.generateNtlm(challenge, credentials);
      case AuthScheme.Negotiate:
        return this.generateNegotiate(challenge, credentials);
      default:
        throw new AuthError(`Unsupported auth scheme: ${challenge.scheme}`);
    }
  }

  clearCache(): void {
    this.nonceCounters.clear();
  }

  private generateBasic(credentials: AuthCredentials): string {
    const encoded = bytesToBase64(encodeUtf8(`${credentials.username}:${credentials.password}`));
    return `Basic ${encoded}`;
  }

  private generateDigest(challenge: AuthChallenge, credentials: AuthCredentials, method: string, uri: string): string {
    const realm = challenge.params.get('realm') ?? '';
    const nonce = challenge.params.get('nonce') ?? '';
    const opaque = challenge.params.get('opaque') ?? '';
    const qop = challenge.params.get('qop') ?? '';
    const algorithm = challenge.params.get('algorithm') ?? 'MD5';

    const nc = this.nextNonceCount(nonce);
    const cnonce = this.generateCnonce();

    const ha1 = this.md5(`${credentials.username}:${realm}:${credentials.password}`);
    let ha2: string;
    if (qop.includes('auth-int')) {
      const bodyHash = this.md5('');
      ha2 = this.md5(`${method}:${uri}:${bodyHash}`);
    } else {
      ha2 = this.md5(`${method}:${uri}`);
    }

    let response: string;
    if (qop.includes('auth') || qop.includes('auth-int')) {
      response = this.md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    } else {
      response = this.md5(`${ha1}:${nonce}:${ha2}`);
    }

    const parts: string[] = [
      `username="${credentials.username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `response="${response}"`,
    ];

    if (opaque) parts.push(`opaque="${opaque}"`);
    if (qop) parts.push(`qop=auth`);
    if (nc) parts.push(`nc=${nc}`);
    if (cnonce) parts.push(`cnonce="${cnonce}"`);
    if (algorithm !== 'MD5') parts.push(`algorithm=${algorithm}`);

    return `Digest ${parts.join(', ')}`;
  }

  private generateBearer(challenge: AuthChallenge): string {
    const token = challenge.params.get('token') ?? challenge.realm;
    // If the token value includes quotes or param syntax, extract just the value
    const cleanToken = token.replace(/^token\s*=\s*"?|"$/gi, '').trim();
    return `Bearer ${cleanToken}`;
  }

  private generateNtlm(_challenge: AuthChallenge, credentials: AuthCredentials): string {
    const type1 = this.buildNtlmType1();
    const type3 = this.buildNtlmType3(credentials);
    return `NTLM ${type3}`;

    // Store type1 for multi-step handshake
    this.lastNtlmType1 = type1;
  }

  private generateNegotiate(_challenge: AuthChallenge, credentials: AuthCredentials): string {
    return this.generateNtlm(_challenge, credentials);
  }

  private lastNtlmType1 = '';

  private buildNtlmType1(): string {
    const msg = new Uint8Array(16);
    const view = new DataView(msg.buffer);
    writeAscii(msg, 'NTLMSSP', 0);
    msg[7] = 0;
    view.setUint32(8, 1, true);
    view.setUint32(12, 0x8202, true);
    return bytesToBase64(msg);
  }

  private buildNtlmType3(credentials: AuthCredentials): string {
    const domain = '';
    const username = credentials.username;
    const password = credentials.password;
    const hostname = 'NOVA';

    const usBytes = encodeUtf16Le(username);
    const domBytes = encodeUtf16Le(domain);
    const hostBytes = encodeUtf16Le(hostname);
    const lmHash = this.ntlmHash(password);
    const ntHash = this.ntlmv2Hash(password, username, domain);
    const lmResp = new Uint8Array(24);
    lmResp.set(lmHash.subarray(0, Math.min(lmHash.length, 24)));
    const ntResp = ntHash;

    const payloadOffset = 64 + 24 + ntResp.length + domBytes.length + usBytes.length + hostBytes.length;
    const msg = new Uint8Array(payloadOffset);
    const view = new DataView(msg.buffer);

    let offset = 0;
    writeAscii(msg, 'NTLMSSP', offset);
    msg[offset + 7] = 0;
    view.setUint32(offset + 8, 3, true);
    offset += 12;

    // Security-buffer offsets point into the payload area that follows the
    // 64-byte message header. Regions are contiguous and fully within bounds.
    const lmDataStart = 64;
    const ntDataStart = lmDataStart + 24;
    const domDataStart = ntDataStart + ntResp.length;
    const usDataStart = domDataStart + domBytes.length;
    const hostDataStart = usDataStart + usBytes.length;

    const addField = (len: number, dataStart: number) => {
      view.setUint16(offset, len, true); offset += 2;
      view.setUint16(offset, len, true); offset += 2;
      view.setUint32(offset, dataStart, true); offset += 4;
    };

    addField(Math.min(lmResp.length, 24), lmDataStart);
    addField(ntResp.length, ntDataStart);
    addField(domBytes.length, domDataStart);
    addField(usBytes.length, usDataStart);
    addField(hostBytes.length, hostDataStart);
    addField(0, payloadOffset);
    offset = payloadOffset;

    msg.set(lmResp.subarray(0, Math.min(lmResp.length, 24)), lmDataStart);
    msg.set(ntResp, ntDataStart);
    msg.set(domBytes, domDataStart);
    msg.set(usBytes, usDataStart);
    msg.set(hostBytes, hostDataStart);

    return bytesToBase64(msg);
  }

  private ntlmHash(password: string): Uint8Array {
    try {
      const crypto = this.crypto();
      if (!crypto) throw new Error('crypto unavailable');
      return crypto.createHash('md4').update(encodeUtf16Le(password)).digest();
    } catch {
      return this.md4Fallback(password);
    }
  }

  private ntlmv2Hash(password: string, username: string, domain: string): Uint8Array {
    try {
      const crypto = this.crypto();
      if (!crypto) throw new Error('crypto unavailable');
      const hash = this.ntlmHash(password);
      const hmac = crypto.createHmac('md5', hash);
      return hmac.update(encodeUtf16Le(username.toUpperCase() + domain)).digest();
    } catch {
      const hash = this.ntlmHash(password);
      const inner = this.md5(`-----BEGIN NTLM-----${username.toUpperCase()}${domain}-----END NTLM-----`);
      const outerData = concatBytes([hash, hexToBytes(inner)]);
      const crypto = this.crypto();
      if (!crypto) throw new AuthError('crypto unavailable for NTLM fallback hash');
      return crypto.createHash('md5').update(outerData).digest();
    }
  }

  private md4Fallback(password: string): Uint8Array {
    const buf = encodeUtf16Le(password);
    const data = Array.from(buf);
    const len = data.length;
    const bitLen = len * 8;

    const pad = 64 - ((len + 8) % 64 || 64);
    const total = len + pad + 8;
    const msg = new Uint32Array(Math.ceil(total / 4));

    for (let i = 0; i < len; i++) {
      msg[i >> 2] |= data[i]! << ((i % 4) * 8);
    }
    msg[len >> 2] |= 0x80 << ((len % 4) * 8);
    msg[msg.length - 2] = bitLen & 0xFFFFFFFF;
    msg[msg.length - 1] = Math.floor(bitLen / 0x100000000);

    let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;

    const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
    const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
    const H = (x: number, y: number, z: number) => x ^ y ^ z;

    const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

    for (let i = 0; i < msg.length; i += 16) {
      const X = Array.from({ length: 16 }, (_, j) => msg[i + j]!);
      const AA = a, BB = b, CC = c, DD = d;

      for (let j = 0; j < 48; j++) {
        const k = j < 16 ? j : (j < 32 ? (5 * j + 1) % 16 : (3 * j + 5) % 16);
        const f = j < 16 ? F(b, c, d) : (j < 32 ? G(b, c, d) : H(b, c, d));
        const s = [3, 7, 11, 19][j % 4];
        a = d; d = c; c = b;
        b = b + rotl(a + f + X[k]!, s) | 0;
      }

      a = (a + AA) | 0; b = (b + BB) | 0; c = (c + CC) | 0; d = (d + DD) | 0;
    }

    const result = new Uint32Array([a, b, c, d]);
    const bufOut = new Uint8Array(16);
    const view = new DataView(bufOut.buffer);
    view.setUint32(0, result[0]!, true);
    view.setUint32(4, result[1]!, true);
    view.setUint32(8, result[2]!, true);
    view.setUint32(12, result[3]!, true);
    return bufOut;
  }

  private extractParam(input: string, name: string): string | null {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s*=\\s*(?:"([^"]*)"|([^\\s,]*))`, 'i');
    const m = re.exec(input);
    if (!m) return null;
    return (m[1] ?? m[2] ?? '').trim() || null;
  }

  private peekScheme(header: string): AuthScheme | null {
    const trimmed = header.trim();
    if (trimmed.startsWith('Digest ')) return AuthScheme.Digest;
    if (trimmed.startsWith('Basic ')) return AuthScheme.Basic;
    if (trimmed.startsWith('Bearer ')) return AuthScheme.Bearer;
    if (trimmed.startsWith('NTLM ')) return AuthScheme.Ntlm;
    if (trimmed.startsWith('Negotiate ')) return AuthScheme.Negotiate;
    if (trimmed === 'Basic' || trimmed.startsWith('Basic,')) return AuthScheme.Basic;
    if (trimmed === 'Digest' || trimmed.startsWith('Digest,')) return AuthScheme.Digest;
    return null;
  }

  private nextNonceCount(nonce: string): string {
    const count = (this.nonceCounters.get(nonce) ?? 0) + 1;
    this.nonceCounters.set(nonce, count);
    return count.toString(16).padStart(8, '0');
  }

  private generateCnonce(): string {
    const crypto = this.crypto();
    return crypto ? hexFromBytes(new Uint8Array(crypto.randomBytes(8))) : this.randomHexFallback(8);
  }

  private md5(data: string): string {
    const crypto = this.crypto();
    if (!crypto) throw new AuthError('crypto unavailable for digest computation');
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private randomHexFallback(numBytes: number): string {
    let out = '';
    for (let i = 0; i < numBytes; i++) {
      out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    }
    return out;
  }

  dispose(): void {
    this.nonceCounters.clear();
  }
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export {
  HttpAuthenticator,
  AuthScheme,
  AuthError,
};
export type { IHttpAuthenticator, AuthCredentials, AuthChallenge };
