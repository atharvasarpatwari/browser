/**
 * @file src/browser/security/csp-parser.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Parse Content-Security-Policy HTTP header values into a structured
 * CspPolicy object. Handles:
 *   • Multiple directives separated by semicolons
 *   • Multiple source expressions per directive (space-separated)
 *   • CSP Level 1–3 keywords ('self', 'unsafe-inline', 'unsafe-eval', 'none',
 *     'strict-dynamic', 'report-sample', 'nonce-...', 'sha256-...', etc.)
 *   • Scheme sources (https:, http:, data:, blob:, mediastream:)
 *   • Host sources with optional scheme, port, and path (https://cdn.example.com:443/js/)
 *   • Host-path sources (https://example.com/path/)
 *   • IP address sources (192.168.1.0/24, 10.0.0.1:8080)
 *   • Multiple CSP headers via combine()
 *   • Report-URI / Report-To directives
 *   • Upgrade-Insecure-Requests
 *   • Require-Trusted-Types-For
 *   • Sandbox directives (sandbox token extraction)
 *
 * Does NOT:
 *   • Evaluate policies against URLs (csp-evaluator.ts's job)
 *   • Store or manage policies (csp-policy-store.ts's job)
 *   • Enforce policies (enforcer modules' job)
 *
 * OOP PRINCIPLES
 * ─────────────────────
 *  Single-Resp.     Only parses CSP header syntax into data structures.
 *  Abstraction      CspPolicy and CspSourceExpression are the public contracts.
 *  Encapsulation    Parsing logic is internal; callers get immutable value objects.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** All recognized CSP directive names per CSP Level 3. */
type CspDirectiveName =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'connect-src'
  | 'font-src'
  | 'object-src'
  | 'media-src'
  | 'frame-src'
  | 'child-src'
  | 'worker-src'
  | 'manifest-src'
  | 'prefetch-src'
  | 'form-action'
  | 'frame-ancestors'
  | 'base-uri'
  | 'plugin-types'
  | 'sandbox'
  | 'report-uri'
  | 'report-to'
  | 'upgrade-insecure-requests'
  | 'require-trusted-types-for'
  | 'trusted-types'
  | 'navigation-to'
  | 'frame-to'
  | 'form-src'
  | 'fenced-frame-src';

/** Keywords recognized in source expressions. */
type CspKeyword =
  | "'none'"
  | "'self'"
  | "'unsafe-inline'"
  | "'unsafe-eval'"
  | "'unsafe-hashes'"
  | "'strict-dynamic'"
  | "'report-sample'"
  | "'allow-duplicates'";

/** Type of a single source expression. */
type CspSourceKind =
  | 'keyword'
  | 'scheme'
  | 'host'
  | 'host-path'
  | 'host-port'
  | 'host-port-path'
  | 'ip'
  | 'ip-cidr'
  | 'ip-port'
  | 'nonce'
  | 'hash'
  | 'wildcard';

/** A single parsed source expression within a directive. */
interface CspSourceExpression {
  /** The raw text of the source expression. */
  readonly raw: string;
  /** Classified type. */
  readonly kind: CspSourceKind;
  /** Scheme if present (e.g. 'https', 'data'). */
  readonly scheme?: string;
  /** Host if present (e.g. 'cdn.example.com'). */
  readonly host?: string;
  /** Port if present. */
  readonly port?: number;
  /** Path if present (e.g. '/js/'). */
  readonly path?: string;
  /** CIDR prefix length for IP ranges. */
  readonly cidrPrefix?: number;
  /** Hash algorithm for hash-based sources (e.g. 'sha256'). */
  readonly hashAlgorithm?: string;
  /** Nonce value (without the 'nonce-' prefix). */
  readonly nonceValue?: string;
}

