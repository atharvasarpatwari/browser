import { describe, it, expect, vi } from 'vitest';
import { AdBlocker, AD_FILTER_RULES, AD_ELEMENT_SELECTORS } from '../src/browser/security/ad-blocker';

describe('AdBlocker', () => {
  describe('initial state', () => {
    it('should be enabled by default', () => {
      const blocker = new AdBlocker();
      expect(blocker.enabled).toBe(true);
    });

    it('should have zero blocked ads initially', () => {
      const blocker = new AdBlocker();
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });

    it('should have filter rules loaded', () => {
      expect(AD_FILTER_RULES.length).toBeGreaterThan(50);
    });

    it('should have element selectors loaded', () => {
      expect(AD_ELEMENT_SELECTORS.length).toBeGreaterThan(15);
    });
  });

  describe('shouldBlock', () => {
    it('should block known ad domains', () => {
      const blocker = new AdBlocker();
      const urls = [
        'https://doubleclick.net/ads/test',
        'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
        'https://adservice.google.com/getcookie',
        'https://cdn.taboola.com/libtrc/test',
        'https://outbrain.com/widgets/test',
        'https://popads.net/pop/test',
        'https://propellerads.com/ad/test',
        'https://securepubads.g.doubleclick.net/gampad/ads',
      ];
      for (const url of urls) {
        expect(blocker.shouldBlock(url).blocked).toBe(true);
      }
    });

    it('should not block normal websites', () => {
      const blocker = new AdBlocker();
      const urls = [
        'https://example.com',
        'https://github.com/opencode-ai',
        'https://www.google.com/search?q=test',
        'https://stackoverflow.com/questions/1',
        'https://en.wikipedia.org/wiki/TypeScript',
      ];
      for (const url of urls) {
        expect(blocker.shouldBlock(url).blocked).toBe(false);
      }
    });

    it('should not block when disabled', () => {
      const blocker = new AdBlocker();
      blocker.setEnabled(false);
      expect(blocker.shouldBlock('https://doubleclick.net/ads/test').blocked).toBe(false);
    });

    it('should return the matching rule', () => {
      const blocker = new AdBlocker();
      const result = blocker.shouldBlock('https://doubleclick.net/ads/test');
      expect(result.blocked).toBe(true);
      expect(result.match).toBeDefined();
      expect(result.match!.rule.category).toBe('banner');
      expect(result.match!.matchedPattern).toBe('doubleclick.net');
    });

    it('should block by path patterns', () => {
      const blocker = new AdBlocker();
      const urls = [
        'https://newsite.com/pagead/test',
        'https://blog.example.com/sponsored/post',
        'https://test.com/ad/placement',
        'https://example.com/ads/tracking',
      ];
      for (const url of urls) {
        expect(blocker.shouldBlock(url).blocked).toBe(true);
      }
    });

    it('should block known sponsored category', () => {
      const blocker = new AdBlocker();
      const result = blocker.shouldBlock('https://example.com/sponsored/content');
      expect(result.blocked).toBe(true);
      expect(result.match!.rule.category).toBe('sponsored');
    });
  });

  describe('element selectors', () => {
    it('should return element selectors for DOM blocking', () => {
      const blocker = new AdBlocker();
      const selectors = blocker.getElementSelectors();
      expect(selectors.length).toBe(AD_ELEMENT_SELECTORS.length);
      expect(selectors.some(s => s.selector.includes('adsbygoogle'))).toBe(true);
      expect(selectors.some(s => s.selector.includes('doubleclick'))).toBe(true);
    });
  });

  describe('recordBlocked and stats', () => {
    it('should record blocked ads', () => {
      const blocker = new AdBlocker();
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(blocker.totalBlocked).toBe(1);
      expect(blocker.blockedAds).toHaveLength(1);
      expect(blocker.blockedAds[0]!.url).toBe('https://doubleclick.net/ads/test');
      expect(blocker.blockedAds[0]!.category).toBe('banner');
    });

    it('should track counts by category', () => {
      const blocker = new AdBlocker();
      const adMatch = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      const nativeMatch = blocker.shouldBlock('https://taboola.com/widget').match!;
      const popupMatch = blocker.shouldBlock('https://popads.net/ad').match!;
      blocker.recordBlocked(adMatch, 'script');
      blocker.recordBlocked(nativeMatch, 'iframe');
      blocker.recordBlocked(popupMatch, 'popup');
      const byCategory = blocker.getBlockedByCategory();
      expect(byCategory['banner']).toBe(1);
      expect(byCategory['native']).toBe(1);
      expect(byCategory['popup']).toBe(1);
      expect(byCategory['video']).toBe(0);
    });
  });

  describe('clearStats', () => {
    it('should reset all stats', () => {
      const blocker = new AdBlocker();
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      blocker.clearStats();
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });
  });

  describe('custom rules', () => {
    it('should allow adding custom rules', () => {
      const blocker = new AdBlocker();
      blocker.addCustomRule({ pattern: 'my-custom-ad.com', category: 'banner', description: 'Custom ad domain' });
      expect(blocker.shouldBlock('https://my-custom-ad.com/test').blocked).toBe(true);
    });

    it('should allow removing custom rules', () => {
      const blocker = new AdBlocker();
      blocker.addCustomRule({ pattern: 'temporary-ad.com', category: 'banner', description: 'Temporary' });
      blocker.removeCustomRule('temporary-ad.com');
      expect(blocker.shouldBlock('https://temporary-ad.com/test').blocked).toBe(false);
    });
  });

  describe('events', () => {
    it('should emit adBlocked event when recording', () => {
      const blocker = new AdBlocker();
      const handler = vi.fn();
      blocker.on('adBlocked', handler);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should emit toggled event', () => {
      const blocker = new AdBlocker();
      const handler = vi.fn();
      blocker.on('adBlockerToggled', handler);
      blocker.setEnabled(false);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should stop emitting after off()', () => {
      const blocker = new AdBlocker();
      const handler = vi.fn();
      blocker.on('adBlocked', handler);
      blocker.off('adBlocked', handler);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should clear all state', () => {
      const blocker = new AdBlocker();
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      blocker.dispose();
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });
  });
});
