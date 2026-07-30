import type { IDisposable } from '../../app/dependency-container';

interface IMediaKeySystemAccess {
  readonly keySystem: string;
  getConfiguration(): MediaKeySystemConfiguration;
  createMediaKeys(): Promise<IMediaKeys>;
}

interface IMediaKeys extends IDisposable {
  createSession(sessionType?: MediaKeySessionType): IMediaKeySession;
  setServerCertificate(certificate: ArrayBuffer): Promise<boolean>;
}

interface IMediaKeySession extends IDisposable {
  generateRequest(initDataType: string, initData: ArrayBuffer): Promise<void>;
  load(sessionId: string): Promise<boolean>;
  update(response: ArrayBuffer): Promise<void>;
  close(): Promise<void>;
  remove(): Promise<void>;
  get sessionId(): string;
  get expiration(): number;
  get closed(): Promise<void>;
  get keyStatuses(): Map<string, MediaKeyStatus>;
  onEvent(handler: MediaKeySessionEventHandler): () => void;
}

type MediaKeySessionType = 'temporary' | 'persistent-license';
type MediaKeyStatus = 'usable' | 'expired' | 'output-downscaled' | 'output-not-allowed' | 'status-pending' | 'internal-error';

interface MediaKeySystemConfiguration {
  readonly initDataTypes: string[];
  readonly audioCapabilities: MediaKeySystemMediaCapability[];
  readonly videoCapabilities: MediaKeySystemMediaCapability[];
  readonly distinctiveIdentifier: 'required' | 'optional' | 'not-allowed';
  readonly persistentState: 'required' | 'optional' | 'not-allowed';
  readonly sessionTypes: MediaKeySessionType[];
  readonly label: string;
}

interface MediaKeySystemMediaCapability {
  readonly contentType: string;
  readonly robustness: string;
}

type MediaKeySessionEventKind = 'message' | 'keystatuseschange' | 'error';
interface MediaKeySessionEvent {
  readonly kind: MediaKeySessionEventKind;
  readonly session: IMediaKeySession;
  readonly data?: Record<string, unknown>;
}
type MediaKeySessionEventHandler = (event: MediaKeySessionEvent) => void;

const SUPPORTED_KEY_SYSTEMS: Record<string, { initDataTypes: string[]; audio: string[]; video: string[] }> = {
  'com.widevine.alpha': {
    initDataTypes: ['keyids', 'cenc'],
    audio: ['audio/mp4; codecs="mp4a.40.2"', 'audio/webm; codecs="vorbis"'],
    video: ['video/mp4; codecs="avc1.4D401E"', 'video/webm; codecs="vp9"'],
  },
  'com.microsoft.playready': {
    initDataTypes: ['keyids', 'cenc'],
    audio: ['audio/mp4; codecs="mp4a.40.2"'],
    video: ['video/mp4; codecs="avc1.4D401E"'],
  },
  'org.w3.clearkey': {
    initDataTypes: ['keyids', 'cenc'],
    audio: ['audio/mp4; codecs="mp4a.40.2"', 'audio/webm; codecs="vorbis"'],
    video: ['video/mp4; codecs="avc1.4D401E"', 'video/webm; codecs="vp9"'],
  },
};

function isKeySystemSupported(keySystem: string, configuration: MediaKeySystemConfiguration): boolean {
  const ks = SUPPORTED_KEY_SYSTEMS[keySystem];
  if (!ks) return false;
  for (const dt of configuration.initDataTypes) {
    if (!ks.initDataTypes.includes(dt)) return false;
  }
  for (const cap of configuration.audioCapabilities) {
    if (!ks.audio.some(c => cap.contentType.startsWith(c.split(';')[0]))) return false;
  }
  for (const cap of configuration.videoCapabilities) {
    if (!ks.video.some(c => cap.contentType.startsWith(c.split(';')[0]))) return false;
  }
  return true;
}

let sessionCounter = 0;

class MediaKeySessionImpl implements IMediaKeySession {
  private _sessionId: string;
  private _expiration = Infinity;
  private _keyStatuses = new Map<string, MediaKeyStatus>();
  private _closed = false;
  private _closePromise: Promise<void>;
  private _resolveClose!: () => void;
  private handlers = new Set<MediaKeySessionEventHandler>();

