import type { IDisposable } from '../../app/dependency-container';
import type { IHttpClient, RetryPolicy, HttpMethod, HttpRequestSpec, HttpResponseSpec, RequestEventType, RequestEvent } from './request-manager';
import { FetchHttpClient, ExponentialBackoffRetryPolicy, NetworkError, RequestAbortedError } from './request-manager';
import type { IResponseParser } from './response-parser';
import { ResponseParser } from './response-parser';
import type { DiscoveredResource, DiscoveredResourceKind } from '../rendering/html-parser';
import type { ITrackerBlocker } from '../security/tracker-blocker';
import type { ICacheManager } from './cache-manager';
import type { ICorsEngine, CorsRequest } from '../security/cors';
import { CorsMode, CorsCredentials, CorsBlockedError, CorsViolationError } from '../security/cors';
import { parseOrigin, isSameOrigin, isSameSite } from '../security/origin-service';
import { PriorityQueue } from './priority-queue';
import { BandwidthEstimator } from './bandwidth-estimator';
import type { ICookieJar } from './cookie-jar';

interface ResourceLoadResult {
  readonly url: string;
  readonly kind: DiscoveredResourceKind;
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: string;
  /** Binary body for image/font/media content types. Null for text responses. */
  readonly bodyBinary: Uint8Array | null;
  readonly headers: ReadonlyMap<string, string>;
  readonly loadedAt: number;
  readonly durationMs: number;
  readonly fromCache: boolean;
  readonly error: string | null;
  /** DNS/connect/TLS/wait/download breakdown, when the platform exposed it. */
  readonly timing?: ResourceLoadTiming;
}

/** DNS → Connect → TLS → Wait (TTFB) → Download breakdown for one request. */
interface ResourceLoadTiming {
  readonly dnsMs: number | null;
  readonly connectMs: number | null;
  readonly tlsMs: number | null;
  readonly ttfbMs: number | null;
  readonly downloadMs: number | null;
  readonly totalMs: number | null;
}

/**
 * Reads the real DNS/Connect/TLS/Wait/Download split for `url` from the
 * browser's own Resource Timing API — the same data DevTools' Network panel
 * "Timing" tab shows, and the only source for it: fetch() itself never
 * exposes these sub-phases, since the browser (not our JS) owns the socket.
 * Cross-origin entries omit the fine-grained fields unless the server sends
 * `Timing-Allow-Origin`, in which case every *Ms below is just null — never
 * thrown, so a locked-down third-party response still logs a normal entry.
 */
// The Resource Timing buffer defaults to 250 entries (Chromium/Firefox alike)
// and silently stops recording new ones once full — a page that loads more
// than 250 resources over its lifetime (trivial for an unbundled dev build,
// or any long-lived tab) would otherwise go quietly blind to every load
// after the 250th. Raised once, lazily, on first use.
let resourceTimingBufferRaised = false;

function computeResourceTiming(url: string): ResourceLoadTiming | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return null;

  if (!resourceTimingBufferRaised) {
    performance.setResourceTimingBufferSize?.(5000);
    resourceTimingBufferRaised = true;
  }

  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  let match: PerformanceResourceTiming | undefined;
  for (const entry of entries) {
    if (entry.name === url) match = entry; // last one wins — the just-finished request
  }
  if (!match) return null;

  const span = (a: number, b: number): number | null => (b > a ? b - a : null);
  const tlsMs = match.secureConnectionStart > 0 ? span(match.secureConnectionStart, match.connectEnd) : null;
  const connectMs = tlsMs !== null
    ? span(match.connectStart, match.secureConnectionStart)
    : span(match.connectStart, match.connectEnd);

  return {
    dnsMs: span(match.domainLookupStart, match.domainLookupEnd),
    connectMs,
    tlsMs,
    ttfbMs: span(match.requestStart, match.responseStart),
    downloadMs: span(match.responseStart, match.responseEnd),
    totalMs: match.responseEnd > 0 ? match.responseEnd - match.startTime : null,
  };
}

