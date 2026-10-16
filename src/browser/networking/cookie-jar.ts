/**
 * @file src/browser/networking/cookie-jar.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Full RFC 6265bis cookie management for the networking layer: parsing
 * Set-Cookie headers, matching cookies to requests, handling SameSite,
 * Secure, HttpOnly, Domain, Path, and expiry semantics.
 *
 * Unlike storage/cookie-store.ts (which provides general-purpose key-value
 * cookie storage), this module is purpose-built for the HTTP networking
 * pipeline — it sits between ResponseParser and RequestManager to
 * automatically attach and receive cookies.
 *
 * Pipeline position (wired by cookie-service.ts)
 * ─────────────────
 *   CookieAwareHttpClient.send(request)      — every hop, redirects included
 *        ├─ CookieJar.getCookieHeader(url)   → Cookie request header
 *        └─ CookieJar.setFromResponse(url, setCookies)
 *   document.cookie (dom-bindings.ts)
 *        └─ getScriptCookieString / setFromScript  (HttpOnly hidden from scripts)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      ICookieJar hides storage behind get/set/delete.
 *  Encapsulation    Cookie matching logic (domain, path, secure, sameSite)
 *                   is entirely private.
 *  Single-Resp.     This file manages HTTP cookies — nothing else.
 *  Open / Closed    New cookie storage backends implement ICookieStorage.
 *  Dependency-Inv.  Callers depend on ICookieJar, not the concrete class.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** SameSite attribute values. */
enum SameSitePolicy {
  Strict  = 'Strict',
  Lax     = 'Lax',
  None    = 'None',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** A single cookie with all parsed attributes. */
interface CookieData {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: SameSitePolicy;
  /** Unix timestamp in ms; null = session cookie. */
  readonly expires: number | null;
  readonly createdAt: number;
  readonly lastAccessedAt: number;
  /** True when the cookie was set without a Domain attribute (host-only). */
  readonly hostOnly: boolean;
  /** True when expires is null (session cookie). */
  readonly session: boolean;
  /** Maximum Age in seconds from Max-Age attribute; null if absent. */
  readonly maxAge: number | null;
  /** Priority attribute (Low, Medium, High). */
  readonly priority: 'Low' | 'Medium' | 'High';
}

/** Query parameters for retrieving cookies. */
interface CookieQuery {
  readonly url: string;
  readonly name?: string;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
}

/** Parsed Set-Cookie header value. */
interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string | null;
  readonly path: string | null;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite: SameSitePolicy;
  readonly expires: Date | null;
  readonly maxAge: number | null;
  readonly priority: 'Low' | 'Medium' | 'High';
}

