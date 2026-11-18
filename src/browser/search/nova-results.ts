import type { SearchHit, SearchOptions } from './bm25-index';
import { canonicalUrl } from '../omnibox/omnibox';

/**
 * Nova's own search results: what the personal archive (BM25 over the full text of pages you have visited), your bookmarks and
 * your history know about a query. No external search provider is involved. The archive part is synchronous and fast; bookmarks and
 * history are asynchronous stores, so the page paints the archive first and merges the rest in when it arrives.
 */

type ResultKind = 'page' | 'bookmark' | 'history';
type ResultTab = 'all' | 'saved';

interface NovaResult {
  readonly kind: ResultKind;
  readonly url: string;
  readonly title: string;
  /** Plain text; render it with `highlights`, never as HTML. Empty for bookmarks and history, which are not indexed by content. */
  readonly snippet: string;
  readonly highlights: ReadonlyArray<readonly [number, number]>;
  readonly visitedAt: number | null;
}

/** A bookmark or a history entry that matched. */
interface SavedMatch {
  readonly url: string;
  readonly title: string;
  readonly visitedAt?: number;
}

interface SavedMatches {
  readonly bookmarks: readonly SavedMatch[];
  readonly history: readonly SavedMatch[];
}

interface ArchiveSearchPort {
  search(query: string, options?: SearchOptions): SearchHit[];
}

/** Archive hits fetched for one query: pages of results are cut from them, so this is the most a query can show. */
const MAX_ARCHIVE_HITS = 100;
/** Bookmarks shown at the top of "All" (a Google-style "sitelink" cluster would be too much for a personal index). */
const MAX_TOP_BOOKMARKS = 3;
const PAGE_SIZE = 10;

interface LocalResults {
  readonly hits: SearchHit[];
  readonly elapsedMs: number;
}

/** The archive part of a search, timed. */
function searchArchive(archive: ArchiveSearchPort, query: string, now: () => number = () => performance.now()): LocalResults {
  const start = now();
  const hits = archive.search(query, { limit: MAX_ARCHIVE_HITS, prefix: false, fuzzy: true });
  return { hits, elapsedMs: Math.max(0, now() - start) };
}

const fromHit = (h: SearchHit): NovaResult => ({ kind: 'page', url: h.url, title: h.title || h.url, snippet: h.snippet, highlights: h.highlights, visitedAt: h.visitedAt });
const fromSaved = (kind: 'bookmark' | 'history', s: SavedMatch): NovaResult =>
  ({ kind, url: s.url, title: s.title || s.url, snippet: '', highlights: [], visitedAt: s.visitedAt ?? null });

/**
 * One ranked list from the three sources, each page once (by canonical address):
 * - **all**: up to three matching bookmarks first (you saved them on purpose), then the archive's pages in relevance order, then
 *   history entries the archive does not hold (visited, but not indexed: the setting was off, or it has not been reached yet);
 * - **saved**: every matching bookmark, then every matching history entry.
 */
function mergeResults(hits: readonly SearchHit[], saved: SavedMatches | null, tab: ResultTab): NovaResult[] {
  const seen = new Set<string>();
  const out: NovaResult[] = [];
  const add = (r: NovaResult): void => {
    const key = canonicalUrl(r.url);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  const bookmarks = saved?.bookmarks ?? [];
  const history = saved?.history ?? [];

  if (tab === 'saved') {
    for (const b of bookmarks) add(fromSaved('bookmark', b));
    for (const h of history) add(fromSaved('history', h));
    return out;
  }
  for (const b of bookmarks.slice(0, MAX_TOP_BOOKMARKS)) add(fromSaved('bookmark', b));
  for (const h of hits) add(fromHit(h));
  for (const b of bookmarks.slice(MAX_TOP_BOOKMARKS)) add(fromSaved('bookmark', b));
  for (const h of history) add(fromSaved('history', h));
  return out;
}

interface ResultsPage {
  readonly items: readonly NovaResult[];
  readonly total: number;
  /** 1-based, clamped to the pages that exist. */
  readonly page: number;
  readonly pages: number;
}

function paginate(results: readonly NovaResult[], page: number, pageSize: number = PAGE_SIZE): ResultsPage {
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: results.slice((current - 1) * pageSize, current * pageSize), total: results.length, page: current, pages };
}

export { searchArchive, mergeResults, paginate, MAX_ARCHIVE_HITS, MAX_TOP_BOOKMARKS, PAGE_SIZE };
export type { NovaResult, ResultKind, ResultTab, SavedMatch, SavedMatches, ArchiveSearchPort, LocalResults, ResultsPage };