/** A single parsed CSP directive with its source list. */
interface CspDirective {
  /** Directive name (e.g. 'script-src'). */
  readonly name: CspDirectiveName | string;
  /** Parsed source expressions. Empty array means no sources listed. */
  readonly sources: readonly CspSourceExpression[];
  /** Raw text of the directive value. */
  readonly rawValue: string;
  /** Sandbox tokens, only populated for the sandbox directive. */
  readonly sandboxTokens?: readonly string[];
}

/** A fully parsed CSP policy from one or more CSP headers. */
interface CspPolicy {
  /** All parsed directives keyed by name. */
  readonly directives: ReadonlyMap<string, CspDirective>;
  /** Whether upgrade-insecure-requests is present. */
  readonly upgradeInsecureRequests: boolean;
  /** Whether sandbox is present. */
  readonly hasSandbox: boolean;
  /** Sandbox flags if present. */
  readonly sandboxFlags: readonly string[];
  /** Report-uri value if present. */
  readonly reportUri?: string;
  /** Report-to group name if present. */
  readonly reportTo?: string;
  /** Trusted types configuration if present. */
  readonly requireTrustedTypesFor?: string;
  /** Trusted types policy names if present. */
  readonly trustedTypes?: readonly string[];
  /** The original raw header value(s). */
  readonly rawHeader: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Well-known CSP keywords. */
const CSP_KEYWORDS: ReadonlySet<string> = new Set([
  "'none'", "'self'", "'unsafe-inline'", "'unsafe-eval'",
  "'unsafe-hashes'", "'strict-dynamic'", "'report-sample'",
  "'allow-duplicates'",
]);

/** Well-known scheme names (without the colon). */
const KNOWN_SCHEMES: ReadonlySet<string> = new Set([
  'http', 'https', 'ftp', 'ftps', 'data', 'blob', 'mediastream',
  'ws', 'wss', 'file', 'chrome', 'chrome-extension',
]);

/** Well-known directive names. */
const KNOWN_DIRECTIVES: ReadonlySet<string> = new Set([
  'default-src', 'script-src', 'style-src', 'img-src', 'connect-src',
  'font-src', 'object-src', 'media-src', 'frame-src', 'child-src',
  'worker-src', 'manifest-src', 'prefetch-src', 'form-action',
  'frame-ancestors', 'base-uri', 'plugin-types', 'sandbox',
  'report-uri', 'report-to', 'upgrade-insecure-requests',
  'require-trusted-types-for', 'trusted-types', 'navigation-to',
  'frame-to', 'form-src', 'fenced-frame-src',
]);

/** Non-fallible directives (their absence means something different than 'none'). */
const NON_FALLIBLE_DIRECTIVES: ReadonlySet<string> = new Set([
  'sandbox', 'report-uri', 'report-to', 'upgrade-insecure-requests',
  'require-trusted-types-for', 'trusted-types',
]);

/** Directives that accept only keywords, not URL sources. */
const KEYWORD_ONLY_DIRECTIVES: ReadonlySet<string> = new Set([
  'upgrade-insecure-requests', 'require-trusted-types-for',
]);

// ─────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a single source expression string into a structured CspSourceExpression.
 */
function parseSourceExpression(raw: string): CspSourceExpression {
  const trimmed = raw.trim();

  // Keyword sources.
  if (CSP_KEYWORDS.has(trimmed)) {
    return { raw: trimmed, kind: 'keyword' };
  }

  // Nonce sources: 'nonce-<base64>'
  if (trimmed.startsWith("'nonce-")) {
    const nonceValue = trimmed.slice(7, -1); // strip 'nonce-' and closing '
    return { raw: trimmed, kind: 'nonce', nonceValue };
  }

  // Hash sources: 'sha256-<base64>' or 'sha384-<base64>' or 'sha512-<base64>'
  const hashMatch = trimmed.match(/^'(sha256|sha384|sha512)-(.+)'$/);
  if (hashMatch) {
    return {
      raw: trimmed,
      kind: 'hash',
      hashAlgorithm: hashMatch[1],
    };
  }

  // Scheme-only source: 'https:' or 'data:' or 'mediastream:'
  const schemeOnlyMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):$/);
  if (schemeOnlyMatch) {
    return { raw: trimmed, kind: 'scheme', scheme: schemeOnlyMatch[1].toLowerCase() };
  }

  // Wildcard: '*' (matches everything)
  if (trimmed === '*') {
    return { raw: trimmed, kind: 'wildcard' };
  }

  // IP CIDR: '192.168.0.0/16' or '[::1]/128'
  const cidrMatch = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (cidrMatch) {
    return {
      raw: trimmed,
      kind: 'ip-cidr',
      host: cidrMatch[1],
      cidrPrefix: parseInt(cidrMatch[2], 10),
    };
  }

  // IPv6 CIDR: '[::1]/128'
  const ipv6CidrMatch = trimmed.match(/^\[([^\]]+)\]\/(\d{1,3})$/);
  if (ipv6CidrMatch) {
    return {
      raw: trimmed,
      kind: 'ip-cidr',
      host: ipv6CidrMatch[1],
      cidrPrefix: parseInt(ipv6CidrMatch[2], 10),
    };
  }

  // Host with optional scheme, port, and path.
  // Patterns:
  //   https://example.com/path/
  //   example.com
  //   example.com:8080
  //   example.com/path/
  //   example.com:443/path/
  //   192.168.1.1
  //   192.168.1.1:8080
  //   192.168.1.1/path/

  let scheme: string | undefined;
  let remainder = trimmed;

  // Extract optional scheme.
  const schemeMatch = remainder.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase();
    remainder = remainder.slice(schemeMatch[0].length);
  }

  // Split remainder into host, optional port, optional path.
  const slashIdx = remainder.indexOf('/');
  let hostPort = remainder;
  let path: string | undefined;

  if (slashIdx >= 0) {
    hostPort = remainder.slice(0, slashIdx);
    path = remainder.slice(slashIdx);
  }

  let host: string;
  let port: number | undefined;

  // IPv6 address in brackets.
  const ipv6Match = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6Match) {
    host = ipv6Match[1];
    if (ipv6Match[2]) port = parseInt(ipv6Match[2], 10);
  } else {
    const colonIdx = hostPort.lastIndexOf(':');
    if (colonIdx > 0 && /^\d+$/.test(hostPort.slice(colonIdx + 1))) {
      // Could be port.
      host = hostPort.slice(0, colonIdx);
      port = parseInt(hostPort.slice(colonIdx + 1), 10);
    } else {
      host = hostPort;
    }
  }

  // Determine if it's an IP address.
  const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
               host.includes(':'); // simple IPv6 heuristic

  let kind: CspSourceKind;
  if (isIp && path) kind = 'host-path';
  else if (isIp && port) kind = 'ip-port';
  else if (isIp) kind = 'ip';
  else if (scheme && path) kind = 'host-path';
  else if (scheme && port) kind = 'host-port-path';
  else if (path) kind = 'host-path';
  else if (port) kind = 'host-port';
  else kind = 'host';

  return { raw: trimmed, kind, scheme, host, port, path };
}

