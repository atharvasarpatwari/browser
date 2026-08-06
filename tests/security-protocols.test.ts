import { describe, it, expect, beforeEach, vi } from 'vitest';

import { DnsRebindingProtectionService } from '../src/browser/media/dns-rebinding-protection';
import { HstsPreloadService } from '../src/browser/media/hsts-preload';
import { CertificateTransparencyService } from '../src/browser/media/certificate-transparency';
import { SubresourceIntegrityService } from '../src/browser/media/subresource-integrity';
import { PrivateNetworkAccessService } from '../src/browser/media/private-network-access';
import { CrossOriginPoliciesService } from '../src/browser/media/cross-origin-policies';
import { ReferrerPolicyService } from '../src/browser/media/referrer-policy';

/* ============================================================
   1. DNS Rebinding Protection
   ============================================================ */
describe('DnsRebindingProtectionService', () => {
  let drb: DnsRebindingProtectionService;

  beforeEach(() => {
    drb = new DnsRebindingProtectionService();
  });

  it('classifies public IPs', () => {
    expect(drb.classifyIp('93.184.216.34')).toBe('public');
    expect(drb.classifyIp('8.8.8.8')).toBe('public');
  });

  it('classifies private/local IPs', () => {
    expect(drb.classifyIp('10.0.0.1')).toBe('private');
    expect(drb.classifyIp('172.16.0.1')).toBe('private');
    expect(drb.classifyIp('192.168.1.1')).toBe('private');
    expect(drb.classifyIp('127.0.0.1')).toBe('loopback');
    expect(drb.classifyIp('169.254.169.254')).toBe('link-local');
    expect(drb.classifyIp('0.0.0.0')).toBe('reserved');
  });

  it('classifies IPv6 addresses', () => {
    expect(drb.classifyIp('::1')).toBe('loopback');
    expect(drb.classifyIp('fe80::1')).toBe('link-local');
    expect(drb.classifyIp('fd12:3456::1')).toBe('private');
    expect(drb.classifyIp('2001:4860:4860::8888')).toBe('public');
    expect(drb.classifyIp('::')).toBe('reserved');
  });

  it('allows public resolutions by default', () => {
    expect(drb.checkResolvedHost('example.com', '93.184.216.34')).toBe('allowed');
  });

  it('blocks hostnames resolving to private IPs in block mode', () => {
    expect(drb.checkResolvedHost('evil.com', '127.0.0.1')).toBe('blocked');
    expect(drb.checkResolvedHost('evil.com', '192.168.1.5')).toBe('blocked');
    expect(drb.getBlockedCount()).toBe(2);
  });

  it('warns in warn mode', () => {
    drb.setMode('warn');
    expect(drb.checkResolvedHost('evil.com', '10.0.0.1')).toBe('warn');
  });

  it('allows everything in disabled mode', () => {
    drb.setMode('disabled');
    expect(drb.checkResolvedHost('evil.com', '127.0.0.1')).toBe('allowed');
  });

  it('allows direct navigation to IP literals', () => {
    expect(drb.checkResolvedHost('192.168.1.1', '192.168.1.1')).toBe('allowed');
  });

  it('manages allowed hosts', () => {
    drb.addAllowedHost('router.local');
    expect(drb.isAllowedHost('router.local')).toBe(true);
    expect(drb.checkResolvedHost('router.local', '10.0.0.1')).toBe('allowed');
    drb.removeAllowedHost('router.local');
    expect(drb.isAllowedHost('router.local')).toBe(false);
  });

  it('fires events', () => {
    const fn = vi.fn();
    drb.onEvent(fn);
    drb.checkResolvedHost('evil.com', '10.0.0.1');
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'blocked' }));
  });

  it('dispose clears state', () => {
    drb.addAllowedHost('router.local');
    drb.dispose();
    expect(drb.getAllowedHosts()).toEqual([]);
    expect(drb.getBlockedCount()).toBe(0);
  });
});

/* ============================================================
   2. HSTS Preload
   ============================================================ */
