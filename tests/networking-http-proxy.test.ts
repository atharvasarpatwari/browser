import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as https from 'node:https';
import type { Socket } from 'node:net';
import { RawSocketHttpClient, RawSocketError } from '../src/browser/networking/raw-socket-http-client';
import { ProxyAwareHttpClient, createProxyConfigFromEnv } from '../src/browser/networking/request-manager';
import {
  connectThroughHttpProxy,
  parseHttpProxyUrl,
} from '../src/browser/networking/http-proxy-connect';
import { CertVerificationStatus, CipherSuite, TlsVersion, type ITlsHandler } from '../src/browser/networking/tls-handler';
import { startMockHttpProxy, type MockHttpProxyServer } from './helpers/http-proxy-test-server';
import { createSelfSignedCert } from './helpers/self-signed-cert';

const TEST_HTML = '<html><head><title>Http Proxy Test</title></head><body><h1>Proxied!</h1></body></html>';

let httpServer: http.Server;
let httpBaseUrl: string;
let tlsServer: https.Server;
let httpsBaseUrl: string;

const proxies: MockHttpProxyServer[] = [];

async function startProxy(options: Parameters<typeof startMockHttpProxy>[0] = {}): Promise<MockHttpProxyServer> {
  const server = await startMockHttpProxy(options);
  proxies.push(server);
  return server;
}

const respond = (res: http.ServerResponse) => {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'x-proxy': 'through-tunnel',
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
  await Promise.all(proxies.splice(0).map((p) => p.close()));
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

describe('parseHttpProxyUrl', () => {
  it('parses an http:// proxy URL', () => {
    expect(parseHttpProxyUrl('http://proxy.corp:8080')).toEqual({
      hostname: 'proxy.corp',
      port: 8080,
      isTls: false,
    });
  });

  it('defaults to port 80 for http and 443 for https', () => {
    expect(parseHttpProxyUrl('http://proxy.corp')?.port).toBe(80);
    expect(parseHttpProxyUrl('https://proxy.corp')?.port).toBe(443);
    expect(parseHttpProxyUrl('https://proxy.corp')?.isTls).toBe(true);
  });

  it('decodes credentials into a Proxy-Authorization value', () => {
    const info = parseHttpProxyUrl('http://user:secret@proxy.corp:8080');
    expect(info).toMatchObject({ hostname: 'proxy.corp', port: 8080 });
    expect(info?.authorization).toBe(`Basic ${Buffer.from('user:secret').toString('base64')}`);
  });

  it('rejects non-http(s) schemes and malformed URLs', () => {
    expect(parseHttpProxyUrl('socks5://proxy:1080')).toBeNull();
    expect(parseHttpProxyUrl('ftp://proxy:21')).toBeNull();
    expect(parseHttpProxyUrl('not a url')).toBeNull();
    expect(parseHttpProxyUrl('http://proxy:99999')).toBeNull();
  });
});

describe('connectThroughHttpProxy', () => {
  it('negotiates a CONNECT tunnel and reports the target to the proxy', async () => {
    const mock = await startProxy({ relay: true });
    const info = parseHttpProxyUrl(`http://127.0.0.1:${mock.port}`)!;
    const socket: Socket = await connectThroughHttpProxy({
      proxy: info,
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpBaseUrl),
      timeoutMs: 3000,
    });
    socket.destroy();

    expect(mock.events).toHaveLength(1);
    expect(mock.events[0]).toMatchObject({
      type: 'connect',
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpBaseUrl),
    });
    expect(mock.events[0]!.raw).toContain(`CONNECT 127.0.0.1:${httpPortOf(httpBaseUrl)} HTTP/1.1`);
  });

  it('sends Proxy-Authorization when the proxy URL has credentials', async () => {
    const mock = await startProxy();
    const info = parseHttpProxyUrl(`http://user:pass@127.0.0.1:${mock.port}`)!;
    const socket: Socket = await connectThroughHttpProxy({
      proxy: info,
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 3000,
    });
    socket.destroy();

    expect(mock.events[0]!.raw).toContain(
      `Proxy-Authorization: Basic ${Buffer.from('user:pass').toString('base64')}`,
    );
  });

  it('rejects with CONNECT_FAILED when the proxy refuses (407)', async () => {
    const mock = await startProxy({ replyStatus: 407 });
    const info = parseHttpProxyUrl(`http://127.0.0.1:${mock.port}`)!;
    await expect(connectThroughHttpProxy({
      proxy: info,
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 3000,
    })).rejects.toMatchObject({ name: 'HttpProxyError', code: 'CONNECT_FAILED' });
  });

  it('rejects with BAD_RESPONSE on a malformed reply', async () => {
    const mock = await startProxy({ rawReply: 'GARBAGE\r\n\r\n' });
    const info = parseHttpProxyUrl(`http://127.0.0.1:${mock.port}`)!;
    await expect(connectThroughHttpProxy({
      proxy: info,
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 3000,
    })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('times out when the proxy never responds', async () => {
    const mock = await startProxy({ neverRespond: true });
    const info = parseHttpProxyUrl(`http://127.0.0.1:${mock.port}`)!;
    await expect(connectThroughHttpProxy({
      proxy: info,
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 500,
    })).rejects.toMatchObject({ name: 'HttpProxyError', code: 'TIMEOUT' });
  });
});

describe('RawSocketHttpClient over an HTTP proxy', () => {
  it('fetches HTTP through a CONNECT tunnel', async () => {
    const mock = await startProxy({ relay: true });
    const client = new RawSocketHttpClient({ httpProxy: `http://127.0.0.1:${mock.port}` });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Proxied!');
    expect(response.headers.get('x-proxy')).toBe('through-tunnel');

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpBaseUrl),
    });
  });

  it('fetches HTTPS through a CONNECT tunnel with TLS wrapped on top', async () => {
    const mock = await startProxy({ relay: true });
    const client = new RawSocketHttpClient({
      httpProxy: `http://127.0.0.1:${mock.port}`,
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
    expect(response.body).toContain('Proxied!');

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({
      targetHost: '127.0.0.1',
      targetPort: httpPortOf(httpsBaseUrl),
    });
  });

  it('rejects when the proxy refuses the CONNECT', async () => {
    const mock = await startProxy({ replyStatus: 403 });
    const client = new RawSocketHttpClient({ httpProxy: `http://127.0.0.1:${mock.port}` });
    const controller = new AbortController();

    await expect(client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 3000,
    }, controller.signal)).rejects.toBeDefined();
  });

  it('rejects an invalid proxy URL', async () => {
    const client = new RawSocketHttpClient({ httpProxy: 'not a url' });
    const controller = new AbortController();

    await expect(client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 3000,
    }, controller.signal)).rejects.toBeInstanceOf(RawSocketError);
  });
});

