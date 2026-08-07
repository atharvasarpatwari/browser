/**
 * @file src/browser/networking/request-manager.ts
 * @session 7
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Send HTTP requests and receive responses — the only file in the project
 * allowed to perform real network I/O for document fetches.
 *
 *   BrowserEngine.runPipeline()
 *        │  engine.loader.load(url, signal)
 *        ▼
 *      RequestManager.load()
 *        │  delegates to
 *        ▼
 *      RequestManager.send()
 *        │
 *        ├─▶ build HttpRequestSpec (headers, method, timeout)
 *        ├─▶ IHttpClient.send()        ← swappable transport
 *        │      │
 *        │      ├─ 3xx?  validate + follow redirect (capped, protocol-checked)
 *        │      ├─ retryable 5xx/429/408?  backoff + retry (capped)
 *        │      └─ else  return HttpResponseSpec
 *        ▼
 *      PageLoadResult  ──▶  returned to BrowserEngine, then IPageRenderer
 *
 * RequestManager implements IPageLoader (defined in browser-engine.ts) so it
 * can be plugged straight into BrowserEngine.setPageLoader() with no adapter.
 *
 * Security: every redirect target is checked against the same protocol
 * block-list url-parser.ts already enforces for address-bar input
 * (javascript:, data:, vbscript:, blob:, ws:, wss:), so a malicious server
 * cannot use a redirect chain to smuggle an unsafe scheme past the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IHttpClient hides the transport (fetch today, anything
 *                   else tomorrow) behind one method: send().
 *  Encapsulation    Retry/redirect bookkeeping lives entirely inside the
 *                   private send loop; callers only see the final result.
 *  Single-Resp.     RequestManager orchestrates one HTTP exchange end-to-end;
 *                   it does not parse HTML/CSS or touch the DOM.
 *  Open / Closed    New retry strategies implement RetryPolicy; new transports
 *                   implement IHttpClient — RequestManager itself never changes.
 *  Dependency-Inv.  Constructor receives IHttpClient + AppConfig; the default
 *                   FetchHttpClient is just the production default, swappable
 *                   in tests for a deterministic fake.
 *  Liskov-Subst.    Any IHttpClient (fetch-based, mock, future HTTP/2 client)
 *                   works interchangeably inside RequestManager's loop.
 */

import type { AppConfig }                from '../../app/app-shell';
import type { IPageLoader, PageLoadResult } from '../engine/browser-engine';
import { BLOCKED_PROTOCOLS }             from '../navigation/url-parser';
import {
  GatewayProtocolManager,
  GatewayCategory,
  type ProxyConfig,
}                                         from './gateway-protocols';
import { ContentDecoder, ACCEPT_ENCODING } from './content-encoding';
import { HttpAuthenticator, AuthScheme }    from './http-auth';
import { RawSocketHttpClient }              from './raw-socket-http-client';
import type { ITlsHandler }                 from './tls-handler';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Fully-resolved request, ready to hand to an IHttpClient. */
interface HttpRequestSpec {
  readonly url: string;
  readonly method: HttpMethod;
  readonly headers: ReadonlyMap<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
}

/** Caller-facing partial request — RequestManager fills in the rest. */
interface RequestOptions {
  readonly url: string;
  readonly method?: HttpMethod;
  readonly headers?: ReadonlyMap<string, string>;
  readonly body?: string;
  readonly timeoutMs?: number;
  /** Credentials for HTTP authentication (Basic, Digest, NTLM, Bearer). */
  readonly auth?: { readonly username: string; readonly password: string };
}

/** Raw result of one completed HTTP exchange (after following redirects). */
interface HttpResponseSpec {
  /** Final URL after following any redirects. */
  readonly url: string;
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
  /** Binary body for image/font/media content types. Null for text responses. */
  readonly bodyBinary: Uint8Array | null;
  readonly redirected: boolean;
  /** Every URL visited before reaching the final one, in order. */
  readonly redirectChain: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSPORT ABSTRACTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimal contract a transport must satisfy.
 * RequestManager never imports `fetch` directly outside of FetchHttpClient,
 * so tests can inject a fully deterministic fake.
 */
interface IHttpClient {
  send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec>;
}

/**
 * Production transport built on the standard fetch() API.
 *
 * Uses `redirect: 'manual'` so RequestManager — not the platform — decides
 * whether each redirect target is safe to follow.  This is what lets us
 * validate every hop against BLOCKED_PROTOCOLS.
 */
class FetchHttpClient implements IHttpClient {
  private readonly contentDecoder: ContentDecoder;