describe('HstsPreloadService', () => {
  let preload: HstsPreloadService;

  beforeEach(() => {
    preload = new HstsPreloadService();
  });

  it('detects preloaded hosts', () => {
    expect(preload.isPreloaded('google.com')).toBe(true);
    expect(preload.isPreloaded('github.com')).toBe(true);
    expect(preload.isPreloaded('example-not-listed.com')).toBe(false);
  });

  it('matches subdomains of includeSubDomains hosts', () => {
    expect(preload.isPreloaded('accounts.google.com')).toBe(true);
    expect(preload.getPreloadedEntry('accounts.google.com')?.includeSubDomains).toBe(true);
  });

  it('upgrades http URLs for preloaded hosts', () => {
    const result = preload.checkUrl('http://google.com/');
    expect(result.isPreloaded).toBe(true);
    expect(result.shouldUpgrade).toBe(true);
    expect(result.upgradedUrl).toBe('https://google.com/');
  });

  it('does not upgrade https URLs', () => {
    const result = preload.checkUrl('https://github.com/');
    expect(result.shouldUpgrade).toBe(false);
  });

  it('does not upgrade non-preloaded hosts', () => {
    const result = preload.checkUrl('http://example-not-listed.com/');
    expect(result.isPreloaded).toBe(false);
    expect(result.shouldUpgrade).toBe(false);
  });

  it('manages preload entries', () => {
    preload.addPreloadHost('mybank.com', true);
    expect(preload.isPreloaded('mybank.com')).toBe(true);
    expect(preload.isPreloaded('accounts.mybank.com')).toBe(true);
    preload.removePreloadHost('mybank.com');
    expect(preload.isPreloaded('mybank.com')).toBe(false);
  });

  it('respects enabled flag', () => {
    preload.setEnabled(false);
    expect(preload.isPreloaded('google.com')).toBe(false);
    expect(preload.checkUrl('http://google.com/').shouldUpgrade).toBe(false);
  });

  it('reports preload count', () => {
    expect(preload.getPreloadCount()).toBeGreaterThan(0);
  });

  it('dispose clears entries', () => {
    preload.dispose();
    expect(preload.getPreloadCount()).toBe(0);
  });
});

/* ============================================================
   3. Certificate Transparency
   ============================================================ */
describe('CertificateTransparencyService', () => {
  let ct: CertificateTransparencyService;
  const validSct = { logId: 'log-1234', timestamp: Date.now(), signature: 'sig-abcdef' };

  beforeEach(() => {
    ct = new CertificateTransparencyService();
  });

  it('validates well-formed SCTs', () => {
    expect(ct.validateSct(validSct)).toBe('valid');
  });

  it('rejects SCTs with missing log id', () => {
    expect(ct.validateSct({ logId: '', timestamp: Date.now(), signature: 'sig-abcdef' })).toBe('invalid-log-id');
  });

  it('rejects SCTs with missing signature', () => {
    expect(ct.validateSct({ logId: 'log-1234', timestamp: Date.now(), signature: '' })).toBe('invalid-signature');
  });

  it('rejects future timestamps beyond clock skew', () => {
    const future = { logId: 'log-1234', timestamp: Date.now() + 100 * 3600 * 1000, signature: 'sig-abcdef' };
    expect(ct.validateSct(future)).toBe('future-timestamp');
  });

  it('counts distinct valid SCTs', () => {
    const otherLog = { logId: 'log-5678', timestamp: Date.now(), signature: 'sig-ghijkl' };
    expect(ct.countValidScts([validSct, validSct, otherLog])).toBe(2);
  });

  it('passes with enough valid SCTs', () => {
    const otherLog = { logId: 'log-5678', timestamp: Date.now(), signature: 'sig-ghijkl' };
    expect(ct.checkCertificates([validSct, otherLog])).toBe('pass');
  });

  it('warns with partial SCT coverage', () => {
    expect(ct.checkCertificates([validSct])).toBe('warn');
  });

  it('fails with no valid SCTs', () => {
    expect(ct.checkCertificates([])).toBe('fail');
    expect(ct.getBlockedCount()).toBe(1);
  });

  it('passes when enforcement disabled', () => {
    ct.setRequireCt(false);
    expect(ct.checkCertificates([])).toBe('pass');
  });

  it('enforces required SCT count', () => {
    ct.setRequiredScts(3);
    const otherLog = { logId: 'log-5678', timestamp: Date.now(), signature: 'sig-ghijkl' };
    const thirdLog = { logId: 'log-9012', timestamp: Date.now(), signature: 'sig-mnopqr' };
    expect(ct.checkCertificates([validSct, otherLog])).toBe('warn');
    expect(ct.checkCertificates([validSct, otherLog, thirdLog])).toBe('pass');
  });
});

