import type { IDisposable } from '../../app/dependency-container';

type AdCategory = 'banner' | 'video' | 'popup' | 'native' | 'malvertising' | 'tracking-ad' | 'sponsored';

interface AdFilterRule {
  readonly pattern: string;
  readonly category: AdCategory;
  readonly description: string;
  readonly domains?: readonly string[];
}

interface AdBlockMatch {
  readonly rule: AdFilterRule;
  readonly matchedPattern: string;
  readonly url: string;
}

interface BlockedAd {
  readonly url: string;
  readonly category: AdCategory;
  readonly rule: AdFilterRule;
  readonly timestamp: number;
  readonly resourceKind: string;
}

interface AdElementSelector {
  readonly selector: string;
  readonly category: AdCategory;
  readonly description: string;
}

type AdBlockerEventType =
  | 'adBlocked'
  | 'adBlockerToggled'
  | 'elementHidden';

interface AdBlockedEvent {
  readonly kind: 'adBlocked';
  readonly blocked: BlockedAd;
  readonly totalBlocked: number;
}

interface AdBlockerToggledEvent {
  readonly kind: 'adBlockerToggled';
  readonly enabled: boolean;
}

interface ElementHiddenEvent {
  readonly kind: 'elementHidden';
  readonly selector: string;
  readonly category: AdCategory;
}

type AdBlockerEvent = AdBlockedEvent | AdBlockerToggledEvent | ElementHiddenEvent;
type AdBlockerEventHandler = (event: AdBlockerEvent) => void;