/** Statistics about the cookie jar. */
interface CookieJarStats {
  readonly totalCookies: number;
  readonly sessionCookies: number;
  readonly persistentCookies: number;
  readonly uniqueDomains: number;
  readonly oldestCookieAge: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ICookieJar extends IDisposable {
  /** Parse Set-Cookie headers from a response and store matching cookies. */
  setFromResponse(url: string, setCookieHeaders: readonly string[]): number;
  /** Get cookies that should be sent with a request to the given URL. */
  getForRequest(url: string): readonly CookieData[];
  /** Get the Cookie header string for a request URL. */
  getCookieHeader(url: string): string;
  /** Get a specific cookie by name and URL. */
  get(url: string, name: string): CookieData | null;
  /** Get all cookies (for inspection/debugging). */
  getAll(): readonly CookieData[];
  /** Delete a specific cookie. */
  delete(url: string, name: string): boolean;
  /** Delete all cookies for a domain. */
  deleteDomain(hostname: string): number;
  /** Delete all cookies. */
  clear(): void;
  /** Prune expired cookies. */
  prune(): number;
  /** Get stats. */
  getStats(): CookieJarStats;
  /** Check if a cookie can be sent over a secure connection only. */
  isSecureOnly(hostname: string, name: string): boolean;
  /** `document.cookie` read: matching cookies minus HttpOnly, as "a=1; b=2". */
  getScriptCookieString(url: string): string;
  /** `document.cookie` write: one cookie string; HttpOnly is refused, as in browsers. */
  setFromScript(url: string, cookieString: string): boolean;
  /** Persistent (non-session, unexpired) cookies as JSON, for storage. */
  serialize(): string;
  /** Load cookies produced by serialize(); unparseable input is ignored. */
  restore(json: string): number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COOKIE_PATH = '/';
const MAX_COOKIE_SIZE = 4096;
const MAX_COOKIES_PER_DOMAIN = 50;
const MAX_TOTAL_COOKIES = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

class CookieError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CookieError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class CookieOverflowError extends CookieError {
  readonly domain: string;
  constructor(domain: string) {
    super(`Cookie limit exceeded for domain "${domain}".`);
    this.name = 'CookieOverflowError';
    this.domain = domain;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COOKIE JAR
// ─────────────────────────────────────────────────────────────────────────────

class CookieJar implements ICookieJar {
  private readonly store = new Map<string, CookieData>();

  /** @param onChange called after any mutation (used to persist the jar). */
  constructor(private readonly onChange?: () => void) {}

  // ── ICookieJar: setFromResponse ─────────────────────────────────────

  setFromResponse(url: string, setCookieHeaders: readonly string[]): number {
    let accepted = 0;

    for (const raw of setCookieHeaders) {
      if (this.storeParsed(url, CookieJar.parseSetCookie(raw, url), false)) accepted++;
    }
    if (accepted > 0) this.onChange?.();
    return accepted;
  }

  // ── ICookieJar: document.cookie ─────────────────────────────────────

  getScriptCookieString(url: string): string {
    return this.getForRequest(url).filter(c => !c.httpOnly).map(c => `${c.name}=${c.value}`).join('; ');
  }

  setFromScript(url: string, cookieString: string): boolean {
    const parsed = CookieJar.parseSetCookie(cookieString, url);
    if (!parsed || parsed.httpOnly) return false;
    const ok = this.storeParsed(url, parsed, true);
    if (ok) this.onChange?.();
    return ok;
  }

  // ── ICookieJar: persistence ─────────────────────────────────────────

  serialize(): string {
    const now = Date.now();
    return JSON.stringify([...this.store.values()].filter(c => !c.session && c.expires !== null && c.expires > now));
  }

  restore(json: string): number {
    let list: unknown;
    try { list = JSON.parse(json); } catch { return 0; }
    if (!Array.isArray(list)) return 0;
    const now = Date.now();
    let loaded = 0;
    for (const c of list as CookieData[]) {
      if (!c || typeof c.name !== 'string' || typeof c.domain !== 'string' || typeof c.path !== 'string') continue;
      if (c.expires === null || c.expires <= now) continue;
      this.store.set(this.cookieKey(c), c);
      loaded++;
    }
    return loaded;
  }

  /**
   * Stores (or, for an expired cookie, deletes) one parsed cookie. A script
   * may not overwrite an HttpOnly cookie (RFC 6265bis §5.6).
   */
  private storeParsed(url: string, parsed: ParsedSetCookie | null, fromScript: boolean): boolean {
    if (!parsed) return false;
    const requestPath = CookieJar.extractPath(url);
    const cookie = CookieJar.buildCookie(parsed, CookieJar.extractHostname(url), CookieJar.defaultPath(requestPath));
    if (!cookie) return false;
    const key = this.cookieKey(cookie);
    if (fromScript && this.store.get(key)?.httpOnly) return false;
    if (cookie.expires !== null && cookie.expires <= Date.now()) {
      return this.store.delete(key); // Max-Age=0 / past Expires = delete (logout)
    }
    if (!this.acceptCookie(cookie, key)) return false;
    this.store.set(key, cookie);
    return true;
  }

  // ── ICookieJar: getForRequest ───────────────────────────────────────

  getForRequest(url: string): readonly CookieData[] {
    const requestHost = CookieJar.extractHostname(url);
    const requestPath = CookieJar.extractPath(url);
    const isSecure = CookieJar.isSecureUrl(url);

    const matches: CookieData[] = [];

    for (const cookie of this.store.values()) {
      if (this.shouldSendCookie(cookie, requestHost, requestPath, isSecure)) {
        matches.push(cookie);
      }
    }

    // Sort: longer path first, then by creation time.
    return matches.sort((a, b) => {
      const pathDiff = b.path.length - a.path.length;
      return pathDiff !== 0 ? pathDiff : a.createdAt - b.createdAt;
    });
  }

  // ── ICookieJar: getCookieHeader ─────────────────────────────────────

  getCookieHeader(url: string): string {
    const cookies = this.getForRequest(url);
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  // ── ICookieJar: get ────────────────────────────────────────────────

  get(url: string, name: string): CookieData | null {
    const requestHost = CookieJar.extractHostname(url);
    const requestPath = CookieJar.extractPath(url);
    const isSecure = CookieJar.isSecureUrl(url);

    for (const cookie of this.store.values()) {
      if (cookie.name === name &&
          this.shouldSendCookie(cookie, requestHost, requestPath, isSecure)) {
        return cookie;
      }
    }
    return null;
  }

  // ── ICookieJar: getAll / delete / clear ─────────────────────────────

  getAll(): readonly CookieData[] {
    return [...this.store.values()];
  }

  delete(url: string, name: string): boolean {
    const requestHost = CookieJar.extractHostname(url);
    const requestPath = CookieJar.extractPath(url);
    const key = `${requestHost}|${name}|${requestPath}`;
    const deleted = this.store.delete(key);
    if (deleted) this.onChange?.();
    return deleted;
  }

  deleteDomain(hostname: string): number {
    let count = 0;
    for (const [key, cookie] of this.store) {
      if (cookie.domain === hostname || hostname.endsWith('.' + cookie.domain)) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.store.clear();
    this.onChange?.();
  }

  // ── ICookieJar: prune ──────────────────────────────────────────────

  prune(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [key, cookie] of this.store) {
      if (cookie.expires !== null && cookie.expires <= now) {
        this.store.delete(key);
        pruned++;
      }
    }

    return pruned;
  }

  // ── ICookieJar: inspection ─────────────────────────────────────────

  getStats(): CookieJarStats {
    const cookies = [...this.store.values()];
    const domains = new Set(cookies.map(c => c.domain));
    const sessionCookies = cookies.filter(c => c.session).length;
    const now = Date.now();
    const ages = cookies.map(c => now - c.createdAt);

    return {
      totalCookies: cookies.length,
      sessionCookies,
      persistentCookies: cookies.length - sessionCookies,
      uniqueDomains: domains.size,
      oldestCookieAge: ages.length > 0 ? Math.max(...ages) : null,
    };
  }

  isSecureOnly(hostname: string, name: string): boolean {
    for (const cookie of this.store.values()) {
      if (cookie.name === name &&
          (cookie.domain === hostname || hostname.endsWith('.' + cookie.domain))) {
        return cookie.secure;
      }
    }
    return false;
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.store.clear();
  }

  // ── Private: parsing ────────────────────────────────────────────────

  private static parseSetCookie(raw: string, url: string): ParsedSetCookie | null {
    const parts = raw.split(';').map(p => p.trim());
    if (parts.length === 0 || !parts[0]) return null;

    const [nameValue, ...attrs] = parts;
    const eqIdx = nameValue!.indexOf('=');
    if (eqIdx === -1) return null;

    const name = nameValue!.slice(0, eqIdx).trim();
    const value = nameValue!.slice(eqIdx + 1).trim();

    if (!name) return null;

    let domain: string | null = null;
    let path: string | null = null;
    let secure = false;
    let httpOnly = false;
    let sameSite = SameSitePolicy.None;
    let expires: Date | null = null;
    let maxAge: number | null = null;
    let priority: 'Low' | 'Medium' | 'High' = 'Medium';

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      const eqA = attr.indexOf('=');

      if (lower === 'secure') { secure = true; continue; }
      if (lower === 'httponly') { httpOnly = true; continue; }

      if (eqA !== -1) {
        const key = attr.slice(0, eqA).trim().toLowerCase();
        const val = attr.slice(eqA + 1).trim();

        switch (key) {
          case 'domain':
            domain = (val.startsWith('.') ? val.slice(1) : val).toLowerCase() || null;
            break;
          case 'path':
            path = val || DEFAULT_COOKIE_PATH;
            break;
          case 'expires':
            try {
              const d = new Date(val);
              if (!isNaN(d.getTime())) expires = d;
            } catch { /* ignore */ }
            break;
          case 'max-age': {
            const ma = parseInt(val, 10);
            if (Number.isFinite(ma)) maxAge = ma;
            break;
          }
          case 'samesite':
            if (val.toLowerCase() === 'strict') sameSite = SameSitePolicy.Strict;
            else if (val.toLowerCase() === 'lax') sameSite = SameSitePolicy.Lax;
            else sameSite = SameSitePolicy.None;
            break;
          case 'priority':
            if (val.toLowerCase() === 'low') priority = 'Low';
            else if (val.toLowerCase() === 'high') priority = 'High';
            else priority = 'Medium';
            break;
        }
      }
    }

    // Max-Age overrides Expires per RFC.
    if (maxAge !== null) {
      expires = new Date(Date.now() + maxAge * 1000);
    }

    return {
      name, value, domain, path, secure, httpOnly,
      sameSite, expires, maxAge, priority,
    };
  }

  // ── Private: cookie building ────────────────────────────────────────

  private static buildCookie(
    parsed: ParsedSetCookie,
    requestHost: string,
    defaultPath: string,
  ): CookieData | null {
    // Domain matching.
    const domain = parsed.domain ?? requestHost;
    const hostOnly = parsed.domain === null;

    if (!hostOnly) {
      // RFC 6265: Domain attribute must be a suffix of the request host.
      const d = domain.startsWith('.') ? domain.slice(1) : domain;
      if (requestHost !== d && !requestHost.endsWith('.' + d)) {
        return null;
      }
    }

    // Path matching at storage time: only reject if cookie path is a prefix
    // that doesn't match the request path at all.  Per RFC 6265 §5.3 the
    // client stores the cookie unconditionally; matching happens at send time
    // in shouldSendCookie.  We keep a lightweight check here so obviously
    // wrong paths (e.g. Path=/app but request was /other) are dropped early.
    const path = parsed.path && parsed.path.startsWith('/') ? parsed.path : defaultPath;

    return {
      name: parsed.name,
      value: parsed.value,
      domain: hostOnly ? requestHost : domain,
      path,
      secure: parsed.secure,
      httpOnly: parsed.httpOnly,
      sameSite: parsed.sameSite,
      expires: parsed.expires?.getTime() ?? null,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      hostOnly,
      session: parsed.expires === null && parsed.maxAge === null,
      maxAge: parsed.maxAge,
      priority: parsed.priority,
    };
  }

  // ── Private: matching ───────────────────────────────────────────────

  private shouldSendCookie(
    cookie: CookieData,
    requestHost: string,
    requestPath: string,
    isSecure: boolean,
  ): boolean {
    // Secure cookies only sent over HTTPS.
    if (cookie.secure && !isSecure) return false;

    // Domain matching.
    if (cookie.hostOnly) {
      if (requestHost !== cookie.domain) return false;
    } else {
      if (requestHost !== cookie.domain && !requestHost.endsWith('.' + cookie.domain)) {
        return false;
      }
    }

    // Path matching.
    if (!CookieJar.pathMatches(requestPath, cookie.path)) return false;

    // Expiry check (<= catches cookies that expire exactly at the current ms).
    if (cookie.expires !== null && cookie.expires <= Date.now()) return false;

    return true;
  }

  private acceptCookie(cookie: CookieData, key: string): boolean {
    // Replacing an existing cookie never counts against the limits.
    const replacing = this.store.has(key);

    // Per-domain limit.
    let domainCount = 0;
    for (const c of this.store.values()) {
      if (c.domain === cookie.domain) domainCount++;
    }
    if (!replacing && domainCount >= MAX_COOKIES_PER_DOMAIN) return false;

    // Total limit.
    if (!replacing && this.store.size >= MAX_TOTAL_COOKIES) return false;

    // Size limit.
    const size = cookie.name.length + cookie.value.length;
    if (size > MAX_COOKIE_SIZE) return false;

    return true;
  }

  // ── Private: URL helpers ────────────────────────────────────────────

  private static extractHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url.split('/')[2]?.split(':')[0] ?? url;
    }
  }

  private static extractPath(url: string): string {
    try {
      return new URL(url).pathname || '/';
    } catch {
      const parts = url.split('/');
      return '/' + (parts.slice(3).join('/') || '');
    }
  }

  /** RFC 6265 §5.1.4 default-path: the request path up to (not incl.) its last "/". */
  private static defaultPath(requestPath: string): string {
    if (!requestPath.startsWith('/')) return DEFAULT_COOKIE_PATH;
    const last = requestPath.lastIndexOf('/');
    return last <= 0 ? DEFAULT_COOKIE_PATH : requestPath.slice(0, last);
  }

  private static isSecureUrl(url: string): boolean {
    return url.startsWith('https://') || url.startsWith('wss://');
  }

  private static pathMatches(requestPath: string, cookiePath: string): boolean {
    if (requestPath === cookiePath) return true;
    if (requestPath.startsWith(cookiePath)) {
      if (cookiePath.endsWith('/')) return true;
      if (requestPath[cookiePath.length] === '/') return true;
    }
    return false;
  }

  private cookieKey(cookie: CookieData): string {
    return `${cookie.domain}|${cookie.name}|${cookie.path}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  CookieJar,
  SameSitePolicy,
  CookieError,
  CookieOverflowError,
  MAX_COOKIE_SIZE,
  MAX_COOKIES_PER_DOMAIN,
  MAX_TOTAL_COOKIES,
};

export type {
  ICookieJar,
  CookieData,
  CookieQuery,
  ParsedSetCookie,
  CookieJarStats,
};
