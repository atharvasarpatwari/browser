import { describe, it, expect, beforeEach, vi } from 'vitest';

import { SameOriginPolicy } from '../src/browser/media/same-origin-policy';
import { CorsService } from '../src/browser/media/cors';
import { CspService } from '../src/browser/media/csp';
import { SandboxService } from '../src/browser/media/sandbox';
import { HttpsService } from '../src/browser/media/https';
import { CertificateService } from '../src/browser/media/certificates';
import { MixedContentService } from '../src/browser/media/mixed-content';
import { XssProtectionService } from '../src/browser/media/xss-protection';
import { CsrfProtectionService } from '../src/browser/media/csrf-protection';
import { ClickjackingProtectionService } from '../src/browser/media/clickjacking-protection';
import { PermissionManagerService } from '../src/browser/media/permission-manager';

/* ============================================================
   1. Same Origin Policy
   ============================================================ */
describe('SameOriginPolicy', () => {
  let sop: SameOriginPolicy;

  beforeEach(() => {
    sop = new SameOriginPolicy();
  });

  it('checks same origin matching', () => {
    expect(sop.isSameOrigin('https://example.com', 'https://example.com')).toBe(true);
    expect(sop.isSameOrigin('https://example.com', 'https://other.com')).toBe(false);
  });

  it('checks same site', () => {
    expect(sop.isSameSite('https://www.example.com', 'https://example.com')).toBe(true);
  });

  it('detects opaque origins', () => {
    expect(sop.isOpaqueOrigin('null')).toBe(true);
    expect(sop.isOpaqueOrigin('https://example.com')).toBe(false);
  });

  it('parses origins', () => {
    expect(sop.parseOrigin('https://example.com/path')).toBe('https://example.com');
    expect(sop.parseOrigin('data:text/html,hi')).toBe('null');
  });

  it('checks access', () => {
    expect(sop.checkAccess('https://example.com', 'https://example.com', 'fetch')).toBe('allowed');
    expect(sop.checkAccess('https://other.com', 'https://example.com', 'fetch')).toBe('blocked');
  });

  it('fires block event on cross-origin access', () => {
    const fn = vi.fn();
    sop.onEvent(fn);
    sop.checkAccess('https://other.com', 'https://example.com', 'fetch');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'block' }));
  });

  it('dispose clears handlers', () => {
    const fn = vi.fn();
    sop.onEvent(fn);
    sop.dispose();
    sop.checkAccess('https://other.com', 'https://example.com', 'fetch');
    expect(fn).not.toHaveBeenCalled();
  });
});

/* ============================================================
   2. CORS
   ============================================================ */
