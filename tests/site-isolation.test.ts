import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// OriginIsolator tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  OriginIsolator,
  DEFAULT_ISOLATOR_CONFIG,
} from '../src/browser/security/origin-isolator';

describe('OriginIsolator', () => {
  let isolator: OriginIsolator;

  beforeEach(() => {
    isolator = new OriginIsolator();
  });

  afterEach(() => {
    isolator.dispose();
  });

  describe('registerTab', () => {
    it('should create a new isolated context for a first-time origin', () => {
      const result = isolator.registerTab('tab-1', 'https://example.com');
      expect(result.allowed).toBe(true);
      expect(result.requiresNewContext).toBe(true);
      expect(result.contextId).toBeTruthy();
    });

    it('should reuse the same context for same-origin tabs', () => {
      const r1 = isolator.registerTab('tab-1', 'https://example.com');
      const r2 = isolator.registerTab('tab-2', 'https://example.com');
      expect(r1.contextId).toBe(r2.contextId);
      expect(r2.requiresNewContext).toBe(false);
    });

    it('should create different contexts for different origins', () => {
      const r1 = isolator.registerTab('tab-1', 'https://example.com');
      const r2 = isolator.registerTab('tab-2', 'https://other.com');
      expect(r1.contextId).not.toBe(r2.contextId);
    });

    it('should track tab count per origin', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.registerTab('tab-2', 'https://example.com');
      isolator.registerTab('tab-3', 'https://example.com');
      expect(isolator.getTabCount('https://example.com')).toBe(3);
    });

    it('should throw after disposal', () => {
      isolator.dispose();
      expect(() => isolator.registerTab('tab-1', 'https://example.com')).toThrow('disposed');
    });
  });

  describe('unregisterTab', () => {
    it('should remove a tab from its origin', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.unregisterTab('tab-1');
      expect(isolator.getTabCount('https://example.com')).toBe(0);
    });

    it('should remove the origin when last tab is unregistered', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.unregisterTab('tab-1');
      expect(isolator.originCount).toBe(0);
    });

    it('should not remove the origin if other tabs remain', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.registerTab('tab-2', 'https://example.com');
      isolator.unregisterTab('tab-1');
      expect(isolator.originCount).toBe(1);
      expect(isolator.getTabCount('https://example.com')).toBe(1);
    });

    it('should handle unregistering unknown tabId gracefully', () => {
      isolator.unregisterTab('nonexistent');
      expect(isolator.originCount).toBe(0);
    });
  });

  describe('checkNavigation', () => {
    it('should require new context for first navigation', () => {
      const result = isolator.checkNavigation('tab-1', 'https://example.com');
      expect(result.requiresNewContext).toBe(true);
      expect(result.allowed).toBe(true);
    });

    it('should reuse context for same-origin navigation', () => {
      isolator.checkNavigation('tab-1', 'https://example.com');
      const result = isolator.checkNavigation('tab-1', 'https://example.com');
      expect(result.requiresNewContext).toBe(false);
    });

    it('should require new context for cross-origin navigation', () => {
      isolator.checkNavigation('tab-1', 'https://example.com');
      const result = isolator.checkNavigation('tab-1', 'https://other.com');
      expect(result.requiresNewContext).toBe(true);
      expect(result.allowed).toBe(true);
    });

    it('should update tab origin after cross-origin navigation', () => {
      isolator.checkNavigation('tab-1', 'https://example.com');
      isolator.checkNavigation('tab-1', 'https://other.com');
      expect(isolator.getOriginForTab('tab-1')).toBe('https://other.com');
      expect(isolator.getTabCount('https://example.com')).toBe(0);
      expect(isolator.getTabCount('https://other.com')).toBe(1);
    });
  });

  describe('checkIsolation', () => {
    it('should report isolated for different origins', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.registerTab('tab-2', 'https://other.com');
      const result = isolator.checkIsolation('https://example.com', 'https://other.com');
      expect(result.isolated).toBe(true);
      expect(result.sameOrigin).toBe(false);
    });

    it('should report not isolated for same origin with shared context', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.registerTab('tab-2', 'https://example.com');
      const result = isolator.checkIsolation('https://example.com', 'https://example.com');
      expect(result.isolated).toBe(false);
      expect(result.sameOrigin).toBe(true);
    });

    it('should report isolated for unregistered origins', () => {
      const result = isolator.checkIsolation('https://unknown.com', 'https://other.com');
      expect(result.isolated).toBe(true);
    });
  });

  describe('getContextForOrigin / getOriginForTab', () => {
    it('should return context ID for registered origin', () => {
      const r = isolator.registerTab('tab-1', 'https://example.com');
      expect(isolator.getContextForOrigin('https://example.com')).toBe(r.contextId);
    });

    it('should return null for unregistered origin', () => {
      expect(isolator.getContextForOrigin('https://unknown.com')).toBeNull();
    });

    it('should return origin for registered tab', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      expect(isolator.getOriginForTab('tab-1')).toBe('https://example.com');
    });

    it('should return null for unregistered tab', () => {
      expect(isolator.getOriginForTab('unknown')).toBeNull();
    });
  });

  describe('getActiveOrigins / originCount', () => {
    it('should track multiple active origins', () => {
      isolator.registerTab('tab-1', 'https://a.com');
      isolator.registerTab('tab-2', 'https://b.com');
      isolator.registerTab('tab-3', 'https://c.com');
      expect(isolator.originCount).toBe(3);
      expect(isolator.getActiveOrigins()).toHaveLength(3);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least-recently-used origin when maxOrigins reached', () => {
      const small = new OriginIsolator({ maxOrigins: 2 });
      small.registerTab('tab-1', 'https://a.com');
      small.registerTab('tab-2', 'https://b.com');
      small.registerTab('tab-3', 'https://c.com');
      expect(small.originCount).toBe(2);
      expect(small.getActiveOrigins()).not.toContain('https://a.com');
      small.dispose();
    });
  });

  describe('event system', () => {
    it('should emit originIsolated for new origin', () => {
      const handler = vi.fn();
      isolator.on(handler);
      isolator.registerTab('tab-1', 'https://example.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'originIsolated', origin: 'https://example.com' }),
      );
    });

    it('should emit tabAdded when a tab registers', () => {
      const handler = vi.fn();
      isolator.on(handler);
      isolator.registerTab('tab-1', 'https://example.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'tabAdded', tabId: 'tab-1' }),
      );
    });

    it('should emit tabRemoved and originRemoved when last tab unregisters', () => {
      const handler = vi.fn();
      isolator.on(handler);
      isolator.registerTab('tab-1', 'https://example.com');
      handler.mockClear();
      isolator.unregisterTab('tab-1');
      const kinds = handler.mock.calls.map(c => c[0].kind);
      expect(kinds).toContain('tabRemoved');
      expect(kinds).toContain('originRemoved');
    });

    it('should emit crossOriginNavigation on cross-origin nav', () => {
      isolator.registerTab('tab-1', 'https://a.com');
      const handler = vi.fn();
      isolator.on(handler);
      isolator.checkNavigation('tab-1', 'https://b.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'crossOriginNavigation' }),
      );
    });

    it('should support off() to unsubscribe', () => {
      const handler = vi.fn();
      isolator.on(handler);
      isolator.off(handler);
      isolator.registerTab('tab-1', 'https://example.com');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear all state', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.dispose();
      expect(isolator.originCount).toBe(0);
    });

    it('should ignore unregisterTab after dispose', () => {
      isolator.registerTab('tab-1', 'https://example.com');
      isolator.dispose();
      expect(() => isolator.unregisterTab('tab-1')).not.toThrow();
    });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// CrossOriginGuard tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  CrossOriginGuard,
  DEFAULT_GUARD_CONFIG,
  PREFLIGHT_METHODS,
  PREFLIGHT_HEADERS,
} from '../src/browser/security/cross-origin-guard';

describe('CrossOriginGuard', () => {
  let guard: CrossOriginGuard;

  beforeEach(() => {
    guard = new CrossOriginGuard();
  });

  afterEach(() => {
    guard.dispose();
  });

  describe('same-origin access', () => {
    it('should allow same-origin DOM access', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://example.com',
        targetOrigin: 'https://example.com',
        accessType: 'dom-read',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow same-origin storage access', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://example.com',
        targetOrigin: 'https://example.com',
        accessType: 'storage-write',
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow same-origin cookie access', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://example.com',
        targetOrigin: 'https://example.com',
        accessType: 'cookie-read',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('cross-origin DOM access', () => {
    it('should block cross-origin dom-read in strict mode', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Same-Origin Policy');
    });

    it('should block cross-origin dom-write in strict mode', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-write',
      });
      expect(result.allowed).toBe(false);
    });

    it('should block cross-origin dom-method in strict mode', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-method',
      });
      expect(result.allowed).toBe(false);
    });

    it('should allow dom-read in non-strict mode', () => {
      const loose = new CrossOriginGuard({ strictMode: false });
      const result = loose.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      expect(result.allowed).toBe(true);
      loose.dispose();
    });

    it('should still block dom-write in non-strict mode', () => {
      const loose = new CrossOriginGuard({ strictMode: false });
      const result = loose.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-write',
      });
      expect(result.allowed).toBe(false);
      loose.dispose();
    });
  });

  describe('cross-origin storage access', () => {
    it('should block cross-origin storage-read', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'storage-read',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('storage is origin-scoped');
    });

    it('should block cross-origin storage-write', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'storage-write',
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('cross-origin network access', () => {
    it('should allow cross-origin fetch with CORS headers', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'GET',
      });
      expect(result.allowed).toBe(true);
      expect(result.responseHeaders).toBeDefined();
      expect(result.responseHeaders!['Access-Control-Allow-Origin']).toBe('https://a.com');
    });

    it('should require preflight for PUT', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'PUT',
      });
      expect(result.allowed).toBe(true);
      expect(result.requiresPreflight).toBe(true);
    });

    it('should require preflight for DELETE', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'DELETE',
      });
      expect(result.requiresPreflight).toBe(true);
    });

    it('should require preflight for PATCH', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'PATCH',
      });
      expect(result.requiresPreflight).toBe(true);
    });

    it('should require preflight for custom authorization header', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'GET',
        headers: { Authorization: 'Bearer token' },
      });
      expect(result.requiresPreflight).toBe(true);
    });

    it('should require preflight for custom content-type header', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result.requiresPreflight).toBe(true);
    });
  });

  describe('cross-origin cookies', () => {
    it('should block cross-origin cookie-read', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'cookie-read',
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('cookies are domain-scoped');
    });

    it('should block cross-origin cookie-write', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'cookie-write',
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe('postMessage', () => {
    it('should allow cross-origin postMessage', () => {
      const result = guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'postMessage',
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('trusted origins', () => {
    it('should allow access to trusted origin', () => {
      const trusted = new CrossOriginGuard({
        trustedOrigins: ['https://cdn.example.com'],
      });
      const result = trusted.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://cdn.example.com',
        accessType: 'dom-read',
      });
      expect(result.allowed).toBe(true);
      trusted.dispose();
    });
  });

  describe('isSameOrigin', () => {
    it('should detect same origin', () => {
      expect(guard.isSameOrigin('https://example.com', 'https://example.com')).toBe(true);
    });

    it('should detect different protocol', () => {
      expect(guard.isSameOrigin('https://example.com', 'http://example.com')).toBe(false);
    });

    it('should detect different host', () => {
      expect(guard.isSameOrigin('https://a.com', 'https://b.com')).toBe(false);
    });

    it('should detect different port', () => {
      expect(guard.isSameOrigin('https://example.com:8080', 'https://example.com:9090')).toBe(false);
    });
  });

  describe('requiresPreflight', () => {
    it('should return true for PUT', () => {
      expect(guard.requiresPreflight('PUT')).toBe(true);
    });

    it('should return true for DELETE', () => {
      expect(guard.requiresPreflight('DELETE')).toBe(true);
    });

    it('should return true for PATCH', () => {
      expect(guard.requiresPreflight('PATCH')).toBe(true);
    });

    it('should return false for GET', () => {
      expect(guard.requiresPreflight('GET')).toBe(false);
    });

    it('should return false for POST without special headers', () => {
      expect(guard.requiresPreflight('POST')).toBe(false);
    });
  });

  describe('getCorsHeaders', () => {
    it('should return proper CORS headers', () => {
      const headers = guard.getCorsHeaders('https://a.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://a.com');
      expect(headers['Access-Control-Allow-Methods']).toBeDefined();
      expect(headers['Access-Control-Allow-Headers']).toBeDefined();
    });
  });

  describe('violation tracking', () => {
    it('should record violations', () => {
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      expect(guard.getViolations()).toHaveLength(1);
    });

    it('should not record allowed requests as violations', () => {
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://a.com',
        accessType: 'dom-read',
      });
      expect(guard.getViolations()).toHaveLength(0);
    });

    it('should clear violations', () => {
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      guard.clearViolations();
      expect(guard.getViolations()).toHaveLength(0);
    });
  });

  describe('event system', () => {
    it('should emit accessBlocked on denied request', () => {
      const handler = vi.fn();
      guard.on(handler);
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'accessBlocked' }),
      );
    });

    it('should emit accessAllowed for allowed cross-origin network request', () => {
      const handler = vi.fn();
      guard.on(handler);
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'network-fetch',
        method: 'GET',
      });
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'accessAllowed' }),
      );
    });

    it('should support off()', () => {
      const handler = vi.fn();
      guard.on(handler);
      guard.off(handler);
      guard.checkAccess({
        requesterOrigin: 'https://a.com',
        targetOrigin: 'https://b.com',
        accessType: 'dom-read',
      });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should throw on checkAccess after disposal', () => {
      guard.dispose();
      expect(() =>
        guard.checkAccess({
          requesterOrigin: 'https://a.com',
          targetOrigin: 'https://b.com',
          accessType: 'dom-read',
        }),
      ).toThrow('disposed');
    });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PermissionManager tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  PermissionManager,
  ALL_PERMISSIONS,
  DEFAULT_MANAGER_CONFIG,
} from '../src/browser/security/permission-manager';

