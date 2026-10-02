import type { OmniboxProvider, OmniboxResult } from './omnibox';
import type { SearchHit, SearchOptions } from '../search/bm25-index';

interface ArchiveSource {
  search(query: string, options?: SearchOptions): SearchHit[];
}

/**
 * "From your archive" rows. In the general omnibox only pages containing every typed word are
 * offered (and never in incognito); the scoped `@archive` search relaxes both via `search()`.
 */
class ArchiveSuggestionsProvider implements OmniboxProvider {
  readonly name = 'archive';

  constructor(
    private readonly archive: ArchiveSource,
    private readonly isIncognito: () => boolean = () => false,
    private readonly minChars = 3,
  ) {}

  getSuggestions(input: string, maxResults = 3): OmniboxResult[] {
    const query = input.trim();
    if (query.length < this.minChars || this.isIncognito()) return [];
    return this.toResults(this.archive.search(query, { limit: maxResults * 3 }), maxResults, true);
  }

  /** Scoped `@archive <query>`: partial matches allowed, larger limit. */
  search(query: string, limit = 10): OmniboxResult[] {
    if (!query.trim() || this.isIncognito()) return [];
    return this.toResults(this.archive.search(query, { limit }), limit, false);
  }

  private toResults(hits: SearchHit[], limit: number, requireAllTerms: boolean): OmniboxResult[] {
    const usable = requireAllTerms ? hits.filter((h) => h.matchedTerms === h.totalTerms) : hits;
    const top = usable[0]?.score ?? 1;
    return usable.slice(0, limit).map((h) => ({
      type: 'archive' as const,
      id: `archive:${h.url}`,
      text: h.title || h.url,
      description: h.snippet || h.url,
      url: h.url,
      icon: '🗃️',
      hint: 'From your archive',
      // 55–74: below bookmarks/open tabs, comparable to history
      score: Math.round(55 + 19 * (h.score / top)),
      source: this.name,
      action: 'navigate' as const,
      meta: { highlights: h.highlights },
    }));
  }
}

export { ArchiveSuggestionsProvider };
export type { ArchiveSource };
