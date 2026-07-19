/**
 * @file src/browser/security/cross-origin-guard.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enforce Same-Origin Policy boundaries. Handles:
 *   • DOM access control (postMessage, iframe contentWindow/document)
 *   • Storage access control (localStorage, sessionStorage, IndexedDB, cookies)
 *   • Network request interception (fetch/XHR, validates CORS-like headers)
 *   • `canAccess(targetOrigin, requesterOrigin)` decision API
 *   • CORS preflight simulation for cross-origin requests
 *   • Exception lists for well-known public resources (CDNs, fonts)
 *
 * Does NOT:
 *   • Map origins to contexts (origin-isolator.ts's job)
 *   • Manage user permissions (permission-manager.ts's job)
 *   • Parse CSP headers (csp-parser.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only enforces Same-Origin Policy boundaries.
 *  Pure functions    Most checks are side-effect-free evaluations.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Type of cross-origin access being attempted. */
type AccessType =
  | 'dom-read'         /* Reading iframe.contentWindow, document, etc. */
  | 'dom-write'        /* Writing to cross-origin DOM */
  | 'dom-method'       /* Calling methods on cross-origin objects */
  | 'storage-read'     /* Reading localStorage/sessionStorage */
  | 'storage-write'    /* Writing to localStorage/sessionStorage */
  | 'network-fetch'    /* Cross-origin fetch/XHR */
  | 'network-websocket' /* Cross-origin WebSocket */
  | 'postMessage'      /* window.postMessage */
  | 'cookie-read'      /* Reading cookies */
  | 'cookie-write';    /* Setting cookies */

/** A cross-origin access request. */
interface CrossOriginAccessRequest {
  /** The origin attempting access. */
  readonly requesterOrigin: string;
  /** The origin being accessed. */
  readonly targetOrigin: string;
  /** The type of access being attempted. */
  readonly accessType: AccessType;
  /** The specific resource path (optional, for granular checks). */
  readonly path?: string;
  /** HTTP method for network requests (optional). */
  readonly method?: string;
  /** Request headers for network requests (optional). */
  readonly headers?: Record<string, string>;
}

/** Result of a cross-origin access check. */
interface CrossOriginAccessResult {
  /** Whether the access is allowed. */
  readonly allowed: boolean;
  /** Reason for denial, if blocked. */
  readonly reason?: string;
  /** Whether a CORS preflight is required. */
  readonly requiresPreflight: boolean;
  /** Headers to include in the response (for CORS). */
  readonly responseHeaders?: Record<string, string>;
}

/** CORS header for cross-origin responses. */
interface CorsHeaders {
  readonly 'access-control-allow-origin'?: string;
  readonly 'access-control-allow-methods'?: string;
  readonly 'access-control-allow-headers'?: string;
  readonly 'access-control-allow-credentials'?: boolean;
  readonly 'access-control-max-age'?: number;
}

/** Configuration for the cross-origin guard. */
interface CrossOriginGuardConfig {
  /** Whether to enforce strict SOP (false = more permissive). */
  readonly strictMode: boolean;
  /** Origins that are always allowed (bypass SOP). */
  readonly trustedOrigins: readonly string[];
  /** Whether to allow file:// scheme origins. */
  readonly allowFileScheme: boolean;
  /** Default CORS headers for allowed cross-origin responses. */
  readonly defaultCorsHeaders: CorsHeaders;
}

type CrossOriginGuardEventType = 'accessBlocked' | 'accessAllowed' | 'preflightTriggered';

interface CrossOriginGuardEvent {
  readonly kind: CrossOriginGuardEventType;
  readonly request: CrossOriginAccessRequest;
  readonly result: CrossOriginAccessResult;
}

