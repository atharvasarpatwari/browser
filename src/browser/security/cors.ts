/**
 * @file src/browser/security/cors.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Cross-Origin Resource Sharing (CORS) policy enforcement for NovaBrowser.
 *
 * Every outbound sub-resource request flows through this module BEFORE the
 * network fetch to determine whether the browser is allowed to make it, and
 * AFTER the response arrives to determine whether JavaScript may read the body.
 *
 * Pipeline position
 * ─────────────────
 *   ResourceLoader.load(request)
 *        │
 *        ▼
 *   CorsEngine.checkRequest(request, origin)   ← pre-flight decision
 *        │
 *        ├─ SAME_ORIGIN   → allow, no extra headers
 *        ├─ SIMPLE        → allow, no pre-flight
 *        ├─ PREFLIGHT     → send OPTIONS request first
 *        └─ BLOCKED       → throw CorsBlockedError
 *
 *   RequestManager.send() → HttpResponseSpec
 *        │
 *        ▼
 *   CorsEngine.checkResponse(request, response) ← post-response decision
 *        │
 *        ├─ ALLOWED       → caller may read body + headers
 *        └─ OPAQUE        → body/headers withheld (no-cors mode)
 *
 * Supported CORS modes (matching the Fetch spec):
 *   cors        Full CORS with Access-Control-* header enforcement
 *   no-cors     Opaque response — body available only to browser internals
 *   same-origin Reject cross-origin requests outright
 *   navigate    Used for top-level navigations (no CORS restriction)
 *
 * Pre-flight cache
 * ────────────────
 * A successful OPTIONS pre-flight is cached per (origin, path) pair for the
 * duration specified in Access-Control-Max-Age (default 5 s, cap 24 h) so
 * repeated requests to the same endpoint don't each pay a round-trip.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ICorsEngine is the only type callers depend on.
 *  Encapsulation    The pre-flight cache, policy tables, and wildcard-matching
 *                   logic are all private — callers never touch internals.
 *  Single-Resp.     CorsEngine evaluates CORS policy only. It never fetches,
 *                   renders, or modifies DOM.
 *  Open / Closed    New simple-method / simple-header sets extend the static
 *                   constants — CorsEngine itself never changes.
 *  Dependency-Inv.  Constructor receives IRequestManager for pre-flight sends;
 *                   never a concrete class.
 */

import type { IRequestManager, HttpResponseSpec } from '../networking/request-manager';

// ─────────────────────────────────────────────────────────────────────────────
// CORS MODE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch request mode — mirrors the Fetch Standard §3.1.
 * Determines how cross-origin responses are handled.
 */
enum CorsMode {
  /** Full CORS handshake. Cross-origin response headers are enforced. */
  Cors       = 'cors',
  /** No CORS headers required. Response body is opaque to script. */
  NoCors     = 'no-cors',
  /** Only same-origin URLs are allowed. Cross-origin throws immediately. */
  SameOrigin = 'same-origin',
  /** Top-level navigation — CORS does not apply. */
  Navigate   = 'navigate',
}

// ─────────────────────────────────────────────────────────────────────────────
// REQUEST DECISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What CorsEngine decided to do with a request BEFORE sending it.
 * The RequestManager acts on this decision.
 */
enum CorsRequestDecision {
  /** Same origin — send without any CORS machinery. */
  SameOrigin  = 'same-origin',
  /** Cross-origin simple request — send immediately, enforce response. */
  Simple      = 'simple',
  /** Cross-origin non-simple — send OPTIONS pre-flight first. */
  Preflight   = 'preflight',
  /** Cross-origin blocked outright (e.g. mode = same-origin). */
  Blocked     = 'blocked',
  /** no-cors mode — send without CORS headers; response will be opaque. */
  Opaque      = 'opaque',
  /** navigate mode — no CORS enforcement at all. */
  Navigate    = 'navigate',
}

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE DECISION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What CorsEngine decided AFTER the response arrived.
 */
