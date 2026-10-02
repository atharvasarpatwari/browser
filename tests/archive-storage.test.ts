import { describe, it, expect } from 'vitest';
import { IndexedDbIndexStorage, MemoryIndexStorage } from '../src/browser/search/archive-storage';

/** Just enough of IDBFactory for the adapter: one database, named object stores, get/put/delete. */
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
  it('round-trips and clears', async () => {
    const s = new MemoryIndexStorage();
    expect(await s.load()).toBeNull();
    await s.save('data');
    expect(await s.load()).toBe('data');
    await s.clear();
    expect(await s.load()).toBeNull();
  });
});

describe('IndexedDbIndexStorage', () => {
  it('creates its object store on first open and round-trips the snapshot', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    expect(await s.load()).toBeNull();
    expect(stores.has('kv')).toBe(true);
    await s.save('{"v":1}');
    expect(await s.load()).toBe('{"v":1}');
    await s.save('{"v":2}');
    expect(await s.load()).toBe('{"v":2}');
  });

  it('shares one connection across calls', async () => {
    const { factory, opens } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.load();
    await s.save('x');
    await s.clear();
    expect(opens()).toBe(1);
  });

  it('clear() removes the snapshot', async () => {
    const { factory } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.save('x');
    await s.clear();
    expect(await s.load()).toBeNull();
  });

  it('ignores non-string records', async () => {
    const { factory, stores } = fakeIndexedDb();
    const s = new IndexedDbIndexStorage(factory);
    await s.load();
    stores.get('kv')!.set('snapshot', { not: 'a string' });
    expect(await s.load()).toBeNull();
  });

  it('keeps separate databases/keys independent', async () => {
    const { factory } = fakeIndexedDb();
    const a = new IndexedDbIndexStorage(factory, 'db', 'one');
    const b = new IndexedDbIndexStorage(factory, 'db', 'two');
    await a.save('A');
    await b.save('B');
    expect(await a.load()).toBe('A');
    expect(await b.load()).toBe('B');
  });

  it('rejects when IndexedDB is unavailable', async () => {
    const s = new IndexedDbIndexStorage(null);
    await expect(s.load()).rejects.toThrow('IndexedDB is unavailable');
    await expect(s.save('x')).rejects.toThrow('unavailable');
    await expect(s.clear()).rejects.toThrow('unavailable');
  });

  it('surfaces open failures and retries on the next call', async () => {
    const flags = { failOpen: true };
    const { factory } = fakeIndexedDb(flags);
    const s = new IndexedDbIndexStorage(factory);
    await expect(s.load()).rejects.toThrow('open failed');
    flags.failOpen = false;
    expect(await s.load()).toBeNull();
  });

  it('rejects a blocked open', async () => {
    const { factory } = fakeIndexedDb({ blocked: true });
    await expect(new IndexedDbIndexStorage(factory).load()).rejects.toThrow('blocked');
  });

  it('surfaces write failures', async () => {
    const { factory } = fakeIndexedDb({ failWrites: true });
    const s = new IndexedDbIndexStorage(factory);
    await expect(s.save('x')).rejects.toThrow('write failed');
    await expect(s.clear()).rejects.toThrow('write failed');
  });
});
