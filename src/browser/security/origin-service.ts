/**
 * @file src/browser/security/origin-service.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified origin comparison service for the Same-Origin Policy.
 *
 * Single source of truth for:
 *   • Origin parsing (WHATWG URL Standard)
 *   • Opaque origin handling (data:, about:blank, sandboxed iframes)
 *   • isSameOrigin() — scheme + host + port comparison
 *   • isSameSite() — eTLD+1 comparison for SameSite cookies
 *   • getEffectiveOrigin() — inheritance for about:blank, blob:, srcdoc
 *
 * Used by CrossOriginGuard, CorsEngine, fetch/XHR, navigation, storage.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Single-Resp.     Only handles origin parsing and comparison.
 *  Pure functions    All methods are side-effect-free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** The opaque origin string per WHATWG spec. */
const OPAQUE_ORIGIN = 'null';

/** Schemes that produce opaque origins. */
const OPAQUE_SCHEMES = new Set(['data', 'blob']);

/** Schemes that are network-accessible. */
const NETWORK_SCHEMES = new Set(['http', 'https', 'ws', 'wss', 'ftp', 'ftps']);

/** Default ports per scheme (for normalization). */
const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a URL string into a normalized origin string.
 *
 * - Network URLs → scheme + "://" + host (lowercased, default port stripped)
 * - data:/blob: → opaque "null"
 * - about:blank → inherits referrer or returns "null"
 * - Parse failure → returns the input string as-is (fallback)
 */
function parseOrigin(url: string, referrerOrigin?: string): string {
  try {
    const u = new URL(url);
    const scheme = u.protocol.toLowerCase();

    // Opaque schemes → "null"
    if (scheme === 'data:' || scheme === 'blob:') {
      return OPAQUE_ORIGIN;
    }

    // about:blank / about:srcdoc → inherit referrer or opaque
    if (scheme === 'about:') {
      if (u.pathname === 'blank' || u.pathname === 'srcdoc') {
        return referrerOrigin ?? OPAQUE_ORIGIN;
      }
      return OPAQUE_ORIGIN;
    }

    // Network schemes → normalize
    if (NETWORK_SCHEMES.has(scheme.slice(0, -1))) {
      const host = u.hostname.toLowerCase();
      const port = u.port;
      const defaultPort = DEFAULT_PORTS[scheme];
      if (port && defaultPort && port !== defaultPort) {
        return `${scheme}//${host}:${port}`;
      }
      return `${scheme}//${host}`;
    }

    // Other schemes (file:, nova:, etc.) → scheme + host
    return `${scheme}//${u.hostname.toLowerCase()}`;
  } catch {
    // Parse failure — return as-is
    return url;
  }
}

/**
 * Check if two origins are the same origin (scheme + host + port).
 */
function isSameOrigin(a: string, b: string): boolean {
  // Opaque origins are never same-origin with anything
  if (a === OPAQUE_ORIGIN || b === OPAQUE_ORIGIN) return a === b;

  const parsedA = parseOrigin(a);
  const parsedB = parseOrigin(b);

  return parsedA === parsedB;
}

/**
 * Check if two origins are the same site (eTLD+1).
 * Simplified: same hostname after removing "www." prefix.
 * For a real eTLD+1 check we'd need a public suffix list.
 */
function isSameSite(a: string, b: string): boolean {
  const hostA = extractHost(a);
  const hostB = extractHost(b);
  if (!hostA || !hostB) return false;

  // Strip www. prefix for comparison
  const stripWww = (h: string) => h.startsWith('www.') ? h.slice(4) : h;
  return stripWww(hostA.toLowerCase()) === stripWww(hostB.toLowerCase());
}

/**
 * Check if an origin is opaque.
 */
function isOpaqueOrigin(origin: string): boolean {
  return origin === OPAQUE_ORIGIN;
}

/**
 * Get the effective origin for a context.
 * Handles about:blank inheritance, blob: URL origin, sandboxed iframes.
 */
function getEffectiveOrigin(
  url: string,
  referrerOrigin?: string,
  sandboxFlags?: Set<string>,
): string {
  // Sandboxed without allow-same-origin → opaque
  if (sandboxFlags && !sandboxFlags.has('allow-same-origin')) {
    return OPAQUE_ORIGIN;
  }

  const origin = parseOrigin(url, referrerOrigin);

  // blob: URLs inherit the origin of the creating context
  if (origin === OPAQUE_ORIGIN && url.toLowerCase().startsWith('blob:')) {
    return referrerOrigin ?? OPAQUE_ORIGIN;
  }

  return origin;
}

/**
 * Get the opaque origin constant.
 */
function getOpaqueOrigin(): string {
  return OPAQUE_ORIGIN;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function extractHost(origin: string): string | null {
  try {
    // Try as URL first
    const u = new URL(origin);
    return u.hostname;
  } catch {
    // Try to extract from "scheme://host" format
    const match = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/([^/:]+)/.exec(origin);
    return match?.[1] ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseOrigin,
  isSameOrigin,
  isSameSite,
  isOpaqueOrigin,
  getEffectiveOrigin,
  getOpaqueOrigin,
  OPAQUE_ORIGIN,
  OPAQUE_SCHEMES,
  NETWORK_SCHEMES,
};