describe('PermissionManager', () => {
  let pm: PermissionManager;

  beforeEach(() => {
    pm = new PermissionManager();
  });

  afterEach(() => {
    pm.dispose();
  });

  describe('query', () => {
    it('should return prompt for unknown permission', () => {
      const result = pm.query('https://example.com', 'camera');
      expect(result.state).toBe('prompt');
      expect(result.expired).toBe(false);
    });

    it('should return granted after grant()', () => {
      pm.grant('https://example.com', 'camera');
      const result = pm.query('https://example.com', 'camera');
      expect(result.state).toBe('granted');
    });

    it('should return denied after deny()', () => {
      pm.deny('https://example.com', 'camera');
      const result = pm.query('https://example.com', 'camera');
      expect(result.state).toBe('denied');
    });

    it('should detect expired permissions', async () => {
      pm.grant('https://example.com', 'camera', false, 1); // 1ms TTL
      await new Promise(r => setTimeout(r, 10));
      const result = pm.query('https://example.com', 'camera');
      expect(result.state).toBe('prompt');
      expect(result.expired).toBe(true);
    });

    it('should throw after disposal', () => {
      pm.dispose();
      expect(() => pm.query('https://example.com', 'camera')).toThrow('disposed');
    });
  });

  describe('queryAll', () => {
    it('should return all 13 permission types', () => {
      const results = pm.queryAll('https://example.com');
      expect(results).toHaveLength(13);
    });

    it('should all be prompt by default', () => {
      const results = pm.queryAll('https://example.com');
      expect(results.every(r => r.state === 'prompt')).toBe(true);
    });
  });

  describe('grant', () => {
    it('should grant a permission', () => {
      const result = pm.grant('https://example.com', 'camera');
      expect(result.state).toBe('granted');
      expect(pm.isGranted('https://example.com', 'camera')).toBe(true);
    });

    it('should track grant count', () => {
      pm.grant('https://example.com', 'camera');
      pm.grant('https://example.com', 'microphone');
      expect(pm.size).toBe(2);
    });
  });

  describe('deny', () => {
    it('should deny a permission', () => {
      const result = pm.deny('https://example.com', 'camera');
      expect(result.state).toBe('denied');
      expect(pm.isDenied('https://example.com', 'camera')).toBe(true);
    });
  });

  describe('revoke', () => {
    it('should revoke a permission back to prompt', () => {
      pm.grant('https://example.com', 'camera');
      pm.revoke('https://example.com', 'camera');
      const result = pm.query('https://example.com', 'camera');
      expect(result.state).toBe('prompt');
    });
  });

  describe('revokeAll', () => {
    it('should revoke all permissions for an origin', () => {
      pm.grant('https://example.com', 'camera');
      pm.grant('https://example.com', 'microphone');
      pm.grant('https://other.com', 'camera');
      pm.revokeAll('https://example.com');
      expect(pm.isGranted('https://example.com', 'camera')).toBe(false);
      expect(pm.isGranted('https://example.com', 'microphone')).toBe(false);
      expect(pm.isGranted('https://other.com', 'camera')).toBe(true);
    });
  });

  describe('request', () => {
    it('should auto-grant on request', () => {
      const result = pm.request('https://example.com', 'camera');
      expect(result.state).toBe('granted');
    });

    it('should not re-grant already granted permission', () => {
      pm.grant('https://example.com', 'camera');
      const result = pm.request('https://example.com', 'camera');
      expect(result.state).toBe('granted');
    });
  });

  describe('undeniable permissions', () => {
    it('should not allow denying an undeniable permission', () => {
      const strict = new PermissionManager({
        undeniablePermissions: ['camera'],
      });
      strict.grant('https://example.com', 'camera');
      const result = strict.deny('https://example.com', 'camera');
      // Should return current state (granted) without changing it
      expect(result.state).toBe('granted');
      strict.dispose();
    });
  });

  describe('TTL expiry', () => {
    it('should expire after TTL', async () => {
      pm.grant('https://example.com', 'camera', false, 10);
      // Wait for expiry
      await new Promise(r => setTimeout(r, 20));
      const result = pm.query('https://example.com', 'camera');
      expect(result.expired).toBe(true);
      expect(result.state).toBe('prompt');
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest when maxEntries reached', () => {
      const small = new PermissionManager({ maxEntries: 2 });
      small.grant('https://a.com', 'camera');
      small.grant('https://b.com', 'camera');
      small.grant('https://c.com', 'camera'); // should evict oldest
      expect(small.size).toBe(2);
      small.dispose();
    });
  });

  describe('getOrigins', () => {
    it('should return unique origins with permissions', () => {
      pm.grant('https://a.com', 'camera');
      pm.grant('https://a.com', 'microphone');
      pm.grant('https://b.com', 'camera');
      const origins = pm.getOrigins();
      expect(origins).toHaveLength(2);
    });
  });

  describe('reset', () => {
    it('should clear all permissions', () => {
      pm.grant('https://a.com', 'camera');
      pm.grant('https://b.com', 'camera');
      pm.reset();
      expect(pm.size).toBe(0);
    });
  });

  describe('event system', () => {
    it('should emit permissionGranted', () => {
      const handler = vi.fn();
      pm.on(handler);
      pm.grant('https://example.com', 'camera');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'permissionGranted' }),
      );
    });

    it('should emit permissionDenied', () => {
      const handler = vi.fn();
      pm.on(handler);
      pm.deny('https://example.com', 'camera');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'permissionDenied' }),
      );
    });

    it('should emit permissionRevoked', () => {
      const handler = vi.fn();
      pm.on(handler);
      pm.revoke('https://example.com', 'camera');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'permissionRevoked' }),
      );
    });

    it('should emit allRevoked', () => {
      const handler = vi.fn();
      pm.on(handler);
      pm.revokeAll('https://example.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'allRevoked' }),
      );
    });
  });

  describe('dispose', () => {
    it('should clear state', () => {
      pm.grant('https://example.com', 'camera');
      pm.dispose();
      expect(pm.size).toBe(0);
    });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ResourceQuotaManager tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  ResourceQuotaManager,
  DEFAULT_QUOTA_CONFIG,
} from '../src/browser/security/resource-quota-manager';

describe('ResourceQuotaManager', () => {
  let rqm: ResourceQuotaManager;

  beforeEach(() => {
    rqm = new ResourceQuotaManager();
  });

  afterEach(() => {
    rqm.dispose();
  });

  describe('tracking', () => {
    it('should track a tab', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      expect(rqm.trackedCount).toBe(1);
      expect(rqm.getTrackedTabs()).toContain('tab-1');
    });

    it('should not double-track same tab', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.trackTab('tab-1', 'https://example.com');
      expect(rqm.trackedCount).toBe(1);
    });

    it('should untrack a tab', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.untrackTab('tab-1');
      expect(rqm.trackedCount).toBe(0);
    });

    it('should get usage for tracked tab', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      const usage = rqm.getUsage('tab-1');
      expect(usage).not.toBeNull();
      expect(usage!.tabId).toBe('tab-1');
      expect(usage!.origin).toBe('https://example.com');
    });

    it('should return null for untracked tab', () => {
      expect(rqm.getUsage('unknown')).toBeNull();
    });

    it('should throw after disposal', () => {
      rqm.dispose();
      expect(() => rqm.trackTab('tab-1', 'https://example.com')).toThrow('disposed');
    });
  });

  describe('memory quota', () => {
    it('should update memory usage', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      const result = rqm.updateMemory('tab-1', 1024);
      expect(result.withinQuota).toBe(true);
      expect(result.current).toBe(1024);
    });

    it('should detect memory quota breach', () => {
      const small = new ResourceQuotaManager({ maxMemoryBytes: 100 });
      small.trackTab('tab-1', 'https://example.com');
      const result = small.updateMemory('tab-1', 200);
      expect(result.withinQuota).toBe(false);
      expect(result.reason).toContain('memory quota exceeded');
      small.dispose();
    });

    it('should track peak memory', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.updateMemory('tab-1', 100);
      rqm.updateMemory('tab-1', 50);
      const usage = rqm.getUsage('tab-1')!;
      expect(usage.peakMemoryBytes).toBe(100);
    });

    it('should return result for untracked tab', () => {
      const result = rqm.updateMemory('unknown', 1000);
      expect(result.withinQuota).toBe(true);
    });
  });

  describe('CPU quota', () => {
    it('should record CPU time', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      const result = rqm.recordCpuTime('tab-1', 10);
      expect(result.withinQuota).toBe(true);
      expect(result.current).toBe(10);
    });

    it('should detect CPU quota breach', () => {
      const strict = new ResourceQuotaManager({ maxCpuTimeMs: 10 });
      strict.trackTab('tab-1', 'https://example.com');
      const result = strict.recordCpuTime('tab-1', 20);
      expect(result.withinQuota).toBe(false);
      expect(result.reason).toContain('cpu quota exceeded');
      strict.dispose();
    });

    it('should accumulate CPU time', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.recordCpuTime('tab-1', 10);
      rqm.recordCpuTime('tab-1', 15);
      const usage = rqm.getUsage('tab-1')!;
      expect(usage.cpuTimeMs).toBe(25);
    });

    it('should track peak CPU time', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.recordCpuTime('tab-1', 30);
      rqm.recordCpuTime('tab-1', 10);
      const usage = rqm.getUsage('tab-1')!;
      expect(usage.peakCpuTimeMs).toBe(30);
    });
  });

  describe('network quota', () => {
    it('should acquire a connection', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      const result = rqm.acquireConnection('tab-1');
      expect(result.withinQuota).toBe(true);
      expect(result.current).toBe(1);
    });

    it('should detect network quota breach', () => {
      const strict = new ResourceQuotaManager({ maxNetworkConnections: 2 });
      strict.trackTab('tab-1', 'https://example.com');
      strict.acquireConnection('tab-1');
      strict.acquireConnection('tab-1');
      const result = strict.acquireConnection('tab-1');
      expect(result.withinQuota).toBe(false);
      strict.dispose();
    });

    it('should release a connection', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.acquireConnection('tab-1');
      rqm.releaseConnection('tab-1');
      const usage = rqm.getUsage('tab-1')!;
      expect(usage.networkConnections).toBe(0);
    });

    it('should not go below zero connections', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.releaseConnection('tab-1');
      const usage = rqm.getUsage('tab-1')!;
      expect(usage.networkConnections).toBe(0);
    });
  });

  describe('checkQuota / getSummary', () => {
    it('should return null for untracked tab', () => {
      expect(rqm.checkQuota('unknown', 'memory')).toBeNull();
      expect(rqm.getSummary('unknown')).toBeNull();
    });

    it('should return full summary', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.updateMemory('tab-1', 1024);
      const summary = rqm.getSummary('tab-1');
      expect(summary).not.toBeNull();
      expect(summary!.tabId).toBe('tab-1');
      expect(summary!.memory.current).toBe(1024);
      expect(summary!.anyExceeded).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest tab when maxTabs reached', () => {
      const small = new ResourceQuotaManager({ maxTabs: 2 });
      small.trackTab('tab-1', 'https://a.com');
      small.trackTab('tab-2', 'https://b.com');
      small.trackTab('tab-3', 'https://c.com');
      expect(small.trackedCount).toBe(2);
      small.dispose();
    });
  });

  describe('event system', () => {
    it('should emit tabTracked', () => {
      const handler = vi.fn();
      rqm.on(handler);
      rqm.trackTab('tab-1', 'https://example.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'tabTracked', tabId: 'tab-1' }),
      );
    });

    it('should emit tabUntracked', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      const handler = vi.fn();
      rqm.on(handler);
      rqm.untrackTab('tab-1');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'tabUntracked', tabId: 'tab-1' }),
      );
    });

    it('should emit quotaBreached on memory breach', () => {
      const strict = new ResourceQuotaManager({ maxMemoryBytes: 10 });
      strict.trackTab('tab-1', 'https://example.com');
      const handler = vi.fn();
      strict.on(handler);
      strict.updateMemory('tab-1', 100);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'quotaBreached', resourceType: 'memory' }),
      );
      strict.dispose();
    });

    it('should emit quotaFreed on connection release', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.acquireConnection('tab-1');
      const handler = vi.fn();
      rqm.on(handler);
      rqm.releaseConnection('tab-1');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'quotaFreed', resourceType: 'network' }),
      );
    });

    it('should emit evictionTriggered', () => {
      const small = new ResourceQuotaManager({ maxTabs: 1 });
      small.trackTab('tab-1', 'https://a.com');
      const handler = vi.fn();
      small.on(handler);
      small.trackTab('tab-2', 'https://b.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'evictionTriggered' }),
      );
      small.dispose();
    });
  });

  describe('dispose', () => {
    it('should clear state', () => {
      rqm.trackTab('tab-1', 'https://example.com');
      rqm.dispose();
      expect(rqm.trackedCount).toBe(0);
    });
  });
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PrivilegeLevels tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import {
  PrivilegeLevels,
  LEVEL_ORDER,
  DEFAULT_POLICIES,
} from '../src/browser/security/privilege-levels';