enum CorsResponseDecision {
  /** Script and browser internals may read headers + body. */
  Allowed = 'allowed',
  /** Body received but hidden from script (no-cors opaque response). */
  Opaque  = 'opaque',
  /** Server rejected CORS — browser must not expose the body. */
  Denied  = 'denied',
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIALS MODE
// ─────────────────────────────────────────────────────────────────────────────

enum CorsCredentials {
  /** Never send cookies / auth headers cross-origin. */
  Omit        = 'omit',
  /** Send cookies only on same-origin. */
  SameOrigin  = 'same-origin',
  /** Send cookies cross-origin (requires server to echo exact origin). */
  Include     = 'include',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Everything the CORS engine needs to evaluate one fetch request.
 */
interface CorsRequest {
  /** The URL being fetched. */
  readonly url:         string;
  /** The origin of the document that initiated the fetch. */
  readonly origin:      string;
  /** HTTP method of the pending request. */
  readonly method:      string;
  /** Request headers the caller intends to send. */
  readonly headers:     ReadonlyMap<string, string>;
  /** CORS mode chosen by the initiating code (default: 'cors'). */
  readonly mode:        CorsMode;
  /** Whether to include credentials (cookies, auth). */
  readonly credentials: CorsCredentials;
}

/**
 * Result of evaluating a request BEFORE the fetch.
 */
interface CorsPreCheck {
  readonly decision:          CorsRequestDecision;
  /** Headers that must be added to the outgoing request. */
  readonly requestHeaders:    ReadonlyMap<string, string>;
  /** True when a pre-flight OPTIONS request must be sent first. */
  readonly requiresPreflight: boolean;
  /** Human-readable reason (for DevTools). */
  readonly reason:            string;
}

/**
 * Result of evaluating the response AFTER the fetch.
 */
interface CorsPostCheck {
  readonly decision:           CorsResponseDecision;
  /** Which response headers script is allowed to read. */
  readonly exposedHeaders:     ReadonlySet<string>;
  /** Human-readable reason (for DevTools). */
  readonly reason:             string;
}

/**
 * One cached pre-flight result.
 */
interface PreflightCacheEntry {
  readonly origin:           string;
  readonly urlPath:          string;
  readonly allowedMethods:   ReadonlySet<string>;
  readonly allowedHeaders:   ReadonlySet<string>;
  readonly allowCredentials: boolean;
  /** Wall-clock timestamp when this entry expires (ms). */
  readonly expiresAt:        number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — per the Fetch Standard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Methods that are allowed in a "simple" CORS request (no pre-flight).
 */
const SIMPLE_METHODS = new Set(['GET', 'POST', 'HEAD']);

/**
 * Request headers that do NOT trigger a CORS pre-flight.
 * (Fetch Standard §2.2.2 "CORS-safelisted request header".)
 */
const SIMPLE_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-language',
  'content-type',       // only for certain MIME types — checked separately
  'range',
]);

/**
 * Content-Type values that qualify as "simple" (no pre-flight).
 */
const SIMPLE_CONTENT_TYPES = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
]);

/**
 * Response headers that are ALWAYS exposed to script without the server
 * having to list them in Access-Control-Expose-Headers.
 * (Fetch Standard §3.2.9 "CORS-safelisted response header name".)
 */
const ALWAYS_EXPOSED_HEADERS = new Set([
  'cache-control',
  'content-language',
  'content-length',
  'content-type',
  'expires',
  'last-modified',
  'pragma',
]);

