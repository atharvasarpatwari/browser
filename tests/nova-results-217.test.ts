/**
 * Windows app, phase 1: Nova's own search results. The archive, bookmarks and history are merged into one list, one entry
 * per page, and cut into pages; nothing here talks to an external search provider.
 */
import { describe, expect, it, vi } from 'vitest';
import { mergeResults, paginate, searchArchive, MAX_ARCHIVE_HITS, PAGE_SIZE } from '../src/browser/search/nova-results';
import type { SavedMatches } from '../src/browser/search/nova-results';
import type { SearchHit } from '../src/browser/search/bm25-index';

const hit = (url: string, over: Partial<SearchHit> = {}): SearchHit =>
  ({ url, title: `Title of ${url}`, snippet: 'a snippet', highlights: [[2, 7]], score: 1, visitedAt: 1000, matchedTerms: 1, totalTerms: 1, ...over });

describe('searchArchive', () => {
  it('asks the archive for up to the maximum, fuzzy and not prefix, and reports how long it took', () => {
    const archive = { search: vi.fn(() => [hit('https://a.example/1')]) };
    const clock = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(14.5);
    const local = searchArchive(archive, 'quasar', clock);
    expect(archive.search).toHaveBeenCalledWith('quasar', { limit: MAX_ARCHIVE_HITS, prefix: false, fuzzy: true });
    expect(local.hits).toHaveLength(1);
    expect(local.elapsedMs).toBe(4.5);
  });
});

describe('mergeResults', () => {
  const saved: SavedMatches = {
    bookmarks: [{ url: 'https://b.example/', title: 'My bookmark' }, { url: 'https://c.example/', title: 'Another' }, { url: 'https://d.example/', title: 'Third' }, { url: 'https://e.example/', title: 'Fourth' }],
    history: [{ url: 'https://h.example/x', title: 'Visited only', visitedAt: 5 }, { url: 'https://a.example/1', title: 'In the archive too', visitedAt: 6 }],
  };

  it('puts up to three bookmarks first, then archive pages, then the rest, and history the archive lacks', () => {
    const out = mergeResults([hit('https://a.example/1'), hit('https://a.example/2')], saved, 'all');
    expect(out.map((r) => [r.kind, r.url])).toEqual([
      ['bookmark', 'https://b.example/'], ['bookmark', 'https://c.example/'], ['bookmark', 'https://d.example/'],
      ['page', 'https://a.example/1'], ['page', 'https://a.example/2'],
      ['bookmark', 'https://e.example/'],
      ['history', 'https://h.example/x'], // https://a.example/1 is already shown as an archive page
    ]);
  });

  it('shows each page once even when the address differs by www or a trailing slash', () => {
    const out = mergeResults([hit('https://www.a.example/1/')], { bookmarks: [{ url: 'https://a.example/1', title: 'Same page' }], history: [] }, 'all');
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('bookmark');
  });

  it('the saved tab lists bookmarks then history and no archive pages', () => {
    const out = mergeResults([hit('https://a.example/9')], saved, 'saved');
    expect(out.map((r) => r.kind)).toEqual(['bookmark', 'bookmark', 'bookmark', 'bookmark', 'history', 'history']);
  });

  it('works with the archive alone while bookmarks and history are still loading', () => {
    const out = mergeResults([hit('https://a.example/1')], null, 'all');
    expect(out.map((r) => r.kind)).toEqual(['page']);
    expect(out[0]).toMatchObject({ snippet: 'a snippet', highlights: [[2, 7]], visitedAt: 1000 });
  });

  it('falls back to the address when a page has no title', () => {
    expect(mergeResults([hit('https://a.example/1', { title: '' })], null, 'all')[0]!.title).toBe('https://a.example/1');
  });
});

describe('paginate', () => {
  const many = Array.from({ length: 23 }, (_, i) => mergeResults([hit(`https://a.example/${i}`)], null, 'all')[0]!);

  it('cuts pages of ten and reports the totals', () => {
    const p2 = paginate(many, 2);
    expect(p2).toMatchObject({ total: 23, page: 2, pages: 3 });
    expect(p2.items).toHaveLength(PAGE_SIZE);
    expect(p2.items[0]!.url).toBe('https://a.example/10');
    expect(paginate(many, 3).items).toHaveLength(3);
  });

  it('clamps a page number that does not exist, and handles no results', () => {
    expect(paginate(many, 99).page).toBe(3);
    expect(paginate(many, 0).page).toBe(1);
    expect(paginate([], 1)).toMatchObject({ total: 0, page: 1, pages: 1, items: [] });
  });
});
