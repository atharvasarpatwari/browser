import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// CSP Parser tests
// ─────────────────────────────────────────────────────────────────────────────

import {
  parseCspHeader,
  combineCspPolicies,
  parseSourceExpression,
  parseDirective,
  getEffectiveSources,
  isKnownDirective,
} from '../src/browser/security/csp-parser';

import type { CspSourceExpression } from '../src/browser/security/csp-parser';

describe('CspParser', () => {
  describe('parseSourceExpression', () => {
    it("should parse 'none' keyword", () => {
      const s = parseSourceExpression("'none'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'none'");
    });

    it("should parse 'self' keyword", () => {
      const s = parseSourceExpression("'self'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'self'");
    });

    it("should parse 'unsafe-inline' keyword", () => {
      const s = parseSourceExpression("'unsafe-inline'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'unsafe-inline'");
    });

    it("should parse 'unsafe-eval' keyword", () => {
      const s = parseSourceExpression("'unsafe-eval'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'unsafe-eval'");
    });

    it("should parse 'strict-dynamic' keyword", () => {
      const s = parseSourceExpression("'strict-dynamic'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'strict-dynamic'");
    });

    it("should parse 'report-sample' keyword", () => {
      const s = parseSourceExpression("'report-sample'");
      expect(s.kind).toBe('keyword');
      expect(s.raw).toBe("'report-sample'");
    });

    it("should parse nonce source", () => {
      const s = parseSourceExpression("'nonce-abc123'");
      expect(s.kind).toBe('nonce');
      expect(s.nonceValue).toBe('abc123');
    });

    it("should parse sha256 hash source", () => {
      const s = parseSourceExpression("'sha256-base64data'");
      expect(s.kind).toBe('hash');
      expect(s.hashAlgorithm).toBe('sha256');
    });

    it("should parse sha384 hash source", () => {
      const s = parseSourceExpression("'sha384-abc'");
      expect(s.kind).toBe('hash');
      expect(s.hashAlgorithm).toBe('sha384');
    });

    it("should parse sha512 hash source", () => {
      const s = parseSourceExpression("'sha512-xyz'");
      expect(s.kind).toBe('hash');
      expect(s.hashAlgorithm).toBe('sha512');
    });

    it("should parse https: scheme source", () => {
      const s = parseSourceExpression('https:');
      expect(s.kind).toBe('scheme');
      expect(s.scheme).toBe('https');
    });

    it("should parse data: scheme source", () => {
      const s = parseSourceExpression('data:');
      expect(s.kind).toBe('scheme');
      expect(s.scheme).toBe('data');
    });

    it("should parse blob: scheme source", () => {
      const s = parseSourceExpression('blob:');
      expect(s.kind).toBe('scheme');
      expect(s.scheme).toBe('blob');
    });

    it("should parse wildcard", () => {
      const s = parseSourceExpression('*');
      expect(s.kind).toBe('wildcard');
      expect(s.raw).toBe('*');
    });

    it("should parse simple host", () => {
      const s = parseSourceExpression('example.com');
      expect(s.kind).toBe('host');
      expect(s.host).toBe('example.com');
    });

    it("should parse host with https scheme", () => {
      const s = parseSourceExpression('https://example.com');
      expect(s.kind).toBe('host');
      expect(s.scheme).toBe('https');
      expect(s.host).toBe('example.com');
    });

    it("should parse host with port", () => {
      const s = parseSourceExpression('example.com:8080');
      expect(s.kind).toBe('host-port');
      expect(s.host).toBe('example.com');
      expect(s.port).toBe(8080);
    });

    it("should parse host with path", () => {
      const s = parseSourceExpression('example.com/js/');
      expect(s.kind).toBe('host-path');
      expect(s.host).toBe('example.com');
      expect(s.path).toBe('/js/');
    });

    it("should parse host with scheme, port, and path", () => {
      const s = parseSourceExpression('https://cdn.example.com:443/js/app.js');
      expect(s.kind).toBe('host-path');
      expect(s.scheme).toBe('https');
      expect(s.host).toBe('cdn.example.com');
      expect(s.path).toBe('/js/app.js');
    });

    it("should parse IP address", () => {
      const s = parseSourceExpression('192.168.1.1');
      expect(s.kind).toBe('ip');
      expect(s.host).toBe('192.168.1.1');
    });

    it("should parse IP CIDR range", () => {
      const s = parseSourceExpression('192.168.0.0/16');
      expect(s.kind).toBe('ip-cidr');
      expect(s.host).toBe('192.168.0.0');
      expect(s.cidrPrefix).toBe(16);
    });

    it("should parse IP with port", () => {
      const s = parseSourceExpression('10.0.0.1:8080');
      expect(s.kind).toBe('ip-port');
      expect(s.host).toBe('10.0.0.1');
      expect(s.port).toBe(8080);
    });
  });

  describe('parseDirective', () => {
    it('should parse directive with no sources', () => {
      const d = parseDirective('upgrade-insecure-requests');
      expect(d).not.toBeNull();
      expect(d!.name).toBe('upgrade-insecure-requests');
      expect(d!.sources).toHaveLength(0);
    });

    it('should parse script-src with multiple sources', () => {
      const d = parseDirective("script-src 'self' https://cdn.example.com 'nonce-abc'");
      expect(d).not.toBeNull();
      expect(d!.name).toBe('script-src');
      expect(d!.sources).toHaveLength(3);
      expect(d!.sources[0]!.raw).toBe("'self'");
      expect(d!.sources[1]!.host).toBe('cdn.example.com');
      expect(d!.sources[2]!.nonceValue).toBe('abc');
    });

    it('should parse sandbox directive with tokens', () => {
      const d = parseDirective('sandbox allow-scripts allow-forms');
      expect(d).not.toBeNull();
      expect(d!.name).toBe('sandbox');
      expect(d!.sandboxTokens).toEqual(['allow-scripts', 'allow-forms']);
    });

    it('should parse sandbox with no tokens', () => {
      const d = parseDirective('sandbox');
      expect(d).not.toBeNull();
      expect(d!.name).toBe('sandbox');
      expect(d!.sandboxTokens).toEqual([]);
    });

    it('should parse report-uri', () => {
      const d = parseDirective('report-uri /csp-report');
      expect(d).not.toBeNull();
      expect(d!.name).toBe('report-uri');
      expect(d!.rawValue).toBe('/csp-report');
    });

    it('should parse report-to', () => {
      const d = parseDirective('report-to csp-endpoint');
      expect(d).not.toBeNull();
      expect(d!.name).toBe('report-to');
      expect(d!.rawValue).toBe('csp-endpoint');
    });

    it('should parse trusted-types', () => {
      const d = parseDirective("trusted-types policy1 policy2");
      expect(d).not.toBeNull();
      expect(d!.name).toBe('trusted-types');
      expect(d!.rawValue).toBe('policy1 policy2');
    });

    it('should return null for empty string', () => {
      expect(parseDirective('')).toBeNull();
      expect(parseDirective('   ')).toBeNull();
    });
  });

  describe('parseCspHeader', () => {
    it('should parse a single directive', () => {
      const p = parseCspHeader("default-src 'self'");
      expect(p.directives.size).toBe(1);
      expect(p.directives.has('default-src')).toBe(true);
      expect(p.upgradeInsecureRequests).toBe(false);
      expect(p.hasSandbox).toBe(false);
    });

    it('should parse multiple directives', () => {
      const p = parseCspHeader(
        "default-src 'self'; script-src 'self' https://cdn.example.com; style-src 'self' 'unsafe-inline'",
      );
      expect(p.directives.size).toBe(3);
      expect(p.directives.has('default-src')).toBe(true);
      expect(p.directives.has('script-src')).toBe(true);
      expect(p.directives.has('style-src')).toBe(true);
    });

    it('should detect upgrade-insecure-requests', () => {
      const p = parseCspHeader("default-src 'self'; upgrade-insecure-requests");
      expect(p.upgradeInsecureRequests).toBe(true);
    });

    it('should detect sandbox', () => {
      const p = parseCspHeader("default-src 'self'; sandbox allow-scripts allow-forms");
      expect(p.hasSandbox).toBe(true);
      expect(p.sandboxFlags).toEqual(['allow-scripts', 'allow-forms']);
    });

    it('should parse report-uri', () => {
      const p = parseCspHeader("default-src 'self'; report-uri /csp-violation");
      expect(p.reportUri).toBe('/csp-violation');
    });

    it('should parse report-to', () => {
      const p = parseCspHeader("default-src 'self'; report-to endpoint");
      expect(p.reportTo).toBe('endpoint');
    });

    it('should parse trusted-types', () => {
      const p = parseCspHeader("script-src 'self'; trusted-types policy1");
      expect(p.requireTrustedTypesFor).toBeUndefined();
      expect(p.trustedTypes).toEqual(['policy1']);
    });

    it('should parse require-trusted-types-for', () => {
      const p = parseCspHeader("script-src 'self'; require-trusted-types-for 'script'");
      expect(p.requireTrustedTypesFor).toBe("'script'");
    });

    it('should handle empty header', () => {
      const p = parseCspHeader('');
      expect(p.directives.size).toBe(0);
      expect(p.upgradeInsecureRequests).toBe(false);
    });

    it('should preserve raw header', () => {
      const raw = "default-src 'self'; script-src 'self'";
      const p = parseCspHeader(raw);
      expect(p.rawHeader).toBe(raw);
    });
  });

  describe('combineCspPolicies', () => {
    it('should return parsed single header', () => {
      const p = combineCspPolicies(["default-src 'self'"]);
      expect(p.directives.size).toBe(1);
    });

    it('should return empty policy for no headers', () => {
      const p = combineCspPolicies([]);
      expect(p.directives.size).toBe(0);
    });

    it('should intersect directives across headers', () => {
      const p = combineCspPolicies([
        "script-src 'self' https://a.com",
        "script-src 'self' https://b.com",
      ]);
      const scriptSrc = p.directives.get('script-src');
      expect(scriptSrc).toBeDefined();
      // Intersection: only 'self' appears in both.
      expect(scriptSrc!.sources).toHaveLength(1);
      expect(scriptSrc!.sources[0]!.raw).toBe("'self'");
    });

    it('should set upgradeInsecureRequests if any header has it', () => {
      const p = combineCspPolicies([
        "default-src 'self'",
        "default-src 'self'; upgrade-insecure-requests",
      ]);
      expect(p.upgradeInsecureRequests).toBe(true);
    });

    it('should intersect sandbox flags', () => {
      const p = combineCspPolicies([
        'sandbox allow-scripts allow-forms',
        'sandbox allow-scripts',
      ]);
      expect(p.hasSandbox).toBe(true);
      expect(p.sandboxFlags).toEqual(['allow-scripts']);
    });
  });

  describe('getEffectiveSources', () => {
    it('should return directive sources when present', () => {
      const p = parseCspHeader("script-src 'self' https://cdn.com");
      const sources = getEffectiveSources(p, 'script-src');
      expect(sources).toHaveLength(2);
    });

    it('should fall back to default-src', () => {
      const p = parseCspHeader("default-src 'self'");
      const sources = getEffectiveSources(p, 'script-src');
      expect(sources).toHaveLength(1);
      expect(sources![0]!.raw).toBe("'self'");
    });

    it('should not fall back for non-fallible directives', () => {
      const p = parseCspHeader("default-src 'self'");
      const sources = getEffectiveSources(p, 'sandbox');
      expect(sources).toBeUndefined();
    });

    it('should return undefined when no sources', () => {
      const p = parseCspHeader('report-uri /report');
      const sources = getEffectiveSources(p, 'script-src');
      expect(sources).toBeUndefined();
    });
  });

  describe('isKnownDirective', () => {
    it('should recognize known directives', () => {
      expect(isKnownDirective('script-src')).toBe(true);
      expect(isKnownDirective('style-src')).toBe(true);
      expect(isKnownDirective('img-src')).toBe(true);
      expect(isKnownDirective('connect-src')).toBe(true);
      expect(isKnownDirective('font-src')).toBe(true);
      expect(isKnownDirective('object-src')).toBe(true);
      expect(isKnownDirective('media-src')).toBe(true);
      expect(isKnownDirective('frame-src')).toBe(true);
      expect(isKnownDirective('child-src')).toBe(true);
      expect(isKnownDirective('worker-src')).toBe(true);
      expect(isKnownDirective('manifest-src')).toBe(true);
      expect(isKnownDirective('form-action')).toBe(true);
      expect(isKnownDirective('frame-ancestors')).toBe(true);
      expect(isKnownDirective('base-uri')).toBe(true);
      expect(isKnownDirective('sandbox')).toBe(true);
      expect(isKnownDirective('report-uri')).toBe(true);
      expect(isKnownDirective('upgrade-insecure-requests')).toBe(true);
    });

    it('should not recognize unknown directives', () => {
      expect(isKnownDirective('unknown-directive')).toBe(false);
      expect(isKnownDirective('')).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Evaluator tests
// ─────────────────────────────────────────────────────────────────────────────

import {
  evaluateCsp,
  evaluateCspAllDirectives,
  matchHost,
  matchCidr,
  extractOrigin,
} from '../src/browser/security/csp-evaluator';

describe('CspEvaluator', () => {
  const httpsOrigin = 'https://example.com';

  describe('matchHost', () => {
    it('should match exact host', () => {
      expect(matchHost('example.com', 'example.com')).toBe(true);
    });

    it('should not match different host', () => {
      expect(matchHost('example.com', 'other.com')).toBe(false);
    });

    it('should match subdomain via wildcard', () => {
      expect(matchHost('*.example.com', 'sub.example.com')).toBe(true);
      expect(matchHost('*.example.com', 'deep.sub.example.com')).toBe(true);
    });

    it('should match base domain with wildcard', () => {
      expect(matchHost('*.example.com', 'example.com')).toBe(true);
    });

    it('should match subdomain implicitly', () => {
      expect(matchHost('example.com', 'sub.example.com')).toBe(true);
    });

    it('should not match unrelated domain', () => {
      expect(matchHost('example.com', 'other.com')).toBe(false);
    });
  });

  describe('matchCidr', () => {
    it('should match IP in CIDR range', () => {
      expect(matchCidr('192.168.0.0', 16, '192.168.1.1')).toBe(true);
      expect(matchCidr('192.168.0.0', 16, '192.168.255.255')).toBe(true);
    });

    it('should not match IP outside CIDR range', () => {
      expect(matchCidr('192.168.0.0', 16, '192.169.1.1')).toBe(false);
    });

    it('should match /32 CIDR exactly', () => {
      expect(matchCidr('10.0.0.1', 32, '10.0.0.1')).toBe(true);
      expect(matchCidr('10.0.0.1', 32, '10.0.0.2')).toBe(false);
    });

    it('should match /0 CIDR (all)', () => {
      expect(matchCidr('0.0.0.0', 0, '192.168.1.1')).toBe(true);
    });
  });

  describe('extractOrigin', () => {
    it('should extract origin from URL', () => {
      expect(extractOrigin('https://example.com/path')).toBe('https://example.com');
    });

    it('should return empty for invalid URL', () => {
      expect(extractOrigin('not-a-url')).toBe('');
    });
  });

  describe('evaluateCsp', () => {
    it('should allow when no CSP policy', () => {
      const p = parseCspHeader('');
      const r = evaluateCsp(p, 'script-src', 'https://example.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it("should block when 'none' is the only source", () => {
      const p = parseCspHeader("script-src 'none'");
      const r = evaluateCsp(p, 'script-src', 'https://example.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });

    it("should allow 'self' for same-origin URLs", () => {
      const p = parseCspHeader("script-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'https://example.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
      expect(r.isSelfMatch).toBe(true);
    });

    it("should block 'self' for cross-origin URLs", () => {
      const p = parseCspHeader("script-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'https://other.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });

    it("should allow 'unsafe-inline' for inline scripts", () => {
      const p = parseCspHeader("script-src 'unsafe-inline'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
      });
      expect(r.allowed).toBe(true);
    });

    it("should block inline scripts without 'unsafe-inline'", () => {
      const p = parseCspHeader("script-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
      });
      expect(r.allowed).toBe(false);
    });

    it("should allow 'unsafe-eval' for eval()", () => {
      const p = parseCspHeader("script-src 'unsafe-eval'");
      const r = evaluateCsp(p, 'script-src', 'eval', {
        pageOrigin: 'https://example.com',
        isEval: true,
      });
      expect(r.allowed).toBe(true);
    });

    it("should block eval() without 'unsafe-eval'", () => {
      const p = parseCspHeader("script-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'eval', {
        pageOrigin: 'https://example.com',
        isEval: true,
      });
      expect(r.allowed).toBe(false);
    });

    it('should allow matching host source', () => {
      const p = parseCspHeader("script-src https://cdn.example.com");
      const r = evaluateCsp(p, 'script-src', 'https://cdn.example.com/app.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it('should block non-matching host source', () => {
      const p = parseCspHeader("script-src https://cdn.example.com");
      const r = evaluateCsp(p, 'script-src', 'https://evil.com/app.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });

    it('should allow scheme source', () => {
      const p = parseCspHeader('img-src https:');
      const r = evaluateCsp(p, 'img-src', 'https://example.com/image.png', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it('should block wrong scheme', () => {
      const p = parseCspHeader('img-src https:');
      const r = evaluateCsp(p, 'img-src', 'http://example.com/image.png', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });

    it('should allow wildcard', () => {
      const p = parseCspHeader("script-src *");
      const r = evaluateCsp(p, 'script-src', 'https://anything.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it("should allow matching nonce for inline script", () => {
      const p = parseCspHeader("script-src 'nonce-abc123'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
        nonce: 'abc123',
      });
      expect(r.allowed).toBe(true);
    });

    it("should block wrong nonce for inline script", () => {
      const p = parseCspHeader("script-src 'nonce-abc123'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
        nonce: 'wrong-nonce',
      });
      expect(r.allowed).toBe(false);
    });

    it("should allow matching hash for inline script", () => {
      const p = parseCspHeader("script-src 'sha256-abc123'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
        hash: 'abc123',
      });
      expect(r.allowed).toBe(true);
    });

    it("should block wrong hash for inline script", () => {
      const p = parseCspHeader("script-src 'sha256-abc123'");
      const r = evaluateCsp(p, 'script-src', 'inline-script', {
        pageOrigin: 'https://example.com',
        isInline: true,
        hash: 'wrong-hash',
      });
      expect(r.allowed).toBe(false);
    });

    it('should fall back to default-src', () => {
      const p = parseCspHeader("default-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'https://other.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });

    it('should check directive-specific before default-src', () => {
      const p = parseCspHeader("default-src 'none'; script-src 'self'");
      const r = evaluateCsp(p, 'script-src', 'https://example.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it('should allow host with wildcard subdomain', () => {
      const p = parseCspHeader("img-src *.example.com");
      const r = evaluateCsp(p, 'img-src', 'https://cdn.example.com/image.png', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it('should allow data: scheme for img-src', () => {
      const p = parseCspHeader('img-src data:');
      const r = evaluateCsp(p, 'img-src', 'data:image/png;base64,abc', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(true);
    });

    it('should block data: when only https: allowed', () => {
      const p = parseCspHeader('img-src https:');
      const r = evaluateCsp(p, 'img-src', 'data:image/png;base64,abc', {
        pageOrigin: 'https://example.com',
      });
      expect(r.allowed).toBe(false);
    });
  });

  describe('evaluateCspAllDirectives', () => {
    it('should check multiple directives', () => {
      const p = parseCspHeader(
        "script-src 'self'; style-src 'self'; img-src 'self'",
      );
      const results = evaluateCspAllDirectives(p, 'https://other.com/script.js', {
        pageOrigin: 'https://example.com',
      });
      expect(results.length).toBeGreaterThanOrEqual(3);
      // All should be blocked since other.com != example.com.
      expect(results.every(r => !r.allowed)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Policy Store tests
// ─────────────────────────────────────────────────────────────────────────────

import {
  CspPolicyStore,
} from '../src/browser/security/csp-policy-store';

describe('CspPolicyStore', () => {
  let store: CspPolicyStore;

  beforeEach(() => {
    store = new CspPolicyStore({ maxEntries: 100, defaultTtlMs: 0 });
  });

  afterEach(() => {
    store.dispose();
  });

  it('should store and retrieve a policy', () => {
    const policy = parseCspHeader("script-src 'self'");
    store.store('https://example.com', policy);
    const retrieved = store.get('https://example.com');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.enforcePolicy.directives.has('script-src')).toBe(true);
  });

  it('should return null for unknown origin', () => {
    expect(store.get('https://unknown.com')).toBeNull();
  });

  it('should store from raw headers', () => {
    store.storeFromHeaders('https://example.com', ["script-src 'self'"]);
    const retrieved = store.get('https://example.com');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.enforcePolicy.directives.has('script-src')).toBe(true);
  });

  it('should store report-only policy', () => {
    const enforce = parseCspHeader("script-src 'self'");
    const reportOnly = parseCspHeader("script-src 'self' 'unsafe-inline'");
    store.store('https://example.com', enforce, reportOnly);
    const entry = store.get('https://example.com');
    expect(entry!.reportOnlyPolicy).not.toBeNull();
  });

  it('should remove a policy', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    expect(store.remove('https://example.com')).toBe(true);
    expect(store.get('https://example.com')).toBeNull();
  });

  it('should report removal of non-existent origin', () => {
    expect(store.remove('https://unknown.com')).toBe(false);
  });

  it('should clear all policies', () => {
    store.store('https://a.com', parseCspHeader("script-src 'self'"));
    store.store('https://b.com', parseCspHeader("style-src 'self'"));
    store.clear();
    expect(store.size).toBe(0);
  });

  it('should report size', () => {
    expect(store.size).toBe(0);
    store.store('https://a.com', parseCspHeader("script-src 'self'"));
    expect(store.size).toBe(1);
  });

  it('should list origins', () => {
    store.store('https://a.com', parseCspHeader("script-src 'self'"));
    store.store('https://b.com', parseCspHeader("style-src 'self'"));
    const origins = store.getOrigins();
    expect(origins).toContain('https://a.com');
    expect(origins).toContain('https://b.com');
  });

  it('should evict LRU when at capacity', () => {
    const smallStore = new CspPolicyStore({ maxEntries: 3 });
    smallStore.store('https://a.com', parseCspHeader("script-src 'self'"));
    smallStore.store('https://b.com', parseCspHeader("script-src 'self'"));
    smallStore.store('https://c.com', parseCspHeader("script-src 'self'"));
    // Access a and b to make c the LRU.
    smallStore.get('https://a.com');
    smallStore.get('https://b.com');
    // Adding d should evict c.
    smallStore.store('https://d.com', parseCspHeader("script-src 'self'"));
    expect(smallStore.get('https://c.com')).toBeNull();
    smallStore.dispose();
  });

  it('should expire entries based on TTL', () => {
    const ttlStore = new CspPolicyStore({ defaultTtlMs: 1 });
    ttlStore.store('https://example.com', parseCspHeader("script-src 'self'"));
    // Wait for TTL to expire.
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(ttlStore.get('https://example.com')).toBeNull();
        ttlStore.dispose();
        resolve();
      }, 10);
    });
  });

  it('should emit policyStored event', () => {
    const handler = vi.fn();
    store.on(handler);
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'policyStored', origin: 'https://example.com' }),
    );
  });

  it('should emit policyRemoved event', () => {
    const handler = vi.fn();
    store.on(handler);
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    store.remove('https://example.com');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'policyRemoved', origin: 'https://example.com' }),
    );
  });

  it('should not throw on handler error', () => {
    const badHandler = vi.fn(() => { throw new Error('handler error'); });
    store.on(badHandler);
    expect(() => store.store('https://example.com', parseCspHeader("script-src 'self'"))).not.toThrow();
  });

  it('should getEnforcePolicy', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const policy = store.getEnforcePolicy('https://example.com');
    expect(policy).not.toBeNull();
    expect(policy!.directives.has('script-src')).toBe(true);
  });

  it('should getReportOnlyPolicy', () => {
    const reportOnly = parseCspHeader("script-src 'self' 'unsafe-inline'");
    store.store('https://example.com', parseCspHeader("script-src 'self'"), reportOnly);
    const policy = store.getReportOnlyPolicy('https://example.com');
    expect(policy).not.toBeNull();
  });

  it('should check hasPolicy', () => {
    expect(store.hasPolicy('https://example.com')).toBe(false);
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    expect(store.hasPolicy('https://example.com')).toBe(true);
  });

  it('should throw when disposed', () => {
    store.dispose();
    expect(() => store.store('https://example.com', parseCspHeader("script-src 'self'"))).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Reporter tests
// ─────────────────────────────────────────────────────────────────────────────

import {
  CspReporter,
  buildViolationReport,
  serializeReport,
  ReportRateLimiter,
} from '../src/browser/security/csp-reporter';

describe('CspReporter', () => {
  describe('buildViolationReport', () => {
    it('should build a violation report', () => {
      const policy = parseCspHeader("script-src 'self'");
      const result: import('../src/browser/security/csp-evaluator').CspEvaluationResult = {
        allowed: false,
        directive: 'script-src',
        isSelfMatch: false,
        reportOnly: false,
        url: 'https://evil.com/script.js',
      };
      const report = buildViolationReport(result, {
        documentUri: 'https://example.com',
        policy,
        disposition: 'enforce',
      });
      expect(report.documentUri).toBe('https://example.com');
      expect(report.effectiveDirective).toBe('script-src');
      expect(report.blockedUri).toBe('https://evil.com/script.js');
      expect(report.disposition).toBe('enforce');
    });

    it('should include source file info', () => {
      const policy = parseCspHeader("script-src 'self'");
      const result: import('../src/browser/security/csp-evaluator').CspEvaluationResult = {
        allowed: false,
        directive: 'script-src',
        isSelfMatch: false,
        reportOnly: false,
        url: 'https://evil.com/script.js',
      };
      const report = buildViolationReport(result, {
        documentUri: 'https://example.com',
        sourceFile: 'https://example.com/app.js',
        lineNumber: 42,
        columnNumber: 10,
        policy,
        disposition: 'enforce',
      });
      expect(report.sourceFile).toBe('https://example.com/app.js');
      expect(report.lineNumber).toBe(42);
      expect(report.columnNumber).toBe(10);
    });
  });

  describe('serializeReport', () => {
    it('should serialize to JSON', () => {
      const policy = parseCspHeader("script-src 'self'");
      const report = buildViolationReport(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'https://evil.com/script.js',
        },
        {
          documentUri: 'https://example.com',
          policy,
          disposition: 'enforce',
        },
      );
      const json = serializeReport(report);
      const parsed = JSON.parse(json);
      expect(parsed['csp-report']).toBeDefined();
      expect(parsed['csp-report']['document-uri']).toBe('https://example.com');
      expect(parsed['csp-report']['blocked-uri']).toBe('https://evil.com/script.js');
      expect(parsed['csp-report']['disposition']).toBe('enforce');
    });

    it('should include optional fields when present', () => {
      const policy = parseCspHeader("script-src 'self'");
      const report = buildViolationReport(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'inline-script',
        },
        {
          documentUri: 'https://example.com',
          sourceFile: 'app.js',
          lineNumber: 1,
          scriptSample: 'console.log("evil")',
          policy,
          disposition: 'enforce',
        },
      );
      const json = serializeReport(report);
      const parsed = JSON.parse(json);
      expect(parsed['csp-report']['source-file']).toBe('app.js');
      expect(parsed['csp-report']['line-number']).toBe(1);
      expect(parsed['csp-report']['script-sample']).toBe('console.log("evil")');
    });
  });

  describe('ReportRateLimiter', () => {
    it('should allow submissions within limit', () => {
      const limiter = new ReportRateLimiter(5);
      expect(limiter.canSubmit('endpoint')).toBe(true);
      limiter.record('endpoint');
      limiter.record('endpoint');
      expect(limiter.canSubmit('endpoint')).toBe(true);
    });

    it('should block submissions over limit', () => {
      const limiter = new ReportRateLimiter(2);
      limiter.record('endpoint');
      limiter.record('endpoint');
      expect(limiter.canSubmit('endpoint')).toBe(false);
    });

    it('should track per-endpoint limits', () => {
      const limiter = new ReportRateLimiter(1);
      limiter.record('endpoint-a');
      expect(limiter.canSubmit('endpoint-a')).toBe(false);
      expect(limiter.canSubmit('endpoint-b')).toBe(true);
    });

    it('should reset', () => {
      const limiter = new ReportRateLimiter(1);
      limiter.record('endpoint');
      limiter.reset();
      expect(limiter.canSubmit('endpoint')).toBe(true);
    });
  });

  describe('CspReporter class', () => {
    let reporter: CspReporter;

    beforeEach(() => {
      reporter = new CspReporter({ maxBufferSize: 100, enableBatching: false });
    });

    afterEach(() => {
      reporter.dispose();
    });

    it('should record violations', () => {
      const policy = parseCspHeader("script-src 'self'");
      reporter.reportViolation(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'https://evil.com/script.js',
        },
        {
          documentUri: 'https://example.com',
          policy,
        },
      );
      expect(reporter.getViolationCount()).toBe(1);
    });

    it('should emit violationDetected event', () => {
      const handler = vi.fn();
      reporter.on(handler);
      const policy = parseCspHeader("script-src 'self'");
      reporter.reportViolation(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'https://evil.com/script.js',
        },
        {
          documentUri: 'https://example.com',
          policy,
        },
      );
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'violationDetected' }),
      );
    });

    it('should clear violations', () => {
      const policy = parseCspHeader("script-src 'self'");
      reporter.reportViolation(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'https://evil.com/script.js',
        },
        {
          documentUri: 'https://example.com',
          policy,
        },
      );
      reporter.clearViolations();
      expect(reporter.getViolationCount()).toBe(0);
    });

    it('should drop reports when buffer is full', () => {
      const smallReporter = new CspReporter({ maxBufferSize: 2, enableBatching: false });
      const handler = vi.fn();
      smallReporter.on(handler);
      const policy = parseCspHeader("script-src 'self'");
      for (let i = 0; i < 3; i++) {
        smallReporter.reportViolation(
          {
            allowed: false,
            directive: 'script-src',
            isSelfMatch: false,
            reportOnly: false,
            url: `https://evil${i}.com/script.js`,
          },
          {
            documentUri: 'https://example.com',
            policy,
          },
        );
      }
      expect(smallReporter.getViolationCount()).toBe(2);
      const droppedEvents = handler.mock.calls.filter(
        (c: unknown[]) => (c[0] as { kind: string }).kind === 'reportDropped',
      );
      expect(droppedEvents.length).toBe(1);
      smallReporter.dispose();
    });

    it('should not record after dispose', () => {
      reporter.dispose();
      const policy = parseCspHeader("script-src 'self'");
      reporter.reportViolation(
        {
          allowed: false,
          directive: 'script-src',
          isSelfMatch: false,
          reportOnly: false,
          url: 'https://evil.com/script.js',
        },
        {
          documentUri: 'https://example.com',
          policy,
        },
      );
      expect(reporter.getViolationCount()).toBe(0);
    });

    it('should not throw on handler error', () => {
      const badHandler = vi.fn(() => { throw new Error('handler error'); });
      reporter.on(badHandler);
      const policy = parseCspHeader("script-src 'self'");
      expect(() => {
        reporter.reportViolation(
          {
            allowed: false,
            directive: 'script-src',
            isSelfMatch: false,
            reportOnly: false,
            url: 'https://evil.com/script.js',
          },
          {
            documentUri: 'https://example.com',
            policy,
          },
        );
      }).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Navigation Guard tests
// ─────────────────────────────────────────────────────────────────────────────

import { CspNavigationGuard } from '../src/browser/security/csp-navigation-guard';

describe('CspNavigationGuard', () => {
  let store: CspPolicyStore;
  let guard: CspNavigationGuard;

  beforeEach(() => {
    store = new CspPolicyStore();
    guard = new CspNavigationGuard(store);
  });

  afterEach(() => {
    store.dispose();
  });

  it('should allow navigation when no CSP policy', async () => {
    const result = guard.checkNavigation({
      url: 'https://example.com/page',
      type: 'push',
      userInitiated: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('should block navigation when form-action restricts', () => {
    store.store('https://example.com', parseCspHeader("form-action 'self'"));
    const result = guard.checkNavigation({
      url: 'https://other.com/submit',
      type: 'form-submit',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('should allow same-origin form submission', () => {
    store.store('https://example.com', parseCspHeader("form-action 'self'"));
    const result = guard.checkNavigation({
      url: 'https://example.com/submit',
      type: 'form-submit',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('should block frame-src navigation', () => {
    store.store('https://example.com', parseCspHeader("frame-src 'self'"));
    const result = guard.checkNavigation({
      url: 'https://other.com/frame',
      type: 'iframe-navigate',
      documentOrigin: 'https://example.com',
      userInitiated: false,
    });
    expect(result.allowed).toBe(false);
  });

  it('should upgrade insecure requests', () => {
    store.store('https://example.com', parseCspHeader("default-src 'self'; upgrade-insecure-requests"));
    const result = guard.checkNavigation({
      url: 'http://example.com/page',
      type: 'push',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.upgradedUrl).toBe('https://example.com/page');
  });

  it('should check canNavigate (async interface)', async () => {
    store.store('https://example.com', parseCspHeader("form-action 'self'"));
    const allowed = await guard.canNavigate({
      url: 'https://other.com/submit',
      type: 'form-submit',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    expect(allowed).toBe(false);
  });

  it('should check frame-ancestors', () => {
    store.store('https://embed.com', parseCspHeader("frame-ancestors 'self'"));
    const result = guard.checkFrameAncestors(
      'https://embed.com/content',
      ['https://example.com'],
      'https://embed.com',
    );
    expect(result.allowed).toBe(false);
  });

  it('should allow frame-ancestors with matching origin', () => {
    store.store('https://embed.com', parseCspHeader("frame-ancestors 'self'"));
    const result = guard.checkFrameAncestors(
      'https://embed.com/content',
      ['https://embed.com'],
      'https://embed.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should check base-uri', () => {
    store.store('https://example.com', parseCspHeader("base-uri 'self'"));
    const result = guard.checkBaseUri(
      'https://example.com/page',
      'https://evil.com/base',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
  });

  it('should allow same-origin base-uri', () => {
    store.store('https://example.com', parseCspHeader("base-uri 'self'"));
    const result = guard.checkBaseUri(
      'https://example.com/page',
      'https://example.com/base',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should track violations', () => {
    store.store('https://example.com', parseCspHeader("form-action 'self'"));
    guard.checkNavigation({
      url: 'https://other.com/submit',
      type: 'form-submit',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    expect(guard.getViolations().length).toBe(1);
  });

  it('should clear violations', () => {
    store.store('https://example.com', parseCspHeader("form-action 'self'"));
    guard.checkNavigation({
      url: 'https://other.com/submit',
      type: 'form-submit',
      documentOrigin: 'https://example.com',
      userInitiated: true,
    });
    guard.clearViolations();
    expect(guard.getViolations().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Resource Enforcer tests
// ─────────────────────────────────────────────────────────────────────────────

import { CspResourceEnforcer } from '../src/browser/security/csp-resource-enforcer';

describe('CspResourceEnforcer', () => {
  let store: CspPolicyStore;
  let enforcer: CspResourceEnforcer;

  beforeEach(() => {
    store = new CspPolicyStore();
    enforcer = new CspResourceEnforcer(store);
  });

  afterEach(() => {
    store.dispose();
  });

  it('should allow when no CSP policy', () => {
    const result = enforcer.checkFetch('https://api.com/data', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block connect-src violation', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'"));
    const result = enforcer.checkFetch('https://api.com/data', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
    expect(result.directive).toBe('connect-src');
  });

  it('should allow same-origin fetch', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'"));
    const result = enforcer.checkFetch('https://example.com/api', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block img-src violation', () => {
    store.store('https://example.com', parseCspHeader("img-src 'self'"));
    const result = enforcer.checkImage('https://cdn.com/image.png', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
    expect(result.directive).toBe('img-src');
  });

  it('should allow same-origin image', () => {
    store.store('https://example.com', parseCspHeader("img-src 'self'"));
    const result = enforcer.checkImage('https://example.com/logo.png', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block font-src violation', () => {
    store.store('https://example.com', parseCspHeader("font-src 'self'"));
    const result = enforcer.checkFont('https://fonts.com/font.woff', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
    expect(result.directive).toBe('font-src');
  });

  it('should block style-src violation', () => {
    store.store('https://example.com', parseCspHeader("style-src 'self'"));
    const result = enforcer.checkStyle('https://cdn.com/style.css', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
    expect(result.directive).toBe('style-src');
  });

  it('should check WebSocket via connect-src', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'"));
    const result = enforcer.checkWebSocket('wss://ws.com', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
  });

  it('should allow matching host source', () => {
    store.store('https://example.com', parseCspHeader("img-src https://cdn.example.com"));
    const result = enforcer.checkImage('https://cdn.example.com/img.png', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should batch check resources', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'; img-src 'self'"));
    const results = enforcer.checkResources([
      { url: 'https://api.com/data', resourceType: 'connect', pageOrigin: 'https://example.com', documentOrigin: 'https://example.com' },
      { url: 'https://cdn.com/img.png', resourceType: 'image', pageOrigin: 'https://example.com', documentOrigin: 'https://example.com' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]!.allowed).toBe(false);
    expect(results[1]!.allowed).toBe(false);
  });

  it('should track violations', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'"));
    enforcer.checkFetch('https://api.com/data', 'https://example.com', 'https://example.com');
    expect(enforcer.getViolations().length).toBe(1);
  });

  it('should clear violations', () => {
    store.store('https://example.com', parseCspHeader("connect-src 'self'"));
    enforcer.checkFetch('https://api.com/data', 'https://example.com', 'https://example.com');
    enforcer.clearViolations();
    expect(enforcer.getViolations().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Script Enforcer tests
// ─────────────────────────────────────────────────────────────────────────────

import { CspScriptEnforcer } from '../src/browser/security/csp-script-enforcer';

describe('CspScriptEnforcer', () => {
  let store: CspPolicyStore;
  let enforcer: CspScriptEnforcer;

  beforeEach(() => {
    store = new CspPolicyStore();
    enforcer = new CspScriptEnforcer(store);
  });

  afterEach(() => {
    store.dispose();
  });

  it('should allow when no CSP policy', () => {
    const result = enforcer.checkExternalScript(
      'https://example.com/app.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should block external script not in source list', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkExternalScript(
      'https://cdn.com/app.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('external');
  });

  it('should allow same-origin external script', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkExternalScript(
      'https://example.com/app.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should block inline script without unsafe-inline', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkInlineScript(
      'console.log("hello")',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('inline');
  });

  it('should allow inline script with unsafe-inline', () => {
    store.store('https://example.com', parseCspHeader("script-src 'unsafe-inline'"));
    const result = enforcer.checkInlineScript(
      'console.log("hello")',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should allow inline script with matching nonce', () => {
    store.store('https://example.com', parseCspHeader("script-src 'nonce-abc123'"));
    const result = enforcer.checkInlineScript(
      'console.log("hello")',
      'https://example.com',
      'https://example.com',
      'abc123',
    );
    expect(result.allowed).toBe(true);
  });

  it('should block inline script with wrong nonce', () => {
    store.store('https://example.com', parseCspHeader("script-src 'nonce-abc123'"));
    const result = enforcer.checkInlineScript(
      'console.log("hello")',
      'https://example.com',
      'https://example.com',
      'wrong',
    );
    expect(result.allowed).toBe(false);
  });

  it('should block eval() without unsafe-eval', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkEval(
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('eval');
  });

  it('should allow eval() with unsafe-eval', () => {
    store.store('https://example.com', parseCspHeader("script-src 'unsafe-eval'"));
    const result = enforcer.checkEval(
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should block new Function() without unsafe-eval', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkNewFunction(
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('new-function');
  });

  it('should block timer with string argument', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkTimerString(
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('timer-string');
  });

  it('should allow timer with string when unsafe-inline', () => {
    store.store('https://example.com', parseCspHeader("script-src 'unsafe-inline'"));
    const result = enforcer.checkTimerString(
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should block javascript: URL', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkJavascriptUri(
      'javascript:alert(1)',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('javascript-uri');
  });

  it('should check worker URL', () => {
    store.store('https://example.com', parseCspHeader("worker-src 'self'"));
    const result = enforcer.checkWorker(
      'https://cdn.com/worker.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('worker');
  });

  it('should allow same-origin worker', () => {
    store.store('https://example.com', parseCspHeader("worker-src 'self'"));
    const result = enforcer.checkWorker(
      'https://example.com/worker.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should check module script', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkExternalScript(
      'https://cdn.com/module.js',
      'https://example.com',
      'https://example.com',
      true,
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('module');
  });

  it('should check dynamic import', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    const result = enforcer.checkDynamicImport(
      'https://cdn.com/module.js',
      'https://example.com',
      'https://example.com',
    );
    expect(result.allowed).toBe(false);
    expect(result.scriptType).toBe('dynamic-import');
  });

  it('should track violations', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    enforcer.checkExternalScript('https://cdn.com/app.js', 'https://example.com', 'https://example.com');
    expect(enforcer.getViolations().length).toBe(1);
  });

  it('should clear violations', () => {
    store.store('https://example.com', parseCspHeader("script-src 'self'"));
    enforcer.checkExternalScript('https://cdn.com/app.js', 'https://example.com', 'https://example.com');
    enforcer.clearViolations();
    expect(enforcer.getViolations().length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSP Sandbox Enforcer tests
// ─────────────────────────────────────────────────────────────────────────────

import { CspSandboxEnforcer } from '../src/browser/security/csp-sandbox-enforcer';
import { FULLY_SANDBOXED, UNSANDBOXED } from '../src/browser/security/csp-sandbox-enforcer';

describe('CspSandboxEnforcer', () => {
  let store: CspPolicyStore;
  let enforcer: CspSandboxEnforcer;

  beforeEach(() => {
    store = new CspPolicyStore();
    enforcer = new CspSandboxEnforcer(store);
  });

  afterEach(() => {
    store.dispose();
  });

  it('should return unrestricted when no CSP policy', () => {
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(false);
    expect(result.permissions.allowScripts).toBe(true);
    expect(result.permissions.allowForms).toBe(true);
  });

  it('should sandbox with empty sandbox token', () => {
    store.store('https://example.com', parseCspHeader('sandbox'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(true);
    expect(result.permissions.allowScripts).toBe(false);
    expect(result.permissions.allowForms).toBe(false);
    expect(result.permissions.allowSameOrigin).toBe(false);
  });

  it('should allow scripts with allow-scripts', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-scripts'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(true);
    expect(result.permissions.allowScripts).toBe(true);
    expect(result.permissions.allowForms).toBe(false);
  });

  it('should allow forms with allow-forms', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-forms'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(true);
    expect(result.permissions.allowForms).toBe(true);
    expect(result.permissions.allowScripts).toBe(false);
  });

  it('should allow same-origin with allow-same-origin', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-same-origin'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(true);
    expect(result.permissions.allowSameOrigin).toBe(true);
  });

  it('should allow top navigation with allow-top-navigation', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-top-navigation'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.isSandboxed).toBe(true);
    expect(result.permissions.allowTopNavigation).toBe(true);
    expect(result.topNavigationBlocked).toBe(false);
  });

  it('should block top navigation without allow-top-navigation', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-scripts'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.topNavigationBlocked).toBe(true);
  });

  it('should allow popups with allow-popups', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-popups'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.permissions.allowPopups).toBe(true);
  });

  it('should allow modals with allow-modals', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-modals'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.permissions.allowModals).toBe(true);
  });

  it('should allow pointer-lock with allow-pointer-lock', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-pointer-lock'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.permissions.allowPointerLock).toBe(true);
  });

  it('should allow orientation-lock with allow-orientation-lock', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-orientation-lock'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.permissions.allowOrientationLock).toBe(true);
  });

  it('should allow presentation with allow-presentation', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-presentation'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.permissions.allowPresentation).toBe(true);
  });

  it('should check action convenience methods', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-scripts'));
    expect(enforcer.areScriptsAllowed('https://frame.com', 'https://example.com')).toBe(true);
    expect(enforcer.areFormsAllowed('https://frame.com', 'https://example.com')).toBe(false);
    expect(enforcer.isTopNavigationAllowed('https://frame.com', 'https://example.com')).toBe(false);
    expect(enforcer.arePopupsAllowed('https://frame.com', 'https://example.com')).toBe(false);
  });

  it('should intersect permissions', () => {
    const a = { ...FULLY_SANDBOXED, allowScripts: true, allowForms: true };
    const b = { ...FULLY_SANDBOXED, allowScripts: true, allowForms: false };
    const result = CspSandboxEnforcer.intersectPermissions(a, b);
    expect(result.allowScripts).toBe(true);
    expect(result.allowForms).toBe(false);
  });

  it('should get fully sandboxed', () => {
    const p = CspSandboxEnforcer.getFullySandboxed();
    expect(p.allowScripts).toBe(false);
    expect(p.allowForms).toBe(false);
    expect(p.allowModals).toBe(false);
    expect(p.allowPopups).toBe(false);
    expect(p.allowSameOrigin).toBe(false);
    expect(p.allowTopNavigation).toBe(false);
  });

  it('should get unsandboxed', () => {
    const p = CspSandboxEnforcer.getUnsandboxed();
    expect(p.allowScripts).toBe(true);
    expect(p.allowForms).toBe(true);
    expect(p.allowModals).toBe(true);
    expect(p.allowPopups).toBe(true);
    expect(p.allowSameOrigin).toBe(true);
    expect(p.allowTopNavigation).toBe(true);
  });

  it('should return active flags', () => {
    store.store('https://example.com', parseCspHeader('sandbox allow-scripts allow-forms'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.activeFlags).toContain('allow-scripts');
    expect(result.activeFlags).toContain('allow-forms');
  });

  it('should return policy reference', () => {
    store.store('https://example.com', parseCspHeader('sandbox'));
    const result = enforcer.resolveSandboxPermissions('https://frame.com', 'https://example.com');
    expect(result.policy).not.toBeNull();
    expect(result.policy!.hasSandbox).toBe(true);
  });
});
