import { describe, it, expect, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { DiskIndexedDBBackend } from '../src/browser/storage/indexed-db';
import type { SerializedDatabase } from '../src/browser/storage/indexed-db';

function makeDb(version: number, records: Array<[unknown, Record<string, unknown>]>): SerializedDatabase {
  return {
    version,
    objectStores: {
      store: {
        keyPath: 'id',
        autoIncrement: false,
        data: records,
        indexes: {},
      },
    },
  };
}

describe('DiskIndexedDBBackend', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-idb-'));
  const backend = new DiskIndexedDBBackend(path.join(tmpRoot, 'web-storage'));

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* cleanup best-effort */
    }
  });

  it('persists a database to disk and loads it back', () => {
    const db = makeDb(1, [[1, { id: 1, name: 'alpha' }], ['k2', { id: 'k2', name: 'beta' }]]);
    backend.saveDatabase('https://example.com', 'appdb', db);

    const loaded = backend.loadDatabase('https://example.com', 'appdb');
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.objectStores.store.data).toHaveLength(2);
    expect(loaded!.objectStores.store.data[0][0]).toBe(1);
    expect(loaded!.objectStores.store.data[0][1]).toEqual({ id: 1, name: 'alpha' });
  });

  it('isolates databases by origin', () => {
    backend.saveDatabase('https://a.com', 'shared', makeDb(2, [['a', { id: 'a' }]]));
    backend.saveDatabase('https://b.com', 'shared', makeDb(3, [['b', { id: 'b' }]]));

    expect(backend.loadDatabase('https://a.com', 'shared')!.version).toBe(2);
    expect(backend.loadDatabase('https://b.com', 'shared')!.version).toBe(3);
  });

  it('returns null for a missing database', () => {
    expect(backend.loadDatabase('https://nope.com', 'missing')).toBeNull();
  });

  it('lists databases per origin', () => {
    backend.saveDatabase('https://list.com', 'one', makeDb(1, []));
    backend.saveDatabase('https://list.com', 'two', makeDb(1, []));
    backend.saveDatabase('https://other.com', 'one', makeDb(1, []));

    const names = backend.listDatabases('https://list.com').sort();
    expect(names).toEqual(['one', 'two']);
  });

  it('deletes a database from disk', () => {
    backend.saveDatabase('https://del.com', 'gone', makeDb(1, []));
    expect(backend.loadDatabase('https://del.com', 'gone')).not.toBeNull();

    backend.deleteDatabase('https://del.com', 'gone');
    expect(backend.loadDatabase('https://del.com', 'gone')).toBeNull();
    expect(backend.listDatabases('https://del.com')).toEqual([]);
  });

  it('survives a fresh backend instance (restart)', () => {
    backend.saveDatabase('https://restart.com', 'data', makeDb(7, [['x', { id: 'x', n: 42 }]]));

    const fresh = new DiskIndexedDBBackend(path.join(tmpRoot, 'web-storage'));
    const loaded = fresh.loadDatabase('https://restart.com', 'data');
    expect(loaded!.version).toBe(7);
    expect(loaded!.objectStores.store.data[0][1]).toEqual({ id: 'x', n: 42 });
  });

  it('writes a loadable JSON file on disk', () => {
    backend.saveDatabase('https://file.com', 'db', makeDb(5, [['a', { id: 'a' }]]));
    const file = path.join(tmpRoot, 'web-storage', 'indexeddb-https___file.com-db.json');
    expect(fs.existsSync(file)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    expect(parsed.version).toBe(5);
  });
});
