import { describe, it, expect } from 'vitest';
import { Bm25Index } from '../src/browser/search/bm25-index';
import type { IndexableDocument, IndexMutation, PersistedDoc } from '../src/browser/search/bm25-index';
import { SHARD_SIZE, decodeMeta, decodeShard, encodeMeta, encodeShard, parseShardId, shardId, shardOf } from '../src/browser/search/archive-shards';

const doc = (url: string, title: string, body: string, extra: Partial<IndexableDocument> = {}): IndexableDocument => ({
  url, title, headings: [], description: '', body, visitedAt: 1_000, ...extra,
});

function corpus(): Bm25Index {
  const idx = new Bm25Index();
  idx.upsert(doc('https://a.test/quasar', 'Quasar notes', 'The quasar is a luminous galactic nucleus', { headings: [{ level: 1, text: 'Quasars' }] }));
  idx.upsert(doc('https://a.test/pasta', 'Pasta', 'Boil water, add salt and cook the spaghetti', { description: 'A pasta recipe' }));
  idx.upsert(doc('https://a.test/black', 'Black holes', 'A black hole is a region of spacetime', { visitedAt: 5_000 }));
  return idx;
}

const QUERIES = ['quasar', 'black hole', 'spag', 'pasta recipe', 'luminous nucleus', 'zebra', 'the'];
const results = (idx: Bm25Index) => QUERIES.map((q) => idx.search(q, { limit: 20 }));

function record(idx: Bm25Index, run: () => void): IndexMutation[] {
  const events: IndexMutation[] = [];
  idx.observe((m) => events.push(m));
  run();
  idx.observe(null);
  return events;
}

describe('Bm25Index — observing changes', () => {
  it('reports a new page with its record and its term vector, under a fresh sequence number', () => {
    const idx = new Bm25Index();
    const [event] = record(idx, () => idx.upsert(doc('https://a.test/x', 'Quasar', 'quasar light', { visitedAt: 42 })));
    expect(event).toMatchObject({ type: 'add' });
    const page = (event as { doc: PersistedDoc }).doc;
    const [url, title, snippet, length, visitedAt, hash, seq, terms, tfs] = page;
    expect([url, title, snippet, visitedAt, seq]).toEqual(['https://a.test/x', 'Quasar', 'quasar light', 42, 0]);
    expect(length).toBe(3); // quasar (title) + quasar + light
    expect(hash).toBe(Bm25Index.hashOf({ title: 'Quasar', description: '', body: 'quasar light' }));
    expect(terms).toHaveLength(tfs.length);
    expect(Object.fromEntries(terms.map((t, i) => [t, tfs[i]]))).toEqual({ quasar: 5 + 1, light: 1 }); // title weight 5 + body weight 1
    expect(idx.nextSeq).toBe(1);
  });

  it('reports a removal by sequence number, and a re-visited page as a removal plus an add', () => {
    const idx = corpus();
    const events = record(idx, () => idx.upsert(doc('https://a.test/pasta', 'Pasta', 'new body about noodles')));
    expect(events.map((e) => e.type)).toEqual(['remove', 'add']);
    expect(events[0]).toEqual({ type: 'remove', seq: 1 });
    expect((events[1] as { doc: PersistedDoc }).doc[6]).toBe(3);
    const removed = record(idx, () => idx.remove('https://a.test/quasar'));
    expect(removed).toEqual([{ type: 'remove', seq: 0 }]);
    expect(record(idx, () => idx.remove('https://a.test/quasar'))).toEqual([]); // nothing to remove
  });

  it('reports a page with no indexable text only as the removal of the old copy', () => {
    const idx = corpus();
    const events = record(idx, () => idx.upsert(doc('https://a.test/pasta', '', 'to be or not')));
    expect(events).toEqual([{ type: 'remove', seq: 1 }]);
  });

  it('reports eviction of the oldest pages and clearing', () => {
    const idx = corpus();
    expect(record(idx, () => idx.removeOldest(2)).map((e) => e.type)).toEqual(['remove', 'remove']);
    expect(record(idx, () => idx.clear())).toEqual([{ type: 'clear' }]);
  });

  it('stops reporting when the observer is removed, and a compaction reports nothing', () => {
    const idx = new Bm25Index();
    for (let i = 0; i < 300; i++) idx.upsert(doc(`https://a.test/${i}`, `Page ${i}`, `word${i} filler`));
    const events = record(idx, () => { for (let i = 0; i < 200; i++) idx.remove(`https://a.test/${i}`); }); // enough tombstones to compact
    expect(events.every((e) => e.type === 'remove')).toBe(true);
    expect(events).toHaveLength(200);
    expect(record(idx, () => undefined)).toEqual([]);
  });

  it('numbers pages by a counter that survives removals: a sequence number is never reused', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/1', 'One', 'alpha'));
    idx.upsert(doc('https://a.test/2', 'Two', 'beta'));
    idx.remove('https://a.test/2');
    const [event] = record(idx, () => idx.upsert(doc('https://a.test/3', 'Three', 'gamma')));
    expect((event as { doc: PersistedDoc }).doc[6]).toBe(2);
  });

  it('can be told not to hand out numbers below a floor', () => {
    const idx = new Bm25Index();
    idx.reserveSeq(10);
    idx.reserveSeq(4); // never lowers it
    const [event] = record(idx, () => idx.upsert(doc('https://a.test/1', 'One', 'alpha')));
    expect((event as { doc: PersistedDoc }).doc[6]).toBe(10);
  });
});

