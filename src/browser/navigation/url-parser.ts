/**
 * @file src/browser/navigation/url-parser.ts
 * @session 2 / standalone — no imports from project files
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Convert raw address-bar text into a fully structured ParsedUrl.
 *
 * The three distinct concerns handled here are:
 *   1. Sanitisation  — strip surrounding whitespace, collapse internal spaces.
 *   2. Normalisation — infer a scheme when the user omits it
 *                      ("google.com" → "https://google.com").
 *   3. Decomposition — split the canonical URL into every addressable component
 *                      (protocol, hostname, pathname, query params, …).
 *
 * Navigation *decisions* (where to go, whether to open a new tab, back-stack
 * management) belong in NavigationController, not here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction       All callers depend on IUrlParser, never on UrlParser.
 *  Encapsulation     Regex patterns, helper methods, and constant Sets are
 *                    private or private-static; callers have no visibility.
 *  Single-Resp.      UrlParser only parses — zero navigation side-effects.
 *  Open / Closed     Extend behaviour by updating the constant maps/sets
 *                    (ALLOWED_PROTOCOLS, SPECIAL_PAGES) — the class is never edited.
 *  Dependency-Inv.   DI container will register UrlParser under the IUrlParser
 *                    token; every consumer types against the interface.
 *  Interface-Seg.    IUrlParser exposes only what callers need; private helpers
 *                    are not part of the public surface.
 */

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Immutable snapshot of every URL component.
 * Mirrors the WHATWG URL specification fields, plus browser-specific extras.
 */
interface ParsedUrl {
  /** Exact string provided by the caller before any transformation. */
  readonly raw: string;

  /** Scheme-inferred, trimmed, lowercased-protocol form of the URL. */
  readonly normalized: string;

  /** Protocol including the trailing colon. e.g. "https:" */
  readonly protocol: string;

  /** Hostname only, without port.  e.g. "example.com" */
  readonly hostname: string;

  /**
   * Port as a string, or "" when the URL uses the scheme's default port.
   * e.g. "8080" for http://example.com:8080, "" for https://example.com.
   */
  readonly port: string;

  /** hostname:port when non-default, otherwise just hostname. */
  readonly host: string;

  /** Path starting with "/".  e.g. "/docs/api/v2" */
  readonly pathname: string;

  /** Full query string including "?".  e.g. "?q=hello&lang=ts" */
  readonly search: string;

  /** Fragment including "#".  e.g. "#section-3" */
  readonly hash: string;

  /** scheme + "//" + host.  e.g. "https://example.com" */
  readonly origin: string;

  /** Canonical absolute URL string as accepted by fetch() / navigation. */
  readonly href: string;

  /** True when the URL identifies a built-in browser page (about:blank, nova://…). */
  readonly isSpecialPage: boolean;

  /**
   * True when the connection is encrypted (https:, wss:, ftps:, sftp:, ssh:)
   * or a trusted local/internal source (file:, nova:, about:, data:, blob:)
   * or a safe external handler (mailto:, tel:, sms:, smsto:, magnet:).
   */
  readonly isSecure: boolean;

  /**
   * Key-value pairs parsed from the query string.
   * When the same key appears multiple times, the last value wins (matches
   * URLSearchParams.get() semantics).
   */
  readonly params: ReadonlyMap<string, string>;
}

/**
 * Non-throwing result from IUrlParser.validate().
 * Use this when you want to inspect problems before deciding whether to navigate.
 */
interface ValidationResult {
  /** Whether parse() would succeed for the same input. */
  readonly valid: boolean;

  /** Human-readable explanation when valid === false. */
  readonly reason?: string;

  /** The scheme-inferred form, populated even for some invalid inputs. */
  readonly normalized?: string;

