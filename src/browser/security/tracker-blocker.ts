import type { IDisposable } from '../../app/dependency-container';

type BlockCategory = 'ad' | 'tracker' | 'analytics' | 'social' | 'malware' | 'fingerprinting' | 'crypto-miner' | 'annoyance';

interface BlockRule {
  readonly domain: string;
  readonly category: BlockCategory;
  readonly description: string;
}

interface BlockedRequest {
  readonly url: string;
  readonly domain: string;
  readonly category: BlockCategory;
  readonly timestamp: number;
  readonly resourceKind: string;
}

type BlockerEventType =
  | 'requestBlocked'
  | 'blockerToggled'
  | 'categoryToggled'
  | 'rulesUpdated';

interface BlockerEvent {
  readonly kind: BlockerEventType;
}

interface RequestBlockedEvent extends BlockerEvent {
  readonly kind: 'requestBlocked';
  readonly blocked: BlockedRequest;
  readonly totalBlocked: number;
}

interface BlockerToggledEvent extends BlockerEvent {
  readonly kind: 'blockerToggled';
  readonly enabled: boolean;
}

interface CategoryToggledEvent extends BlockerEvent {
  readonly kind: 'categoryToggled';
  readonly category: BlockCategory;
  readonly enabled: boolean;
}

type BlockerEventUnion =
  | RequestBlockedEvent
  | BlockerToggledEvent
  | CategoryToggledEvent;

interface RuleMatch {
  readonly rule: BlockRule;
  readonly domain: string;
}

type BlockerEventHandler = (event: BlockerEventUnion) => void;

interface ITrackerBlocker extends IDisposable {
  readonly enabled: boolean;
  readonly totalBlocked: number;
  readonly blockedRequests: readonly BlockedRequest[];
  readonly enabledCategories: ReadonlySet<BlockCategory>;
  setEnabled(enabled: boolean): void;
  toggleCategory(category: BlockCategory, enabled: boolean): void;
  shouldBlock(url: string): { blocked: boolean; category?: BlockCategory; rule?: BlockRule };
  getBlockedByCategory(): Record<BlockCategory, number>;
  clearStats(): void;
  on(type: BlockerEventType, handler: BlockerEventHandler): void;
  off(type: BlockerEventType, handler: BlockerEventHandler): void;
}

const ALL_CATEGORIES: readonly BlockCategory[] = [
  'ad', 'tracker', 'analytics', 'social', 'malware', 'fingerprinting', 'crypto-miner', 'annoyance',
];

const CATEGORY_LABELS: Record<BlockCategory, string> = {
  ad: 'Ads',
  tracker: 'Trackers',
  analytics: 'Analytics',
  social: 'Social Widgets',
  malware: 'Malware',
  fingerprinting: 'Fingerprinting',
  'crypto-miner': 'Crypto Miners',
  annoyance: 'Annoyances',
};