describe('Bm25Index — persisted pages', () => {
  it('restores from the pages it reported, ranking exactly as the original', () => {
    const original = new Bm25Index();
    const pages: PersistedDoc[] = [];
    original.observe((m) => { if (m.type === 'add') pages.push(m.doc); });
    for (const d of [
      doc('https://a.test/quasar', 'Quasar notes', 'The quasar is a luminous galactic nucleus', { headings: [{ level: 1, text: 'Quasars' }] }),
      doc('https://a.test/pasta', 'Pasta', 'Boil water, add salt and cook the spaghetti', { description: 'A pasta recipe' }),
      doc('https://a.test/black', 'Black holes', 'A black hole is a region of spacetime', { visitedAt: 5_000 }),
    ]) original.upsert(d);

    const restored = new Bm25Index();
    for (const page of JSON.parse(JSON.stringify(pages)) as PersistedDoc[]) expect(restored.addPersisted(page)).toBe(true);
    expect(restored.size).toBe(3);
    expect(restored.nextSeq).toBe(3);
    expect(results(restored)).toEqual(results(original));
    expect(restored.getRecord('https://a.test/black')).toEqual(original.getRecord('https://a.test/black'));
  });

  it('exports every page with its term vector rebuilt, and the export restores the same index (the migration path)', () => {
    const original = corpus();
    original.remove('https://a.test/pasta'); // a hole in the numbering
    const exported = original.toPersisted();
    expect(exported.map((p) => p[6])).toEqual([0, 2]);
    const restored = new Bm25Index();
    for (const page of JSON.parse(JSON.stringify(exported)) as PersistedDoc[]) restored.addPersisted(page);
    expect(results(restored)).toEqual(results(original));
    expect(restored.nextSeq).toBe(3); // from the highest page, not the count
  });

  it('keeps the newer copy when a page address turns up twice, whichever order they arrive in', () => {
    const idx = new Bm25Index();
    const page = (seq: number, body: string): PersistedDoc => ['https://a.test/x', 'T', body, 1, 1, 'h', seq, [body], [1]];
    expect(idx.addPersisted(page(1, 'old'))).toBe(true);
    expect(idx.addPersisted(page(5, 'newer'))).toBe(true); // replaces the old copy
    expect(idx.addPersisted(page(3, 'stale'))).toBe(false); // older than what is there
    expect(idx.size).toBe(1);
    expect(idx.search('newer')).toHaveLength(1);
    expect(idx.search('old')).toEqual([]);
    expect(idx.nextSeq).toBe(6);
  });

  it('restoring is silent: the observer hears nothing', () => {
    const idx = new Bm25Index();
    const events = record(idx, () => { idx.addPersisted(['https://a.test/x', 'T', 's', 1, 1, 'h', 0, ['alpha'], [1]]); });
    expect(events).toEqual([]);
  });

  it('a legacy snapshot restores with sequence numbers equal to its page order', () => {
    const idx = Bm25Index.fromSnapshot(JSON.parse(JSON.stringify(corpus().toSnapshot())));
    expect(idx.toPersisted().map((p) => p[6])).toEqual([0, 1, 2]);
    expect(idx.nextSeq).toBe(3);
    const [event] = record(idx, () => idx.upsert(doc('https://a.test/new', 'New', 'fresh page')));
    expect((event as { doc: PersistedDoc }).doc[6]).toBe(3);
  });
});

