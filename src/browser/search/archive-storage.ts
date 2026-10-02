/** Where the serialised archive index lives. One opaque string blob under a single key. */
interface IIndexStorage {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
  clear(): Promise<void>;
}

class MemoryIndexStorage implements IIndexStorage {
  data: string | null = null;
  async load(): Promise<string | null> { return this.data; }
  async save(data: string): Promise<void> { this.data = data; }
  async clear(): Promise<void> { this.data = null; }
}

const STORE = 'kv';

/**
 * Persists the snapshot in IndexedDB (no practical size limit, unlike localStorage's ~5-10 MB).
 * A single record keeps the adapter trivial; see the archive service for save debouncing.
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

  async load(): Promise<string | null> {
    const db = await this.open();
    return new Promise<string | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(this.key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  }

  async save(data: string): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, this.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async clear(): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(this.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'));
    });
  }
}

export { MemoryIndexStorage, IndexedDbIndexStorage };
export type { IIndexStorage };