  constructor() {
    this._sessionId = `session-${++sessionCounter}`;
    this._closePromise = new Promise(resolve => { this._resolveClose = resolve; });
  }

  get sessionId(): string { return this._sessionId; }
  get expiration(): number { return this._expiration; }
  get closed(): Promise<void> { return this._closePromise; }
  get keyStatuses(): Map<string, MediaKeyStatus> { return new Map(this._keyStatuses); }

  async generateRequest(initDataType: string, initData: ArrayBuffer): Promise<void> {
    const keyId = this.arrayBufferToHex(initData.slice(0, 16));
    this._keyStatuses.set(keyId, 'status-pending');
    this.emit({ kind: 'message', session: this, data: { initDataType, messageType: 'license-request' } });
    setTimeout(() => {
      this._keyStatuses.set(keyId, 'usable');
      this.emit({ kind: 'keystatuseschange', session: this });
    }, 100);
  }

  async load(sessionId: string): Promise<boolean> {
    return sessionId === this._sessionId;
  }

  async update(response: ArrayBuffer): Promise<void> {
    for (const [keyId] of this._keyStatuses) {
      if (this._keyStatuses.get(keyId) === 'status-pending') {
        this._keyStatuses.set(keyId, 'usable');
      }
    }
    this.emit({ kind: 'keystatuseschange', session: this });
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._resolveClose();
  }

  async remove(): Promise<void> {
    this._keyStatuses.clear();
    this.emit({ kind: 'keystatuseschange', session: this });
  }

  onEvent(handler: MediaKeySessionEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: MediaKeySessionEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  private arrayBufferToHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  dispose(): void {
    this._keyStatuses.clear();
    this.handlers.clear();
    this._closed = true;
    this._resolveClose();
  }
}

class MediaKeys implements IMediaKeys {
  private keySystem: string;
  private _certificate: ArrayBuffer | null = null;
  private sessions = new Set<MediaKeySessionImpl>();

  constructor(keySystem: string) {
    this.keySystem = keySystem;
  }

  createSession(sessionType: MediaKeySessionType = 'temporary'): IMediaKeySession {
    const session = new MediaKeySessionImpl();
    this.sessions.add(session);
    return session;
  }

  async setServerCertificate(certificate: ArrayBuffer): Promise<boolean> {
    this._certificate = certificate;
    return true;
  }

  dispose(): void {
    for (const s of this.sessions) s.dispose();
    this.sessions.clear();
    this._certificate = null;
  }
}

class MediaKeySystemAccessImpl implements IMediaKeySystemAccess {
  readonly keySystem: string;
  private configuration: MediaKeySystemConfiguration;

  constructor(keySystem: string, configuration: MediaKeySystemConfiguration) {
    this.keySystem = keySystem;
    this.configuration = configuration;
  }

  getConfiguration(): MediaKeySystemConfiguration {
    return { ...this.configuration };
  }

  async createMediaKeys(): Promise<IMediaKeys> {
    return new MediaKeys(this.keySystem);
  }
}

function requestMediaKeySystemAccess(keySystem: string, configurations: MediaKeySystemConfiguration[]): Promise<IMediaKeySystemAccess> {
  for (const config of configurations) {
    if (isKeySystemSupported(keySystem, config)) {
      return Promise.resolve(new MediaKeySystemAccessImpl(keySystem, config));
    }
  }
  return Promise.reject(new Error(`None of the configurations are supported for key system: ${keySystem}`));
}

export { MediaKeys, MediaKeySessionImpl, MediaKeySystemAccessImpl, requestMediaKeySystemAccess, isKeySystemSupported, SUPPORTED_KEY_SYSTEMS };
export type { IMediaKeySystemAccess, IMediaKeys, IMediaKeySession, MediaKeySessionType, MediaKeyStatus, MediaKeySystemConfiguration, MediaKeySystemMediaCapability, MediaKeySessionEvent, MediaKeySessionEventKind, MediaKeySessionEventHandler };
