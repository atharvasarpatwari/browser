/**
 * @file src/browser/networking/response-parser.ts
 * @session 8
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Transform a raw HttpResponseSpec (bytes + HTTP headers) into a structured
 * ParsedResponse that every downstream layer can consume without re-parsing
 * header strings themselves.
 *
 * Pipeline position
 * ─────────────────
 *   RequestManager.send()           → HttpResponseSpec
 *        │
 *        ▼
 *   ResponseParser.parse()          → ParsedResponse
 *        │
 *        ├──▶ isDownload?   → DownloadManager  (session 30)
 *        └──▶ isRenderable? → html-parser      (session 11)
 *                             css-parser        (session 12)
 *                             js-runtime-bridge (session 16)
 *
 * Five sub-parsers, each with its own responsibility:
 *   parseMimeType()           MIME type + charset extraction
 *   categorise()              What kind of content is this?
 *   parseCacheDirectives()    Cache-Control, ETag, Last-Modified, Expires
 *   parseSecurityHeaders()    CSP, HSTS, X-Frame-Options, CORP, COOP, COEP …
 *   parseContentDisposition() inline vs attachment + suggested filename
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IResponseParser is the only type callers depend on.
 *  Encapsulation    All parsing helpers are private static — nothing leaks.
 *  Single-Resp.     This file parses; it never fetches, stores, or renders.
 *  Open / Closed    New MIME categories: add to EXACT_MIME_MAP or PREFIX_MIME_MAP.
 *                   ResponseParser.categorise() never needs to change.
 *  Dependency-Inv.  Callers receive IResponseParser; never ResponseParser directly.
 */

import type { HttpResponseSpec } from './request-manager';

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT CATEGORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Broad category inferred from MIME type (and Content-Disposition).
 * BrowserEngine uses this to route responses to the correct handler.
 */