describe('ProxyAwareHttpClient HTTP proxy dispatch', () => {
  it('routes http:// requests through a CONNECT tunnel', async () => {
    const mock = await startProxy({ relay: true });
    const client = new ProxyAwareHttpClient({ httpProxy: `http://127.0.0.1:${mock.port}`, noProxy: [] });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Proxied!');
    expect(mock.events.some((e) => e.type === 'connect')).toBe(true);
  });

  it('routes https:// requests through the httpsProxy CONNECT tunnel', async () => {
    const mock = await startProxy({ relay: true });
    const client = new ProxyAwareHttpClient({
      httpsProxy: `http://127.0.0.1:${mock.port}`,
      noProxy: [],
    });
    const controller = new AbortController();

    const response = await client.send({
      url: `${httpsBaseUrl}/`,
      method: 'GET',
      headers: new Map([['accept', 'text/html']]),
      timeoutMs: 5000,
    }, controller.signal);

    expect(response.statusCode).toBe(200);
    expect(mock.events.some((e) => e.type === 'connect')).toBe(true);
  });

  it('honors the no-proxy bypass list', async () => {
    const mock = await startProxy({ relay: true });
    const client = new ProxyAwareHttpClient({
      httpProxy: `http://127.0.0.1:${mock.port}`,
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

  it('routes to a different tunnel after updateProxyConfig changes the proxy', async () => {
    const mockA = await startProxy({ relay: true });
    const mockB = await startProxy({ relay: true });
    const client = new ProxyAwareHttpClient({ httpProxy: `http://127.0.0.1:${mockA.port}`, noProxy: [] });
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

    client.updateProxyConfig({ httpProxy: `http://127.0.0.1:${mockB.port}` });

    const second = await client.send({
      url: `${httpBaseUrl}/`,
      method: 'GET',
      headers: new Map(),
      timeoutMs: 5000,
    }, controller.signal);
    expect(second.statusCode).toBe(200);
    expect(mockB.events.some((e) => e.type === 'connect')).toBe(true);
  });
});

describe('createProxyConfigFromEnv — HTTP proxies', () => {
  it('reads HTTP_PROXY into httpProxy', () => {
    expect(createProxyConfigFromEnv({ HTTP_PROXY: 'http://proxy:8080' }).httpProxy).toBe('http://proxy:8080');
    expect(createProxyConfigFromEnv({ http_proxy: 'http://proxy:8080' }).httpProxy).toBe('http://proxy:8080');
  });

  it('reads HTTPS_PROXY into httpsProxy', () => {
    expect(createProxyConfigFromEnv({ HTTPS_PROXY: 'http://proxy:8443' }).httpsProxy).toBe('http://proxy:8443');
    expect(createProxyConfigFromEnv({ https_proxy: 'http://proxy:8443' }).httpsProxy).toBe('http://proxy:8443');
  });

  it('applies an http:// ALL_PROXY to both protocols', () => {
    const config = createProxyConfigFromEnv({ ALL_PROXY: 'http://proxy:8080' });
    expect(config.httpProxy).toBe('http://proxy:8080');
    expect(config.httpsProxy).toBe('http://proxy:8080');
  });

  it('keeps an https:// ALL_PROXY as httpsProxy', () => {
    const config = createProxyConfigFromEnv({ ALL_PROXY: 'https://proxy:443' });
    expect(config.httpsProxy).toBe('https://proxy:443');
    expect(config.httpProxy).toBe('https://proxy:443');
  });

  it('keeps a socks ALL_PROXY out of the http/https fields', () => {
    const config = createProxyConfigFromEnv({ ALL_PROXY: 'socks5://proxy:1080' });
    expect(config.socksProxy).toBe('socks5://proxy:1080');
    expect(config.httpProxy).toBeUndefined();
    expect(config.httpsProxy).toBeUndefined();
  });

  it('lets specific variables override ALL_PROXY', () => {
    const config = createProxyConfigFromEnv({
      ALL_PROXY: 'http://fallback:8080',
      HTTPS_PROXY: 'https://primary:443',
    });
    expect(config.httpProxy).toBe('http://fallback:8080');
    expect(config.httpsProxy).toBe('https://primary:443');
  });

  it('ignores malformed proxy variables', () => {
    expect(createProxyConfigFromEnv({ HTTP_PROXY: 'not a url' }).httpProxy).toBeUndefined();
    expect(createProxyConfigFromEnv({ HTTPS_PROXY: 'ftp://proxy:21' }).httpsProxy).toBeUndefined();
  });
});
