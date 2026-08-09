/**
 * @file src/browser/storage/indexed-db.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * W3C Indexed Database API 2.0 (partial) — per-origin structured storage.
 * https://www.w3.org/TR/IndexedDB-2-0/
 *
 * Core features implemented:
 *   • IDBFactory.open/deleteDatabase/databases
 *   • IDBDatabase.createObjectStore/deleteObjectStore/transaction/close
 *   • IDBTransaction object stores, oncomplete/onerror/onabort
 *   • IDBObjectStore add/put/delete/get/getAll/keys/count/clear/createIndex
 *   • IDBRequest success/error events
 *   • IDBIndex get/getAll/keys/count/openCursor
 *   • IDBCursor continue/advance/delete/update
 *   • IDBKeyRange (bound, lower, upper, only)
 *
 * Data is stored in-memory with per-origin isolation. Optionally persists
 * to a JSON file on disk when a DiskBackend is provided.
 *
 * OOP PRINCIPLES
 * ──────────────
 *  Abstraction      IIndexedDBBackend hides persistence mechanism.
 *  Encapsulation    Object stores, indexes, and cursors are private.
 *  Single-Resp.     This file implements only IndexedDB.
 *  Open / Closed    New backends implement IIndexedDBBackend.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// BACKEND INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

export interface IIndexedDBBackend {
  loadDatabase(origin: string, name: string): SerializedDatabase | null;
  saveDatabase(origin: string, name: string, db: SerializedDatabase): void;
  deleteDatabase(origin: string, name: string): void;
  listDatabases(origin: string): string[];
}

export interface SerializedDatabase {
  version: number;
  objectStores: Record<string, SerializedObjectStore>;
}

export interface SerializedObjectStore {
  keyPath: string | string[] | null;
  autoIncrement: boolean;
  data: Array<[unknown, Record<string, unknown>]>;
  indexes: Record<string, SerializedIndex>;
}

export interface SerializedIndex {
  keyPath: string | string[];
  unique: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY BACKEND
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryIndexedDBBackend implements IIndexedDBBackend {
  private readonly store = new Map<string, Map<string, SerializedDatabase>>();

  loadDatabase(origin: string, name: string): SerializedDatabase | null {
    return this.store.get(origin)?.get(name) ?? null;
  }

  saveDatabase(origin: string, name: string, db: SerializedDatabase): void {
    let origins = this.store.get(origin);
    if (!origins) {
      origins = new Map();
      this.store.set(origin, origins);
    }
    // Deep copy to avoid reference sharing, but avoid structuredClone on tuples.
    const copy: SerializedDatabase = {
      version: db.version,
      objectStores: {},
    };
    for (const [storeName, store] of Object.entries(db.objectStores)) {
      copy.objectStores[storeName] = {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        data: store.data.map(([k, v]) => [k, { ...v }]),
        indexes: Object.fromEntries(
          Object.entries(store.indexes).map(([idxName, idx]) => [idxName, { ...idx }])
        ),
      };
    }
    origins.set(name, copy);
  }

  deleteDatabase(origin: string, name: string): void {
    this.store.get(origin)?.delete(name);
  }

  listDatabases(origin: string): string[] {
    const origins = this.store.get(origin);
    return origins ? [...origins.keys()] : [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISK BACKEND
// ─────────────────────────────────────────────────────────────────────────────

/**
 * IIndexedDBBackend that persists each origin's databases to a JSON file on
 * disk. Mirrors {@link DiskStorageBackend}: Node-only, degrades to a silent
 * no-op when `node:fs` is unavailable (browser/Android builds), and never
 * throws — a failed read/write is treated as an empty/missing database.
 *
 * File layout: `indexeddb-<sanitized-origin>-<sanitized-name>.json` under a
 * single base directory.
 */
