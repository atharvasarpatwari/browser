import { describe, it, expect } from 'vitest';
import { Bm25Index, oneEditApart } from '../src/browser/search/bm25-index';
import type { IndexableDocument } from '../src/browser/search/bm25-index';

const doc = (url: string, title: string, body: string, extra: Partial<IndexableDocument> = {}): IndexableDocument => ({
  url, title, headings: [], description: '', body, visitedAt: 1_000, ...extra,
});
const find = (idx: Bm25Index, q: string, options: { fuzzy?: boolean; prefix?: boolean } = {}): string[] =>
  idx.search(q, { limit: 50, ...options }).map((h) => h.url);

function archive(): Bm25Index {
  const idx = new Bm25Index();
  idx.upsert(doc('https://a.test/quasar', 'Quasar notes', 'The quasar is a luminous galactic nucleus'));
  idx.upsert(doc('https://a.test/pasta', 'Pasta', 'Boil water, add salt and cook the spaghetti'));
  idx.upsert(doc('https://a.test/black', 'Black holes', 'A black hole is a region of spacetime'));
  return idx;
}

describe('oneEditApart', () => {
  it.each([
    ['quasar', 'quazar', 'a wrong letter'],
    ['quasar', 'quasr', 'a missing letter'],
    ['quasar', 'quassar', 'an extra letter'],
    ['quasar', 'qausar', 'two swapped neighbours'],
    ['quasar', 'quasa', 'a missing last letter'],
    ['quasar', 'quasars', 'an extra last letter'],
    ['quasar', 'quasaz', 'a wrong last letter'],
    ['quasar', 'quasra', 'a swap at the end'],
    ['quasar', 'uasar', 'a missing first letter'],
    ['quasar', 'zuasar', 'a wrong first letter'],
  ])('%s ~ %s (%s)', (a, b) => {
    expect(oneEditApart(a, b)).toBe(true);
    expect(oneEditApart(b, a)).toBe(true);
  });

  it.each([
    ['quasar', 'quasar'], // the same word is not a typo of itself
    ['quasar', 'quazaz'], // two wrong letters
    ['quasar', 'quas'], // two missing
    ['quasar', 'quasarse'], // two extra
    ['quasar', 'ruasaq'], // two letters swapped that are not neighbours
    ['quasar', 'qaausr'], // scrambled
    ['', ''],
  ])('%s is not one edit from %s', (a, b) => {
    expect(oneEditApart(a, b)).toBe(false);
    expect(oneEditApart(b, a)).toBe(false);
  });
});

