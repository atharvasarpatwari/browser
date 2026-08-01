import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createIPSystemResolver,
  PNAEnforcingHttpClient,
  createPNAClient,
  PNABlockedError,
} from '../src/browser/networking/ip-adapter';
import type {
  DNSResolverBackend,
  DNSRecord,
  ParsedIP,
} from '../src/browser/networking/ip-protocol';
import { parseIPv4 } from '../src/browser/networking/ip-protocol';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from '../src/browser/networking/request-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeRecord(hostname: string, ip: string, ttl = 300): DNSRecord {
  return {
    hostname,
    address: parseIPv4(ip)!,
    ttlSeconds: ttl,
    resolvedAt: Date.now(),
  };
}

function makeRequest(url: string): HttpRequestSpec {
  return {
    url,
    method: 'GET' as any,
    headers: new Map(),
    timeoutMs: 5000,
  };
}

class FakeHttpClient implements IHttpClient {
  async send(_req: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
    return {
      url: _req.url,
      statusCode: 200,
      statusText: 'OK',
      headers: new Map(),
      body: 'OK',
      bodyBinary: null,
      redirected: false,
      redirectChain: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: createIPSystemResolver
// ─────────────────────────────────────────────────────────────────────────────

describe('createIPSystemResolver', () => {
  it('returns string IP addresses from DNSResolverBackend', async () => {
    const backend: DNSResolverBackend = {
      resolve: async (hostname) => [makeRecord(hostname, '93.184.216.34')],
    };

    const resolver = createIPSystemResolver(backend);
    const addresses = await resolver('example.com');

    expect(addresses).toEqual(['93.184.216.34']);
  });

  it('returns multiple addresses', async () => {
    const backend: DNSResolverBackend = {
      resolve: async (hostname) => [
        makeRecord(hostname, '1.1.1.1'),
        makeRecord(hostname, '8.8.8.8'),
      ],
    };

    const resolver = createIPSystemResolver(backend);
    const addresses = await resolver('cloudflare.com');

    expect(addresses).toEqual(['1.1.1.1', '8.8.8.8']);
  });

  it('passes preferredVersion to backend', async () => {
    const spy = vi.fn(async () => [makeRecord('test.com', '1.2.3.4')]);
    const backend: DNSResolverBackend = { resolve: spy };

    const resolver = createIPSystemResolver(backend, 6);
    await resolver('test.com');

    expect(spy).toHaveBeenCalledWith('test.com', 6);
  });

  it('returns empty array when no records', async () => {
    const backend: DNSResolverBackend = {
      resolve: async () => [],
    };

    const resolver = createIPSystemResolver(backend);
    const addresses = await resolver('nonexistent.example');

    expect(addresses).toEqual([]);
  });

  it('propagates errors from backend', async () => {
    const backend: DNSResolverBackend = {
      resolve: async () => { throw new Error('DNS failure'); },
    };

    const resolver = createIPSystemResolver(backend);
    await expect(resolver('fail.example')).rejects.toThrow('DNS failure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: PNAEnforcingHttpClient
// ─────────────────────────────────────────────────────────────────────────────

describe('PNAEnforcingHttpClient', () => {
  let inner: FakeHttpClient;

  beforeEach(() => {
    inner = new FakeHttpClient();
  });

  it('allows public origin → public target', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['93.184.216.34'],
    );

    const res = await client.send(makeRequest('https://example.com/page'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('allows public origin → private target when host is in allowlist', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      {
        originIsPrivate: false,
        allowedPrivateHosts: ['internal.dev'],
      },
      async () => ['10.0.0.1'],
    );

    const res = await client.send(makeRequest('https://internal.dev/api'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('blocks public origin → private target (10.x)', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['10.0.0.1'],
    );

    await expect(
      client.send(makeRequest('https://internal.dev/api'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });

  it('blocks public origin → private target (192.168.x)', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['192.168.1.1'],
    );

    await expect(
      client.send(makeRequest('https://router.local/status'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });

  it('blocks public origin → private target (172.16.x)', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['172.16.0.1'],
    );

    await expect(
      client.send(makeRequest('https://service.internal/health'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });

  it('allows private origin → private target', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: true },
      async () => ['10.0.0.5'],
    );

    const res = await client.send(makeRequest('https://internal.dev/data'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('allows when PNA is disabled', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false, disablePNA: true },
      async () => ['10.0.0.1'],
    );

    const res = await client.send(makeRequest('https://internal.dev/api'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('handles literal IP in URL hostname', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['10.0.0.1'],
    );

    await expect(
      client.send(makeRequest('https://10.0.0.1/api'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });

  it('allows public literal IP in URL', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['8.8.8.8'],
    );

    const res = await client.send(makeRequest('https://8.8.8.8/dns-query'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('allows loopback from private origin', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: true },
      async () => ['127.0.0.1'],
    );

    const res = await client.send(makeRequest('https://localhost:3000/'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('blocks loopback from public origin', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['127.0.0.1'],
    );

    await expect(
      client.send(makeRequest('https://localhost:3000/'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });

  it('allows invalid URLs without crashing', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['10.0.0.1'],
    );

    // Invalid URL — hostname extraction fails, no PNA check performed
    const res = await client.send(makeRequest('not-a-valid-url'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('checks all resolved addresses — allows if all public', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['8.8.8.8', '8.8.4.4'],
    );

    const res = await client.send(makeRequest('https://google.com/'), new AbortController().signal);
    expect(res.statusCode).toBe(200);
  });

  it('checks all resolved addresses — blocks if any private', async () => {
    const client = new PNAEnforcingHttpClient(
      inner,
      { originIsPrivate: false },
      async () => ['8.8.8.8', '10.0.0.1'],
    );

    await expect(
      client.send(makeRequest('https://mixed.example/'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: createPNAClient
// ─────────────────────────────────────────────────────────────────────────────

describe('createPNAClient', () => {
  it('creates a PNAEnforcingHttpClient with inner FetchHttpClient', async () => {
    const client = createPNAClient({
      originIsPrivate: false,
      dnsLookup: async () => ['93.184.216.34'],
    });

    expect(client).toBeInstanceOf(PNAEnforcingHttpClient);
  });

  it('uses provided inner client', async () => {
    const inner = new FakeHttpClient();
    const client = createPNAClient(
      {
        originIsPrivate: false,
        dnsLookup: async () => ['10.0.0.1'],
      },
      inner,
    );

    await expect(
      client.send(makeRequest('https://private.host/'), new AbortController().signal),
    ).rejects.toThrow(PNABlockedError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: PNABlockedError
// ─────────────────────────────────────────────────────────────────────────────

describe('PNABlockedError', () => {
  it('has correct name and message', () => {
    const err = new PNABlockedError('internal.dev', '10.0.0.1');
    expect(err.name).toBe('PNABlockedError');
    expect(err.hostname).toBe('internal.dev');
    expect(err.address).toBe('10.0.0.1');
    expect(err.message).toContain('internal.dev');
    expect(err.message).toContain('10.0.0.1');
  });

  it('is instanceof Error', () => {
    const err = new PNABlockedError('host', '1.2.3.4');
    expect(err).toBeInstanceOf(Error);
  });
});