  constructor() {
    this.contentDecoder = new ContentDecoder();
  }

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    const headersInit: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      headersInit[key] = value;
    }

    // Advertise compression support
    if (!headersInit['accept-encoding']) {
      headersInit['accept-encoding'] = ACCEPT_ENCODING;
    }

    const init: RequestInit = {
      method:   request.method,
      headers:  headersInit,
      signal,
      redirect: 'manual',
    };
    if (request.body !== undefined) {
      init.body = request.body;
    }

    const res = await fetch(request.url, init);

    const headers = new Map<string, string>();
    res.headers.forEach((value, key) => headers.set(key.toLowerCase(), value));

    // When the request went through the Vite dev proxy (which follows
    // redirects server-side), report the final URL back to the caller so the
    // address bar and history reflect where the document actually came from.
    const proxyFinalUrl = headers.get('x-nova-proxy-url');
    headers.delete('x-nova-proxy-url');

    // Detect binary content types (images, fonts, media)
    const contentType = headers.get('content-type') ?? '';
    const isBinary = contentType.startsWith('image/')
      || contentType.startsWith('font/')
      || contentType.startsWith('audio/')
      || contentType.startsWith('video/');

    let body: string;
    let bodyBinary: Uint8Array | null = null;

    if (isBinary) {
      body = '';
      try {
        const buffer = await res.arrayBuffer();
        bodyBinary = new Uint8Array(buffer);
      } catch {
        // Redirect responses may not have a body
        bodyBinary = null;
      }
    } else {
      body = await FetchHttpClient.safeReadText(res);
    }

    // Decompress if Content-Encoding is present
    const contentEncoding = headers.get('content-encoding');
    if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
      try {
        const sourceData = bodyBinary ? Buffer.from(bodyBinary) : Buffer.from(body, 'utf-8');
        const decoded = await this.contentDecoder.decodeFromString(contentEncoding, sourceData.toString('utf-8'));
        const decodedStr = decoded.toString('utf-8');
        if (isBinary) {
          body = '';
          bodyBinary = new Uint8Array(decoded);
        } else {
          body = decodedStr;
          bodyBinary = null;
        }
      } catch {
        // If decompression fails, use the raw body
      }
    }

    return {
      url:           proxyFinalUrl ?? request.url,   // caller (RequestManager) tracks the final URL itself
      statusCode:    res.status,
      statusText:    res.statusText,
      headers,
      body,
      bodyBinary,
      redirected:    false,         // RequestManager sets this after following redirects
      redirectChain: [],
    };
  }

  /**
   * A manual (3xx) redirect response has no readable body in some runtimes.
   * Swallow the read error and return an empty string rather than throwing.
   */
  private static async safeReadText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '';
    }
  }
}

/**
 * WebSocket transport for ws: and wss: protocols.
 *
 * Uses the standard WebSocket API. Messages are collected as they arrive
 * and returned as a single concatenated body when the connection closes.
 * The response status is always 200 (WebSocket has no HTTP status codes).
 */
class WebSocketHttpClient implements IHttpClient {
  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    return new Promise<HttpResponseSpec>((resolve, reject) => {
      const messages: string[] = [];
      let settled = false;

      const ws = new WebSocket(request.url);

      ws.onopen = () => {
        // If there's a body, send it as the initial message.
        if (request.body !== undefined) {
          ws.send(request.body);
        }
        // For WebSocket "page loads", we close immediately after opening
        // since the initial handshake is the connection itself.
        ws.close(1000);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          messages.push(event.data);
        } else if (event.data instanceof Blob) {
          // Blob data — we'd need to read it asynchronously, but for simplicity
          // we store a placeholder. Real usage would use event.data.text().
          messages.push('[binary data]');
        }
      };

      ws.onclose = () => {
        if (settled) return;
        settled = true;

        const headers = new Map<string, string>();
        headers.set('content-type', 'text/plain');
        headers.set('x-websocket-protocol', ws.protocol || 'ws');

        resolve({
          url:           request.url,
          statusCode:    200,
          statusText:    'WebSocket OK',
          headers,
          body:          messages.join('\n'),
          bodyBinary:    null,
          redirected:    false,
          redirectChain: [],
        });
      };

      ws.onerror = (err: Event) => {
        if (settled) return;
        settled = true;
        reject(new Error(`WebSocket connection failed for "${request.url}": ${err.type}`));
      };

      // Handle external abort signal.
      signal.addEventListener('abort', () => {
        if (settled) return;
        settled = true;
        ws.close(1000, 'Aborted by caller');
        reject(new Error(`WebSocket connection to "${request.url}" was aborted.`));
      });
    });
  }
}

