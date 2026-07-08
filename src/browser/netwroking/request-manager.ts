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

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

enum HttpMethod {
  GET     = 'GET',
  POST    = 'POST',
  PUT     = 'PUT',
  PATCH   = 'PATCH',
  DELETE  = 'DELETE',
  HEAD    = 'HEAD',
  OPTIONS = 'OPTIONS',
}

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
}

/** Raw result of one completed HTTP exchange (after following redirects). */
interface HttpResponseSpec {
  /** Final URL after following any redirects. */
  readonly url: string;
  readonly statusCode: number;
  readonly statusText: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: string;
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
  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    const headersInit: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      headersInit[key] = value;
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

    const body = await FetchHttpClient.safeReadText(res);

    return {
      url:           request.url,   // caller (RequestManager) tracks the final URL itself
      statusCode:    res.status,
      statusText:    res.statusText,
      headers,
      body,
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

    while (true) {
      this.throwIfExternallyAborted(externalSignal, currentUrl);

      const spec = this.buildRequestSpec(options, currentUrl);
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

  private buildRequestSpec(options: RequestOptions, url: string): HttpRequestSpec {
    const headers = new Map<string, string>(options.headers ?? []);

    if (!headers.has('user-agent')) {
      headers.set('user-agent', this.config.userAgent);
    }
    if (!headers.has('accept')) {
      headers.set('accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
    }

    return {
      url,
      method:    options.method ?? HttpMethod.GET,
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
  ExponentialBackoffRetryPolicy,
  NoRetryPolicy,
  HttpMethod,
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
  HttpRequestSpec,
  HttpResponseSpec,
  RequestOptions,
  RequestEvent,
  RequestEventType,
};