describe('Bm25Index — fuzzy search', () => {
  it('is off by default: a misspelled word finds nothing', () => {
    expect(find(archive(), 'quazar')).toEqual([]);
    expect(find(archive(), 'quazar', { fuzzy: false })).toEqual([]);
  });

  it.each([
    ['quazar', 'a wrong letter'],
    ['quasr', 'a missing letter'],
    ['quassar', 'an extra letter'],
    ['qausar', 'swapped neighbours'],
  ])('finds the page for %s (%s)', (typo) => {
    expect(find(archive(), typo, { fuzzy: true })).toEqual(['https://a.test/quasar']);
  });

  it('corrects a word inside a longer query, and the page with every word comes first', () => {
    const idx = archive();
    idx.upsert(doc('https://a.test/other', 'Other', 'A luminous lamp'));
    const hits = idx.search('quazar luminous', { fuzzy: true });
    expect(hits.map((h) => h.url)).toEqual(['https://a.test/quasar', 'https://a.test/other']);
    expect(hits[0]).toMatchObject({ matchedTerms: 2, totalTerms: 2 });
    expect(hits[1]).toMatchObject({ matchedTerms: 1, totalTerms: 2 });
  });

  it('highlights the word the page really has, not the one that was typed', () => {
    const hit = archive().search('quazar', { fuzzy: true })[0]!;
    const [start, end] = hit.highlights[0]!;
    expect(hit.snippet.slice(start, end).toLowerCase()).toBe('quasar');
  });

  it('never fuzzes a word that exists, however rare', () => {
    const idx = archive();
    idx.upsert(doc('https://a.test/typo', 'Typo', 'I once wrote quazar by mistake')); // "quazar" is now a word of the archive
    expect(find(idx, 'quazar', { fuzzy: true })).toEqual(['https://a.test/typo']); // and not the quasar page as well
  });

  it('scores a near miss at half the weight of the same word typed correctly', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/exact', 'x', 'nebula filler words about nothing special here today'));
    const exact = idx.search('nebula', { fuzzy: true })[0]!.score;
    const typo = idx.search('nebulla', { fuzzy: true })[0]!.score; // "nebulla" is absent: matched through "nebula"
    expect(typo).toBeCloseTo(exact * 0.5, 10);
  });

  it('leaves short words alone: a three-letter word is too easily another word', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/cat', 'Cat', 'The cat sat on the mat'));
    expect(find(idx, 'mot', { fuzzy: true })).toEqual([]); // one letter from "mat"
    expect(find(idx, 'matt', { fuzzy: true })).toEqual(['https://a.test/cat']); // four letters is enough
  });

  it('leaves numbers alone: another year is not a typo', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/y1998', 'Year', 'The 1998 world cup'));
    expect(find(idx, '1999', { fuzzy: true })).toEqual([]);
  });

  it('only looks at words that start with the typed first letter', () => {
    expect(find(archive(), 'zuasar', { fuzzy: true })).toEqual([]); // "quasar" is one wrong first letter away
  });

  it('adds at most five near words, the most widespread first', () => {
    const idx = new Bm25Index();
    const near = ['krobd', 'krobf', 'krobg', 'krobk', 'krobl', 'krobm', 'krobn']; // all one letter from "krobt"
    near.forEach((w) => idx.upsert(doc(`https://a.test/${w}`, w, w)));
    for (let i = 0; i < 3; i++) idx.upsert(doc(`https://a.test/more-${i}`, 'more', 'krobd krobf')); // these two are the most widespread
    const urls = find(idx, 'krobt', { fuzzy: true });
    expect(urls).toHaveLength(8); // the 3 shared pages + 5 single-word pages (krobd, krobf and three of the other five); never all seven words
    expect(urls).toContain('https://a.test/krobd');
    expect(urls).toContain('https://a.test/krobf');
  });

  it('as the last word it is for typos, not for as-you-type: a word with completions is not fuzzed', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/quasar', 'Quasar', 'quasar light'));
    idx.upsert(doc('https://a.test/quasi', 'Quasi', 'quasi stellar')); // one letter from "quasa", but not a completion of it
    expect(find(idx, 'quasa', { fuzzy: true })).toEqual(['https://a.test/quasar']); // completes to quasar; "quasi" is not offered
    expect(find(idx, 'quasa', { fuzzy: true, prefix: false })).toContain('https://a.test/quasi'); // completion not asked for: a typo
  });

  it('does not guess a typo inside a half-typed word: it is corrected once the word is complete', () => {
    expect(find(archive(), 'quaza', { fuzzy: true })).toEqual([]);
    expect(find(archive(), 'quazar', { fuzzy: true })).toEqual(['https://a.test/quasar']);
  });

  it('does not return removed pages', () => {
    const idx = archive();
    idx.remove('https://a.test/quasar');
    expect(find(idx, 'quazar', { fuzzy: true })).toEqual([]);
  });

  it('works on an index restored from a snapshot', () => {
    const restored = Bm25Index.fromSnapshot(JSON.parse(JSON.stringify(archive().toSnapshot())));
    expect(find(restored, 'quazar', { fuzzy: true })).toEqual(['https://a.test/quasar']);
  });

  it('changes nothing for a query without a typo', () => {
    const idx = archive();
    for (const q of ['quasar', 'black hole', 'spag', 'luminous nucleus', 'zebra']) {
      expect(idx.search(q, { fuzzy: true })).toEqual(idx.search(q));
    }
  });

  it('corrects typos in other scripts too', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/ru', 'Квазар', 'Квазар — активное ядро галактики'));
    expect(find(idx, 'квазор', { fuzzy: true })).toEqual(['https://a.test/ru']);
  });
});
