/**
 * @file src/browser/js/web-sql-bindings.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Wire `window.openDatabase()` (Web SQL Database, deprecated but still used
 * by legacy pages) into the Nova JS engine's global environment. Mirrors
 * web-storage-bindings.ts's wrapping conventions for localStorage/indexedDB.
 * The real SQL engine lives in ../storage/web-sql.ts — this file only
 * translates between that TS API and Nova's guest JSValue/JSObject shapes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createObject, createNativeFunction, toString, toNumber, callJSFunction, toBoolean } from './values';
import type { JSObject, JSValue, JSFunction, Environment } from './values';
import type { EventLoop } from './event-loop';
import {
  NovaDatabase,
  NovaSqlTransaction,
  InMemoryWebSQLBackend,
  DiskWebSQLBackend,
  SQLError,
  type IWebSQLBackend,
  type SqlValue,
  type SQLResultSet,
} from '../storage/web-sql';

export interface WebSQLBindingsOptions {
  origin: string;
  diskPath?: string;
  backend?: IWebSQLBackend;
}

/** One shared backend + database cache per module load (mirrors indexedDBCache). */
const databaseCache = new Map<string, NovaDatabase>();

function isCallable(value: JSValue): value is JSFunction {
  return typeof value === 'object' && value !== null && (value as JSFunction).type === 'closure';
}