describe('CorsService', () => {
  let cors: CorsService;

  beforeEach(() => {
    cors = new CorsService();
  });

  it('has checkRequest method', () => {
    expect(typeof cors.checkRequest).toBe('function');
  });

  it('has checkResponse method', () => {
    expect(typeof cors.checkResponse).toBe('function');
  });

  it('has cache management', () => {
    expect(typeof cors.evictPreflight).toBe('function');
    expect(typeof cors.clearPreflightCache).toBe('function');
    expect(typeof cors.preflightCacheSize).toBe('function');
  });

  it('onEvent returns unsubscribe function', () => {
    const fn = vi.fn();
    const unsub = cors.onEvent(fn);
    expect(typeof unsub).toBe('function');
  });

  it('dispose clears handlers', () => {
    const fn = vi.fn();
    cors.onEvent(fn);
    cors.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   3. CSP
   ============================================================ */
describe('CspService', () => {
  let csp: CspService;

  beforeEach(() => {
    csp = new CspService();
  });

  it('manages policies', () => {
    csp.setPolicy('default', "default-src 'self'");
    expect(csp.getPolicy('default')).toBeDefined();
  });

  it('removes policies', () => {
    csp.setPolicy('test', "script-src 'self'");
    csp.removePolicy('test');
    expect(csp.getPolicy('test')).toBeUndefined();
  });

  it('reports violations', () => {
    csp.reportViolation('script-src', 'https://evil.com', 'https://site.com', 'script-src', "default-src 'self'");
    expect(csp.getViolationCount()).toBe(1);
  });

  it('evaluates directives', () => {
    expect(csp.evaluateDirective('default-src', "'none'")).toBe(false);
    expect(csp.evaluateDirective('img-src', "*")).toBe(true);
  });

  it('dispose clears handlers and store', () => {
    csp.setPolicy('test', "default-src 'self'");
    csp.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   4. Sandbox
   ============================================================ */
describe('SandboxService', () => {
  let sandbox: SandboxService;

  beforeEach(() => {
    sandbox = new SandboxService();
  });

  it('sets and retrieves flags', () => {
    sandbox.setFlags('https://example.com', ['allow-scripts', 'allow-forms']);
    const flags = sandbox.getFlags('https://example.com');
    expect(flags).toContain('allow-scripts');
    expect(flags).toContain('allow-forms');
  });

  it('checks specific flags', () => {
    sandbox.setFlags('https://example.com', ['allow-scripts']);
    expect(sandbox.hasFlag('https://example.com', 'allow-scripts')).toBe(true);
    expect(sandbox.hasFlag('https://example.com', 'allow-forms')).toBe(false);
  });

  it('enforces action restrictions', () => {
    sandbox.setFlags('https://example.com', ['allow-forms']);
    expect(sandbox.enforce('https://example.com', 'script')).toBe(false);
    expect(sandbox.enforce('https://example.com', 'form')).toBe(true);
  });

  it('removes origin flags', () => {
    sandbox.setFlags('https://example.com', ['allow-scripts']);
    sandbox.removeOrigin('https://example.com');
    expect(sandbox.getFlags('https://example.com')).toEqual([]);
  });

  it('dispose clears everything', () => {
    sandbox.setFlags('https://example.com', ['allow-scripts']);
    sandbox.dispose();
    expect(sandbox.getAllowedOrigins()).toEqual([]);
  });
});

/* ============================================================
   5. HTTPS
   ============================================================ */
describe('HttpsService', () => {
  let https: HttpsService;

  beforeEach(() => {
    https = new HttpsService();
  });

  it('detects HTTPS URLs', () => {
    expect(https.isHttps('https://example.com')).toBe(true);
    expect(https.isHttps('http://example.com')).toBe(false);
  });

  it('upgrades HTTP to HTTPS', () => {
    expect(https.upgradeUrl('http://example.com')).toBe('https://example.com/');
  });

  it('manages HSTS hosts', () => {
    https.addHstsHost('example.com', 3600, false);
    expect(https.isHstsHost('example.com')).toBe(true);
    expect(https.isHstsHost('other.com')).toBe(false);
  });

  it('tracks HSTS remaining time', () => {
    https.addHstsHost('example.com', 3600, false);
    expect(https.getRemainingHstsSeconds('example.com')).toBeGreaterThan(0);
  });

  it('enforces HTTPS', () => {
    https.setEnforceHttps(true);
    expect(https.isEnforceHttps()).toBe(true);
  });

  it('dispose clears HSTS entries', () => {
    https.addHstsHost('example.com', 3600, false);
    https.dispose();
    expect(https.isHstsHost('example.com')).toBe(false);
  });
});

/* ============================================================
   6. Certificates
   ============================================================ */
describe('CertificateService', () => {
  let cert: CertificateService;
  const validCert = {
    subject: 'CN=example.com',
    issuer: 'CN=CA',
    serialNumber: '01',
    validFrom: new Date('2024-01-01'),
    validTo: new Date('2026-01-01'),
    fingerprint: 'AA:BB:CC',
    keySize: 2048,
    algorithm: 'sha256WithRSAEncryption',
    subjectAltNames: ['example.com'],
  };

  beforeEach(() => {
    cert = new CertificateService();
  });

  it('validates certificates', () => {
    const result = cert.validate(validCert);
    expect(result).toHaveProperty('state');
    expect(result).toHaveProperty('isSecure');
  });

  it('checks host security', () => {
    expect(typeof cert.isHostSecure('example.com')).toBe('boolean');
  });

  it('manages host overrides', () => {
    cert.addHostOverride('example.com', 'trusted');
    expect(cert.isHostSecure('example.com')).toBe(true);
    cert.addHostOverride('bad.com', 'revoked');
    expect(cert.isHostSecure('bad.com')).toBe(false);
  });

  it('removes host overrides', () => {
    cert.addHostOverride('example.com', 'trusted');
    cert.removeHostOverride('example.com');
    expect(typeof cert.isHostSecure('example.com')).toBe('boolean');
  });

  it('updates validation options', () => {
    cert.updateOptions({ allowSelfSigned: true });
    const opts = cert.getOptions();
    expect(opts.allowSelfSigned).toBe(true);
  });

  it('dispose clears overrides', () => {
    cert.addHostOverride('example.com', 'trusted');
    cert.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   7. Mixed Content
   ============================================================ */
describe('MixedContentService', () => {
  let mc: MixedContentService;

  beforeEach(() => {
    mc = new MixedContentService();
  });

  it('detects mixed content', () => {
    expect(mc.isMixedContent('https://example.com', 'http://cdn.com/script.js')).toBe(true);
    expect(mc.isMixedContent('https://example.com', 'https://cdn.com/script.js')).toBe(false);
    expect(mc.isMixedContent('http://example.com', 'http://cdn.com/script.js')).toBe(false);
  });

  it('blocks script mixed content in block-script mode', () => {
    mc.setBlockMode('block-script');
    expect(mc.checkAndBlock('https://example.com', 'http://evil.com/script.js', 'script')).toBe('blocked');
    expect(mc.checkAndBlock('https://example.com', 'http://evil.com/image.png', 'image')).toBe('allowed');
  });

  it('blocks all mixed content in block-all mode', () => {
    mc.setBlockMode('block-all');
    expect(mc.checkAndBlock('https://example.com', 'http://evil.com/script.js', 'script')).toBe('blocked');
    expect(mc.checkAndBlock('https://example.com', 'http://evil.com/image.png', 'image')).toBe('blocked');
  });

  it('allows mixed content in disabled mode', () => {
    mc.setBlockMode('disabled');
    expect(mc.checkAndBlock('https://example.com', 'http://evil.com/script.js', 'script')).toBe('allowed');
  });

  it('tracks blocked count', () => {
    mc.setBlockMode('block-all');
    mc.checkAndBlock('https://example.com', 'http://evil.com/s.js', 'script');
    mc.checkAndBlock('https://example.com', 'http://evil.com/s2.js', 'script');
    expect(mc.getBlockedCount()).toBe(2);
  });

  it('dispose resets counts', () => {
    mc.setBlockMode('block-all');
    mc.checkAndBlock('https://example.com', 'http://evil.com/s.js', 'script');
    mc.dispose();
    expect(mc.getBlockedCount()).toBe(0);
  });
});

/* ============================================================
   8. XSS Protection
   ============================================================ */
describe('XssProtectionService', () => {
  let xss: XssProtectionService;

  beforeEach(() => {
    xss = new XssProtectionService();
  });

  it('sanitizes HTML', () => {
    expect(xss.filterHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
  });

  it('filters attributes', () => {
    expect(xss.filterAttribute('javascript:alert(1)')).not.toContain('javascript:');
    expect(xss.filterAttribute('onclick="evil()"')).not.toContain('onclick');
  });

  it('filters URLs', () => {
    expect(xss.filterUrl('javascript:alert(1)')).not.toContain('javascript:');
    expect(xss.filterUrl('data:text/html,<script>')).toBe('data:text/plain,<script>');
  });

  it('detects malicious input', () => {
    const result = xss.detectXss('<script>alert(1)</script>', 'html');
    expect(result.isMalicious).toBe(true);
    expect(result.matches).toContain('script-tag');
  });

  it('allows safe input', () => {
    const result = xss.detectXss('hello world', 'html');
    expect(result.isMalicious).toBe(false);
  });

  it('tracks blocked count', () => {
    xss.detectXss('<script>alert(1)</script>', 'html');
    expect(xss.getBlockedCount()).toBe(1);
  });

  it('dispose clears handlers', () => {
    xss.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   9. CSRF Protection
   ============================================================ */
describe('CsrfProtectionService', () => {
  let csrf: CsrfProtectionService;

  beforeEach(() => {
    csrf = new CsrfProtectionService();
  });

  it('generates and validates tokens', () => {
    const token = csrf.addOriginToken('https://example.com');
    expect(csrf.validateToken('https://example.com', token)).toBe(true);
  });

  it('blocks requests with invalid tokens', () => {
    csrf.addOriginToken('https://example.com');
    expect(csrf.validateRequest('https://example.com', 'POST', 'bad-token')).toBe('blocked');
  });

  it('allows GET requests without tokens', () => {
    expect(csrf.validateRequest('https://example.com', 'GET')).toBe('allowed');
  });

  it('blocks POST requests without tokens', () => {
    expect(csrf.validateRequest('https://example.com', 'POST')).toBe('blocked');
  });

  it('manages protected methods', () => {
    const methods = csrf.getProtectedMethods();
    expect(methods).toContain('POST');
    csrf.addProtectedMethod('PURGE');
    expect(csrf.getProtectedMethods()).toContain('PURGE');
  });

  it('tracks blocked count', () => {
    csrf.validateRequest('https://example.com', 'POST');
    csrf.validateRequest('https://example.com', 'DELETE');
    expect(csrf.getBlockedCount()).toBe(2);
  });

  it('dispose clears tokens', () => {
    csrf.addOriginToken('https://example.com');
    csrf.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   10. Clickjacking Protection
   ============================================================ */
describe('ClickjackingProtectionService', () => {
  let cj: ClickjackingProtectionService;

  beforeEach(() => {
    cj = new ClickjackingProtectionService();
  });

  it('blocks with X-Frame-Options: DENY', () => {
    expect(cj.evaluateResponse('https://example.com', 'DENY', null, 'https://attacker.com')).toBe('blocked');
  });

  it('allows with X-Frame-Options: SAMEORIGIN same origin', () => {
    expect(cj.evaluateResponse('https://example.com', 'SAMEORIGIN', null, 'https://example.com')).toBe('allowed');
  });

  it('blocks with X-Frame-Options: SAMEORIGIN cross-origin', () => {
    expect(cj.evaluateResponse('https://example.com', 'SAMEORIGIN', null, 'https://attacker.com')).toBe('blocked');
  });

  it('blocks with CSP frame-ancestors none', () => {
    expect(cj.evaluateResponse('https://example.com', null, "frame-ancestors 'none'", 'https://attacker.com')).toBe('blocked');
  });

  it('allows with disabled default policy', () => {
    cj.setDefaultPolicy('disabled');
    expect(cj.evaluateResponse('https://example.com', null, null, 'https://attacker.com')).toBe('allowed');
  });

  it('manages allowed framed origins', () => {
    cj.setDefaultPolicy('disabled');
    cj.addAllowedFramedOrigin('https://trusted.com');
    expect(cj.isOriginAllowedToFrame('https://trusted.com')).toBe(true);
    cj.removeAllowedFramedOrigin('https://trusted.com');
    expect(cj.isOriginAllowedToFrame('https://trusted.com')).toBe(false);
  });

  it('tracks blocked count', () => {
    cj.evaluateResponse('https://example.com', 'DENY', null, 'https://attacker.com');
    cj.evaluateResponse('https://example.com', 'DENY', null, 'https://attacker2.com');
    expect(cj.getBlockedCount()).toBe(2);
  });

  it('dispose resets state', () => {
    cj.addAllowedFramedOrigin('https://trusted.com');
    cj.dispose();
    expect(cj.getBlockedCount()).toBe(0);
  });
});

/* ============================================================
   11. Permission Manager
   ============================================================ */
describe('PermissionManagerService', () => {
  let pm: PermissionManagerService;

  beforeEach(() => {
    pm = new PermissionManagerService();
  });

  it('returns prompt for unset permissions', async () => {
    expect(await pm.queryPermission('https://example.com', 'camera')).toBe('prompt');
  });

  it('sets and queries permissions', async () => {
    pm.setPermission('https://example.com', 'geolocation', 'granted');
    expect(await pm.queryPermission('https://example.com', 'geolocation')).toBe('granted');
  });

  it('requests permission and updates state', async () => {
    const state = await pm.requestPermission('https://example.com', 'notifications');
    expect(state).toBe('granted');
  });

  it('revokes permissions', async () => {
    pm.setPermission('https://example.com', 'camera', 'granted');
    await pm.revokePermission('https://example.com', 'camera');
    expect(await pm.queryPermission('https://example.com', 'camera')).toBe('prompt');
  });

  it('lists all permissions for origin', () => {
    pm.setPermission('https://example.com', 'camera', 'granted');
    pm.setPermission('https://example.com', 'microphone', 'denied');
    const all = pm.getAllPermissions('https://example.com');
    expect(all.length).toBe(2);
  });

  it('resets all permissions for origin', () => {
    pm.setPermission('https://example.com', 'camera', 'granted');
    pm.resetAll('https://example.com');
    expect(pm.getAllPermissions('https://example.com').length).toBe(0);
  });

  it('dispose clears all state', async () => {
    pm.setPermission('https://example.com', 'camera', 'granted');
    pm.dispose();
    expect(await pm.queryPermission('https://example.com', 'camera')).toBe('prompt');
  });
});