/**
 * FTP transport for ftp: and ftps: protocols.
 *
 * Since browsers cannot natively perform FTP transfers via fetch(),
 * this transport returns a directory listing or file content by
 * constructing an FTP URL and delegating to the platform's fetch
 * (which may support ftp in some environments) or a built-in FTP client.
 *
 * In environments where FTP is not supported by fetch(), this falls back
 * to an error response indicating FTP is not available.
 */
class FtpHttpClient implements IHttpClient {
  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    // Attempt FTP via fetch (some runtimes/environments support it).
    try {
      const res = await fetch(request.url, {
        method:   request.method,
        signal,
        redirect: 'follow',
      });

      const headers = new Map<string, string>();
      res.headers.forEach((value, key) => headers.set(key.toLowerCase(), value));

      let body = '';
      try {
        body = await res.text();
      } catch {
        body = '';
      }

      return {
        url:           request.url,
        statusCode:    res.status,
        statusText:    res.statusText,
        headers,
        body,
        bodyBinary:    null,
        redirected:    false,
        redirectChain: [],
      };
    } catch {
      // FTP not supported by fetch in this environment.
      // Return an informational response.
      const headers = new Map<string, string>();
      headers.set('content-type', 'text/html');
      return {
        url:           request.url,
        statusCode:    200,
        statusText:    'FTP Not Available',
        headers,
        body:          `<html><body><h1>FTP Not Available</h1><p>FTP connection to "${request.url}" is not supported in this environment.</p></body></html>`,
        bodyBinary:    null,
        redirected:    false,
        redirectChain: [],
      };
    }
  }
}

/**
 * SFTP transport for sftp: protocol.
 *
 * SFTP runs over SSH and is not natively supported by browser fetch().
 * This transport returns a descriptive error or placeholder response.
 */
class SftpHttpClient implements IHttpClient {
  async send(request: HttpRequestSpec, _signal: AbortSignal): Promise<HttpResponseSpec> {
    const headers = new Map<string, string>();
    headers.set('content-type', 'text/html');
    return {
      url:           request.url,
      statusCode:    200,
      statusText:    'SFTP Not Available',
      headers,
      body:          `<html><body><h1>SFTP Not Available</h1><p>SFTP connection to "${request.url}" requires an SSH client. Use an external SFTP application.</p></body></html>`,
      bodyBinary:    null,
      redirected:    false,
      redirectChain: [],
    };
  }
}

/**
 * Build a ProxyConfig from standard proxy environment variables.
 *
 * Supported variables:
 *   NOVA_SOCKS_PROXY   socks://, socks4://, socks4a://, socks5:// or socks5h:// URL
 *   ALL_PROXY          scheme-aware fallback: socks → socksProxy,
 *                      http/https → httpProxy/httpsProxy
 *   HTTP_PROXY         http:// or https:// proxy URL → httpProxy
 *   HTTPS_PROXY        http:// or https:// proxy URL → httpsProxy
 *   NO_PROXY           comma-separated hostname bypass list ("localhost,127.0.0.1")
 *
 * Malformed or unsupported URLs are ignored, so a mis-set variable never
 * silently routes traffic through a broken tunnel.
 */
export function createProxyConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = readProcessEnv(),
): Partial<ProxyConfig> {
  const config: {
    socksProxy?: string;
    httpProxy?: string;
    httpsProxy?: string;
    noProxy?: string[];
  } = {};

  const novaSocks = env.NOVA_SOCKS_PROXY;
  if (proxyUrlKind(novaSocks) === 'socks') config.socksProxy = novaSocks;

  const allProxy = env.ALL_PROXY ?? env.all_proxy;
  const allKind = proxyUrlKind(allProxy);
  if (allKind === 'socks' && !config.socksProxy) config.socksProxy = allProxy;

  const httpProxy = env.HTTP_PROXY ?? env.http_proxy;
  const httpKind = proxyUrlKind(httpProxy);
  if (httpKind === 'http' || httpKind === 'https') config.httpProxy = httpProxy;
  else if (allKind === 'http') config.httpProxy = allProxy;

  const httpsProxy = env.HTTPS_PROXY ?? env.https_proxy;
  const httpsKind = proxyUrlKind(httpsProxy);
  if (httpsKind === 'http' || httpsKind === 'https') config.httpsProxy = httpsProxy;
  else if (allKind === 'https') config.httpsProxy = allProxy;

  if (allKind === 'http' && !config.httpsProxy) config.httpsProxy = allProxy;
  if (allKind === 'https' && !config.httpProxy) config.httpProxy = allProxy;

  const noProxy = env.NO_PROXY ?? env.no_proxy;
  if (noProxy) {
    config.noProxy = noProxy.split(',').map(part => part.trim()).filter(Boolean);
  }

  return config;
}

