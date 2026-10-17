import { describe, it, expect } from 'vitest';
import { Bm25Index, hashText, buildSnippet } from '../src/browser/search/bm25-index';
import type { IndexableDocument } from '../src/browser/search/bm25-index';

const doc = (url: string, title: string, body: string, extra: Partial<IndexableDocument> = {}): IndexableDocument => ({
  url, title, headings: [], description: '', body, visitedAt: 1_000, ...extra,
});
const urls = (idx: Bm25Index, q: string, limit = 50): string[] => idx.search(q, { limit }).map((h) => h.url);

describe('Bm25Index — retrieval', () => {
  it('finds the documents that contain the query terms', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a.test/rust', 'Rust book', 'Learn the Rust programming language and ownership'));
    idx.upsert(doc('https://a.test/py', 'Python docs', 'Python is a dynamic programming language'));
    idx.upsert(doc('https://a.test/pasta', 'Pasta', 'Boil water and add salt'));
    expect(idx.size).toBe(3);
    expect(urls(idx, 'rust')).toEqual(['https://a.test/rust']);
    expect(urls(idx, 'programming language').sort()).toEqual(['https://a.test/py', 'https://a.test/rust']);
    expect(idx.search('zebra')).toEqual([]);
    expect(idx.search('')).toEqual([]);
    expect(idx.search('the and')).toHaveLength(0); // stop words only, and none are in the index
  });

  it('weights title above headings above body', () => {
    const idx = new Bm25Index();
    const filler = 'filler words about nothing in particular here';
    idx.upsert(doc('https://t', 'Quasar', filler));
    idx.upsert(doc('https://h', 'Other', filler, { headings: [{ level: 1, text: 'Quasar' }] }));
    idx.upsert(doc('https://b', 'Misc', 'filler quasar words about nothing in particular here'));
    expect(urls(idx, 'quasar')).toEqual(['https://t', 'https://h', 'https://b']);
  });

  it('weights h1 above h3 and meta description above body', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://h1', 'A', 'padding words only', { headings: [{ level: 1, text: 'nebula' }] }));
    idx.upsert(doc('https://h3', 'B', 'padding words only', { headings: [{ level: 3, text: 'nebula' }] }));
    expect(urls(idx, 'nebula')).toEqual(['https://h1', 'https://h3']);

    const idx2 = new Bm25Index();
    idx2.upsert(doc('https://meta', 'C', 'padding words only', { description: 'about the pulsar' }));
    idx2.upsert(doc('https://body', 'D', 'padding words only pulsar'));
    expect(urls(idx2, 'pulsar')).toEqual(['https://meta', 'https://body']);
  });

  it('matches across inflections and ignores stop words in the query', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://x', 'Shoes', 'Running shoes for runners and joggers'));
    expect(urls(idx, 'run shoe')).toEqual(['https://x']);
    expect(urls(idx, 'runs')).toEqual(['https://x']);
    expect(urls(idx, 'the running')).toEqual(urls(idx, 'running'));
  });

  it('ranks pages containing every term above pages with more of just one', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://both', 'X', 'alpha beta'));
    idx.upsert(doc('https://one', 'Y', 'alpha alpha alpha alpha alpha alpha'));
    const [first, second] = idx.search('alpha beta');
    expect(first).toMatchObject({ url: 'https://both', matchedTerms: 2, totalTerms: 2 });
    expect(second).toMatchObject({ url: 'https://one', matchedTerms: 1, totalTerms: 2 });
  });

  it('prefers rare terms over common ones (IDF)', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://1', 'One', 'common common common'));
    idx.upsert(doc('https://2', 'Two', 'rare'));
    idx.upsert(doc('https://3', 'Three', 'common'));
    idx.upsert(doc('https://4', 'Four', 'common'));
    expect(idx.search('common rare')[0]!.url).toBe('https://2');
  });

  it('normalises for document length', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://long', 'L', 'rust ' + 'lorem '.repeat(300)));
    idx.upsert(doc('https://short', 'S', 'rust'));
    expect(urls(idx, 'rust')).toEqual(['https://short', 'https://long']);
  });

  it('expands the last word by prefix for as-you-type search, unless disabled', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://p', 'P', 'programming languages'));
    expect(urls(idx, 'progr')).toEqual(['https://p']);
    expect(urls(idx, 'programming langu')).toEqual(['https://p']);
    expect(idx.search('progr', { prefix: false })).toEqual([]);
    expect(urls(idx, 'p')).toEqual([]); // a one-letter prefix is too broad to expand
  });

  it('honours the result limit', () => {
    const idx = new Bm25Index();
    for (let i = 0; i < 5; i++) idx.upsert(doc(`https://x/${i}`, `T${i}`, 'shared term'));
    expect(idx.search('shared', { limit: 2 })).toHaveLength(2);
    expect(idx.search('shared')).toHaveLength(5);
  });

  it('handles German and CJK text', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://de', 'Haustiere', 'Die Katze sitzt auf dem Tisch'));
    idx.upsert(doc('https://jp', '大学', '東京大学は日本の大学です'));
    expect(urls(idx, 'katze')).toEqual(['https://de']);
    expect(urls(idx, 'TISCH')).toEqual(['https://de']);
    expect(urls(idx, '東京')).toEqual(['https://jp']);
    expect(urls(idx, '京大')).toEqual(['https://jp']);
  });
});