enum ContentCategory {
  /** text/html, application/xhtml+xml — full page render. */
  HtmlPage    = 'html-page',
  /** application/xml, text/xml, image/svg+xml. */
  XmlDocument = 'xml-document',
  /** application/json, application/ld+json. */
  JsonData    = 'json-data',
  /** text/plain, text/csv. */
  PlainText   = 'plain-text',
  /** text/css — feed to css-parser. */
  Stylesheet  = 'stylesheet',
  /** text/javascript, application/javascript, application/wasm. */
  Script      = 'script',
  /** image/* */
  Image       = 'image',
  /** font/* */
  Font        = 'font',
  /** audio/*, video/* */
  Media       = 'media',
  /** Content-Disposition: attachment, or unrecognised MIME with a body. */
  Download    = 'download',
  /** MIME absent or completely unrecognised. */
  Unknown     = 'unknown',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fully decomposed Content-Type header.
 * "text/html; charset=utf-8"
 *   → { type:'text', subtype:'html', full:'text/html', charset:'utf-8' }
 */
interface ParsedMimeType {
  readonly type:    string;
  readonly subtype: string;
  readonly full:    string;
  readonly params:  ReadonlyMap<string, string>;
  /** Lower-cased charset, defaults to 'utf-8' when absent. */
  readonly charset: string;
}

/**
 * Decoded Cache-Control header plus ETag / Last-Modified / Expires.
 * maxAge / sMaxAge are in seconds; null means the directive was absent.
 */
interface CacheDirectives {
  readonly noStore:        boolean;
  readonly noCache:        boolean;
  readonly mustRevalidate: boolean;
  readonly isPrivate:      boolean;
  readonly isPublic:       boolean;
  readonly maxAge:         number | null;
  readonly sMaxAge:        number | null;
  readonly immutable:      boolean;
  readonly etag:           string | null;
  readonly lastModified:   string | null;
  readonly expires:        Date   | null;
  /** True when the response may be served from cache without revalidation. */
  readonly isCacheable:    boolean;
}

/** All security-relevant response headers in typed form. */
interface SecurityHeaders {
  readonly contentSecurityPolicy:      string | null;
  readonly strictTransportSecurity:    string | null;
  readonly hstsMaxAge:                 number | null;
  readonly hstsIncludeSubDomains:      boolean;
  readonly xFrameOptions:              'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM' | null;
  readonly xContentTypeOptionsNoSniff: boolean;
  readonly referrerPolicy:             string | null;
  readonly permissionsPolicy:          string | null;
  readonly crossOriginResourcePolicy:  string | null;
  readonly crossOriginOpenerPolicy:    string | null;
  readonly crossOriginEmbedderPolicy:  string | null;
}

/** Decoded Content-Disposition header. */
interface ContentDisposition {
  readonly type:              'inline' | 'attachment' | null;
  readonly suggestedFilename: string | null;
}

/** Complete structured interpretation of one HTTP response. */
interface ParsedResponse {
  readonly raw:           HttpResponseSpec;
  readonly mimeType:      ParsedMimeType;
  readonly category:      ContentCategory;
  readonly disposition:   ContentDisposition;
  /** True when the rendering pipeline should display this response. */
  readonly isRenderable:  boolean;
  /** True when the response should go to the download manager. */
  readonly isDownload:    boolean;
  readonly charset:       string;
  readonly cache:         CacheDirectives;
  readonly security:      SecurityHeaders;
  /** Content-Length header value, falling back to body.length. */
  readonly contentLength: number;
  readonly hasBody:       boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IResponseParser {
  parse(response: HttpResponseSpec): ParsedResponse;
  parseMimeType(contentType: string): ParsedMimeType;
  parseCacheDirectives(headers: ReadonlyMap<string, string>): CacheDirectives;
  parseSecurityHeaders(headers: ReadonlyMap<string, string>): SecurityHeaders;
  isDownloadResponse(response: HttpResponseSpec): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIME TABLES
// ─────────────────────────────────────────────────────────────────────────────

const EXACT_MIME_MAP: ReadonlyMap<string, ContentCategory> = new Map([
  ['text/html',                ContentCategory.HtmlPage],
  ['application/xhtml+xml',   ContentCategory.HtmlPage],
  ['application/xml',         ContentCategory.XmlDocument],
  ['text/xml',                ContentCategory.XmlDocument],
  ['image/svg+xml',           ContentCategory.XmlDocument],
  ['application/json',        ContentCategory.JsonData],
  ['application/ld+json',     ContentCategory.JsonData],
  ['application/feed+json',   ContentCategory.JsonData],
  ['text/plain',              ContentCategory.PlainText],
  ['text/csv',                ContentCategory.PlainText],
  ['text/css',                ContentCategory.Stylesheet],
  ['text/javascript',         ContentCategory.Script],
  ['application/javascript',  ContentCategory.Script],
  ['application/x-javascript',ContentCategory.Script],
  ['text/ecmascript',         ContentCategory.Script],
  ['application/ecmascript',  ContentCategory.Script],
  ['application/wasm',        ContentCategory.Script],
]);

const PREFIX_MIME_MAP: ReadonlyArray<[string, ContentCategory]> = [
  ['image/', ContentCategory.Image],
  ['font/',  ContentCategory.Font],
  ['audio/', ContentCategory.Media],
  ['video/', ContentCategory.Media],
];

const RENDERABLE_CATEGORIES = new Set<ContentCategory>([
  ContentCategory.HtmlPage,
  ContentCategory.XmlDocument,
  ContentCategory.JsonData,
  ContentCategory.PlainText,
  ContentCategory.Stylesheet,
  ContentCategory.Script,
  ContentCategory.Image,
  ContentCategory.Media,
]);

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE PARSER
// ─────────────────────────────────────────────────────────────────────────────

class ResponseParser implements IResponseParser {

  // ── IResponseParser: parse ─────────────────────────────────────────────────

  parse(response: HttpResponseSpec): ParsedResponse {
    const h           = response.headers;
    const mimeType    = this.parseMimeType(h.get('content-type') ?? '');
    const disposition = ResponseParser.parseDisposition(h.get('content-disposition') ?? '');
    const category    = ResponseParser.categorise(mimeType, disposition);
    const cache       = this.parseCacheDirectives(h);
    const security    = this.parseSecurityHeaders(h);

    const isDownload   = category === ContentCategory.Download ||
                         disposition.type === 'attachment';
    const isRenderable = !isDownload && RENDERABLE_CATEGORIES.has(category);

    const rawLen      = Number(h.get('content-length'));
    const contentLength = Number.isFinite(rawLen) && rawLen >= 0
      ? rawLen
      : response.body.length;

    return {
      raw: response, mimeType, category, disposition,
      isRenderable, isDownload,
      charset: mimeType.charset,
      cache, security, contentLength,
      hasBody: response.body.length > 0,
    };
  }

  // ── IResponseParser: parseMimeType ────────────────────────────────────────

  parseMimeType(contentType: string): ParsedMimeType {
    if (!contentType.trim()) return ResponseParser.emptyMime();

    const [rawMime = '', ...paramParts] = contentType.split(';');
    const full    = rawMime.trim().toLowerCase();
    const slashIdx = full.indexOf('/');
    if (slashIdx === -1) return ResponseParser.emptyMime();

    const type    = full.slice(0, slashIdx);
    const subtype = full.slice(slashIdx + 1);

    const params = new Map<string, string>();
    for (const part of paramParts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx === -1) continue;
      const k = part.slice(0, eqIdx).trim().toLowerCase();
      const v = part.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      params.set(k, v);
    }

    return {
      type, subtype, full, params,
      charset: (params.get('charset') ?? 'utf-8').toLowerCase(),
    };
  }

  // ── IResponseParser: parseCacheDirectives ─────────────────────────────────

  parseCacheDirectives(headers: ReadonlyMap<string, string>): CacheDirectives {
    const cc  = headers.get('cache-control') ?? '';
    const dir = ResponseParser.splitDirectives(cc);

    const maxAge  = ResponseParser.extractSeconds(dir, 'max-age');
    const sMaxAge = ResponseParser.extractSeconds(dir, 's-maxage');
    const etag          = headers.get('etag')          ?? null;
    const lastModified  = headers.get('last-modified') ?? null;
    const expires       = ResponseParser.parseDate(headers.get('expires') ?? '');

    const noStore        = dir.has('no-store');
    const noCache        = dir.has('no-cache');
    const mustRevalidate = dir.has('must-revalidate');
    const isPrivate      = dir.has('private');
    const isPublic       = dir.has('public');
    const immutable      = dir.has('immutable');

    const effective  = sMaxAge ?? maxAge;
    const isCacheable = !noStore && (
      effective !== null ? effective > 0
                         : etag !== null || lastModified !== null || expires !== null
    );

    return {
      noStore, noCache, mustRevalidate, isPrivate, isPublic,
      maxAge, sMaxAge, immutable, etag, lastModified, expires, isCacheable,
    };
  }

  // ── IResponseParser: parseSecurityHeaders ────────────────────────────────

  parseSecurityHeaders(headers: ReadonlyMap<string, string>): SecurityHeaders {
    const csp  = headers.get('content-security-policy')   ?? null;
    const hsts = headers.get('strict-transport-security') ?? null;

    let hstsMaxAge            = null as number | null;
    let hstsIncludeSubDomains = false;
    if (hsts) {
      const hd = ResponseParser.splitDirectives(hsts);
      hstsMaxAge            = ResponseParser.extractSeconds(hd, 'max-age');
      hstsIncludeSubDomains = hd.has('includesubdomains');
    }

    const xfoRaw = (headers.get('x-frame-options') ?? '').toUpperCase();
    const xFrameOptions =
      xfoRaw === 'DENY'              ? 'DENY'       as const :
      xfoRaw === 'SAMEORIGIN'        ? 'SAMEORIGIN' as const :
      xfoRaw.startsWith('ALLOW-FROM')? 'ALLOW-FROM' as const :
      null;

    return {
      contentSecurityPolicy:      csp,
      strictTransportSecurity:    hsts,
      hstsMaxAge,
      hstsIncludeSubDomains,
      xFrameOptions,
      xContentTypeOptionsNoSniff:
        (headers.get('x-content-type-options') ?? '').toLowerCase() === 'nosniff',
      referrerPolicy:            headers.get('referrer-policy')              ?? null,
      permissionsPolicy:         headers.get('permissions-policy')           ?? null,
      crossOriginResourcePolicy: headers.get('cross-origin-resource-policy') ?? null,
      crossOriginOpenerPolicy:   headers.get('cross-origin-opener-policy')   ?? null,
      crossOriginEmbedderPolicy: headers.get('cross-origin-embedder-policy') ?? null,
    };
  }

  // ── IResponseParser: isDownloadResponse ──────────────────────────────────

  isDownloadResponse(response: HttpResponseSpec): boolean {
    return this.parse(response).isDownload;
  }

  // ── Private: categorise ───────────────────────────────────────────────────

  private static categorise(
    mime: ParsedMimeType,
    disposition: ContentDisposition,
  ): ContentCategory {
    if (disposition.type === 'attachment') return ContentCategory.Download;
    const exact = EXACT_MIME_MAP.get(mime.full);
    if (exact !== undefined) return exact;
    for (const [prefix, cat] of PREFIX_MIME_MAP) {
      if (mime.full.startsWith(prefix)) return cat;
    }
    if (mime.full) return ContentCategory.Download;
    return ContentCategory.Unknown;
  }

  // ── Private: parseDisposition ────────────────────────────────────────────

  private static parseDisposition(raw: string): ContentDisposition {
    if (!raw.trim()) return { type: null, suggestedFilename: null };

    const lower = raw.toLowerCase().trim();
    const type: ContentDisposition['type'] =
      lower.startsWith('attachment') ? 'attachment' :
      lower.startsWith('inline')     ? 'inline'     : null;

    // filename* (RFC 5987) takes priority over filename.
    let filename: string | null = null;
    const fstar = ResponseParser.dispositionParam(raw, 'filename*');
    if (fstar) {
      const tick = fstar.indexOf("''");
      try {
        filename = tick !== -1
          ? decodeURIComponent(fstar.slice(tick + 2))
          : fstar;
      } catch {
        filename = tick !== -1 ? fstar.slice(tick + 2) : fstar;
      }
    } else {
      filename = ResponseParser.dispositionParam(raw, 'filename');
    }

    return {
      type,
      suggestedFilename: filename
        ? ResponseParser.sanitiseFilename(filename)
        : null,
    };
  }

  private static dispositionParam(raw: string, param: string): string | null {
    // Escape regex special characters in param (e.g. '*' in 'filename*').
    const escaped = param.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|;)\\s*${escaped}\\s*=\\s*(?:"([^"]*)"|([^;]*))`, 'i');
    const m  = re.exec(raw);
    if (!m) return null;
    return (m[1] ?? m[2] ?? '').trim() || null;
  }