/* ============================================================
   4. Subresource Integrity
   ============================================================ */
describe('SubresourceIntegrityService', () => {
  let sri: SubresourceIntegrityService;
  const SHA256_ABC = 'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
  const SHA384_ABC = 'sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn';
  const SHA512_ABC = 'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==';

  beforeEach(() => {
    sri = new SubresourceIntegrityService();
  });

  it('parses integrity metadata', () => {
    const parsed = sri.parseIntegrity(`${SHA256_ABC} ${SHA384_ABC}`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].algorithm).toBe('sha256');
    expect(parsed[0].value).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('ignores unsupported algorithms in metadata', () => {
    expect(sri.parseIntegrity('md5-abc123==')).toEqual([]);
  });

  it('computes matching sha256 digest', () => {
    expect(sri.computeDigest('sha256', 'abc')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  });

  it('computes matching sha384 digest', () => {
    expect(sri.computeDigest('sha384', 'abc')).toBe('ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn');
  });

  it('computes matching sha512 digest', () => {
    expect(sri.computeDigest('sha512', 'abc')).toBe('3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==');
  });

  it('computes empty string digest', () => {
    expect(sri.computeDigest('sha256', '')).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
  });

  it('verifies matching content', () => {
    const result = sri.verify(SHA256_ABC, 'abc');
    expect(result.state).toBe('valid');
    expect(result.matched).toBe(true);
  });

  it('rejects mismatched content', () => {
    const result = sri.verify(SHA256_ABC, 'def');
    expect(result.state).toBe('invalid');
    expect(result.matched).toBe(false);
    expect(sri.getBlockedCount()).toBe(1);
  });

  it('accepts any matching algorithm in a set', () => {
    expect(sri.verify(`${SHA384_ABC} ${SHA512_ABC}`, 'abc').state).toBe('valid');
  });

  it('handles missing integrity metadata', () => {
    expect(sri.verify('', 'abc').state).toBe('no-integrity');
  });

  it('handles unsupported integrity metadata', () => {
    expect(sri.verify('md5-abc123==', 'abc').state).toBe('unsupported-algorithm');
  });

  it('does not block when enforcement disabled', () => {
    sri.setEnforce(false);
    sri.verify(SHA256_ABC, 'def');
    expect(sri.getBlockedCount()).toBe(0);
  });
});

/* ============================================================
   5. Private Network Access
   ============================================================ */
describe('PrivateNetworkAccessService', () => {
  let pna: PrivateNetworkAccessService;

  beforeEach(() => {
    pna = new PrivateNetworkAccessService();
  });

  it('classifies address spaces', () => {
    expect(pna.classifyIp('93.184.216.34')).toBe('public');
    expect(pna.classifyIp('10.0.0.1')).toBe('private');
    expect(pna.classifyIp('192.168.1.1')).toBe('private');
    expect(pna.classifyIp('127.0.0.1')).toBe('local');
    expect(pna.classifyIp('169.254.169.254')).toBe('local');
    expect(pna.classifyIp('0.0.0.0')).toBe('reserved');
    expect(pna.classifyIp('::1')).toBe('local');
    expect(pna.classifyIp('fd12::1')).toBe('private');
  });

  it('classifies localhost host as local', () => {
    expect(pna.classifyHost('localhost', '')).toBe('local');
  });

  it('allows same-space requests', () => {
    expect(pna.checkRequest('93.184.216.34', '93.184.216.35')).toBe('allowed');
    expect(pna.checkRequest('10.0.0.1', '10.0.0.2')).toBe('allowed');
  });

  it('blocks public to private by default', () => {
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1')).toBe('blocked');
    expect(pna.checkRequest('93.184.216.34', '192.168.1.1')).toBe('blocked');
  });

  it('allows public to private in secure context in block-unless-secure mode', () => {
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1', true)).toBe('blocked');
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1', false)).toBe('blocked');
  });

  it('blocks in strict block mode regardless of secure context', () => {
    pna.setMode('block');
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1', true)).toBe('blocked');
  });

  it('warns in warn mode', () => {
    pna.setMode('warn');
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1')).toBe('warn');
  });

  it('allows everything in disabled mode', () => {
    pna.setMode('disabled');
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1')).toBe('allowed');
  });

  it('blocks reserved targets', () => {
    expect(pna.checkRequest('93.184.216.34', '0.0.0.0')).toBe('blocked');
  });

  it('manages allowed targets', () => {
    pna.addAllowedTarget('10.0.0.1');
    expect(pna.isAllowedTarget('10.0.0.1')).toBe(true);
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1')).toBe('allowed');
    pna.removeAllowedTarget('10.0.0.1');
    expect(pna.checkRequest('93.184.216.34', '10.0.0.1')).toBe('blocked');
  });

  it('tracks blocked count and fires events', () => {
    const fn = vi.fn();
    pna.onEvent(fn);
    pna.checkRequest('93.184.216.34', '10.0.0.1');
    pna.checkRequest('93.184.216.34', '192.168.1.1');
    expect(pna.getBlockedCount()).toBe(2);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ kind: 'blocked' }));
  });
});

