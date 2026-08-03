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
}

class ResourceLoader implements IResourceLoader {
  private readonly client: IHttpClient;
  private readonly responseParser: IResponseParser;
  private readonly retryPolicy: RetryPolicy;
  private readonly blocker: ITrackerBlocker | null;
  private cache: ICacheManager | null = null;
  private cors: ICorsEngine | null = null;
  private pageOrigin = '';
  private maxConcurrent = 6;
  private activeCount = 0;
  private readonly pendingQueue = new PriorityQueue<{ resolve: () => void }>();
  private readonly bandwidth = new BandwidthEstimator();

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

  async loadResource(url: string, _kind: DiscoveredResourceKind, options?: ResourceLoadOptions): Promise<ResourceLoadResult> {
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

    try {
      const headers = new Map<string, string>([['accept', '*/*']]);
      const signal = options?.signal ?? new AbortController().signal;

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
        timeoutMs: options?.timeoutMs ?? 15_000,
      };

      // Follow 3xx redirects here — ResourceLoader talks to IHttpClient directly
      // (bypassing RequestManager), so redirect policy lives in this loop.
      const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
      const maxRedirects = 10;
      let currentUrl = url;
      let res: HttpResponseSpec;

      try {
        for (let hops = 0; ; hops++) {
          res = await this.client.send({ ...specBase, url: currentUrl }, signal);

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
      const errorMessage = err instanceof Error ? err.message : String(err);
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
export type { IResourceLoader, ResourceLoadResult, ResourceBatchResult, ResourceLoadOptions, ResourcePriority };
