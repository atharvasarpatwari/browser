import type { IDisposable } from '../../app/dependency-container';

type PushPermissionState = 'granted' | 'denied' | 'prompt';

interface IPushManager extends IDisposable {
  subscribe(options?: PushSubscriptionOptions): Promise<PushSubscription>;
  getSubscription(): Promise<PushSubscription | null>;
  permissionState(): Promise<PushPermissionState>;
  onEvent(handler: PushEventHandler): () => void;
}

interface PushSubscriptionOptions {
  userVisibleOnly?: boolean;
  applicationServerKey?: BufferSource | string;
}

interface PushSubscription {
  readonly endpoint: string;
  readonly options: PushSubscriptionOptions;
  readonly expirationTime: number | null;
  getKey(name: 'p256dh' | 'auth'): ArrayBuffer | null;
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

interface PushSubscriptionJSON {
  readonly endpoint: string;
  readonly keys: Record<string, string>;
}

interface PushEvent {
  readonly kind: PushEventKind;
  readonly data?: Record<string, unknown>;
}

type PushEventKind = 'subscribe' | 'unsubscribe' | 'push' | 'error';
type PushEventHandler = (event: PushEvent) => void;

class PushManager implements IPushManager {
  private _subscription: PushSubscription | null = null;
  private _permission: PushPermissionState = 'prompt';
  private _handlers = new Set<PushEventHandler>();

  async subscribe(options?: PushSubscriptionOptions): Promise<PushSubscription> {
    if (this._permission === 'denied') {
      throw new Error('Push permission denied');
    }
    this._permission = 'granted';
    const endpoint = `https://push.example.com/push/${Date.now()}`;
    const key = new Uint8Array(65);
    const auth = new Uint8Array(16);

    const sub: PushSubscription = {
      endpoint,
      options: options ?? {},
      expirationTime: null,
      getKey(name: 'p256dh' | 'auth'): ArrayBuffer | null {
        return name === 'p256dh' ? key.buffer : name === 'auth' ? auth.buffer : null;
      },
      toJSON(): PushSubscriptionJSON {
        return {
          endpoint,
          keys: { p256dh: 'base64encodedkey', auth: 'base64encodedauth' },
        };
      },
      unsubscribe: async () => {
        this._subscription = null;
        this.emit({ kind: 'unsubscribe' });
        return true;
      },
    };

    this._subscription = sub;
    this.emit({ kind: 'subscribe', data: { endpoint } });
    return sub;
  }

  async getSubscription(): Promise<PushSubscription | null> {
    return this._subscription;
  }

  async permissionState(): Promise<PushPermissionState> {
    return this._permission;
  }

  onEvent(handler: PushEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: PushEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._subscription = null;
    this._handlers.clear();
  }
}

export { PushManager };
export type { IPushManager, PushSubscription, PushSubscriptionOptions, PushSubscriptionJSON, PushPermissionState, PushEvent, PushEventKind, PushEventHandler };
