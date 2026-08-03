import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';
import { ProxyAwareHttpClient, createProxyConfigFromEnv } from '../src/browser/networking/request-manager';
import { CertVerificationStatus, CipherSuite, TlsVersion, type ITlsHandler } from '../src/browser/networking/tls-handler';
import { startMockSocksServer, type MockSocksServer } from './helpers/socks-test-server';
import { createSelfSignedCert } from './helpers/self-signed-cert';

const TEST_HTML = '<html><head><title>Socks Test</title></head><body><h1>Tunneled!</h1></body></html>';

let httpServer: http.Server;
let httpBaseUrl: string;
let tlsServer: https.Server;
let httpsBaseUrl: string;

const socksServers: MockSocksServer[] = [];

async function startSocks(options: Parameters<typeof startMockSocksServer>[0]): Promise<MockSocksServer> {
  const server = await startMockSocksServer(options);
  socksServers.push(server);
  return server;
}

const respond = (res: http.ServerResponse) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-socks': 'through-tunnel',
    'access-control-allow-origin': '*',
  });
  res.end(TEST_HTML);
};

beforeAll(async () => {
  httpServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': '*',
        'access-control-allow-headers': '*',
      });
      res.end();
      return;
    }
    if ((req.url ?? '/') === '/') respond(res);
    else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    }
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      if (addr !== null && typeof addr === 'object') {
        httpBaseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });

  const { key, cert } = createSelfSignedCert('localhost');
  tlsServer = https.createServer({ key, cert }, (req, res) => respond(res));
  await new Promise<void>((resolve) => {
    tlsServer.listen(0, '127.0.0.1', () => {
      const addr = tlsServer.address();
      if (addr !== null && typeof addr === 'object') {
        httpsBaseUrl = `https://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await Promise.all(socksServers.splice(0).map((s) => s.close()));
  httpServer.closeAllConnections();
  tlsServer.closeAllConnections();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) => tlsServer.close(() => resolve()));
});

/** Certificate check that trusts any presented peer certificate. */
const permissiveTlsHandler: Partial<ITlsHandler> = {
  negotiate: async (hostname, port) => ({
    hostname,
    port: port ?? 443,
    version: TlsVersion.Tls1_3,
    cipherSuite: CipherSuite.Aes128GcmSha256,
    certificateChain: [],
    verified: true,
    verificationStatus: CertVerificationStatus.Valid,
    hstsEnforced: false,
    pinningChecked: false,
    negotiationTimeMs: 0,
  }),
};

function httpPortOf(url: string): number {
  return Number(new URL(url).port);
}

describe('RawSocketHttpClient over SOCKS5', () => {
  it('fetches HTTP through a SOCKS5 relay tunnel', async () => {
    const mock = await startSocks({ protocol: 'socks5', relay: true });
    const client = new RawSocketHttpClient({ socksProxy: `socks5://127.0.0.1:${mock.port}` });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Tunneled!');
    expect(response.headers.get('x-socks')).toBe('through-tunnel');

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({
      atyp: 0x01,
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpBaseUrl),
    });
  });

  it('fetches HTTPS through a SOCKS5 relay tunnel with TLS wrapped on top', async () => {
    const mock = await startSocks({ protocol: 'socks5', relay: true });
    const client = new RawSocketHttpClient({
      socksProxy: `socks5://127.0.0.1:${mock.port}`,
      tlsHandler: permissiveTlsHandler as ITlsHandler,
    });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpsBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Tunneled!');

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpsBaseUrl),
    });
  });

  it('rejects when the tunnel target is unreachable', async () => {
    const mock = await startSocks({ protocol: 'socks5', relay: true });
    const client = new RawSocketHttpClient({ socksProxy: `socks5://127.0.0.1:${mock.port}` });
    const controller = new AbortController();

    await expect(client.send({
      url: 'http://127.0.0.1:1/',
      method: 'GET',
      headers: new Map(),
      timeoutMs: 3000,
    }, controller.signal)).rejects.toBeDefined();
  });
});

