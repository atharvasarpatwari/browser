import { describe, it, expect, vi } from 'vitest';
import { CrawlerDb } from '../src/browser/crawler/crawler-db';
import { RobotsCache } from '../src/browser/crawler/robots-cache';

describe('RobotsCache', () => {
  it('fetches robots.txt once, applies its rules, and caches the result', async () => {
    const db = new CrawlerDb(':memory:');
    const fetchText = vi.fn().mockResolvedValue({ status: 200, body: 'User-agent: *\nDisallow: /private\n' });
    const cache = new RobotsCache(db, fetchText, 'NovaCrawler');

    expect(await cache.canFetch('https://a.com', '/private/x')).toBe(false);
    expect(await cache.canFetch('https://a.com', '/public/x')).toBe(true);
    expect(fetchText).toHaveBeenCalledTimes(1); // second call served from cache
    expect(fetchText).toHaveBeenCalledWith('https://a.com/robots.txt');

    db.close();
  });

  it('treats a missing robots.txt (404) as allow-all', async () => {
    const db = new CrawlerDb(':memory:');
    const fetchText = vi.fn().mockResolvedValue({ status: 404, body: '' });
    const cache = new RobotsCache(db, fetchText, 'NovaCrawler');

    expect(await cache.canFetch('https://a.com', '/anything')).toBe(true);
    db.close();
  });

  it('treats a fetch failure as allow-all rather than blocking the whole domain', async () => {
    const db = new CrawlerDb(':memory:');
    const fetchText = vi.fn().mockRejectedValue(new Error('network down'));
    const cache = new RobotsCache(db, fetchText, 'NovaCrawler');

    expect(await cache.canFetch('https://a.com', '/anything')).toBe(true);
    db.close();
  });

  it('surfaces crawl-delay in milliseconds', async () => {
    const db = new CrawlerDb(':memory:');
    const fetchText = vi.fn().mockResolvedValue({ status: 200, body: 'User-agent: *\nCrawl-delay: 3\n' });
    const cache = new RobotsCache(db, fetchText, 'NovaCrawler');

    expect(await cache.crawlDelayMs('https://a.com')).toBe(3000);
    db.close();
  });

  it('reuses the cached entry across RobotsCache instances via the shared db', async () => {
    const db = new CrawlerDb(':memory:');
    const fetchText = vi.fn().mockResolvedValue({ status: 200, body: 'User-agent: *\nDisallow: /x\n' });
    await new RobotsCache(db, fetchText, 'NovaCrawler').canFetch('https://a.com', '/x');

    const secondFetch = vi.fn();
    const second = new RobotsCache(db, secondFetch, 'NovaCrawler');
    expect(await second.canFetch('https://a.com', '/x')).toBe(false);
    expect(secondFetch).not.toHaveBeenCalled();
    db.close();
  });
});