interface ResourceBatchResult {
  readonly results: readonly ResourceLoadResult[];
  readonly failed: number;
  readonly succeeded: number;
  readonly totalDurationMs: number;
}

type ResourcePriority = 'blocking' | 'high' | 'normal' | 'low' | 'deferred';

interface ResourceLoadOptions {
  readonly priority?: ResourcePriority;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface IResourceLoader extends IDisposable {
  loadResource(url: string, kind: DiscoveredResourceKind, options?: ResourceLoadOptions): Promise<ResourceLoadResult>;
  loadBatch(resources: readonly DiscoveredResource[], options?: ResourceLoadOptions): Promise<ResourceBatchResult>;
  loadStylesheet(url: string): Promise<string>;
  loadScript(url: string): Promise<string>;
  loadImage(url: string): Promise<ResourceLoadResult>;
  getPriority(kind: DiscoveredResourceKind, blocking: boolean, deferred: boolean): ResourcePriority;
  setMaxConcurrent(max: number): void;
  on(type: RequestEventType, handler: (event: RequestEvent) => void): void;
  off(type: RequestEventType, handler: (event: RequestEvent) => void): void;
  setOnLoad(listener: ((result: ResourceLoadResult) => void) | null): void;
}

class ResourceLoader implements IResourceLoader {
  private readonly client: IHttpClient;
  private readonly responseParser: IResponseParser;
  private readonly retryPolicy: RetryPolicy;
  private readonly blocker: ITrackerBlocker | null;
  private cache: ICacheManager | null = null;
  private cors: ICorsEngine | null = null;
  private cookieJar: ICookieJar | null = null;
  private pageOrigin = '';
  private maxConcurrent = 6;
  private activeCount = 0;
  private readonly pendingQueue = new PriorityQueue<{ resolve: () => void }>();
  private readonly bandwidth = new BandwidthEstimator();
  private onLoad: ((result: ResourceLoadResult) => void) | null = null;

  constructor(
    client: IHttpClient = new FetchHttpClient(),
    responseParser: IResponseParser = new ResponseParser(),
    retryPolicy: RetryPolicy = new ExponentialBackoffRetryPolicy({ maxRetries: 1 }),
    blocker: ITrackerBlocker | null = null,
    cache: ICacheManager | null = null,
  ) {
    this.client = client;
    this.responseParser = responseParser;
    this.retryPolicy = retryPolicy;
    this.blocker = blocker;
    this.cache = cache;
  }

  setCache(cache: ICacheManager): void {
    this.cache = cache;
  }

  setCors(cors: ICorsEngine, pageOrigin: string): void {
    this.cors = cors;
    this.pageOrigin = pageOrigin;
  }

  setCookieJar(cookieJar: ICookieJar): void {
    this.cookieJar = cookieJar;
  }

  async loadResource(url: string, kind: DiscoveredResourceKind, options?: ResourceLoadOptions): Promise<ResourceLoadResult> {
    const result = await this.loadResourceCore(url, kind, options);
    const timing = result.fromCache ? null : computeResourceTiming(url);
    const withTiming = timing ? { ...result, timing } : result;
    this.onLoad?.(withTiming);
    return withTiming;
  }

  /** Notified with every resource load's final result (success, error, cached, or blocked) — for a DevTools Network panel. */
  setOnLoad(listener: ((result: ResourceLoadResult) => void) | null): void {
    this.onLoad = listener;
  }

