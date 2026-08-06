import { describe, it, expect } from 'vitest';
import { SecurityLayer } from '../src/browser/media/security-layer';
import { NavigationType } from '../src/browser/navigation/navigation-controller';

describe('SecurityLayer — navigation checks', () => {
  const layer = new SecurityLayer();

  it('allows https URLs', () => {
    const check = layer.checkNavigation('https://example.com/');
    expect(check.allowed).toBe(true);
    expect(check.decision).toBe('allow');
  });

  it('allows non-http(s) URLs', () => {
    expect(layer.checkNavigation('about:blank').allowed).toBe(true);
    expect(layer.checkNavigation('data:text/html,hi').allowed).toBe(true);
  });

  it('upgrades + blocks http on HSTS-preloaded hosts', () => {
    const check = layer.checkNavigation('http://google.com/');
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('upgrade');
    expect(check.upgradeUrl).toBe('https://google.com/');
    expect(check.reason).toContain('HTTPS');
  });

  it('upgrades + blocks plain http when HTTPS is enforced', () => {
    const check = layer.checkNavigation('http://example.com/');
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('upgrade');
    expect(check.upgradeUrl).toBe('https://example.com/');
  });

  it('blocks navigation when DNS resolution points to a private IP', () => {
    const check = layer.checkNavigation('https://evil.example/', {
      resolvedIp: '127.0.0.1',
    });
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('block');
    expect(check.reason).toContain('DNS rebinding');
  });

  it('blocks navigation for public→private Private Network Access', () => {
    const check = layer.checkNavigation('https://page.example/', {
      sourceIp: '8.8.8.8',
      targetIp: '10.0.0.5',
      isSecure: true,
    });
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('block');
    expect(check.reason).toContain('Private Network Access');
  });

  it('warns (but does not block) on XSS-looking navigation URLs', () => {
    const check = layer.checkNavigation('https://example.com/?q="><script>alert(1)</script>');
    expect(check.allowed).toBe(true);
    expect(check.decision).toBe('warn');
  });
});

describe('SecurityLayer — sub-resource checks', () => {
  const layer = new SecurityLayer();

  it('blocks mixed-content scripts', () => {
    const check = layer.checkSubresource(
      'https://page.example/',
      'http://cdn.example/script.js',
      'script',
    );
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('block');
    expect(check.reason).toContain('Mixed content');
  });

  it('allows same-origin https scripts', () => {
    const check = layer.checkSubresource(
      'https://page.example/',
      'https://page.example/app.js',
      'script',
    );
    expect(check.allowed).toBe(true);
    expect(check.decision).toBe('allow');
  });

  it('allows http page loading http sub-resources', () => {
    const check = layer.checkSubresource(
      'http://page.example/',
      'http://cdn.example/script.js',
      'script',
    );
    expect(check.allowed).toBe(true);
  });

  it('blocks state-changing requests without a CSRF token', () => {
    const check = layer.checkSubresource(
      'https://page.example/',
      'https://page.example/api/account',
      'fetch',
      { method: 'POST' },
    );
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('block');
    expect(check.reason).toContain('CSRF');
  });

  it('allows state-changing requests with a valid CSRF token', () => {
    const origin = 'https://page.example';
    const token = layer.csrf.addOriginToken(origin);
    const check = layer.checkSubresource(
      `${origin}/`,
      `${origin}/api/account`,
      'fetch',
      { method: 'POST', token },
    );
    expect(check.allowed).toBe(true);
  });

  it('blocks public→private sub-resource requests', () => {
    const check = layer.checkSubresource(
      'https://page.example/',
      'http://192.168.1.10/device',
      'fetch',
      { sourceIp: '8.8.8.8', targetIp: '192.168.1.10' },
    );
    expect(check.allowed).toBe(false);
    expect(check.decision).toBe('block');
  });
});

describe('SecurityLayer — SRI verification', () => {
  const layer = new SecurityLayer();

  it('verifies matching SHA-256 integrity', () => {
    const digest = layer.subresourceIntegrity.computeDigest('sha256', 'hello');
    const result = layer.verifySubresourceIntegrity(`sha256-${digest}`, 'hello');
    expect(result.state).toBe('valid');
    expect(result.matched).toBe(true);
  });

  it('flags tampered content as invalid', () => {
    const digest = layer.subresourceIntegrity.computeDigest('sha256', 'hello');
    const result = layer.verifySubresourceIntegrity(`sha256-${digest}`, 'tampered');
    expect(result.state).toBe('invalid');
    expect(result.matched).toBe(false);
  });
});

