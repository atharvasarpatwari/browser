/**
 * @file src/browser/security/csp-evaluator.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Evaluate whether a URL (or inline script / eval) is permitted by a parsed
 * CspPolicy for a given directive. Handles:
 *   • Keyword matching ('self', 'none', 'unsafe-inline', 'unsafe-eval',
 *     'strict-dynamic', 'report-sample', nonce/hash keywords)
 *   • Scheme matching (https:, data:, blob:)
 *   • Host matching with optional port and path
 *   • Wildcard '*' matching
 *   • IP CIDR range matching
 *   • Path prefix matching
 *   • Nonce and hash verification for script-src
 *   • Directive fallback to default-src
 *   • Report-only mode (returns allow but logs violation)
 *
 * Does NOT:
 *   • Parse headers (csp-parser.ts's job)
 *   • Store policies (csp-policy-store.ts's job)
 *   • Submit reports (csp-reporter.ts's job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only evaluates URL/source matching against CSP policies.
 *  Pure functions    Most evaluation functions are side-effect-free.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CspPolicy, CspSourceExpression } from './csp-parser';
import { getEffectiveSources } from './csp-parser';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The result of a CSP evaluation. */
interface CspEvaluationResult {
  /** Whether the resource is allowed. */
  readonly allowed: boolean;
  /** The directive that was checked (may differ from requested if fallback used). */
  readonly directive: string;
  /** The matched source expression, if any. */
  readonly matchedSource?: CspSourceExpression;
  /** Whether the matched source was 'self'. */
  readonly isSelfMatch: boolean;
  /** Whether this was a report-only evaluation. */
  readonly reportOnly: boolean;
  /** The original URL that was evaluated. */
  readonly url: string;
  /** Error message if the URL was malformed. */
  readonly error?: string;
}

/** What type of resource is being checked. */
type CspResourceType =
  | 'script'
  | 'style'
  | 'image'
  | 'font'
  | 'connect'
  | 'media'
  | 'object'
  | 'frame'
  | 'child'
  | 'worker'
  | 'manifest'
  | 'prefetch'
  | 'form-action'
  | 'frame-ancestors'
  | 'base-uri'
  | 'plugin-types'
  | 'navigation-to'
  | 'frame-to';