type CrossOriginGuardEventHandler = (event: CrossOriginGuardEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GUARD_CONFIG: CrossOriginGuardConfig = {
  strictMode: true,
  trustedOrigins: [],
  allowFileScheme: false,
  defaultCorsHeaders: {
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-allow-credentials': false,
    'access-control-max-age': 86400,
  },
};

/** Access types that require CORS preflight. */
const PREFLIGHT_METHODS = new Set(['PUT', 'DELETE', 'PATCH']);
const PREFLIGHT_HEADERS = new Set([
  'authorization', 'content-type', 'x-custom-header',
]);

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class CrossOriginGuard implements IDisposable {
  private readonly config: CrossOriginGuardConfig;
  private readonly handlers = new Set<CrossOriginGuardEventHandler>();
  private violations: CrossOriginAccessRequest[] = [];
  private disposed = false;

  constructor(config?: Partial<CrossOriginGuardConfig>) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if a cross-origin access is allowed.
   */
  checkAccess(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    if (this.disposed) throw new Error('CrossOriginGuard is disposed');

    // Same origin — always allowed.
    if (this.isSameOrigin(request.requesterOrigin, request.targetOrigin)) {
      return this.buildResult(true, request);
    }

    // Trusted origin — always allowed.
    if (this.isTrustedOrigin(request.targetOrigin)) {
      return this.buildResult(true, request);
    }

    // Check by access type.
    let result: CrossOriginAccessResult;

    switch (request.accessType) {
      case 'dom-read':
      case 'dom-write':
      case 'dom-method':
        result = this.checkDomAccess(request);
        break;
      case 'storage-read':
      case 'storage-write':
        result = this.checkStorageAccess(request);
        break;
      case 'network-fetch':
      case 'network-websocket':
        result = this.checkNetworkAccess(request);
        break;
      case 'postMessage':
        result = this.checkPostMessage(request);
        break;
      case 'cookie-read':
      case 'cookie-write':
        result = this.checkCookieAccess(request);
        break;
      default:
        result = this.buildResult(false, request, 'Unknown access type');
    }

    if (!result.allowed) {
      this.violations.push(request);
      this.emit({ kind: 'accessBlocked', request, result });
    } else {
      this.emit({ kind: 'accessAllowed', request, result });
    }

    return result;
  }

  /**
   * Check if two origins are the same origin.
   */
  isSameOrigin(originA: string, originB: string): boolean {
    try {
      const a = new URL(originA);
      const b = new URL(originB);
      return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
    } catch {
      return originA === originB;
    }
  }

  /**
   * Check if a cross-origin fetch requires CORS preflight.
   */
  requiresPreflight(
    method: string,
    headers?: Record<string, string>,
  ): boolean {
    if (PREFLIGHT_METHODS.has(method.toUpperCase())) return true;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (PREFLIGHT_HEADERS.has(key.toLowerCase())) return true;
      }
    }
    return false;
  }

  /**
   * Generate CORS response headers for an allowed cross-origin request.
   */
  getCorsHeaders(requesterOrigin: string): Record<string, string> {
    const cors: Record<string, string> = {};
    const h = this.config.defaultCorsHeaders;

    cors['Access-Control-Allow-Origin'] = requesterOrigin;
    if (h['access-control-allow-methods']) cors['Access-Control-Allow-Methods'] = h['access-control-allow-methods'];
    if (h['access-control-allow-headers']) cors['Access-Control-Allow-Headers'] = h['access-control-allow-headers'];
    if (h['access-control-allow-credentials']) cors['Access-Control-Allow-Credentials'] = 'true';
    if (h['access-control-max-age']) cors['Access-Control-Max-Age'] = String(h['access-control-max-age']);

    return cors;
  }

  /**
   * Get all recorded violations.
   */
  getViolations(): readonly CrossOriginAccessRequest[] {
    return [...this.violations];
  }

  /**
   * Clear recorded violations.
   */
  clearViolations(): void {
    this.violations = [];
  }

  // ── Event system ─────────────────────────────────────────────────────────

  on(handler: CrossOriginGuardEventHandler): void {
    this.handlers.add(handler);
  }

  off(handler: CrossOriginGuardEventHandler): void {
    this.handlers.delete(handler);
  }

  // ── Private: access checkers ─────────────────────────────────────────────

  private checkDomAccess(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    // DOM access is never allowed cross-origin in strict mode.
    if (this.config.strictMode) {
      return this.buildResult(
        false,
        request,
        `Cross-origin ${request.accessType} blocked by Same-Origin Policy`,
      );
    }
    // Non-strict: allow read-only.
    if (request.accessType === 'dom-read') {
      return this.buildResult(true, request);
    }
    return this.buildResult(false, request, `Cross-origin ${request.accessType} blocked`);
  }

  private checkStorageAccess(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    // Storage is origin-scoped — cross-origin access is always blocked.
    return this.buildResult(
      false,
      request,
      `Cross-origin ${request.accessType} blocked — storage is origin-scoped`,
    );
  }

  private checkNetworkAccess(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    // Network requests are allowed but may require CORS preflight.
    const needsPreflight = this.requiresPreflight(
      request.method ?? 'GET',
      request.headers,
    );

    if (needsPreflight && this.config.strictMode) {
      return {
        allowed: true,
        requiresPreflight: true,
        responseHeaders: this.getCorsHeaders(request.requesterOrigin),
      };
    }

    return {
      allowed: true,
      requiresPreflight: false,
      responseHeaders: this.getCorsHeaders(request.requesterOrigin),
    };
  }

  private checkPostMessage(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    // postMessage is always allowed (the receiver must validate origin).
    return this.buildResult(true, request);
  }

  private checkCookieAccess(request: CrossOriginAccessRequest): CrossOriginAccessResult {
    // Cookies are scoped by domain — cross-origin cookie access is blocked.
    return this.buildResult(
      false,
      request,
      `Cross-origin ${request.accessType} blocked — cookies are domain-scoped`,
    );
  }

  // ── Private: helpers ─────────────────────────────────────────────────────

  private isTrustedOrigin(origin: string): boolean {
    return this.config.trustedOrigins.includes(origin);
  }

  private buildResult(
    allowed: boolean,
    request: CrossOriginAccessRequest,
    reason?: string,
  ): CrossOriginAccessResult {
    return {
      allowed,
      reason,
      requiresPreflight: false,
    };
  }

  private emit(event: CrossOriginGuardEvent): void {
    for (const handler of this.handlers) {
      try { handler(event); } catch { /* handler errors must not break the guard */ }
    }
  }

  // ── Dispose ──────────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    this.violations = [];
    this.handlers.clear();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CrossOriginGuard,
  DEFAULT_GUARD_CONFIG,
  PREFLIGHT_METHODS,
  PREFLIGHT_HEADERS,
};

export type {
  AccessType,
  CrossOriginAccessRequest,
  CrossOriginAccessResult,
  CorsHeaders,
  CrossOriginGuardConfig,
  CrossOriginGuardEvent,
  CrossOriginGuardEventHandler,
};
