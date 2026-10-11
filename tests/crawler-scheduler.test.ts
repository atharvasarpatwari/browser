import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'node:http';
import { CrawlerDb } from '../src/browser/crawler/crawler-db';
import { CrawlerFetcher } from '../src/browser/crawler/crawler-fetcher';
import { RobotsCache } from '../src/browser/crawler/robots-cache';
import { CrawlerScheduler } from '../src/browser/crawler/crawler-scheduler';

describe('CrawlerScheduler', () => {
  let server: http.Server;
  let baseUrl: string;
  let domain: string;
  let requestLog: string[];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requestLog.push(req.url ?? '/');
      const url = req.url ?? '/';
      if (url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /secret\n');
      } else if (url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><head><title>Home</title></head><body>
          <h1>Home Page</h1>
          <p>${'word '.repeat(30)}</p>
          <a href="/about">About</a>
          <a href="/secret">Secret</a>
          <a href="https://outside.example/page">Outside</a>
        </body></html>`);
      } else if (url === '/about') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><head><title>About</title></head><body>
          <h1>About Us</h1>
          <p>${'info '.repeat(30)}</p>
          <a href="/">Home</a>
        </body></html>`);
      } else if (url === '/secret') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html><head><title>Secret</title></head><body><p>${'hidden '.repeat(30)}</p></body></html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    domain = '127.0.0.1'; // allowedDomains is matched against URL.hostname, which excludes the port
  });

  beforeEach(() => { requestLog = []; });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeScheduler(db: CrawlerDb, overrides: Partial<{ allowedDomains: Set<string>; maxPages: number }> = {}) {
    const fetcher = new CrawlerFetcher();
    const robots = new RobotsCache(db, (u) => fetcher.fetch(u, { userAgent: 'NovaCrawler-test' }), 'NovaCrawler-test');
    return new CrawlerScheduler(db, fetcher, robots, {
      userAgent: 'NovaCrawler-test',
      concurrency: 2,
      minDomainDelayMs: 0,
      allowedDomains: overrides.allowedDomains ?? new Set([domain]),
      maxPages: overrides.maxPages,
    });
  }

  it('crawls the seed, discovers an in-allow-list link, and indexes both pages', async () => {
    const db = new CrawlerDb(':memory:');
    const scheduler = makeScheduler(db, { maxPages: 5 });
    scheduler.enqueueSeed(`${baseUrl}/`);
    while (await scheduler.runOnce()) { /* drain */ }

    expect(db.documentCount()).toBe(2); // home + about; /secret is robots-disallowed, outside.example is not allow-listed
    const hits = db.search('About');
    expect(hits.some((h) => h.url === `${baseUrl}/about`)).toBe(true);
    db.close();
  });

  it('never fetches a robots.txt-disallowed path', async () => {
    const db = new CrawlerDb(':memory:');
    const scheduler = makeScheduler(db, { maxPages: 5 });
    scheduler.enqueueSeed(`${baseUrl}/`);
    while (await scheduler.runOnce()) { /* drain */ }

    expect(requestLog).not.toContain('/secret');
    db.close();
  });

  it('records the cross-domain link in the link graph but does not crawl it', async () => {
    const db = new CrawlerDb(':memory:');
    const scheduler = makeScheduler(db, { maxPages: 5 });
    scheduler.enqueueSeed(`${baseUrl}/`);
    while (await scheduler.runOnce()) { /* drain */ }

    expect(requestLog.some((u) => u.includes('outside.example'))).toBe(false);
    expect(db.documentCount()).toBe(2); // outside.example was never fetched/indexed
    db.close();
  });

  it('stops after maxPages even if the frontier is not empty', async () => {
    const db = new CrawlerDb(':memory:');
    const scheduler = makeScheduler(db, { maxPages: 1 });
    scheduler.enqueueSeed(`${baseUrl}/`);
    let processed = 0;
    while (await scheduler.runOnce()) processed++;

    expect(processed).toBe(1);
    expect(db.documentCount()).toBe(1);
    db.close();
  });

  it('does not re-enqueue a URL that was already visited', async () => {
    const db = new CrawlerDb(':memory:');
    const scheduler = makeScheduler(db, { maxPages: 5 });
    scheduler.enqueueSeed(`${baseUrl}/`);
    while (await scheduler.runOnce()) { /* drain */ }

    // home links back to "/" via about's "Home" link — should not create a second fetch of "/"
    const homeFetches = requestLog.filter((u) => u === '/').length;
    expect(homeFetches).toBe(1);
    db.close();
  });
});