type ProxyUrlKind = 'socks' | 'http' | 'https' | null;

function proxyUrlKind(value: string | undefined): ProxyUrlKind {
  if (!value) return null;
  try {
    const protocol = new URL(value).protocol;
    if (protocol.startsWith('socks')) return 'socks';
    if (protocol === 'http:') return 'http';
    if (protocol === 'https:') return 'https';
    return null;
  } catch {
    return null;
  }
}

/**
 * Map a conventional `http://` / `https://` proxy URL onto the gateway
 * registry's `http-proxy:` / `https-proxy:` schemes so `resolve()` classifies
 * it as a proxy (standard browser-style proxy env vars use `http://` URLs).
 */
function normalizeProxyUrlForGateway(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (u.protocol === 'http:') return `http-proxy:${proxyUrl.slice('http:'.length)}`;
    if (u.protocol === 'https:') return `https-proxy:${proxyUrl.slice('https:'.length)}`;
  } catch { /* fall through */ }
  return proxyUrl;
}

function readProcessEnv(): Readonly<Record<string, string | undefined>> {
  if (typeof process === 'undefined') {
    return {};
  }
  const env = (process as { env?: Readonly<Record<string, string | undefined>> }).env;
  return env ?? {};
}

/**
 * Gateway-aware HTTP transport that routes requests through configured proxies.
 *
 * Consults the GatewayProtocolManager to determine if a proxy (HTTP, SOCKS4,
 * SOCKS5) is configured for outbound requests. If no proxy applies, delegates
 * to the inner (default) FetchHttpClient.
 *
 * This enables the browser to use corporate proxies, VPN tunnels, and
 * other gateway infrastructure transparently.
 */
class ProxyAwareHttpClient implements IHttpClient {
  private readonly inner: FetchHttpClient;
  private readonly gatewayManager: GatewayProtocolManager;
  private readonly proxyConfig: ProxyConfig;
  private socksTransport: IHttpClient | null = null;
  private socksTransportUrl: string | null = null;
  private httpConnectTransport: IHttpClient | null = null;
  private httpConnectTransportUrl: string | null = null;
  private readonly tlsHandler?: ITlsHandler;

  constructor(
    proxyConfig?: Partial<ProxyConfig>,
    gatewayManager?: GatewayProtocolManager,
    tlsHandler?: ITlsHandler,
  ) {
    this.inner           = new FetchHttpClient();
    this.gatewayManager  = gatewayManager ?? new GatewayProtocolManager();
    this.tlsHandler      = tlsHandler;
    this.proxyConfig     = {
      httpProxy:  proxyConfig?.httpProxy  ?? null,
      httpsProxy: proxyConfig?.httpsProxy ?? null,
      socksProxy: proxyConfig?.socksProxy ?? null,
      noProxy:    proxyConfig?.noProxy    ?? ['localhost', '127.0.0.1', '::1'],
      pacUrl:     proxyConfig?.pacUrl     ?? null,
      useWpad:    proxyConfig?.useWpad    ?? false,
    };
  }

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    // Determine if this request should go through a proxy.
    const proxyUrl = this.selectProxyForRequest(request.url);

    if (proxyUrl !== null) {
      const proxyResult = this.gatewayManager.resolve(normalizeProxyUrlForGateway(proxyUrl));
      if (proxyResult?.category === GatewayCategory.Proxy) {
        return this.sendViaProxy(request, signal, proxyUrl, proxyResult.protocol);
      }
    }