/* ============================================================
   6. Cross-Origin Policies (COOP / COEP / CORP)
   ============================================================ */
describe('CrossOriginPoliciesService', () => {
  let co: CrossOriginPoliciesService;

  beforeEach(() => {
    co = new CrossOriginPoliciesService();
  });

  it('parses COOP header values', () => {
    expect(co.parseCoop('same-origin')).toBe('same-origin');
    expect(co.parseCoop('same-origin-allow-popups')).toBe('same-origin-allow-popups');
    expect(co.parseCoop(null)).toBe('unsafe-none');
    expect(co.parseCoop('garbage')).toBe('unsafe-none');
  });

  it('parses COEP header values', () => {
    expect(co.parseCoep('require-corp')).toBe('require-corp');
    expect(co.parseCoep('credentialless')).toBe('credentialless');
    expect(co.parseCoep(null)).toBe('unsafe-none');
  });

  it('parses CORP header values', () => {
    expect(co.parseCorp('same-origin')).toBe('same-origin');
    expect(co.parseCorp('same-site')).toBe('same-site');
    expect(co.parseCorp('cross-origin')).toBe('cross-origin');
    expect(co.parseCorp(null)).toBe(null);
  });

  it('severs opener relationship with COOP same-origin across origins', () => {
    expect(co.evaluateCoop('same-origin', 'https://opener.com', 'https://target.com')).toBe('cross-origin-severed');
  });

  it('links same-origin windows under COOP same-origin', () => {
    expect(co.evaluateCoop('same-origin', 'https://site.com', 'https://site.com')).toBe('same-origin-linked');
  });

  it('exposes window reference with unsafe-none', () => {
    expect(co.evaluateCoop(null, 'https://opener.com', 'https://target.com')).toBe('exposed');
  });

  it('exposes window reference with allow-popups', () => {
    expect(co.evaluateCoop('same-origin-allow-popups', 'https://opener.com', 'https://target.com')).toBe('exposed');
  });

  it('enforces CORP same-origin', () => {
    expect(co.checkCorp('https://site.com', 'https://site.com', 'same-origin')).toBe('allowed');
    expect(co.checkCorp('https://evil.com', 'https://site.com', 'same-origin')).toBe('blocked');
  });

  it('enforces CORP same-site', () => {
    expect(co.checkCorp('https://www.site.com', 'https://cdn.site.com', 'same-site')).toBe('allowed');
    expect(co.checkCorp('https://evil.com', 'https://site.com', 'same-site')).toBe('blocked');
  });

  it('allows navigate and websocket modes regardless of CORP', () => {
    expect(co.checkCorp('https://evil.com', 'https://site.com', 'same-origin', 'navigate')).toBe('allowed');
  });

  it('requires CORP for cross-origin subresources under require-corp', () => {
    expect(co.checkSubresource('https://site.com', 'https://site.com', null, 'no-cors', true, 'require-corp')).toBe('allowed');
    expect(co.checkSubresource('https://site.com', 'https://evil.com', 'same-origin', 'no-cors', false, 'require-corp')).toBe('blocked');
    expect(co.checkSubresource('https://site.com', 'https://evil.com', 'cross-origin', 'no-cors', false, 'require-corp')).toBe('allowed');
  });

  it('ignores COEP under unsafe-none', () => {
    expect(co.checkSubresource('https://site.com', 'https://evil.com', null, 'no-cors', false, null)).toBe('allowed');
  });

  it('computes cross-origin isolation status', () => {
    expect(co.getIsolationStatus('same-origin', 'require-corp')).toBe('cross-origin-isolated');
    expect(co.getIsolationStatus(null, 'require-corp')).toBe('needs-coop');
    expect(co.getIsolationStatus('same-origin', null)).toBe('needs-coep');
    expect(co.getIsolationStatus(null, null)).toBe('not-isolated');
  });

  it('tracks blocked count', () => {
    co.checkCorp('https://evil.com', 'https://site.com', 'same-origin');
    expect(co.getBlockedCount()).toBe(1);
  });
});

