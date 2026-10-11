/**
 * @file src/browser/crawler/web-index-port.ts
 *
 * Adapts the crawler's async IPC search (`crawler-client.ts`) into the
 * synchronous `ArchivePort`-shaped interface `SearchPage` expects
 * (src/ui/pages/search-page.ts). The crawler lives behind IPC in the main
 * process, so `search()` cannot block for the result the way the
 * in-renderer personal archive's `Bm25Index` does.
 *
 * Instead: `search(query)` returns the last-known cached results for that
 * exact query synchronously (empty on first call), and kicks off a
 * background refresh; when the refresh resolves, registered `onChange`
 * listeners fire so the caller can re-render — the same mechanism
 * `PersonalSearchArchive` already uses for its own async indexing updates.
 */

import type { SearchHit } from '../search/bm25-index';
import { searchWebIndex, getStats, type CrawlerSearchHit, type CrawlerStats } from './crawler-client';

export interface WebIndexStats {
  readonly documentCount: number;
  readonly frontierSize: number;
  readonly pagesFetched: number;
  readonly running: boolean;
}

const EMPTY_STATS: WebIndexStats = { documentCount: 0, frontierSize: 0, pagesFetched: 0, running: false };

/** Splits a `<mark>…</mark>`-wrapped snippet into plain text + highlight ranges (never injects raw HTML). */
function parseMarkedSnippet(marked: string): { text: string; highlights: Array<readonly [number, number]> } {
  const highlights: Array<readonly [number, number]> = [];
  let text = '';
  let i = 0;
  for (;;) {
    const start = marked.indexOf('<mark>', i);
    if (start === -1) { text += marked.slice(i); break; }
    text += marked.slice(i, start);
    const end = marked.indexOf('</mark>', start + 6);
    if (end === -1) { text += marked.slice(start); break; }
    const inner = marked.slice(start + 6, end);
    highlights.push([text.length, text.length + inner.length]);
    text += inner;
    i = end + 7;
  }
  return { text, highlights };
}

function toSearchHit(hit: CrawlerSearchHit): SearchHit {
  const { text, highlights } = parseMarkedSnippet(hit.snippet);
  return {
    url: hit.url,
    title: hit.title,
    snippet: text,
    highlights,
    score: hit.score,
    visitedAt: hit.fetchedAt,
    matchedTerms: 0,
    totalTerms: 0,
  };
}

export class WebIndexPort {
  private readonly listeners = new Set<() => void>();
  private cachedQuery = '';
  private cachedHits: SearchHit[] = [];
  private cachedStats: WebIndexStats = EMPTY_STATS;
  private inFlight: string | null = null;

  /** Synchronous — returns the cached results for `query`, triggering a background refresh if stale. */
  search(query: string): SearchHit[] {
    if (query !== this.cachedQuery) {
      this.cachedQuery = query;
      this.cachedHits = [];
      void this.refresh(query);
    }
    return this.cachedHits;
  }

  stats(): WebIndexStats {
    void this.refreshStats();
    return this.cachedStats;
  }

  onChange(handler: () => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private async refresh(query: string): Promise<void> {
    if (!query || this.inFlight === query) return;
    this.inFlight = query;
    try {
      const hits = await searchWebIndex(query);
      if (this.cachedQuery === query) {
        this.cachedHits = hits.map(toSearchHit);
        this.notify();
      }
    } catch {
      // IPC unavailable or main-process error — leave the cache as-is (empty on first failure).
    } finally {
      if (this.inFlight === query) this.inFlight = null;
    }
  }

  private async refreshStats(): Promise<void> {
    try {
      const stats: CrawlerStats = await getStats();
      this.cachedStats = {
        documentCount: stats.documentCount,
        frontierSize: stats.frontierSize,
        pagesFetched: stats.pagesFetched,
        running: stats.running,
      };
      this.notify();
    } catch {
      // bridge unavailable — keep last-known stats
    }
  }
}