describe('ProxyAwareHttpClient SOCKS dispatch', () => {
  it('tunnels via sendViaProxy using the gateway-managed socks5 scheme', async () => {
    const mock = await startSocks({ protocol: 'socks5', relay: true });
    const client = new ProxyAwareHttpClient({ socksProxy: `socks5://127.0.0.1:${mock.port}`, noProxy: [] });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Tunneled!');

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpBaseUrl),
    });
  });

  it('routes to a different tunnel after updateProxyConfig changes the socks proxy', async () => {
    const mockA = await startSocks({ protocol: 'socks5', relay: true });
    const mockB = await startSocks({ protocol: 'socks5', relay: true });
    const client = new ProxyAwareHttpClient({ socksProxy: `socks5://127.0.0.1:${mockA.port}`, noProxy: [] });
    const controller = new AbortController();

    const first = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);
    expect(first.statusCode).toBe(200);
    expect(mockA.events.some((e) => e.type === 'connect')).toBe(true);
    expect(mockB.events.some((e) => e.type === 'connect')).toBe(false);

    client.updateProxyConfig({ socksProxy: `socks5://127.0.0.1:${mockB.port}` });

    const second = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);
    expect(second.statusCode).toBe(200);
    expect(mockB.events.some((e) => e.type === 'connect')).toBe(true);
  });

  it('honors the no-proxy bypass list', async () => {
    const mock = await startSocks({ protocol: 'socks5', relay: true });
    const client = new ProxyAwareHttpClient({
      socksProxy: `socks5://127.0.0.1:${mock.port}`,
      noProxy: ['127.0.0.1'],
    });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(mock.events.some((e) => e.type === 'connect')).toBe(false);
  });
});

describe('createProxyConfigFromEnv', () => {
  it('reads NOVA_SOCKS_PROXY as the socks proxy', () => {
    const config = createProxyConfigFromEnv({
      NOVA_SOCKS_PROXY: 'socks5://10.0.0.5:1080',
    });
    expect(config.socksProxy).toBe('socks5://10.0.0.5:1080');
    expect(config.noProxy).toBeUndefined();
  });

  it('accepts socks schemes from ALL_PROXY and rejects http/https', () => {
    expect(createProxyConfigFromEnv({ ALL_PROXY: 'socks5://proxy:1080' }).socksProxy).toBe('socks5://proxy:1080');
    expect(createProxyConfigFromEnv({ ALL_PROXY: 'socks4a://proxy:1080' }).socksProxy).toBe('socks4a://proxy:1080');
    expect(createProxyConfigFromEnv({ ALL_PROXY: 'http://proxy:8080' }).socksProxy).toBeUndefined();
    expect(createProxyConfigFromEnv({ ALL_PROXY: 'https://proxy:443' }).socksProxy).toBeUndefined();
  });

  it('gives NOVA_SOCKS_PROXY precedence over ALL_PROXY', () => {
    const config = createProxyConfigFromEnv({
      NOVA_SOCKS_PROXY: 'socks5://primary:1080',
      ALL_PROXY: 'socks5://fallback:1080',
    });
    expect(config.socksProxy).toBe('socks5://primary:1080');
  });

  it('parses NO_PROXY into a trimmed hostname list', () => {
    const config = createProxyConfigFromEnv({
      NOVA_SOCKS_PROXY: 'socks5://proxy:1080',
      NO_PROXY: 'localhost, 127.0.0.1 ,.internal.example.com',
    });
    expect(config.noProxy).toEqual(['localhost', '127.0.0.1', '.internal.example.com']);
  });

  it('ignores malformed proxy URLs', () => {
    expect(createProxyConfigFromEnv({ NOVA_SOCKS_PROXY: 'not a url' }).socksProxy).toBeUndefined();
    expect(createProxyConfigFromEnv({ ALL_PROXY: '5h' }).socksProxy).toBeUndefined();
  });

  it('returns an empty config when no proxy variables are present', () => {
    expect(createProxyConfigFromEnv({ FOO: 'bar' })).toEqual({});
  });
});