    // No proxy configured or applicable — use default transport.
    return this.inner.send(request, signal);
  }

  private selectProxyForRequest(url: string): string | null {
    try {
      const u = new URL(url);
      const hostname = u.hostname;

      // Check no-proxy list.
      for (const bypass of this.proxyConfig.noProxy) {
        if (hostname === bypass || hostname.endsWith('.' + bypass)) {
          return null;
        }
      }

      if (u.protocol === 'https:' && this.proxyConfig.httpsProxy) {
        return this.proxyConfig.httpsProxy;
      }
      if (u.protocol === 'http:' && this.proxyConfig.httpProxy) {
        return this.proxyConfig.httpProxy;
      }
      // SOCKS proxy applies to all protocols.
      if (this.proxyConfig.socksProxy) {
        return this.proxyConfig.socksProxy;
      }
    } catch {
      // Invalid URL — fall through to direct connection.
    }
    return null;
  }

  private async sendViaProxy(
    request: HttpRequestSpec,
    signal: AbortSignal,
    proxyUrl: string,
    proxyProtocol: string,
  ): Promise<HttpResponseSpec> {
    // For HTTP/HTTPS proxies, use CONNECT tunneling.
    if (proxyProtocol === 'http-proxy' || proxyProtocol === 'https-proxy') {
      return this.sendViaHttpProxy(request, signal, proxyUrl);
    }

    // SOCKS proxies (socks4 / socks4a / socks5) tunnel via raw sockets.
    return this.sendViaSocks(request, signal, proxyUrl);
  }

  private async sendViaSocks(
    request: HttpRequestSpec,
    signal: AbortSignal,
    proxyUrl: string,
  ): Promise<HttpResponseSpec> {
    const isNode = typeof process !== 'undefined' && typeof (process as { versions?: { node?: string } }).versions?.node === 'string';
    if (!isNode) {
      // Raw sockets are unavailable outside Node — keep the previous behavior.
      console.warn(
        `[ProxyAwareHttpClient] SOCKS proxy "${proxyUrl}" requested for "${request.url}" ` +
        `but SOCKS tunneling requires a Node socket transport. Falling back to direct connection.`,
      );
      return this.inner.send(request, signal);
    }

    if (this.socksTransport === null || this.socksTransportUrl !== proxyUrl) {
      this.socksTransport = new RawSocketHttpClient({
        socksProxy: proxyUrl,
        tlsHandler: this.tlsHandler,
      });
      this.socksTransportUrl = proxyUrl;
    }
    return this.socksTransport.send(request, signal);
  }

  private async sendViaHttpProxy(
    request: HttpRequestSpec,
    signal: AbortSignal,
    proxyUrl: string,
  ): Promise<HttpResponseSpec> {
    const isNode = typeof process !== 'undefined' && typeof (process as { versions?: { node?: string } }).versions?.node === 'string';
    if (!isNode) {
      // Raw sockets are unavailable outside Node — keep the previous behavior
      // (absolute-URI request to the proxy via fetch).
      return this.sendViaHttpProxyLegacy(request, signal, proxyUrl);
    }

    if (this.httpConnectTransport === null || this.httpConnectTransportUrl !== proxyUrl) {
      this.httpConnectTransport = new RawSocketHttpClient({
        httpProxy: proxyUrl,
        tlsHandler: this.tlsHandler,
      });
      this.httpConnectTransportUrl = proxyUrl;
    }
    return this.httpConnectTransport.send(request, signal);
  }

  private async sendViaHttpProxyLegacy(
    request: HttpRequestSpec,
    signal: AbortSignal,
    proxyUrl: string,
  ): Promise<HttpResponseSpec> {
    // Use the proxy as the actual endpoint; the target URL goes into the
    // request line for non-CONNECT requests, or into the Host header.
    const proxyHeaders = new Map(request.headers);
    const targetUrl = new URL(request.url);
    proxyHeaders.set('host', targetUrl.host);

    const proxiedSpec: HttpRequestSpec = {
      ...request,
      url:     proxyUrl,
      headers: proxyHeaders,
    };

    return this.inner.send(proxiedSpec, signal);
  }

  /** Update proxy configuration at runtime. */
  updateProxyConfig(partial: Partial<ProxyConfig>): void {
    const prevSocks  = this.proxyConfig.socksProxy;
    const prevHttp   = this.proxyConfig.httpProxy;
    const prevHttps  = this.proxyConfig.httpsProxy;
    Object.assign(this.proxyConfig, partial);
    if (this.proxyConfig.socksProxy !== prevSocks) {
      this.socksTransport = null;
      this.socksTransportUrl = null;
    }
    if (this.proxyConfig.httpProxy !== prevHttp || this.proxyConfig.httpsProxy !== prevHttps) {
      this.httpConnectTransport = null;
      this.httpConnectTransportUrl = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RETRY POLICY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decides whether a failed attempt should be retried and how long to wait.
 * Open/Closed: new strategies (e.g. fixed delay, no-retry) implement this
 * interface without RequestManager ever changing.
 */
interface RetryPolicy {
  readonly maxRetries: number;
  /** True when another attempt should be made for this outcome. */
  shouldRetry(attempt: number, statusCode: number | null, isNetworkError: boolean): boolean;
  /** Milliseconds to wait before the given attempt number (1-indexed). */
  getDelayMs(attempt: number): number;
}

/**
 * Doubles the delay on every attempt, capped at maxDelayMs, with up to ±20%
 * random jitter so many simultaneously-failing requests don't retry in lockstep.
 */
class ExponentialBackoffRetryPolicy implements RetryPolicy {
  readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly retryableStatusCodes: ReadonlySet<number>;

  constructor(options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    retryableStatusCodes?: ReadonlySet<number>;
  }) {
    this.maxRetries           = options?.maxRetries           ?? 2;
    this.baseDelayMs          = options?.baseDelayMs          ?? 200;
    this.maxDelayMs           = options?.maxDelayMs           ?? 4_000;
    this.retryableStatusCodes = options?.retryableStatusCodes ??
      new Set([408, 425, 429, 500, 502, 503, 504]);
  }

  shouldRetry(attempt: number, statusCode: number | null, isNetworkError: boolean): boolean {
    if (attempt >= this.maxRetries) return false;
    if (isNetworkError) return true;
    if (statusCode !== null && this.retryableStatusCodes.has(statusCode)) return true;
    return false;
  }

  getDelayMs(attempt: number): number {
    const exp     = Math.min(this.baseDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    const jitter   = exp * 0.2 * (Math.random() * 2 - 1); // ±20%
    return Math.max(0, Math.round(exp + jitter));
  }
}

/** Never retries — useful for tests or latency-sensitive callers. */
class NoRetryPolicy implements RetryPolicy {
  readonly maxRetries = 0;
  shouldRetry(): boolean { return false; }
  getDelayMs(): number { return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

/** Base class for every failure RequestManager can produce. */
class NetworkError extends Error {
  readonly url: string;
  constructor(url: string, message: string) {
    super(message);
    this.name = 'NetworkError';
    this.url  = url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class RequestTimeoutError extends NetworkError {
  readonly timeoutMs: number;
  constructor(url: string, timeoutMs: number) {
    super(url, `Request to "${url}" timed out after ${timeoutMs}ms.`);
    this.name      = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class RequestAbortedError extends NetworkError {
  constructor(url: string) {
    super(url, `Request to "${url}" was aborted by the caller.`);
    this.name = 'RequestAbortedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class TooManyRedirectsError extends NetworkError {
  readonly redirectChain: readonly string[];
  constructor(url: string, chain: readonly string[]) {
    super(url, `Too many redirects starting from "${url}" (${chain.length} hops).`);
    this.name          = 'TooManyRedirectsError';
    this.redirectChain = chain;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class BlockedRedirectError extends NetworkError {
  readonly targetUrl: string;
  readonly protocol: string;
  constructor(url: string, targetUrl: string, protocol: string) {
    super(url, `Redirect to "${targetUrl}" blocked: protocol "${protocol}" is not allowed.`);
    this.name      = 'BlockedRedirectError';
    this.targetUrl = targetUrl;
    this.protocol  = protocol;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

type RequestEventType =
  | 'requestStarted'
  | 'requestRetrying'
  | 'requestRedirected'
  | 'requestCompleted'
  | 'requestFailed';

interface RequestStartedEvent   { kind: 'requestStarted';   url: string; attempt: number }
interface RequestRetryingEvent  { kind: 'requestRetrying';  url: string; attempt: number; delayMs: number }
interface RequestRedirectedEvent{ kind: 'requestRedirected';from: string; to: string }
interface RequestCompletedEvent { kind: 'requestCompleted'; response: HttpResponseSpec }
interface RequestFailedEvent    { kind: 'requestFailed';    url: string; error: Error }

type RequestEvent =
  | RequestStartedEvent
  | RequestRetryingEvent
  | RequestRedirectedEvent
  | RequestCompletedEvent
  | RequestFailedEvent;

class RequestEventBus {
  private readonly channels = new Map<RequestEventType, Set<(e: RequestEvent) => void>>();

  on(type: RequestEventType, handler: (e: RequestEvent) => void): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: RequestEventType, handler: (e: RequestEvent) => void): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: RequestEvent): void {
    const handlers = this.channels.get(event.kind as RequestEventType);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); }
      catch (err) { console.error(`[RequestEventBus] Handler threw on "${event.kind}":`, err); }
    }
  }

  dispose(): void { this.channels.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IRequestManager extends IPageLoader {
  /** Send one HTTP request, following redirects and applying retry policy. */
  send(options: RequestOptions, signal?: AbortSignal): Promise<HttpResponseSpec>;
  setRetryPolicy(policy: RetryPolicy): void;
  getRetryPolicy(): RetryPolicy;
  on(type: RequestEventType,  handler: (e: RequestEvent) => void): void;
  off(type: RequestEventType, handler: (e: RequestEvent) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS  = 30_000;
const DEFAULT_MAX_REDIRECTS = 10;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — signal combination & sleeping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge two AbortSignals into one that aborts as soon as EITHER source does.
 * Hand-rolled instead of relying on AbortSignal.any() to keep behaviour
 * explicit and avoid depending on a fairly recent runtime addition.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();

  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }

  const onAbort = (): void => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });

  return controller.signal;
}

/** Create an AbortSignal that fires after `ms` milliseconds, plus a canceller. */
function createTimeoutSignal(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(handle),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST MANAGER
// ─────────────────────────────────────────────────────────────────────────────

class RequestManager implements IRequestManager {

  private readonly client: IHttpClient;
  private readonly config: AppConfig;
  private readonly bus:    RequestEventBus;
  private retryPolicy:     RetryPolicy;
  private readonly maxRedirects: number;
  private readonly authenticator: HttpAuthenticator;

  constructor(
    client: IHttpClient = new FetchHttpClient(),
    config: AppConfig,
    options?: { retryPolicy?: RetryPolicy; maxRedirects?: number },
  ) {
    this.client       = client;
    this.config       = config;
    this.bus          = new RequestEventBus();
    this.retryPolicy  = options?.retryPolicy  ?? new ExponentialBackoffRetryPolicy();
    this.maxRedirects = options?.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    this.authenticator = new HttpAuthenticator();
  }

  // ── IPageLoader ────────────────────────────────────────────────────────────

  async load(url: string, signal: AbortSignal): Promise<PageLoadResult> {
    const res = await this.send({ url }, signal);
    return {
      url:         res.url,
      statusCode:  res.statusCode,
      contentType: res.headers.get('content-type') ?? 'text/html',
      body:        res.body,
      headers:     res.headers,
      loadedAt:    Date.now(),
    };
  }

  // ── IRequestManager ────────────────────────────────────────────────────────

  async send(options: RequestOptions, signal?: AbortSignal): Promise<HttpResponseSpec> {
    const externalSignal = signal ?? new AbortController().signal;

    let currentUrl  = options.url;
    const chain: string[] = [];
    let attempt     = 0;
    let authHeader: string | null = null;
    let authRetried = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.throwIfExternallyAborted(externalSignal, currentUrl);

      const spec = this.buildRequestSpec(options, currentUrl, authHeader);
      const { signal: timeoutSignal, cancel } = createTimeoutSignal(spec.timeoutMs);
      const combined = combineSignals(externalSignal, timeoutSignal);

      this.bus.emit({ kind: 'requestStarted', url: currentUrl, attempt });

      let res: HttpResponseSpec;
      try {
        res = await this.client.send(spec, combined);
      } catch (err) {
        cancel();
        this.throwIfExternallyAborted(externalSignal, currentUrl);

        // Any abort reaching here that ISN'T the external signal must be our
        // own per-attempt timeout firing.
        const isTimeout = err instanceof Error && err.name === 'AbortError';

        if (isTimeout) {
          if (this.retryPolicy.shouldRetry(attempt + 1, null, true)) {
            attempt++;
            const delay = this.retryPolicy.getDelayMs(attempt);
            this.bus.emit({ kind: 'requestRetrying', url: currentUrl, attempt, delayMs: delay });
            await sleep(delay);
            continue;
          }
          const timeoutError = new RequestTimeoutError(currentUrl, spec.timeoutMs);
          this.bus.emit({ kind: 'requestFailed', url: currentUrl, error: timeoutError });
          throw timeoutError;
        }

        // Generic network failure (DNS, connection refused, TLS, etc).
        if (this.retryPolicy.shouldRetry(attempt + 1, null, true)) {
          attempt++;
          const delay = this.retryPolicy.getDelayMs(attempt);
          this.bus.emit({ kind: 'requestRetrying', url: currentUrl, attempt, delayMs: delay });
          await sleep(delay);
          continue;
        }

        const networkError = new NetworkError(
          currentUrl,
          `Network request to "${currentUrl}" failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.bus.emit({ kind: 'requestFailed', url: currentUrl, error: networkError });
        throw networkError;
      }

      cancel();

      // ── Redirect? ────────────────────────────────────────────────────────
      if (REDIRECT_STATUS_CODES.has(res.statusCode)) {
        const location = res.headers.get('location');
        if (!location) {
          const err = new NetworkError(
            currentUrl,
            `Received ${res.statusCode} redirect from "${currentUrl}" with no Location header.`,
          );
          this.bus.emit({ kind: 'requestFailed', url: currentUrl, error: err });
          throw err;
        }

        const resolved = this.resolveRedirectUrl(currentUrl, location);
        this.assertRedirectAllowed(currentUrl, resolved);

        chain.push(currentUrl);
        if (chain.length > this.maxRedirects) {
          const err = new TooManyRedirectsError(options.url, chain);
          this.bus.emit({ kind: 'requestFailed', url: currentUrl, error: err });
          throw err;
        }

        this.bus.emit({ kind: 'requestRedirected', from: currentUrl, to: resolved });
        currentUrl = resolved;
        continue; // redirects don't count against the retry budget
      }

      // ── HTTP Authentication (401/407)? ──────────────────────────────────
      if ((res.statusCode === 401 || res.statusCode === 407) && !authRetried && options.auth) {
        const challengeHeader = res.headers.get(
          res.statusCode === 401 ? 'www-authenticate' : 'proxy-authenticate'
        );
        if (challengeHeader && this.authenticator.canHandle(challengeHeader)) {
          const challenge = this.authenticator.parseChallenge(challengeHeader);
          if (challenge) {
            authHeader = this.authenticator.generateResponse(
              challenge,
              { username: options.auth.username, password: options.auth.password },
  options.method ?? 'GET',
              currentUrl,
            );
            authRetried = true;
            // Retry with auth header — does not count against retry budget
            continue;
          }
        }
      }

      // ── Retryable error status? ─────────────────────────────────────────
      if (this.retryPolicy.shouldRetry(attempt + 1, res.statusCode, false)) {
        attempt++;
        const delay = this.retryPolicy.getDelayMs(attempt);
        this.bus.emit({ kind: 'requestRetrying', url: currentUrl, attempt, delayMs: delay });
        await sleep(delay);
        continue;
      }

      // ── Terminal outcome — success or non-retryable error status ───────
      const final: HttpResponseSpec = {
        ...res,
        url:           currentUrl,
        redirected:    chain.length > 0,
        redirectChain: chain,
      };
      this.bus.emit({ kind: 'requestCompleted', response: final });
      return final;
    }
  }

  setRetryPolicy(policy: RetryPolicy): void {
    this.retryPolicy = policy;
  }

  getRetryPolicy(): RetryPolicy {
    return this.retryPolicy;
  }

  on(type: RequestEventType,  handler: (e: RequestEvent) => void): void { this.bus.on(type, handler); }
  off(type: RequestEventType, handler: (e: RequestEvent) => void): void { this.bus.off(type, handler); }

  /** Release internal listeners. Safe to call multiple times. */
  dispose(): void {
    this.bus.dispose();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private buildRequestSpec(options: RequestOptions, url: string, authHeader?: string | null): HttpRequestSpec {
    const headers = new Map<string, string>(options.headers ?? []);

    if (!headers.has('user-agent')) {
      headers.set('user-agent', this.config.userAgent);
    }
    if (!headers.has('accept')) {
      headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    }
    if (authHeader && !headers.has('authorization')) {
      headers.set('authorization', authHeader);
    }

    return {
      url,
      method:    options.method ?? 'GET',
      headers,
      body:      options.body,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /** Resolve a possibly-relative Location header against the current URL. */
  private resolveRedirectUrl(currentUrl: string, location: string): string {
    try {
      return new URL(location, currentUrl).toString();
    } catch {
      throw new NetworkError(
        currentUrl,
        `Redirect Location header "${location}" could not be resolved against "${currentUrl}".`,
      );
    }
  }

  /**
   * Reuses url-parser.ts's BLOCKED_PROTOCOLS so a malicious server cannot use
   * a redirect chain to smuggle an address-bar-unsafe scheme past the browser.
   */
  private assertRedirectAllowed(fromUrl: string, toUrl: string): void {
    let protocol: string;
    try {
      protocol = new URL(toUrl).protocol;
    } catch {
      throw new NetworkError(fromUrl, `Redirect target "${toUrl}" is not a valid URL.`);
    }

    if (BLOCKED_PROTOCOLS.has(protocol)) {
      throw new BlockedRedirectError(fromUrl, toUrl, protocol);
    }
  }

  private throwIfExternallyAborted(signal: AbortSignal, url: string): void {
    if (signal.aborted) {
      throw new RequestAbortedError(url);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  RequestManager,
  FetchHttpClient,
  WebSocketHttpClient,
  FtpHttpClient,
  SftpHttpClient,
  ProxyAwareHttpClient,
  ExponentialBackoffRetryPolicy,
  NoRetryPolicy,
  NetworkError,
  RequestTimeoutError,
  RequestAbortedError,
  TooManyRedirectsError,
  BlockedRedirectError,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_REDIRECTS,
};

export type {
  IRequestManager,
  IHttpClient,
  RetryPolicy,
  HttpMethod,
  HttpRequestSpec,
  HttpResponseSpec,
  RequestOptions,
  RequestEvent,
  RequestEventType,
};
