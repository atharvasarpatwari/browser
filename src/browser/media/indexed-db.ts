import type { IDisposable } from '../../app/dependency-container';
import { IDBFactory, InMemoryIndexedDBBackend } from '../storage/indexed-db';
import type { IIndexedDBBackend, IDBRequest, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBKeyRange, IDBTransactionMode } from '../storage/indexed-db';

interface IIndexedDBService extends IDisposable {
  open(name: string, version?: number): IDBRequest;
  deleteDatabase(name: string): IDBRequest;
  databases(): IDBRequest;
  cmp(a: unknown, b: unknown): number;
  setOrigin(origin: string): void;
  getOrigin(): string;
  onEvent(handler: IndexedDBEventHandler): () => void;
}

type IndexedDBEventKind = 'open' | 'delete' | 'error';
type IndexedDBEventHandler = (event: IndexedDBEvent) => void;

interface IndexedDBEvent {
  readonly kind: IndexedDBEventKind;
  readonly data?: Record<string, unknown>;
}

class IndexedDBService implements IIndexedDBService {
  private _factory: IDBFactory;
  private _origin: string;
  private _backend: IIndexedDBBackend;
  private _handlers = new Set<IndexedDBEventHandler>();

  constructor(origin = 'https://localhost', backend?: IIndexedDBBackend) {
    this._origin = origin;
    this._backend = backend ?? new InMemoryIndexedDBBackend();
    this._factory = new IDBFactory(this._backend, this._origin);
  }

  open(name: string, version?: number): IDBRequest {
    const req = this._factory.open(name, version);
    this.emit({ kind: 'open', data: { name, origin: this._origin } });
    return req;
  }

  deleteDatabase(name: string): IDBRequest {
    const req = this._factory.deleteDatabase(name);
    this.emit({ kind: 'delete', data: { name, origin: this._origin } });
    return req;
  }

  databases(): IDBRequest {
    return this._factory.databases();
  }

  cmp(a: unknown, b: unknown): number {
    return this._factory.cmp(a, b);
  }

  setOrigin(origin: string): void {
    if (origin !== this._origin) {
      this._origin = origin;
      this._factory = new IDBFactory(this._backend, origin);
    }
  }

  getOrigin(): string {
    return this._origin;
  }

  onEvent(handler: IndexedDBEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: IndexedDBEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { IndexedDBService };
export type { IIndexedDBService, IndexedDBEvent, IndexedDBEventKind, IndexedDBEventHandler, IDBRequest, IDBDatabase, IDBTransaction, IDBObjectStore, IDBIndex, IDBCursor, IDBKeyRange, IDBTransactionMode };
