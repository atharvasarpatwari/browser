import { describe, it, expect } from 'vitest';
import { IndexedDbIndexStorage, MemoryIndexStorage } from '../src/browser/search/archive-storage';

/** Just enough of IDBFactory for the adapter: one database, named object stores, get/getAllKeys/put/delete. */
function fakeIndexedDb(flags: { failOpen?: boolean; failWrites?: boolean; blocked?: boolean } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  let created = false;
  let opens = 0;
  const factory = {
    open() {
      opens++;
      const req = {} as Record<string, unknown> & { result?: unknown; error?: unknown };
      queueMicrotask(() => {
        if (flags.failOpen) {
          req.error = new Error('open failed');
          (req.onerror as (() => void) | undefined)?.();
          return;
        }
        if (flags.blocked) { (req.onblocked as (() => void) | undefined)?.(); return; }
        req.result = {
          createObjectStore(name: string) { stores.set(name, new Map()); return {}; },
          transaction(name: string) {
            const tx = {} as Record<string, unknown> & { error?: unknown };
            const map = stores.get(name)!;
            const finish = (): void => {
              queueMicrotask(() => {
                if (flags.failWrites) {
                  tx.error = new Error('write failed');
                  (tx.onerror as (() => void) | undefined)?.();
                } else (tx.oncomplete as (() => void) | undefined)?.();
              });
            };
            tx.objectStore = () => ({
              get(key: string) {
                const r = {} as Record<string, unknown> & { result?: unknown };
                queueMicrotask(() => { r.result = map.get(key); (r.onsuccess as (() => void) | undefined)?.(); });
                return r;
              },
              getAllKeys() {
                const r = {} as Record<string, unknown> & { result?: unknown };
                queueMicrotask(() => { r.result = [...map.keys()]; (r.onsuccess as (() => void) | undefined)?.(); });
                return r;
              },
              put(value: unknown, key: string) { if (!flags.failWrites) map.set(key, value); finish(); return {}; },
              delete(key: string) { if (!flags.failWrites) map.delete(key); finish(); return {}; },
            });
            return tx;
          },
        };
        if (!created) { created = true; (req.onupgradeneeded as (() => void) | undefined)?.(); }
        (req.onsuccess as (() => void) | undefined)?.();
      });
      return req;
    },
  };
  return { factory: factory as unknown as IDBFactory, stores, opens: () => opens };
}

describe('MemoryIndexStorage', () => {
  it('writes and deletes records in a batch, and lists them', async () => {
    const s = new MemoryIndexStorage();
    expect(await s.list()).toEqual([]);
    await s.commit([['a', '1'], ['b', '2']]);
    expect((await s.list()).sort()).toEqual(['a', 'b']);
    expect(await s.read('a')).toBe('1');
    expect(await s.read('missing')).toBeNull();
    await s.commit([['a', null], ['c', '3']]);
    expect((await s.list()).sort()).toEqual(['b', 'c']);
    expect(await s.read('a')).toBeNull();
  });

  it('holds the legacy snapshot apart, and drops it only when asked', async () => {
    const s = new MemoryIndexStorage();
    expect(await s.loadLegacy()).toBeNull();
    s.legacy = '{"v":1}';
    expect(await s.loadLegacy()).toBe('{"v":1}');
    await s.commit([['a', '1']]);
    expect(await s.loadLegacy()).toBe('{"v":1}');
    await s.commit([['b', '2']], true);
    expect(await s.loadLegacy()).toBeNull();
    expect((await s.list()).sort()).toEqual(['a', 'b']);
  });

  it('clear() removes the records and the legacy snapshot', async () => {
    const s = new MemoryIndexStorage();
    s.legacy = 'x';
    await s.commit([['a', '1']]);
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(await s.loadLegacy()).toBeNull();
  });
});

