import { describe, it, expect, vi } from 'vitest';
import { ArchiveSuggestionsProvider } from '../src/browser/omnibox/archive-suggestions';
import type { ArchiveSource } from '../src/browser/omnibox/archive-suggestions';
import type { SearchHit } from '../src/browser/search/bm25-index';

const hit = (url: string, score: number, over: Partial<SearchHit> = {}): SearchHit => ({
  url, title: `Title of ${url}`, snippet: `snippet for ${url}`, highlights: [[0, 7]], score, visitedAt: 1,
  matchedTerms: 2, totalTerms: 2, ...over,
});

const source = (hits: SearchHit[]): ArchiveSource & { search: ReturnType<typeof vi.fn> } => ({
  search: vi.fn((_q: string, _o?: unknown) => hits),
}) as ArchiveSource & { search: ReturnType<typeof vi.fn> };

describe('ArchiveSuggestionsProvider', () => {
  it('maps hits to "from your archive" rows scaled between 55 and 74', () => {
    const p = new ArchiveSuggestionsProvider(source([hit('https://a', 10), hit('https://b', 5), hit('https://c', 1)]));
    const rows = p.getSuggestions('some query');
    expect(rows.map((r) => r.score)).toEqual([74, 65, 57]);
    expect(rows[0]).toEqual({
      type: 'archive', id: 'archive:https://a', text: 'Title of https://a', description: 'snippet for https://a',
      url: 'https://a', icon: '🗃️', hint: 'From your archive', score: 74, source: 'archive', action: 'navigate',
      meta: { highlights: [[0, 7]] },
    });
  });

  it('falls back to the URL when a page has no title or snippet', () => {
    const p = new ArchiveSuggestionsProvider(source([hit('https://a', 1, { title: '', snippet: '' })]));
    const [row] = p.getSuggestions('query');
    expect(row).toMatchObject({ text: 'https://a', description: 'https://a' });
  });

  it('only offers pages containing every typed word in the general omnibox', () => {
    const p = new ArchiveSuggestionsProvider(source([hit('https://all', 5), hit('https://some', 9, { matchedTerms: 1 })]));
    expect(p.getSuggestions('two words').map((r) => r.url)).toEqual(['https://all']);
  });

  it('is quiet for short input and in incognito, and never queries the archive then', () => {
    const src = source([hit('https://a', 1)]);
    let incognito = false;
    const p = new ArchiveSuggestionsProvider(src, () => incognito);
    expect(p.getSuggestions('ab')).toEqual([]);
    expect(p.getSuggestions('   ')).toEqual([]);
    expect(src.search).not.toHaveBeenCalled();
    incognito = true;
    expect(p.getSuggestions('plenty long')).toEqual([]);
    expect(p.search('plenty long')).toEqual([]);
    expect(src.search).not.toHaveBeenCalled();
  });

  it('asks the archive for a few more hits than it shows, then caps the rows', () => {
    const src = source([hit('https://a', 5), hit('https://b', 4), hit('https://c', 3), hit('https://d', 2)]);
    const p = new ArchiveSuggestionsProvider(src);
    expect(p.getSuggestions('query', 2)).toHaveLength(2);
    expect(src.search).toHaveBeenCalledWith('query', { limit: 6 });
  });

  describe('scoped @archive search', () => {
    it('allows partial matches and a bigger limit', () => {
      const src = source([hit('https://all', 5), hit('https://some', 4, { matchedTerms: 1 })]);
      const p = new ArchiveSuggestionsProvider(src);
      expect(p.search('two words').map((r) => r.url)).toEqual(['https://all', 'https://some']);
      expect(src.search).toHaveBeenCalledWith('two words', { limit: 10 });
      expect(p.search('two words', 3)).toHaveLength(2);
      expect(src.search).toHaveBeenLastCalledWith('two words', { limit: 3 });
    });

    it('ignores empty queries and honours a custom minimum length', () => {
      const src = source([hit('https://a', 1)]);
      expect(new ArchiveSuggestionsProvider(src).search('  ')).toEqual([]);
      expect(new ArchiveSuggestionsProvider(src, () => false, 5).getSuggestions('four')).toEqual([]);
      expect(new ArchiveSuggestionsProvider(src, () => false, 5).getSuggestions('fives')).toHaveLength(1);
    });
  });

  it('returns nothing when the archive has no hits', () => {
    expect(new ArchiveSuggestionsProvider(source([])).getSuggestions('query')).toEqual([]);
  });
});