function toSqlValue(value: JSValue): SqlValue {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

function toSqlArgs(value: JSValue): SqlValue[] {
  if (typeof value !== 'object' || value === null) return [];
  const obj = value as JSObject;
  const length = Number(obj.properties.get('length')?.value ?? 0);
  const out: SqlValue[] = [];
  for (let i = 0; i < length; i++) out.push(toSqlValue(obj.properties.get(String(i))?.value));
  return out;
}

function wrapResultSet(rs: SQLResultSet): JSObject {
  const obj = createObject(null);
  obj.properties.set('insertId', { value: rs.insertId ?? undefined, writable: false, enumerable: true, configurable: true });
  obj.properties.set('rowsAffected', { value: rs.rowsAffected, writable: false, enumerable: true, configurable: true });

  const rowsObj = createObject(null);
  rowsObj.properties.set('length', { value: rs.rows.length, writable: false, enumerable: true, configurable: true });
  rowsObj.properties.set('item', {
    value: createNativeFunction('item', (_this, args) => {
      const row = rs.rows.item(toNumber(args[0]));
      if (row === null) return null;
      const rowObj = createObject(null);
      for (const [col, val] of Object.entries(row)) {
        rowObj.properties.set(col, { value: val, writable: true, enumerable: true, configurable: true });
      }
      return rowObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('rows', { value: rowsObj, writable: false, enumerable: true, configurable: true });

  return obj;
}

function wrapSqlError(err: SQLError): JSObject {
  const obj = createObject(null);
  obj.properties.set('code', { value: err.code, writable: false, enumerable: true, configurable: true });
  obj.properties.set('message', { value: err.message, writable: false, enumerable: true, configurable: true });
  return obj;
}

function wrapTransaction(tx: NovaSqlTransaction): JSObject {
  const obj = createObject(null);

  obj.properties.set('executeSql', {
    value: createNativeFunction('executeSql', (_this, args) => {
      const sql = toString(args[0] ?? '');
      const sqlArgs = toSqlArgs(args[1]);
      const successCb = args[2];
      const errorCb = args[3];

      tx.executeSql(
        sql,
        sqlArgs,
        isCallable(successCb) ? (t, result) => { callJSFunction(successCb, undefined, [wrapTransaction(t), wrapResultSet(result)]); } : undefined,
        isCallable(errorCb) ? (t, error) => toBoolean(callJSFunction(errorCb, undefined, [wrapTransaction(t), wrapSqlError(error)])) : undefined,
      );
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

/** Shared by .transaction()/.readTransaction()/.changeVersion()'s migration callback. */
function runTransaction(
  db: NovaDatabase,
  readOnly: boolean,
  eventLoop: EventLoop,
  callback: JSValue,
  errorCallback: JSValue,
  successCallback: JSValue,
): void {
  const tx = db.createTransaction(readOnly);

  if (isCallable(callback)) {
    try {
      callJSFunction(callback, undefined, [wrapTransaction(tx)]);
    } catch (err) {
      // A throwing transaction callback aborts before any statement runs
      // (ponytail: no real rollback of already-applied statements from a
      // PRIOR transaction — only this callback's own queuing is affected,
      // since nothing here has executed yet).
      if (isCallable(errorCallback)) {
        const sqlErr = err instanceof SQLError ? err : new SQLError(SQLError.UNKNOWN_ERR, err instanceof Error ? err.message : String(err));
        callJSFunction(errorCallback, undefined, [wrapSqlError(sqlErr)]);
      }
      return;
    }
  }

  // Real WebSQL callbacks fire asynchronously, not from inside transaction().
  eventLoop.enqueueMicrotask(() => {
    tx.drain(
      () => { if (isCallable(successCallback)) callJSFunction(successCallback, undefined, []); },
      (error) => { if (isCallable(errorCallback)) callJSFunction(errorCallback, undefined, [wrapSqlError(error)]); },
    );
  });
}

function wrapDatabase(db: NovaDatabase, eventLoop: EventLoop): JSObject {
  const obj = createObject(null);

  obj.properties.set('version', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get version', () => db.version),
  });

  obj.properties.set('transaction', {
    value: createNativeFunction('transaction', (_this, args) => {
      runTransaction(db, false, eventLoop, args[0], args[1], args[2]);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('readTransaction', {
    value: createNativeFunction('readTransaction', (_this, args) => {
      runTransaction(db, true, eventLoop, args[0], args[1], args[2]);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('changeVersion', {
    value: createNativeFunction('changeVersion', (_this, args) => {
      const oldVersion = toString(args[0] ?? '');
      const newVersion = toString(args[1] ?? '');
      try {
        db.changeVersion(oldVersion, newVersion);
      } catch (err) {
        const sqlErr = err instanceof SQLError ? err : new SQLError(SQLError.UNKNOWN_ERR, err instanceof Error ? err.message : String(err));
        if (isCallable(args[3])) callJSFunction(args[3], undefined, [wrapSqlError(sqlErr)]);
        return undefined;
      }
      runTransaction(db, false, eventLoop, args[2], args[3], args[4]);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

/**
 * Bind `openDatabase` to the JS global environment.
 * Called from createGlobalEnv() in index.ts, right alongside bindStorageAPIs.
 */
export function bindWebSQL(env: Environment, eventLoop: EventLoop, options: WebSQLBindingsOptions): void {
  const { origin, diskPath, backend } = options;

  env.setLocal('openDatabase', createNativeFunction('openDatabase', (_this, args) => {
    const name = toString(args[0] ?? '');
    const version = toString(args[1] ?? '');
    const creationCallback = args[4];

    const cacheKey = `${origin} ${name}`;
    let db = databaseCache.get(cacheKey);
    let isNew = false;
    if (!db) {
      const resolvedBackend = backend ?? (diskPath ? new DiskWebSQLBackend(diskPath) : new InMemoryWebSQLBackend());
      db = new NovaDatabase(origin, name, version, resolvedBackend);
      databaseCache.set(cacheKey, db);
      isNew = true;
    }

    const wrapped = wrapDatabase(db, eventLoop);
    if (isNew && isCallable(creationCallback)) {
      callJSFunction(creationCallback, undefined, [wrapped]);
    }
    return wrapped;
  }));
}

export { NovaDatabase, NovaSqlTransaction, InMemoryWebSQLBackend, DiskWebSQLBackend, SQLError };
export type { IWebSQLBackend };

/** Clear the cached Database instances (for tests). */
export function clearWebSQLCache(): void {
  databaseCache.clear();
}