describe('IndexedDbIndexStorage', () => {
  it('creates its object store on first open and reads the legacy snapshot', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    expect(await s.loadLegacy()).toBeNull();
    expect(stores.has('kv')).toBe(true);
    stores.get('kv')!.set('snapshot', '{"v":1}');
    expect(await s.loadLegacy()).toBe('{"v":1}');
  });

  it('writes records under the archive key and lists only its own ids', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.commit([['shard:00000', 'one'], ['meta', 'm']]);
    expect([...stores.get('kv')!.keys()].sort()).toEqual(['snapshot/meta', 'snapshot/shard:00000']);
    expect((await s.list()).sort()).toEqual(['meta', 'shard:00000']);
    expect(await s.read('shard:00000')).toBe('one');
    expect(await s.read('nope')).toBeNull();
    stores.get('kv')!.set('snapshot', 'legacy'); // the legacy record is not a record of the archive
    expect((await s.list()).sort()).toEqual(['meta', 'shard:00000']);
  });

  it('a batch writes, overwrites and deletes together; dropLegacy deletes the legacy snapshot in the same batch', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.loadLegacy(); // opens the database (the fake creates its store then)
    stores.get('kv')!.set('snapshot', 'legacy');
    await s.commit([['a', '1'], ['b', '2']]);
    await s.commit([['a', null], ['b', '2b'], ['c', '3']]);
    expect(await s.read('a')).toBeNull();
    expect(await s.read('b')).toBe('2b');
    expect(await s.loadLegacy()).toBe('legacy');
    await s.commit([['d', '4']], true);
    expect(await s.loadLegacy()).toBeNull();
    expect((await s.list()).sort()).toEqual(['b', 'c', 'd']);
  });

  it('shares one connection across calls', async () => {
    const { factory, opens } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.loadLegacy();
    await s.list();
    await s.commit([['a', '1']]);
    await s.clear();
    expect(opens()).toBe(1);
  });

  it('clear() removes the records and the legacy snapshot, and nothing of other archives', async () => {
    const { factory } = fakeIndexedDb();
    const a = new IndexedDbIndexStorage(factory, 'db', 'one');
    const b = new IndexedDbIndexStorage(factory, 'db', 'two');
    await a.commit([['x', '1']]);
    await b.commit([['x', '2']]);
    await a.clear();
    expect(await a.list()).toEqual([]);
    expect(await a.loadLegacy()).toBeNull();
    expect(await b.read('x')).toBe('2');
  });

  it('ignores non-string records', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.loadLegacy();
    stores.get('kv')!.set('snapshot', { not: 'a string' });
    stores.get('kv')!.set('snapshot/a', { not: 'a string' });
    expect(await s.loadLegacy()).toBeNull();
    expect(await s.read('a')).toBeNull();
  });

  it('keeps archives sharing a database independent', async () => {
    const { factory } = fakeIndexedDb();
    const a = new IndexedDbIndexStorage(factory, 'db', 'one');
    const b = new IndexedDbIndexStorage(factory, 'db', 'two');
    await a.commit([['x', 'A']]);
    await b.commit([['x', 'B'], ['y', 'B2']]);
    expect(await a.read('x')).toBe('A');
    expect(await b.read('x')).toBe('B');
    expect(await a.list()).toEqual(['x']);
    expect((await b.list()).sort()).toEqual(['x', 'y']);
  });

  it('rejects when IndexedDB is unavailable', async () => {
    const s = new IndexedDbIndexStorage(null);
    await expect(s.loadLegacy()).rejects.toThrow('IndexedDB is unavailable');
    await expect(s.list()).rejects.toThrow('unavailable');
    await expect(s.commit([['a', '1']])).rejects.toThrow('unavailable');
    await expect(s.clear()).rejects.toThrow('unavailable');
  });

  it('surfaces open failures and retries on the next call', async () => {
    const flags = { failOpen: true };
    const { factory } = fakeIndexedDb(flags);
    const s = new IndexedDbIndexStorage(factory);
    await expect(s.loadLegacy()).rejects.toThrow('open failed');
    flags.failOpen = false;
    expect(await s.loadLegacy()).toBeNull();
  });

  it('rejects a blocked open', async () => {
    const { factory } = fakeIndexedDb({ blocked: true });
    await expect(new IndexedDbIndexStorage(factory).loadLegacy()).rejects.toThrow('blocked');
  });

  it('surfaces write failures, and a failed batch changes nothing', async () => {
    const { factory, stores } = fakeIndexedDb({ failWrites: true });
    const s = new IndexedDbIndexStorage(factory);
    await expect(s.commit([['a', '1']])).rejects.toThrow('write failed');
    await expect(s.clear()).rejects.toThrow('write failed');
    expect([...stores.get('kv')!.keys()]).toEqual([]);
  });
});
