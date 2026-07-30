import type { IDisposable } from '../../app/dependency-container';
import { NovaSessionStorage } from '../storage/session-storage';

interface ISessionStorageService extends IDisposable {
  get length(): number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  clear(): void;
  setOrigin(origin: string): void;
  getOrigin(): string;
  getTabId(): string;
  onEvent(handler: SessionStorageEventHandler): () => void;
}

type SessionStorageEventKind = 'change' | 'quota-exceeded';
type SessionStorageEventHandler = (event: SessionStorageEvent) => void;

interface SessionStorageEvent {
  readonly kind: SessionStorageEventKind;
  readonly data?: Record<string, unknown>;
}

class SessionStorageService implements ISessionStorageService {
  private _storage: NovaSessionStorage;
  private _origin: string;
  private _handlers = new Set<SessionStorageEventHandler>();

  constructor(origin = 'https://localhost', tabId?: string) {
    this._origin = origin;
    this._storage = new NovaSessionStorage(origin, tabId);
  }

  get length(): number {
    return this._storage.length;
  }

  getItem(key: string): string | null {
    return this._storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    try {
      this._storage.setItem(key, value);
      this.emit({ kind: 'change', data: { key, origin: this._origin } });
    } catch (e) {
      this.emit({ kind: 'quota-exceeded', data: { key, origin: this._origin } });
      throw e;
    }
  }

  removeItem(key: string): void {
    this._storage.removeItem(key);
    this.emit({ kind: 'change', data: { key, origin: this._origin } });
  }

  key(index: number): string | null {
    return this._storage.key(index);
  }

  clear(): void {
    this._storage.clear();
    this.emit({ kind: 'change', data: { origin: this._origin } });
  }

  setOrigin(origin: string): void {
    if (origin !== this._origin) {
      this._storage.dispose();
      this._origin = origin;
      this._storage = new NovaSessionStorage(origin);
    }
  }

  getOrigin(): string {
    return this._origin;
  }

  getTabId(): string {
    return this._storage.getTabId();
  }

  onEvent(handler: SessionStorageEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: SessionStorageEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._storage.dispose();
  }
}

export { SessionStorageService };
export type { ISessionStorageService, SessionStorageEvent, SessionStorageEventKind, SessionStorageEventHandler };
