import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface HistoryEntry {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visitCount: number;
  readonly typedCount: number;
  readonly lastVisitTime: number;
}

interface HistoryQueryFn {
  (query: string, maxResults?: number): HistoryEntry[] | Promise<HistoryEntry[]>;
}

interface IHistorySuggestionsProvider extends OmniboxProvider {
  setQueryFn(fn: HistoryQueryFn): void;
}

function computeFrecency(entry: HistoryEntry): number {
  const visitScore = Math.min(entry.visitCount, 100) * 0.3;
  const typedScore = Math.min(entry.typedCount, 50) * 0.7;
  const recency = Math.max(0, 1 - (Date.now() - entry.lastVisitTime) / (30 * 24 * 60 * 60 * 1000));
  return visitScore + typedScore + recency * 10;
}

class HistorySuggestionsProvider implements IHistorySuggestionsProvider {
  readonly name = 'history-suggestions';
  private queryFn: HistoryQueryFn | null = null;

  setQueryFn(fn: HistoryQueryFn): void {
    this.queryFn = fn;
  }

  getSuggestions(input: string, maxResults = 4): OmniboxResult[] | Promise<OmniboxResult[]> {
    const query = input.trim().toLowerCase();
    if (!query || !this.queryFn) return [];

    const result = this.queryFn(query, maxResults * 2);
    if (result instanceof Promise) {
      return result.then(entries => this.toResults(entries, query, maxResults));
    }
    return this.toResults(result, query, maxResults);
  }

  private toResults(entries: HistoryEntry[], query: string, maxResults: number): OmniboxResult[] {
    const scored = entries
      .map(e => {
        let score = computeFrecency(e) * 10;
        const titleLower = e.title.toLowerCase();
        const urlLower = e.url.toLowerCase();
        if (titleLower === query || urlLower === query) score += 30;
        else if (titleLower.startsWith(query) || urlLower.startsWith(query)) score += 15;
        return { entry: e, score: Math.round(score) };
      })
      .sort((a, b) => b.score - a.score);

    const results: OmniboxResult[] = [];
    for (const { entry, score } of scored) {
      if (results.length >= maxResults) break;
      results.push({
        type: 'history',
        text: entry.title || entry.url,
        description: entry.url,
        url: entry.url,
        icon: '🕐',
        score,
        source: this.name,
        action: 'navigate',
      });
    }

    return results;
  }
}

export { HistorySuggestionsProvider, computeFrecency };
export type { IHistorySuggestionsProvider, HistoryEntry, HistoryQueryFn };
