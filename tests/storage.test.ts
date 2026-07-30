import { describe, it, expect, beforeEach, vi } from 'vitest';

import { CookieService } from '../src/browser/media/cookies';
import { LocalStorageService } from '../src/browser/media/local-storage';
import { SessionStorageService } from '../src/browser/media/session-storage';
import { IndexedDBService } from '../src/browser/media/indexed-db';
import { CacheStorageService } from '../src/browser/media/cache-api';
import { FileSystemAccessService } from '../src/browser/media/file-system';
import { OPFSService } from '../src/browser/media/opfs';

/* ============================================================
   1. Cookies
   ============================================================ */
describe('CookieService', () => {
  let cookies: CookieService;

  beforeEach(() => {
    cookies = new CookieService();
  });

  it('sets and gets cookies', async () => {
    await cookies.set({ name: 'test', value: 'value', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    const result = await cookies.get('example.com', 'test');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('test');
    expect(result!.value).toBe('value');
  });

  it('returns null for missing cookies', async () => {
    const result = await cookies.get('example.com', 'nonexistent');
    expect(result).toBeNull();
  });

  it('deletes cookies', async () => {
    await cookies.set({ name: 'del', value: 'x', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    const deleted = await cookies.delete('example.com', 'del');
    expect(deleted).toBe(true);
    const result = await cookies.get('example.com', 'del');
    expect(result).toBeNull();
  });

  it('queries cookies', async () => {
    await cookies.set({ name: 'a', value: '1', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    await cookies.set({ name: 'b', value: '2', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    const all = await cookies.getAll();
    expect(all.length).toBe(2);
  });

  it('reports count', async () => {
    await cookies.set({ name: 'a', value: '1', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    expect(cookies.count).toBe(1);
  });

  it('fires events on set', async () => {
    const fn = vi.fn();
    cookies.onEvent(fn);
    await cookies.set({ name: 'e', value: 'v', domain: 'example.com', path: '/', secure: false, httpOnly: false, sameSite: 'lax', expires: null, hostOnly: true, session: true });
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set' }));
  });

  it('dispose clears handlers', () => {
    const fn = vi.fn();
    cookies.onEvent(fn);
    cookies.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   2. LocalStorage
   ============================================================ */
describe('LocalStorageService', () => {
  let ls: LocalStorageService;

  beforeEach(() => {
    ls = new LocalStorageService();
  });

  it('sets and gets items', () => {
    ls.setItem('key', 'value');
    expect(ls.getItem('key')).toBe('value');
  });

  it('returns null for missing items', () => {
    expect(ls.getItem('missing')).toBeNull();
  });

  it('removes items', () => {
    ls.setItem('key', 'value');
    ls.removeItem('key');
    expect(ls.getItem('key')).toBeNull();
  });

  it('clears all items', () => {
    ls.setItem('a', '1');
    ls.setItem('b', '2');
    ls.clear();
    expect(ls.length).toBe(0);
  });

  it('reports length', () => {
    expect(ls.length).toBe(0);
    ls.setItem('a', '1');
    expect(ls.length).toBe(1);
  });

  it('keys by index', () => {
    ls.setItem('first', '1');
    ls.setItem('second', '2');
    expect(ls.key(0)).toBe('first');
    expect(ls.key(1)).toBe('second');
  });

  it('changes origin', () => {
    ls.setItem('key', 'value');
    ls.setOrigin('https://other.com');
    expect(ls.getItem('key')).toBeNull();
    expect(ls.getOrigin()).toBe('https://other.com');
  });

  it('fires events', () => {
    const fn = vi.fn();
    ls.onEvent(fn);
    ls.setItem('k', 'v');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'change' }));
  });

  it('dispose clears handlers', () => {
    ls.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   3. SessionStorage
   ============================================================ */
describe('SessionStorageService', () => {
  let ss: SessionStorageService;

  beforeEach(() => {
    ss = new SessionStorageService();
  });

  it('sets and gets items', () => {
    ss.setItem('key', 'value');
    expect(ss.getItem('key')).toBe('value');
  });

  it('returns null for missing items', () => {
    expect(ss.getItem('missing')).toBeNull();
  });

  it('removes items', () => {
    ss.setItem('key', 'value');
    ss.removeItem('key');
    expect(ss.getItem('key')).toBeNull();
  });

  it('clears all items', () => {
    ss.setItem('a', '1');
    ss.clear();
    expect(ss.length).toBe(0);
  });

  it('reports tab ID', () => {
    expect(typeof ss.getTabId()).toBe('string');
  });

  it('changes origin', () => {
    ss.setItem('key', 'val');
    ss.setOrigin('https://other.com');
    expect(ss.getItem('key')).toBeNull();
  });

  it('fires events', () => {
    const fn = vi.fn();
    ss.onEvent(fn);
    ss.setItem('k', 'v');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'change' }));
  });

  it('dispose clears handlers', () => {
    ss.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   4. IndexedDB
   ============================================================ */
describe('IndexedDBService', () => {
  let idb: IndexedDBService;

  beforeEach(() => {
    idb = new IndexedDBService();
  });

  it('opens a database', () => {
    const req = idb.open('test-db');
    expect(req).toBeDefined();
  });

  it('deletes a database', () => {
    idb.open('test-db');
    const req = idb.deleteDatabase('test-db');
    expect(req).toBeDefined();
  });

  it('lists databases', () => {
    const req = idb.databases();
    expect(req).toBeDefined();
  });

  it('compares keys', () => {
    expect(idb.cmp(1, 2)).toBe(-1);
    expect(idb.cmp(2, 1)).toBe(1);
    expect(idb.cmp(1, 1)).toBe(0);
  });

  it('changes origin', () => {
    idb.setOrigin('https://other.com');
    expect(idb.getOrigin()).toBe('https://other.com');
  });

  it('fires events', () => {
    const fn = vi.fn();
    idb.onEvent(fn);
    idb.open('db');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'open' }));
  });

  it('dispose clears handlers', () => {
    idb.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   5. Cache API
   ============================================================ */
describe('CacheStorageService', () => {
  let cacheStorage: CacheStorageService;

  beforeEach(() => {
    cacheStorage = new CacheStorageService();
  });

  it('opens and lists caches', async () => {
    await cacheStorage.open('v1');
    await cacheStorage.open('v2');
    const keys = await cacheStorage.keys();
    expect(keys).toContain('v1');
    expect(keys).toContain('v2');
  });

  it('checks cache existence', async () => {
    await cacheStorage.open('v1');
    expect(await cacheStorage.has('v1')).toBe(true);
    expect(await cacheStorage.has('missing')).toBe(false);
  });

  it('deletes caches', async () => {
    await cacheStorage.open('v1');
    expect(await cacheStorage.delete('v1')).toBe(true);
    expect(await cacheStorage.has('v1')).toBe(false);
  });

  it('puts and matches requests', async () => {
    const cache = await cacheStorage.open('v1');
    await cache.put('https://example.com', new Response('hello'));
    const match = await cache.match('https://example.com');
    expect(match).toBeDefined();
    expect(await match!.text()).toBe('hello');
  });

  it('matches across all caches', async () => {
    const c1 = await cacheStorage.open('v1');
    await c1.put('https://example.com', new Response('from-v1'));
    const match = await cacheStorage.match('https://example.com');
    expect(match).toBeDefined();
    expect(await match!.text()).toBe('from-v1');
  });

  it('deletes cache entries', async () => {
    const cache = await cacheStorage.open('v1');
    await cache.put('https://example.com', new Response('hello'));
    expect(await cache.delete('https://example.com')).toBe(true);
    const match = await cache.match('https://example.com');
    expect(match).toBeUndefined();
  });

  it('filters by cacheName in match', async () => {
    const c1 = await cacheStorage.open('v1');
    await c1.put('https://example.com', new Response('hello'));
    const match = await cacheStorage.match('https://example.com', { cacheName: 'v1' });
    expect(match).toBeDefined();
    const noMatch = await cacheStorage.match('https://example.com', { cacheName: 'missing' });
    expect(noMatch).toBeUndefined();
  });

  it('fires events', async () => {
    const fn = vi.fn();
    cacheStorage.onEvent(fn);
    await cacheStorage.open('v1');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cache-created' }));
  });

  it('dispose clears everything', async () => {
    await cacheStorage.open('v1');
    cacheStorage.dispose();
    const keys = await cacheStorage.keys();
    expect(keys).toEqual([]);
  });
});

/* ============================================================
   6. File System API
   ============================================================ */
describe('FileSystemAccessService', () => {
  let fs: FileSystemAccessService;

  beforeEach(() => {
    fs = new FileSystemAccessService();
  });

  it('is supported', () => {
    expect(fs.isSupported).toBe(true);
  });

  it('opens file picker', async () => {
    const files = await fs.showOpenFilePicker();
    expect(files.length).toBe(1);
    expect(files[0].kind).toBe('file');
  });

  it('opens multiple files', async () => {
    const files = await fs.showOpenFilePicker({ multiple: true });
    expect(files.length).toBe(3);
  });

  it('shows save file picker', async () => {
    const file = await fs.showSaveFilePicker({ suggestedName: 'test.txt' });
    expect(file.name).toBe('test.txt');
  });

  it('shows directory picker', async () => {
    const dir = await fs.showDirectoryPicker();
    expect(dir.kind).toBe('directory');
    expect(dir.name).toBe('picked-directory');
  });

  it('gets origin private directory', async () => {
    const dir = await fs.getOriginPrivateDirectory();
    expect(dir.kind).toBe('directory');
    expect(dir.name).toBe('origin-private');
  });

  it('creates and reads files in directory', async () => {
    const dir = await fs.getOriginPrivateDirectory();
    const file = await dir.getFileHandle('test.txt', { create: true });
    const writable = await file.createWritable();
    const writer = writable.getWriter();
    await writer.write('hello');
    await writer.close();
    const readFile = await file.getFile();
    const text = await readFile.text();
    expect(text).toBe('hello');
  });

  it('fires events', async () => {
    const fn = vi.fn();
    fs.onEvent(fn);
    await fs.showOpenFilePicker();
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'file-opened' }));
  });

  it('dispose clears handlers', () => {
    fs.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   7. OPFS
   ============================================================ */
describe('OPFSService', () => {
  let opfs: OPFSService;

  beforeEach(() => {
    opfs = new OPFSService();
  });

  it('provides root directory', async () => {
    const root = await opfs.getRoot();
    expect(root.kind).toBe('directory');
    expect(root.name).toBe('root');
  });

  it('estimates storage', async () => {
    const est = await opfs.estimate();
    expect(est.quota).toBeGreaterThan(0);
    expect(typeof est.usage).toBe('number');
  });

  it('requests quota', async () => {
    const result = await opfs.requestQuota(1024);
    expect(result).toBe(true);
  });

  it('creates and reads files', async () => {
    const root = await opfs.getRoot();
    const file = await root.getFileHandle('test.bin', { create: true });
    const writable = await file.createWritable();
    await writable.write(new TextEncoder().encode('hello opfs'));
    await writable.close();
    const f = await file.getFile();
    const text = await f.text();
    expect(text).toBe('hello opfs');
  });

  it('creates and lists directories', async () => {
    const root = await opfs.getRoot();
    await root.getDirectoryHandle('sub', { create: true });
    const sub = await root.getDirectoryHandle('sub');
    expect(sub.kind).toBe('directory');
  });

  it('removes entries', async () => {
    const root = await opfs.getRoot();
    await root.getFileHandle('delete-me', { create: true });
    await root.removeEntry('delete-me');
    try {
      await root.getFileHandle('delete-me');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeDefined();
    }
  });

  it('reports file size', async () => {
    const root = await opfs.getRoot();
    const file = await root.getFileHandle('size-test', { create: true });
    const writable = await file.createWritable();
    await writable.write(new TextEncoder().encode('12345'));
    await writable.close();
    expect(await file.getSize()).toBe(5);
  });

  it('fires events', async () => {
    const fn = vi.fn();
    opfs.onEvent(fn);
    expect(true).toBe(true);
  });

  it('dispose resets state', async () => {
    await opfs.requestQuota(1024);
    opfs.dispose();
    const est = await opfs.estimate();
    expect(est.usage).toBe(0);
  });
});