const DEFAULT_PREFLIGHT_MAX_AGE_S = 5;
const MAX_PREFLIGHT_CACHE_S       = 86_400; // 24 hours

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ICorsEngine {
  /**
   * Evaluate a request BEFORE the network fetch.
   * @returns A CorsPreCheck describing what to do next.
   * @throws  {CorsBlockedError} if the request is blocked outright.
   */
  checkRequest(request: CorsRequest): CorsPreCheck;

  /**
   * Evaluate the server response AFTER the fetch completes.
   * @throws  {CorsViolationError} if the server's CORS headers are invalid.
   */
  checkResponse(request: CorsRequest, response: HttpResponseSpec): CorsPostCheck;

  /**
   * Send an OPTIONS pre-flight and cache the result.
   * Called by ResourceLoader when checkRequest returns Preflight.
   * @throws  {CorsPreflightError} if the server rejects the pre-flight.
   */
  performPreflight(
    request:        CorsRequest,
    requestManager: IRequestManager,
    signal?:        AbortSignal,
  ): Promise<PreflightCacheEntry>;

  /** Check whether a cached pre-flight already covers this request. */
  hasCachedPreflight(request: CorsRequest): boolean;

  /** Manually invalidate pre-flight cache entries for an origin. */
  evictPreflight(origin: string): void;

  /** Clear the entire pre-flight cache. */
  clearPreflightCache(): void;

  /** Snapshot of current cache size (for DevTools). */
  preflightCacheSize(): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class CorsBlockedError extends Error {
  readonly url:    string;
  readonly origin: string;
  constructor(url: string, origin: string, reason: string) {
    super(`CORS blocked: "${url}" from origin "${origin}". ${reason}`);
    this.name   = 'CorsBlockedError';
    this.url    = url;
    this.origin = origin;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class CorsViolationError extends Error {
  readonly url:    string;
  readonly header: string;
  constructor(url: string, header: string, reason: string) {
    super(`CORS violation on "${url}" (${header}): ${reason}`);
    this.name   = 'CorsViolationError';
    this.url    = url;
    this.header = header;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class CorsPreflightError extends Error {
  readonly url:    string;
  readonly status: number;
  constructor(url: string, status: number, reason: string) {
    super(`CORS pre-flight failed for "${url}" (HTTP ${status}): ${reason}`);
    this.name   = 'CorsPreflightError';
    this.url    = url;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CORS ENGINE
// ─────────────────────────────────────────────────────────────────────────────

class CorsEngine implements ICorsEngine {

  /** Pre-flight cache: key = `${origin}::${urlPath}` */
  private readonly preflightCache = new Map<string, PreflightCacheEntry>();

  // ── ICorsEngine: checkRequest ─────────────────────────────────────────────

  checkRequest(request: CorsRequest): CorsPreCheck {
    const { url, origin, mode } = request;

    // 1. navigate — no CORS enforcement
    if (mode === CorsMode.Navigate) {
      return this.allow(CorsRequestDecision.Navigate, 'Top-level navigation — CORS does not apply.');
    }

    // 2. Determine whether this is same-origin
    const requestOrigin = CorsEngine.parseOrigin(url);
    if (requestOrigin === origin) {
      return this.allow(CorsRequestDecision.SameOrigin, 'Same-origin request.');
    }

    // 3. same-origin mode — block cross-origin
    if (mode === CorsMode.SameOrigin) {
      throw new CorsBlockedError(url, origin,
        `Request mode is "same-origin" but the URL is cross-origin (${requestOrigin}).`);
    }

    // 4. no-cors — send opaquely
    if (mode === CorsMode.NoCors) {
      const extraHeaders = new Map<string, string>();
      // Do NOT add Origin header in no-cors mode
      return {
        decision:          CorsRequestDecision.Opaque,
        requestHeaders:    extraHeaders,
        requiresPreflight: false,
        reason:            'no-cors mode — response will be opaque.',
      };
    }

    // 5. cors mode — determine simple vs preflight
    const originHeader = new Map<string, string>([['origin', origin]]);

    if (this.isSimpleRequest(request) && !this.needsPreflightDueToCache(request)) {
      return {
        decision:          CorsRequestDecision.Simple,
        requestHeaders:    originHeader,
        requiresPreflight: false,
        reason:            'Simple CORS request — no pre-flight required.',
      };
    }

    // Check pre-flight cache first
    if (this.hasCachedPreflight(request)) {
      return {
        decision:          CorsRequestDecision.Simple,
        requestHeaders:    originHeader,
        requiresPreflight: false,
        reason:            'Pre-flight cached — sending directly.',
      };
    }

    // Need to pre-flight
    return {
      decision:          CorsRequestDecision.Preflight,
      requestHeaders:    originHeader,
      requiresPreflight: true,
      reason:            'Non-simple CORS request — pre-flight OPTIONS required.',
    };
  }

  // ── ICorsEngine: checkResponse ────────────────────────────────────────────

  checkResponse(request: CorsRequest, response: HttpResponseSpec): CorsPostCheck {
    const { mode, credentials } = request;

    // navigate and no-cors responses don't go through CORS header checks
    if (mode === CorsMode.Navigate) {
      return {
        decision:       CorsResponseDecision.Allowed,
        exposedHeaders: new Set(response.headers.keys()),
        reason:         'Navigation — all headers exposed.',
      };
    }

    if (mode === CorsMode.NoCors) {
      return {
        decision:       CorsResponseDecision.Opaque,
        exposedHeaders: new Set<string>(),
        reason:         'no-cors — response is opaque, headers hidden from script.',
      };
    }

    // cors + same-origin: validate Access-Control-Allow-Origin
    const acao = response.headers.get('access-control-allow-origin') ?? '';

    if (!acao) {
      throw new CorsViolationError(
        request.url,
        'access-control-allow-origin',
        'Header is missing from the response.',
      );
    }

    const requestOrigin = request.origin;
    const wildcardOk    = acao.trim() === '*';
    const originMatch   = acao.trim() === requestOrigin;

    if (!wildcardOk && !originMatch) {
      throw new CorsViolationError(
        request.url,
        'access-control-allow-origin',
        `Server returned "${acao}" but request origin is "${requestOrigin}".`,
      );
    }

    // Credentials + wildcard is forbidden (§3.2.4 of the Fetch Standard)
    if (wildcardOk && credentials === CorsCredentials.Include) {
      throw new CorsViolationError(
        request.url,
        'access-control-allow-origin',
        'Server returned "*" but credentials are included — this is forbidden.',
      );
    }

    // Validate credentials header when credentials: 'include'
    if (credentials === CorsCredentials.Include) {
      const acac = response.headers.get('access-control-allow-credentials') ?? '';
      if (acac.trim().toLowerCase() !== 'true') {
        throw new CorsViolationError(
          request.url,
          'access-control-allow-credentials',
          `Credentials mode is "include" but server did not return "true" (got "${acac}").`,
        );
      }
    }

    // Build the set of headers script may read
    const exposed = new Set<string>(ALWAYS_EXPOSED_HEADERS);
    const exposeHeader = response.headers.get('access-control-expose-headers') ?? '';
    if (exposeHeader.trim() === '*' && credentials !== CorsCredentials.Include) {
      // Wildcard exposes all headers (but only without credentials)
      for (const key of response.headers.keys()) exposed.add(key.toLowerCase());
    } else {
      for (const h of exposeHeader.split(',')) {
        const trimmed = h.trim().toLowerCase();
        if (trimmed) exposed.add(trimmed);
      }
    }

    return {
      decision:       CorsResponseDecision.Allowed,
      exposedHeaders: exposed,
      reason:         `CORS allowed. Origin "${requestOrigin}" accepted.`,
    };
  }

  // ── ICorsEngine: performPreflight ─────────────────────────────────────────

  async performPreflight(
    request:        CorsRequest,
    requestManager: IRequestManager,
    signal?:        AbortSignal,
  ): Promise<PreflightCacheEntry> {
    const { url, origin, method, headers, credentials } = request;

    // Build preflight headers
    const preflightHeaders = new Map<string, string>([
      ['origin',                          origin],
      ['access-control-request-method',   method.toUpperCase()],
    ]);

    // Collect non-simple request headers
    const nonSimpleHeaders = [...headers.keys()]
      .filter(h => !SIMPLE_REQUEST_HEADERS.has(h.toLowerCase()))
      .join(', ');
    if (nonSimpleHeaders) {
      preflightHeaders.set('access-control-request-headers', nonSimpleHeaders);
    }

    const preflightResponse = await requestManager.send({
      url,
      method:  'OPTIONS' as never,
      headers: preflightHeaders,
    }, signal);

    // Validate the OPTIONS response status
    if (preflightResponse.statusCode < 200 || preflightResponse.statusCode >= 300) {
      throw new CorsPreflightError(
        url,
        preflightResponse.statusCode,
        `Server rejected the pre-flight with HTTP ${preflightResponse.statusCode}.`,
      );
    }

    const acao = preflightResponse.headers.get('access-control-allow-origin') ?? '';
    if (acao !== '*' && acao !== origin) {
      throw new CorsPreflightError(
        url,
        preflightResponse.statusCode,
        `access-control-allow-origin is "${acao}" but request origin is "${origin}".`,
      );
    }

    // Parse allowed methods
    const acam = preflightResponse.headers.get('access-control-allow-methods') ?? '';
    const allowedMethods = new Set(
      acam.split(',').map(m => m.trim().toUpperCase()).filter(Boolean),
    );

    // Parse allowed headers
    const acah = preflightResponse.headers.get('access-control-allow-headers') ?? '';
    const allowedHeaders = new Set(
      acah.split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    );

    // Parse credentials
    const acac = preflightResponse.headers.get('access-control-allow-credentials') ?? '';
    const allowCredentials = acac.trim().toLowerCase() === 'true';

    if (credentials === CorsCredentials.Include && !allowCredentials) {
      throw new CorsPreflightError(
        url,
        preflightResponse.statusCode,
        'Credentials included but server did not return access-control-allow-credentials: true.',
      );
    }

    // Parse max-age
    const maxAgeRaw = preflightResponse.headers.get('access-control-max-age') ?? '';
    let maxAgeS = DEFAULT_PREFLIGHT_MAX_AGE_S;
    if (maxAgeRaw) {
      const parsed = parseInt(maxAgeRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        maxAgeS = Math.min(parsed, MAX_PREFLIGHT_CACHE_S);
      }
    }

    const entry: PreflightCacheEntry = {
      origin,
      urlPath:         new URL(url).pathname,
      allowedMethods,
      allowedHeaders,
      allowCredentials,
      expiresAt:       Date.now() + maxAgeS * 1_000,
    };

    this.preflightCache.set(this.cacheKey(origin, new URL(url).pathname), entry);
    return entry;
  }

  // ── ICorsEngine: cache management ─────────────────────────────────────────

  hasCachedPreflight(request: CorsRequest): boolean {
    const key   = this.cacheKey(request.origin, new URL(request.url).pathname);
    const entry = this.preflightCache.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAt) {
      this.preflightCache.delete(key);
      return false;
    }
    // Verify the cached entry actually covers this method + headers
    const methodOk  = entry.allowedMethods.has(request.method.toUpperCase()) ||
                      entry.allowedMethods.has('*');
    const headersOk = [...request.headers.keys()]
      .filter(h => !SIMPLE_REQUEST_HEADERS.has(h.toLowerCase()))
      .every(h => entry.allowedHeaders.has(h.toLowerCase()) || entry.allowedHeaders.has('*'));
    return methodOk && headersOk;
  }

  evictPreflight(origin: string): void {
    for (const key of this.preflightCache.keys()) {
      if (key.startsWith(origin + '::')) this.preflightCache.delete(key);
    }
  }

  clearPreflightCache(): void { this.preflightCache.clear(); }

  preflightCacheSize(): number { return this.preflightCache.size; }

  // ── Private: simple request detection ────────────────────────────────────

  /**
   * A "simple" request needs no pre-flight. Conditions:
   *   1. Method is GET, POST, or HEAD.
   *   2. All request headers are CORS-safelisted.
   *   3. Content-Type (if present) is one of the three safe types.
   */
  private isSimpleRequest(request: CorsRequest): boolean {
    if (!SIMPLE_METHODS.has(request.method.toUpperCase())) return false;

    for (const [name, value] of request.headers) {
      const lower = name.toLowerCase();
      if (!SIMPLE_REQUEST_HEADERS.has(lower)) return false;

      if (lower === 'content-type') {
        const mimeBase = value.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!SIMPLE_CONTENT_TYPES.has(mimeBase)) return false;
      }
    }
    return true;
  }

  /**
   * Even if the request itself is "simple", a cached pre-flight might
   * indicate we're in a session where the server requires explicit CORS.
   * Currently always false — placeholder for future heuristics.
   */
  private needsPreflightDueToCache(_request: CorsRequest): boolean {
    return false;
  }

  // ── Private: helpers ──────────────────────────────────────────────────────

  private allow(decision: CorsRequestDecision, reason: string): CorsPreCheck {
    return { decision, requestHeaders: new Map(), requiresPreflight: false, reason };
  }

  private cacheKey(origin: string, urlPath: string): string {
    return `${origin}::${urlPath}`;
  }

  /**
   * Extract scheme + host + port from a URL string, lower-cased.
   * Returns '' on parse failure.
   */
  private static parseOrigin(url: string): string {
    try {
      const u = new URL(url);
      return u.origin.toLowerCase();
    } catch {
      return '';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CorsEngine,
  CorsMode,
  CorsCredentials,
  CorsRequestDecision,
  CorsResponseDecision,
  CorsBlockedError,
  CorsViolationError,
  CorsPreflightError,
  SIMPLE_METHODS,
  SIMPLE_REQUEST_HEADERS,
  ALWAYS_EXPOSED_HEADERS,
};

export type {
  ICorsEngine,
  CorsRequest,
  CorsPreCheck,
  CorsPostCheck,
  PreflightCacheEntry,
};
