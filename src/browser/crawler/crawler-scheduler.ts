/**
 * @file src/browser/crawler/crawler-scheduler.ts
 *
 * Orchestrates fetch -> extract -> index -> link-discovery over the
 * frontier in `CrawlerDb`, honoring per-domain politeness (concurrency 1
 * in-flight domain at a time, `robots.txt` crawl-delay between fetches)
 * and a curated-domain allow-list (links outside it are recorded in the
 * link graph but never enqueued).
 */

import { createHash } from 'node:crypto';
import { CrawlerDb } from './crawler-db';
import { CrawlerFetcher } from './crawler-fetcher';
import { RobotsCache } from './robots-cache';
import { extractLinks } from './link-extractor';
import { extractIndexableDocument } from '../search/content-extractor';
import { HtmlParser } from '../rendering/html-parser';
import { DomTree } from '../rendering/dom-tree';

export interface SchedulerOptions {
  readonly userAgent: string;
  /** Global concurrent fetches (each against a different domain). Default 4. */
  readonly concurrency?: number;
  /** Politeness floor between fetches to the same domain when robots.txt gives no Crawl-delay. Default 500ms. */
  readonly minDomainDelayMs?: number;
  /** Stop once this many pages have been fetched this run. Undefined = unbounded. */
  readonly maxPages?: number;
  /** Discovered links are only enqueued when their domain is in this set (still recorded in the link graph either way). */
  readonly allowedDomains: ReadonlySet<string>;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MIN_DOMAIN_DELAY_MS = 500;
const FAILURE_RETRY_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashContent(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

export class CrawlerScheduler {
  private running = false;
  private readonly inFlightDomains = new Set<string>();
  private pagesFetched = 0;

  constructor(
    private readonly db: CrawlerDb,
    private readonly fetcher: CrawlerFetcher,
    private readonly robots: RobotsCache,
    private readonly options: SchedulerOptions,
  ) {}

  enqueueSeed(url: string, priority = 10): void {
    const domain = new URL(url).hostname;
    this.db.enqueue({ url, domain, priority, discoveredAt: Date.now() });
  }

  /** Processes one eligible URL, if any. Returns false when nothing could be processed right now. */
  async runOnce(): Promise<boolean> {
    if (this.options.maxPages !== undefined && this.pagesFetched >= this.options.maxPages) return false;

    const next = this.db.nextEligible(Date.now(), [...this.inFlightDomains]);
    if (!next) return false;

    this.inFlightDomains.add(next.domain);
    this.db.markFetching(next.url);
    try {
      await this.processUrl(next.url, next.domain);
      this.pagesFetched++;
    } finally {
      this.inFlightDomains.delete(next.domain);
    }
    return true;
  }

  /** Runs worker loops until the frontier is empty or `stop()`/`maxPages` is hit. */
  async run(): Promise<void> {
    this.running = true;
    const concurrency = this.options.concurrency ?? DEFAULT_CONCURRENCY;
    await Promise.all(Array.from({ length: concurrency }, () => this.workerLoop()));
  }

  stop(): void {
    this.running = false;
  }

  get pagesFetchedCount(): number {
    return this.pagesFetched;
  }

  private async workerLoop(): Promise<void> {
    while (this.running) {
      if (this.options.maxPages !== undefined && this.pagesFetched >= this.options.maxPages) break;
      const did = await this.runOnce();
      if (!did) {
        if (this.db.frontierSize() === 0 && this.inFlightDomains.size === 0) break;
        await sleep(100); // everything eligible right now is domain-rate-limited or claimed by another worker
      }
    }
  }

  private async processUrl(url: string, domain: string): Promise<void> {
    const parsed = (() => { try { return new URL(url); } catch { return null; } })();
    const path = parsed?.pathname ?? '/';
    const origin = parsed?.origin ?? `https://${domain}`;

    if (!(await this.robots.canFetch(origin, path))) {
      this.db.markDone(url);
      return;
    }

    let fetched;
    try {
      fetched = await this.fetcher.fetch(url, { userAgent: this.options.userAgent });
    } catch {
      this.db.markFailed(url, FAILURE_RETRY_DELAY_MS);
      await this.applyPoliteness(domain, origin);
      return;
    }

    if (fetched.status >= 400) {
      this.db.markDone(url); // terminal for now — no retry budget for 4xx/5xx yet
      await this.applyPoliteness(domain, origin);
      return;
    }

    this.indexFetchedPage(fetched.finalUrl, fetched.body);
    this.db.markDone(url);
    await this.applyPoliteness(domain, origin);
  }

  private indexFetchedPage(finalUrl: string, html: string): void {
    const { document: htmlDoc } = new HtmlParser().parse(html, finalUrl);
    const tree = new DomTree();
    const dom = tree.buildFromHtml(htmlDoc);
    const extracted = extractIndexableDocument(dom, finalUrl, Date.now());
    if (!extracted) return;

    const contentHash = hashContent(extracted.body);
    if (this.db.hasContentHash(contentHash) && !this.db.isVisited(finalUrl)) {
      // Exact duplicate of a page already indexed under a different URL — record the
      // visit for dedup purposes but skip re-indexing it under this URL too.
      this.db.recordVisited(finalUrl, contentHash);
      return;
    }

    this.db.upsertDocument({ url: finalUrl, title: extracted.title, body: extracted.body, contentHash, fetchedAt: Date.now() });
    this.db.recordVisited(finalUrl, contentHash);

    const anchors = tree.getElementsByTagName('a');
    for (const link of extractLinks(anchors, finalUrl)) {
      this.db.addLinkEdge({ srcUrl: finalUrl, dstUrl: link.href, anchorText: link.anchorText });

      let linkDomain: string;
      try {
        linkDomain = new URL(link.href).hostname;
      } catch {
        continue;
      }
      if (this.options.allowedDomains.has(linkDomain) && !this.db.isVisited(link.href)) {
        this.db.enqueue({ url: link.href, domain: linkDomain, priority: 0, discoveredAt: Date.now() });
      }
    }
  }

  private async applyPoliteness(domain: string, origin: string): Promise<void> {
    const crawlDelayMs = await this.robots.crawlDelayMs(origin);
    const delayMs = crawlDelayMs ?? this.options.minDomainDelayMs ?? DEFAULT_MIN_DOMAIN_DELAY_MS;
    this.db.setDomainNextEligible(domain, Date.now() + delayMs);
  }
}
