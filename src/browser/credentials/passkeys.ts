import type { IDisposable } from '../../app/dependency-container';

interface PasskeyRpInfo {
  readonly id: string;
  readonly name: string;
}

interface PasskeyUserInfo {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
}

interface PasskeyCredential {
  readonly id: string;
  readonly rpId: string;
  readonly rpName: string;
  readonly userId: string;
  readonly userName: string;
  readonly userDisplayName: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly privateKey: string;
  signCount: number;
  readonly createdAt: number;
  lastUsedAt: number;
}

interface PasskeyRegistrationOptions {
  readonly rp: PasskeyRpInfo;
  readonly user: PasskeyUserInfo;
  readonly challenge?: string;
}

interface PasskeyAuthenticationOptions {
  readonly rpId: string;
  readonly challenge?: string;
  readonly allowCredentials?: string[];
}

interface PasskeyRegistrationResult {
  readonly credential: PasskeyCredential;
  readonly attestationObject: string;
  readonly clientDataJSON: string;
}

interface PasskeyAuthenticationResult {
  readonly credential: PasskeyCredential;
  readonly authenticatorData: string;
  readonly signature: string;
  readonly clientDataJSON: string;
  readonly userHandle: string;
}

type PasskeyEventKind = 'created' | 'used' | 'deleted';
interface PasskeyEvent {
  readonly kind: PasskeyEventKind;
  readonly credential: PasskeyCredential;
}

type PasskeyEventHandler = (event: PasskeyEvent) => void;

interface IPasskeyManager extends IDisposable {
  createCredential(options: PasskeyRegistrationOptions): Promise<PasskeyRegistrationResult>;
  getCredentials(options: PasskeyAuthenticationOptions): Promise<PasskeyCredential[]>;
  getCredentialsForRp(rpId: string): PasskeyCredential[];
  getCredentialById(id: string): PasskeyCredential | null;
  getAllCredentials(): PasskeyCredential[];
  deleteCredential(id: string): boolean;
  onEvent(handler: PasskeyEventHandler): () => void;
  get size(): number;
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `pk-${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBuffer(arr: Uint8Array): ArrayBuffer {
  return (arr.buffer as ArrayBuffer).slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
}

function canUseSubtle(): boolean {
  return typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined' && crypto.subtle !== null;
}

async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  if (canUseSubtle()) {
    try {
      const kp = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign', 'verify'],
      );
      const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
      const privRaw = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
      return {
        publicKey: bytesToHex(new Uint8Array(pubRaw)),
        privateKey: bytesToHex(new Uint8Array(privRaw)),
      };
    } catch {
      /* fall through */
    }
  }

  const pubBytes = new Uint8Array(64);
  const privBytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(pubBytes);
    crypto.getRandomValues(privBytes);
  } else {
    for (let i = 0; i < 64; i++) pubBytes[i] = Math.floor(Math.random() * 256);
    for (let i = 0; i < 32; i++) privBytes[i] = Math.floor(Math.random() * 256);
  }
  return {
    publicKey: bytesToHex(pubBytes),
    privateKey: bytesToHex(privBytes),
  };
}

async function signChallenge(privateKeyHex: string, challenge: string): Promise<string> {
  if (canUseSubtle()) {
    try {
      const privBytes = hexToBytes(privateKeyHex);
      const key = await crypto.subtle.importKey(
        'pkcs8',
        toBuffer(privBytes),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      );
      const encoder = new TextEncoder();
      const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key,
        toBuffer(encoder.encode(challenge)),
      );
      return bytesToHex(new Uint8Array(sig));
    } catch {
      /* fall through */
    }
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(challenge + privateKeyHex);
  const hash = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    hash[i] = data[i % data.length] ^ ((i * 17 + 0x9e3779b9) & 0xff);
  }
  return bytesToHex(hash);
}

function generateChallenge(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(bytes);
}

class PasskeyManager implements IPasskeyManager {
  private readonly credentials = new Map<string, PasskeyCredential>();
  private readonly handlers = new Set<PasskeyEventHandler>();

  get size(): number { return this.credentials.size; }

  async createCredential(options: PasskeyRegistrationOptions): Promise<PasskeyRegistrationResult> {
    const id = generateId();
    const challenge = options.challenge ?? generateChallenge();
    const now = Date.now();
    const kp = await generateKeyPair();
    const credentialIdBytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(credentialIdBytes);
    } else {
      for (let i = 0; i < 16; i++) credentialIdBytes[i] = Math.floor(Math.random() * 256);
    }
    const credentialId = bytesToHex(credentialIdBytes);

    const credential: PasskeyCredential = {
      id,
      rpId: options.rp.id,
      rpName: options.rp.name,
      userId: options.user.id,
      userName: options.user.name,
      userDisplayName: options.user.displayName,
      credentialId,
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
      signCount: 0,
      createdAt: now,
      lastUsedAt: 0,
    };

    this.credentials.set(id, credential);
    this.emit({ kind: 'created', credential });

    return {
      credential,
      attestationObject: bytesToHex(new Uint8Array(128)),
      clientDataJSON: JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin: options.rp.id,
        crossOrigin: false,
      }),
    };
  }

  async getCredentials(options: PasskeyAuthenticationOptions): Promise<PasskeyCredential[]> {
    const results: PasskeyCredential[] = [];
    for (const cred of this.credentials.values()) {
      if (cred.rpId !== options.rpId) continue;
      if (options.allowCredentials && options.allowCredentials.length > 0) {
        if (!options.allowCredentials.includes(cred.credentialId)) continue;
      }
      results.push(cred);
    }
    return results;
  }

  getCredentialsForRp(rpId: string): PasskeyCredential[] {
    const results: PasskeyCredential[] = [];
    for (const cred of this.credentials.values()) {
      if (cred.rpId === rpId) results.push(cred);
    }
    return results;
  }

  getCredentialById(id: string): PasskeyCredential | null {
    return this.credentials.get(id) ?? null;
  }

  getAllCredentials(): PasskeyCredential[] {
    return [...this.credentials.values()];
  }

  deleteCredential(id: string): boolean {
    const cred = this.credentials.get(id);
    if (!cred) return false;
    this.credentials.delete(id);
    this.emit({ kind: 'deleted', credential: cred });
    return true;
  }

  onEvent(handler: PasskeyEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: PasskeyEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.credentials.clear();
    this.handlers.clear();
  }
}

export {
  PasskeyManager,
  generateKeyPair,
  signChallenge,
  generateChallenge,
  generateId,
};
export type {
  IPasskeyManager,
  PasskeyCredential,
  PasskeyRegistrationOptions,
  PasskeyAuthenticationOptions,
  PasskeyRegistrationResult,
  PasskeyAuthenticationResult,
  PasskeyRpInfo,
  PasskeyUserInfo,
  PasskeyEvent,
  PasskeyEventKind,
  PasskeyEventHandler,
};