  /** The specific error type when known. */
  readonly errorKind?: 'blocked-protocol' | 'malformed' | 'empty';
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT (interface)
// ─────────────────────────────────────────────────────────────────────────────

interface IUrlParser {
  /**
   * Parse raw address-bar text into a fully structured ParsedUrl.
   *
   * @param rawInput  Anything the user typed — may be a full URL, a bare
   *                  hostname, a file path, or a special-page alias.
   *
   * @throws {UrlParseError}        Base class for all parse errors.
   * @throws {BlockedProtocolError} When the scheme is disallowed (javascript:, data:, …).
   * @throws {MalformedUrlError}    When the string cannot be understood as a URL.
   * @throws {EmptyInputError}      When the trimmed input is empty.
   */
  parse(rawInput: string): ParsedUrl;

  /**
   * Infer a scheme when absent and return the canonical string.
   *
   * Never throws — returns the best normalization attempt or the original
   * string when no inference can be made.
   */
  normalize(rawInput: string): string;

  /**
   * Non-throwing validation gate.
   *
   * Equivalent to calling parse() inside a try/catch and returning the
   * structured outcome.
   */
  validate(rawInput: string): ValidationResult;

  /** True when input refers to a built-in browser page. */
  isSpecialPage(rawInput: string): boolean;

  /**
   * True when the input carries a protocol that is explicitly disallowed.
   * Useful for showing a security warning before attempting to parse.
   */
  isBlockedProtocol(rawInput: string): boolean;

  /**
   * True when the input is NOT a valid URL and should be treated as a
   * search query routed to the default search engine.
   */
  isSearchQuery(rawInput: string): boolean;

  /**
   * Build a full search-engine URL for the given query string.
   *
   * @param query       The raw search text the user typed.
   * @param engineUrl   Base URL of the search engine (must contain a %s
   *                    placeholder).  Defaults to DuckDuckGo.
   * @returns           The complete URL ready for navigation.
   */
  buildSearchUrl(query: string, engineUrl?: string): string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HIERARCHY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base class for all URL parsing failures.
 * Callers that do not care about the sub-type can catch this alone.
 */
class UrlParseError extends Error {
  /** The unmodified string that triggered the error. */
  readonly input: string;

