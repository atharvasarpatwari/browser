import { describe, it, expect, vi } from 'vitest';
import { ThirdPartySecurityManager, DEFAULT_THIRD_PARTY_CONFIG, ISOLATED_IFRAME_PERMISSIONS, RESTRICTED_IFRAME_PERMISSIONS, STRICT_CSP_DIRECTIVES, extractOrigin } from '../src/browser/security/third-party-security';

describe('ThirdPartySecurityManager', () => {
  describe('initial state', () => {
    it('should be created with default config', () => {
      const mgr = new ThirdPartySecurityManager();
      expect(mgr.config.iframePolicy).toBe('isolate');
      expect(mgr.config.scriptPolicy).toBe('restrict');
      expect(mgr.config.cookiePolicy).toBe('block');
      expect(mgr.config.storagePolicy).toBe('block');
      expect(mgr.config.fetchPolicy).toBe('restrict');
      expect(mgr.config.popupPolicy).toBe('block');
    });

    it('should have zero blocked requests initially', () => {
      const mgr = new ThirdPartySecurityManager();
      expect(mgr.totalBlocked).toBe(0);
      expect(mgr.blockedRequests).toHaveLength(0);
    });
  });

  describe('extractOrigin', () => {
    it('should extract origin from a URL', () => {
      expect(extractOrigin('https://example.com/path')).toBe('https://example.com');
      expect(extractOrigin('http://sub.example.com:8080/test')).toBe('http://sub.example.com:8080');
    });

    it('should return the input for invalid URLs', () => {
      expect(extractOrigin('not-a-url')).toBe('not-a-url');
    });
  });

  describe('iframe security', () => {
    it('should allow same-origin iframes', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkIframeAllowed('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block third-party iframes by default', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      expect(result.allowed).toBe(true);
      expect(result.sandbox).toBeDefined();
    });

    it('should apply isolated sandbox permissions', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      expect(result.sandbox!.allowScripts).toBe(false);
      expect(result.sandbox!.allowPopups).toBe(false);
      expect(result.sandbox!.allowTopNavigation).toBe(false);
    });

    it('should block iframes when policy is block', () => {
      const mgr = new ThirdPartySecurityManager({ iframePolicy: 'block' });
      const result = mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      expect(result.allowed).toBe(false);
      expect(mgr.totalBlocked).toBe(1);
    });

    it('should allow iframes from trusted origins', () => {
      const mgr = new ThirdPartySecurityManager({ allowTrustedOrigins: ['https://trusted-cdn.com'] });
      const result = mgr.checkIframeAllowed('https://trusted-cdn.com', 'https://example.com');
      expect(result.allowed).toBe(true);
      expect(result.sandbox).toBeUndefined();
    });
  });

  describe('script security', () => {
    it('should allow same-origin scripts', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkScriptAllowed('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block third-party scripts from fingerprinting domains', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkScriptAllowed('https://fingerprintjs.com', 'https://example.com');
      expect(result.allowed).toBe(false);
      expect(mgr.totalBlocked).toBe(1);
    });

    it('should block all third-party scripts when policy is block', () => {
      const mgr = new ThirdPartySecurityManager({ scriptPolicy: 'block' });
      const result = mgr.checkScriptAllowed('https://cdn.example-tracker.com', 'https://example.com');
      expect(result.allowed).toBe(false);
    });

    it('should allow third-party scripts when policy is allow', () => {
      const mgr = new ThirdPartySecurityManager({ scriptPolicy: 'allow' });
      const result = mgr.checkScriptAllowed('https://cdn.example-tracker.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });
  });

  describe('cookie security', () => {
    it('should allow same-origin cookies', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkCookieAccess('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block third-party cookies by default', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkCookieAccess('https://tracker.com', 'https://example.com');
      expect(result.allowed).toBe(false);
    });

    it('should allow cookies from trusted origins', () => {
      const mgr = new ThirdPartySecurityManager({ allowTrustedOrigins: ['https://tracker.com'] });
      const result = mgr.checkCookieAccess('https://tracker.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });
  });

  describe('storage security', () => {
    it('should allow same-origin storage', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkStorageAccess('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block third-party storage by default', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkStorageAccess('https://tracker.com', 'https://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  describe('fetch security', () => {
    it('should allow same-origin fetches', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkFetchAllowed('https://example.com', 'https://example.com', 'https://example.com/api');
      expect(result.allowed).toBe(true);
    });

    it('should restrict third-party fetches', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkFetchAllowed('https://tracker.com', 'https://example.com', 'https://tracker.com/pixel');
      expect(result.allowed).toBe(true);
    });

    it('should block third-party fetches to fingerprinting endpoints', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkFetchAllowed('https://fingerprintjs.com', 'https://example.com', 'https://fingerprintjs.com/api');
      expect(result.allowed).toBe(false);
    });

    it('should block all third-party fetches when policy is block', () => {
      const mgr = new ThirdPartySecurityManager({ fetchPolicy: 'block' });
      const result = mgr.checkFetchAllowed('https://api.other.com', 'https://example.com', 'https://api.other.com/data');
      expect(result.allowed).toBe(false);
    });
  });

  describe('popup security', () => {
    it('should allow same-origin popups when policy is not block', () => {
      const mgr = new ThirdPartySecurityManager({ popupPolicy: 'restrict' });
      const result = mgr.checkPopupAllowed('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(true);
    });

    it('should block same-origin popups when policy is block', () => {
      const mgr = new ThirdPartySecurityManager({ popupPolicy: 'block' });
      const result = mgr.checkPopupAllowed('https://example.com', 'https://example.com');
      expect(result.allowed).toBe(false);
    });

    it('should block third-party popups by default', () => {
      const mgr = new ThirdPartySecurityManager();
      const result = mgr.checkPopupAllowed('https://popup-ads.com', 'https://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  describe('trusted origins', () => {
    it('should check if origin is trusted', () => {
      const mgr = new ThirdPartySecurityManager({ allowTrustedOrigins: ['https://trusted.com'] });
      expect(mgr.isTrustedOrigin('https://trusted.com')).toBe(true);
      expect(mgr.isTrustedOrigin('https://untrusted.com')).toBe(false);
    });

    it('should allow adding trusted origins', () => {
      const mgr = new ThirdPartySecurityManager();
      mgr.addTrustedOrigin('https://new-trusted.com');
      expect(mgr.isTrustedOrigin('https://new-trusted.com')).toBe(true);
    });

    it('should allow removing trusted origins', () => {
      const mgr = new ThirdPartySecurityManager({ allowTrustedOrigins: ['https://remove-me.com'] });
      mgr.removeTrustedOrigin('https://remove-me.com');
      expect(mgr.isTrustedOrigin('https://remove-me.com')).toBe(false);
    });
  });

  describe('CSP directives', () => {
    it('should return strict CSP when enabled', () => {
      const mgr = new ThirdPartySecurityManager({ enforceStrictCSP: true });
      const csp = mgr.getStrictCSPDirectives();
      expect(csp['default-src']).toBe("'self'");
      expect(csp['script-src']).toBe("'self'");
      expect(csp['object-src']).toBe("'none'");
      expect(csp['frame-ancestors']).toBe("'none'");
    });

    it('should return empty CSP when disabled', () => {
      const mgr = new ThirdPartySecurityManager({ enforceStrictCSP: false });
      const csp = mgr.getStrictCSPDirectives();
      expect(Object.keys(csp)).toHaveLength(0);
    });
  });

  describe('fingerprinting protection', () => {
    it('should identify fingerprinting domains', () => {
      const mgr = new ThirdPartySecurityManager();
      expect(mgr.shouldBlockFingerprinting('https://fingerprintjs.com/script.js')).toBe(true);
      expect(mgr.shouldBlockFingerprinting('https://fpjs.io/api')).toBe(true);
      expect(mgr.shouldBlockFingerprinting('https://api.fpjs.io/track')).toBe(true);
      expect(mgr.shouldBlockFingerprinting('https://example.com')).toBe(false);
    });

    it('should not block fingerprinting when disabled', () => {
      const mgr = new ThirdPartySecurityManager({ blockFingerprinting: false });
      expect(mgr.shouldBlockFingerprinting('https://fingerprintjs.com/script.js')).toBe(false);
    });
  });

  describe('iframe sandbox permissions', () => {
    it('should return isolated permissions for third-party iframes', () => {
      const mgr = new ThirdPartySecurityManager();
      const perms = mgr.getIframeSandboxPermissions('https://ads.com', 'https://example.com');
      expect(perms.allowScripts).toBe(false);
      expect(perms.allowSameOrigin).toBe(false);
    });

    it('should return full permissions for trusted origins', () => {
      const mgr = new ThirdPartySecurityManager({ allowTrustedOrigins: ['https://trusted.com'] });
      const perms = mgr.getIframeSandboxPermissions('https://trusted.com', 'https://example.com');
      expect(perms.allowScripts).toBe(true);
      expect(perms.allowPopups).toBe(true);
    });

    it('should return full permissions for same-origin', () => {
      const mgr = new ThirdPartySecurityManager();
      const perms = mgr.getIframeSandboxPermissions('https://example.com', 'https://example.com');
      expect(perms.allowScripts).toBe(true);
    });
  });

  describe('config updates', () => {
    it('should update config partially', () => {
      const mgr = new ThirdPartySecurityManager();
      mgr.updateConfig({ cookiePolicy: 'allow', scriptPolicy: 'allow' });
      expect(mgr.config.cookiePolicy).toBe('allow');
      expect(mgr.config.scriptPolicy).toBe('allow');
      expect(mgr.config.iframePolicy).toBe('isolate');
    });

    it('should emit configChanged event', () => {
      const mgr = new ThirdPartySecurityManager();
      const handler = vi.fn();
      mgr.on('configChanged', handler);
      mgr.updateConfig({ cookiePolicy: 'allow' });
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('events', () => {
    it('should emit thirdPartyBlocked when blocking', () => {
      const mgr = new ThirdPartySecurityManager({ iframePolicy: 'block' });
      const handler = vi.fn();
      mgr.on('thirdPartyBlocked', handler);
      mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should include block details in event', () => {
      const mgr = new ThirdPartySecurityManager({ iframePolicy: 'block' });
      const handler = vi.fn();
      mgr.on('thirdPartyBlocked', handler);
      mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      const event = handler.mock.calls[0]![0];
      expect(event.kind).toBe('thirdPartyBlocked');
      expect(event.blocked.blockType).toBe('iframe');
      expect(event.blocked.origin).toBe('https://ads.com');
    });
  });

  describe('dispose', () => {
    it('should clear all state', () => {
      const mgr = new ThirdPartySecurityManager({ iframePolicy: 'block' });
      mgr.checkIframeAllowed('https://ads.com', 'https://example.com');
      mgr.dispose();
      expect(mgr.totalBlocked).toBe(0);
      expect(mgr.blockedRequests).toHaveLength(0);
    });
  });
});
