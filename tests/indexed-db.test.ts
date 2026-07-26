import { describe, it, expect, beforeEach } from 'vitest';
import {
  IDBFactory,
  IDBDatabase,
  IDBObjectStore,
  IDBTransaction,
  IDBKeyRange,
  IDBRequest,
  InMemoryIndexedDBBackend,
  type IDBTransactionMode,
} from '../src/browser/storage/indexed-db';

describe('IndexedDB', () => {
  let backend: InMemoryIndexedDBBackend;
  let factory: IDBFactory;
  const origin = 'https://example.com';

  beforeEach(() => {
    backend = new InMemoryIndexedDBBackend();
    factory = new IDBFactory(backend, origin);
  });

  // ── IDBFactory ──────────────────────────────────────────────────

  describe('IDBFactory.open', () => {
    it('should open a new database', () => {
      const req = factory.open('mydb');
      expect(req).toBeInstanceOf(IDBRequest);
    });

    it('should succeed asynchronously with an IDBDatabase', async () => {
      const req = factory.open('mydb');
      const db = await waitForSuccess(req);
      expect(db).toBeInstanceOf(IDBDatabase);
      expect(db.name).toBe('mydb');
      expect(db.version).toBe(1);
      db.dispose();
    });

    it('should open an existing database', async () => {
      const req1 = factory.open('mydb');
      const db1 = await waitForSuccess(req1);
      const store = db1.createObjectStore('items', { keyPath: 'id' });
      store.put({ id: 1, name: 'Item 1' });
      db1.close();

      const req2 = factory.open('mydb');
      const db2 = await waitForSuccess(req2);
      expect(db2.objectStoreNames).toContain('items');
      db2.dispose();
    });

    it('should reject if version is lower than current', async () => {
      const req1 = factory.open('mydb', 2);
      const db1 = await waitForSuccess(req1);
      db1.close();

      const req2 = factory.open('mydb', 1);
      const err = await waitForError(req2);
      expect(err).toContain('Version');
    });
  });

  describe('IDBFactory.deleteDatabase', () => {
    it('should delete a database', async () => {
      const req1 = factory.open('todelete');
      const db1 = await waitForSuccess(req1);
      db1.createObjectStore('store');
      db1.close();

      const delReq = factory.deleteDatabase('todelete');
      const result = await waitForSuccess(delReq);
      expect(result).toBeUndefined();
    });
  });

  describe('IDBFactory.cmp', () => {
    it('should compare two values', () => {
      expect(factory.cmp(1, 2)).toBeLessThan(0);
      expect(factory.cmp(2, 1)).toBeGreaterThan(0);
      expect(factory.cmp(1, 1)).toBe(0);
      expect(factory.cmp('a', 'b')).toBeLessThan(0);
    });
  });

  // ── IDBDatabase ─────────────────────────────────────────────────

  describe('IDBDatabase', () => {
    it('should create and delete object stores', async () => {
      const db = await openTestDB('store-ops');
      db.createObjectStore('mystore', { keyPath: 'id' });
      expect(db.objectStoreNames).toContain('mystore');

      db.deleteObjectStore('mystore');
      expect(db.objectStoreNames).not.toContain('mystore');
      db.dispose();
    });

    it('should throw when creating duplicate object stores', async () => {
      const db = await openTestDB('dup-store');
      db.createObjectStore('items');
      expect(() => db.createObjectStore('items')).toThrow('already exists');
      db.dispose();
    });

    it('should close and reject operations after close', async () => {
      const db = await openTestDB('close-test');
      db.close();
      expect(() => db.createObjectStore('new')).toThrow('closed');
    });
  });

  // ── IDBObjectStore CRUD ─────────────────────────────────────────

  describe('IDBObjectStore', () => {
    describe('put / get', () => {
      it('should store and retrieve an object by explicit key', async () => {
        const db = await openTestDB('put-get');
        const store = db.createObjectStore('items', { keyPath: 'id' });

        const addReq = store.put({ id: 1, name: 'Alice' });
        const key = await waitForSuccess(addReq);
        expect(key).toBe(1);

        const getReq = store.get(1);
        const result = await waitForSuccess(getReq);
        expect(result).toEqual({ id: 1, name: 'Alice' });
        db.dispose();
      });

      it('should store with an explicit key when no keyPath', async () => {
        const db = await openTestDB('explicit-key');
        const store = db.createObjectStore('items');

        store.put('hello', 'key1');
        const getReq = store.get('key1');
        const result = await waitForSuccess(getReq);
        expect(result).toBe('hello');
        db.dispose();
      });

      it('should overwrite with put', async () => {
        const db = await openTestDB('overwrite');
        const store = db.createObjectStore('items', { keyPath: 'id' });

        store.put({ id: 1, name: 'v1' });
        store.put({ id: 1, name: 'v2' });
        const getReq = store.get(1);
        const result = await waitForSuccess(getReq);
        expect(result).toEqual({ id: 1, name: 'v2' });
        db.dispose();
      });
    });

    describe('add', () => {
      it('should add a new record', async () => {
        const db = await openTestDB('add-new');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        const req = store.add({ id: 1 });
        const key = await waitForSuccess(req);
        expect(key).toBe(1);
        db.dispose();
      });

      it('should fail with ConstraintError on duplicate key', async () => {
        const db = await openTestDB('add-dup');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.add({ id: 1 });
        const req = store.add({ id: 1 });
        const err = await waitForError(req);
        expect(err).toContain('already');
        db.dispose();
      });
    });

    describe('delete', () => {
      it('should delete a record by key', async () => {
        const db = await openTestDB('delete-key');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 1 });

        await waitForSuccess(store.delete(1));
        const getReq = store.get(1);
        const result = await waitForSuccess(getReq);
        expect(result).toBeUndefined();
        db.dispose();
      });

      it('should delete by IDBKeyRange', async () => {
        const db = await openTestDB('delete-range');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 1 });
        store.put({ id: 2 });
        store.put({ id: 3 });

        await waitForSuccess(store.delete(IDBKeyRange.bound(1, 2)));
        const countReq = store.count();
        const count = await waitForSuccess(countReq);
        expect(count).toBe(1);
        db.dispose();
      });
    });

    describe('getAll / getAllKeys', () => {
      it('should get all records', async () => {
        const db = await openTestDB('getall');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 1, name: 'A' });
        store.put({ id: 2, name: 'B' });

        const req = store.getAll();
        const all = await waitForSuccess(req);
        expect(all).toHaveLength(2);
        db.dispose();
      });

      it('should get all keys', async () => {
        const db = await openTestDB('getallkeys');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 10 });
        store.put({ id: 20 });

        const req = store.getAllKeys();
        const keys = await waitForSuccess(req);
        expect(keys).toEqual([10, 20]);
        db.dispose();
      });
    });

    describe('count', () => {
      it('should count records', async () => {
        const db = await openTestDB('count');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 1 });
        store.put({ id: 2 });
        store.put({ id: 3 });

        const req = store.count();
        const count = await waitForSuccess(req);
        expect(count).toBe(3);
        db.dispose();
      });
    });

    describe('clear', () => {
      it('should clear all records', async () => {
        const db = await openTestDB('clear');
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.put({ id: 1 });
        store.put({ id: 2 });

        await waitForSuccess(store.clear());
        const countReq = store.count();
        const count = await waitForSuccess(countReq);
        expect(count).toBe(0);
        db.dispose();
      });
    });

    describe('autoIncrement', () => {
      it('should auto-generate keys', async () => {
        const db = await openTestDB('autoinc');
        const store = db.createObjectStore('items', { autoIncrement: true });

        const k1 = await waitForSuccess(store.put({ name: 'A' }));
        const k2 = await waitForSuccess(store.put({ name: 'B' }));
        expect(k2).toBeGreaterThan(k1 as number);
        db.dispose();
      });
    });

    describe('compound keys', () => {
      it('should support compound keyPaths', async () => {
        const db = await openTestDB('compound');
        const store = db.createObjectStore('items', { keyPath: ['a', 'b'] });

        store.put({ a: 1, b: 'x', data: 'hello' });
        const getReq = store.get([1, 'x']);
        const result = await waitForSuccess(getReq);
        expect(result).toEqual({ a: 1, b: 'x', data: 'hello' });
        db.dispose();
      });
    });
  });

  // ── IDBIndex ────────────────────────────────────────────────────

  describe('IDBIndex', () => {
    it('should create an index and query by indexed key', async () => {
      const db = await openTestDB('index-basic');
      const store = db.createObjectStore('users', { keyPath: 'id' });
      store.createIndex('by-name', 'name', { unique: false });

      store.put({ id: 1, name: 'Alice' });
      store.put({ id: 2, name: 'Bob' });
      store.put({ id: 3, name: 'Charlie' });

      const idx = (store as any).indexes.get('by-name');
      expect(idx).toBeDefined();

      const getReq = idx.get('Bob');
      const result = await waitForSuccess(getReq);
      expect(result).toEqual({ id: 2, name: 'Bob' });
      db.dispose();
    });

    it('should count records via index', async () => {
      const db = await openTestDB('index-count');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      store.createIndex('by-type', 'type');

      store.put({ id: 1, type: 'a' });
      store.put({ id: 2, type: 'a' });
      store.put({ id: 3, type: 'b' });

      const idx = (store as any).indexes.get('by-type');
      const countReq = idx.count('a');
      const count = await waitForSuccess(countReq);
      expect(count).toBe(2);
      db.dispose();
    });

    it('should delete an index', async () => {
      const db = await openTestDB('index-delete');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      store.createIndex('temp', 'name');
      await waitForSuccess(store.deleteIndex('temp'));
      expect((store as any).indexes.has('temp')).toBe(false);
      db.dispose();
    });
  });

  // ── IDBKeyRange ─────────────────────────────────────────────────

  describe('IDBKeyRange', () => {
    it('should create an only range', () => {
      const range = IDBKeyRange.only(5);
      expect(range.includes(5)).toBe(true);
      expect(range.includes(4)).toBe(false);
      expect(range.includes(6)).toBe(false);
    });

    it('should create a lowerBound range', () => {
      const range = IDBKeyRange.lowerBound(3);
      expect(range.includes(3)).toBe(true);
      expect(range.includes(2)).toBe(false);
      expect(range.includes(10)).toBe(true);
    });

    it('should create an upperBound range', () => {
      const range = IDBKeyRange.upperBound(5);
      expect(range.includes(5)).toBe(true);
      expect(range.includes(6)).toBe(false);
      expect(range.includes(0)).toBe(true);
    });

    it('should create a bound range', () => {
      const range = IDBKeyRange.bound(2, 5);
      expect(range.includes(2)).toBe(true);
      expect(range.includes(5)).toBe(true);
      expect(range.includes(1)).toBe(false);
      expect(range.includes(6)).toBe(false);
    });

    it('should support open bounds', () => {
      const range = IDBKeyRange.bound(2, 5, true, true);
      expect(range.includes(2)).toBe(false);
      expect(range.includes(5)).toBe(false);
      expect(range.includes(3)).toBe(true);
    });

    it('should compare strings', () => {
      expect(IDBKeyRange.compare('a', 'b')).toBeLessThan(0);
      expect(IDBKeyRange.compare('b', 'a')).toBeGreaterThan(0);
      expect(IDBKeyRange.compare('a', 'a')).toBe(0);
    });

    it('should compare dates', () => {
      const d1 = new Date('2024-01-01');
      const d2 = new Date('2025-01-01');
      expect(IDBKeyRange.compare(d1, d2)).toBeLessThan(0);
    });

    it('should compare arrays', () => {
      expect(IDBKeyRange.compare([1, 2], [1, 3])).toBeLessThan(0);
      expect(IDBKeyRange.compare([1, 2], [1, 2])).toBe(0);
    });
  });

  // ── IDBTransaction ──────────────────────────────────────────────

  describe('IDBTransaction', () => {
    it('should open a readonly transaction', async () => {
      const db = await openTestDB('txn-readonly');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      store.put({ id: 1 });

      const txn = db.transaction('items', 'readonly');
      expect(txn.mode).toBe('readonly');
      expect(txn.objectStoreNames).toContain('items');

      const s = txn.objectStore('items');
      expect(s).toBeDefined();
      db.dispose();
    });

    it('should open a readwrite transaction', async () => {
      const db = await openTestDB('txn-rw');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      const txn = db.transaction('items', 'readwrite');
      expect(txn.mode).toBe('readwrite');
      db.dispose();
    });

    it('should throw when accessing a non-existent store', async () => {
      const db = await openTestDB('txn-nostore');
      db.createObjectStore('items');
      const txn = db.transaction('items');
      expect(() => txn.objectStore('missing')).toThrow('not found');
      db.dispose();
    });
  });

  // ── IDBCursor ───────────────────────────────────────────────────

  describe('IDBCursor', () => {
    it('should iterate records with openCursor', async () => {
      const db = await openTestDB('cursor');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      store.put({ id: 1, name: 'A' });
      store.put({ id: 2, name: 'B' });
      store.put({ id: 3, name: 'C' });

      const cursorReq = store.openCursor();
      const cursor = await waitForSuccess(cursorReq);
      expect(cursor).not.toBeNull();
      expect(cursor.key).toBe(1);
      expect(cursor.primaryKey).toBe(1);

      // Advance
      const next = await waitForSuccess(cursor.continue());
      expect(next).toBeDefined();
      expect(next.key).toBe(2);

      db.dispose();
    });

    it('should iterate in reverse', async () => {
      const db = await openTestDB('cursor-rev');
      const store = db.createObjectStore('items', { keyPath: 'id' });
      store.put({ id: 1 });
      store.put({ id: 2 });
      store.put({ id: 3 });

      const req = store.openCursor(undefined, 'prev');
      const cursor = await waitForSuccess(req);
      expect(cursor.key).toBe(3);
      db.dispose();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function waitForSuccess<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(new Error(req.error?.message ?? 'Request failed'));
  });
}

function waitForError(req: IDBRequest): Promise<string> {
  return new Promise((resolve) => {
    req.onerror = () => resolve(req.error?.message ?? 'Unknown error');
    req.onsuccess = () => resolve('Expected error but got success');
  });
}

async function openTestDB(name: string): Promise<IDBDatabase> {
  const backend = new InMemoryIndexedDBBackend();
  const factory = new IDBFactory(backend, 'test-origin');
  const req = factory.open(name);
  return waitForSuccess<IDBDatabase>(req);
}