  constructor(input: string, message: string) {
    super(message);
    this.name = 'UrlParseError';
    this.input = input;
    // Restore prototype chain (needed when compiling to ES5).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the detected scheme is on the security block-list. */
class BlockedProtocolError extends UrlParseError {
  readonly protocol: string;

  constructor(input: string, protocol: string) {
    super(input, `Protocol "${protocol}" is blocked for security reasons.`);
    this.name = 'BlockedProtocolError';
    this.protocol = protocol;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the URL structure is fundamentally invalid. */
class MalformedUrlError extends UrlParseError {
  constructor(input: string, detail?: string) {
    super(
      input,
      detail
        ? `Malformed URL "${input}": ${detail}`
        : `"${input}" is not a valid URL.`,
    );
    this.name = 'MalformedUrlError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when the sanitised input collapses to an empty string. */
class EmptyInputError extends UrlParseError {
  constructor(input: string) {
    super(input, 'URL input must not be empty.');
    this.name = 'EmptyInputError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANT TABLES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The schemes the browser will load from the address bar.
 * Add new schemes here — UrlParser.parse() picks them up automatically.
 *
 * Categories:
 *   Web:             http:, https:
 *   WebSocket:       ws:, wss:
 *   File Transfer:   ftp:, ftps:, sftp:
 *   Local:           file:
 *   Internal:        data:, blob:, about:, nova:
 *   External:        mailto:, tel:, sms:, smsto:, ssh:
 *   Torrent:         magnet:
 *   Usenet:          news:, nntp:
 *   Legacy:          gopher:, wais:
 */
const ALLOWED_PROTOCOLS = new Set<string>([
  // Web
  'http:',
  'https:',
  // WebSocket
  'ws:',
  'wss:',
  // File transfer
  'ftp:',
  'ftps:',
  'sftp:',
  // Local
  'file:',
  // Internal
  'data:',
  'blob:',
  'about:',
  'nova:',
  // External handlers
  'mailto:',
  'tel:',
  'sms:',
  'smsto:',
  'ssh:',
  // Torrent
  'magnet:',
  // Usenet
  'news:',
  'nntp:',
  // Legacy
  'gopher:',
  'wais:',
  // Gateway: Proxy
  'http-proxy:',
  'https-proxy:',
  'socks4:',
  'socks4a:',
  'socks5:',
  'pac+http:',
  'pac+https:',
  'wpad:',
  // Gateway: DNS
  'dns:',
  'dns+udp:',
  'dns+tcp:',
  'https+dns:',
  'tls+dns:',
  'quic+dns:',
  'dnssec:',
  'mdns:',
  // Gateway: Tunnel
  'ssh-tunnel:',
  'wg:',
  'openvpn:',
  'ipsec:',
  'ikev2:',
  'l2tp:',
  'gre:',
  'ipip:',
  'vxlan:',
  'geneve:',
  '6to4:',
  'isatap:',
  'teredo:',
  // Gateway: NAT
  'upnp:',
  'nat-pmp:',
  'pcp:',
  'stun:',
  'stuns:',
  'turn:',
  'turns:',
  'ice:',
  // Gateway: Access
  'captive:',
  'radius:',
  'radiustls:',
  'tacacs:',
  'dot1x:',
  'wispr:',
  // Gateway: Load Balancer
  'health:',
  'consul:',
  // Gateway: CDN
  'cdn:',
  'cdn+push:',
  'cdn+pull:',
  // Gateway: Discovery
  'ssdp:',
  'bonjour:',
  'avahi:',
  'dnssd:',
]);

/**
 * Schemes that are ALWAYS blocked regardless of context.
 * This list should only ever grow, never shrink.
 *
 * Rationale per entry
 * ───────────────────
 *   javascript: — XSS vector, never safe from the address bar.
 *   vbscript:   — legacy IE attack vector.
 */
const BLOCKED_PROTOCOLS = new Set<string>([
  'javascript:',
  'vbscript:',
  'data:',
]);

/**
 * Known special-page aliases → canonical href.
 *
 * Keys are lower-cased; the parser lower-cases before look-up.
 * Values must be a scheme in ALLOWED_PROTOCOLS.
 */
const SPECIAL_PAGES: ReadonlyMap<string, string> = new Map<string, string>([
  ['about:blank',      'about:blank'],
  ['about:newtab',     'about:newtab'],
  ['about:settings',   'nova://settings'],
  ['about:downloads',  'nova://downloads'],
  ['about:history',    'nova://history'],
  ['about:bookmarks',  'nova://bookmarks'],
  ['about:extensions', 'nova://extensions'],
  ['nova://settings',   'nova://settings'],
  ['nova://downloads',  'nova://downloads'],
  ['nova://history',    'nova://history'],
  ['nova://bookmarks',  'nova://bookmarks'],
  ['nova://extensions', 'nova://extensions'],
]);

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production implementation of IUrlParser.
 *
 * All regex constants are private static so they are compiled once and
 * shared across all instances, without being accessible to subclasses or
 * external code.
 */
class UrlParser implements IUrlParser {

  // ── Pattern library ───────────────────────────────────────────────────────

  /**
   * Detects a bare hostname that should receive an implicit "https://" prefix.
   *
   * Matches:
   *   • "google.com"
   *   • "sub.domain.co.uk/path?q=1"
   *   • "example.com:3000"
   *
   * Does NOT match:
   *   • "localhost"  (handled by LOCALHOST_RE)
   *   • Raw IPs     (handled by IPV4_RE)
   *   • Strings that already carry a scheme
   *   • Single-label hostnames like "www" (handled by SINGLE_LABEL_HOSTNAME_RE)
   */
  private static readonly BARE_HOSTNAME_RE =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}(:\d{1,5})?(\/[^\s]*)?(\?[^\s]*)?(#[^\s]*)?$/;

  /**
   * Matches a bare single-label hostname with an optional port, path, query,
   * and fragment — no dot required.
   *
   * This catches inputs like "www" that are valid DNS labels but don't carry
   * a TLD suffix.  The WHATWG URL constructor accepts these as valid hostnames
   * once the "https://" prefix is applied.
   *
   * Matches:
   *   • "www"
   *   • "www:3000"
   *   • "mail/path"
   *   • "server:8080/api?v=1"
   *
   * Does NOT match:
   *   • "localhost"               (handled by LOCALHOST_RE)
   *   • Single characters         (minimum 2 chars)
   *   • Labels starting with a digit  (avoid matching IPs or version strings)
   *   • Strings already carrying a scheme
   */
  private static readonly SINGLE_LABEL_HOSTNAME_RE =
    /^[a-zA-Z][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](:\d{1,5})?(\/[^\s/][^\s]*)?(\?[^\s]*)?(#[^\s]*)?$/;

  /**
   * Matches bare IPv4 addresses with optional port and path.
   * e.g. "192.168.1.1", "10.0.0.1:8080/api"
   */
  private static readonly IPV4_RE =
    /^(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?(\/[^\s]*)?$/;

  /**
   * Matches "localhost" with an optional port and path.
   * e.g. "localhost", "localhost:3000", "localhost:4000/app"
   */
  private static readonly LOCALHOST_RE =
    /^localhost(:\d{1,5})?(\/[^\s]*)?$/;

  /**
   * Detects a scheme prefix: one or more alphanumeric / "-" / "+" / "."
   * chars followed by "://".
   * e.g. "https://", "ftp://", "file://"
   */
  private static readonly SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//;

  /**
   * Detects any scheme (including scheme-only like "about:blank").
   * e.g. "about:", "javascript:", "data:"
   */
  private static readonly ANY_SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+\-.]*):/;

  // ── IUrlParser: parse ──────────────────────────────────────────────────────

  parse(rawInput: string): ParsedUrl {
    const sanitized = this.sanitize(rawInput);

    if (sanitized.length === 0) {
      throw new EmptyInputError(rawInput);
    }

    const normalized = this.normalize(sanitized);

    // Security gate — must run before any URL construction.
    this.assertNotBlocked(rawInput, normalized);

    // Special pages: structurally valid but unparseable by the URL API.
    const canonical = SPECIAL_PAGES.get(normalized.toLowerCase());
    if (canonical !== undefined) {
      return UrlParser.buildSpecialPage(rawInput, canonical);
    }

    // Attempt WHATWG URL parse.
    let urlObj: URL;
    try {
      urlObj = new URL(normalized);
    } catch {
      throw new MalformedUrlError(
        rawInput,
        `"${normalized}" could not be parsed as a URL`,
      );
    }

    // Reject unknown schemes that sneak past normalize().
    const scheme = urlObj.protocol;
    if (!ALLOWED_PROTOCOLS.has(scheme)) {
      throw new BlockedProtocolError(rawInput, scheme);
    }

    return this.buildParsedUrl(rawInput, normalized, urlObj);
  }

  // ── IUrlParser: normalize ──────────────────────────────────────────────────

  normalize(rawInput: string): string {
    const s = this.sanitize(rawInput);

    // 1. Empty → return as-is; parse() will throw EmptyInputError.
    if (s.length === 0) return s;

    // 2. Known special page alias → canonical form.
    const lower = s.toLowerCase();
    if (SPECIAL_PAGES.has(lower)) {
      return SPECIAL_PAGES.get(lower)!;
    }

    // 3. Localhost with optional port / path  — checked BEFORE scheme detection
    //    because "localhost:3000" would otherwise be mis-read as scheme="localhost".
    if (UrlParser.LOCALHOST_RE.test(s)) {
      return 'https://' + s;
    }

    // 4. Bare IPv4 address — same reason: "192.168.1.1:8080" looks like a scheme.
    if (UrlParser.IPV4_RE.test(s)) {
      return 'https://' + s;
    }

    // 5. Single-label hostname (e.g. "www", "mail", "server").
    //    Checked BEFORE the general scheme detection so that inputs like
    //    "www:3000/api" are treated as a hostname+port+path and NOT as a
    //    URL with an unknown scheme "www:".
    if (UrlParser.SINGLE_LABEL_HOSTNAME_RE.test(s)) {
      return 'https://' + s;
    }

    // 6. Already carries a real scheme — lowercase the scheme part only.
    //    Matches "https://…", "ftp://…", "about:blank", "nova://…", etc.
    const schemeMatch = UrlParser.ANY_SCHEME_RE.exec(s);
    if (schemeMatch !== null) {
      const scheme = schemeMatch[1]!.toLowerCase();
      const rest   = s.slice(schemeMatch[0].length);
      const candidate = scheme + ':' + rest;
      // For URLs with a proper authority (://), use the URL constructor
      // to lowercase hostname and normalize path.
      if (rest.startsWith('//')) {
        try { return new URL(candidate).href; } catch { /* fall through */ }
      }
      return candidate;
    }

    // 7. Looks like a bare hostname (e.g. "google.com", "sub.domain.co.uk/path").
    if (UrlParser.BARE_HOSTNAME_RE.test(s)) {
      return 'https://' + s;
    }

    // 8. Unknown shape — return as-is; NavigationController will treat it
    //    as a search query when parse() throws MalformedUrlError.
    return s;
  }

  // ── IUrlParser: validate ───────────────────────────────────────────────────

  validate(rawInput: string): ValidationResult {
    const sanitized = this.sanitize(rawInput);

    if (sanitized.length === 0) {
      return { valid: false, errorKind: 'empty', reason: 'Input is empty.' };
    }

    const normalized = this.normalize(sanitized);

    // Check blocked protocols first — cheapest guard.
    if (this.isBlockedProtocol(normalized)) {
      const scheme = UrlParser.ANY_SCHEME_RE.exec(normalized)?.[1] ?? '?';
      return {
        valid: false,
        errorKind: 'blocked-protocol',
        reason: `Protocol "${scheme}:" is not allowed.`,
        normalized,
      };
    }

    try {
      this.parse(rawInput);
      return { valid: true, normalized };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { valid: false, errorKind: 'malformed', reason, normalized };
    }
  }

  // ── IUrlParser: isSpecialPage ──────────────────────────────────────────────

  isSpecialPage(rawInput: string): boolean {
    const lower = this.sanitize(rawInput).toLowerCase();
    return SPECIAL_PAGES.has(lower);
  }

  // ── IUrlParser: isBlockedProtocol ─────────────────────────────────────────

  isBlockedProtocol(rawInput: string): boolean {
    const s = this.sanitize(rawInput).toLowerCase();
    const match = UrlParser.ANY_SCHEME_RE.exec(s);
    if (match === null) return false;
    return BLOCKED_PROTOCOLS.has(match[1]! + ':');
  }

  // ── IUrlParser: isSearchQuery ────────────────────────────────────────────

  isSearchQuery(rawInput: string): boolean {
    const s = this.sanitize(rawInput);
    if (s.length === 0) return false;

    const validation = this.validate(s);
    if (validation.valid) return false;

    // Has a scheme like "ftp:" or "nova:" but is malformed — not a search query.
    if (UrlParser.ANY_SCHEME_RE.test(s)) return false;

    // Looks like a domain or IP but failed parse — not a search query.
    if (UrlParser.BARE_HOSTNAME_RE.test(s)) return false;
    if (UrlParser.LOCALHOST_RE.test(s)) return false;
    if (UrlParser.IPV4_RE.test(s)) return false;

    return true;
  }

  // ── IUrlParser: buildSearchUrl ───────────────────────────────────────────

  buildSearchUrl(query: string, engineUrl = 'https://duckduckgo.com/?q=%s'): string {
    const encoded = encodeURIComponent(this.sanitize(query));
    return engineUrl.replace('%s', encoded);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Remove surrounding whitespace; collapse internal runs to a single space. */
  private sanitize(input: string): string {
    return input.trim().replace(/\s+/g, ' ');
  }

  /**
   * Throw BlockedProtocolError if `normalized` carries a disallowed scheme.
   * `raw` is the original caller input — used in the error message.
   */
  private assertNotBlocked(raw: string, normalized: string): void {
    const lower = normalized.toLowerCase();
    const match = UrlParser.ANY_SCHEME_RE.exec(lower);
    if (match === null) return;

    const fullScheme = match[1]! + ':';
    if (BLOCKED_PROTOCOLS.has(fullScheme)) {
      throw new BlockedProtocolError(raw, fullScheme);
    }
  }

  /**
   * Construct a ParsedUrl for a built-in browser page.
   * The WHATWG URL API cannot parse "about:blank" or "nova://…" uniformly,
   * so we build the object manually.
   */
  private static buildSpecialPage(raw: string, canonical: string): ParsedUrl {
    const colonIdx = canonical.indexOf(':');
    const protocol  = colonIdx !== -1
      ? canonical.slice(0, colonIdx + 1)
      : 'about:';

    return {
      raw,
      normalized: canonical,
      protocol,
      hostname:  '',
      port:      '',
      host:      '',
      pathname:  '',
      search:    '',
      hash:      '',
      origin:    canonical,
      href:      canonical,
      isSpecialPage: true,
      isSecure:      true,          // all built-in pages are trusted
      params:        new Map(),
    };
  }

  /**
   * Construct a ParsedUrl from a successfully parsed WHATWG URL object.
   * Extracts every component and converts URLSearchParams to a Map.
   */
  private buildParsedUrl(raw: string, normalized: string, url: URL): ParsedUrl {
    const isSecure =
      url.protocol === 'https:'     ||
      url.protocol === 'wss:'       ||
      url.protocol === 'ftps:'      ||
      url.protocol === 'sftp:'      ||
      url.protocol === 'ssh:'       ||
      url.protocol === 'file:'      ||
      url.protocol === 'nova:'      ||
      url.protocol === 'about:'     ||
      url.protocol === 'data:'      ||
      url.protocol === 'blob:'      ||
      url.protocol === 'mailto:'    ||
      url.protocol === 'tel:'       ||
      url.protocol === 'sms:'       ||
      url.protocol === 'smsto:'     ||
      url.protocol === 'magnet:'    ||
      // Gateway: encrypted protocols
      url.protocol === 'https-proxy:' ||
      url.protocol === 'pac+https:'   ||
      url.protocol === 'tls+dns:'     ||
      url.protocol === 'quic+dns:'    ||
      url.protocol === 'https+dns:'   ||
      url.protocol === 'ssh-tunnel:'  ||
      url.protocol === 'wg:'          ||
      url.protocol === 'openvpn:'     ||
      url.protocol === 'ipsec:'       ||
      url.protocol === 'ikev2:'       ||
      url.protocol === 'vxlan:'       ||
      url.protocol === 'geneve:'      ||
      url.protocol === 'stuns:'       ||
      url.protocol === 'turns:'       ||
      url.protocol === 'captive:'     ||
      url.protocol === 'radiustls:'   ||
      url.protocol === 'tacacs:'      ||
      url.protocol === 'wispr:'       ||
      url.protocol === 'consul:'      ||
      url.protocol === 'cdn:'         ||
      url.protocol === 'cdn+push:'    ||
      url.protocol === 'cdn+pull:';

    const isSpecialPage =
      url.protocol === 'about:' ||
      url.protocol === 'nova:'  ||
      url.protocol === 'data:'  ||
      url.protocol === 'blob:';

    return {
      raw,
      normalized,
      protocol:      url.protocol,
      hostname:      url.hostname,
      port:          url.port,
      host:          url.host,
      pathname:      url.pathname,
      search:        url.search,
      hash:          url.hash,
      origin:        url.origin,
      href:          url.href,
      isSpecialPage,
      isSecure,
      params:        this.extractParams(url.searchParams),
    };
  }

  /**
   * Convert URLSearchParams to a ReadonlyMap.
   * When a key appears multiple times, the LAST value is stored
   * (consistent with URLSearchParams.get() returning the first).
   *
   * Design note: Map is used instead of a plain object so that
   * callers iterate with for…of rather than for…in, avoiding
   * prototype pollution risks.
   */
  private extractParams(searchParams: URLSearchParams): ReadonlyMap<string, string> {
    const map = new Map<string, string>();
    for (const [key, value] of searchParams.entries()) {
      map.set(key, value);
    }
    return map;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  UrlParser,
  UrlParseError,
  BlockedProtocolError,
  MalformedUrlError,
  EmptyInputError,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
  SPECIAL_PAGES,
};

export type {
  IUrlParser,
  ParsedUrl,
  ValidationResult,
};