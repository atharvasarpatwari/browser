/**
 * @file src/browser/crawler/robots-cache.ts
 *
 * Fetches and caches robots.txt per domain (backed by CrawlerDb's
 * robots_cache table), so the scheduler can check `isAllowed`/crawl-delay
 * without re-fetching robots.txt on every page.
 */

import { CrawlerDb } from './crawler-db';
import { parseRobotsTxt, isAllowed, serializeRules, deserializeRules, EMPTY_RULES, type RobotsRules } from './robots';

const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // re-fetch robots.txt once a day

export interface FetchText {
  (url: string): Promise<{ status: number; body: string } | null>;
}

export class RobotsCache {
  constructor(
    private readonly db: CrawlerDb,
    private readonly fetchText: FetchText,
    private readonly userAgent: string,
  ) {}

  /**
   * Returns the rules for `origin` (e.g. `"https://a.com"` or `"http://127.0.0.1:8080"`),
   * fetching/caching robots.txt if needed. Robots.txt is scoped per-origin (scheme + host
   * + port) per the de-facto standard — not just per-hostname — so the caller must pass a
   * full origin, not a bare hostname, or it will fetch the wrong (or an unreachable) URL.
   */
  async getRules(origin: string): Promise<RobotsRules> {
    const cached = this.db.getRobotsCache(origin);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
      return deserializeRules(cached.rules);
    }

    let rules: RobotsRules = EMPTY_RULES;
    try {
      const res = await this.fetchText(`${origin}/robots.txt`);
      if (res && res.status >= 200 && res.status < 300) {
        rules = parseRobotsTxt(res.body, this.userAgent);
      }
      // Any other status (404, 403, 5xx, unreachable) → treat as "no restrictions",
      // which matches how major crawlers behave when robots.txt is absent.
    } catch {
      rules = EMPTY_RULES;
    }

    this.db.setRobotsCache({
      domain: origin,
      rules: serializeRules(rules),
      crawlDelayMs: rules.crawlDelayMs,
      fetchedAt: Date.now(),
    });
    return rules;
  }

  async canFetch(origin: string, path: string): Promise<boolean> {
    const rules = await this.getRules(origin);
    return isAllowed(rules, path);
  }

  async crawlDelayMs(origin: string): Promise<number | null> {
    const rules = await this.getRules(origin);
    return rules.crawlDelayMs;
  }
}