describe('SecurityLayer — response headers', () => {
  const layer = new SecurityLayer();

  it('blocks framing when X-Frame-Options denies the top origin', () => {
    const headers = new Map<string, string>([['x-frame-options', 'DENY']]);
    const check = layer.applyResponseHeaders('https://victim.example/', headers, {
      framed: true,
      topOrigin: 'https://evil.example',
    });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Framing');
  });

  it('does not apply clickjacking checks to top-level documents', () => {
    const headers = new Map<string, string>([['x-frame-options', 'DENY']]);
    const check = layer.applyResponseHeaders('https://victim.example/', headers, {
      framed: false,
    });
    expect(check.allowed).toBe(true);
  });

  it('enforces CORP for cross-origin responses under COEP require-corp', () => {
    layer.applyResponseHeaders(
      'https://page.example/',
      new Map<string, string>([['cross-origin-embedder-policy', 'require-corp']]),
      {},
    );
    const check = layer.applyResponseHeaders(
      'https://cdn.example/x.js',
      new Map<string, string>([['cross-origin-resource-policy', 'same-origin']]),
      { pageOrigin: 'https://page.example', requestMode: 'no-cors' },
    );
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('CORP');
  });

  it('allows CORP same-origin responses when page has no COEP', () => {
    const check = layer.applyResponseHeaders(
      'https://cdn.example/x.js',
      new Map<string, string>([['cross-origin-resource-policy', 'same-origin']]),
      { pageOrigin: 'https://unrelated.example', requestMode: 'no-cors' },
    );
    expect(check.allowed).toBe(true);
  });
});

describe('SecurityLayer — referrer policy', () => {
  const layer = new SecurityLayer();

  it('strips referrer when the page policy is no-referrer', () => {
    layer.applyResponseHeaders(
      'https://page.example/',
      new Map<string, string>([['referrer-policy', 'no-referrer']]),
      {},
    );
    expect(layer.getReferrerForPage('https://page.example', 'https://other.example/x')).toBe(null);
  });

  it('defaults to strict-origin-when-cross-origin when no header was captured', () => {
    expect(layer.getReferrerForPage('https://other.example', 'https://target.example/x')).toBe(
      'https://other.example',
    );
  });
});

describe('SecurityLayer — navigation guard', () => {
  const layer = new SecurityLayer();

  it('blocks http navigation to preloaded hosts and explains the upgrade', async () => {
    const request = { url: 'http://google.com/', type: NavigationType.Push, userInitiated: true };
    expect(await layer.navigationGuard.canNavigate(request)).toBe(false);
    expect(layer.navigationGuard.blockedReason?.(request)).toContain('https://google.com/');
  });

  it('allows https navigation to preloaded hosts', async () => {
    const request = { url: 'https://google.com/', type: NavigationType.Push, userInitiated: true };
    expect(await layer.navigationGuard.canNavigate(request)).toBe(true);
  });
});

describe('SecurityLayer — stats, events, lifecycle', () => {
  it('exposes aggregate stats', () => {
    const layer = new SecurityLayer();
    const stats = layer.getStats();
    expect(stats.hstsPreloadedHosts).toBeGreaterThan(0);
    expect(stats.httpsEnforced).toBe(true);
    expect(stats.trackedPermissionKinds).toBe(13);
  });

  it('forwards child-module events with the service name', () => {
    const layer = new SecurityLayer();
    const seen: string[] = [];
    const unsubscribe = layer.onEvent((event) => {
      seen.push(`${event.service}:${event.kind}`);
    });
    layer.checkSubresource('https://page.example/', 'http://cdn.example/s.js', 'script');
    unsubscribe();
    expect(seen).toContain('mixed-content:blocked');
  });

  it('disposes all child modules without throwing', () => {
    const layer = new SecurityLayer();
    expect(() => layer.dispose()).not.toThrow();
  });
});
