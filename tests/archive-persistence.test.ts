import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PersonalSearchArchive } from '../src/browser/search/search-archive';
import type { ArchiveDeps } from '../src/browser/search/search-archive';
import { MemoryIndexStorage } from '../src/browser/search/archive-storage';
import { Bm25Index } from '../src/browser/search/bm25-index';
import type { IndexableDocument, PersistedDoc } from '../src/browser/search/bm25-index';
import {
  COMPACT_AT, META_ID, RESTORE_SLICE, SHARD_SIZE, decodeMeta, decodeShard, encodeMeta, encodeShard, shardId, shardOf,
} from '../src/browser/search/archive-shards';

const S = SHARD_SIZE;
/** Two full shards and fifty pages in the newest. */
const PAGES = 2 * S + 50;

const doc = (url: string, body: string, extra: Partial<IndexableDocument> = {}): IndexableDocument => ({
  url, title: 'Title', headings: [], description: '', body, visitedAt: 1_000, ...extra,
});
const url = (i: number): string => `https://example.com/p${i}`;
const page = (i: number, extra: Partial<IndexableDocument> = {}): IndexableDocument => doc(url(i), `filler words page${i}`, { visitedAt: 1_000 + i, ...extra });
const shards = (count: number): string[] => Array.from({ length: count }, (_, i) => shardId(i));