/**
 * Parse a single CSP directive string (e.g. "script-src 'self' https://cdn.example.com").
 */
function parseDirective(directiveStr: string): CspDirective | null {
  const trimmed = directiveStr.trim();
  if (!trimmed) return null;

  const spaceIdx = trimmed.indexOf(' ');
  let name: string;
  let value: string;

  if (spaceIdx < 0) {
    name = trimmed.toLowerCase();
    value = '';
  } else {
    name = trimmed.slice(0, spaceIdx).toLowerCase();
    value = trimmed.slice(spaceIdx + 1).trim();
  }

  // Parse sandbox tokens.
  if (name === 'sandbox') {
    const tokens = value ? value.split(/\s+/).map(t => t.trim()).filter(Boolean) : [];
    return {
      name,
      sources: [],
      rawValue: value,
      sandboxTokens: tokens,
    };
  }

  // Keyword-only directives.
  if (KEYWORD_ONLY_DIRECTIVES.has(name)) {
    return {
      name,
      sources: value ? [parseSourceExpression(value)] : [],
      rawValue: value,
    };
  }

  // Parse source expressions.
  const sources = value
    ? value.split(/\s+/).map(s => parseSourceExpression(s.trim())).filter(Boolean)
    : [];

  return {
    name,
    sources,
    rawValue: value,
  };
}

