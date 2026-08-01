/**
 * @file src/browser/js/web-storage-bindings.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Wire localStorage, sessionStorage, and indexedDB into the Nova JS engine's
 * global environment so page-level scripts can use them.
 *
 * Uses the standard WHATWG Web Storage API (§ 9-10) and IndexedDB API (§ 11).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createObject, createNativeFunction, toString, toNumber } from './values';
import type { JSObject, JSValue, Environment } from './values';
import {
  NovaLocalStorage,
  InMemoryStorageBackend,
  DiskStorageBackend,
  type IStorage,
  type IStorageBackend,
} from '../storage/local-storage';
import { NovaSessionStorage, NovaSessionStorage as SessionStorageImpl } from '../storage/session-storage';
import {
  IDBFactory,
  IDBDatabase,
  IDBObjectStore,
  IDBTransaction,
  IDBKeyRange,
  IDBRequest,
  IDBIndex,
  IDBCursor,
  InMemoryIndexedDBBackend,
  type IIndexedDBBackend,
} from '../storage/indexed-db';

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface WebStorageBindingsOptions {
  /** Current page origin (e.g., "https://example.com"). */
  origin: string;
  /** Optional tab ID for session storage isolation. */
  tabId?: string;
  /** Optional disk path for localStorage persistence. */
  diskPath?: string;
  /** Optional backend for IndexedDB persistence. */
  indexedDBBackend?: IIndexedDBBackend;
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE BACKEND CACHE (per origin, shared across tabs)
// ─────────────────────────────────────────────────────────────────────────────

/** Cache of LocalStorage instances per origin. */
const localStorageCache = new Map<string, IStorage>();

/** Cache of SessionStorage instances per tab+origin. */
const sessionStorageCache = new Map<string, IStorage>();

/** Cache of IndexedDBFactory instances per origin. */
const indexedDBCache = new Map<string, IDBFactory>();

// ─────────────────────────────────────────────────────────────────────────────
// BINDING CREATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a JSObject that wraps a Web Storage API (localStorage or sessionStorage)
 * with the standard Storage interface: getItem, setItem, removeItem, clear, key, length.
 * Includes SOP defense-in-depth: callerOrigin must match the storage's origin.
 */