const DEFAULT_RULES: BlockRule[] = [
  { domain: 'doubleclick.net', category: 'ad', description: 'Google DoubleClick Ads' },
  { domain: 'googlesyndication.com', category: 'ad', description: 'Google Syndication Ads' },
  { domain: 'googleadservices.com', category: 'ad', description: 'Google Ad Services' },
  { domain: 'googletagmanager.com', category: 'ad', description: 'Google Tag Manager (Ads)' },
  { domain: 'googleads.g.doubleclick.net', category: 'ad', description: 'DoubleClick Ads' },
  { domain: 'adservice.google.com', category: 'ad', description: 'Google Ad Service' },
  { domain: 'pagead2.googlesyndication.com', category: 'ad', description: 'Google Page Ads' },
  { domain: 'adnxs.com', category: 'ad', description: 'AppNexus Ads' },
  { domain: 'adsrvr.org', category: 'ad', description: 'The Trade Desk Ads' },
  { domain: 'criteo.com', category: 'ad', description: 'Criteo Ads' },
  { domain: 'criteo.net', category: 'ad', description: 'Criteo Ads CDN' },
  { domain: 'advertising.com', category: 'ad', description: 'AOL Advertising' },
  { domain: 'adzerk.net', category: 'ad', description: 'Adzerk Ads' },
  { domain: 'moatads.com', category: 'ad', description: 'Moat Ads' },
  { domain: 'casalemedia.com', category: 'ad', description: 'Casale Media Ads' },
  { domain: 'openx.net', category: 'ad', description: 'OpenX Ads' },
  { domain: 'pubmatic.com', category: 'ad', description: 'PubMatic Ads' },
  { domain: 'rubiconproject.com', category: 'ad', description: 'Rubicon Project Ads' },
  { domain: 'contextweb.com', category: 'ad', description: 'ContextWeb Ads' },
  { domain: 'indexww.com', category: 'ad', description: 'Index Exchange Ads' },
  { domain: 'sovrn.com', category: 'ad', description: 'Sovrn Ads' },
  { domain: 'sharethrough.com', category: 'ad', description: 'ShareThrough Ads' },
  { domain: 'adsafeprotected.com', category: 'ad', description: 'Integral Ad Science' },
  { domain: 'adroll.com', category: 'ad', description: 'AdRoll Ads' },
  { domain: 'amazon-adsystem.com', category: 'ad', description: 'Amazon Ads' },
  { domain: 'bidswitch.net', category: 'ad', description: 'BidSwitch Ads' },
  { domain: 'improvedigital.com', category: 'ad', description: 'Improve Digital Ads' },
  { domain: 'smartadserver.com', category: 'ad', description: 'Smart AdServer' },
  { domain: 'taboola.com', category: 'ad', description: 'Taboola Native Ads' },
  { domain: 'outbrain.com', category: 'ad', description: 'Outbrain Native Ads' },
  { domain: 'popads.net', category: 'ad', description: 'PopAds' },
  { domain: 'exdynsrv.com', category: 'ad', description: 'ExoClick Ads' },
  { domain: 'propellerads.com', category: 'ad', description: 'PropellerAds' },
  { domain: 'revcontent.com', category: 'ad', description: 'RevContent Ads' },
  { domain: 'mgid.com', category: 'ad', description: 'MGID Native Ads' },
  { domain: 'adform.com', category: 'ad', description: 'AdForm Ads' },
  { domain: 'adition.com', category: 'ad', description: 'Adition Ads' },
  { domain: 'ad-up.com', category: 'ad', description: 'AdUp Ads' },
  { domain: 'adspirit.de', category: 'ad', description: 'AdSpirit Ads' },
  { domain: 'adserver.com', category: 'ad', description: 'AdServer' },
  { domain: 'adtech.de', category: 'ad', description: 'AdTech Ads' },
  { domain: 'adventori.com', category: 'ad', description: 'Adventori Ads' },
  { domain: 'adzerk.com', category: 'ad', description: 'Adzerk' },
  { domain: 'tremorhub.com', category: 'ad', description: 'Tremor Video Ads' },
  { domain: 'spotx.tv', category: 'ad', description: 'SpotX Video Ads' },
  { domain: 'google-analytics.com', category: 'tracker', description: 'Google Analytics' },
  { domain: 'googletagmanager.com', category: 'tracker', description: 'Google Tag Manager' },
  { domain: 'analytics.google.com', category: 'tracker', description: 'Google Analytics' },
  { domain: 'facebook.com/tr', category: 'tracker', description: 'Facebook Pixel' },
  { domain: 'facebook.net', category: 'tracker', description: 'Facebook SDK' },
  { domain: 'connect.facebook.net', category: 'tracker', description: 'Facebook Connect' },
  { domain: 'scorecardresearch.com', category: 'tracker', description: 'ScorecardResearch' },
  { domain: 'quantserve.com', category: 'tracker', description: 'Quantcast' },
  { domain: 'quantcount.com', category: 'tracker', description: 'QuantCount' },
  { domain: 'comscore.com', category: 'tracker', description: 'ComScore' },
  { domain: 'hotjar.com', category: 'tracker', description: 'HotJar Analytics' },
  { domain: 'hotjar.io', category: 'tracker', description: 'HotJar CDN' },
  { domain: 'mouseflow.com', category: 'tracker', description: 'Mouseflow Analytics' },
  { domain: 'crazyegg.com', category: 'tracker', description: 'CrazyEgg Analytics' },
  { domain: 'clicky.com', category: 'tracker', description: 'Clicky Analytics' },
  { domain: 'mixpanel.com', category: 'tracker', description: 'MixPanel Analytics' },
  { domain: 'amplitude.com', category: 'tracker', description: 'Amplitude Analytics' },
  { domain: 'segment.io', category: 'tracker', description: 'Segment Analytics' },
  { domain: 'segment.com', category: 'tracker', description: 'Segment' },
  { domain: 'fullstory.com', category: 'tracker', description: 'FullStory Session Replay' },
  { domain: 'heap.io', category: 'tracker', description: 'Heap Analytics' },
  { domain: 'luckyorange.com', category: 'tracker', description: 'LuckyOrange Session Replay' },
  { domain: 'sessioncam.com', category: 'tracker', description: 'SessionCam Replay' },
  { domain: 'smartlook.com', category: 'tracker', description: 'SmartLook Replay' },
  { domain: 'matomo.org', category: 'tracker', description: 'Matomo Analytics' },
  { domain: 'piwik.org', category: 'tracker', description: 'Piwik Analytics' },
  { domain: 'newrelic.com', category: 'tracker', description: 'New Relic APM' },
  { domain: 'datadog.com', category: 'tracker', description: 'Datadog APM' },
  { domain: 'dynatrace.com', category: 'tracker', description: 'Dynatrace APM' },
  { domain: 'appdynamics.com', category: 'tracker', description: 'AppDynamics APM' },
  { domain: 'kissmetrics.com', category: 'tracker', description: 'KissMetrics' },
  { domain: 'optimizely.com', category: 'tracker', description: 'Optimizely A/B Testing' },
  { domain: 'launchdarkly.com', category: 'tracker', description: 'LaunchDarkly Feature Flags' },
  { domain: 'adobe.com/analytics', category: 'tracker', description: 'Adobe Analytics' },
  { domain: '2o7.net', category: 'tracker', description: 'Adobe Omniture' },
  { domain: 'omniture.com', category: 'tracker', description: 'Adobe Omniture' },
  { domain: 'demdex.net', category: 'tracker', description: 'Adobe Audience Manager' },
  { domain: 'dpm.demdex.net', category: 'tracker', description: 'Adobe DPM' },
  { domain: 'adsymptotic.com', category: 'tracker', description: 'Adobe Advertising Cloud' },
  { domain: 'everesttech.net', category: 'tracker', description: 'Adobe Everest' },
  { domain: 'ipredictive.com', category: 'tracker', description: 'iPredictive' },
  { domain: 'tapad.com', category: 'tracker', description: 'Tapad Cross-Device' },
  { domain: 'datalogix.com', category: 'tracker', description: 'Oracle Datalogix' },
  { domain: 'bluekai.com', category: 'tracker', description: 'Oracle BlueKai' },
  { domain: 'addthis.com', category: 'tracker', description: 'Oracle AddThis' },
  { domain: 'exelator.com', category: 'tracker', description: 'Oracle Moat/Exelate' },
  { domain: 'rlcdn.com', category: 'tracker', description: 'LiveRamp Identity' },
  { domain: 'identityx.com', category: 'tracker', description: 'IdentityX' },
  { domain: 'tidaltv.com', category: 'tracker', description: 'Tidal TV' },
  { domain: 'zeotap.com', category: 'tracker', description: 'Zeotap Data' },
  { domain: 'permutive.com', category: 'tracker', description: 'Permutive DMP' },
  { domain: 'lotame.com', category: 'tracker', description: 'Lotame DMP' },
  { domain: 'cdn.segment.com', category: 'analytics', description: 'Segment CDN' },
  { domain: 'cdn.mxpnl.com', category: 'analytics', description: 'Mixpanel CDN' },
  { domain: 'cdn.amplitude.com', category: 'analytics', description: 'Amplitude CDN' },
  { domain: 'js.hs-analytics.net', category: 'analytics', description: 'HubSpot Analytics' },
  { domain: 'js.hs-scripts.com', category: 'analytics', description: 'HubSpot Scripts' },
  { domain: 'js.hs-banner.com', category: 'analytics', description: 'HubSpot Banner' },
  { domain: 'snap.licdn.com', category: 'analytics', description: 'LinkedIn Analytics' },
  { domain: 'dc.ads.linkedin.com', category: 'analytics', description: 'LinkedIn Ads' },
  { domain: 'ads.linkedin.com', category: 'analytics', description: 'LinkedIn Ads' },
  { domain: 'www.google-analytics.com', category: 'analytics', description: 'Google Analytics' },
  { domain: 'ssl.google-analytics.com', category: 'analytics', description: 'Google Analytics SSL' },
  { domain: 'stats.g.doubleclick.net', category: 'analytics', description: 'Google Analytics via DoubleClick' },
  { domain: 'pinterest.com/analytics', category: 'analytics', description: 'Pinterest Analytics' },
  { domain: 'analytics.twitter.com', category: 'analytics', description: 'Twitter Analytics' },
  { domain: 'static.ads-twitter.com', category: 'analytics', description: 'Twitter Ads' },
  { domain: 't.co', category: 'analytics', description: 'Twitter Link Shortener' },
  { domain: 'platform.twitter.com', category: 'social', description: 'Twitter Widget' },
  { domain: 'syndication.twitter.com', category: 'social', description: 'Twitter Syndication' },
  { domain: 'platform.linkedin.com', category: 'social', description: 'LinkedIn Widget' },
  { domain: 'assets.pinterest.com', category: 'social', description: 'Pinterest Widget' },
  { domain: 'widgets.pinterest.com', category: 'social', description: 'Pinterest Widgets' },
  { domain: 'platform.instagram.com', category: 'social', description: 'Instagram Embed' },
  { domain: 'connect.facebook.net', category: 'social', description: 'Facebook SDK' },
  { domain: 'staticxx.facebook.com', category: 'social', description: 'Facebook CDN' },
  { domain: 'fbcdn.net', category: 'social', description: 'Facebook CDN' },
  { domain: 'external.xx.fbcdn.net', category: 'social', description: 'Facebook External CDN' },
  { domain: 'reddit.com/static', category: 'social', description: 'Reddit Widgets' },
  { domain: 'redditmedia.com', category: 'social', description: 'Reddit Media' },
  { domain: 'tumblr.com/share', category: 'social', description: 'Tumblr Share' },
  { domain: 'stumbleupon.com', category: 'social', description: 'StumbleUpon' },
  { domain: 'digg.com', category: 'social', description: 'Digg' },
  { domain: 'buffer.com', category: 'social', description: 'Buffer Social' },
  { domain: 'addtoany.com', category: 'social', description: 'AddToAny Sharing' },
  { domain: 'sharethis.com', category: 'social', description: 'ShareThis Widget' },
  { domain: 'fingerprintjs.com', category: 'fingerprinting', description: 'FingerprintJS' },
  { domain: 'fpjs.io', category: 'fingerprinting', description: 'FingerprintJS CDN' },
  { domain: 'fingerprint.com', category: 'fingerprinting', description: 'Fingerprint.com' },
  { domain: 'js.fingerprint.com', category: 'fingerprinting', description: 'Fingerprint JS' },
  { domain: 'cdn.jsdelivr.net/fingerprint', category: 'fingerprinting', description: 'Fingerprint via CDN' },
  { domain: 'api.fpjs.io', category: 'fingerprinting', description: 'FingerprintJS API' },
  { domain: 'coinhive.com', category: 'crypto-miner', description: 'CoinHive Miner' },
  { domain: 'coin-hive.com', category: 'crypto-miner', description: 'CoinHive' },
  { domain: 'coinhive.min.js', category: 'crypto-miner', description: 'CoinHive Script' },
  { domain: 'authedmine.com', category: 'crypto-miner', description: 'AuthedMine' },
  { domain: 'coinimp.com', category: 'crypto-miner', description: 'CoinImp Miner' },
  { domain: 'crypto-loot.com', category: 'crypto-miner', description: 'CryptoLoot Miner' },
  { domain: 'miner.video', category: 'crypto-miner', description: 'Web Video Miner' },
  { domain: 'monerominer.rocks', category: 'crypto-miner', description: 'MoneroMiner' },
  { domain: 'cookiebot.com', category: 'annoyance', description: 'CookieBot Consent' },
  { domain: 'onetrust.com', category: 'annoyance', description: 'OneTrust Consent' },
  { domain: 'onetrust.io', category: 'annoyance', description: 'OneTrust CDN' },
  { domain: 'cookie-script.com', category: 'annoyance', description: 'CookieScript' },
  { domain: 'cookielaw.org', category: 'annoyance', description: 'CookieLaw Banner' },
  { domain: 'gdprwrapper.com', category: 'annoyance', description: 'GDPR Wrapper' },
  { domain: 'consentmanager.net', category: 'annoyance', description: 'Consent Manager' },
  { domain: 'cmp.usercentrics.com', category: 'annoyance', description: 'UserCentrics CMP' },
  { domain: 'app.usercentrics.eu', category: 'annoyance', description: 'UserCentrics' },
  { domain: 'privacy-mgmt.com', category: 'annoyance', description: 'Privacy Management' },
  { domain: 'livechatinc.com', category: 'annoyance', description: 'LiveChat Widget' },
  { domain: 'intercom.io', category: 'annoyance', description: 'Intercom Chat' },
  { domain: 'intercomcdn.com', category: 'annoyance', description: 'Intercom CDN' },
  { domain: 'drift.com', category: 'annoyance', description: 'Drift Chat' },
  { domain: 'olark.com', category: 'annoyance', description: 'Olark Chat' },
  { domain: 'zopim.com', category: 'annoyance', description: 'Zopim Chat' },
  { domain: 'tidio.co', category: 'annoyance', description: 'Tidio Chat' },
  { domain: 'crisp.chat', category: 'annoyance', description: 'Crisp Chat' },
  { domain: 'tawk.to', category: 'annoyance', description: 'Tawk.to Chat' },
  { domain: 'freshchat.com', category: 'annoyance', description: 'FreshChat' },
  { domain: 'hotjar.com', category: 'annoyance', description: 'HotJar Feedback' },
  { domain: 'usabilla.com', category: 'annoyance', description: 'Usabilla Feedback' },
  { domain: 'survicate.com', category: 'annoyance', description: 'Survicate Survey' },
  { domain: 'typeform.com', category: 'annoyance', description: 'Typeform Survey' },
  { domain: 'trustpilot.com', category: 'annoyance', description: 'TrustPilot Widget' },
  { domain: 'feefo.com', category: 'annoyance', description: 'Feefo Reviews' },
  { domain: 'yelp.com/widget', category: 'annoyance', description: 'Yelp Widget' },
  { domain: 'cdn.taboola.com', category: 'ad', description: 'Taboola CDN' },
  { domain: 'cdn.outbrain.com', category: 'ad', description: 'Outbrain CDN' },
  { domain: 'cdn.criteo.com', category: 'ad', description: 'Criteo CDN' },
  { domain: 'cdn.adsafeprotected.com', category: 'ad', description: 'IAS CDN' },
  { domain: 'cdn.consentmanager.net', category: 'annoyance', description: 'Consent Manager CDN' },
  { domain: 'pagead2.googlesyndication.com', category: 'ad', description: 'Google AdSense' },
  { domain: 'fundingchoicesmessages.google.com', category: 'annoyance', description: 'Google Funding Choices' },
  { domain: 'fundingchoices.google.com', category: 'annoyance', description: 'Google Funding Choices' },
  { domain: 'aax.amazon-adsystem.com', category: 'ad', description: 'Amazon AAX Ads' },
  { domain: 'dtmc.adsafeprotected.com', category: 'ad', description: 'IAS Dynamic Tracking' },
  { domain: 'pixel.adsafeprotected.com', category: 'ad', description: 'IAS Pixel' },
  { domain: 's.amazon-adsystem.com', category: 'ad', description: 'Amazon Ads System' },
  { domain: 'z-na.amazon-adsystem.com', category: 'ad', description: 'Amazon Ads System' },
  { domain: 'ir-na.amazon-adsystem.com', category: 'ad', description: 'Amazon Ads Reporting' },
  { domain: 's0.2mdn.net', category: 'ad', description: 'DoubleClick Studio' },
  { domain: 'tpc.googlesyndication.com', category: 'ad', description: 'Google AdSense TPC' },
  { domain: 'cm.g.doubleclick.net', category: 'ad', description: 'DoubleClick CM' },
  { domain: 'adclick.g.doubleclick.net', category: 'ad', description: 'DoubleClick AdClick' },
  { domain: 'securepubads.g.doubleclick.net', category: 'ad', description: 'Google Publisher Tags' },
  { domain: 'protagcdn.com', category: 'ad', description: 'ProTag Ads' },
  { domain: 'assets.bounceexchange.com', category: 'ad', description: 'BounceX' },
  { domain: 'ct.pinterest.com', category: 'analytics', description: 'Pinterest Analytics' },
];

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function matchesDomain(hostname: string, ruleDomain: string): boolean {
  const h = hostname.toLowerCase();
  const d = ruleDomain.toLowerCase();
  if (h === d) return true;
  if (h.endsWith('.' + d)) return true;
  return false;
}