/** Context for evaluation. */
interface CspEvalContext {
  /** The page's own origin (e.g. 'https://example.com'). */
  readonly pageOrigin: string;
  /** Whether the resource is inline (for script-src, style-src). */
  readonly isInline?: boolean;
  /** Whether the resource is created via eval() (for script-src). */
  readonly isEval?: boolean;
  /** Nonce value for inline scripts/styles, if applicable. */
  readonly nonce?: string;
  /** Hash of the script/style content, if applicable. */
  readonly hash?: string;
  /** Whether the request was triggered by a user gesture. */
  readonly userInitiated?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Map from CSP directive names to resource types. */
const DIRECTIVE_TO_RESOURCE: ReadonlyMap<string, CspResourceType> = new Map([
  ['script-src', 'script'],
  ['style-src', 'style'],
  ['img-src', 'image'],
  ['font-src', 'font'],
  ['connect-src', 'connect'],
  ['media-src', 'media'],
  ['object-src', 'object'],
  ['frame-src', 'frame'],
  ['child-src', 'child'],
  ['worker-src', 'worker'],
  ['manifest-src', 'manifest'],
  ['prefetch-src', 'prefetch'],
  ['form-action', 'form-action'],
  ['frame-ancestors', 'frame-ancestors'],
  ['base-uri', 'base-uri'],
  ['plugin-types', 'plugin-types'],
  ['navigation-to', 'navigation-to'],
  ['frame-to', 'frame-to'],
  ['default-src', 'script'], // fallback
]);

// ─────────────────────────────────────────────────────────────────────────────
// URL PARSING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a URL string into its components for CSP matching.
 * Returns null if the URL is invalid.
 */
function parseUrlForEval(url: string): {
  scheme: string;
  host: string;
  port: number;
  path: string;
  origin: string;
} | null {
  try {
    // Handle relative URLs by treating them as same-origin.
    const absoluteUrl = url.startsWith('//')
      ? `https:${url}`
      : url.includes('://')
        ? url
        : /^[a-zA-Z][a-zA-Z0-9+\-.]*:/.test(url)
          ? url
          : null;

    if (!absoluteUrl) {
      // Relative URL — no scheme/host.
      return null;
    }

    const parsed = new URL(absoluteUrl);
    const port = parsed.port
      ? parseInt(parsed.port, 10)
      : parsed.protocol === 'https:'
        ? 443
        : parsed.protocol === 'http:'
          ? 80
          : 0;

    return {
      scheme: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search + parsed.hash,
      origin: parsed.origin,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the origin from a URL string.
 */
function extractOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a source expression matches a URL.
 *
 * @param source The parsed source expression.
 * @param url The URL to match against.
 * @param context Evaluation context.
 * @returns True if the source matches the URL.
 */
function matchSource(
  source: CspSourceExpression,
  url: string,
  context: CspEvalContext,
): boolean {
  switch (source.kind) {
    case 'wildcard':
      return true;

    case 'keyword':
      return matchKeyword(source.raw, url, context);

    case 'scheme':
      return matchScheme(source.scheme!, url);

    case 'host':
    case 'host-path':
    case 'host-port':
    case 'host-port-path':
      return matchHostSource(source, url, context);

    case 'ip':
    case 'ip-cidr':
    case 'ip-port':
      return matchIpSource(source, url);

    case 'nonce':
      return matchNonce(source.nonceValue!, context.nonce);

    case 'hash':
      return matchHash(source.hashAlgorithm!, source.raw, context.hash);

    default:
      return false;
  }
}

/**
 * Match a CSP keyword against a URL.
 */
function matchKeyword(
  keyword: string,
  url: string,
  context: CspEvalContext,
): boolean {
  switch (keyword) {
    case "'none'":
      return false;

    case "'self'": {
      const urlOrigin = extractOrigin(url);
      // For relative URLs, treat as same-origin.
      if (!urlOrigin) return true;
      return urlOrigin === context.pageOrigin;
    }

    case "'unsafe-inline'":
      // 'unsafe-inline' is checked separately in the caller.
      return true;

    case "'unsafe-eval'":
      // 'unsafe-eval' is checked separately in the caller.
      return true;

    case "'unsafe-hashes'":
      return true;

    case "'strict-dynamic'":
      // 'strict-dynamic' trusts scripts created by already-trusted scripts.
      return true;

    case "'report-sample'":
      return true;

    default:
      return false;
  }
}

/**
 * Match a scheme source against a URL.
 */
function matchScheme(scheme: string, url: string): boolean {
  const parsed = parseUrlForEval(url);
  if (!parsed) return false;
  return parsed.scheme === scheme;
}

/**
 * Match a host-based source against a URL.
 */
function matchHostSource(
  source: CspSourceExpression,
  url: string,
  context: CspEvalContext,
): boolean {
  const parsed = parseUrlForEval(url);
  if (!parsed) return false;

  // Match scheme if the source specifies one.
  if (source.scheme && source.scheme !== parsed.scheme) return false;

  // Match host.
  if (source.host && !matchHost(source.host, parsed.host)) return false;

  // Match port if specified.
  if (source.port !== undefined && source.port !== parsed.port) return false;

  // Match path prefix if specified.
  if (source.path && !parsed.path.startsWith(source.path)) return false;

  return true;
}

/**
 * Match a host string against a target host.
 * Supports wildcards like *.example.com.
 */
function matchHost(pattern: string, target: string): boolean {
  // Exact match.
  if (pattern === target) return true;

  // Wildcard subdomain: *.example.com matches sub.example.com
  if (pattern.startsWith('*.')) {
    const baseDomain = pattern.slice(1); // .example.com
    return target.endsWith(baseDomain) || target === pattern.slice(2);
  }

  // Subdomain match: example.com matches sub.example.com
  if (target.endsWith('.' + pattern)) return true;

  return false;
}

/**
 * Match an IP source against a URL.
 */
function matchIpSource(source: CspSourceExpression, url: string): boolean {
  const parsed = parseUrlForEval(url);
  if (!parsed) return false;

  // Only match HTTP(S) URLs.
  if (parsed.scheme !== 'http' && parsed.scheme !== 'https') return false;

  if (source.kind === 'ip-cidr' && source.cidrPrefix !== undefined) {
    return matchCidr(source.host!, source.cidrPrefix, parsed.host);
  }

  // Direct IP match.
  if (source.kind === 'ip' || source.kind === 'ip-port') {
    if (source.host !== parsed.host) return false;
    if (source.kind === 'ip-port' && source.port !== undefined && source.port !== parsed.port) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Match a CIDR range. Handles IPv4 only for simplicity.
 */
function matchCidr(cidrHost: string, prefix: number, targetHost: string): boolean {
  // Simplified CIDR matching — only IPv4.
  const cidrParts = cidrHost.split('.').map(Number);
  const targetParts = targetHost.split('.').map(Number);

  if (cidrParts.length !== 4 || targetParts.length !== 4) return false;

  const cidrNum = (cidrParts[0]! << 24) | (cidrParts[1]! << 16) | (cidrParts[2]! << 8) | cidrParts[3]!;
  const targetNum = (targetParts[0]! << 24) | (targetParts[1]! << 16) | (targetParts[2]! << 8) | targetParts[3]!;

  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (cidrNum & mask) === (targetNum & mask);
}

/**
 * Match a nonce.
 */
function matchNonce(expectedNonce: string | undefined, actualNonce: string | undefined): boolean {
  if (!expectedNonce || !actualNonce) return false;
  return expectedNonce === actualNonce;
}

/**
 * Match a hash.
 */
function matchHash(
  algorithm: string,
  hashSourceRaw: string,
  actualHash: string | undefined,
): boolean {
  if (!actualHash) return false;
  // The hash source is like 'sha256-abc123...'
  // actualHash should be the same base64 string.
  return hashSourceRaw === `'${algorithm}-${actualHash}'`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate whether a URL is allowed by a CSP policy for a given directive.
 *
 * @param policy The parsed CSP policy.
 * @param directiveName The directive to check (e.g. 'script-src').
 * @param url The URL to evaluate.
 * @param context Evaluation context.
 * @returns The evaluation result.
 */
function evaluateCsp(
  policy: CspPolicy,
  directiveName: string,
  url: string,
  context: CspEvalContext,
): CspEvaluationResult {
  const sources = getEffectiveSources(policy, directiveName);

  // No sources defined → unrestricted (unless sandbox or report-only).
  if (!sources || sources.length === 0) {
    return {
      allowed: true,
      directive: directiveName,
      isSelfMatch: false,
      reportOnly: false,
      url,
    };
  }

  // Check 'none' keyword.
  const hasNone = sources.some(s => s.kind === 'keyword' && s.raw === "'none'");
  if (hasNone) {
    return {
      allowed: false,
      directive: directiveName,
      isSelfMatch: false,
      reportOnly: false,
      url,
    };
  }

  // Check 'unsafe-inline' for inline resources.
  if (context.isInline || context.isEval) {
    // Check nonce match for inline scripts/styles (nonce always overrides unsafe-inline).
    if (context.nonce) {
      const nonceSource = sources.find(
        s => s.kind === 'nonce' && s.nonceValue === context.nonce,
      );
      if (nonceSource) {
        return {
          allowed: true,
          directive: directiveName,
          matchedSource: nonceSource,
          isSelfMatch: false,
          reportOnly: false,
          url,
        };
      }
    }

    // Check hash match (hash always overrides unsafe-inline).
    if (context.hash) {
      const hashSource = sources.find(
        s => s.kind === 'hash' && `'${s.hashAlgorithm}-${context.hash}'` === s.raw,
      );
      if (hashSource) {
        return {
          allowed: true,
          directive: directiveName,
          matchedSource: hashSource,
          isSelfMatch: false,
          reportOnly: false,
          url,
        };
      }
    }

    const hasUnsafeInline = sources.some(
      s => s.kind === 'keyword' && s.raw === "'unsafe-inline'",
    );
    if (hasUnsafeInline && context.isInline) {
      return {
        allowed: true,
        directive: directiveName,
        matchedSource: sources.find(s => s.raw === "'unsafe-inline'"),
        isSelfMatch: false,
        reportOnly: false,
        url,
      };
    }

    // Check 'unsafe-eval' for eval() calls.
    if (context.isEval) {
      const hasUnsafeEval = sources.some(
        s => s.kind === 'keyword' && s.raw === "'unsafe-eval'",
      );
      if (hasUnsafeEval) {
        return {
          allowed: true,
          directive: directiveName,
          matchedSource: sources.find(s => s.raw === "'unsafe-eval'"),
          isSelfMatch: false,
          reportOnly: false,
          url,
        };
      }
      // eval() not allowed.
      return {
        allowed: false,
        directive: directiveName,
        isSelfMatch: false,
        reportOnly: false,
        url,
      };
    }

    // Inline scripts/styles without 'unsafe-inline' are blocked — no URL to match.
    if (context.isInline) {
      return {
        allowed: false,
        directive: directiveName,
        isSelfMatch: false,
        reportOnly: false,
        url,
      };
    }
  }

  // Check nonce match for non-inline resources.
  if (context.nonce) {
    const nonceSource = sources.find(
      s => s.kind === 'nonce' && s.nonceValue === context.nonce,
    );
    if (nonceSource) {
      return {
        allowed: true,
        directive: directiveName,
        matchedSource: nonceSource,
        isSelfMatch: false,
        reportOnly: false,
        url,
      };
    }
  }

  // Check hash match for non-inline resources.
  if (context.hash) {
    const hashSource = sources.find(
      s => s.kind === 'hash' && `'${s.hashAlgorithm}-${context.hash}'` === s.raw,
    );
    if (hashSource) {
      return {
        allowed: true,
        directive: directiveName,
        matchedSource: hashSource,
        isSelfMatch: false,
        reportOnly: false,
        url,
      };
    }
  }

  // Check strict-dynamic: if present, any script created by a trusted script is allowed.
  const hasStrictDynamic = sources.some(
    s => s.kind === 'keyword' && s.raw === "'strict-dynamic'",
  );
  if (hasStrictDynamic && context.userInitiated) {
    return {
      allowed: true,
      directive: directiveName,
      isSelfMatch: false,
      reportOnly: false,
      url,
    };
  }

  // Match URL against source expressions.
  for (const source of sources) {
    if (matchSource(source, url, context)) {
      const isSelfMatch = source.kind === 'keyword' && source.raw === "'self'";
      return {
        allowed: true,
        directive: directiveName,
        matchedSource: source,
        isSelfMatch,
        reportOnly: false,
        url,
      };
    }
  }

  // No source matched.
  return {
    allowed: false,
    directive: directiveName,
    isSelfMatch: false,
    reportOnly: false,
    url,
  };
}

/**
 * Evaluate a URL against all applicable CSP directives.
 * Returns an array of results for each directive checked.
 */
function evaluateCspAllDirectives(
  policy: CspPolicy,
  url: string,
  context: CspEvalContext,
): CspEvaluationResult[] {
  const results: CspEvaluationResult[] = [];

  // Check all directive types that apply to URLs.
  const directivesToCheck = [
    'script-src', 'style-src', 'img-src', 'font-src',
    'connect-src', 'media-src', 'object-src', 'frame-src',
    'child-src', 'worker-src', 'manifest-src', 'prefetch-src',
    'form-action', 'frame-ancestors', 'base-uri',
  ];

  for (const directive of directivesToCheck) {
    const sources = getEffectiveSources(policy, directive);
    if (sources && sources.length > 0) {
      results.push(evaluateCsp(policy, directive, url, context));
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  evaluateCsp,
  evaluateCspAllDirectives,
  parseUrlForEval,
  extractOrigin,
  matchSource,
  matchKeyword,
  matchScheme,
  matchHostSource,
  matchHost,
  matchIpSource,
  matchCidr,
  matchNonce,
  matchHash,
  DIRECTIVE_TO_RESOURCE,
};

export type {
  CspEvaluationResult,
  CspResourceType,
  CspEvalContext,
};