describe('shard records', () => {
  it('assigns pages to shards by sequence number and names them so they sort', () => {
    expect(shardOf(0)).toBe(0);
    expect(shardOf(SHARD_SIZE - 1)).toBe(0);
    expect(shardOf(SHARD_SIZE)).toBe(1);
    expect(shardId(7)).toBe('shard:00007');
    expect(parseShardId('shard:00007')).toBe(7);
    expect(parseShardId('shard:123456')).toBe(123456);
    expect(['meta', 'shard:', 'shard:x', 'snapshot', 'shard:1:2']).toSatisfy((ids: string[]) => ids.every((id) => parseShardId(id) === null));
  });

  it('round-trips a shard and rejects anything that is not one', () => {
    const pages = [...corpus().toPersisted()];
    expect(decodeShard(encodeShard(pages))).toEqual(pages);
    expect(decodeShard(encodeShard([]))).toEqual([]);
    expect(decodeShard('{not json')).toBeNull();
    expect(decodeShard(JSON.stringify({ v: 1, docs: [] }))).toBeNull();
    expect(decodeShard(JSON.stringify({ v: 2 }))).toBeNull();
    expect(decodeShard(JSON.stringify({ v: 2, docs: 'x' }))).toBeNull();
    const bad = (page: unknown[]): string => JSON.stringify({ v: 2, docs: [page] });
    const good: unknown[] = ['u', 't', 's', 1, 1, 'h', 0, ['a'], [1]];
    expect(decodeShard(bad(good))).not.toBeNull();
    expect(decodeShard(bad(good.slice(0, 8)))).toBeNull(); // too short
    expect(decodeShard(bad([...good.slice(0, 7), ['a', 'b'], [1]]))).toBeNull(); // terms and counts differ in length
    expect(decodeShard(bad([...good.slice(0, 7), [1], [1]]))).toBeNull(); // a term that is not a string
    expect(decodeShard(bad([...good.slice(0, 7), ['a'], ['x']]))).toBeNull(); // a count that is not a number
    expect(decodeShard(bad([...good.slice(0, 6), -1, ['a'], [1]]))).toBeNull(); // a negative sequence number
    expect(decodeShard(bad([...good.slice(0, 6), 1.5, ['a'], [1]]))).toBeNull();
    expect(decodeShard(bad(['u', 't', 's', 'long', 1, 'h', 0, ['a'], [1]]))).toBeNull(); // length is not a number
  });

  it('round-trips the meta record and rejects anything that is not one', () => {
    expect(decodeMeta(encodeMeta({ next: 12, removed: [3, 9] }))).toEqual({ next: 12, removed: [3, 9] });
    expect(decodeMeta(null)).toBeNull();
    expect(decodeMeta('{nope')).toBeNull();
    expect(decodeMeta(JSON.stringify({ v: 1, next: 1, removed: [] }))).toBeNull();
    expect(decodeMeta(JSON.stringify({ v: 2, next: 'x', removed: [] }))).toBeNull();
    expect(decodeMeta(JSON.stringify({ v: 2, next: 1, removed: ['a'] }))).toBeNull();
  });
});