const AD_FILTER_RULES: AdFilterRule[] = [
  { pattern: 'doubleclick.net', category: 'banner', description: 'Google DoubleClick' },
  { pattern: 'googlesyndication.com', category: 'banner', description: 'Google Syndication' },
  { pattern: 'googleadservices.com', category: 'banner', description: 'Google Ad Services' },
  { pattern: 'pagead2.googlesyndication.com', category: 'banner', description: 'Google AdSense' },
  { pattern: 'adservice.google.com', category: 'banner', description: 'Google Ad Service' },
  { pattern: 'adnxs.com', category: 'banner', description: 'AppNexus' },
  { pattern: 'adsrvr.org', category: 'banner', description: 'The Trade Desk' },
  { pattern: 'criteo.com', category: 'banner', description: 'Criteo' },
  { pattern: 'criteo.net', category: 'banner', description: 'Criteo CDN' },
  { pattern: 'advertising.com', category: 'banner', description: 'AOL Advertising' },
  { pattern: 'adzerk.net', category: 'banner', description: 'Adzerk' },
  { pattern: 'moatads.com', category: 'tracking-ad', description: 'Moat Measurement' },
  { pattern: 'casalemedia.com', category: 'banner', description: 'Casale Media' },
  { pattern: 'openx.net', category: 'banner', description: 'OpenX' },
  { pattern: 'pubmatic.com', category: 'banner', description: 'PubMatic' },
  { pattern: 'rubiconproject.com', category: 'banner', description: 'Rubicon Project' },
  { pattern: 'indexww.com', category: 'banner', description: 'Index Exchange' },
  { pattern: 'sovrn.com', category: 'banner', description: 'Sovrn' },
  { pattern: 'sharethrough.com', category: 'native', description: 'ShareThrough' },
  { pattern: 'adsafeprotected.com', category: 'tracking-ad', description: 'Integral Ad Science' },
  { pattern: 'adroll.com', category: 'banner', description: 'AdRoll' },
  { pattern: 'amazon-adsystem.com', category: 'banner', description: 'Amazon Ads' },
  { pattern: 'bidswitch.net', category: 'banner', description: 'BidSwitch' },
  { pattern: 'improvedigital.com', category: 'banner', description: 'Improve Digital' },
  { pattern: 'smartadserver.com', category: 'banner', description: 'Smart AdServer' },
  { pattern: 'taboola.com', category: 'native', description: 'Taboola' },
  { pattern: 'outbrain.com', category: 'native', description: 'Outbrain' },
  { pattern: 'popads.net', category: 'popup', description: 'PopAds' },
  { pattern: 'exdynsrv.com', category: 'popup', description: 'ExoClick' },
  { pattern: 'propellerads.com', category: 'popup', description: 'PropellerAds' },
  { pattern: 'revcontent.com', category: 'native', description: 'RevContent' },
  { pattern: 'mgid.com', category: 'native', description: 'MGID' },
  { pattern: 'adform.com', category: 'banner', description: 'AdForm' },
  { pattern: 'adserver.com', category: 'banner', description: 'Generic AdServer' },
  { pattern: 'adtech.de', category: 'banner', description: 'AdTech' },
  { pattern: 'tremorhub.com', category: 'video', description: 'Tremor Video' },
  { pattern: 'spotx.tv', category: 'video', description: 'SpotX Video' },
  { pattern: 'cdn.taboola.com', category: 'native', description: 'Taboola CDN' },
  { pattern: 'cdn.outbrain.com', category: 'native', description: 'Outbrain CDN' },
  { pattern: 'cdn.criteo.com', category: 'banner', description: 'Criteo CDN' },
  { pattern: 'tpc.googlesyndication.com', category: 'banner', description: 'Google TPC' },
  { pattern: 'cm.g.doubleclick.net', category: 'banner', description: 'DoubleClick CM' },
  { pattern: 'adclick.g.doubleclick.net', category: 'banner', description: 'DoubleClick AdClick' },
  { pattern: 'securepubads.g.doubleclick.net', category: 'banner', description: 'Google Publisher Tags' },
  { pattern: 'protagcdn.com', category: 'banner', description: 'ProTag' },
  { pattern: 'assets.bounceexchange.com', category: 'sponsored', description: 'BounceX' },
  { pattern: 'aax.amazon-adsystem.com', category: 'banner', description: 'Amazon AAX' },
  { pattern: 's.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads System' },
  { pattern: 'ir-na.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads Reporting' },
  { pattern: 's0.2mdn.net', category: 'banner', description: 'DoubleClick Studio' },
  { pattern: 'pixel.adsafeprotected.com', category: 'tracking-ad', description: 'IAS Pixel' },
  { pattern: 'dtmc.adsafeprotected.com', category: 'tracking-ad', description: 'IAS Tracking' },
  { pattern: 'z-na.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads Zone' },
  { pattern: 'ad-delivery.net', category: 'banner', description: 'Ad Delivery Network' },
  { pattern: 'adspirit.de', category: 'banner', description: 'AdSpirit' },
  { pattern: 'adition.com', category: 'banner', description: 'Adition' },
  { pattern: 'ad-up.com', category: 'banner', description: 'AdUp' },
  { pattern: 'adventori.com', category: 'banner', description: 'Adventori' },
  { pattern: 'adzerk.com', category: 'banner', description: 'Adzerk' },
  { pattern: '/pagead/', category: 'banner', description: 'Google PageAd path' },
  { pattern: '/banner/', category: 'banner', description: 'Generic banner path' },
  { pattern: '/ad/', category: 'banner', description: 'Generic ad path' },
  { pattern: '/ads/', category: 'banner', description: 'Generic ads path' },
  { pattern: '/sponsor/', category: 'sponsored', description: 'Sponsor path' },
  { pattern: '/sponsored/', category: 'sponsored', description: 'Sponsored content path' },
  { pattern: 'an_yande', category: 'tracking-ad', description: 'Yandex Ad pixel' },
  { pattern: 'ad.mo', category: 'banner', description: 'Mobile ad pattern' },
  { pattern: 'ad-sense', category: 'banner', description: 'AdSense pattern' },
  { pattern: 'adblock', category: 'banner', description: 'AdBlock detection' },
  { pattern: 'adbutler', category: 'banner', description: 'AdButler' },
  { pattern: 'adap.tv', category: 'video', description: 'ADAP Video' },
  { pattern: 'adserver', category: 'banner', description: 'AdServer pattern' },
];

const AD_ELEMENT_SELECTORS: AdElementSelector[] = [
  { selector: '[id*="google_ads"]', category: 'banner', description: 'Google Ads iframe' },
  { selector: '[id*="ad_"]', category: 'banner', description: 'Generic ad container' },
  { selector: '[id*="-ad-"]', category: 'banner', description: 'Generic ad element' },
  { selector: '[id*="Ads_"]', category: 'banner', description: 'Ads container' },
  { selector: '[class*="ad_"]', category: 'banner', description: 'Ad class pattern' },
  { selector: '[class*="-ad-"]', category: 'banner', description: 'Ad class pattern' },
  { selector: '[class*="ads-"]', category: 'banner', description: 'Ads class pattern' },
  { selector: '[class*="ads_"]', category: 'banner', description: 'Ads class pattern' },
  { selector: '[class*="advert"]', category: 'banner', description: 'Advert class' },
  { selector: '[class*="sponsor"]', category: 'sponsored', description: 'Sponsor class' },
  { selector: '[class*="banner"]', category: 'banner', description: 'Banner class' },
  { selector: 'div[data-ad]', category: 'banner', description: 'Data-ad attribute' },
  { selector: 'div[data-google-query-id]', category: 'banner', description: 'Google query ID' },
  { selector: 'iframe[src*="doubleclick"]', category: 'banner', description: 'DoubleClick iframe' },
  { selector: 'iframe[src*="ads"]', category: 'banner', description: 'Ads iframe' },
  { selector: 'iframe[src*="adservice"]', category: 'banner', description: 'AdService iframe' },
  { selector: 'img[src*="doubleclick"]', category: 'banner', description: 'DoubleClick pixel' },
  { selector: 'img[src*="ad."]', category: 'banner', description: 'Ad domain pixel' },
  { selector: 'img[src*="ads."]', category: 'banner', description: 'Ads domain pixel' },
  { selector: 'ins.adsbygoogle', category: 'banner', description: 'AdSense ins element' },
];

