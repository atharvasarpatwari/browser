import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalSearchArchive } from '../src/browser/search/search-archive';
import type { ArchiveDeps } from '../src/browser/search/search-archive';
import { MemoryIndexStorage } from '../src/browser/search/archive-storage';
import type { IIndexStorage } from '../src/browser/search/archive-storage';
import type { IndexableDocument } from '../src/browser/search/bm25-index';

const doc = (url: string, body: string, extra: Partial<IndexableDocument> = {}): IndexableDocument => ({
  url, title: 'Title', headings: [], description: '', body, visitedAt: 1_000, ...extra,
});

describe('PersonalSearchArchive', () => {
  let storage: MemoryIndexStorage;
  let enabled: boolean;
  let incognito: boolean;
  let clock: number;

  const make = (extra: Partial<ArchiveDeps> = {}, store: IIndexStorage = storage) =>
    new PersonalSearchArchive({
      storage: store, isEnabled: () => enabled, isIncognito: () => incognito, now: () => clock, ...extra,
    });

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new MemoryIndexStorage();
    enabled = true;
    incognito = false;
    clock = 1_000_000;
  });
  afterEach(() => { vi.useRealTimers(); });

  describe('gating', () => {
    it('indexes only http(s) pages', () => {
      const a = make();
      expect(a.indexNow(doc('https://example.com/a', 'alpha content'))).toBe(true);
      expect(a.indexNow(doc('http://example.com/b', 'bravo content'))).toBe(true);
      for (const url of ['nova://settings', 'file:///C:/x.txt', 'about:blank', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://x/y']) {
        expect(a.indexNow(doc(url, 'charlie content'))).toBe(false);
        expect(a.enqueue(doc(url, 'charlie content'))).toBe(false);
      }
      expect(a.stats().documents).toBe(2);
    });

    it('does nothing when indexing is disabled or the window is incognito, re-checking on every call', () => {
      const a = make();
      enabled = false;
      expect(a.indexNow(doc('https://example.com/a', 'alpha content'))).toBe(false);
      expect(a.enqueue(doc('https://example.com/a', 'alpha content'))).toBe(false);
      enabled = true;
      incognito = true;
      expect(a.indexNow(doc('https://example.com/a', 'alpha content'))).toBe(false);
      incognito = false;
      expect(a.indexNow(doc('https://example.com/a', 'alpha content'))).toBe(true);
      enabled = false; // disabling does not hide what is already archived
      expect(a.search('alpha')).toHaveLength(1);
    });
  });

  describe('indexing', () => {
    it('makes pages searchable', () => {
      const a = make();
      a.indexNow(doc('https://example.com/rust', 'The Rust programming language'));
      expect(a.search('rust')[0]).toMatchObject({ url: 'https://example.com/rust' });
      expect(a.has('https://example.com/rust')).toBe(true);
      expect(a.stats()).toMatchObject({ documents: 1, loaded: false, pending: 0, lastError: null });
    });

    it('skips an unchanged page revisited within the window, but refreshes it afterwards or when it changed', () => {
      const a = make({ minRevisitMs: 1000 });
      const page = doc('https://example.com/a', 'alpha content', { visitedAt: clock });
      expect(a.indexNow(page)).toBe(true);
      clock += 500;
      expect(a.indexNow({ ...page, visitedAt: clock })).toBe(false); // same content, recent
      clock += 1000;
      expect(a.indexNow({ ...page, visitedAt: clock })).toBe(true); // same content, stale
      expect(a.indexNow({ ...page, body: 'alpha changed content', visitedAt: clock })).toBe(true); // new content
      expect(a.search('changed')).toHaveLength(1);
      expect(a.stats().documents).toBe(1);
    });

    it('evicts the oldest pages beyond maxDocuments', () => {
      const a = make({ maxDocuments: 3 });
      for (let i = 1; i <= 5; i++) a.indexNow(doc(`https://example.com/${i}`, `content number${i}`, { visitedAt: i * 100 }));
      expect(a.stats().documents).toBe(3);
      expect(a.has('https://example.com/1')).toBe(false);
      expect(a.has('https://example.com/2')).toBe(false);
      expect(a.has('https://example.com/5')).toBe(true);
    });

    it('returns false for pages with no indexable text', () => {
      expect(make().indexNow(doc('https://example.com/e', 'to be or not', { title: '' }))).toBe(false);
    });

    it('removes pages', async () => {
      const a = make();
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      expect(a.remove('https://example.com/a')).toBe(true);
      expect(a.remove('https://example.com/a')).toBe(false);
      expect(a.search('alpha')).toEqual([]);
    });
  });

  describe('background queue', () => {
    it('indexes one page per tick, in order, and reports progress', async () => {
      const a = make();
      const onChange = vi.fn();
      a.onChange(onChange);
      expect(a.enqueue(doc('https://example.com/1', 'first content'))).toBe(true);
      expect(a.enqueue(doc('https://example.com/2', 'second content'))).toBe(true);
      expect(a.stats().pending).toBe(2);
      expect(a.stats().documents).toBe(0);

      await vi.advanceTimersByTimeAsync(0);
      expect(a.stats()).toMatchObject({ documents: 1, pending: 1 });
      await vi.advanceTimersByTimeAsync(1); // a timer set during a tick lands 1 ms later under fake timers
      expect(a.stats()).toMatchObject({ documents: 2, pending: 0 });
      expect(onChange).toHaveBeenCalled();
    });

    it('drops queued pages when the archive is cleared', async () => {
      const a = make();
      a.enqueue(doc('https://example.com/1', 'first content'));
      await a.clear();
      await vi.advanceTimersByTimeAsync(10);
      expect(a.stats().documents).toBe(0);
      expect(a.stats().pending).toBe(0);
    });

    it('stops everything on dispose', async () => {
      const a = make();
      a.enqueue(doc('https://example.com/1', 'first content'));
      a.dispose();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(a.stats().documents).toBe(0);
      expect(storage.data).toBeNull();
    });
  });

  describe('persistence', () => {
    it('saves after a debounce and restores into a fresh archive', async () => {
      const a = make({ saveDelayMs: 1000 });
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      expect(storage.data).toBeNull();
      await vi.advanceTimersByTimeAsync(999);
      expect(storage.data).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(storage.data).not.toBeNull();
      expect(a.stats().lastSavedAt).toBe(clock);

      const b = make();
      await b.load();
      expect(b.isLoaded).toBe(true);
      expect(b.stats().documents).toBe(1);
      expect(b.search('alpha')[0]).toMatchObject({ url: 'https://example.com/a' });
    });

    it('coalesces bursts of changes into one save', async () => {
      const spy = vi.spyOn(storage, 'save');
      const a = make({ saveDelayMs: 1000 });
      for (let i = 0; i < 5; i++) {
        a.indexNow(doc(`https://example.com/${i}`, `content number${i}`));
        await vi.advanceTimersByTimeAsync(400);
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('flush() writes immediately and is a no-op when nothing changed', async () => {
      const spy = vi.spyOn(storage, 'save');
      const a = make();
      await a.flush();
      expect(spy).not.toHaveBeenCalled();
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      await a.flush();
      expect(spy).toHaveBeenCalledTimes(1);
      await a.flush();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('survives storage failures: reports the error, keeps the data dirty and retries later', async () => {
      let failing = true;
      const flaky: IIndexStorage = {
        load: async () => null,
        save: async (data) => { if (failing) throw new Error('disk full'); storage.data = data; },
        clear: async () => { storage.data = null; },
      };
      const a = make({}, flaky);
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      await a.flush();
      expect(a.stats().lastError).toBe('disk full');
      expect(a.search('alpha')).toHaveLength(1); // search is unaffected
      failing = false;
      a.indexNow(doc('https://example.com/b', 'bravo content'));
      await a.flush();
      expect(a.stats().lastError).toBeNull();
      expect(storage.data).not.toBeNull();
    });

    it('starts empty on missing, corrupt or unreadable storage', async () => {
      const fresh = make();
      await fresh.load();
      expect(fresh.stats()).toMatchObject({ documents: 0, loaded: true, lastError: null });

      storage.data = '{not json';
      const corrupt = make();
      await corrupt.load();
      expect(corrupt.stats()).toMatchObject({ documents: 0, loaded: true });
      expect(corrupt.stats().lastError).toBeTruthy();

      storage.data = JSON.stringify({ v: 99, docs: [], postings: [] });
      const wrongVersion = make();
      await wrongVersion.load();
      expect(wrongVersion.stats().documents).toBe(0);

      const broken = make({}, { load: async () => { throw new Error('idb gone'); }, save: async () => {}, clear: async () => {} });
      await broken.load();
      expect(broken.stats()).toMatchObject({ documents: 0, loaded: true, lastError: 'idb gone' });
    });

    it('clear() wipes memory and storage', async () => {
      const a = make({ saveDelayMs: 10 });
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      await vi.advanceTimersByTimeAsync(10);
      expect(storage.data).not.toBeNull();
      await a.clear();
      expect(storage.data).toBeNull();
      expect(a.search('alpha')).toEqual([]);
      await vi.advanceTimersByTimeAsync(10_000); // a pending debounced save must not resurrect it
      expect(storage.data).toBeNull();
    });

    it('removing a page schedules a save too', async () => {
      const a = make({ saveDelayMs: 10 });
      a.indexNow(doc('https://example.com/a', 'alpha content'));
      a.indexNow(doc('https://example.com/b', 'bravo content'));
      await vi.advanceTimersByTimeAsync(10);
      a.remove('https://example.com/a');
      await vi.advanceTimersByTimeAsync(10);
      const b = make();
      await b.load();
      expect(b.has('https://example.com/a')).toBe(false);
      expect(b.has('https://example.com/b')).toBe(true);
    });
  });

  it('a throwing change listener never breaks indexing; listeners can unsubscribe', () => {
    const a = make();
    const good = vi.fn();
    a.onChange(() => { throw new Error('listener bug'); });
    const off = a.onChange(good);
    expect(a.indexNow(doc('https://example.com/a', 'alpha content'))).toBe(true);
    expect(good).toHaveBeenCalledTimes(1);
    off();
    a.indexNow(doc('https://example.com/b', 'bravo content'));
    expect(good).toHaveBeenCalledTimes(1);
  });
});
