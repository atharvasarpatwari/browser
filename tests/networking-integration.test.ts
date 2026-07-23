import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { RawSocketHttpClient } from '../src/browser/netwroking/raw-socket-http-client';
import { DnsResolver, defaultSystemResolver } from '../src/browser/netwroking/dns-resolver';
import { TlsHandler } from '../src/browser/netwroking/tls-handler';

// ─────────────────────────────────────────────────────────────────────────────
// Test HTTP server
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

const TEST_HTML = '<html><head><title>Test Page</title></head><body><h1>Hello from Nova!</h1></body></html>';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-test': 'nova-browser',
      });
      res.end(TEST_HTML);
    } else if (url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', browser: 'nova' }));
    } else if (url === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>Slow response</body></html>');
      }, 100);
    } else if (url === '/big') {
      const bigBody = '<html><body>' + 'x'.repeat(10_000) + '</body></html>';
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(bigBody);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RawSocketHttpClient tests — real TCP transport
// ─────────────────────────────────────────────────────────────────────────────

describe('RawSocketHttpClient - real TCP', () => {
  it('should fetch a basic HTML page via raw TCP socket', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Hello from Nova!');
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('x-test')).toBe('nova-browser');
  });

  it('should fetch JSON responses', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/json`,
      method: 'GET',
      headers: new Map([['accept', 'application/json']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.body);
    expect(data.status).toBe('ok');
    expect(data.browser).toBe('nova');
  });

  it('should handle 404 responses', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/nonexistent`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('should handle large responses', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/big`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBeGreaterThan(10_000);
    expect(response.body).toContain('xxxx');
  });

  it('should support abort via AbortSignal', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.send({
        url: `${baseUrl}/`,
        method: 'GET',
        headers: new Map(),
        timeoutMs: 5000,
      }, controller.signal),
    ).rejects.toThrow('aborted');
  });

  it('should timeout on slow responses', async () => {
    const client = new RawSocketHttpClient({ defaultTimeoutMs: 50 });
    const controller = new AbortController();

    await expect(
      client.send({
        url: `${baseUrl}/slow`,
        method: 'GET',
        headers: new Map(),
        timeoutMs: 50,
      }, controller.signal),
    ).rejects.toThrow('timed out');
  }, 15_000);

  it('should parse response headers correctly', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    // Verify we got parsed headers
    expect(response.headers).toBeInstanceOf(Map);
    expect(response.headers.size).toBeGreaterThan(0);
    expect(response.headers.get('x-test')).toBe('nova-browser');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DNS Resolver — real system resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('DnsResolver - real system resolution', () => {
  it('should resolve localhost to 127.0.0.1', async () => {
    const resolver = new DnsResolver({ defaultTtlSeconds: 60 }, defaultSystemResolver);
    const result = await resolver.resolve('localhost');
    expect(result.addresses.length).toBeGreaterThan(0);
    expect(result.addresses).toContain('127.0.0.1');
  });

  it('should cache resolved entries', async () => {
    const resolver = new DnsResolver({ defaultTtlSeconds: 60 }, defaultSystemResolver);
    const r1 = await resolver.resolve('localhost');
    const r2 = await resolver.resolve('localhost');
    expect(r2.source).toBe('cache');
    expect(r2.addresses).toEqual(r1.addresses);
  });

  it('should report correct source on first resolve', async () => {
    const resolver = new DnsResolver({ defaultTtlSeconds: 60 }, defaultSystemResolver);
    const result = await resolver.resolve('localhost');
    expect(result.source).toBe('system');
  });

  it('should respect manual overrides', async () => {
    const resolver = new DnsResolver({ defaultTtlSeconds: 60 }, defaultSystemResolver);
    resolver.setOverride('fake-host', ['10.0.0.1', '10.0.0.2'], 300);
    const result = await resolver.resolve('fake-host');
    expect(result.source).toBe('override');
    expect(result.addresses).toEqual(['10.0.0.1', '10.0.0.2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TLS Handler — simulated + fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('TlsHandler - certificate chain and HSTS', () => {
  it('should build simulated certificate chain for fallback', async () => {
    const handler = new TlsHandler({ verifyCertificates: false });
    // Connect to a non-existent host — falls back to simulated chain
    const result = await handler.negotiate('test-host.invalid', 443);

    expect(result.hostname).toBe('test-host.invalid');
    expect(result.certificateChain.length).toBe(3);
    expect(result.certificateChain[0]!.subject).toBe('test-host.invalid');
    expect(result.certificateChain[0]!.issuer).toBe('Nova Intermediate CA');
    expect(result.certificateChain[2]!.subject).toBe('Nova Root CA');
  });

  it('should enforce HSTS when configured', async () => {
    const handler = new TlsHandler({ enforceHsts: true });
    handler.addHstsEntry({
      hostname: 'secure.example.com',
      maxAgeSeconds: 31536000,
      includeSubDomains: true,
      preload: false,
    });

    const result = await handler.negotiate('secure.example.com', 443);
    expect(result.hstsEnforced).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end page loading via raw socket
// ─────────────────────────────────────────────────────────────────────────────

describe('End-to-end: raw TCP page loading', () => {
  it('should load a page through raw TCP and get valid HTML', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<html>');
    expect(response.body).toContain('Hello from Nova!');
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('should load JSON API endpoint via raw TCP', async () => {
    const client = new RawSocketHttpClient();
    const controller = new AbortController();

    const response = await client.send({
      url: `${baseUrl}/json`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(() => JSON.parse(response.body)).not.toThrow();
  });
});