describe('PersonalSearchArchive — sharded persistence', () => {
  let storage: MemoryIndexStorage;

  const make = (extra: Partial<ArchiveDeps> = {}) => new PersonalSearchArchive({
    storage, isEnabled: () => true, isIncognito: () => false, now: () => 1_000_000, saveDelayMs: 1000, ...extra,
  });
  const reload = async (extra: Partial<ArchiveDeps> = {}) => { const a = make(extra); await a.load(); return a; };
  const fill = (a: PersonalSearchArchive, count: number, from = 0): void => {
    for (let i = from; i < from + count; i++) expect(a.indexNow(page(i))).toBe(true);
  };
  const shardIds = (): string[] => [...storage.records.keys()].filter((id) => id.startsWith('shard:')).sort();
  const docsIn = (id: string): PersistedDoc[] => decodeShard(storage.records.get(id)!)!;
  const meta = () => decodeMeta(storage.records.get(META_ID) ?? null)!;
  const written = (spy: { mock: { calls: unknown[][] } }, call = 0): string[] =>
    (spy.mock.calls[call]![0] as Array<[string, string | null]>).map(([id]) => id).sort();
  const QUERIES = ['filler words', 'title', 'page7', `page${S + 9}`, 'nothing'];
  const answers = (a: PersonalSearchArchive) => QUERIES.map((q) => a.search(q, { limit: 8 }));

  beforeEach(() => { vi.useFakeTimers(); storage = new MemoryIndexStorage(); });
  afterEach(() => { vi.useRealTimers(); });

  describe('saving', () => {
    it('writes the newest shard and the meta record in one atomic batch', async () => {
      const commit = vi.spyOn(storage, 'commit');
      const a = make();
      fill(a, 3);
      await a.flush();
      expect(commit).toHaveBeenCalledTimes(1);
      expect(written(commit)).toEqual([META_ID, 'shard:00000']);
      expect(docsIn('shard:00000')).toHaveLength(3);
      expect(meta()).toEqual({ next: 3, removed: [] });
    });

    it(`starts a new shard every ${S} pages and afterwards rewrites only the newest, leaving older ones as they were`, async () => {
      const commit = vi.spyOn(storage, 'commit');
      const a = make();
      fill(a, PAGES);
      await a.flush();
      expect(shardIds()).toEqual(shards(3));
      expect(shards(3).map((id) => docsIn(id).length)).toEqual([S, S, 50]);
      const sealed = storage.records.get(shardId(1));

      commit.mockClear();
      a.indexNow(page(PAGES));
      await a.flush();
      expect(written(commit)).toEqual([META_ID, shardId(2)]);
      expect(storage.records.get(shardId(1))).toBe(sealed);
      expect(docsIn(shardId(2))).toHaveLength(51);
    });

    it('writes every shard that changed since the last save when pages arrived faster than saves', async () => {
      const commit = vi.spyOn(storage, 'commit');
      const a = make();
      fill(a, S + 10); // the first shard was outgrown before it was ever written
      await a.flush();
      expect(written(commit)).toEqual([META_ID, shardId(0), shardId(1)]);
      expect([docsIn(shardId(0)).length, docsIn(shardId(1)).length]).toEqual([S, 10]);
    });

    it('never reads while saving — it must work as the window closes, with no round trip to wait for', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      const b = await reload(); // a restored archive holds its newest shard whole, too
      const reads = [vi.spyOn(storage, 'read'), vi.spyOn(storage, 'list'), vi.spyOn(storage, 'loadLegacy')];
      b.indexNow(page(PAGES));
      await b.flush();
      expect(reads.map((r) => r.mock.calls.length)).toEqual([0, 0, 0]);
      expect(docsIn(shardId(2))).toHaveLength(51);
    });

    it('is a no-op when nothing changed, and a burst of changes is one save', async () => {
      const commit = vi.spyOn(storage, 'commit');
      const a = make();
      await a.flush();
      expect(commit).not.toHaveBeenCalled();
      fill(a, 5);
      await vi.advanceTimersByTimeAsync(1500);
      expect(commit).toHaveBeenCalledTimes(1);
      await a.flush();
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it('keeps what a failed save could not write, and writes it with the next one', async () => {
      const commit = vi.spyOn(storage, 'commit').mockRejectedValueOnce(new Error('disk full'));
      const a = make();
      fill(a, 3);
      await a.flush();
      expect(a.stats().lastError).toBe('disk full');
      expect(storage.records.size).toBe(0);
      a.indexNow(page(3));
      await a.flush();
      expect(commit).toHaveBeenCalledTimes(2);
      expect(a.stats().lastError).toBeNull();
      expect(docsIn(shardId(0))).toHaveLength(4);
    });
  });

  describe('loading', () => {
    const MANY = 5 * S + 40;

    it('restores every page and ranks exactly as before', async () => {
      const a = make();
      fill(a, MANY);
      await a.flush();
      const b = await reload();
      expect(b.stats()).toMatchObject({ documents: MANY, loaded: true, lastError: null });
      expect(answers(b)).toEqual(answers(a));
      expect(answers(b)[3]).toHaveLength(1); // that page is in the second shard
    });

    it('reads the meta record, then the shards oldest first, one at a time', async () => {
      const a = make();
      fill(a, MANY);
      await a.flush();
      const read = vi.spyOn(storage, 'read');
      await reload();
      expect(read.mock.calls.map((c) => c[0])).toEqual([META_ID, ...shards(6)]);
    });

    it(`gives the event loop a turn after every ${RESTORE_SLICE} restored pages, not just between shards`, async () => {
      const a = make();
      fill(a, 3 * S + 50);
      await a.flush();
      const yieldTask = vi.fn(async () => undefined);
      await reload({ yieldTask });
      expect(yieldTask).toHaveBeenCalledTimes(3 * Math.floor(S / RESTORE_SLICE) + Math.floor(50 / RESTORE_SLICE));
    });

    it('skips a damaged shard, loads the rest and says so', async () => {
      const a = make();
      fill(a, 3 * S + 50);
      await a.flush();
      storage.records.set(shardId(1), '{nope');
      const b = await reload();
      expect(b.stats().documents).toBe(2 * S + 50);
      expect(b.stats().lastError).toMatch(/1 archive shard could not be read/);
      expect(b.has(url(0))).toBe(true);
      expect(b.has(url(S + 5))).toBe(false);
      expect(b.has(url(3 * S + 49))).toBe(true);
    });

    it('copes with a missing or damaged meta record: the pages are all there and numbering carries on above them', async () => {
      const a = make();
      fill(a, 10);
      await a.flush();
      for (const broken of [null, '{nope']) {
        if (broken === null) storage.records.delete(META_ID); else storage.records.set(META_ID, broken);
        const b = await reload();
        expect(b.stats().documents).toBe(10);
        b.indexNow(page(100));
        await b.flush();
        expect(docsIn(shardId(0)).map((d) => d[6])).toEqual([...Array(10).keys(), 10]);
        storage.records.set(shardId(0), encodeShard(docsIn(shardId(0)).slice(0, 10))); // back to 10 pages for the next round
      }
    });

    it('starts empty on a database that holds nothing', async () => {
      expect((await reload()).stats()).toMatchObject({ documents: 0, loaded: true, lastError: null });
    });

    it('keeps the pages that were indexed while it was still loading, and saves them', async () => {
      const a = make();
      fill(a, 3);
      await a.flush();
      const b = make();
      const loading = b.load();
      expect(b.indexNow(page(500))).toBe(true); // accepted, but there is no index to put it in yet
      expect(b.stats().documents).toBe(0);
      await loading;
      expect(b.has(url(500))).toBe(true);
      expect(b.stats().documents).toBe(4);
      await b.flush();
      expect((await reload()).stats().documents).toBe(4);
    });

    it('is overtaken by clear(): the archive that was being read does not come back', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const realRead = storage.read.bind(storage);
      vi.spyOn(storage, 'read').mockImplementation(async (id) => { if (id === shardId(1)) await gate; return realRead(id); });
      const b = make();
      const loading = b.load();
      await vi.advanceTimersByTimeAsync(0); // shard 0 is read, shard 1 is waiting
      await b.clear();
      release();
      await loading;
      expect(b.stats()).toMatchObject({ documents: 0, loaded: true, lastError: null });
      expect(b.search('filler')).toEqual([]);
      await b.flush();
      expect(storage.records.size).toBe(0);
    });
  });

  describe('removing pages', () => {
    it('rewrites the newest shard when a page of it goes, but only records a tombstone for a page of an older one', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      const commit = vi.spyOn(storage, 'commit');

      a.remove(url(2 * S + 25)); // the newest shard is held whole: just rewrite it
      await a.flush();
      expect(written(commit, 0)).toEqual([META_ID, shardId(2)]);
      expect(docsIn(shardId(2))).toHaveLength(49);

      a.remove(url(10)); // an older shard is not held: a tombstone, nothing else is touched
      await a.flush();
      expect(written(commit, 1)).toEqual([META_ID]);
      expect(meta().removed).toEqual([10]);
      expect(docsIn(shardId(0))).toHaveLength(S); // still holds the page, until the background pass

      const b = await reload();
      expect(b.has(url(10))).toBe(false);
      expect(b.has(url(2 * S + 25))).toBe(false);
      expect(b.stats().documents).toBe(PAGES - 2);
    });

    it('stores a re-visited page once, in its new form', async () => {
      const a = make();
      fill(a, 5);
      await a.flush();
      a.indexNow(page(2, { body: 'completely different words', visitedAt: 5_000_000 }));
      await a.flush();
      const b = await reload();
      expect(b.stats().documents).toBe(5);
      expect(b.search('completely').map((h) => h.url)).toEqual([url(2)]);
      expect(b.search('page2')).toEqual([]);
    });

    it('evicts the oldest pages beyond the limit and keeps that after a restart', async () => {
      const a = make({ maxDocuments: PAGES - 20 });
      fill(a, PAGES);
      await a.flush();
      expect(a.stats().documents).toBe(PAGES - 20);
      const b = await reload({ maxDocuments: PAGES - 20 });
      expect(b.stats().documents).toBe(PAGES - 20);
      expect(b.has(url(19))).toBe(false);
      expect(b.has(url(20))).toBe(true);
    });
  });

  describe('background cleanup of older shards', () => {
    it(`drops tombstoned pages from an older shard once ${COMPACT_AT} have piled up, then forgets the tombstones`, async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      const commit = vi.spyOn(storage, 'commit');
      for (let i = 0; i < COMPACT_AT; i++) a.remove(url(i));
      await a.flush();
      await vi.advanceTimersByTimeAsync(2000); // the pass itself, then the save that records the shorter list

      expect(docsIn(shardId(0))).toHaveLength(S - COMPACT_AT);
      expect(meta().removed).toEqual([]);
      expect(commit.mock.calls.map((_, i) => written(commit, i))).toEqual([[META_ID], [shardId(0)], [META_ID]]); // the pass writes shards only
      const b = await reload();
      expect(b.stats().documents).toBe(PAGES - COMPACT_AT);
    });

    it('deletes a shard that no page is left in', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      for (let i = 0; i < S; i++) a.remove(url(i));
      await a.flush();
      await vi.advanceTimersByTimeAsync(2000);
      expect(shardIds()).toEqual([shardId(1), shardId(2)]);
      expect((await reload()).stats().documents).toBe(PAGES - S);
    });

    it('waits for enough tombstones: a few removals leave the shards alone', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      const read = vi.spyOn(storage, 'read');
      for (let i = 0; i < COMPACT_AT - 1; i++) a.remove(url(i));
      await a.flush();
      await vi.advanceTimersByTimeAsync(2000);
      expect(read).not.toHaveBeenCalled();
      expect(meta().removed).toHaveLength(COMPACT_AT - 1);
    });

    it('picks up where it left off after a restart: tombstones loaded with the archive start a pass', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      for (let i = 0; i < COMPACT_AT; i++) a.remove(url(i));
      // the window closes before the pass could run: only the save went out
      await a.flush();
      a.dispose();
      expect(meta().removed).toHaveLength(COMPACT_AT);
      await reload();
      await vi.advanceTimersByTimeAsync(2000);
      expect(docsIn(shardId(0))).toHaveLength(S - COMPACT_AT);
    });

    it('does nothing after clear(): an unfinished pass cannot bring a wiped archive back', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      for (let i = 0; i < COMPACT_AT; i++) a.remove(url(i));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const realRead = storage.read.bind(storage);
      vi.spyOn(storage, 'read').mockImplementation(async (id) => { await gate; return realRead(id); });
      await a.flush(); // starts the pass, which waits on its first read
      await a.clear();
      release();
      await vi.advanceTimersByTimeAsync(5000);
      expect(storage.records.size).toBe(0);
    });
  });

  describe('sequence numbers', () => {
    const seed = (seq: number): PersistedDoc => [url(1000 + seq), 'Title', `seed ${seq}`, 2, 1_000, `h${seq}`, seq, ['seed', `n${seq}`], [1, 1]];

    it('are never handed out again after a restart, so a new page cannot be swallowed by an old tombstone', async () => {
      const a = make();
      fill(a, S + 1);
      await a.flush();
      a.remove(url(S)); // the only page of the newest shard: it is deleted
      a.remove(url(S - 1)); // the last page of the older one: a tombstone for the highest seq it holds
      await a.flush();
      expect(meta()).toEqual({ next: S + 1, removed: [S - 1] });

      const b = await reload();
      b.indexNow(page(900));
      await b.flush();
      const c = await reload();
      expect(c.has(url(900))).toBe(true);
      expect(c.stats().documents).toBe(S);
    });

    it('are not reused after a cleanup that finished just before the window closed, whose tombstones are still on record', async () => {
      // the pass already dropped pages 10-12 from shard 0, but the save that forgets their tombstones never ran
      storage.records.set(shardId(0), encodeShard([...Array(10).keys()].map(seed)));
      storage.records.set(META_ID, encodeMeta({ next: 13, removed: [10, 11, 12] }));
      const a = await reload();
      a.indexNow(page(900));
      await a.flush();
      expect(docsIn(shardId(0)).map((d) => d[6])).toEqual([...Array(10).keys(), 13]);
      const b = await reload();
      expect(b.has(url(900))).toBe(true);
    });

    const FAR = 3 * S + 7;
    it.each([
      ['a stale', { next: 10, removed: [FAR, FAR + 1, FAR + 2] }],
      ['a missing', null],
    ])('stay above every page that was ever stored, even with %s meta record, so no older shard is overwritten', async (_, staleMeta) => {
      // shard 0 holds ten live pages; a much later shard holds three pages that are all tombstoned
      storage.records.set(shardId(0), encodeShard([...Array(10).keys()].map(seed)));
      storage.records.set(shardId(shardOf(FAR)), encodeShard([FAR, FAR + 1, FAR + 2].map(seed)));
      if (staleMeta) storage.records.set(META_ID, encodeMeta(staleMeta));
      const a = await reload();
      expect(a.stats().documents).toBe(staleMeta ? 10 : 13);

      a.indexNow(page(900));
      await a.flush();
      const b = await reload();
      expect(b.has(url(900))).toBe(true);
      expect([...Array(10).keys()].every((i) => b.has(url(1000 + i)))).toBe(true); // shard 0 was not overwritten with just the new page
    });
  });

  describe('importing an archive saved before sharding', () => {
    const legacyIndex = (count: number): Bm25Index => {
      const index = new Bm25Index();
      for (let i = 0; i < count; i++) index.upsert(page(i));
      return index;
    };

    it('searches it straight away, then rewrites it as shards and drops the old snapshot in one atomic batch', async () => {
      const old = legacyIndex(PAGES);
      storage.legacy = JSON.stringify(old.toSnapshot());
      const commit = vi.spyOn(storage, 'commit');
      const a = await reload();
      expect(a.stats().documents).toBe(PAGES);
      expect(answers(a)).toEqual(QUERIES.map((q) => old.search(q, { limit: 8 })));
      expect(storage.records.size).toBe(0); // nothing is written until the save that follows

      await vi.advanceTimersByTimeAsync(1500);
      expect(commit).toHaveBeenCalledTimes(1);
      expect(commit.mock.calls[0]![1]).toBe(true); // dropLegacy, in the same batch as the shards
      expect(storage.legacy).toBeNull();
      expect(shardIds()).toEqual(shards(3));
      expect(meta()).toEqual({ next: PAGES, removed: [] });

      const b = await reload();
      expect(b.stats().documents).toBe(PAGES);
      expect(answers(b)).toEqual(answers(a));
    });

    it('keeps the old snapshot when the migration fails, and tries again with the next save', async () => {
      storage.legacy = JSON.stringify(legacyIndex(5).toSnapshot());
      vi.spyOn(storage, 'commit').mockRejectedValueOnce(new Error('quota exceeded'));
      const a = await reload();
      await vi.advanceTimersByTimeAsync(1500);
      expect(a.stats().lastError).toBe('quota exceeded');
      expect(storage.legacy).not.toBeNull();
      expect(storage.records.size).toBe(0);

      await a.flush();
      expect(a.stats().lastError).toBeNull();
      expect(storage.legacy).toBeNull();
      expect((await reload()).stats().documents).toBe(5);
    });

    it('includes pages indexed between the import and the save, and numbers new ones above the imported', async () => {
      storage.legacy = JSON.stringify(legacyIndex(5).toSnapshot());
      const a = await reload();
      a.indexNow(page(50));
      await a.flush();
      const b = await reload();
      expect(b.stats().documents).toBe(6);
      expect(docsIn(shardId(0)).map((d) => d[6])).toEqual([0, 1, 2, 3, 4, 5]);
    });

    it('ignores a snapshot that is empty or of another version, and reports one that is not JSON', async () => {
      storage.legacy = JSON.stringify({ v: 99, docs: [], postings: [] });
      const other = await reload();
      expect(other.stats()).toMatchObject({ documents: 0, loaded: true, lastError: null });
      await vi.advanceTimersByTimeAsync(1500);
      expect(storage.legacy).not.toBeNull();
      expect(storage.records.size).toBe(0);

      storage.legacy = '{not json';
      expect((await reload()).stats().lastError).toBeTruthy();
    });

    it('prefers shards over a legacy snapshot that is still there (a drop that did not happen)', async () => {
      const a = make();
      fill(a, 5);
      await a.flush();
      storage.legacy = JSON.stringify(legacyIndex(2).toSnapshot());
      expect((await reload()).stats().documents).toBe(5);
    });
  });

  describe('clear()', () => {
    it('wipes the shards, the meta record and a legacy snapshot, and nothing comes back', async () => {
      const old = new Bm25Index();
      for (let i = 0; i < 3; i++) old.upsert(page(i));
      storage.legacy = JSON.stringify(old.toSnapshot());
      const a = await reload();
      fill(a, PAGES, 100);
      await a.flush();
      await a.clear();
      expect(storage.records.size).toBe(0);
      expect(storage.legacy).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(storage.records.size).toBe(0);
      expect((await reload()).stats().documents).toBe(0);
    });

    it('starts numbering and shard bookkeeping afresh', async () => {
      const a = make();
      fill(a, PAGES);
      await a.flush();
      await a.clear();
      fill(a, 3);
      await a.flush();
      expect(shardIds().length).toBeGreaterThan(0);
      expect((await reload()).stats().documents).toBe(3);
    });
  });
});