  private static sanitiseFilename(name: string): string {
    return name.replace(/[/\\]/g, '_').replace(/^\.+/, '').trim() || 'download';
  }

  // ── Private: cache helpers ────────────────────────────────────────────────

  private static splitDirectives(raw: string): Set<string> {
    const set = new Set<string>();
    // Cache-Control uses ',' as separator; HSTS uses ';'.
    // Splitting on both handles both headers with the same helper.
    for (const part of raw.split(/[,;]/)) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed) set.add(trimmed);
    }
    return set;
  }

  private static extractSeconds(dir: Set<string>, key: string): number | null {
    for (const d of dir) {
      if (d.startsWith(key + '=')) {
        const v = parseInt(d.slice(key.length + 1), 10);
        return Number.isFinite(v) ? v : null;
      }
    }
    return null;
  }

  private static parseDate(raw: string): Date | null {
    if (!raw) return null;
    try {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch { return null; }
  }

  // ── Private: fallback ────────────────────────────────────────────────────

  private static emptyMime(): ParsedMimeType {
    return { type:'', subtype:'', full:'', params: new Map(), charset:'utf-8' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ResponseParser,
  ContentCategory,
  RENDERABLE_CATEGORIES,
};

export type {
  IResponseParser,
  ParsedResponse,
  ParsedMimeType,
  CacheDirectives,
  SecurityHeaders,
  ContentDisposition,
};