function wrapStorage(storage: IStorage, callerOrigin?: string, storageOrigin?: string): JSObject {
  const obj = createObject(null);

  // SOP defense-in-depth check
  const checkOrigin = (): void => {
    if (callerOrigin && storageOrigin && callerOrigin !== storageOrigin) {
      throw new DOMException(
        `Access to storage is denied for origin '${callerOrigin}': storage belongs to '${storageOrigin}'`,
        'SecurityError',
      );
    }
  };

  // getItem(key): string | null
  obj.properties.set('getItem', {
    value: createNativeFunction('getItem', (_this, args) => {
      checkOrigin();
      const key = toString(args[0]);
      const result = storage.getItem(key);
      return result === null ? undefined : result;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // setItem(key, value): void
  obj.properties.set('setItem', {
    value: createNativeFunction('setItem', (_this, args) => {
      checkOrigin();
      const key = toString(args[0]);
      const value = toString(args[1] ?? '');
      storage.setItem(key, value);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // removeItem(key): void
  obj.properties.set('removeItem', {
    value: createNativeFunction('removeItem', (_this, args) => {
      checkOrigin();
      const key = toString(args[0]);
      storage.removeItem(key);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // clear(): void
  obj.properties.set('clear', {
    value: createNativeFunction('clear', () => {
      checkOrigin();
      storage.clear();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // key(index): string | null
  obj.properties.set('key', {
    value: createNativeFunction('key', (_this, args) => {
      checkOrigin();
      const index = toNumber(args[0]);
      const result = storage.key(index);
      return result === null ? undefined : result;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // length (getter)
  obj.properties.set('length', {
    value: storage.length,
    writable: false, enumerable: true, configurable: true,
  });

  return obj;
}

/**
 * Wrap an IDBFactory as a JSObject for the global `indexedDB` binding.
 */
function wrapIndexedDBFactory(factory: IDBFactory): JSObject {
  const obj = createObject(null);

  // open(name, version?): IDBOpenDBRequest
  obj.properties.set('open', {
    value: createNativeFunction('open', (_this, args) => {
      const name = toString(args[0] ?? '');
      const version = args[1] !== undefined ? toNumber(args[1]) : undefined;
      return factory.open(name, version) as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // deleteDatabase(name): IDBOpenDBRequest
  obj.properties.set('deleteDatabase', {
    value: createNativeFunction('deleteDatabase', (_this, args) => {
      const name = toString(args[0] ?? '');
      return factory.deleteDatabase(name) as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // databases(): IDBRequest
  obj.properties.set('databases', {
    value: createNativeFunction('databases', () => {
      return factory.databases() as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // cmp(a, b): number
  obj.properties.set('cmp', {
    value: createNativeFunction('cmp', (_this, args) => {
      return factory.cmp(args[0], args[1]);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

/**
 * Wrap IDBKeyRange as a JS constructor + static methods.
 */
function wrapIDBKeyRange(): JSObject {
  const obj = createObject(null);

  obj.properties.set('only', {
    value: createNativeFunction('only', (_this, args) => IDBKeyRange.only(args[0]) as unknown as JSValue),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('lowerBound', {
    value: createNativeFunction('lowerBound', (_this, args) => {
      return IDBKeyRange.lowerBound(args[0], args[1] !== undefined ? Boolean(args[1]) : false) as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('upperBound', {
    value: createNativeFunction('upperBound', (_this, args) => {
      return IDBKeyRange.upperBound(args[0], args[1] !== undefined ? Boolean(args[1]) : false) as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('bound', {
    value: createNativeFunction('bound', (_this, args) => {
      return IDBKeyRange.bound(
        args[0], args[1],
        args[2] !== undefined ? Boolean(args[2]) : false,
        args[3] !== undefined ? Boolean(args[3]) : false,
      ) as unknown as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('compare', {
    value: createNativeFunction('compare', (_this, args) => IDBKeyRange.compare(args[0], args[1])),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bind localStorage, sessionStorage, and indexedDB to the JS global environment.
 * Called from createGlobalEnv() in index.ts.
 */
export function bindStorageAPIs(
  env: Environment,
  options: WebStorageBindingsOptions,
): void {
  const { origin, tabId, diskPath, indexedDBBackend } = options;

  // ── localStorage ────────────────────────────────────────────────
  // Shared across all tabs for the same origin.
  let localStorage = localStorageCache.get(origin);
  if (!localStorage) {
    const backend: IStorageBackend = diskPath
      ? new DiskStorageBackend(diskPath)
      : new InMemoryStorageBackend();
    localStorage = new NovaLocalStorage(origin, backend);
    localStorageCache.set(origin, localStorage);
  }
  env.setLocal('localStorage', wrapStorage(localStorage, origin, origin));

  // ── sessionStorage ──────────────────────────────────────────────
  // Scoped to this tab + origin.
  const sessionKey = `${tabId ?? 'default'}:${origin}`;
  let sessionStorage = sessionStorageCache.get(sessionKey);
  if (!sessionStorage) {
    sessionStorage = new SessionStorageImpl(origin, tabId);
    sessionStorageCache.set(sessionKey, sessionStorage);
  }
  env.setLocal('sessionStorage', wrapStorage(sessionStorage, origin, origin));

  // ── indexedDB ───────────────────────────────────────────────────
  // One factory per origin.
  let factory = indexedDBCache.get(origin);
  if (!factory) {
    const backend = indexedDBBackend ?? new InMemoryIndexedDBBackend();
    factory = new IDBFactory(backend, origin);
    indexedDBCache.set(origin, factory);
  }
  env.setLocal('indexedDB', wrapIndexedDBFactory(factory));

  // ── IDBKeyRange (static class) ──────────────────────────────────
  env.setLocal('IDBKeyRange', wrapIDBKeyRange());
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS (for tests and internal use)
// ─────────────────────────────────────────────────────────────────────────────

export {
  NovaLocalStorage,
  NovaSessionStorage,
  InMemoryStorageBackend,
  DiskStorageBackend,
  IDBFactory,
  IDBDatabase,
  IDBObjectStore,
  IDBTransaction,
  IDBKeyRange,
  IDBRequest,
  IDBIndex,
  IDBCursor,
  InMemoryIndexedDBBackend,
};

export type { IStorage, IStorageBackend, IIndexedDBBackend };

/** Clear all cached instances (for tests). */
export function clearStorageCaches(): void {
  localStorageCache.clear();
  sessionStorageCache.clear();
  indexedDBCache.clear();
}