function matchRule(url: string): RuleMatch | null {
  const hostname = extractHostname(url);
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();

  for (const rule of DEFAULT_RULES) {
    const ruleDomain = rule.domain.toLowerCase();
    if (ruleDomain.includes('/')) {
      const urlWithPath = hostname + path;
      if (urlWithPath === ruleDomain || urlWithPath.includes(ruleDomain)) {
        return { rule, domain: rule.domain };
      }
    } else if (matchesDomain(hostname, ruleDomain)) {
      return { rule, domain: rule.domain };
    }
  }
  return null;
}

class TrackerBlocker implements ITrackerBlocker {
  private _enabled = true;
  private _blockedRequests: BlockedRequest[] = [];
  private readonly _enabledCategories = new Set<BlockCategory>(ALL_CATEGORIES);
  private readonly eventMap = new Map<BlockerEventType, Set<BlockerEventHandler>>();

  get enabled(): boolean { return this._enabled; }
  get totalBlocked(): number { return this._blockedRequests.length; }
  get blockedRequests(): readonly BlockedRequest[] { return [...this._blockedRequests]; }
  get enabledCategories(): ReadonlySet<BlockCategory> { return new Set(this._enabledCategories); }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.emit({ kind: 'blockerToggled', enabled });
  }

  toggleCategory(category: BlockCategory, enabled: boolean): void {
    if (enabled) {
      this._enabledCategories.add(category);
    } else {
      this._enabledCategories.delete(category);
    }
    this.emit({ kind: 'categoryToggled', category, enabled });
  }

  shouldBlock(url: string): { blocked: boolean; category?: BlockCategory; rule?: BlockRule } {
    if (!this._enabled) return { blocked: false };

    const match = matchRule(url);
    if (!match) return { blocked: false };

    const { rule } = match;
    if (!this._enabledCategories.has(rule.category)) return { blocked: false };

    const blocked: BlockedRequest = {
      url,
      domain: match.domain,
      category: rule.category,
      timestamp: Date.now(),
      resourceKind: 'unknown',
    };

    this._blockedRequests.push(blocked);
    this.emit({ kind: 'requestBlocked', blocked, totalBlocked: this._blockedRequests.length });

    return { blocked: true, category: rule.category, rule };
  }

  getBlockedByCategory(): Record<BlockCategory, number> {
    const counts = {} as Record<BlockCategory, number>;
    for (const cat of ALL_CATEGORIES) counts[cat] = 0;
    for (const r of this._blockedRequests) counts[r.category]++;
    return counts;
  }

  clearStats(): void {
    this._blockedRequests = [];
  }

  on(type: BlockerEventType, handler: BlockerEventHandler): void {
    let handlers = this.eventMap.get(type);
    if (!handlers) {
      handlers = new Set();
      this.eventMap.set(type, handlers);
    }
    handlers.add(handler);
  }

  off(type: BlockerEventType, handler: BlockerEventHandler): void {
    const handlers = this.eventMap.get(type);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this.eventMap.delete(type);
    }
  }

  private emit(event: BlockerEventUnion): void {
    const handlers = this.eventMap.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error('[TrackerBlocker] Handler threw:', err);
      }
    }
  }

  dispose(): void {
    this._blockedRequests = [];
    this._enabledCategories.clear();
    this.eventMap.clear();
  }
}

export { TrackerBlocker, DEFAULT_RULES, ALL_CATEGORIES, CATEGORY_LABELS };
export type { ITrackerBlocker, BlockCategory, BlockRule, BlockedRequest, BlockerEvent, BlockerEventUnion, BlockerEventType };
