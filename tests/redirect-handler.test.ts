import { describe, it, expect, beforeEach } from 'vitest';
import {
  RedirectHandler,
  RedirectStatusCode,
  RedirectValidationResult,
  RedirectLoopError,
  RedirectBlockedError,
} from '../src/browser/netwroking/redirect-handler';

describe('RedirectHandler', () => {
  let handler: RedirectHandler;

  beforeEach(() => {
    handler = new RedirectHandler();
  });

  describe('validate', () => {
    it('should allow a simple redirect', () => {
      const result = handler.validate(
        'http://old.com',
        'http://new.com',
        RedirectStatusCode.MovedPermanently,
        [],
      );
      expect(result).toBe(RedirectValidationResult.Allowed);
    });

    it('should block redirects beyond max hops', () => {
      const hops = Array.from({ length: 10 }, (_, i) => ({
        fromUrl: `http://h${i}.com`,
        toUrl: `http://h${i + 1}.com`,
        statusCode: RedirectStatusCode.Found,
        timestamp: Date.now(),
        protocolChange: false,
        hostnameChange: true,
      }));

      const result = handler.validate(
        'http://h10.com',
        'http://h11.com',
        RedirectStatusCode.Found,
        hops,
      );
      expect(result).toBe(RedirectValidationResult.TooManyHops);
    });

    it('should block javascript: protocol', () => {
      const result = handler.validate(
        'http://example.com',
        'javascript:alert(1)',
        RedirectStatusCode.Found,
        [],
      );
      expect(result).toBe(RedirectValidationResult.ProtocolBlocked);
    });

    it('should block self-redirect (infinite loop)', () => {
      const result = handler.validate(
        'http://loop.com',
        'http://loop.com',
        RedirectStatusCode.Found,
        [],
      );
      expect(result).toBe(RedirectValidationResult.InfiniteLoop);
    });

    it('should detect redirect loops in chain', () => {
      const hops = [{
        fromUrl: 'http://a.com',
        toUrl: 'http://b.com',
        statusCode: RedirectStatusCode.Found,
        timestamp: Date.now(),
        protocolChange: false,
        hostnameChange: true,
      }];

      const result = handler.validate(
        'http://b.com',
        'http://a.com',
        RedirectStatusCode.Found,
        hops,
      );
      expect(result).toBe(RedirectValidationResult.InfiniteLoop);
    });

    it('should detect HTTPS→HTTP downgrade', () => {
      const result = handler.validate(
        'https://secure.com',
        'http://insecure.com',
        RedirectStatusCode.Found,
        [],
      );
      expect(result).toBe(RedirectValidationResult.Blocked);
    });

    it('should allow HTTP→HTTPS upgrade (HSTS)', () => {
      const result = handler.validate(
        'http://upgrade.com',
        'https://upgrade.com',
        RedirectStatusCode.MovedPermanently,
        [],
      );
      expect(result).toBe(RedirectValidationResult.HstsUpgrade);
    });

    it('should block disallowed status codes', () => {
      const result = handler.validate(
        'http://a.com',
        'http://b.com',
        399 as RedirectStatusCode,
        [],
      );
      expect(result).toBe(RedirectValidationResult.Blocked);
    });

    it('should block cross-origin when disabled', () => {
      const strictHandler = new RedirectHandler({ allowCrossOrigin: false });
      const result = strictHandler.validate(
        'http://a.com',
        'http://b.com',
        RedirectStatusCode.Found,
        [],
      );
      expect(result).toBe(RedirectValidationResult.CrossOrigin);
    });
  });

  describe('buildChain', () => {
    it('should build a redirect chain', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'http://b.com', RedirectStatusCode.Found),
        RedirectHandler.createHop('http://b.com', 'http://c.com', RedirectStatusCode.Found),
      ];

      const chain = handler.buildChain('http://a.com', hops);
      expect(chain.startUrl).toBe('http://a.com');
      expect(chain.finalUrl).toBe('http://c.com');
      expect(chain.hopCount).toBe(2);
    });

    it('should detect protocol changes', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'https://a.com', RedirectStatusCode.MovedPermanently),
      ];
      const chain = handler.buildChain('http://a.com', hops);
      expect(chain.hadProtocolChange).toBe(true);
    });

    it('should detect hostname changes', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'http://b.com', RedirectStatusCode.Found),
      ];
      const chain = handler.buildChain('http://a.com', hops);
      expect(chain.hadHostnameChange).toBe(true);
    });
  });

  describe('hasLoop', () => {
    it('should detect no loop for simple chain', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'http://b.com', RedirectStatusCode.Found),
        RedirectHandler.createHop('http://b.com', 'http://c.com', RedirectStatusCode.Found),
      ];
      expect(handler.hasLoop(hops)).toBe(false);
    });

    it('should detect loop when last hop targets first', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'http://b.com', RedirectStatusCode.Found),
        RedirectHandler.createHop('http://b.com', 'http://c.com', RedirectStatusCode.Found),
        RedirectHandler.createHop('http://c.com', 'http://a.com', RedirectStatusCode.Found),
      ];
      expect(handler.hasLoop(hops)).toBe(true);
    });

    it('should detect repeated URL in chain', () => {
      const hops = [
        RedirectHandler.createHop('http://a.com', 'http://b.com', RedirectStatusCode.Found),
        RedirectHandler.createHop('http://b.com', 'http://a.com', RedirectStatusCode.Found),
      ];
      expect(handler.hasLoop(hops)).toBe(true);
    });
  });

  describe('policy', () => {
    it('should return and update policy', () => {
      const policy = handler.getPolicy();
      expect(policy.maxHops).toBe(10);

      handler.updatePolicy({ maxHops: 5 });
      expect(handler.getPolicy().maxHops).toBe(5);
    });
  });

  describe('stats', () => {
    it('should track redirect stats', () => {
      handler.validate('http://a.com', 'http://b.com', RedirectStatusCode.Found, []);
      handler.validate('http://x.com', 'javascript:alert(1)', RedirectStatusCode.Found, []);

      const stats = handler.getStats();
      expect(stats.totalRedirects).toBe(2);
      expect(stats.blockedRedirects).toBe(1);
    });
  });

  describe('errors', () => {
    it('should create RedirectLoopError', () => {
      const err = new RedirectLoopError([]);
      expect(err.name).toBe('RedirectLoopError');
    });

    it('should create RedirectBlockedError', () => {
      const err = new RedirectBlockedError('a.com', 'b.com', RedirectValidationResult.Blocked);
      expect(err.name).toBe('RedirectBlockedError');
      expect(err.reason).toBe(RedirectValidationResult.Blocked);
    });
  });

  describe('dispose', () => {
    it('should clear stats', () => {
      handler.validate('http://a.com', 'http://b.com', RedirectStatusCode.Found, []);
      handler.dispose();
      expect(handler.getStats().totalRedirects).toBe(0);
    });
  });
});
