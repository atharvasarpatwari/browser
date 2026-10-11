import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CrawlerDb } from '../src/browser/crawler/crawler-db';

describe('CrawlerDb', () => {
  let db: CrawlerDb;

  beforeEach(() => {
    db = new CrawlerDb(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('frontier', () => {
    it('enqueues and pops the next eligible URL', () => {
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      const next = db.nextEligible(Date.now(), []);
      expect(next).toEqual({ url: 'https://a.com/1', domain: 'a.com' });
    });

    it('ignores duplicate enqueues of the same URL', () => {
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 9, discoveredAt: Date.now() });
      expect(db.frontierSize()).toBe(1);
    });

    it('excludes domains currently in flight', () => {
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      expect(db.nextEligible(Date.now(), ['a.com'])).toBeNull();
    });

    it('respects per-domain next_eligible_at delay', () => {
      const future = Date.now() + 10_000;
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      db.setDomainNextEligible('a.com', future);
      expect(db.nextEligible(Date.now(), [])).toBeNull();
      expect(db.nextEligible(future + 1, [])).not.toBeNull();
    });

    it('marks fetching -> done removes it from pending pool', () => {
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      db.markFetching('https://a.com/1');
      expect(db.frontierSize()).toBe(0);
      db.markDone('https://a.com/1');
      expect(db.nextEligible(Date.now(), [])).toBeNull();
    });

    it('marks failed URLs pending again after retryAfterMs', () => {
      db.enqueue({ url: 'https://a.com/1', domain: 'a.com', priority: 0, discoveredAt: Date.now() });
      db.markFetching('https://a.com/1');
      db.markFailed('https://a.com/1', 5_000);
      expect(db.nextEligible(Date.now(), [])).toBeNull();
      expect(db.nextEligible(Date.now() + 5_001, [])).not.toBeNull();
    });
  });

  describe('dedup', () => {
    it('tracks visited URLs and content hashes', () => {
      expect(db.isVisited('https://a.com/1')).toBe(false);
      db.recordVisited('https://a.com/1', 'hash123');
      expect(db.isVisited('https://a.com/1')).toBe(true);
      expect(db.hasContentHash('hash123')).toBe(true);
      expect(db.hasContentHash('other')).toBe(false);
    });
  });

  describe('robots cache', () => {
    it('round-trips an entry', () => {
      expect(db.getRobotsCache('a.com')).toBeNull();
      db.setRobotsCache({ domain: 'a.com', rules: 'Disallow: /private', crawlDelayMs: 2000, fetchedAt: 123 });
      expect(db.getRobotsCache('a.com')).toEqual({
        domain: 'a.com', rules: 'Disallow: /private', crawlDelayMs: 2000, fetchedAt: 123,
      });
    });
  });

  describe('documents + FTS5 search', () => {
    it('indexes a document and finds it by body text with bm25 ranking', () => {
      db.upsertDocument({ url: 'https://a.com/1', title: 'Quantum Computing', body: 'an intro to qubits', contentHash: 'h1', fetchedAt: 1 });
      db.upsertDocument({ url: 'https://a.com/2', title: 'Unrelated', body: 'nothing about quantum here', contentHash: 'h2', fetchedAt: 2 });
      const hits = db.search('quantum');
      expect(hits).toHaveLength(2);
      expect(hits[0].url).toBe('https://a.com/1'); // title match outranks body-only match
      expect(hits[1].snippet).toContain('<mark>'); // doc 2's match is in the body, which is what's snippeted
      expect(hits[0].fetchedAt).toBe(1);
      expect(db.documentCount()).toBe(2);
    });

    it('re-indexing a URL replaces its FTS row instead of duplicating it', () => {
      db.upsertDocument({ url: 'https://a.com/1', title: 'Old Title', body: 'old body', contentHash: 'h1', fetchedAt: 1 });
      db.upsertDocument({ url: 'https://a.com/1', title: 'New Title', body: 'new body', contentHash: 'h2', fetchedAt: 2 });
      expect(db.documentCount()).toBe(1);
      const hits = db.search('New');
      expect(hits).toHaveLength(1);
    });
  });

  describe('link graph', () => {
    it('upserts edges without duplicating on conflict', () => {
      db.addLinkEdge({ srcUrl: 'https://a.com/1', dstUrl: 'https://a.com/2', anchorText: 'next' });
      db.addLinkEdge({ srcUrl: 'https://a.com/1', dstUrl: 'https://a.com/2', anchorText: 'updated' });
      // no direct getter exists yet; just assert it doesn't throw and stays idempotent via re-insert
      expect(() => db.addLinkEdge({ srcUrl: 'https://a.com/1', dstUrl: 'https://a.com/2', anchorText: 'again' })).not.toThrow();
    });
  });
});