describe('Bm25Index — updates', () => {
  it('replaces a page when it is indexed again', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a', 'A', 'apples oranges'));
    idx.upsert(doc('https://a', 'A', 'bananas'));
    expect(idx.size).toBe(1);
    expect(idx.search('apples')).toEqual([]);
    expect(urls(idx, 'bananas')).toEqual(['https://a']);
  });

  it('treats scheme, www and a trailing slash as the same page', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://www.example.com/a/', 'T', 'one'));
    idx.upsert(doc('http://example.com/a', 'T2', 'two'));
    expect(idx.size).toBe(1);
    expect(idx.has('https://example.com/a')).toBe(true);
    expect(urls(idx, 'two')).toEqual(['http://example.com/a']);
  });

  it('removes pages', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a', 'A', 'apples'));
    expect(idx.remove('https://a')).toBe(true);
    expect(idx.remove('https://a')).toBe(false);
    expect(idx.has('https://a')).toBe(false);
    expect(idx.size).toBe(0);
    expect(idx.search('apples')).toEqual([]);
  });

  it('refuses pages with no indexable text, and a now-empty page drops its old entry', () => {
    const idx = new Bm25Index();
    expect(idx.upsert(doc('https://e', 'the and of', 'to be or not'))).toBe(false);
    expect(idx.size).toBe(0);
    idx.upsert(doc('https://e', 'Real', 'content here now'));
    expect(idx.upsert(doc('https://e', 'the and of', 'to be or not'))).toBe(false);
    expect(idx.size).toBe(0);
  });

  it('stays correct while tombstones accumulate and across compaction', () => {
    const idx = new Bm25Index();
    for (let i = 0; i < 300; i++) idx.upsert(doc(`https://x/${i}`, '', `unique${i}word shared marker`));
    for (let i = 0; i < 200; i++) idx.remove(`https://x/${i}`);
    expect(idx.size).toBe(100);
    expect(urls(idx, 'shared', 1000)).toHaveLength(100);
    expect(idx.search('unique5word')).toEqual([]);
    expect(urls(idx, 'unique250word')).toEqual(['https://x/250']);
    idx.toSnapshot(); // forces compaction
    expect(idx.termCount).toBe(102); // 100 unique terms + "share" + "marker"
    expect(urls(idx, 'unique299word')).toEqual(['https://x/299']);
  });

  it('evicts the least recently visited pages', () => {
    const idx = new Bm25Index();
    for (let i = 1; i <= 5; i++) idx.upsert(doc(`https://x/${i}`, `T${i}`, `word${i}`, { visitedAt: i * 1000 }));
    expect(idx.removeOldest(2)).toBe(2);
    expect(idx.has('https://x/1')).toBe(false);
    expect(idx.has('https://x/2')).toBe(false);
    expect(idx.has('https://x/3')).toBe(true);
    expect(idx.size).toBe(3);
  });

  it('clears everything', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a', 'A', 'apples'));
    idx.clear();
    expect(idx.size).toBe(0);
    expect(idx.termCount).toBe(0);
    expect(idx.search('apples')).toEqual([]);
  });

  it('exposes a content hash so unchanged pages can be skipped', () => {
    const idx = new Bm25Index();
    const a = doc('https://h', 'T', 'body');
    idx.upsert(a);
    expect(idx.getRecord('https://h')).toEqual({ hash: Bm25Index.hashOf(a), visitedAt: 1000 });
    expect(Bm25Index.hashOf(a)).toBe(Bm25Index.hashOf(doc('https://other', 'T', 'body')));
    expect(Bm25Index.hashOf(a)).not.toBe(Bm25Index.hashOf(doc('https://h', 'T', 'body changed')));
    expect(idx.getRecord('https://unknown')).toBeUndefined();
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('Bm25Index — snippets', () => {
  it('shows a window around the first match with highlight ranges into the snippet', () => {
    const idx = new Bm25Index();
    const body = 'Lorem ipsum dolor sit amet, '.repeat(10) + 'the quick brown fox jumps over the lazy dog. ' + 'more filler text '.repeat(10);
    idx.upsert(doc('https://s', 'Fox story', body));
    const [hit] = idx.search('fox');
    expect(hit!.snippet.startsWith('…')).toBe(true);
    expect(hit!.snippet).toContain('quick brown fox jumps');
    expect(hit!.highlights).toHaveLength(1);
    for (const [s, e] of hit!.highlights) expect(hit!.snippet.slice(s, e).toLowerCase()).toBe('fox');
  });

  it('highlights stemmed and prefix matches', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://s', 'S', 'Many runners were running yesterday'));
    const stemmed = idx.search('run')[0]!;
    expect(stemmed.highlights.map(([s, e]) => stemmed.snippet.slice(s, e))).toEqual(['runners', 'running']);
    const prefix = idx.search('yest')[0]!;
    expect(prefix.highlights.map(([s, e]) => prefix.snippet.slice(s, e))).toEqual(['yesterday']);
  });

  it('falls back to the page opening when the match is only in the title', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://t', 'Quasar', 'nothing relevant in the body of this page'));
    const [hit] = idx.search('quasar');
    expect(hit!.snippet).toBe('nothing relevant in the body of this page');
    expect(hit!.highlights).toEqual([]);
  });

  it('buildSnippet handles short text, no match, and long text', () => {
    expect(buildSnippet('short text', new Set(['zzz']), null)).toEqual({ text: 'short text', highlights: [] });
    expect(buildSnippet('x'.repeat(300), new Set(), null).text.endsWith('…')).toBe(true);
    expect(buildSnippet('', new Set(['a']), null)).toEqual({ text: '', highlights: [] });
  });

  it('returns plain text only — page markup is left for the UI to escape', () => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://x', 'X', '<script>alert(1)</script> fox'));
    expect(idx.search('fox')[0]!.snippet).toContain('<script>');
  });
});

