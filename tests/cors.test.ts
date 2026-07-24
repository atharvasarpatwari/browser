import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
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
} from '../src/browser/security/cors';
import type {
  CorsRequest,
  HttpResponseSpec,
  PreflightCacheEntry,
} from '../src/browser/security/cors';
import type { IRequestManager } from '../src/browser/networking/request-manager';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<CorsRequest> = {}): CorsRequest {
  return {
    url:      'https://api.example.com/data',
    origin:   'https://app.example.com',
    method:   'GET',
    headers:  new Map(),
    mode:     CorsMode.Cors,
    credentials: CorsCredentials.Omit,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<HttpResponseSpec> = {}): HttpResponseSpec {
  return {
    url:            'https://api.example.com/data',
    statusCode:     200,
    statusText:     'OK',
    headers:        new Map([
      ['access-control-allow-origin', 'https://app.example.com'],
      ['content-type', 'application/json'],
    ]),
    body:           '{"ok":true}',
    bodyBinary:     null,
    redirected:     false,
    redirectChain:  [],
    ...overrides,
  };
}

function makePreflightResponse(
  overrides: { acao?: string; acam?: string; acah?: string; acac?: string; maxAge?: string } = {},
): HttpResponseSpec {
  const headers = new Map<string, string>();
  headers.set('access-control-allow-origin', overrides.acao ?? '*');
  if (overrides.acam) headers.set('access-control-allow-methods', overrides.acam);
  if (overrides.acah) headers.set('access-control-allow-headers', overrides.acah);
  if (overrides.acac) headers.set('access-control-allow-credentials', overrides.acac);
  if (overrides.maxAge) headers.set('access-control-max-age', overrides.maxAge);
  return {
    url:           'https://api.example.com/data',
    statusCode:    204,
    statusText:    'No Content',
    headers,
    body:          '',
    bodyBinary:    null,
    redirected:    false,
    redirectChain: [],
  };
}

function mockRequestManager(response?: HttpResponseSpec): IRequestManager {
  return {
    send:     vi.fn().mockResolvedValue(response ?? makePreflightResponse()),
    on:       vi.fn(),
    off:      vi.fn(),
    setRetryPolicy: vi.fn(),
    getRetryPolicy: vi.fn(),
    loadPage: vi.fn(),
    setProxy: vi.fn(),
    clearCache: vi.fn(),
    getStats: vi.fn(),
  } as unknown as IRequestManager;
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═════════════════════════════════════════════════════════════════════════════

describe('CorsEngine', () => {
  let engine: CorsEngine;

  beforeEach(() => {
    engine = new CorsEngine();
  });

  // ── checkRequest: navigate mode ─────────────────────────────────────────

  describe('checkRequest', () => {
    describe('navigate mode', () => {
      it('should allow navigation without CORS enforcement', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://evil.com/steal',
          mode:   CorsMode.Navigate,
        }));
        expect(result.decision).toBe(CorsRequestDecision.Navigate);
        expect(result.requiresPreflight).toBe(false);
      });

      it('should not add any request headers for navigate', () => {
        const result = engine.checkRequest(makeRequest({
          url:  'https://evil.com/steal',
          mode: CorsMode.Navigate,
        }));
        expect(result.requestHeaders.size).toBe(0);
      });
    });

    // ── checkRequest: same-origin ──────────────────────────────────────────

    describe('same-origin detection', () => {
      it('should detect same-origin requests', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://app.example.com/page',
          origin: 'https://app.example.com',
        }));
        expect(result.decision).toBe(CorsRequestDecision.SameOrigin);
        expect(result.requiresPreflight).toBe(false);
      });

      it('should treat different ports as cross-origin', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://app.example.com:8080/data',
          origin: 'https://app.example.com',
        }));
        expect(result.decision).not.toBe(CorsRequestDecision.SameOrigin);
      });

      it('should treat different protocols as cross-origin', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'http://app.example.com/data',
          origin: 'https://app.example.com',
        }));
        expect(result.decision).not.toBe(CorsRequestDecision.SameOrigin);
      });

      it('should treat different hosts as cross-origin', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://other.example.com/data',
          origin: 'https://app.example.com',
        }));
        expect(result.decision).not.toBe(CorsRequestDecision.SameOrigin);
      });

      it('should handle case-insensitive origin matching', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://APP.EXAMPLE.COM/data',
          origin: 'https://app.example.com',
        }));
        expect(result.decision).toBe(CorsRequestDecision.SameOrigin);
      });
    });

    // ── checkRequest: same-origin mode blocks cross-origin ─────────────────

    describe('same-origin mode', () => {
      it('should throw CorsBlockedError for cross-origin in same-origin mode', () => {
        expect(() => engine.checkRequest(makeRequest({
          url:  'https://api.other.com/data',
          mode: CorsMode.SameOrigin,
        }))).toThrow(CorsBlockedError);
      });

      it('should allow same-origin in same-origin mode', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://app.example.com/page',
          origin: 'https://app.example.com',
          mode:   CorsMode.SameOrigin,
        }));
        expect(result.decision).toBe(CorsRequestDecision.SameOrigin);
      });

      it('should include URL and origin in the error', () => {
        try {
          engine.checkRequest(makeRequest({
            url:  'https://api.other.com/data',
            mode: CorsMode.SameOrigin,
          }));
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(CorsBlockedError);
          expect((e as CorsBlockedError).url).toBe('https://api.other.com/data');
          expect((e as CorsBlockedError).origin).toBe('https://app.example.com');
        }
      });
    });

    // ── checkRequest: no-cors mode ─────────────────────────────────────────

    describe('no-cors mode', () => {
      it('should return opaque decision for cross-origin', () => {
        const result = engine.checkRequest(makeRequest({
          url:  'https://api.other.com/data',
          mode: CorsMode.NoCors,
        }));
        expect(result.decision).toBe(CorsRequestDecision.Opaque);
        expect(result.requiresPreflight).toBe(false);
      });

      it('should not add Origin header in no-cors mode', () => {
        const result = engine.checkRequest(makeRequest({
          url:  'https://api.other.com/data',
          mode: CorsMode.NoCors,
        }));
        expect(result.requestHeaders.has('origin')).toBe(false);
      });

      it('should still detect same-origin in no-cors mode', () => {
        const result = engine.checkRequest(makeRequest({
          url:    'https://app.example.com/page',
          origin: 'https://app.example.com',
          mode:   CorsMode.NoCors,
        }));
        expect(result.decision).toBe(CorsRequestDecision.SameOrigin);
      });
    });

    // ── checkRequest: simple CORS requests ─────────────────────────────────

    describe('simple CORS requests', () => {
      it('should allow GET with no custom headers as simple', () => {
        const result = engine.checkRequest(makeRequest({
          method: 'GET',
          headers: new Map(),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
        expect(result.requiresPreflight).toBe(false);
        expect(result.requestHeaders.get('origin')).toBe('https://app.example.com');
      });

      it('should allow POST with text/plain Content-Type as simple', () => {
        const result = engine.checkRequest(makeRequest({
          method: 'POST',
          headers: new Map([['content-type', 'text/plain']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow POST with application/x-www-form-urlencoded as simple', () => {
        const result = engine.checkRequest(makeRequest({
          method: 'POST',
          headers: new Map([['content-type', 'application/x-www-form-urlencoded']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow POST with multipart/form-data as simple', () => {
        const result = engine.checkRequest(makeRequest({
          method: 'POST',
          headers: new Map([['content-type', 'multipart/form-data; boundary=abc']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow HEAD as simple', () => {
        const result = engine.checkRequest(makeRequest({ method: 'HEAD' }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow accept header as simple', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['accept', 'application/json']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow accept-language header as simple', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['accept-language', 'en-US']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow content-language header as simple', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['content-language', 'fr']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });

      it('should allow range header as simple', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['range', 'bytes=0-1023']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Simple);
      });
    });

    // ── checkRequest: non-simple → preflight required ──────────────────────

    describe('preflight-required requests', () => {
      it('should require preflight for PUT method', () => {
        const result = engine.checkRequest(makeRequest({ method: 'PUT' }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
        expect(result.requiresPreflight).toBe(true);
      });

      it('should require preflight for DELETE method', () => {
        const result = engine.checkRequest(makeRequest({ method: 'DELETE' }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for PATCH method', () => {
        const result = engine.checkRequest(makeRequest({ method: 'PATCH' }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for custom headers', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['x-custom-token', 'abc123']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for authorization header', () => {
        const result = engine.checkRequest(makeRequest({
          headers: new Map([['authorization', 'Bearer token']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for application/json Content-Type', () => {
        const result = engine.checkRequest(makeRequest({
          method:  'POST',
          headers: new Map([['content-type', 'application/json']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for application/xml Content-Type', () => {
        const result = engine.checkRequest(makeRequest({
          method:  'POST',
          headers: new Map([['content-type', 'application/xml']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });

      it('should require preflight for custom Content-Type like image/png', () => {
        const result = engine.checkRequest(makeRequest({
          method:  'POST',
          headers: new Map([['content-type', 'image/png']]),
        }));
        expect(result.decision).toBe(CorsRequestDecision.Preflight);
      });
    });

    // ── checkRequest: preflight cache hit ──────────────────────────────────

    describe('preflight cache', () => {
      it('should use cached preflight to skip preflight request', async () => {
        const mgr = mockRequestManager(makePreflightResponse({
          acam: 'GET, POST',
          acah: 'content-type, x-custom',
        }));

        const req = makeRequest({
          method: 'POST',
          headers: new Map([['content-type', 'application/json']]),
        });

        // Perform preflight to populate cache
        await engine.performPreflight(req, mgr);

        // Now same request should be Simple (cached)
        const result = engine.checkRequest(req);
        expect(result.decision).toBe(CorsRequestDecision.Simple);
        expect(result.requiresPreflight).toBe(false);
      });

      it('should report correct cache size', async () => {
        expect(engine.preflightCacheSize()).toBe(0);

        const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
        await engine.performPreflight(makeRequest(), mgr);

        expect(engine.preflightCacheSize()).toBe(1);
      });

      it('should evict cache entries for a specific origin', async () => {
        const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
        await engine.performPreflight(makeRequest(), mgr);
        expect(engine.preflightCacheSize()).toBe(1);

        engine.evictPreflight('https://app.example.com');
        expect(engine.preflightCacheSize()).toBe(0);
      });

      it('should clear entire cache', async () => {
        const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
        await engine.performPreflight(makeRequest(), mgr);
        await engine.performPreflight(makeRequest({ url: 'https://api.example.com/other' }), mgr);
        expect(engine.preflightCacheSize()).toBe(2);

        engine.clearPreflightCache();
        expect(engine.preflightCacheSize()).toBe(0);
      });

      it('should not use cached entry for different method', async () => {
        const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
        const req = makeRequest({ method: 'POST' });
        await engine.performPreflight(req, mgr);

        // Different method should not match cache
        const putReq = makeRequest({ method: 'PUT' });
        expect(engine.hasCachedPreflight(putReq)).toBe(false);
      });

      it('should not use cached entry for non-simple headers not in cache', async () => {
        const mgr = mockRequestManager(makePreflightResponse({
          acam: 'POST',
          acah: 'content-type',
        }));
        const req = makeRequest({
          method: 'POST',
          headers: new Map([['content-type', 'application/json']]),
        });
        await engine.performPreflight(req, mgr);

        // Different non-simple header
        const otherReq = makeRequest({
          method: 'POST',
          headers: new Map([['x-custom', 'value']]),
        });
        expect(engine.hasCachedPreflight(otherReq)).toBe(false);
      });

      it('should accept wildcard methods in cache', async () => {
        const mgr = mockRequestManager(makePreflightResponse({ acam: '*' }));
        await engine.performPreflight(makeRequest(), mgr);

        const putReq = makeRequest({ method: 'PUT' });
        expect(engine.hasCachedPreflight(putReq)).toBe(true);
      });

      it('should accept wildcard headers in cache', async () => {
        const mgr = mockRequestManager(makePreflightResponse({
          acam: 'POST',
          acah: '*',
        }));
        const req = makeRequest({
          method: 'POST',
          headers: new Map([['x-custom', 'value']]),
        });
        await engine.performPreflight(req, mgr);

        expect(engine.hasCachedPreflight(req)).toBe(true);
      });
    });
  });

  // ── checkResponse ──────────────────────────────────────────────────────

  describe('checkResponse', () => {
    describe('navigate mode', () => {
      it('should allow all headers for navigation', () => {
        const result = engine.checkResponse(
          makeRequest({ mode: CorsMode.Navigate }),
          makeResponse(),
        );
        expect(result.decision).toBe(CorsResponseDecision.Allowed);
        expect(result.exposedHeaders.size).toBeGreaterThan(0);
      });
    });

    describe('no-cors mode', () => {
      it('should return opaque for no-cors', () => {
        const result = engine.checkResponse(
          makeRequest({ mode: CorsMode.NoCors }),
          makeResponse(),
        );
        expect(result.decision).toBe(CorsResponseDecision.Opaque);
        expect(result.exposedHeaders.size).toBe(0);
      });
    });

    describe('cors mode — Access-Control-Allow-Origin', () => {
      it('should allow when origin matches', () => {
        const result = engine.checkResponse(makeRequest(), makeResponse());
        expect(result.decision).toBe(CorsResponseDecision.Allowed);
      });

      it('should allow wildcard ACAO', () => {
        const result = engine.checkResponse(
          makeRequest(),
          makeResponse({ headers: new Map([['access-control-allow-origin', '*'], ['content-type', 'application/json']]) }),
        );
        expect(result.decision).toBe(CorsResponseDecision.Allowed);
      });

      it('should throw CorsViolationError when ACAO is missing', () => {
        expect(() => engine.checkResponse(
          makeRequest(),
          makeResponse({ headers: new Map([['content-type', 'application/json']]) }),
        )).toThrow(CorsViolationError);
      });

      it('should throw when ACAO does not match request origin', () => {
        expect(() => engine.checkResponse(
          makeRequest(),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://evil.com'], ['content-type', 'application/json']]) }),
        )).toThrow(CorsViolationError);
      });

      it('should include header name in violation error', () => {
        try {
          engine.checkResponse(
            makeRequest(),
            makeResponse({ headers: new Map([['content-type', 'application/json']]) }),
          );
          expect.fail('Should have thrown');
        } catch (e) {
          expect(e).toBeInstanceOf(CorsViolationError);
          expect((e as CorsViolationError).header).toBe('access-control-allow-origin');
        }
      });
    });

    describe('credentials', () => {
      it('should throw when wildcard ACAO with credentials include', () => {
        expect(() => engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Include }),
          makeResponse({ headers: new Map([['access-control-allow-origin', '*'], ['content-type', 'application/json']]) }),
        )).toThrow(CorsViolationError);
      });

      it('should throw when credentials include but ACAC is not true', () => {
        expect(() => engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Include }),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://app.example.com'], ['access-control-allow-credentials', 'false'], ['content-type', 'application/json']]) }),
        )).toThrow(CorsViolationError);
      });

      it('should allow when credentials include and ACAC is true', () => {
        const result = engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Include }),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://app.example.com'], ['access-control-allow-credentials', 'true'], ['content-type', 'application/json']]) }),
        );
        expect(result.decision).toBe(CorsResponseDecision.Allowed);
      });

      it('should allow wildcard ACAO with credentials omit', () => {
        const result = engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Omit }),
          makeResponse({ headers: new Map([['access-control-allow-origin', '*'], ['content-type', 'application/json']]) }),
        );
        expect(result.decision).toBe(CorsResponseDecision.Allowed);
      });
    });

    describe('exposed headers', () => {
      it('should always expose CORS-safelisted response headers', () => {
        const result = engine.checkResponse(makeRequest(), makeResponse());
        for (const h of ALWAYS_EXPOSED_HEADERS) {
          expect(result.exposedHeaders.has(h)).toBe(true);
        }
      });

      it('should add headers from Access-Control-Expose-Headers', () => {
        const result = engine.checkResponse(
          makeRequest(),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://app.example.com'], ['access-control-expose-headers', 'x-request-id, x-custom'], ['content-type', 'application/json']]) }),
        );
        expect(result.exposedHeaders.has('x-request-id')).toBe(true);
        expect(result.exposedHeaders.has('x-custom')).toBe(true);
      });

      it('should expose all headers with wildcard expose (no credentials)', () => {
        const result = engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Omit }),
          makeResponse({ headers: new Map([['access-control-allow-origin', '*'], ['access-control-expose-headers', '*'], ['x-secret', 'abc'], ['content-type', 'application/json']]) }),
        );
        expect(result.exposedHeaders.has('x-secret')).toBe(true);
      });

      it('should NOT expose all headers with wildcard expose when credentials include', () => {
        const result = engine.checkResponse(
          makeRequest({ credentials: CorsCredentials.Include }),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://app.example.com'], ['access-control-allow-credentials', 'true'], ['access-control-expose-headers', '*'], ['x-secret', 'abc'], ['content-type', 'application/json']]) }),
        );
        // Wildcard is ignored with credentials, only standard + explicitly listed
        expect(result.exposedHeaders.has('x-secret')).toBe(false);
      });

      it('should handle comma-separated expose headers with spaces', () => {
        const result = engine.checkResponse(
          makeRequest(),
          makeResponse({ headers: new Map([['access-control-allow-origin', 'https://app.example.com'], ['access-control-expose-headers', 'X-Request-Id , X-Custom'], ['content-type', 'application/json']]) }),
        );
        expect(result.exposedHeaders.has('x-request-id')).toBe(true);
        expect(result.exposedHeaders.has('x-custom')).toBe(true);
      });
    });
  });

  // ── performPreflight ───────────────────────────────────────────────────

  describe('performPreflight', () => {
    it('should send OPTIONS request with correct headers', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
      const req = makeRequest();
      await engine.performPreflight(req, mgr);

      expect(mgr.send).toHaveBeenCalledTimes(1);
      const [opts] = (mgr.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.method).toBe('OPTIONS');
      expect(opts.headers.get('origin')).toBe('https://app.example.com');
      expect(opts.headers.get('access-control-request-method')).toBe('GET');
    });

    it('should include only non-simple headers in access-control-request-headers', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'POST' }));
      const req = makeRequest({
        method: 'POST',
        headers: new Map([
          ['content-type', 'application/json'],
          ['x-custom', 'value'],
        ]),
      });
      await engine.performPreflight(req, mgr);

      const [opts] = (mgr.send as ReturnType<typeof vi.fn>).mock.calls[0];
      const reqHeaders = opts.headers.get('access-control-request-headers');
      // content-type is a simple header, so it should NOT be in access-control-request-headers
      expect(reqHeaders).not.toContain('content-type');
      expect(reqHeaders).toContain('x-custom');
    });

    it('should not include simple headers in access-control-request-headers', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
      const req = makeRequest({
        headers: new Map([['accept', 'application/json']]),
      });
      await engine.performPreflight(req, mgr);

      const [opts] = (mgr.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(opts.headers.has('access-control-request-headers')).toBe(false);
    });

    it('should throw CorsPreflightError on non-2xx status', async () => {
      const mgr = mockRequestManager(makeResponse({
        statusCode: 403,
        statusText: 'Forbidden',
        headers:    new Map(),
      }));
      await expect(engine.performPreflight(makeRequest(), mgr))
        .rejects.toThrow(CorsPreflightError);
    });

    it('should throw on ACAO mismatch in preflight response', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acao: 'https://evil.com' }));
      await expect(engine.performPreflight(makeRequest(), mgr))
        .rejects.toThrow(CorsPreflightError);
    });

    it('should throw when credentials requested but ACAC not true', async () => {
      const mgr = mockRequestManager(makePreflightResponse({
        acam: 'POST',
        acac: 'false',
      }));
      await expect(engine.performPreflight(
        makeRequest({ method: 'POST', credentials: CorsCredentials.Include }),
        mgr,
      )).rejects.toThrow(CorsPreflightError);
    });

    it('should cache the preflight result', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET, POST' }));
      const entry = await engine.performPreflight(makeRequest(), mgr);

      expect(entry.allowedMethods.has('GET')).toBe(true);
      expect(entry.allowedMethods.has('POST')).toBe(true);
      expect(entry.origin).toBe('https://app.example.com');
      expect(entry.urlPath).toBe('/data');
      expect(engine.preflightCacheSize()).toBe(1);
    });

    it('should parse max-age from response', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET', maxAge: '3600' }));
      const entry = await engine.performPreflight(makeRequest(), mgr);

      const expectedExpiry = Date.now() + 3600 * 1000;
      // Allow 1s tolerance for test execution time
      expect(Math.abs(entry.expiresAt - expectedExpiry)).toBeLessThan(1000);
    });

    it('should cap max-age at 24 hours', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET', maxAge: '999999' }));
      const entry = await engine.performPreflight(makeRequest(), mgr);

      const maxExpiry = Date.now() + 86400 * 1000;
      expect(entry.expiresAt).toBeLessThanOrEqual(maxExpiry + 1000);
    });

    it('should use default max-age of 5s when not specified', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
      const entry = await engine.performPreflight(makeRequest(), mgr);

      const expectedExpiry = Date.now() + 5 * 1000;
      expect(Math.abs(entry.expiresAt - expectedExpiry)).toBeLessThan(1000);
    });

    it('should parse allowed headers from response', async () => {
      const mgr = mockRequestManager(makePreflightResponse({
        acam: 'POST',
        acah: 'content-type, authorization, x-custom',
      }));
      const entry = await engine.performPreflight(makeRequest({ method: 'POST' }), mgr);

      expect(entry.allowedHeaders.has('content-type')).toBe(true);
      expect(entry.allowedHeaders.has('authorization')).toBe(true);
      expect(entry.allowedHeaders.has('x-custom')).toBe(true);
    });

    it('should pass signal to request manager', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: 'GET' }));
      const controller = new AbortController();
      await engine.performPreflight(makeRequest(), mgr, controller.signal);

      const [, signal] = (mgr.send as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(signal).toBe(controller.signal);
    });
  });

  // ── Error classes ──────────────────────────────────────────────────────

  describe('error classes', () => {
    it('CorsBlockedError should have correct properties', () => {
      const err = new CorsBlockedError('url', 'origin', 'reason');
      expect(err.name).toBe('CorsBlockedError');
      expect(err.url).toBe('url');
      expect(err.origin).toBe('origin');
      expect(err.message).toContain('CORS blocked');
      expect(err).toBeInstanceOf(Error);
    });

    it('CorsViolationError should have correct properties', () => {
      const err = new CorsViolationError('url', 'header', 'reason');
      expect(err.name).toBe('CorsViolationError');
      expect(err.url).toBe('url');
      expect(err.header).toBe('header');
      expect(err.message).toContain('CORS violation');
    });

    it('CorsPreflightError should have correct properties', () => {
      const err = new CorsPreflightError('url', 403, 'reason');
      expect(err.name).toBe('CorsPreflightError');
      expect(err.url).toBe('url');
      expect(err.status).toBe(403);
      expect(err.message).toContain('403');
    });
  });

  // ── Constants ──────────────────────────────────────────────────────────

  describe('constants', () => {
    it('SIMPLE_METHODS should contain GET, POST, HEAD', () => {
      expect(SIMPLE_METHODS.has('GET')).toBe(true);
      expect(SIMPLE_METHODS.has('POST')).toBe(true);
      expect(SIMPLE_METHODS.has('HEAD')).toBe(true);
      expect(SIMPLE_METHODS.has('PUT')).toBe(false);
    });

    it('SIMPLE_REQUEST_HEADERS should contain the 5 safelisted headers', () => {
      expect(SIMPLE_REQUEST_HEADERS.has('accept')).toBe(true);
      expect(SIMPLE_REQUEST_HEADERS.has('accept-language')).toBe(true);
      expect(SIMPLE_REQUEST_HEADERS.has('content-language')).toBe(true);
      expect(SIMPLE_REQUEST_HEADERS.has('content-type')).toBe(true);
      expect(SIMPLE_REQUEST_HEADERS.has('range')).toBe(true);
    });

    it('ALWAYS_EXPOSED_HEADERS should contain the 7 safelisted response headers', () => {
      expect(ALWAYS_EXPOSED_HEADERS.has('cache-control')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('content-language')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('content-length')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('content-type')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('expires')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('last-modified')).toBe(true);
      expect(ALWAYS_EXPOSED_HEADERS.has('pragma')).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle invalid URLs gracefully in parseOrigin', () => {
      const result = engine.checkRequest(makeRequest({
        url:    'not-a-valid-url',
        origin: 'https://app.example.com',
      }));
      // parseOrigin returns '' for invalid URLs, '' !== origin → cross-origin
      expect(result.decision).not.toBe(CorsRequestDecision.SameOrigin);
    });

    it('should handle empty headers map', () => {
      const result = engine.checkRequest(makeRequest({ headers: new Map() }));
      expect(result.decision).toBe(CorsRequestDecision.Simple);
    });

    it('should handle case-insensitive method comparison', () => {
      const result = engine.checkRequest(makeRequest({ method: 'get' }));
      expect(result.decision).toBe(CorsRequestDecision.Simple);
    });

    it('should handle Content-Type with charset parameter', () => {
      const result = engine.checkRequest(makeRequest({
        method:  'POST',
        headers: new Map([['content-type', 'text/plain; charset=utf-8']]),
      }));
      expect(result.decision).toBe(CorsRequestDecision.Simple);
    });

    it('should handle Content-Type with extra parameters', () => {
      const result = engine.checkRequest(makeRequest({
        method:  'POST',
        headers: new Map([['content-type', 'multipart/form-data; boundary=----abc; charset=utf-8']]),
      }));
      expect(result.decision).toBe(CorsRequestDecision.Simple);
    });

    it('should handle ACAO with leading/trailing whitespace', () => {
      const result = engine.checkResponse(
        makeRequest(),
        makeResponse({ headers: new Map([['access-control-allow-origin', '  https://app.example.com  '], ['content-type', 'application/json']]) }),
      );
      expect(result.decision).toBe(CorsResponseDecision.Allowed);
    });

    it('should handle preflight with empty ACAO in cache entry', async () => {
      const mgr = mockRequestManager(makePreflightResponse({ acam: '' }));
      const entry = await engine.performPreflight(makeRequest(), mgr);
      expect(entry.allowedMethods.size).toBe(0);
    });

    it('should handle multiple evictions for same origin', () => {
      engine.evictPreflight('https://example.com'); // no-op, no entries
      expect(engine.preflightCacheSize()).toBe(0);
    });
  });
});
