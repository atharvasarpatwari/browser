/**
 * @file src/browser/crawler/crawler-client.ts
 *
 * Renderer-side client for the `nova:crawler` IPC channel exposed by
 * `electron/preload.cjs` -> `electron/crawler-service.cjs`. Mirrors the
 * `getNovaIpcBridge()` pattern in src/browser/networking/socket-proxy.ts
 * (an inline cast on `globalThis`, no ambient global declaration).
 */

export interface CrawlerSearchHit {
  readonly url: string;
  readonly title: string;
  /** Plain text with `<mark>`/`</mark>` wrapping the matched terms — not raw HTML from the crawled page. */
  readonly snippet: string;
  readonly score: number;
  readonly fetchedAt: number;
}

export interface CrawlerStats {
  readonly pagesFetched: number;
  readonly frontierSize: number;
  readonly documentCount: number;
  readonly allowedDomains: readonly string[];
  readonly running: boolean;
}

interface NovaCrawlerBridge {
  request(payload: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function getBridge(): NovaCrawlerBridge | null {
  if (typeof globalThis === 'undefined') return null;
  const bridge = (globalThis as { nova?: { crawler?: NovaCrawlerBridge } }).nova;
  return bridge?.crawler ?? null;
}

/** True when running inside Electron with the crawler bridge available (false in tests/web preview). */
export function isCrawlerAvailable(): boolean {
  return getBridge() !== null;
}

export async function addSeed(url: string): Promise<void> {
  const bridge = getBridge();
  if (!bridge) throw new Error('crawler-client: nova.crawler bridge is unavailable');
  await bridge.request({ action: 'addSeed', url });
}

export async function startCrawl(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) throw new Error('crawler-client: nova.crawler bridge is unavailable');
  await bridge.request({ action: 'start' });
}

export async function stopCrawl(): Promise<void> {
  const bridge = getBridge();
  if (!bridge) throw new Error('crawler-client: nova.crawler bridge is unavailable');
  await bridge.request({ action: 'stop' });
}

export async function getStats(): Promise<CrawlerStats> {
  const bridge = getBridge();
  if (!bridge) throw new Error('crawler-client: nova.crawler bridge is unavailable');
  const res = await bridge.request({ action: 'stats' });
  return res as unknown as CrawlerStats;
}

export async function searchWebIndex(query: string, limit = 20): Promise<CrawlerSearchHit[]> {
  const bridge = getBridge();
  if (!bridge) return [];
  const res = await bridge.request({ action: 'search', query, limit });
  return (res.hits as CrawlerSearchHit[] | undefined) ?? [];
}
