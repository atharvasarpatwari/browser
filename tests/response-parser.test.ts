import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseParser, ContentCategory, RENDERABLE_CATEGORIES } from '../src/browser/netwroking/response-parser';
import type { HttpResponseSpec } from '../src/browser/netwroking/request-manager';

describe('ResponseParser', () => {
  let parser: ResponseParser;

  beforeEach(() => {
    parser = new ResponseParser();
  });

  function makeResponse(headers: Map<string, string> = new Map(), body = ''): HttpResponseSpec {
    return {
      statusCode: 200,
      statusText: 'OK',
      headers,
      body,
    };
  }

  // ── parseMimeType ────────────────────────────────────────────────────────────

  describe('parseMimeType', () => {
    it('should parse simple MIME type', () => {
      const result = parser.parseMimeType('text/html');
      expect(result.type).toBe('text');
      expect(result.subtype).toBe('html');
      expect(result.full).toBe('text/html');
      expect(result.charset).toBe('utf-8');
    });

    it('should parse MIME with charset', () => {
      const result = parser.parseMimeType('text/html; charset=utf-8');
      expect(result.charset).toBe('utf-8');
      expect(result.params.get('charset')).toBe('utf-8');
    });

    it('should parse MIME with multiple params', () => {
      const result = parser.parseMimeType('text/html; charset=utf-8; boundary=abc');
      expect(result.params.get('charset')).toBe('utf-8');
      expect(result.params.get('boundary')).toBe('abc');
    });

    it('should handle quoted param values', () => {
      const result = parser.parseMimeType('text/html; charset="iso-8859-1"');
      expect(result.charset).toBe('iso-8859-1');
    });

    it('should return empty MIME for empty string', () => {
      const result = parser.parseMimeType('');
      expect(result.type).toBe('');
      expect(result.subtype).toBe('');
      expect(result.full).toBe('');
    });

    it('should return empty MIME for whitespace-only', () => {
      const result = parser.parseMimeType('   ');
      expect(result.type).toBe('');
    });

    it('should return empty MIME if no slash', () => {
      const result = parser.parseMimeType('html');
      expect(result.type).toBe('');
    });

    it('should lowercase full type', () => {
      const result = parser.parseMimeType('Text/HTML');
      expect(result.full).toBe('text/html');
    });
  });

  // ── parseCacheDirectives ─────────────────────────────────────────────────────

  describe('parseCacheDirectives', () => {
    it('should parse no-store', () => {
      const headers = new Map([['cache-control', 'no-store']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.noStore).toBe(true);
      expect(result.isCacheable).toBe(false);
    });

    it('should parse no-cache', () => {
      const headers = new Map([['cache-control', 'no-cache']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.noCache).toBe(true);
    });

    it('should parse max-age', () => {
      const headers = new Map([['cache-control', 'max-age=3600']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.maxAge).toBe(3600);
      expect(result.isCacheable).toBe(true);
    });

    it('should parse s-maxage', () => {
      const headers = new Map([['cache-control', 's-maxage=7200']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.sMaxAge).toBe(7200);
    });

    it('should parse multiple directives', () => {
      const headers = new Map([['cache-control', 'public, max-age=3600, immutable']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.isPublic).toBe(true);
      expect(result.maxAge).toBe(3600);
      expect(result.immutable).toBe(true);
    });

    it('should parse etag', () => {
      const headers = new Map([['etag', '"abc123"']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.etag).toBe('"abc123"');
      expect(result.isCacheable).toBe(true);
    });

    it('should parse last-modified', () => {
      const headers = new Map([['last-modified', 'Wed, 01 Jan 2025 00:00:00 GMT']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.lastModified).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('should parse expires', () => {
      const headers = new Map([['expires', 'Wed, 01 Jan 2030 00:00:00 GMT']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.expires).toBeInstanceOf(Date);
    });

    it('should return null for empty cache-control', () => {
      const result = parser.parseCacheDirectives(new Map());
      expect(result.noStore).toBe(false);
      expect(result.noCache).toBe(false);
      expect(result.maxAge).toBeNull();
      expect(result.isCacheable).toBe(false);
    });

    it('should parse must-revalidate', () => {
      const headers = new Map([['cache-control', 'must-revalidate']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.mustRevalidate).toBe(true);
    });

    it('should parse private', () => {
      const headers = new Map([['cache-control', 'private']]);
      const result = parser.parseCacheDirectives(headers);
      expect(result.isPrivate).toBe(true);
    });
  });

  // ── parseSecurityHeaders ─────────────────────────────────────────────────────

  describe('parseSecurityHeaders', () => {
    it('should parse CSP', () => {
      const headers = new Map([['content-security-policy', "default-src 'self'"]]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.contentSecurityPolicy).toBe("default-src 'self'");
    });

    it('should parse HSTS with max-age', () => {
      const headers = new Map([['strict-transport-security', 'max-age=31536000']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.hstsMaxAge).toBe(31536000);
      expect(result.strictTransportSecurity).toBeTruthy();
    });

    it('should parse HSTS with includesubdomains', () => {
      const headers = new Map([['strict-transport-security', 'max-age=31536000; includeSubDomains']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.hstsIncludeSubDomains).toBe(true);
    });

    it('should parse X-Frame-Options DENY', () => {
      const headers = new Map([['x-frame-options', 'DENY']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.xFrameOptions).toBe('DENY');
    });

    it('should parse X-Frame-Options SAMEORIGIN', () => {
      const headers = new Map([['x-frame-options', 'SAMEORIGIN']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.xFrameOptions).toBe('SAMEORIGIN');
    });

    it('should parse X-Frame-Options ALLOW-FROM', () => {
      const headers = new Map([['x-frame-options', 'ALLOW-FROM https://example.com']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.xFrameOptions).toBe('ALLOW-FROM');
    });

    it('should parse x-content-type-options nosniff', () => {
      const headers = new Map([['x-content-type-options', 'nosniff']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.xContentTypeOptionsNoSniff).toBe(true);
    });

    it('should parse referrer-policy', () => {
      const headers = new Map([['referrer-policy', 'strict-origin-when-cross-origin']]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.referrerPolicy).toBe('strict-origin-when-cross-origin');
    });

    it('should parse CORP/COOP/COEP', () => {
      const headers = new Map([
        ['cross-origin-resource-policy', 'same-origin'],
        ['cross-origin-opener-policy', 'same-origin'],
        ['cross-origin-embedder-policy', 'require-corp'],
      ]);
      const result = parser.parseSecurityHeaders(headers);
      expect(result.crossOriginResourcePolicy).toBe('same-origin');
      expect(result.crossOriginOpenerPolicy).toBe('same-origin');
      expect(result.crossOriginEmbedderPolicy).toBe('require-corp');
    });

    it('should return nulls for missing headers', () => {
      const result = parser.parseSecurityHeaders(new Map());
      expect(result.contentSecurityPolicy).toBeNull();
      expect(result.strictTransportSecurity).toBeNull();
      expect(result.xFrameOptions).toBeNull();
      expect(result.xContentTypeOptionsNoSniff).toBe(false);
    });
  });

  // ── parse (full) ────────────────────────────────────────────────────────────

  describe('parse', () => {
    it('should parse HTML response', () => {
      const headers = new Map([
        ['content-type', 'text/html'],
        ['content-length', '100'],
      ]);
      const response = makeResponse(headers, '<html>');
      const result = parser.parse(response);
      expect(result.mimeType.full).toBe('text/html');
      expect(result.category).toBe(ContentCategory.HtmlPage);
      expect(result.isRenderable).toBe(true);
      expect(result.isDownload).toBe(false);
      expect(result.contentLength).toBe(100);
      expect(result.hasBody).toBe(true);
    });

    it('should parse JSON response', () => {
      const headers = new Map([['content-type', 'application/json']]);
      const response = makeResponse(headers, '{"key":"value"}');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.JsonData);
      expect(result.isRenderable).toBe(true);
    });

    it('should parse image response', () => {
      const headers = new Map([['content-type', 'image/png']]);
      const response = makeResponse(headers, 'binary-data');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.Image);
      expect(result.isRenderable).toBe(true);
    });

    it('should parse font response', () => {
      const headers = new Map([['content-type', 'font/woff2']]);
      const response = makeResponse(headers, 'font-data');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.Font);
    });

    it('should parse CSS response', () => {
      const headers = new Map([['content-type', 'text/css']]);
      const response = makeResponse(headers, 'body { color: red; }');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.Stylesheet);
    });

    it('should parse JS response', () => {
      const headers = new Map([['content-type', 'application/javascript']]);
      const response = makeResponse(headers, 'console.log("hello")');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.Script);
    });

    it('should parse download (attachment)', () => {
      const headers = new Map([
        ['content-type', 'application/octet-stream'],
        ['content-disposition', 'attachment; filename="file.zip"'],
      ]);
      const response = makeResponse(headers, 'binary');
      const result = parser.parse(response);
      expect(result.isDownload).toBe(true);
      expect(result.isRenderable).toBe(false);
      expect(result.disposition.type).toBe('attachment');
      expect(result.disposition.suggestedFilename).toBe('file.zip');
    });

    it('should parse inline disposition', () => {
      const headers = new Map([
        ['content-type', 'image/png'],
        ['content-disposition', 'inline'],
      ]);
      const response = makeResponse(headers, 'data');
      const result = parser.parse(response);
      expect(result.disposition.type).toBe('inline');
    });

    it('should handle unknown MIME type as download', () => {
      const headers = new Map([['content-type', 'application/x-unknown']]);
      const response = makeResponse(headers, 'data');
      const result = parser.parse(response);
      expect(result.isDownload).toBe(true);
    });

    it('should handle missing content-type', () => {
      const response = makeResponse(new Map(), 'data');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.Unknown);
    });

    it('should fallback to body.length for content-length', () => {
      const response = makeResponse(new Map(), 'hello');
      const result = parser.parse(response);
      expect(result.contentLength).toBe(5);
    });

    it('should parse filename* (RFC 5987)', () => {
      const headers = new Map([
        ['content-type', 'application/octet-stream'],
        ['content-disposition', "attachment; filename*=UTF-8''file%20name.zip"],
      ]);
      const response = makeResponse(headers, 'data');
      const result = parser.parse(response);
      expect(result.disposition.suggestedFilename).toBe('file name.zip');
    });

    it('should sanitise filename paths', () => {
      const headers = new Map([
        ['content-disposition', 'attachment; filename="../etc/passwd"'],
      ]);
      const response = makeResponse(headers, 'data');
      const result = parser.parse(response);
      expect(result.disposition.suggestedFilename).not.toContain('..');
    });

    it('should parse audio/video as media', () => {
      const h1 = new Map([['content-type', 'audio/mpeg']]);
      const r1 = parser.parse(makeResponse(h1, 'data'));
      expect(r1.category).toBe(ContentCategory.Media);

      const h2 = new Map([['content-type', 'video/mp4']]);
      const r2 = parser.parse(makeResponse(h2, 'data'));
      expect(r2.category).toBe(ContentCategory.Media);
    });

    it('should parse XML response', () => {
      const headers = new Map([['content-type', 'application/xml']]);
      const response = makeResponse(headers, '<root/>');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.XmlDocument);
    });

    it('should parse plain text', () => {
      const headers = new Map([['content-type', 'text/plain']]);
      const response = makeResponse(headers, 'hello');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.PlainText);
    });

    it('should parse SVG as XML document', () => {
      const headers = new Map([['content-type', 'image/svg+xml']]);
      const response = makeResponse(headers, '<svg/>');
      const result = parser.parse(response);
      expect(result.category).toBe(ContentCategory.XmlDocument);
    });
  });

  // ── isDownloadResponse ──────────────────────────────────────────────────────

  describe('isDownloadResponse', () => {
    it('should return true for attachment', () => {
      const headers = new Map([['content-disposition', 'attachment']]);
      const response = makeResponse(headers);
      expect(parser.isDownloadResponse(response)).toBe(true);
    });

    it('should return false for inline', () => {
      const headers = new Map([
        ['content-type', 'text/html'],
        ['content-disposition', 'inline'],
      ]);
      const response = makeResponse(headers);
      expect(parser.isDownloadResponse(response)).toBe(false);
    });
  });

  // ── ContentCategory / RENDERABLE_CATEGORIES ─────────────────────────────────

  describe('ContentCategory', () => {
    it('should have all expected categories', () => {
      expect(ContentCategory.HtmlPage).toBe('html-page');
      expect(ContentCategory.Download).toBe('download');
      expect(ContentCategory.Unknown).toBe('unknown');
    });

    it('RENDERABLE_CATEGORIES should include basic types', () => {
      expect(RENDERABLE_CATEGORIES.has(ContentCategory.HtmlPage)).toBe(true);
      expect(RENDERABLE_CATEGORIES.has(ContentCategory.Image)).toBe(true);
      expect(RENDERABLE_CATEGORIES.has(ContentCategory.Script)).toBe(true);
      expect(RENDERABLE_CATEGORIES.has(ContentCategory.Download)).toBe(false);
    });
  });
});