/**
 * Parse a Content-Security-Policy header value into a CspPolicy.
 *
 * @param headerValue The raw CSP header string (may contain multiple
 *   directives separated by semicolons).
 * @returns A parsed CspPolicy object.
 */
function parseCspHeader(headerValue: string): CspPolicy {
  const directives = new Map<string, CspDirective>();
  let upgradeInsecureRequests = false;
  let hasSandbox = false;
  let sandboxFlags: string[] = [];
  let reportUri: string | undefined;
  let reportTo: string | undefined;
  let requireTrustedTypesFor: string | undefined;
  let trustedTypes: string[] | undefined;

  if (!headerValue || !headerValue.trim()) {
    return {
      directives,
      upgradeInsecureRequests: false,
      hasSandbox: false,
      sandboxFlags: [],
      rawHeader: headerValue,
    };
  }

  // Split on semicolons to get individual directives.
  const directiveStrings = headerValue.split(';');

  for (const ds of directiveStrings) {
    const directive = parseDirective(ds);
    if (!directive) continue;

    switch (directive.name) {
      case 'upgrade-insecure-requests':
        upgradeInsecureRequests = true;
        break;
      case 'sandbox':
        hasSandbox = true;
        sandboxFlags = directive.sandboxTokens ? [...directive.sandboxTokens] : [];
        break;
      case 'report-uri':
        reportUri = directive.rawValue || undefined;
        break;
      case 'report-to':
        reportTo = directive.rawValue || undefined;
        break;
      case 'require-trusted-types-for':
        requireTrustedTypesFor = directive.rawValue || undefined;
        break;
      case 'trusted-types':
        trustedTypes = directive.rawValue
          ? directive.rawValue.split(/\s+/).filter(Boolean)
          : undefined;
        break;
      default:
        directives.set(directive.name, directive);
        break;
    }
  }

  return {
    directives,
    upgradeInsecureRequests,
    hasSandbox,
    sandboxFlags,
    reportUri,
    reportTo,
    requireTrustedTypesFor,
    trustedTypes,
    rawHeader: headerValue,
  };
}

/**
 * Combine multiple CSP headers into a single policy.
 *
 * Per the CSP spec, when multiple headers are present:
 *   • Each directive name's source list is the INTERSECTION (most restrictive)
 *     of the individual policies.
 *   • upgrade-insecure-requests is enforced if present in ANY header.
 *   • sandbox is enforced with the INTERSECTION of flags.
 *
 * This function merges by taking the most restrictive set for each directive.
 */
