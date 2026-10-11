/**
 * @file src/browser/crawler/crawler-db.ts
 *
 * SQLite-backed storage for the web crawler: URL frontier, dedup table,
 * robots.txt cache, crawled documents, and the FTS5 full-text index.
 *
 * Uses `node-sqlite3-wasm` (pure WASM, no native build step) rather than
 * `better-sqlite3` — this environment has no Visual Studio Build Tools and
 * no prebuilt binary for this Node/platform combo, so a native module
 * cannot be compiled or installed here. WASM works identically in plain
 * Node and in Electron's main process.
 */

import { Database } from 'node-sqlite3-wasm';

export type CrawlState = 'pending' | 'fetching' | 'done' | 'failed';

export interface FrontierEntry {
  readonly url: string;
  readonly domain: string;
  readonly priority: number;
  readonly discoveredAt: number;
}

export interface RobotsCacheEntry {
  readonly domain: string;
  readonly rules: string;
  readonly crawlDelayMs: number | null;
  readonly fetchedAt: number;
}

export interface CrawledDocument {
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly contentHash: string;
  readonly fetchedAt: number;
}

export interface LinkEdge {
  readonly srcUrl: string;
  readonly dstUrl: string;
  readonly anchorText: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS frontier (
  url TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  discovered_at INTEGER NOT NULL,
  next_eligible_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_frontier_state_domain ON frontier(state, domain);

CREATE TABLE IF NOT EXISTS visited (
  url TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  visited_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visited_content_hash ON visited(content_hash);

CREATE TABLE IF NOT EXISTS robots_cache (
  domain TEXT PRIMARY KEY,
  rules TEXT NOT NULL,
  crawl_delay_ms INTEGER,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  url UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS link_edges (
  src_url TEXT NOT NULL,
  dst_url TEXT NOT NULL,
  anchor_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src_url, dst_url)
);
CREATE INDEX IF NOT EXISTS idx_link_edges_dst ON link_edges(dst_url);
`;

export class CrawlerDb {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ── Frontier ────────────────────────────────────────────────────────────

  enqueue(entry: FrontierEntry): void {
    this.db.run(
      `INSERT INTO frontier (url, domain, priority, state, discovered_at, next_eligible_at)
       VALUES (:url, :domain, :priority, 'pending', :discoveredAt, 0)
       ON CONFLICT(url) DO NOTHING`,
      {
        ':url': entry.url,
        ':domain': entry.domain,
        ':priority': entry.priority,
        ':discoveredAt': entry.discoveredAt,
      },
    );
  }

  /** Pop the next eligible pending URL for a domain that is not rate-limited. */
  nextEligible(now: number, excludeDomains: readonly string[]): { url: string; domain: string } | null {
    const placeholders = excludeDomains.map((_, i) => `:d${i}`).join(',');
    const exclude = excludeDomains.length > 0 ? `AND domain NOT IN (${placeholders})` : '';
    const params: Record<string, number | string> = { ':now': now };
    excludeDomains.forEach((d, i) => { params[`:d${i}`] = d; });
    const row = this.db.get(
      `SELECT url, domain FROM frontier
       WHERE state = 'pending' AND next_eligible_at <= :now ${exclude}
       ORDER BY priority DESC, discovered_at ASC
       LIMIT 1`,
      params,
    ) as { url: string; domain: string } | undefined;
    return row ?? null;
  }

  markFetching(url: string): void {
    this.db.run(`UPDATE frontier SET state = 'fetching', attempts = attempts + 1 WHERE url = ?`, [url]);
  }

  markDone(url: string): void {
    this.db.run(`UPDATE frontier SET state = 'done' WHERE url = ?`, [url]);
  }

  markFailed(url: string, retryAfterMs: number): void {
    this.db.run(
      `UPDATE frontier SET state = 'pending', next_eligible_at = ? WHERE url = ?`,
      [Date.now() + retryAfterMs, url],
    );
  }

  /** Delay the whole domain's next fetch (politeness / crawl-delay). */
  setDomainNextEligible(domain: string, nextEligibleAt: number): void {
    this.db.run(
      `UPDATE frontier SET next_eligible_at = ? WHERE domain = ? AND state = 'pending'`,
      [nextEligibleAt, domain],
    );
  }

  frontierSize(): number {
    const row = this.db.get(`SELECT COUNT(*) as n FROM frontier WHERE state = 'pending'`) as { n: number };
    return row.n;
  }

  // ── Dedup ───────────────────────────────────────────────────────────────

  isVisited(url: string): boolean {
    return this.db.get(`SELECT 1 FROM visited WHERE url = ?`, [url]) !== null;
  }

  hasContentHash(contentHash: string): boolean {
    return this.db.get(`SELECT 1 FROM visited WHERE content_hash = ?`, [contentHash]) !== null;
  }

  recordVisited(url: string, contentHash: string): void {
    this.db.run(
      `INSERT INTO visited (url, content_hash, visited_at) VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET content_hash = excluded.content_hash, visited_at = excluded.visited_at`,
      [url, contentHash, Date.now()],
    );
  }

  // ── Robots cache ────────────────────────────────────────────────────────

  getRobotsCache(domain: string): RobotsCacheEntry | null {
    const row = this.db.get(
      `SELECT domain, rules, crawl_delay_ms as crawlDelayMs, fetched_at as fetchedAt FROM robots_cache WHERE domain = ?`,
      [domain],
    ) as { domain: string; rules: string; crawlDelayMs: number | null; fetchedAt: number } | undefined;
    return row ?? null;
  }

  setRobotsCache(entry: RobotsCacheEntry): void {
    this.db.run(
      `INSERT INTO robots_cache (domain, rules, crawl_delay_ms, fetched_at) VALUES (:domain, :rules, :crawlDelayMs, :fetchedAt)
       ON CONFLICT(domain) DO UPDATE SET rules = excluded.rules, crawl_delay_ms = excluded.crawl_delay_ms, fetched_at = excluded.fetched_at`,
      {
        ':domain': entry.domain,
        ':rules': entry.rules,
        ':crawlDelayMs': entry.crawlDelayMs,
        ':fetchedAt': entry.fetchedAt,
      },
    );
  }

  // ── Documents + FTS5 ────────────────────────────────────────────────────

  upsertDocument(doc: CrawledDocument): void {
    this.db.run(
      `INSERT INTO documents (url, title, body, content_hash, fetched_at) VALUES (:url, :title, :body, :contentHash, :fetchedAt)
       ON CONFLICT(url) DO UPDATE SET title = excluded.title, body = excluded.body,
         content_hash = excluded.content_hash, fetched_at = excluded.fetched_at`,
      {
        ':url': doc.url,
        ':title': doc.title,
        ':body': doc.body,
        ':contentHash': doc.contentHash,
        ':fetchedAt': doc.fetchedAt,
      },
    );
    this.db.run(`DELETE FROM documents_fts WHERE url = ?`, [doc.url]);
    this.db.run(
      `INSERT INTO documents_fts (url, title, body) VALUES (?, ?, ?)`,
      [doc.url, doc.title, doc.body],
    );
  }

  documentCount(): number {
    const row = this.db.get(`SELECT COUNT(*) as n FROM documents`) as { n: number };
    return row.n;
  }

  search(query: string, limit = 20): Array<{ url: string; title: string; snippet: string; score: number; fetchedAt: number }> {
    const rows = this.db.all(
      `SELECT f.url as url, f.title as title,
              snippet(documents_fts, 2, '<mark>', '</mark>', '…', 24) as snippet,
              bm25(documents_fts, 0.0, 5.0, 1.0) as score,
              d.fetched_at as fetchedAt
       FROM documents_fts f
       JOIN documents d ON d.url = f.url
       WHERE documents_fts MATCH ? ORDER BY score LIMIT ?`,
      [query, limit],
    ) as Array<{ url: string; title: string; snippet: string; score: number; fetchedAt: number }>;
    return rows;
  }

  // ── Link graph ──────────────────────────────────────────────────────────

  addLinkEdge(edge: LinkEdge): void {
    this.db.run(
      `INSERT INTO link_edges (src_url, dst_url, anchor_text) VALUES (?, ?, ?)
       ON CONFLICT(src_url, dst_url) DO UPDATE SET anchor_text = excluded.anchor_text`,
      [edge.srcUrl, edge.dstUrl, edge.anchorText],
    );
  }
}