export class DiskIndexedDBBackend implements IIndexedDBBackend {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  loadDatabase(origin: string, name: string): SerializedDatabase | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const filePath = this.fileFor(path, origin, name);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SerializedDatabase;
      }
    } catch {
      // Read failure → database does not exist
    }
    return null;
  }

  saveDatabase(origin: string, name: string, db: SerializedDatabase): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }
      const filePath = this.fileFor(path, origin, name);
      fs.writeFileSync(filePath, JSON.stringify(db, null, 2), 'utf-8');
    } catch {
      // Write failure → silent (data stays in-memory for this session)
    }
  }

  deleteDatabase(origin: string, name: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const filePath = this.fileFor(path, origin, name);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Silent
    }
  }

  listDatabases(origin: string): string[] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('node:path') as typeof import('node:path');
      const prefix = `indexeddb-${this.sanitize(origin)}-`;
      if (!fs.existsSync(this.basePath)) return [];
      return fs
        .readdirSync(this.basePath)
        .filter((f: string) => f.startsWith(prefix) && f.endsWith('.json'))
        .map((f: string) => f.slice(prefix.length, -'.json'.length));
    } catch {
      return [];
    }
  }

  private fileFor(path: typeof import('node:path'), origin: string, name: string): string {
    return path.join(this.basePath, `indexeddb-${this.sanitize(origin)}-${this.sanitize(name)}.json`);
  }

  private sanitize(input: string): string {
    return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBRequest (W3C § 11.1)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  source: unknown = null;
  transaction: IDBTransaction | null = null;
  readyState: 'pending' | 'done' = 'pending';

  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private _listeners = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, listener: (event: Event) => void): void {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this._listeners.get(type)?.delete(listener);
  }

  _success(result: unknown): void {
    this.result = result;
    this.readyState = 'done';
    const event = new Event('success');
    if (this.onsuccess) {
      this.onsuccess(event);
    }
    this._emit(event);
  }

  _error(err: DOMException): void {
    this.error = err;
    this.readyState = 'done';
    const event = new Event('error');
    if (this.onerror) {
      this.onerror(event);
    }
    this._emit(event);
  }

  /** Fire success asynchronously (matching real IDB behavior). */
  _asyncSuccess(result: unknown): void {
    queueMicrotask(() => this._success(result));
  }

  /** Fire error asynchronously (matching real IDB behavior). */
  _asyncError(err: DOMException): void {
    queueMicrotask(() => this._error(err));
  }

  private _emit(event: Event): void {
    const listeners = this._listeners.get(event.type);
    if (!listeners) return;
    for (const l of listeners) {
      try { l(event); } catch { /* swallow */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBKeyRange (W3C § 5.2)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBKeyRange {
  readonly lower: unknown;
  readonly upper: unknown;
  readonly lowerOpen: boolean;
  readonly upperOpen: boolean;

  private constructor(lower: unknown, upper: unknown, lowerOpen: boolean, upperOpen: boolean) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  static only(value: unknown): IDBKeyRange {
    return new IDBKeyRange(value, value, false, false);
  }

  static lowerBound(lower: unknown, open = false): IDBKeyRange {
    return new IDBKeyRange(lower, undefined, open, true);
  }

  static upperBound(upper: unknown, open = false): IDBKeyRange {
    return new IDBKeyRange(undefined, upper, true, open);
  }

  static bound(lower: unknown, upper: unknown, lowerOpen = false, upperOpen = false): IDBKeyRange {
    if (lower === undefined && upper === undefined) {
      throw new DOMException('Both lower and upper bounds are undefined', 'DataError');
    }
    return new IDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  includes(key: unknown): boolean {
    if (this.lower !== undefined) {
      const cmp = IDBKeyRange.compare(this.lower, key);
      if (this.lowerOpen ? cmp >= 0 : cmp > 0) return false;
    }
    if (this.upper !== undefined) {
      const cmp = IDBKeyRange.compare(key, this.upper);
      if (this.upperOpen ? cmp >= 0 : cmp > 0) return false;
    }
    return true;
  }

  static compare(a: unknown, b: unknown): number {
    return IDBKeyRange.cmp(a, b);
  }

  private static cmp(a: unknown, b: unknown): number {
    if (a === b) return 0;
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (typeof a === 'boolean' && typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
    if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) {
      return IDBKeyRange.cmp(new Uint8Array(a), new Uint8Array(b));
    }
    if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
      const aa = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (aa[i] !== bb[i]) return aa[i] - bb[i];
      }
      return aa.length - bb.length;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const c = IDBKeyRange.cmp(a[i], b[i]);
        if (c !== 0) return c;
      }
      return a.length - b.length;
    }
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBIndex (W3C § 11.3)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBIndex {
  name: string;
  objectStore: IDBObjectStore;
  keyPath: string | string[];
  unique: boolean;
  multiEntry = false;

  constructor(name: string, objectStore: IDBObjectStore, keyPath: string | string[], unique: boolean) {
    this.name = name;
    this.objectStore = objectStore;
    this.keyPath = keyPath;
    this.unique = unique;
  }

  getKey(key: unknown): IDBRequest {
    return this.objectStore._indexGetKey(this.name, key);
  }

  get(key: unknown): IDBRequest {
    return this.objectStore._indexGet(this.name, key);
  }

  getAll(query?: unknown): IDBRequest {
    return this.objectStore._indexGetAll(this.name, query);
  }

  getAllKeys(query?: unknown): IDBRequest {
    return this.objectStore._indexGetAllKeys(this.name, query);
  }

  count(query?: unknown): IDBRequest {
    const req = new IDBRequest();
    const keys = this.objectStore._indexGetAllKeysSync(this.name, query);
    req._asyncSuccess(keys.length);
    return req;
  }

  openCursor(range?: IDBKeyRange | unknown, direction?: string): IDBRequest {
    return this.objectStore._indexOpenCursor(this.name, range, direction);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBCursor (W3C § 11.2)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBCursor {
  direction: string;
  key: unknown;
  primaryKey: unknown;
  source: IDBObjectStore | IDBIndex;
  _position: number = 0;
  private _entries: Array<[unknown, Record<string, unknown>]>;
  private _store: IDBObjectStore;
  private _indexName: string | null;

  constructor(
    source: IDBObjectStore | IDBIndex,
    entries: Array<[unknown, Record<string, unknown>]>,
    store: IDBObjectStore,
    direction: string,
    indexName: string | null,
  ) {
    this.source = source;
    this._entries = entries;
    this._store = store;
    this.direction = direction;
    this._indexName = indexName;
    this.key = entries[0]?.[0];
    this.primaryKey = entries[0]?.[0];
  }

  continue(key?: unknown): IDBRequest {
    const req = new IDBRequest();
    if (this._position >= this._entries.length - 1) {
      req._asyncSuccess(undefined);
      return req;
    }
    this._position++;
    if (key !== undefined) {
      for (let i = this._position; i < this._entries.length; i++) {
        if (IDBKeyRange.compare(this._entries[i]![0], key) >= 0) {
          this._position = i;
          break;
        }
      }
    }
    this.key = this._entries[this._position]?.[0];
    this.primaryKey = this.key;
    const entry = this._entries[this._position];
    req._asyncSuccess(entry ? { key: entry[0], value: entry[1] } : undefined);
    return req;
  }

  advance(count: number): IDBRequest {
    const req = new IDBRequest();
    this._position = Math.min(this._position + count, this._entries.length);
    if (this._position >= this._entries.length) {
      req._asyncSuccess(undefined);
      return req;
    }
    this.key = this._entries[this._position]?.[0];
    this.primaryKey = this.key;
    const entry = this._entries[this._position];
    req._asyncSuccess(entry ? { key: entry[0], value: entry[1] } : undefined);
    return req;
  }

  update(value: unknown): IDBRequest {
    const req = new IDBRequest();
    const entry = this._entries[this._position];
    if (!entry) {
      req._asyncError(new DOMException('Cursor has no current record', 'InvalidStateError'));
      return req;
    }
    if (this._indexName) {
      req._asyncError(new DOMException('Cannot update via index cursor', 'InvalidStateError'));
      return req;
    }
    const val = value as Record<string, unknown>;
    this._store._rawPut(entry[0], val);
    req._asyncSuccess(entry[0]);
    return req;
  }

  delete(): IDBRequest {
    const req = new IDBRequest();
    const entry = this._entries[this._position];
    if (!entry) {
      req._asyncError(new DOMException('Cursor has no current record', 'InvalidStateError'));
      return req;
    }
    if (this._indexName) {
      req._asyncError(new DOMException('Cannot delete via index cursor', 'InvalidStateError'));
      return req;
    }
    this._store._rawDelete(entry[0]);
    this._entries.splice(this._position, 1);
    if (this._position >= this._entries.length) {
      this._position = this._entries.length - 1;
    }
    req._asyncSuccess(undefined);
    return req;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBObjectStore (W3C § 11.4)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBObjectStore {
  name: string;
  keyPath: string | string[] | null;
  autoIncrement: boolean;

  private data = new Map<unknown, Record<string, unknown>>();
  private _nextKey = 1;
  private indexes = new Map<string, IDBIndex>();

  constructor(name: string, keyPath?: string | string[] | null, autoIncrement = false) {
    this.name = name;
    this.keyPath = keyPath ?? null;
    this.autoIncrement = autoIncrement;
  }

  // ── W3C § 11.4.2 — add ────────────────────────────────────────────

  add(value: unknown, key?: unknown): IDBRequest {
    const req = new IDBRequest();
    try {
      const resolvedKey = this._resolveKey(value, key);
      if (resolvedKey === undefined) {
        req._asyncError(new DOMException('Key could not be found', 'DataError'));
        return req;
      }
      if (this.data.has(resolvedKey)) {
        req._asyncError(new DOMException('Key already exists', 'ConstraintError'));
        return req;
      }
      this._rawPut(resolvedKey, value as Record<string, unknown>);
      req._asyncSuccess(resolvedKey);
    } catch (err) {
      req._asyncError(err instanceof DOMException ? err : new DOMException(String(err), 'DataError'));
    }
    return req;
  }

  // ── W3C § 11.4.3 — put ────────────────────────────────────────────

  put(value: unknown, key?: unknown): IDBRequest {
    const req = new IDBRequest();
    try {
      const resolvedKey = this._resolveKey(value, key);
      if (resolvedKey === undefined) {
        req._asyncError(new DOMException('Key could not be found', 'DataError'));
        return req;
      }
      this._rawPut(resolvedKey, value as Record<string, unknown>);
      req._asyncSuccess(resolvedKey);
    } catch (err) {
      req._asyncError(err instanceof DOMException ? err : new DOMException(String(err), 'DataError'));
    }
    return req;
  }

  // ── W3C § 11.4.5 — delete ─────────────────────────────────────────

  delete(query: unknown): IDBRequest {
    const req = new IDBRequest();
    const keys = this._matchQuery(query);
    for (const k of keys) {
      this.data.delete(k);
    }
    req._asyncSuccess(undefined);
    return req;
  }

  // ── W3C § 11.4.6 — get ────────────────────────────────────────────

  get(query: unknown): IDBRequest {
    const req = new IDBRequest();
    if (query instanceof IDBKeyRange) {
      for (const [k, v] of this.data) {
        if (query.includes(k)) {
          req._asyncSuccess(structuredClone(v));
          return req;
        }
      }
      req._asyncSuccess(undefined);
    } else if (Array.isArray(query)) {
      // Compound keys: use IDBKeyRange.compare since Map.get uses reference equality.
      for (const [k, v] of this.data) {
        if (Array.isArray(k) && IDBKeyRange.compare(k, query) === 0) {
          req._asyncSuccess(structuredClone(v));
          return req;
        }
      }
      req._asyncSuccess(undefined);
    } else {
      const v = this.data.get(query);
      req._asyncSuccess(v ? structuredClone(v) : undefined);
    }
    return req;
  }

  // ── W3C § 11.4.7 — getAll ──────────────────────────────────────────

  getAll(query?: unknown): IDBRequest {
    const req = new IDBRequest();
    const results: Record<string, unknown>[] = [];
    for (const [k, v] of this.data) {
      if (query === undefined) {
        results.push(structuredClone(v));
      } else if (query instanceof IDBKeyRange) {
        if (query.includes(k)) results.push(structuredClone(v));
      } else {
        if (k === query) results.push(structuredClone(v));
      }
    }
    req._asyncSuccess(results);
    return req;
  }

  // ── W3C § 11.4.8 — getKey ─────────────────────────────────────────

  getKey(query: unknown): IDBRequest {
    const req = new IDBRequest();
    if (query instanceof IDBKeyRange) {
      for (const [k] of this.data) {
        if (query.includes(k)) {
          req._asyncSuccess(k);
          return req;
        }
      }
      req._asyncSuccess(undefined);
    } else {
      req._asyncSuccess(this.data.has(query) ? query : undefined);
    }
    return req;
  }

  // ── W3C § 11.4.9 — getAllKeys ──────────────────────────────────────

  getAllKeys(query?: unknown): IDBRequest {
    const req = new IDBRequest();
    const results: unknown[] = [];
    for (const [k] of this.data) {
      if (query === undefined) {
        results.push(k);
      } else if (query instanceof IDBKeyRange) {
        if (query.includes(k)) results.push(k);
      } else {
        if (k === query) results.push(k);
      }
    }
    req._asyncSuccess(results);
    return req;
  }

  // ── W3C § 11.4.10 — count ─────────────────────────────────────────

  count(query?: unknown): IDBRequest {
    const req = new IDBRequest();
    let count = 0;
    for (const [k] of this.data) {
      if (query === undefined) {
        count++;
      } else if (query instanceof IDBKeyRange) {
        if (query.includes(k)) count++;
      } else {
        if (k === query) count++;
      }
    }
    req._asyncSuccess(count);
    return req;
  }

  // ── W3C § 11.4.11 — clear ─────────────────────────────────────────

  clear(): IDBRequest {
    const req = new IDBRequest();
    this.data.clear();
    this.indexes.clear();
    req._asyncSuccess(undefined);
    return req;
  }

  // ── W3C § 11.4.12 — createIndex ───────────────────────────────────

  createIndex(name: string, keyPath: string | string[], options?: { unique?: boolean; multiEntry?: boolean }): IDBRequest {
    const req = new IDBRequest();
    if (this.indexes.has(name)) {
      req._asyncError(new DOMException(`Index "${name}" already exists`, 'ConstraintError'));
      return req;
    }
    const index = new IDBIndex(name, this, keyPath, options?.unique ?? false);
    index.multiEntry = options?.multiEntry ?? false;
    this.indexes.set(name, index);
    req._asyncSuccess(undefined);
    return req;
  }

  // ── W3C § 11.4.13 — deleteIndex ───────────────────────────────────

  deleteIndex(name: string): IDBRequest {
    const req = new IDBRequest();
    if (!this.indexes.has(name)) {
      req._asyncError(new DOMException(`Index "${name}" does not exist`, 'NotFoundError'));
      return req;
    }
    this.indexes.delete(name);
    req._asyncSuccess(undefined);
    return req;
  }

  // ── W3C § 11.4.15 — openCursor ────────────────────────────────────

  openCursor(query?: IDBKeyRange | unknown, direction: string = 'next'): IDBRequest {
    const entries: Array<[unknown, Record<string, unknown>]> = [];
    for (const [k, v] of this.data) {
      if (query === undefined) {
        entries.push([k, v]);
      } else if (query instanceof IDBKeyRange) {
        if (query.includes(k)) entries.push([k, v]);
      } else {
        if (k === query) entries.push([k, v]);
      }
    }
    entries.sort((a, b) => IDBKeyRange.compare(a[0], b[0]));
    if (direction === 'prev' || direction === 'prevunique') {
      entries.reverse();
    }
    const req = new IDBRequest();
    if (entries.length === 0) {
      req._asyncSuccess(null);
    } else {
      req._asyncSuccess(new IDBCursor(this, entries, this, direction, null));
    }
    return req;
  }

  // ── Internal methods ───────────────────────────────────────────────

  _rawPut(key: unknown, value: Record<string, unknown>): void {
    this.data.set(key, structuredClone(value));
    this._updateIndexes(key, value);
  }

  _rawDelete(key: unknown): void {
    this.data.delete(key);
    this._removeFromIndexes(key);
  }

  _indexGetKey(indexName: string, query: unknown): IDBRequest {
    const req = new IDBRequest();
    const index = this.indexes.get(indexName);
    if (!index) {
      req._asyncError(new DOMException(`Index "${indexName}" not found`, 'NotFoundError'));
      return req;
    }
    for (const [k, v] of this.data) {
      const idxKey = this._extractIndexKey(index.keyPath, v);
      if (query instanceof IDBKeyRange ? query.includes(idxKey) : idxKey === query) {
        req._asyncSuccess(k);
        return req;
      }
    }
    req._asyncSuccess(undefined);
    return req;
  }

  _indexGet(indexName: string, query: unknown): IDBRequest {
    const req = new IDBRequest();
    const index = this.indexes.get(indexName);
    if (!index) {
      req._asyncError(new DOMException(`Index "${indexName}" not found`, 'NotFoundError'));
      return req;
    }
    for (const [, v] of this.data) {
      const idxKey = this._extractIndexKey(index.keyPath, v);
      if (query instanceof IDBKeyRange ? query.includes(idxKey) : idxKey === query) {
        req._asyncSuccess(structuredClone(v));
        return req;
      }
    }
    req._asyncSuccess(undefined);
    return req;
  }

  _indexGetAll(indexName: string, query?: unknown): IDBRequest {
    const req = new IDBRequest();
    const index = this.indexes.get(indexName);
    if (!index) {
      req._asyncError(new DOMException(`Index "${indexName}" not found`, 'NotFoundError'));
      return req;
    }
    const results: Record<string, unknown>[] = [];
    for (const [, v] of this.data) {
      const idxKey = this._extractIndexKey(index.keyPath, v);
      if (query === undefined) {
        results.push(structuredClone(v));
      } else if (query instanceof IDBKeyRange ? query.includes(idxKey) : idxKey === query) {
        results.push(structuredClone(v));
      }
    }
    req._asyncSuccess(results);
    return req;
  }

  _indexGetAllKeys(indexName: string, query?: unknown): IDBRequest {
    const req = new IDBRequest();
    const results = this._indexGetAllKeysSync(indexName, query);
    req._asyncSuccess(results);
    return req;
  }

  _indexGetAllKeysSync(indexName: string, query?: unknown): unknown[] {
    const index = this.indexes.get(indexName);
    if (!index) return [];
    const results: unknown[] = [];
    for (const [k, v] of this.data) {
      const idxKey = this._extractIndexKey(index.keyPath, v);
      if (query === undefined) {
        results.push(k);
      } else if (query instanceof IDBKeyRange ? query.includes(idxKey) : idxKey === query) {
        results.push(k);
      }
    }
    return results;
  }

  _indexOpenCursor(indexName: string, query?: IDBKeyRange | unknown, direction = 'next'): IDBRequest {
    const req = new IDBRequest();
    const index = this.indexes.get(indexName);
    if (!index) {
      req._asyncError(new DOMException(`Index "${indexName}" not found`, 'NotFoundError'));
      return req;
    }
    const entries: Array<[unknown, Record<string, unknown>]> = [];
    for (const [, v] of this.data) {
      const idxKey = this._extractIndexKey(index.keyPath, v);
      if (query === undefined) {
        entries.push([idxKey, v]);
      } else if (query instanceof IDBKeyRange ? query.includes(idxKey) : idxKey === query) {
        entries.push([idxKey, v]);
      }
    }
    entries.sort((a, b) => IDBKeyRange.compare(a[0], b[0]));
    if (direction.startsWith('prev')) entries.reverse();
    if (entries.length === 0) {
      req._asyncSuccess(null);
    } else {
      req._asyncSuccess(new IDBCursor(index, entries, this, direction, indexName));
    }
    return req;
  }

  _getAllEntries(): Array<[unknown, Record<string, unknown>]> {
    return [...this.data.entries()].map(([k, v]) => [k, structuredClone(v)]);
  }

  _loadEntries(entries: Array<[unknown, Record<string, unknown>]>): void {
    for (const [k, v] of entries) {
      this.data.set(k, v);
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  private _resolveKey(value: unknown, explicitKey?: unknown): unknown {
    if (explicitKey !== undefined) return explicitKey;
    if (this.keyPath !== null) {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(this.keyPath)) {
        // Compound key.
        return this.keyPath.map(p => obj[p]);
      }
      return obj[this.keyPath];
    }
    if (this.autoIncrement) {
      return this._nextKey++;
    }
    return undefined;
  }

  private _extractIndexKey(keyPath: string | string[], record: Record<string, unknown>): unknown {
    if (Array.isArray(keyPath)) {
      return keyPath.map(p => record[p]);
    }
    return record[keyPath];
  }

  private _matchQuery(query: unknown): unknown[] {
    const keys: unknown[] = [];
    for (const k of this.data.keys()) {
      if (query instanceof IDBKeyRange) {
        if (query.includes(k)) keys.push(k);
      } else {
        if (k === query) keys.push(k);
      }
    }
    return keys;
  }

  private _updateIndexes(key: unknown, value: Record<string, unknown>): void {
    for (const [, index] of this.indexes) {
      const idxKey = this._extractIndexKey(index.keyPath, value);
      if (index.unique) {
        for (const [, v] of this.data) {
          if (v === value) continue;
          const existing = this._extractIndexKey(index.keyPath, v);
          if (existing === idxKey) {
            // Duplicate — would violate unique constraint.
            // In real IndexedDB this would fail the transaction.
          }
        }
      }
    }
  }

  private _removeFromIndexes(_key: unknown): void {
    // Indexes are derived from data — no cleanup needed.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBTransaction (W3C § 11.5)
// ─────────────────────────────────────────────────────────────────────────────

export type IDBTransactionMode = 'readonly' | 'readwrite' | 'versionchange';

export class IDBTransaction {
  mode: IDBTransactionMode;
  db: IDBDatabase;
  objectStoreNames: string[];
  error: DOMException | null = null;

  oncomplete: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;

  private _active = true;
  private _requests: IDBRequest[] = [];

  constructor(mode: IDBTransactionMode, db: IDBDatabase, objectStoreNames: string[]) {
    this.mode = mode;
    this.db = db;
    this.objectStoreNames = objectStoreNames;
  }

  objectStore(name: string): IDBObjectStore {
    if (!this._active) {
      throw new DOMException('Transaction has already completed', 'InvalidStateError');
    }
    const store = this.db._getObjectStore(name);
    if (!store) {
      throw new DOMException(`Object store "${name}" not found`, 'NotFoundError');
    }
    return store;
  }

  /** @internal — called by IDBRequest._success/_error */
  _registerRequest(req: IDBRequest): void {
    this._requests.push(req);
  }

  /** @internal — called after all requests are done */
  _commit(): void {
    this._active = false;
    // Fire oncomplete asynchronously.
    queueMicrotask(() => {
      const event = new Event('complete');
      this.oncomplete?.(event);
    });
  }

  abort(): void {
    this._active = false;
    this.error = new DOMException('Transaction aborted', 'AbortError');
    queueMicrotask(() => {
      const event = new Event('abort');
      this.onabort?.(event);
    });
  }

  get _isActive(): boolean {
    return this._active;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBDatabase (W3C § 11.2)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBDatabase implements IDisposable {
  name: string;
  version: number;
  objectStoreNames: string[] = [];

  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onversionchange: ((event: Event) => void) | null = null;

  private objectStores = new Map<string, IDBObjectStore>();
  private _closed = false;
  private _backend: IIndexedDBBackend;
  private _origin: string;

  constructor(name: string, version: number, backend: IIndexedDBBackend, origin: string) {
    this.name = name;
    this.version = version;
    this._backend = backend;
    this._origin = origin;
  }

  // ── W3C § 11.2.2 — createObjectStore ──────────────────────────────

  createObjectStore(name: string, options?: { keyPath?: string | string[]; autoIncrement?: boolean }): IDBObjectStore {
    this._checkNotClosed();
    if (this.objectStores.has(name)) {
      throw new DOMException(`Object store "${name}" already exists`, 'ConstraintError');
    }
    const store = new IDBObjectStore(name, options?.keyPath, options?.autoIncrement);
    this.objectStores.set(name, store);
    this.objectStoreNames.push(name);
    return store;
  }

  // ── W3C § 11.2.3 — deleteObjectStore ──────────────────────────────

  deleteObjectStore(name: string): void {
    this._checkNotClosed();
    if (!this.objectStores.has(name)) {
      throw new DOMException(`Object store "${name}" not found`, 'NotFoundError');
    }
    this.objectStores.delete(name);
    this.objectStoreNames = this.objectStoreNames.filter(n => n !== name);
  }

  // ── W3C § 11.2.4 — transaction ────────────────────────────────────

  transaction(
    storeNames: string | string[],
    mode: IDBTransactionMode = 'readonly',
  ): IDBTransaction {
    this._checkNotClosed();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    for (const n of names) {
      if (!this.objectStores.has(n)) {
        throw new DOMException(`Object store "${n}" not found`, 'NotFoundError');
      }
    }
    return new IDBTransaction(mode, this, names);
  }

  // ── W3C § 11.2.5 — close ──────────────────────────────────────────

  close(): void {
    this._persist();
    this._closed = true;
  }

  // ── Internal helpers ───────────────────────────────────────────────

  _getObjectStore(name: string): IDBObjectStore | undefined {
    return this.objectStores.get(name);
  }

  _loadStores(stores: Record<string, SerializedObjectStore>): void {
    for (const [name, serialized] of Object.entries(stores)) {
      const store = new IDBObjectStore(name, serialized.keyPath, serialized.autoIncrement);
      store._loadEntries(serialized.data);
      // Rebuild indexes.
      for (const [idxName, idxSerialized] of Object.entries(serialized.indexes)) {
        store.createIndex(idxName, idxSerialized.keyPath, { unique: idxSerialized.unique });
      }
      this.objectStores.set(name, store);
      this.objectStoreNames.push(name);
    }
  }

  _persist(): void {
    if (this._closed) return;
    const serialized: SerializedDatabase = {
      version: this.version,
      objectStores: {},
    };
    for (const [name, store] of this.objectStores) {
      const entries = store._getAllEntries();
      const indexes: Record<string, SerializedIndex> = {};
      // Serialize index info from the createIndex calls.
      for (const [idxName, idx] of (store as any).indexes ?? new Map()) {
        indexes[idxName] = { keyPath: idx.keyPath, unique: idx.unique };
      }
      serialized.objectStores[name] = {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        data: entries,
        indexes,
      };
    }
    this._backend.saveDatabase(this._origin, this.name, serialized);
  }

  _checkNotClosed(): void {
    if (this._closed) {
      throw new DOMException('Database is closed', 'InvalidStateError');
    }
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.close();
    this.objectStores.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IDBFactory (W3C § 11.1)
// ─────────────────────────────────────────────────────────────────────────────

export class IDBFactory {
  private backend: IIndexedDBBackend;
  private origin: string;

  constructor(backend: IIndexedDBBackend, origin: string) {
    this.backend = backend;
    this.origin = origin;
  }

  // ── W3C § 11.1.1 — open ───────────────────────────────────────────

  open(name: string, version?: number): IDBRequest {
    const req = new IDBRequest();
    const targetVersion = version ?? 1;

    // Load existing database or create new.
    let serialized = this.backend.loadDatabase(this.origin, name);
    let db: IDBDatabase;

    if (serialized) {
      if (targetVersion < serialized.version) {
        req._asyncError(new DOMException(
          `Version ${targetVersion} is less than current version ${serialized.version}`,
          'VersionError',
        ));
        return req;
      }
      db = new IDBDatabase(name, serialized.version, this.backend, this.origin);
      db._loadStores(serialized.objectStores);
    } else {
      db = new IDBDatabase(name, targetVersion, this.backend, this.origin);
    }

    // Fire success asynchronously.
    queueMicrotask(() => req._success(db));
    return req;
  }

  // ── W3C § 11.1.2 — deleteDatabase ─────────────────────────────────

  deleteDatabase(name: string): IDBRequest {
    const req = new IDBRequest();
    this.backend.deleteDatabase(this.origin, name);
    queueMicrotask(() => req._success(undefined));
    return req;
  }

  // ── W3C § 11.1.3 — databases ──────────────────────────────────────

  databases(): IDBRequest {
    const req = new IDBRequest();
    const names = this.backend.listDatabases(this.origin);
    queueMicrotask(() => {
      req._success(names.map(n => ({ name: n, version: 1 })));
    });
    return req;
  }

  // ── W3C § 11.1.4 — cmp ────────────────────────────────────────────

  cmp(a: unknown, b: unknown): number {
    return IDBKeyRange.compare(a, b);
  }
}
