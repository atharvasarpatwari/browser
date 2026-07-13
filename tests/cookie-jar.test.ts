import { describe, it, expect, beforeEach } from 'vitest';
import {
  CookieJar,
  SameSitePolicy,
  CookieOverflowError,
} from '../src/browser/netwroking/cookie-jar';

describe('CookieJar', () => {
  let jar: CookieJar;

  beforeEach(() => {
    jar = new CookieJar();
  });

  describe('setFromResponse', () => {
    it('should parse and store a simple cookie', () => {
      const count = jar.setFromResponse('https://example.com', [
        'session=abc123; Path=/; HttpOnly; Secure',
      ]);
      expect(count).toBe(1);
    });

    it('should parse Domain attribute', () => {
      jar.setFromResponse('https://example.com', [
        'id=123; Domain=.example.com; Path=/',
      ]);
      const cookies = jar.getForRequest('https://sub.example.com');
      expect(cookies.length).toBe(1);
      expect(cookies[0]!.name).toBe('id');
    });

    it('should parse SameSite attribute', () => {
      jar.setFromResponse('https://example.com', [
        'csrf=tok; SameSite=Strict; Path=/',
      ]);
      const all = jar.getAll();
      expect(all.length).toBe(1);
      expect(all[0]!.sameSite).toBe(SameSitePolicy.Strict);
    });

    it('should parse Max-Age attribute', () => {
      jar.setFromResponse('https://example.com', [
        'temp=val; Max-Age=3600; Path=/',
      ]);
      const all = jar.getAll();
      expect(all.length).toBe(1);
      expect(all[0]!.maxAge).toBe(3600);
    });

    it('should parse Expires attribute', () => {
      const futureDate = new Date(Date.now() + 86400000).toUTCString();
      jar.setFromResponse('https://example.com', [
        `exp=val; Expires=${futureDate}; Path=/`,
      ]);
      const all = jar.getAll();
      expect(all.length).toBe(1);
      expect(all[0]!.expires).not.toBeNull();
    });

    it('should reject cookies with mismatched domain', () => {
      jar.setFromResponse('https://example.com', [
        'id=1; Domain=other.com; Path=/',
      ]);
      const cookies = jar.getForRequest('https://example.com');
      expect(cookies.length).toBe(0);
    });

    it('should accept host-only cookies for the exact domain', () => {
      jar.setFromResponse('https://example.com', [
        'id=1; Path=/',
      ]);
      const cookies = jar.getForRequest('https://example.com');
      expect(cookies.length).toBe(1);
    });

    it('should reject host-only cookies for different domains', () => {
      jar.setFromResponse('https://example.com', [
        'id=1; Path=/',
      ]);
      const cookies = jar.getForRequest('https://other.com');
      expect(cookies.length).toBe(0);
    });

    it('should return 0 for empty set-cookie headers', () => {
      expect(jar.setFromResponse('https://example.com', [])).toBe(0);
    });
  });

  describe('getForRequest', () => {
    it('should only return secure cookies over HTTPS', () => {
      jar.setFromResponse('https://example.com', [
        'secure=1; Secure; Path=/',
        'insecure=0; Path=/',
      ]);

      const httpsCookies = jar.getForRequest('https://example.com');
      expect(httpsCookies.length).toBe(2);

      const httpCookies = jar.getForRequest('http://example.com');
      expect(httpCookies.length).toBe(1);
      expect(httpCookies[0]!.name).toBe('insecure');
    });

    it('should respect path matching', () => {
      jar.setFromResponse('https://example.com', [
        'page=1; Path=/page/',
        'root=1; Path=/',
      ]);

      const pageCookies = jar.getForRequest('https://example.com/page/sub');
      expect(pageCookies.length).toBe(2);

      const rootOnly = jar.getForRequest('https://example.com/other');
      expect(rootOnly.length).toBe(1);
      expect(rootOnly[0]!.name).toBe('root');
    });

    it('should sort by longer path first', () => {
      jar.setFromResponse('https://example.com', [
        'a=1; Path=/',
        'b=2; Path=/app/',
      ]);

      const cookies = jar.getForRequest('https://example.com/app/page');
      expect(cookies[0]!.name).toBe('b'); // Longer path first.
    });

    it('should not return expired cookies', () => {
      jar.setFromResponse('https://example.com', [
        'alive=1; Max-Age=9999; Path=/',
        'dead=0; Max-Age=0; Path=/',
      ]);
      const cookies = jar.getForRequest('https://example.com');
      expect(cookies.find(c => c.name === 'dead')).toBeUndefined();
    });
  });

  describe('getCookieHeader', () => {
    it('should format cookie header string', () => {
      jar.setFromResponse('https://example.com', [
        'a=1; Path=/',
        'b=2; Path=/',
      ]);
      const header = jar.getCookieHeader('https://example.com');
      expect(header).toContain('a=1');
      expect(header).toContain('b=2');
      expect(header).toContain('; ');
    });

    it('should return empty string when no cookies', () => {
      expect(jar.getCookieHeader('https://example.com')).toBe('');
    });
  });

  describe('get', () => {
    it('should get a specific cookie by name', () => {
      jar.setFromResponse('https://example.com', [
        'session=abc; Path=/',
        'theme=dark; Path=/',
      ]);
      const cookie = jar.get('https://example.com', 'session');
      expect(cookie).not.toBeNull();
      expect(cookie!.value).toBe('abc');
    });

    it('should return null for non-existent cookie', () => {
      expect(jar.get('https://example.com', 'missing')).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete a specific cookie', () => {
      jar.setFromResponse('https://example.com', [
        'a=1; Path=/',
        'b=2; Path=/',
      ]);
      expect(jar.delete('https://example.com', 'a')).toBe(true);
      const cookies = jar.getForRequest('https://example.com');
      expect(cookies.length).toBe(1);
      expect(cookies[0]!.name).toBe('b');
    });
  });

  describe('deleteDomain', () => {
    it('should delete all cookies for a domain', () => {
      jar.setFromResponse('https://example.com', ['a=1; Path=/']);
      jar.setFromResponse('https://other.com', ['b=2; Path=/']);
      const count = jar.deleteDomain('example.com');
      expect(count).toBe(1);
      expect(jar.getForRequest('https://other.com').length).toBe(1);
    });
  });

  describe('prune', () => {
    it('should remove expired cookies', () => {
      jar.setFromResponse('https://example.com', [
        'alive=1; Max-Age=9999; Path=/',
        'dead=0; Max-Age=0; Path=/',
      ]);
      const pruned = jar.prune();
      expect(pruned).toBe(1);
      expect(jar.getForRequest('https://example.com').length).toBe(1);
    });
  });

  describe('stats', () => {
    it('should return correct stats', () => {
      jar.setFromResponse('https://a.com', ['x=1; Path=/']);
      jar.setFromResponse('https://b.com', ['y=2; Max-Age=3600; Path=/']);

      const stats = jar.getStats();
      expect(stats.totalCookies).toBe(2);
      expect(stats.uniqueDomains).toBe(2);
      expect(stats.sessionCookies).toBe(1);
      expect(stats.persistentCookies).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all cookies', () => {
      jar.setFromResponse('https://example.com', ['a=1; Path=/']);
      jar.clear();
      expect(jar.getStats().totalCookies).toBe(0);
    });
  });

  describe('dispose', () => {
    it('should clear everything', () => {
      jar.setFromResponse('https://example.com', ['a=1; Path=/']);
      jar.dispose();
      expect(jar.getStats().totalCookies).toBe(0);
    });
  });
});