  private async loadResourceCore(url: string, _kind: DiscoveredResourceKind, options?: ResourceLoadOptions): Promise<ResourceLoadResult> {
    // ── Cache check ─────────────────────────────────────────────────────────
    if (this.cache) {
      const cached = await this.cache.get(url);
      if (cached) {
        return {
          url,
          kind: _kind,
          statusCode: cached.statusCode,
          contentType: cached.contentType,
          body: cached.body,
          bodyBinary: null,
          headers: cached.headers,
          loadedAt: Date.now(),
          durationMs: 0,
          fromCache: true,
          error: null,
        };
      }
    }

    const priorityWeight = options?.priority ? this.priorityWeight(options.priority) : 2;
    await this.acquireSlot(priorityWeight);

    const start = Date.now();

    // ── Block check ────────────────────────────────────────────────────────
    if (this.blocker) {
      const check = this.blocker.shouldBlock(url);
      if (check.blocked) {
        this.releaseSlot();
        return {
          url,
          kind: _kind,
          statusCode: 0,
          contentType: '',
          body: '',
          bodyBinary: null,
          headers: new Map(),
          loadedAt: Date.now(),
          durationMs: Date.now() - start,
          fromCache: false,
          error: `Blocked: ${check.category} — ${check.rule?.description ?? url}`,
        };
      }
    }

    // Enforces options.timeoutMs regardless of which IHttpClient is behind
    // `this.client` — FetchHttpClient never reads HttpRequestSpec.timeoutMs on
    // its own, so without this a slow/blackholed host hangs the whole pipeline
    // instead of failing fast (some clients, e.g. RawSocketHttpClient, also
    // enforce it themselves; this is a harmless, defense-in-depth duplicate).
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options?.timeoutMs ?? 15_000;

    try {
      const headers = new Map<string, string>([['accept', '*/*']]);
      const timeoutController = new AbortController();
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
      const externalSignal = options?.signal;
      if (externalSignal) {
        if (externalSignal.aborted) timeoutController.abort();
        else externalSignal.addEventListener('abort', () => timeoutController.abort(), { once: true });
      }
      const signal = timeoutController.signal;

      // ── CORS pre-request check ──────────────────────────────────────────
      let corsPreflightDone = false;
      if (this.cors && this.pageOrigin) {
        const corsReq: CorsRequest = {
          url,
          origin:      this.pageOrigin,
          method:      'GET',
          headers,
          mode:        CorsMode.Cors,
          credentials: CorsCredentials.Omit,
        };
        const preCheck = this.cors.checkRequest(corsReq);

        if (preCheck.decision === 'blocked') {
          this.releaseSlot();
          return {
            url,
            kind: _kind,
            statusCode: 0,
            contentType: '',
            body: '',
            bodyBinary: null,
            headers: new Map(),
            loadedAt: Date.now(),
            durationMs: Date.now() - start,
            fromCache: false,
            error: `CORS blocked: ${preCheck.reason}`,
          };
        }

        // Inject CORS request headers (e.g. Origin)
        for (const [k, v] of preCheck.requestHeaders) {
          headers.set(k, v);
        }

        // Perform pre-flight if required
        if (preCheck.requiresPreflight) {
          try {
            await this.cors.performPreflight(corsReq, { send: this.client.send.bind(this.client) } as never, signal);
            corsPreflightDone = true;
          } catch (err) {
            this.releaseSlot();
            const reason = err instanceof Error ? err.message : String(err);
            return {
              url,
              kind: _kind,
              statusCode: 0,
              contentType: '',
              body: '',
              bodyBinary: null,
              headers: new Map(),
              loadedAt: Date.now(),
              durationMs: Date.now() - start,
              fromCache: false,
              error: `CORS preflight failed: ${reason}`,
            };
          }
        }
      }

      const specBase: Omit<HttpRequestSpec, 'url'> = {
        method: 'GET',
        headers,
        timeoutMs,
      };

      // Follow 3xx redirects here — ResourceLoader talks to IHttpClient directly
      // (bypassing RequestManager), so redirect policy lives in this loop.
      const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
      const maxRedirects = 10;
      let currentUrl = url;
      let res: HttpResponseSpec;

      try {
        for (let hops = 0; ; hops++) {
          if (this.cookieJar) {
            const cookieHeader = this.cookieJar.getCookieHeader(currentUrl);
            if (cookieHeader) headers.set('cookie', cookieHeader);
            else headers.delete('cookie');
          }

          res = await this.client.send({ ...specBase, url: currentUrl }, signal);

          if (this.cookieJar) {
            const setCookies = res.setCookieHeaders
              ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
            if (setCookies.length > 0) this.cookieJar.setFromResponse(currentUrl, setCookies);
          }

          if (!redirectStatusCodes.has(res.statusCode)) {
            break;
          }

          const location = res.headers.get('location');
          if (!location) {
            throw new NetworkError(
              currentUrl,
              `Received ${res.statusCode} redirect from "${currentUrl}" with no Location header.`,
            );
          }
          if (hops >= maxRedirects) {
            throw new NetworkError(
              currentUrl,
              `Too many redirects while loading "${url}" (${hops + 1} hops).`,
            );
          }

          currentUrl = new URL(location, currentUrl).toString();
        }
      } catch (err) {
        if (signal.aborted) {
          throw new RequestAbortedError(currentUrl);
        }
        throw err;
      }

      const parsed = this.responseParser.parse(res);
      const durationMs = Date.now() - start;

      // ── CORS post-response check ────────────────────────────────────────
      if (this.cors && this.pageOrigin && !corsPreflightDone) {
        const corsReq: CorsRequest = {
          url,
          origin:      this.pageOrigin,
          method:      'GET',
          headers,
          mode:        CorsMode.Cors,
          credentials: CorsCredentials.Omit,
        };
        try {
          this.cors.checkResponse(corsReq, res);
        } catch (err) {
          if (err instanceof CorsViolationError) {
            this.releaseSlot();
            return {
              url,
              kind: _kind,
              statusCode: 0,
              contentType: '',
              body: '',
              bodyBinary: null,
              headers: new Map(),
              loadedAt: Date.now(),
              durationMs: Date.now() - start,
              fromCache: false,
              error: `CORS violation: ${err.message}`,
            };
          }
          throw err;
        }
      }

      // ── CORP (Cross-Origin-Resource-Policy) enforcement ──────────────────
      if (this.pageOrigin) {
        const corp = res.headers.get('cross-origin-resource-policy') ?? '';
        const requestOrigin = parseOrigin(url, this.pageOrigin);
        const isCrossOrigin = requestOrigin !== this.pageOrigin;

        if (isCrossOrigin && corp) {
          const corpValue = corp.trim().toLowerCase();
          if (corpValue === 'same-origin') {
            this.releaseSlot();
            return {
              url,
              kind: _kind,
              statusCode: 0,
              contentType: '',
              body: '',
              bodyBinary: null,
              headers: new Map(),
              loadedAt: Date.now(),
              durationMs: Date.now() - start,
              fromCache: false,
              error: `CORP violation: resource requires same-origin access but request is cross-origin`,
            };
          }
          if (corpValue === 'same-site' && !isSameSite(this.pageOrigin, requestOrigin)) {
            this.releaseSlot();
            return {
              url,
              kind: _kind,
              statusCode: 0,
              contentType: '',
              body: '',
              bodyBinary: null,
              headers: new Map(),
              loadedAt: Date.now(),
              durationMs: Date.now() - start,
              fromCache: false,
              error: `CORP violation: resource requires same-site access but request is cross-site`,
            };
          }
          // 'cross-origin' value explicitly allows cross-origin access
        }
      }

      // ── Record bandwidth ──────────────────────────────────────────────────
      this.bandwidth.record(res.body.length, durationMs);

      // ── Populate cache ────────────────────────────────────────────────────
      if (this.cache && res.statusCode >= 200 && res.statusCode < 400) {
        const etag = res.headers.get('etag') ?? null;
        const lastModified = res.headers.get('last-modified') ?? null;
        const cacheControl = res.headers.get('cache-control') ?? '';
        const immutable = cacheControl.includes('immutable');
        const maxAgeMatch = /max-age=(\d+)/.exec(cacheControl);
        const ttlMs = maxAgeMatch ? parseInt(maxAgeMatch[1]!) * 1000 : undefined;

        await this.cache.set(url, {
          url,
          body: res.body,
          contentType: parsed.mimeType.full || 'application/octet-stream',
          statusCode: res.statusCode,
          headers: res.headers,
          etag,
          lastModified,
          immutable,
          expiresAt: ttlMs ? Date.now() + ttlMs : null,
        });
      }

      return {
        url: currentUrl,
        kind: _kind,
        statusCode: res.statusCode,
        contentType: parsed.mimeType.full || 'application/octet-stream',
        body: res.body,
        bodyBinary: res.bodyBinary,
        headers: res.headers,
        loadedAt: Date.now(),
        durationMs,
        fromCache: false,
        error: null,
      };
    } catch (err) {
      const errorMessage = timedOut
        ? `Request to "${url}" timed out after ${timeoutMs}ms.`
        : err instanceof Error ? err.message : String(err);
      return {
        url,
        kind: _kind,
        statusCode: 0,
        contentType: '',
        body: '',
        bodyBinary: null,
        headers: new Map(),
        loadedAt: Date.now(),
        durationMs: Date.now() - start,
        fromCache: false,
        error: errorMessage,
      };
    } finally {
      clearTimeout(timeoutTimer);
      this.releaseSlot();
    }
  }

