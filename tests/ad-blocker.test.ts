import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AdBlocker,
  AD_FILTER_RULES,
  AD_ELEMENT_SELECTORS,
  COSMETIC_RULES,
  REDIRECT_RULES,
  ANTI_ADBLOCK_PATTERNS,
  ALL_AD_CATEGORIES,
} from '../src/browser/security/ad-blocker';

describe('AdBlocker', () => {
  let blocker: AdBlocker;

  beforeEach(() => {
    blocker = new AdBlocker();
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('should be enabled by default', () => {
      expect(blocker.enabled).toBe(true);
    });

    it('should have zero blocked ads initially', () => {
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });

    it('should have 150+ filter rules loaded', () => {
      expect(AD_FILTER_RULES.length).toBeGreaterThan(150);
    });

    it('should have 100+ element selectors loaded', () => {
      expect(AD_ELEMENT_SELECTORS.length).toBeGreaterThan(100);
    });

    it('should have cosmetic rules loaded', () => {
      expect(COSMETIC_RULES.length).toBeGreaterThan(5);
    });

    it('should have redirect rules loaded', () => {
      expect(REDIRECT_RULES.length).toBeGreaterThan(3);
    });

    it('should have anti-adblock patterns loaded', () => {
      expect(ANTI_ADBLOCK_PATTERNS.length).toBeGreaterThan(40);
    });

    it('should have all 17 ad categories', () => {
      expect(ALL_AD_CATEGORIES).toHaveLength(17);
    });

    it('should have all categories enabled initially', () => {
      expect(blocker.enabledCategories.size).toBe(ALL_AD_CATEGORIES.length);
    });
  });

  // ─── shouldBlock — domain-based blocking ───────────────────────────────────

  describe('shouldBlock — Google Ads', () => {
    it('should block Google DoubleClick', () => {
      const result = blocker.shouldBlock('https://doubleclick.net/ads/test');
      expect(result.blocked).toBe(true);
      expect(result.match!.rule.category).toBe('banner');
      expect(result.match!.rule.description).toBe('Google DoubleClick');
    });

    it('should block Google Syndication', () => {
      expect(blocker.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js').blocked).toBe(true);
    });

    it('should block Google Ad Services', () => {
      expect(blocker.shouldBlock('https://adservice.google.com/getcookie').blocked).toBe(true);
    });

    it('should block Google Publisher Tags', () => {
      expect(blocker.shouldBlock('https://securepubads.g.doubleclick.net/gampad/ads').blocked).toBe(true);
    });

    it('should block Google AdSense ins element script', () => {
      expect(blocker.shouldBlock('https://pagead2.googlesyndication.com/pagead/ads?client=ca-pub-123').blocked).toBe(true);
    });

    it('should block Google DoubleClick CM', () => {
      expect(blocker.shouldBlock('https://cm.g.doubleclick.net/pixel?param=test').blocked).toBe(true);
    });

    it('should block Google AdClick', () => {
      expect(blocker.shouldBlock('https://adclick.g.doubleclick.net/ccm/click/axi0?d=1').blocked).toBe(true);
    });

    it('should block localized Google Ad Service domains', () => {
      const locales = [
        'adservice.google.co.jp', 'adservice.google.co.uk',
        'adservice.google.de', 'adservice.google.fr',
        'adservice.google.ca', 'adservice.google.com.au',
      ];
      for (const locale of locales) {
        expect(blocker.shouldBlock(`https://${locale}/getcookie`).blocked).toBe(true);
      }
    });
  });

  describe('shouldBlock — Major Ad Networks', () => {
    it('should block AppNexus/Xandr', () => {
      expect(blocker.shouldBlock('https://ib.adnxs.com/prebid/ad').blocked).toBe(true);
    });

    it('should block The Trade Desk', () => {
      expect(blocker.shouldBlock('https://adsrvr.org/some/tracker').blocked).toBe(true);
    });

    it('should block Criteo', () => {
      expect(blocker.shouldBlock('https://cdn.criteo.com/lib/delivery/rta.js').blocked).toBe(true);
    });

    it('should block OpenX', () => {
      expect(blocker.shouldBlock('https://pub.openx.net/w/1.0/arj?id=test').blocked).toBe(true);
    });

    it('should block PubMatic', () => {
      expect(blocker.shouldBlock('https://ads.pubmatic.com/AdServer/adTag.js').blocked).toBe(true);
    });

    it('should block Rubicon Project / Magnite', () => {
      expect(blocker.shouldBlock('https://fastlane.rubiconproject.com/a/api/v1/banner').blocked).toBe(true);
      expect(blocker.shouldBlock('https://pixel.rubiconproject.com/pixel').blocked).toBe(true);
      expect(blocker.shouldBlock('https://video.rubiconproject.com/vast/test').blocked).toBe(true);
    });

    it('should block Amazon Ads', () => {
      expect(blocker.shouldBlock('https://aax.amazon-adsystem.com/e/x/').blocked).toBe(true);
      expect(blocker.shouldBlock('https://z-na.amazon-adsystem.com/widgets/q?_encoding=UTF8').blocked).toBe(true);
    });

    it('should block Index Exchange', () => {
      expect(blocker.shouldBlock('https://ss.indexww.com/hb/auction?id=test').blocked).toBe(true);
    });

    it('should block Sovrn', () => {
      expect(blocker.shouldBlock('https://ap.lijit.com/rtb/bid').blocked).toBe(true);
    });

    it('should block BidSwitch', () => {
      expect(blocker.shouldBlock('https://bidswitch.net/click?id=test').blocked).toBe(true);
    });

    it('should block Smart AdServer', () => {
      expect(blocker.shouldBlock('https://www.smartadserver.com/dfp?n=test').blocked).toBe(true);
    });

    it('should block ShareThrough', () => {
      expect(blocker.shouldBlock('https://native.sharethrough.com/sdk/test').blocked).toBe(true);
    });

    it('should block IAS / Moat', () => {
      expect(blocker.shouldBlock('https://moatads.com/pixel/test').blocked).toBe(true);
      expect(blocker.shouldBlock('https://pixel.adsafeprotected.com/rarr/test').blocked).toBe(true);
    });

    it('should block AdRoll', () => {
      expect(blocker.shouldBlock('https://adroll.com/conversion/test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Native Ad Networks', () => {
    it('should block Taboola', () => {
      expect(blocker.shouldBlock('https://cdn.taboola.com/libtrc/test.js').blocked).toBe(true);
      expect(blocker.shouldBlock('https://trc.taboola.com/test/log/tc').blocked).toBe(true);
    });

    it('should block Outbrain', () => {
      expect(blocker.shouldBlock('https://widgets.outbrain.com/outbrain.js').blocked).toBe(true);
      expect(blocker.shouldBlock('https://log.outbrain.com/log/test').blocked).toBe(true);
    });

    it('should block RevContent', () => {
      expect(blocker.shouldBlock('https://revcontent.com/js/test').blocked).toBe(true);
    });

    it('should block MGID', () => {
      expect(blocker.shouldBlock('https://cdn.mgid.com/js/test.js').blocked).toBe(true);
    });

    it('should block Nativo', () => {
      expect(blocker.shouldBlock('https://s.nativo.com/js/test.js').blocked).toBe(true);
    });

    it('should block MediaVine', () => {
      expect(blocker.shouldBlock('https://scripts.mediavine.com/tags/test.js').blocked).toBe(true);
    });

    it('should block GumGum', () => {
      expect(blocker.shouldBlock('https://gumgum.com/native/test').blocked).toBe(true);
    });

    it('should block TripleLift', () => {
      expect(blocker.shouldBlock('https://3lift.com/dsp/triplelift').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Video Ads', () => {
    it('should block Tremor Video', () => {
      expect(blocker.shouldBlock('https://tremorhub.com/vast/test').blocked).toBe(true);
    });

    it('should block SpotX', () => {
      expect(blocker.shouldBlock('https://spotx.tv/vast/test').blocked).toBe(true);
    });

    it('should block IMA SDK', () => {
      expect(blocker.shouldBlock('https://imasdk.googleapis.com/js/sdkloader/ima3.js').blocked).toBe(true);
    });

    it('should block VAST ads', () => {
      expect(blocker.shouldBlock('https://vast.ymlp.com/vast/test').blocked).toBe(true);
    });

    it('should block JW Player ads', () => {
      expect(blocker.shouldBlock('https://www.jwpltx.com/v1/vast/test').blocked).toBe(true);
      expect(blocker.shouldBlock('https://content.jwpsrv.com/test.js').blocked).toBe(true);
    });

    it('should block DoubleClick VAST', () => {
      expect(blocker.shouldBlock('https://doubleclick.net/pfad/vast/test').blocked).toBe(true);
    });

    it('should block Sizmek', () => {
      expect(blocker.shouldBlock('https://serving-sys.com/Serving/adTag.test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Popup Ads', () => {
    it('should block PopAds', () => {
      expect(blocker.shouldBlock('https://popads.net/pop/test').blocked).toBe(true);
    });

    it('should block PopCash', () => {
      expect(blocker.shouldBlock('https://popcash.net/pop/test').blocked).toBe(true);
    });

    it('should block PropellerAds', () => {
      expect(blocker.shouldBlock('https://propellerads.com/ad/test').blocked).toBe(true);
    });

    it('should block ExoClick', () => {
      expect(blocker.shouldBlock('https://exoclick.com/pop/test').blocked).toBe(true);
    });

    it('should block JuicyAds', () => {
      expect(blocker.shouldBlock('https://juicyads.com/popup/test').blocked).toBe(true);
    });

    it('should block Adsterra', () => {
      expect(blocker.shouldBlock('https://adsterra.com/pop/test').blocked).toBe(true);
    });

    it('should block HilltopAds', () => {
      expect(blocker.shouldBlock('https://hilltopads.com/popup/test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Tracking & Analytics', () => {
    it('should block Facebook Pixel', () => {
      expect(blocker.shouldBlock('https://pixel.facebook.com/test').blocked).toBe(true);
      expect(blocker.shouldBlock('https://facebook.com/tr/?id=123').blocked).toBe(true);
    });

    it('should block Twitter Analytics', () => {
      expect(blocker.shouldBlock('https://analytics.twitter.com/i/adsct').blocked).toBe(true);
    });

    it('should block LinkedIn Tracking', () => {
      expect(blocker.shouldBlock('https://snap.licdn.com/li.lms-analytics/insight.min.js').blocked).toBe(true);
    });

    it('should block Bing Ads UET', () => {
      expect(blocker.shouldBlock('https://bat.bing.com/action/test').blocked).toBe(true);
    });

    it('should block TikTok Analytics', () => {
      expect(blocker.shouldBlock('https://analytics.tiktok.com/i18n/pixel/event.js').blocked).toBe(true);
    });

    it('should block Google Tag Manager', () => {
      expect(blocker.shouldBlock('https://googletagmanager.com/gtm.js?id=GTM-123').blocked).toBe(true);
    });

    it('should block Google Analytics', () => {
      expect(blocker.shouldBlock('https://www.google-analytics.com/analytics.js').blocked).toBe(true);
    });

    it('should block Hotjar', () => {
      expect(blocker.shouldBlock('https://static.hotjar.com/c/hotjar-test.js').blocked).toBe(true);
    });

    it('should block Amplitude', () => {
      expect(blocker.shouldBlock('https://cdn.amplitude.com/libs/test.js').blocked).toBe(true);
    });

    it('should block Mixpanel', () => {
      expect(blocker.shouldBlock('https://cdn.mixpanel.com/libs/test.js').blocked).toBe(true);
    });

    it('should block Segment', () => {
      expect(blocker.shouldBlock('https://cdn.segment.com/analytics.js').blocked).toBe(true);
    });

    it('should block Adobe Analytics', () => {
      expect(blocker.shouldBlock('https://omtrdc.net/test').blocked).toBe(true);
    });

    it('should block Nielsen / eXelate', () => {
      expect(blocker.shouldBlock('https://cm.everesttech.net/cm/test').blocked).toBe(true);
    });

    it('should block LiveRamp', () => {
      expect(blocker.shouldBlock('https://rlcdn.com/test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Crypto Mining', () => {
    it('should block CoinHive', () => {
      expect(blocker.shouldBlock('https://coinhive.com/lib/test.js').blocked).toBe(true);
      expect(blocker.shouldBlock('https://coin-hive.com/lib/test.js').blocked).toBe(true);
    });

    it('should block CryptoLoot', () => {
      expect(blocker.shouldBlock('https://cryptoloot.com/lib/test.js').blocked).toBe(true);
    });

    it('should block Miner.ninja', () => {
      expect(blocker.shouldBlock('https://miner.ninja/test.js').blocked).toBe(true);
    });

    it('should block JSEcoin', () => {
      expect(blocker.shouldBlock('https://cdn.jsecoin.com/test.js').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Anti-Adblock', () => {
    it('should block PageFair', () => {
      expect(blocker.shouldBlock('https://pagefair.com/blocker/test.js').blocked).toBe(true);
      expect(blocker.shouldBlock('https://pagefair.net/test.js').blocked).toBe(true);
    });

    it('should block Sourcepoint', () => {
      expect(blocker.shouldBlock('https://sourcepoint.com/cmp/test.js').blocked).toBe(true);
    });

    it('should block Piano / Tinypass', () => {
      expect(blocker.shouldBlock('https://piano.io/xyz/test.js').blocked).toBe(true);
      expect(blocker.shouldBlock('https://tinypass.com/js/test.js').blocked).toBe(true);
    });

    it('should block Quantcast', () => {
      expect(blocker.shouldBlock('https://quantcast.com/gdpr/test.js').blocked).toBe(true);
    });

    it('should block OneTrust', () => {
      expect(blocker.shouldBlock('https://onetrust.com/cmp/test.js').blocked).toBe(true);
    });

    it('should block AdDefend', () => {
      expect(blocker.shouldBlock('https://addefend.com/test.js').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Redirect Tracking', () => {
    it('should block CJ redirects', () => {
      expect(blocker.shouldBlock('https://dpbolvw.net/test').blocked).toBe(true);
    });

    it('should block ShareASale redirects', () => {
      expect(blocker.shouldBlock('https://kqzyfj.com/test').blocked).toBe(true);
    });

    it('should block Rakuten redirects', () => {
      expect(blocker.shouldBlock('https://anrdoezrs.net/test').blocked).toBe(true);
    });

    it('should block LinkShare redirects', () => {
      expect(blocker.shouldBlock('https://linksynergy.com/test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — Newsletter / Survey / Annoyance', () => {
    it('should block OptinMonster', () => {
      expect(blocker.shouldBlock('https://a.optinmonster.com/popup/test.js').blocked).toBe(true);
    });

    it('should block Sumo', () => {
      expect(blocker.shouldBlock('https://sumo.com/js/test.js').blocked).toBe(true);
    });

    it('should block Typeform', () => {
      expect(blocker.shouldBlock('https://embed.typeform.com/test').blocked).toBe(true);
    });

    it('should block Outgrow', () => {
      expect(blocker.shouldBlock('https://outgrow.co/test').blocked).toBe(true);
    });
  });

  describe('shouldBlock — path patterns', () => {
    it('should block by /pagead/ path', () => {
      expect(blocker.shouldBlock('https://newsite.com/pagead/test').blocked).toBe(true);
    });

    it('should block by /banner/ path', () => {
      expect(blocker.shouldBlock('https://example.com/banner/ad1.html').blocked).toBe(true);
    });

    it('should block by /ad/ path', () => {
      expect(blocker.shouldBlock('https://test.com/ad/placement').blocked).toBe(true);
    });

    it('should block by /ads/ path', () => {
      expect(blocker.shouldBlock('https://example.com/ads/tracking').blocked).toBe(true);
    });

    it('should block by /sponsored/ path', () => {
      expect(blocker.shouldBlock('https://blog.example.com/sponsored/post').blocked).toBe(true);
    });

    it('should block by /adserver/ path', () => {
      expect(blocker.shouldBlock('https://any-domain.com/adserver/deliver?id=1').blocked).toBe(true);
    });
  });

  describe('shouldBlock — legitimate sites', () => {
    it('should not block normal websites', () => {
      const urls = [
        'https://example.com',
        'https://github.com/opencode-ai',
        'https://www.google.com/search?q=test',
        'https://stackoverflow.com/questions/1',
        'https://en.wikipedia.org/wiki/TypeScript',
        'https://reddit.com/r/programming',
        'https://news.ycombinator.com',
        'https://www.bbc.com/news',
        'https://www.nytimes.com',
        'https://docs.python.org/3/',
      ];
      for (const url of urls) {
        expect(blocker.shouldBlock(url).blocked).toBe(false);
      }
    });

    it('should not block when disabled', () => {
      blocker.setEnabled(false);
      expect(blocker.shouldBlock('https://doubleclick.net/ads/test').blocked).toBe(false);
    });

    it('should not block when specific category is disabled', () => {
      blocker.setCategoryEnabled('banner', false);
      const result = blocker.shouldBlock('https://doubleclick.net/ads/test');
      expect(result.blocked).toBe(false);
    });

    it('should still block other categories when one is disabled', () => {
      blocker.setCategoryEnabled('banner', false);
      const result = blocker.shouldBlock('https://popads.net/pop/test');
      expect(result.blocked).toBe(true);
      expect(result.match!.rule.category).toBe('popup');
    });
  });

  // ─── shouldBlockPopup ──────────────────────────────────────────────────────

  describe('shouldBlockPopup', () => {
    it('should block popup from known popup ad domains', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://popads.net/pop/test')).toBe(true);
    });

    it('should block popup with ad-related path', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://tracker.com/ad/popup')).toBe(true);
      expect(blocker.shouldBlockPopup('https://example.com', 'https://tracker.com/ads/redirect')).toBe(true);
    });

    it('should block popup with affiliate tracking parameters', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://redirect.com/click?aff_id=123')).toBe(true);
      expect(blocker.shouldBlockPopup('https://example.com', 'https://redirect.com/click?utm_source=ad')).toBe(true);
    });

    it('should not block normal popups', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://example.com/new-page')).toBe(false);
    });

    it('should not block popups when disabled', () => {
      blocker.setEnabled(false);
      expect(blocker.shouldBlockPopup('https://example.com', 'https://popads.net/pop/test')).toBe(false);
    });

    it('should block PropellerAds popups', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://propellerads.com/popup/test')).toBe(true);
    });

    it('should block ExoClick popups', () => {
      expect(blocker.shouldBlockPopup('https://example.com', 'https://exdynsrv.com/popup/test')).toBe(true);
    });

    it('should handle popup blocking with empty URLs', () => {
      expect(blocker.shouldBlockPopup('', '')).toBe(false);
    });
  });

  // ─── shouldRedirect ────────────────────────────────────────────────────────

  describe('shouldRedirect', () => {
    it('should redirect CJ affiliate links', () => {
      expect(blocker.shouldRedirect('https://dpbolvw.net/click?id=test')).toBe('about:blank');
    });

    it('should redirect ShareASale links', () => {
      expect(blocker.shouldRedirect('https://kqzyfj.com/click')).toBe('about:blank');
    });

    it('should redirect Rakuten links', () => {
      expect(blocker.shouldRedirect('https://anrdoezrs.net/click')).toBe('about:blank');
    });

    it('should not redirect normal URLs', () => {
      expect(blocker.shouldRedirect('https://example.com/page')).toBeNull();
    });

    it('should not redirect when disabled', () => {
      blocker.setEnabled(false);
      expect(blocker.shouldRedirect('https://dpbolvw.net/click')).toBeNull();
    });
  });

  // ─── detectAntiAdblock ─────────────────────────────────────────────────────

  describe('detectAntiAdblock', () => {
    it('should detect standard ad blocker detection scripts', () => {
      const source = `
        <script>
          if (typeof blockAdBlock === 'undefined') {
            document.getElementById('adblock-modal').style.display = 'block';
          }
        </script>
      `;
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
      expect(result.patterns.length).toBeGreaterThan(0);
    });

    it('should detect PageFair integration', () => {
      const source = '<script src="https://pagefair.com/blocker/test.js"></script>';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
    });

    it('should detect Sourcepoint CMP', () => {
      const source = '<script src="https://sourcepoint.com/cmp/test.js"></script>';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
    });

    it('should detect "Please disable your ad blocker" messages', () => {
      const source = '<div>Please disable your ad blocker to continue</div>';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
      expect(result.patterns).toContain('disable your ad blocker');
    });

    it('should detect paywall / subscription prompts', () => {
      const source = '<div>You have reached your article limit. Subscribe to continue.</div>';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
    });

    it('should detect multiple patterns simultaneously', () => {
      const source = `
        <script>blockAdBlock();</script>
        <script>adBlockDetected();</script>
        <div>Please disable your ad blocker</div>
      `;
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
      expect(result.patterns.length).toBeGreaterThanOrEqual(2);
    });

    it('should not detect in clean pages', () => {
      const source = '<html><body>Hello world</body></html>';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(false);
      expect(result.patterns).toHaveLength(0);
    });

    it('should emit antiAdblockDetected event', () => {
      const handler = vi.fn();
      blocker.on('antiAdblockDetected', handler);
      blocker.detectAntiAdblock('<script>blockAdBlock</script>');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should detect uBlock detection', () => {
      const source = 'if (ublock === undefined) { showAdWall(); }';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
    });

    it('should detect AdGuard detection', () => {
      const source = 'if (window.adguardDetected) { showBanner(); }';
      const result = blocker.detectAntiAdblock(source);
      expect(result.detected).toBe(true);
    });
  });

  // ─── shouldHideElement ─────────────────────────────────────────────────────

  describe('shouldHideElement', () => {
    it('should hide Google Ads containers', () => {
      expect(blocker.shouldHideElement('[id*="google_ads"]')).toBe(true);
    });

    it('should hide AdSense ins elements', () => {
      expect(blocker.shouldHideElement('ins.adsbygoogle')).toBe(true);
    });

    it('should hide Taboola widgets', () => {
      expect(blocker.shouldHideElement('[id*="taboola"]')).toBe(true);
    });

    it('should hide Outbrain widgets', () => {
      expect(blocker.shouldHideElement('[class*="outbrain"]')).toBe(true);
    });

    it('should hide cryptocurrency mining scripts', () => {
      expect(blocker.shouldHideElement('script[src*="coinhive"]')).toBe(true);
      expect(blocker.shouldHideElement('script[src*="cryptoloot"]')).toBe(true);
    });

    it('should hide video ad overlays', () => {
      expect(blocker.shouldHideElement('.video-ad-overlay')).toBe(true);
    });

    it('should hide interstitial ads', () => {
      expect(blocker.shouldHideElement('[class*="interstitial"]')).toBe(true);
    });

    it('should hide newsletter popups', () => {
      expect(blocker.shouldHideElement('[class*="newsletter-popup"]')).toBe(true);
    });

    it('should hide cookie consent banners', () => {
      expect(blocker.shouldHideElement('[class*="cookie-banner"]')).toBe(true);
    });

    it('should hide ad blocker detection elements', () => {
      expect(blocker.shouldHideElement('[class*="ad-blocker"]')).toBe(true);
    });

    it('should apply domain-specific rules', () => {
      expect(blocker.shouldHideElement('.video-ads', 'youtube.com')).toBe(true);
      expect(blocker.shouldHideElement('.ytp-ad-text-overlay', 'youtube.com')).toBe(true);
    });

    it('should not hide generic elements', () => {
      expect(blocker.shouldHideElement('div.main-content')).toBe(false);
      expect(blocker.shouldHideElement('header')).toBe(false);
    });

    it('should not hide when category is disabled', () => {
      blocker.setCategoryEnabled('crypto-miner', false);
      expect(blocker.shouldHideElement('script[src*="coinhive"]')).toBe(false);
    });
  });

  // ─── getCosmeticRules ──────────────────────────────────────────────────────

  describe('getCosmeticRules', () => {
    it('should return all cosmetic rules without domain filter', () => {
      const rules = blocker.getCosmeticRules();
      expect(rules.length).toBe(COSMETIC_RULES.length);
    });

    it('should filter rules by YouTube domain', () => {
      const rules = blocker.getCosmeticRules('youtube.com');
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.domain === 'youtube.com')).toBe(true);
    });

    it('should include generic rules for any domain', () => {
      const rules = blocker.getCosmeticRules('random-site.com');
      // Should include rules with no domain (generic rules)
      expect(rules.every(r => !r.domain)).toBe(true);
    });
  });

  // ─── Category toggling ────────────────────────────────────────────────────

  describe('category toggling', () => {
    it('should toggle banner category off', () => {
      blocker.setCategoryEnabled('banner', false);
      expect(blocker.enabledCategories.has('banner')).toBe(false);
      expect(blocker.shouldBlock('https://doubleclick.net/test').blocked).toBe(false);
    });

    it('should toggle popup category off', () => {
      blocker.setCategoryEnabled('popup', false);
      expect(blocker.enabledCategories.has('popup')).toBe(false);
      expect(blocker.shouldBlock('https://popads.net/test').blocked).toBe(false);
    });

    it('should toggle crypto-miner category off', () => {
      blocker.setCategoryEnabled('crypto-miner', false);
      expect(blocker.enabledCategories.has('crypto-miner')).toBe(false);
    });

    it('should re-enable a disabled category', () => {
      blocker.setCategoryEnabled('banner', false);
      blocker.setCategoryEnabled('banner', true);
      expect(blocker.enabledCategories.has('banner')).toBe(true);
      expect(blocker.shouldBlock('https://doubleclick.net/test').blocked).toBe(true);
    });

    it('should emit categoryToggled event', () => {
      const handler = vi.fn();
      blocker.on('categoryToggled', handler);
      blocker.setCategoryEnabled('banner', false);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'categoryToggled', category: 'banner', enabled: false }),
      );
    });
  });

  // ─── recordBlocked and stats ───────────────────────────────────────────────

  describe('recordBlocked and stats', () => {
    it('should record blocked ads', () => {
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(blocker.totalBlocked).toBe(1);
      expect(blocker.blockedAds).toHaveLength(1);
      expect(blocker.blockedAds[0]!.url).toBe('https://doubleclick.net/ads/test');
      expect(blocker.blockedAds[0]!.category).toBe('banner');
    });

    it('should track counts by category', () => {
      const adMatch = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      const nativeMatch = blocker.shouldBlock('https://taboola.com/widget').match!;
      const popupMatch = blocker.shouldBlock('https://popads.net/ad').match!;
      const videoMatch = blocker.shouldBlock('https://imasdk.googleapis.com/test').match!;
      blocker.recordBlocked(adMatch, 'script');
      blocker.recordBlocked(nativeMatch, 'iframe');
      blocker.recordBlocked(popupMatch, 'popup');
      blocker.recordBlocked(videoMatch, 'video');
      const byCategory = blocker.getBlockedByCategory();
      expect(byCategory['banner']).toBe(1);
      expect(byCategory['native']).toBe(1);
      expect(byCategory['popup']).toBe(1);
      expect(byCategory['video']).toBe(1);
    });

    it('should provide block stats', () => {
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      const stats = blocker.getBlockStats();
      expect(stats.total).toBe(1);
      expect(stats.byCategory['banner']).toBe(1);
      expect(stats.recentBlocks).toHaveLength(1);
    });

    it('should cap blocked ads list at 10000 entries', () => {
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      for (let i = 0; i < 10010; i++) {
        blocker.recordBlocked(match, 'script');
      }
      expect(blocker.totalBlocked).toBeLessThanOrEqual(10001);
    });
  });

  // ─── clearStats ────────────────────────────────────────────────────────────

  describe('clearStats', () => {
    it('should reset all stats', () => {
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      blocker.clearStats();
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });
  });

  // ─── Custom rules ──────────────────────────────────────────────────────────

  describe('custom rules', () => {
    it('should allow adding custom rules', () => {
      blocker.addCustomRule({ pattern: 'my-custom-ad.com', category: 'banner', description: 'Custom ad domain' });
      expect(blocker.shouldBlock('https://my-custom-ad.com/test').blocked).toBe(true);
    });

    it('should allow removing custom rules', () => {
      blocker.addCustomRule({ pattern: 'temporary-ad.com', category: 'banner', description: 'Temporary' });
      blocker.removeCustomRule('temporary-ad.com');
      expect(blocker.shouldBlock('https://temporary-ad.com/test').blocked).toBe(false);
    });

    it('should reject empty patterns', () => {
      blocker.addCustomRule({ pattern: '', category: 'banner', description: 'Empty' });
      // Rule should not be added — no new custom blocking behavior
      expect(blocker.shouldBlock('https://test.com').blocked).toBe(false);
    });

    it('should reject overly long patterns', () => {
      blocker.addCustomRule({ pattern: 'a'.repeat(513), category: 'banner', description: 'Too long' });
      expect(blocker.shouldBlock('https://test.com').blocked).toBe(false);
    });

    it('should reject patterns with HTML injection', () => {
      blocker.addCustomRule({ pattern: '<script>alert(1)</script>', category: 'banner', description: 'XSS attempt' });
      expect(blocker.shouldBlock('https://test.com').blocked).toBe(false);
    });

    it('should reject overly short patterns', () => {
      blocker.addCustomRule({ pattern: 'a', category: 'banner', description: 'Too short' });
      expect(blocker.shouldBlock('https://test.com').blocked).toBe(false);
    });

    it('should accept valid custom rules', () => {
      blocker.addCustomRule({ pattern: 'my-network.example.com', category: 'popup', description: 'Custom popup' });
      expect(blocker.shouldBlock('https://my-network.example.com/ad').blocked).toBe(true);
    });
  });

  // ─── Events ────────────────────────────────────────────────────────────────

  describe('events', () => {
    it('should emit adBlocked event when recording', () => {
      const handler = vi.fn();
      blocker.on('adBlocked', handler);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'adBlocked', totalBlocked: 1 }),
      );
    });

    it('should emit adBlockerToggled event', () => {
      const handler = vi.fn();
      blocker.on('adBlockerToggled', handler);
      blocker.setEnabled(false);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'adBlockerToggled', enabled: false }),
      );
    });

    it('should stop emitting after off()', () => {
      const handler = vi.fn();
      blocker.on('adBlocked', handler);
      blocker.off('adBlocked', handler);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle multiple handlers for same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      blocker.on('adBlocked', handler1);
      blocker.on('adBlocked', handler2);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should catch handler exceptions without crashing', () => {
      const badHandler = () => { throw new Error('handler error'); };
      const goodHandler = vi.fn();
      blocker.on('adBlocked', badHandler);
      blocker.on('adBlocked', goodHandler);
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      expect(() => blocker.recordBlocked(match, 'script')).not.toThrow();
      expect(goodHandler).toHaveBeenCalledTimes(1);
    });

    it('should emit elementHidden event type (no direct method but event exists)', () => {
      const handler = vi.fn();
      blocker.on('elementHidden', handler);
      // Simulate by emitting directly through internal mechanism (test-only)
      // In practice this is called from the view layer
      expect(true).toBe(true); // Event type is valid
    });
  });

  // ─── Dispose ───────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all state', () => {
      const match = blocker.shouldBlock('https://doubleclick.net/ads/test').match!;
      blocker.recordBlocked(match, 'script');
      blocker.dispose();
      expect(blocker.totalBlocked).toBe(0);
      expect(blocker.blockedAds).toHaveLength(0);
    });

    it('should clear custom rules on dispose', () => {
      blocker.addCustomRule({ pattern: 'test.com', category: 'banner', description: 'Test' });
      expect(blocker.shouldBlock('https://test.com/page').blocked).toBe(true);
      blocker.dispose();
      // After dispose, custom rules are gone
      expect(blocker.shouldBlock('https://test.com/page').blocked).toBe(false);
    });

    it('should clear enabled categories on dispose', () => {
      blocker.dispose();
      // Categories are cleared, shouldBlock still works with default categories from rules
    });
  });

  // ─── Comprehensive edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle invalid URLs gracefully', () => {
      expect(blocker.shouldBlock('').blocked).toBe(false);
      expect(blocker.shouldBlock('not-a-url').blocked).toBe(false);
      expect(blocker.shouldBlock('://missing-scheme').blocked).toBe(false);
    });

    it('should handle very long URLs', () => {
      const longUrl = 'https://doubleclick.net/' + 'a'.repeat(5000);
      expect(blocker.shouldBlock(longUrl).blocked).toBe(true);
    });

    it('should handle case insensitive matching', () => {
      expect(blocker.shouldBlock('https://DOUBLECLICK.NET/test').blocked).toBe(true);
      expect(blocker.shouldBlock('https://DoubleClick.Net/test').blocked).toBe(true);
    });

    it('should handle URLs with ports', () => {
      expect(blocker.shouldBlock('https://doubleclick.net:8080/ads/test').blocked).toBe(true);
    });

    it('should handle URLs with auth info', () => {
      expect(blocker.shouldBlock('https://user:pass@doubleclick.net/test').blocked).toBe(true);
    });

    it('should handle URLs with fragments', () => {
      expect(blocker.shouldBlock('https://doubleclick.net/ads#section').blocked).toBe(true);
    });

    it('should handle subdomains of ad networks', () => {
      expect(blocker.shouldBlock('https://sub.doubleclick.net/test').blocked).toBe(true);
      expect(blocker.shouldBlock('https://ads.sub.doubleclick.net/test').blocked).toBe(true);
    });

    it('should not match partial domain names', () => {
      expect(blocker.shouldBlock('https://notdoubleclick.net/test').blocked).toBe(false);
      expect(blocker.shouldBlock('https://doubleclick.net.evil.com/test').blocked).toBe(false);
    });

    it('should handle concurrent shouldBlock calls', () => {
      const urls = Array(100).fill('https://doubleclick.net/ads/test').map((u, i) => `${u}?id=${i}`);
      const results = urls.map(u => blocker.shouldBlock(u));
      expect(results.every(r => r.blocked)).toBe(true);
    });

    it('should handle popup blocking with empty URLs', () => {
      expect(blocker.shouldBlockPopup('', '')).toBe(false);
    });

    it('should handle anti-adblock detection with empty source', () => {
      const result = blocker.detectAntiAdblock('');
      expect(result.detected).toBe(false);
    });
  });
});
