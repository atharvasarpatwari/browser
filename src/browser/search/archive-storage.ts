/**
 * Where the archive lives: a set of small records (see archive-shards.ts), changed in atomic batches. Earlier versions
 * kept the whole index as one record; that snapshot is only ever read, once, to migrate it.
 */
interface IIndexStorage {
  /** The single-record snapshot written before the archive was sharded, or `null` when there is none. */
  loadLegacy(): Promise<string | null>;
  /** The ids of every record. */
  list(): Promise<string[]>;
  read(id: string): Promise<string | null>;
  /**
   * One atomic batch: a string writes the record, `null` deletes it. `dropLegacy` also deletes the legacy snapshot in
   * the same batch, so a migration is all or nothing.
   */
  commit(changes: ReadonlyArray<readonly [id: string, data: string | null]>, dropLegacy?: boolean): Promise<void>;
  /** Every record and the legacy snapshot. */
  clear(): Promise<void>;
}

class MemoryIndexStorage implements IIndexStorage {
  /** The legacy snapshot; assign it to stage an archive written before sharding. */
  legacy: string | null = null;
  readonly records = new Map<string, string>();

  async loadLegacy(): Promise<string | null> { return this.legacy; }
  async list(): Promise<string[]> { return [...this.records.keys()]; }
  async read(id: string): Promise<string | null> { return this.records.get(id) ?? null; }
  async commit(changes: ReadonlyArray<readonly [string, string | null]>, dropLegacy = false): Promise<void> {
    for (const [id, data] of changes) {
      if (data === null) this.records.delete(id);
      else this.records.set(id, data);
    }
    if (dropLegacy) this.legacy = null;
  }
  async clear(): Promise<void> {
    this.records.clear();
    this.legacy = null;
  }
}

const STORE = 'kv';

/**
 * Persists the archive in IndexedDB (no practical size limit, unlike localStorage's ~5-10 MB). One object store: the
 * legacy snapshot lives under `key`, every record under `key/<id>`, so several archives can share a database.
 */
class IndexedDbIndexStorage implements IIndexStorage {
  private db: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory | null = typeof indexedDB !== 'undefined' ? indexedDB : null,
    private readonly dbName = 'nova-search-archive',
    private readonly key = 'snapshot',
  ) {}

  private open(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    const factory = this.factory;
    if (!factory) return Promise.reject(new Error('IndexedDB is unavailable'));
    this.db = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(this.dbName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    this.db.catch(() => { this.db = null; }); // allow a later retry
    return this.db;
  }

  private recordKey(id: string): string { return `${this.key}/${id}`; }

  private async request<T>(make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const req = make(db.transaction(STORE, 'readonly').objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  async loadLegacy(): Promise<string | null> {
    const value = await this.request((store) => store.get(this.key));
    return typeof value === 'string' ? value : null;
  }

  async list(): Promise<string[]> {
    const prefix = `${this.key}/`;
    const keys = await this.request((store) => store.getAllKeys());
    return keys.filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  async read(id: string): Promise<string | null> {
    const value = await this.request((store) => store.get(this.recordKey(id)));
    return typeof value === 'string' ? value : null;
  }

  private async write(work: (store: IDBObjectStore) => void, action: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error(`IndexedDB ${action} failed`));
      tx.onabort = () => reject(tx.error ?? new Error(`IndexedDB ${action} aborted`));
    });
  }

  commit(changes: ReadonlyArray<readonly [string, string | null]>, dropLegacy = false): Promise<void> {
    return this.write((store) => {
      for (const [id, data] of changes) {
        if (data === null) store.delete(this.recordKey(id));
        else store.put(data, this.recordKey(id));
      }
      if (dropLegacy) store.delete(this.key);
    }, 'write');
  }

  clear(): Promise<void> {
    const prefix = `${this.key}/`;
    return this.write((store) => {
      const keys = store.getAllKeys();
      keys.onsuccess = () => { for (const k of keys.result) if (typeof k === 'string' && k.startsWith(prefix)) store.delete(k); };
      store.delete(this.key);
    }, 'delete');
  }
}

export { MemoryIndexStorage, IndexedDbIndexStorage };
export type { IIndexStorage };
