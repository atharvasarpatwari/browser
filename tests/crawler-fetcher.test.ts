import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { CrawlerFetcher, MaxBodySizeExceededError } from '../src/browser/crawler/crawler-fetcher';

describe('CrawlerFetcher', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/plain') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>hello</body></html>');
      } else if (url === '/gzip') {
        const body = zlib.gzipSync(Buffer.from('<html>compressed</html>'));
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(body);
      } else if (url === '/redirect-once') {
        res.writeHead(302, { location: '/plain' });
        res.end();
      } else if (url === '/redirect-loop') {
        res.writeHead(302, { location: '/redirect-loop' });
        res.end();
      } else if (url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(1000));
      } else if (url === '/slow') {
        setTimeout(() => { res.writeHead(200); res.end('late'); }, 5000);
      } else if (url === '/notfound') {
        res.writeHead(404);
        res.end('not found');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('fetches a plain page', async () => {
    const fetcher = new CrawlerFetcher();
    const res = await fetcher.fetch(`${baseUrl}/plain`, { userAgent: 'NovaCrawler-test' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('hello');
  });

  it('transparently decodes a gzip response', async () => {
    const fetcher = new CrawlerFetcher();
    const res = await fetcher.fetch(`${baseUrl}/gzip`, { userAgent: 'NovaCrawler-test' });
    expect(res.status).toBe(200);
    expect(res.body).toBe('<html>compressed</html>');
  });

  it('follows a single redirect to its final destination', async () => {
    const fetcher = new CrawlerFetcher();
    const res = await fetcher.fetch(`${baseUrl}/redirect-once`, { userAgent: 'NovaCrawler-test' });
    expect(res.status).toBe(200);
    expect(res.body).toContain('hello');
  });

  it('stops following redirects at the configured cap instead of looping forever', async () => {
    const fetcher = new CrawlerFetcher();
    const res = await fetcher.fetch(`${baseUrl}/redirect-loop`, { userAgent: 'NovaCrawler-test', maxRedirects: 3 });
    expect(res.status).toBe(302); // gives up and returns the last redirect response
  });

  it('rejects when the response exceeds maxBodyBytes', async () => {
    const fetcher = new CrawlerFetcher();
    await expect(
      fetcher.fetch(`${baseUrl}/big`, { userAgent: 'NovaCrawler-test', maxBodyBytes: 100 }),
    ).rejects.toThrow(MaxBodySizeExceededError);
  });

  it('rejects when the request exceeds the timeout', async () => {
    const fetcher = new CrawlerFetcher();
    await expect(
      fetcher.fetch(`${baseUrl}/slow`, { userAgent: 'NovaCrawler-test', timeoutMs: 200 }),
    ).rejects.toThrow();
  }, 10_000);

  it('surfaces a non-2xx status without throwing', async () => {
    const fetcher = new CrawlerFetcher();
    const res = await fetcher.fetch(`${baseUrl}/notfound`, { userAgent: 'NovaCrawler-test' });
    expect(res.status).toBe(404);
  });
});