describe('PrivilegeLevels', () => {
  let pl: PrivilegeLevels;

  beforeEach(() => {
    pl = new PrivilegeLevels();
  });

  describe('check', () => {
    it('should allow dom for sandboxed-content', () => {
      const result = pl.check('sandboxed-content', 'dom');
      expect(result.allowed).toBe(true);
    });

    it('should deny fetch for sandboxed-content', () => {
      const result = pl.check('sandboxed-content', 'fetch');
      expect(result.allowed).toBe(false);
    });

    it('should allow all APIs for browser-chrome', () => {
      const apis = [
        'dom', 'fetch', 'websocket', 'storage', 'indexed-db', 'cookies',
        'workers', 'shared-workers', 'service-workers', 'notifications',
        'geolocation', 'camera', 'microphone', 'screen-capture', 'payment',
        'midi', 'bluetooth', 'usb', 'nfc', 'file-system', 'file-system-external',
        'process', 'native-messaging', 'clipboard-read', 'clipboard-write',
        'eval', 'timeout-string', 'navigation-top', 'popup', 'pointer-lock',
        'fullscreen', 'dialog', 'print',
      ] as const;
      for (const api of apis) {
        expect(pl.check('browser-chrome', api).allowed).toBe(true);
      }
    });

    it('should deny dom-cross-origin for web-content', () => {
      const result = pl.check('web-content', 'dom-cross-origin');
      expect(result.allowed).toBe(false);
    });

    it('should allow dom-cross-origin for trusted-extension', () => {
      const result = pl.check('trusted-extension', 'dom-cross-origin');
      expect(result.allowed).toBe(true);
    });

    it('should deny camera for trusted-extension', () => {
      const result = pl.check('trusted-extension', 'camera');
      expect(result.allowed).toBe(false);
    });

    it('should deny bluetooth for trusted-extension', () => {
      const result = pl.check('trusted-extension', 'bluetooth');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkPrivilege', () => {
    it('should allow if current level >= required level', () => {
      const result = pl.checkPrivilege('browser-chrome', 'web-content', 'dom');
      expect(result.allowed).toBe(true);
    });

    it('should deny if current level < required level', () => {
      const result = pl.checkPrivilege('web-content', 'browser-chrome', 'process');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient privilege');
    });

    it('should check API surface at the current level', () => {
      // sandboxed-content at web-content required level â†’ still denied because
      // the sandboxed-content policy doesn't allow fetch
      const result = pl.checkPrivilege('sandboxed-content', 'web-content', 'fetch');
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkWithSandbox', () => {
    it('should return normal check for non-sandboxed levels', () => {
      const result = pl.checkWithSandbox('web-content', 'fetch');
      expect(result.allowed).toBe(true);
    });

    it('should allow eval when sandbox permits scripts', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'eval', {
        allowScripts: true,
        allowModals: false,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: false,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('should deny eval when sandbox blocks scripts', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'eval', {
        allowScripts: false,
        allowModals: false,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: false,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(false);
    });

    it('should allow dialog when sandbox permits modals', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'dialog', {
        allowScripts: false,
        allowModals: true,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: false,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow popup when sandbox permits popups', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'popup', {
        allowScripts: false,
        allowModals: false,
        allowForms: false,
        allowPopups: true,
        allowTopNavigation: false,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow navigation-top when sandbox permits top navigation', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'navigation-top', {
        allowScripts: false,
        allowModals: false,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: true,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('should allow pointer-lock when sandbox permits pointer lock', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'pointer-lock', {
        allowScripts: false,
        allowModals: false,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: false,
        allowPointerLock: true,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true);
    });

    it('should fall through to default policy for non-overridden APIs', () => {
      const result = pl.checkWithSandbox('sandboxed-content', 'dom', {
        allowScripts: false,
        allowModals: false,
        allowForms: false,
        allowPopups: false,
        allowTopNavigation: false,
        allowPointerLock: false,
        allowSameOrigin: false,
        allowOrientationLock: false,
        allowPresentation: false,
      });
      expect(result.allowed).toBe(true); // dom is allowed for sandboxed-content by default
    });
  });

  describe('getPolicy', () => {
    it('should return the policy for a level', () => {
      const policy = pl.getPolicy('web-content');
      expect(policy.get('dom')).toBe(true);
      expect(policy.get('fetch')).toBe(true);
      expect(policy.get('camera')).toBe(false);
    });

    it('should return all 4 policies', () => {
      expect(pl.getLevels()).toHaveLength(4);
    });
  });

  describe('getOrder / isSameLevel', () => {
    it('should return correct numeric order', () => {
      expect(pl.getOrder('sandboxed-content')).toBe(0);
      expect(pl.getOrder('web-content')).toBe(1);
      expect(pl.getOrder('trusted-extension')).toBe(2);
      expect(pl.getOrder('browser-chrome')).toBe(3);
    });

    it('should detect same level', () => {
      expect(pl.isSameLevel('web-content', 'web-content')).toBe(true);
      expect(pl.isSameLevel('web-content', 'browser-chrome')).toBe(false);
    });
  });

  describe('custom policies', () => {
    it('should apply custom policy overrides', () => {
      const custom = new PrivilegeLevels({
        customPolicies: {
          'web-content': new Map([
            ['camera', true], // override: allow camera for web-content
          ]),
        },
      });
      expect(custom.check('web-content', 'camera').allowed).toBe(true);
      // Other APIs unchanged
      expect(custom.check('web-content', 'dom').allowed).toBe(true);
      expect(custom.check('web-content', 'bluetooth').allowed).toBe(false);
    });
  });

  describe('LEVEL_ORDER constant', () => {
    it('should have 4 levels', () => {
      expect(Object.keys(LEVEL_ORDER)).toHaveLength(4);
    });
  });

  describe('DEFAULT_POLICIES constant', () => {
    it('should have 4 levels', () => {
      expect(Object.keys(DEFAULT_POLICIES)).toHaveLength(4);
    });
  });
});
