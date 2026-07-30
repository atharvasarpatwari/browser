import type { IDisposable } from '../../app/dependency-container';
import { NovaLocalStorage, InMemoryStorageBackend } from '../storage/local-storage';
import type { IStorageBackend } from '../storage/local-storage';

interface ILocalStorageService extends IDisposable {
  get length(): number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  clear(): void;
  setOrigin(origin: string): void;
  getOrigin(): string;
  onEvent(handler: LocalStorageEventHandler): () => void;
}

type LocalStorageEventKind = 'change' | 'quota-exceeded';
type LocalStorageEventHandler = (event: LocalStorageEvent) => void;

interface LocalStorageEvent {
  readonly kind: LocalStorageEventKind;
  readonly data?: Record<string, unknown>;
}

class LocalStorageService implements ILocalStorageService {
  private _storage: NovaLocalStorage;
  private _backend: IStorageBackend;
  private _origin: string;
  private _handlers = new Set<LocalStorageEventHandler>();

  constructor(origin = 'https://localhost', backend?: IStorageBackend) {
    this._origin = origin;
    this._backend = backend ?? new InMemoryStorageBackend();
    this._storage = new NovaLocalStorage(origin, this._backend);
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
      this._storage = new NovaLocalStorage(origin, this._backend);
    }
  }

  getOrigin(): string {
    return this._origin;
  }

  onEvent(handler: LocalStorageEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: LocalStorageEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._storage.dispose();
  }
}

export { LocalStorageService };
export type { ILocalStorageService, LocalStorageEvent, LocalStorageEventKind, LocalStorageEventHandler };
