import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface BookmarkEntry {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly iconUrl: string | null;
  readonly folder: boolean;
}

interface BookmarkQueryFn {
  (query: string): BookmarkEntry[] | Promise<BookmarkEntry[]>;
}

interface IBookmarkSuggestionsProvider extends OmniboxProvider {
  setQueryFn(fn: BookmarkQueryFn): void;
}

class BookmarkSuggestionsProvider implements IBookmarkSuggestionsProvider {
  readonly name = 'bookmark-suggestions';
  private queryFn: BookmarkQueryFn | null = null;

  setQueryFn(fn: BookmarkQueryFn): void {
    this.queryFn = fn;
  }

  getSuggestions(input: string, maxResults = 4): OmniboxResult[] | Promise<OmniboxResult[]> {
    const query = input.trim().toLowerCase();
    if (!query || !this.queryFn) return [];

    const result = this.queryFn(query);
    if (result instanceof Promise) {
      return result.then(entries => this.toResults(entries, query, maxResults));
    }
    return this.toResults(result, query, maxResults);
  }

  private toResults(entries: BookmarkEntry[], query: string, maxResults: number): OmniboxResult[] {
    const results: OmniboxResult[] = [];
    const score = 95;

    const scored = entries
      .filter(e => !e.folder && e.url)
      .map(e => {
        let s = score;
        const titleLower = e.title.toLowerCase();
        const urlLower = e.url!.toLowerCase();
        if (titleLower === query || urlLower === query) s += 20;
        else if (titleLower.startsWith(query) || urlLower.startsWith(query)) s += 10;
        else if (titleLower.includes(query) || urlLower.includes(query)) s += 0;
        return { entry: e, score: s };
      })
      .sort((a, b) => b.score - a.score);

    for (const { entry, score: s } of scored) {
      if (results.length >= maxResults) break;
      results.push({
        type: 'bookmark',
        text: entry.title,
        description: entry.url ?? '',
        url: entry.url ?? undefined,
        icon: entry.iconUrl ?? '⭐',
        score: s,
        source: this.name,
        action: 'navigate',
      });
    }

    return results;
  }
}

export { BookmarkSuggestionsProvider };
export type { IBookmarkSuggestionsProvider, BookmarkEntry, BookmarkQueryFn };