describe('Bm25Index — persistence', () => {
  const build = (): Bm25Index => {
    const idx = new Bm25Index();
    idx.upsert(doc('https://a', 'Rust book', 'Learn the Rust programming language'));
    idx.upsert(doc('https://b', 'Python', 'Python programming language docs'));
    idx.upsert(doc('https://gone', 'Gone', 'will be removed'));
    idx.remove('https://gone');
    return idx;
  };

  it('round-trips through JSON with identical results', () => {
    const idx = build();
    const restored = Bm25Index.fromSnapshot(JSON.parse(JSON.stringify(idx.toSnapshot())));
    expect(restored.size).toBe(2);
    expect(restored.search('programming language').map((h) => h.url)).toEqual(idx.search('programming language').map((h) => h.url));
    expect(restored.search('rust')[0]!.score).toBeCloseTo(idx.search('rust')[0]!.score, 10);
    expect(restored.search('removed')).toEqual([]);
    expect(restored.has('https://a')).toBe(true);
  });

  it('keeps working after being restored (further upserts and removals)', () => {
    const restored = Bm25Index.fromSnapshot(JSON.parse(JSON.stringify(build().toSnapshot())));
    restored.upsert(doc('https://c', 'C', 'brand new page about gardening'));
    restored.remove('https://a');
    expect(urls(restored, 'gardening')).toEqual(['https://c']);
    expect(urls(restored, 'rust')).toEqual([]);
    expect(restored.size).toBe(2);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a string', 'x'],
    ['an empty object', {}],
    ['a future version', { v: 2, docs: [], postings: [] }],
    ['non-array docs', { v: 1, docs: 'x', postings: [] }],
    ['a short doc tuple', { v: 1, docs: [['u', 't', 's', 1, 2]], postings: [] }],
    ['an out-of-range posting id', { v: 1, docs: [['u', 't', 's', 1, 2, 'h']], postings: [['term', [5], [1]]] }],
    ['mismatched posting arrays', { v: 1, docs: [['u', 't', 's', 1, 2, 'h']], postings: [['term', [0], [1, 2]]] }],
  ])('rejects a malformed snapshot: %s', (_label, data) => {
    const idx = Bm25Index.fromSnapshot(data);
    expect(idx.size).toBe(0);
    expect(idx.termCount).toBe(0);
    expect(idx.search('term')).toEqual([]);
  });

  it('accepts a minimal hand-written snapshot', () => {
    const idx = Bm25Index.fromSnapshot({
      v: 1, docs: [['https://u', 'T', 'some text', 3, 10, 'h']], postings: [['text', [0], [1]]],
    });
    expect(idx.size).toBe(1);
    expect(idx.search('text')[0]).toMatchObject({ url: 'https://u', title: 'T' });
  });
});

describe('Bm25Index — scale smoke test', () => {
  it('answers queries in a few milliseconds on thousands of pages', () => {
    const idx = new Bm25Index();
    const vocab = Array.from({ length: 1500 }, (_, i) => `word${i}`);
    let seed = 42;
    const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let d = 0; d < 3000; d++) {
      const words: string[] = [];
      for (let k = 0; k < 60; k++) words.push(vocab[Math.floor(rnd() * vocab.length)]!);
      idx.upsert(doc(`https://p/${d}`, `Page ${d}`, words.join(' ')));
    }
    expect(idx.size).toBe(3000);

    const start = performance.now();
    for (let q = 0; q < 20; q++) idx.search(`${vocab[q]} ${vocab[q + 50]}`);
    const average = (performance.now() - start) / 20;
    // plan budget: < 15 ms at 10k pages; assert a loose bound so a loaded CI machine can't flake
    expect(average).toBeLessThan(50);
  });
});