  async loadBatch(resources: readonly DiscoveredResource[], options?: ResourceLoadOptions): Promise<ResourceBatchResult> {
    const start = Date.now();

    const sorted = [...resources].sort((a, b) => {
      const priA = this.priorityWeight(this.getPriority(a.kind, a.blocking, a.deferred));
      const priB = this.priorityWeight(this.getPriority(b.kind, b.blocking, b.deferred));
      return priA - priB;
    });

    const results = await Promise.all(
      sorted.map(r => this.loadResource(r.url, r.kind, options)),
    );

    const succeeded = results.filter(r => r.error === null).length;
    const failed = results.length - succeeded;

    return {
      results,
      succeeded,
      failed,
      totalDurationMs: Date.now() - start,
    };
  }

  async loadStylesheet(url: string): Promise<string> {
    const result = await this.loadResource(url, 'stylesheet', { priority: 'blocking' });
    if (result.error) throw new NetworkError(url, result.error);
    return result.body;
  }

  async loadScript(url: string): Promise<string> {
    const result = await this.loadResource(url, 'script', { priority: 'high' });
    if (result.error) throw new NetworkError(url, result.error);
    return result.body;
  }

  async loadImage(url: string): Promise<ResourceLoadResult> {
    return this.loadResource(url, 'image', { priority: 'normal' });
  }