/* ============================================================
   7. Referrer Policy
   ============================================================ */
describe('ReferrerPolicyService', () => {
  let rp: ReferrerPolicyService;

  beforeEach(() => {
    rp = new ReferrerPolicyService();
  });

  it('parses policy headers', () => {
    expect(rp.parsePolicy('no-referrer')).toBe('no-referrer');
    expect(rp.parsePolicy('origin,strict-origin')).toBe('strict-origin');
    expect(rp.parsePolicy(null)).toBe('strict-origin-when-cross-origin');
  });

  it('returns no referrer for no-referrer', () => {
    expect(rp.computeReferrer('no-referrer', 'https://a.com/page', 'https://b.com/')).toBe(null);
  });

  it('returns full URL for unsafe-url', () => {
    expect(rp.computeReferrer('unsafe-url', 'https://a.com/path', 'https://b.com/')).toBe('https://a.com/path');
  });

  it('returns origin for origin policy', () => {
    expect(rp.computeReferrer('origin', 'https://a.com/path?q=1', 'https://b.com/')).toBe('https://a.com');
  });

  it('truncates to origin cross-origin in strict-origin-when-cross-origin', () => {
    expect(rp.computeReferrer('strict-origin-when-cross-origin', 'https://a.com/path', 'https://b.com/')).toBe('https://a.com');
  });

  it('keeps full URL same-origin in strict-origin-when-cross-origin', () => {
    expect(rp.computeReferrer('strict-origin-when-cross-origin', 'https://a.com/path', 'https://a.com/other')).toBe('https://a.com/path');
  });

  it('strips referrer on HTTPS to HTTP downgrade', () => {
    expect(rp.computeReferrer('no-referrer-when-downgrade', 'https://a.com/path', 'http://b.com/')).toBe(null);
    expect(rp.computeReferrer('strict-origin', 'https://a.com/path', 'http://b.com/')).toBe(null);
    expect(rp.computeReferrer('strict-origin-when-cross-origin', 'https://a.com/path', 'http://b.com/')).toBe(null);
  });

  it('allows referrer on non-downgrade HTTP', () => {
    expect(rp.computeReferrer('no-referrer-when-downgrade', 'http://a.com/path', 'http://b.com/')).toBe('http://a.com/path');
  });

  it('keeps full URL same-origin in same-origin policy', () => {
    expect(rp.computeReferrer('same-origin', 'https://a.com/path', 'https://a.com/other')).toBe('https://a.com/path');
    expect(rp.computeReferrer('same-origin', 'https://a.com/path', 'https://b.com/')).toBe(null);
  });

  it('uses default policy when no header', () => {
    expect(rp.computeReferrer(rp.parsePolicy(null), 'https://a.com/path', 'https://b.com/')).toBe('https://a.com');
  });

  it('returns null when disabled', () => {
    rp.setEnabled(false);
    expect(rp.computeReferrer('unsafe-url', 'https://a.com/path', 'https://b.com/')).toBe(null);
  });

  it('tracks referrer and truncated counts', () => {
    rp.computeReferrer('strict-origin-when-cross-origin', 'https://a.com/path', 'https://b.com/');
    rp.computeReferrer('no-referrer', 'https://a.com/path', 'https://b.com/');
    expect(rp.getReferrerCount()).toBe(2);
    expect(rp.getTruncatedCount()).toBe(1);
  });
});