interface IAdBlocker extends IDisposable {
  readonly enabled: boolean;
  readonly totalBlocked: number;
  readonly blockedAds: readonly BlockedAd[];
  setEnabled(enabled: boolean): void;
  shouldBlock(url: string, resourceKind?: string): { blocked: boolean; match?: AdBlockMatch };
  getElementSelectors(): readonly AdElementSelector[];
  recordBlocked(match: AdBlockMatch, resourceKind: string): void;
  getBlockedByCategory(): Record<AdCategory, number>;
  clearStats(): void;
  addCustomRule(rule: AdFilterRule): void;
  removeCustomRule(pattern: string): void;
  on(type: AdBlockerEventType, handler: AdBlockerEventHandler): void;
  off(type: AdBlockerEventType, handler: AdBlockerEventHandler): void;
}

const ALL_AD_CATEGORIES: readonly AdCategory[] = [
  'banner', 'video', 'popup', 'native', 'malvertising', 'tracking-ad', 'sponsored',
];

class AdBlocker implements IAdBlocker {
  private _enabled = true;
  private _blockedAds: BlockedAd[] = [];
  private readonly customRules: AdFilterRule[] = [];
  private readonly eventHandlers = new Map<AdBlockerEventType, Set<AdBlockerEventHandler>>();

  get enabled(): boolean { return this._enabled; }
  get totalBlocked(): number { return this._blockedAds.length; }
  get blockedAds(): readonly BlockedAd[] { return [...this._blockedAds]; }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.emit({ kind: 'adBlockerToggled', enabled });
  }

  shouldBlock(url: string, _resourceKind?: string): { blocked: boolean; match?: AdBlockMatch } {
    if (!this._enabled) return { blocked: false };

    const lower = url.toLowerCase();
    const allRules = [...AD_FILTER_RULES, ...this.customRules];

    for (const rule of allRules) {
      if (lower.includes(rule.pattern)) {
        const match: AdBlockMatch = { rule, matchedPattern: rule.pattern, url };
        return { blocked: true, match };
      }
    }

    return { blocked: false };
  }

  getElementSelectors(): readonly AdElementSelector[] {
    return AD_ELEMENT_SELECTORS;
  }

  recordBlocked(match: AdBlockMatch, resourceKind: string): void {
    const blocked: BlockedAd = {
      url: match.url,
      category: match.rule.category,
      rule: match.rule,
      timestamp: Date.now(),
      resourceKind,
    };
    this._blockedAds.push(blocked);
    this.emit({ kind: 'adBlocked', blocked, totalBlocked: this._blockedAds.length });
  }

  getBlockedByCategory(): Record<AdCategory, number> {
    const counts = {} as Record<AdCategory, number>;
    for (const cat of ALL_AD_CATEGORIES) counts[cat] = 0;
    for (const ad of this._blockedAds) counts[ad.category]++;
    return counts;
  }

  clearStats(): void {
    this._blockedAds = [];
  }

  addCustomRule(rule: AdFilterRule): void {
    this.customRules.push(rule);
  }

  removeCustomRule(pattern: string): void {
    const idx = this.customRules.findIndex(r => r.pattern === pattern);
    if (idx !== -1) this.customRules.splice(idx, 1);
  }

  on(type: AdBlockerEventType, handler: AdBlockerEventHandler): void {
    if (!this.eventHandlers.has(type)) this.eventHandlers.set(type, new Set());
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: AdBlockerEventType, handler: AdBlockerEventHandler): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  private emit(event: AdBlockerEvent): void {
    const handlers = this.eventHandlers.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error('[AdBlocker] Handler threw:', err);
      }
    }
  }

  dispose(): void {
    this._blockedAds = [];
    this.customRules.length = 0;
    this.eventHandlers.clear();
  }
}

export { AdBlocker, AD_FILTER_RULES, AD_ELEMENT_SELECTORS, ALL_AD_CATEGORIES };
export type { IAdBlocker, AdCategory, AdFilterRule, AdBlockMatch, BlockedAd, AdElementSelector, AdBlockerEvent, AdBlockerEventType };