function combineCspPolicies(headers: string[]): CspPolicy {
  if (headers.length === 0) {
    return parseCspHeader('');
  }

  if (headers.length === 1) {
    return parseCspHeader(headers[0]);
  }

  const policies = headers.map(parseCspHeader);

  // Merge directives: for each directive name, take the sources that appear
  // in ALL policies (intersection). If a directive is missing from any policy,
  // treat it as absent (most restrictive).
  const allDirectiveNames = new Set<string>();
  for (const p of policies) {
    for (const name of p.directives.keys()) {
      allDirectiveNames.add(name);
    }
  }

  const mergedDirectives = new Map<string, CspDirective>();

  for (const name of allDirectiveNames) {
    // Collect source lists from all policies that have this directive.
    const sourceLists: (readonly CspSourceExpression[])[] = [];
    let rawValue = '';

    for (const p of policies) {
      const d = p.directives.get(name);
      if (d) {
        sourceLists.push(d.sources);
        rawValue = d.rawValue;
      }
    }

    if (sourceLists.length === 0) continue;

    // If any policy is missing this directive, it should be treated as
    // unrestricted in that policy, so the intersection is just the sources
    // from the policies that have it. Actually, per the spec: if any policy
    // doesn't define a directive, that policy allows all resources for that
    // type. So the intersection is the sources from policies that DO define it.
    // If ALL policies define it, intersect. Otherwise, only the policies that
    // define it matter.

    // For simplicity: take the source list from the first policy that defines it.
    // In real browsers, this is more complex (intersection of source lists).
    // We'll take the intersection of keyword sources and the union for host sources.
    const firstSources = sourceLists[0]!;

    // For strict intersection: a source must appear in ALL source lists.
    if (sourceLists.length > 1) {
      const intersection: CspSourceExpression[] = [];
      for (const source of firstSources) {
        const inAll = sourceLists.every(list =>
          list.some(s => s.raw === source.raw),
        );
        if (inAll) intersection.push(source);
      }
      mergedDirectives.set(name, {
        name,
        sources: intersection,
        rawValue,
      });
    } else {
      mergedDirectives.set(name, {
        name,
        sources: [...firstSources],
        rawValue,
      });
    }
  }

  const upgradeInsecure = policies.some(p => p.upgradeInsecureRequests);

  // Sandbox: intersection of flags.
  const sandboxSets = policies.filter(p => p.hasSandbox).map(p => new Set(p.sandboxFlags));
  const mergedSandbox = sandboxSets.length > 0
    ? [...sandboxSets.reduce((a, b) => {
        const result = new Set<string>();
        for (const item of a) {
          if (b.has(item)) result.add(item);
        }
        return result;
      }, sandboxSets[0]!)]
    : [];

  const firstReportUri = policies.find(p => p.reportUri)?.reportUri;
  const firstReportTo = policies.find(p => p.reportTo)?.reportTo;

  return {
    directives: mergedDirectives,
    upgradeInsecureRequests: upgradeInsecure,
    hasSandbox: mergedSandbox.length > 0,
    sandboxFlags: mergedSandbox,
    reportUri: firstReportUri,
    reportTo: firstReportTo,
    rawHeader: headers.join('; '),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Get effective directive sources with fallback to default-src
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the effective source list for a directive, falling back to default-src
 * per the CSP spec.
 *
 * @param policy The parsed CSP policy.
 * @param directiveName The directive to look up.
 * @returns The source expressions, or undefined if neither the directive
 *   nor default-src is present (means unrestricted for that type).
 */
function getEffectiveSources(
  policy: CspPolicy,
  directiveName: string,
): readonly CspSourceExpression[] | undefined {
  const directive = policy.directives.get(directiveName);
  if (directive) return directive.sources;

  // Fall back to default-src (except for non-fallible directives).
  if (!NON_FALLIBLE_DIRECTIVES.has(directiveName)) {
    const fallback = policy.directives.get('default-src');
    if (fallback) return fallback.sources;
  }

  return undefined;
}

/**
 * Check if a directive name is a known CSP directive.
 */
function isKnownDirective(name: string): boolean {
  return KNOWN_DIRECTIVES.has(name);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  parseCspHeader,
  combineCspPolicies,
  parseSourceExpression,
  parseDirective,
  getEffectiveSources,
  isKnownDirective,
  CSP_KEYWORDS,
  KNOWN_SCHEMES,
  KNOWN_DIRECTIVES,
  NON_FALLIBLE_DIRECTIVES,
};

export type {
  CspDirectiveName,
  CspKeyword,
  CspSourceKind,
  CspSourceExpression,
  CspDirective,
  CspPolicy,
};