  getPriority(kind: DiscoveredResourceKind, blocking: boolean, deferred: boolean): ResourcePriority {
    if (blocking) return 'blocking';
    if (deferred) return 'deferred';
    switch (kind) {
      case 'stylesheet': return 'blocking';
      case 'script': return 'high';
      case 'image': return 'normal';
      case 'font': return 'high';
      case 'media': return 'low';
      default: return 'normal';
    }
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
  }

  on(_type: RequestEventType, _handler: (event: RequestEvent) => void): void {
  }

  off(_type: RequestEventType, _handler: (event: RequestEvent) => void): void {
  }

  private async acquireSlot(priorityWeight: number = 2): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return;
    }
    return new Promise<void>(resolve => {
      this.pendingQueue.enqueue({ resolve }, priorityWeight);
    });
  }

  private releaseSlot(): void {
    this.activeCount--;
    const next = this.pendingQueue.dequeue();
    if (next) {
      this.activeCount++;
      next.resolve();
    }
  }

  private priorityWeight(p: ResourcePriority): number {
    switch (p) {
      case 'blocking': return 0;
      case 'high': return 1;
      case 'normal': return 2;
      case 'low': return 3;
      case 'deferred': return 4;
    }
  }

  dispose(): void {
    this.pendingQueue.clear();
    this.activeCount = 0;
  }
}

export { ResourceLoader };
export type { IResourceLoader, ResourceLoadResult, ResourceBatchResult, ResourceLoadOptions, ResourcePriority, ResourceLoadTiming };
