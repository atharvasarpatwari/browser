import type { IDisposable } from '../../app/dependency-container';

type AdCategory =
  | 'banner'
  | 'video'
  | 'popup'
  | 'native'
  | 'malvertising'
  | 'tracking-ad'
  | 'sponsored'
  | 'anti-adblock'
  | 'crypto-miner'
  | 'fingerprinting'
  | 'redirect'
  | 'malware'
  | 'annoyance'
  | 'newsletter'
  | 'survey'
  | 'self-promotion'
  | 'paywall';

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

interface CosmeticRule {
  readonly selector: string;
  readonly domain?: string;
  readonly category: AdCategory;
  readonly description: string;
}

interface RedirectRule {
  readonly pattern: string;
  readonly redirectUrl: string;
  readonly description: string;
}

type AdBlockerEventType =
  | 'adBlocked'
  | 'adBlockerToggled'
  | 'elementHidden'
  | 'popupBlocked'
  | 'antiAdblockDetected'
  | 'categoryToggled';

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

interface PopupBlockedEvent {
  readonly kind: 'popupBlocked';
  readonly url: string;
  readonly openerUrl: string;
}

interface AntiAdblockDetectedEvent {
  readonly kind: 'antiAdblockDetected';
  readonly url: string;
  readonly scriptPattern: string;
}

interface CategoryToggledEvent {
  readonly kind: 'categoryToggled';
  readonly category: AdCategory;
  readonly enabled: boolean;
}

type AdBlockerEvent =
  | AdBlockedEvent
  | AdBlockerToggledEvent
  | ElementHiddenEvent
  | PopupBlockedEvent
  | AntiAdblockDetectedEvent
  | CategoryToggledEvent;

type AdBlockerEventHandler = (event: AdBlockerEvent) => void;

// ─── Massive domain-based ad filter rules ───────────────────────────────────

const AD_FILTER_RULES: AdFilterRule[] = [
  // ── Google Ads ecosystem ──
  { pattern: 'doubleclick.net', category: 'banner', description: 'Google DoubleClick' },
  { pattern: 'googlesyndication.com', category: 'banner', description: 'Google Syndication' },
  { pattern: 'googleadservices.com', category: 'banner', description: 'Google Ad Services' },
  { pattern: 'pagead2.googlesyndication.com', category: 'banner', description: 'Google AdSense' },
  { pattern: 'adservice.google.com', category: 'banner', description: 'Google Ad Service' },
  { pattern: 'securepubads.g.doubleclick.net', category: 'banner', description: 'Google Publisher Tags' },
  { pattern: 'tpc.googlesyndication.com', category: 'banner', description: 'Google TPC' },
  { pattern: 'cm.g.doubleclick.net', category: 'banner', description: 'DoubleClick CM' },
  { pattern: 'adclick.g.doubleclick.net', category: 'banner', description: 'DoubleClick AdClick' },
  { pattern: 'googleads.g.doubleclick.net', category: 'banner', description: 'GAds DoubleClick' },
  { pattern: 'pagead.googlesyndication.com', category: 'banner', description: 'Google PageAd' },
  { pattern: 'ads.google.com', category: 'banner', description: 'Google Ads' },
  { pattern: 'www.googleadservices.com', category: 'banner', description: 'Google Ad Services WWW' },
  { pattern: 'adservice.google.co.jp', category: 'banner', description: 'Google Ad JP' },
  { pattern: 'adservice.google.co.uk', category: 'banner', description: 'Google Ad UK' },
  { pattern: 'adservice.google.de', category: 'banner', description: 'Google Ad DE' },
  { pattern: 'adservice.google.fr', category: 'banner', description: 'Google Ad FR' },
  { pattern: 'adservice.google.ca', category: 'banner', description: 'Google Ad CA' },
  { pattern: 'adservice.google.com.au', category: 'banner', description: 'Google Ad AU' },
  { pattern: 'adservice.google.nl', category: 'banner', description: 'Google Ad NL' },
  { pattern: 'adservice.google.it', category: 'banner', description: 'Google Ad IT' },
  { pattern: 'adservice.google.es', category: 'banner', description: 'Google Ad ES' },
  { pattern: 'adservice.google.pl', category: 'banner', description: 'Google Ad PL' },
  { pattern: 'adservice.google.com.br', category: 'banner', description: 'Google Ad BR' },
  { pattern: 'adservice.google.co.in', category: 'banner', description: 'Google Ad IN' },
  { pattern: 'adservice.google.com.mx', category: 'banner', description: 'Google Ad MX' },
  { pattern: 'adservice.google.co.kr', category: 'banner', description: 'Google Ad KR' },
  { pattern: 'adservice.google.com.tr', category: 'banner', description: 'Google Ad TR' },
  { pattern: 'adservice.google.ro', category: 'banner', description: 'Google Ad RO' },
  { pattern: 'adservice.google.ch', category: 'banner', description: 'Google Ad CH' },
  { pattern: 'adservice.google.be', category: 'banner', description: 'Google Ad BE' },
  { pattern: 'adservice.google.at', category: 'banner', description: 'Google Ad AT' },
  { pattern: 'adservice.google.se', category: 'banner', description: 'Google Ad SE' },
  { pattern: 'adservice.google.no', category: 'banner', description: 'Google Ad NO' },
  { pattern: 'adservice.google.fi', category: 'banner', description: 'Google Ad FI' },
  { pattern: 'adservice.google.dk', category: 'banner', description: 'Google Ad DK' },
  { pattern: 'adservice.google.pt', category: 'banner', description: 'Google Ad PT' },
  { pattern: 'adservice.google.cz', category: 'banner', description: 'Google Ad CZ' },
  { pattern: 'adservice.google.hu', category: 'banner', description: 'Google Ad HU' },
  { pattern: 'adservice.google.co.za', category: 'banner', description: 'Google Ad ZA' },
  { pattern: 'adservice.google.com.hk', category: 'banner', description: 'Google Ad HK' },
  { pattern: 'adservice.google.com.sg', category: 'banner', description: 'Google Ad SG' },
  { pattern: 'adservice.google.com.ar', category: 'banner', description: 'Google Ad AR' },
  { pattern: 'adservice.google.com.co', category: 'banner', description: 'Google Ad CO' },
  { pattern: 'adservice.google.com.pe', category: 'banner', description: 'Google Ad PE' },
  { pattern: 'adservice.google.cl', category: 'banner', description: 'Google Ad CL' },
  { pattern: 'adservice.google.co.th', category: 'banner', description: 'Google Ad TH' },
  { pattern: 'adservice.google.com.tw', category: 'banner', description: 'Google Ad TW' },
  { pattern: 'adservice.google.com.vn', category: 'banner', description: 'Google Ad VN' },
  { pattern: 'adservice.google.pl', category: 'banner', description: 'Google Ad PL duplicate' },
  { pattern: '/pagead/', category: 'banner', description: 'Google PageAd path' },

  // ── AppNexus / Xandr ──
  { pattern: 'adnxs.com', category: 'banner', description: 'AppNexus / Xandr' },
  { pattern: 'adnxs.net', category: 'banner', description: 'AppNexus CDN' },
  { pattern: 'ib.adnxs.com', category: 'banner', description: 'AppNexus bidder' },
  { pattern: 'cdn.adnxs.com', category: 'banner', description: 'AppNexus CDN' },

  // ── The Trade Desk ──
  { pattern: 'adsrvr.org', category: 'banner', description: 'The Trade Desk' },
  { pattern: 'adnxs.com', category: 'banner', description: 'AppNexus' },

  // ── Criteo ──
  { pattern: 'criteo.com', category: 'banner', description: 'Criteo' },
  { pattern: 'criteo.net', category: 'banner', description: 'Criteo CDN' },
  { pattern: 'cdn.criteo.com', category: 'banner', description: 'Criteo CDN' },
  { pattern: 'dis.criteo.com', category: 'banner', description: 'Criteo Display' },
  { pattern: 'emailretargeting.com', category: 'tracking-ad', description: 'Criteo Email' },

  // ── AOL / Verizon Media ──
  { pattern: 'advertising.com', category: 'banner', description: 'AOL Advertising' },
  { pattern: 'adtech.de', category: 'banner', description: 'AdTech' },
  { pattern: 'adserver.yahoo.com', category: 'banner', description: 'Yahoo Ad Server' },

  // ── Adzerk ──
  { pattern: 'adzerk.net', category: 'banner', description: 'Adzerk' },
  { pattern: 'adzerk.com', category: 'banner', description: 'Adzerk' },

  // ── Moat ──
  { pattern: 'moatads.com', category: 'tracking-ad', description: 'Moat Measurement' },

  // ── Casale Media / Index Exchange ──
  { pattern: 'casalemedia.com', category: 'banner', description: 'Casale Media' },
  { pattern: 'indexww.com', category: 'banner', description: 'Index Exchange' },

  // ── OpenX ──
  { pattern: 'openx.net', category: 'banner', description: 'OpenX' },
  { pattern: 'openx.com', category: 'banner', description: 'OpenX' },
  { pattern: 'servedbyopenx.com', category: 'banner', description: 'OpenX Served' },
  { pattern: 'pub.openx.net', category: 'banner', description: 'OpenX Pub' },

  // ── PubMatic ──
  { pattern: 'pubmatic.com', category: 'banner', description: 'PubMatic' },
  { pattern: 'ads.pubmatic.com', category: 'banner', description: 'PubMatic Ads' },
  { pattern: 'hb.pubmatic.com', category: 'banner', description: 'PubMatic Header Bidding' },

  // ── Rubicon Project / Magnite ──
  { pattern: 'rubiconproject.com', category: 'banner', description: 'Rubicon Project' },
  { pattern: 'rubicon.com', category: 'banner', description: 'Magnite / Rubicon' },
  { pattern: 'fastlane.rubiconproject.com', category: 'banner', description: 'Rubicon FastLane' },
  { pattern: 'pixel.rubiconproject.com', category: 'tracking-ad', description: 'Rubicon Pixel' },
  { pattern: 'video.rubiconproject.com', category: 'video', description: 'Rubicon Video' },

  // ── Sovrn / Ligatus ──
  { pattern: 'sovrn.com', category: 'banner', description: 'Sovrn' },
  { pattern: 'ligatus.com', category: 'banner', description: 'Ligatus' },

  // ── Amazon Ads ──
  { pattern: 'amazon-adsystem.com', category: 'banner', description: 'Amazon Ads' },
  { pattern: 'aax.amazon-adsystem.com', category: 'banner', description: 'Amazon AAX' },
  { pattern: 's.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads System' },
  { pattern: 'ir-na.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads Reporting' },
  { pattern: 'z-na.amazon-adsystem.com', category: 'banner', description: 'Amazon Ads Zone' },

  // ── BidSwitch ──
  { pattern: 'bidswitch.net', category: 'banner', description: 'BidSwitch' },
  { pattern: 'bidswitch.com', category: 'banner', description: 'BidSwitch' },

  // ── Improve Digital ──
  { pattern: 'improvedigital.com', category: 'banner', description: 'Improve Digital' },

  // ── Smart AdServer ──
  { pattern: 'smartadserver.com', category: 'banner', description: 'Smart AdServer' },
  { pattern: 'sascdn.com', category: 'banner', description: 'Smart AdServer CDN' },

  // ── AdForm ──
  { pattern: 'adform.com', category: 'banner', description: 'AdForm' },

  // ── Generic ad servers ──
  { pattern: 'adserver.com', category: 'banner', description: 'Generic AdServer' },

  // ── ShareThrough ──
  { pattern: 'sharethrough.com', category: 'native', description: 'ShareThrough' },

  // ── Integral Ad Science (IAS) ──
  { pattern: 'adsafeprotected.com', category: 'tracking-ad', description: 'Integral Ad Science' },
  { pattern: 'pixel.adsafeprotected.com', category: 'tracking-ad', description: 'IAS Pixel' },
  { pattern: 'dtmc.adsafeprotected.com', category: 'tracking-ad', description: 'IAS Tracking' },

  // ── AdRoll ──
  { pattern: 'adroll.com', category: 'banner', description: 'AdRoll' },
  { pattern: 'adrollpixel.com', category: 'banner', description: 'AdRoll Pixel' },

  // ── Taboola ──
  { pattern: 'taboola.com', category: 'native', description: 'Taboola' },
  { pattern: 'cdn.taboola.com', category: 'native', description: 'Taboola CDN' },
  { pattern: 'trc.taboola.com', category: 'native', description: 'Taboola TRC' },
  { pattern: 'nr.taboola.com', category: 'native', description: 'Taboola NR' },
  { pattern: 'vidstat.taboola.com', category: 'tracking-ad', description: 'Taboola Stats' },
  { pattern: 'cdn.taboola.com', category: 'native', description: 'Taboola CDN' },

  // ── Outbrain ──
  { pattern: 'outbrain.com', category: 'native', description: 'Outbrain' },
  { pattern: 'cdn.outbrain.com', category: 'native', description: 'Outbrain CDN' },
  { pattern: 'widgets.outbrain.com', category: 'native', description: 'Outbrain Widgets' },
  { pattern: 'log.outbrain.com', category: 'tracking-ad', description: 'Outbrain Logging' },

  // ── RevContent ──
  { pattern: 'revcontent.com', category: 'native', description: 'RevContent' },

  // ── MGID ──
  { pattern: 'mgid.com', category: 'native', description: 'MGID' },

  // ── Video Ad Serving ──
  { pattern: 'tremorhub.com', category: 'video', description: 'Tremor Video' },
  { pattern: 'spotx.tv', category: 'video', description: 'SpotX Video' },
  { pattern: 'spotxchange.com', category: 'video', description: 'SpotXchange' },
  { pattern: 'adap.tv', category: 'video', description: 'ADAP Video' },
  { pattern: 'vindico.com', category: 'video', description: 'Vindico Video' },
  { pattern: 'serving-sys.com', category: 'banner', description: 'Sizmek / MediaMind' },
  { pattern: 'eyeviews.com', category: 'video', description: 'EyeViews Video' },
  { pattern: 'jwpltx.com', category: 'video', description: 'JW Player Monetization' },
  { pattern: 'jwpsrv.com', category: 'video', description: 'JW Player Ads' },
  { pattern: 'vastx.net', category: 'video', description: 'VAST Ad Serving' },
  { pattern: 'doubleclick.net/pfad/', category: 'video', description: 'DoubleClick VAST' },

  // ── PopAds / Popunders ──
  { pattern: 'popads.net', category: 'popup', description: 'PopAds' },
  { pattern: 'popads.com', category: 'popup', description: 'PopAds' },
  { pattern: 'popcash.net', category: 'popup', description: 'PopCash' },
  { pattern: 'exdynsrv.com', category: 'popup', description: 'ExoClick Pop' },
  { pattern: 'propellerads.com', category: 'popup', description: 'PropellerAds' },
  { pattern: 'propellerclick.com', category: 'popup', description: 'PropellerClick' },
  { pattern: 'onclickads.com', category: 'popup', description: 'OnClick Ads' },
  { pattern: 'onclickmax.com', category: 'popup', description: 'OnClickMax' },
  { pattern: 'juicyads.com', category: 'popup', description: 'JuicyAds' },
  { pattern: 'exoclick.com', category: 'popup', description: 'ExoClick' },
  { pattern: 'trafficjunky.com', category: 'popup', description: 'TrafficJunky' },
  { pattern: 'erosadv.com', category: 'popup', description: 'Eros Advertising' },
  { pattern: 'adskeeper.com', category: 'popup', description: 'AdSkeeper' },
  { pattern: 'adsterra.com', category: 'popup', description: 'Adsterra' },
  { pattern: 'hilltopads.com', category: 'popup', description: 'HilltopAds' },
  { pattern: 'monuware.net', category: 'popup', description: 'Monuware' },
  { pattern: 'vooservers.com', category: 'popup', description: 'VooServers' },
  { pattern: 'terraclicks.com', category: 'popup', description: 'Terraclicks' },
  { pattern: 'revenuepm.net', category: 'popup', description: 'RevenuePM' },

  // ── Malvertising / Malware domains ──
  { pattern: 'malvertising.org', category: 'malvertising', description: 'Malvertising tracking' },
  { pattern: 'malwaredomainlist.com', category: 'malware', description: 'Malware Domain List' },
  { pattern: 'ads.yahoo.com', category: 'banner', description: 'Yahoo Ads' },
  { pattern: 'ad.yieldmanager.com', category: 'banner', description: 'Yahoo Yield Manager' },

  // ── Anti-adblock / wall detection ──
  { pattern: 'blockadblock.com', category: 'anti-adblock', description: 'BlockAdblock detection' },
  { pattern: 'adblockanalytics.com', category: 'anti-adblock', description: 'Adblock Analytics' },
  { pattern: 'adblicious.com', category: 'anti-adblock', description: 'Adblicious' },
  { pattern: 'adblockdetect.com', category: 'anti-adblock', description: 'Adblock Detect' },
  { pattern: 'pagefair.com', category: 'anti-adblock', description: 'PageFair anti-adblock' },
  { pattern: 'pagefair.net', category: 'anti-adblock', description: 'PageFair' },
  { pattern: 'sourcepoint.com', category: 'anti-adblock', description: 'Sourcepoint CMP' },
  { pattern: 'didomi.io', category: 'anti-adblock', description: 'Didomi CMP' },
  { pattern: 'piano.io', category: 'anti-adblock', description: 'Piano / Tinypass' },
  { pattern: 'tinypass.com', category: 'anti-adblock', description: 'Tinypass paywall' },
  { pattern: 'quantcast.com', category: 'anti-adblock', description: 'Quantcast Choice CMP' },
  { pattern: 'consentframework.com', category: 'anti-adblock', description: 'Consent Framework' },
  { pattern: 'trustarc.com', category: 'anti-adblock', description: 'TrustArc CMP' },
  { pattern: 'onetrust.com', category: 'anti-adblock', description: 'OneTrust CMP' },
  { pattern: 'cookiepro.com', category: 'anti-adblock', description: 'CookiePro CMP' },
  { pattern: 'evidon.com', category: 'anti-adblock', description: 'Evidon / Crownpeak' },
  { pattern: 'axept.io', category: 'anti-adblock', description: 'Axept CMP' },
  { pattern: 'axeptio.eu', category: 'anti-adblock', description: 'Axeptio EU' },
  { pattern: 'soggywarrior.com', category: 'anti-adblock', description: 'Anti-adblock script' },
  { pattern: 'bearshield.com', category: 'anti-adblock', description: 'Anti-adblock detection' },
  { pattern: 'addefend.com', category: 'anti-adblock', description: 'AdDefend wall' },

  // ── Crypto mining scripts ──
  { pattern: 'coinhive.com', category: 'crypto-miner', description: 'CoinHive miner' },
  { pattern: 'coin-hive.com', category: 'crypto-miner', description: 'CoinHive variant' },
  { pattern: 'coinhive.min.js', category: 'crypto-miner', description: 'CoinHive miner script' },
  { pattern: 'cryptoloot.com', category: 'crypto-miner', description: 'CryptoLoot miner' },
  { pattern: 'crypto-loot.com', category: 'crypto-miner', description: 'CryptoLoot variant' },
  { pattern: 'minero.cc', category: 'crypto-miner', description: 'Minero miner' },
  { pattern: 'miner.start', category: 'crypto-miner', description: 'Miner start script' },
  { pattern: 'authedmine.com', category: 'crypto-miner', description: 'AuthedMine (consensual)' },
  { pattern: 'jsecoin.com', category: 'crypto-miner', description: 'JSEcoin miner' },
  { pattern: 'ppoi.org', category: 'crypto-miner', description: 'Crypto mining proxy' },
  { pattern: 'minr.pw', category: 'crypto-miner', description: 'Minr miner' },
  { pattern: 'webmine.cz', category: 'crypto-miner', description: 'WebMine miner' },
  { pattern: 'webmining.co', category: 'crypto-miner', description: 'WebMining' },
  { pattern: 'miner.ninja', category: 'crypto-miner', description: 'Miner.ninja' },
  { pattern: 'browsermine.com', category: 'crypto-miner', description: 'BrowserMine' },
  { pattern: 'monerominer.rocks', category: 'crypto-miner', description: 'MoneroMiner' },
  { pattern: 'gridcash.net', category: 'crypto-miner', description: 'GridCash miner' },
  { pattern: 'cryptonight.wasm', category: 'crypto-miner', description: 'CryptoNight WASM' },

  // ── Fingerprinting scripts ──
  { pattern: 'fingerprint.com', category: 'fingerprinting', description: 'FingerprintJS Pro' },
  { pattern: 'fpjs.com', category: 'fingerprinting', description: 'FingerprintJS' },
  { pattern: 'cdn.jsdelivr.net/npm/@fingerprintjs', category: 'fingerprinting', description: 'FingerprintJS CDN' },
  { pattern: 'fptraffic.com', category: 'fingerprinting', description: 'Fingerprint Traffic' },
  { pattern: 'agkn.com', category: 'fingerprinting', description: 'Neustar Fingerprinting' },
  { pattern: 'blueconic.net', category: 'fingerprinting', description: 'BlueConic fingerprinting' },
  { pattern: 'hubspot.com/hs-analytics', category: 'tracking-ad', description: 'HubSpot Analytics' },

  // ── Third-party tracking pixels ──
  { pattern: 'pixel.facebook.com', category: 'tracking-ad', description: 'Facebook Pixel' },
  { pattern: 'facebook.com/tr/', category: 'tracking-ad', description: 'Facebook Tracker' },
  { pattern: 'facebook.com/tr', category: 'tracking-ad', description: 'Facebook Tracker Alt' },
  { pattern: 'connect.facebook.net', category: 'tracking-ad', description: 'Facebook Connect' },
  { pattern: 'analytics.twitter.com', category: 'tracking-ad', description: 'Twitter Analytics' },
  { pattern: 'platform.twitter.com/widgets.js', category: 'tracking-ad', description: 'Twitter Widget' },
  { pattern: 'snap.licdn.com', category: 'tracking-ad', description: 'LinkedIn Tracking' },
  { pattern: 'bat.bing.com', category: 'tracking-ad', description: 'Bing Ads UET' },
  { pattern: 'ads.linkedin.com', category: 'tracking-ad', description: 'LinkedIn Ads' },
  { pattern: 'ads.tiktok.com', category: 'tracking-ad', description: 'TikTok Ads' },
  { pattern: 'analytics.tiktok.com', category: 'tracking-ad', description: 'TikTok Analytics' },
  { pattern: 'tr.snapchat.com', category: 'tracking-ad', description: 'Snapchat Tracking' },
  { pattern: 'ads.pinterest.com', category: 'tracking-ad', description: 'Pinterest Ads' },
  { pattern: 'pinimg.com/ct/', category: 'tracking-ad', description: 'Pinterest Tag' },
  { pattern: 'redditstatic.com/ads像素', category: 'tracking-ad', description: 'Reddit Pixel' },

  // ── Analytics / tracking infrastructure ──
  { pattern: 'googletagmanager.com', category: 'tracking-ad', description: 'Google Tag Manager' },
  { pattern: 'googletagmanager.com/gtag/', category: 'tracking-ad', description: 'Google gtag.js' },
  { pattern: 'google-analytics.com', category: 'tracking-ad', description: 'Google Analytics' },
  { pattern: 'analytics.google.com', category: 'tracking-ad', description: 'Google Analytics 4' },
  { pattern: 'googletagservices.com', category: 'tracking-ad', description: 'Google Tag Services' },
  { pattern: 'stats.g.doubleclick.net', category: 'tracking-ad', description: 'DoubleClick Stats' },
  { pattern: 'hotjar.com', category: 'tracking-ad', description: 'Hotjar analytics' },
  { pattern: 'sentry.io', category: 'tracking-ad', description: 'Sentry Error Tracking' },
  { pattern: 'newrelic.com', category: 'tracking-ad', description: 'New Relic Monitoring' },
  { pattern: 'nr-data.net', category: 'tracking-ad', description: 'New Relic Data' },
  { pattern: 'chartbeat.com', category: 'tracking-ad', description: 'Chartbeat Analytics' },
  { pattern: 'chartbeat.net', category: 'tracking-ad', description: 'Chartbeat CDN' },
  { pattern: 'segment.com', category: 'tracking-ad', description: 'Segment Analytics' },
  { pattern: 'segment.io', category: 'tracking-ad', description: 'Segment IO' },
  { pattern: 'amplitude.com', category: 'tracking-ad', description: 'Amplitude Analytics' },
  { pattern: 'mixpanel.com', category: 'tracking-ad', description: 'Mixpanel Analytics' },
  { pattern: 'branch.io', category: 'tracking-ad', description: 'Branch Attribution' },
  { pattern: 'adjust.com', category: 'tracking-ad', description: 'Adjust Attribution' },
  { pattern: 'appsflyer.com', category: 'tracking-ad', description: 'AppsFlyer Attribution' },
  { pattern: 'singular.net', category: 'tracking-ad', description: 'Singular Attribution' },
  { pattern: 'kochava.com', category: 'tracking-ad', description: 'Kochava Attribution' },
  { pattern: 'branch.io', category: 'tracking-ad', description: 'Branch Attribution' },
  { pattern: 'clickmeter.com', category: 'tracking-ad', description: 'ClickMeter' },
  { pattern: 'click.a]bssrvr.org', category: 'tracking-ad', description: 'Click Tracker' },
  { pattern: 'doubleverify.com', category: 'tracking-ad', description: 'DoubleVerify' },
  { pattern: 'dvtps.com', category: 'tracking-ad', description: 'DoubleVerify Pixel' },
  { pattern: 'tynt.com', category: 'tracking-ad', description: 'Tynt Social / Analytics' },
  { pattern: 'permutive.com', category: 'tracking-ad', description: 'Permutive DMP' },
  { pattern: 'permutive.app', category: 'tracking-ad', description: 'Permutive App' },
  { pattern: 'addthis.com', category: 'tracking-ad', description: 'AddThis Social' },
  { pattern: 'bluekai.com', category: 'tracking-ad', description: 'Oracle BlueKai' },
  { pattern: 'omtrdc.net', category: 'tracking-ad', description: 'Adobe Analytics' },
  { pattern: 'demdex.net', category: 'tracking-ad', description: 'Adobe Audience Manager' },
  { pattern: 'everesttech.net', category: 'tracking-ad', description: 'Adobe Advertising Cloud' },
  { pattern: 'adsymptotic.com', category: 'tracking-ad', description: 'AdSymptotic' },
  { pattern: 'mathtag.com', category: 'tracking-ad', description: 'MediaMath' },
  { pattern: 'media.net', category: 'banner', description: 'Media.net / Yahoo Bing' },
  { pattern: 'contextweb.com', category: 'banner', description: 'PulsePoint' },
  { pattern: 'lijit.com', category: 'banner', description: 'Sovrn / Lijit' },
  { pattern: 'turn.com', category: 'banner', description: 'Turn / Amobee' },
  { pattern: 'exelator.com', category: 'tracking-ad', description: 'Nielsen eXelate' },
  { pattern: 'rlcdn.com', category: 'tracking-ad', description: 'LiveRamp Identity' },
  { pattern: 'tapad.com', category: 'tracking-ad', description: 'TapAd Device Graph' },
  { pattern: 'crwdcntrl.net', category: 'tracking-ad', description: 'Lotame Data' },
  { pattern: 'adsymptotic.com', category: 'tracking-ad', description: 'AdSymptotic' },

  // ── Bounce Exchange / Wunderkind ──
  { pattern: 'bounceexchange.com', category: 'sponsored', description: 'BounceX / Wunderkind' },
  { pattern: 'wunderkind.co', category: 'sponsored', description: 'Wunderkind' },

  // ── Bounce Exchange assets ──
  { pattern: 'assets.bounceexchange.com', category: 'sponsored', description: 'BounceX Assets' },

  // ── Sponsored / Native content ──
  { pattern: '/sponsor/', category: 'sponsored', description: 'Sponsor path' },
  { pattern: '/sponsored/', category: 'sponsored', description: 'Sponsored content' },
  { pattern: '/advertorial/', category: 'sponsored', description: 'Advertorial' },

  // ── Generic ad serving patterns ──
  { pattern: '/banner/', category: 'banner', description: 'Generic banner path' },
  { pattern: '/ad/', category: 'banner', description: 'Generic ad path' },
  { pattern: '/ads/', category: 'banner', description: 'Generic ads path' },
  { pattern: '/adserver/', category: 'banner', description: 'AdServer path' },
  { pattern: '/adsys/', category: 'banner', description: 'AdSys path' },

  // ── Ad delivery networks ──
  { pattern: 'ad-delivery.net', category: 'banner', description: 'Ad Delivery Network' },
  { pattern: 'adspirit.de', category: 'banner', description: 'AdSpirit' },
  { pattern: 'adition.com', category: 'banner', description: 'Adition' },
  { pattern: 'ad-up.com', category: 'banner', description: 'AdUp' },
  { pattern: 'adventori.com', category: 'banner', description: 'Adventori' },

  // ── DoubleClick Studio / rich media ──
  { pattern: 's0.2mdn.net', category: 'banner', description: 'DoubleClick Studio' },
  { pattern: 's1.2mdn.net', category: 'banner', description: 'DoubleClick CDN' },
  { pattern: '2mdn.net', category: 'banner', description: 'DoubleClick CDN Root' },
  { pattern: 'doubleclick.net/pfad/', category: 'video', description: 'DoubleClick VAST Ad' },

  // ── Outbrain CDN ──
  { pattern: 'cdn.outbrain.com', category: 'native', description: 'Outbrain CDN' },

  // ── ProTag / Protobuf ads ──
  { pattern: 'protagcdn.com', category: 'banner', description: 'ProTag' },

  // ── Yandex Ads ──
  { pattern: 'an_yande', category: 'tracking-ad', description: 'Yandex Ad pixel' },
  { pattern: 'an.yandex.ru', category: 'tracking-ad', description: 'Yandex Analytics' },
  { pattern: 'yandexadexchange.net', category: 'banner', description: 'Yandex Ad Exchange' },

  // ── Media.net / Yahoo Bing Contextual ──
  { pattern: 'media.net', category: 'banner', description: 'Media.net Ads' },

  // ── Mobile ad patterns ──
  { pattern: 'ad.mo', category: 'banner', description: 'Mobile ad pattern' },
  { pattern: 'ad-sense', category: 'banner', description: 'AdSense pattern' },
  { pattern: 'adblock', category: 'banner', description: 'AdBlock detection' },
  { pattern: 'adbutler', category: 'banner', description: 'AdButler' },
  { pattern: 'adserver', category: 'banner', description: 'AdServer pattern' },

  // ── Native content ad platforms ──
  { pattern: 'nativo.com', category: 'native', description: 'Nativo (Nativo)' },
  { pattern: 'sail-horizon.com', category: 'native', description: 'Sailthru / MediaVine' },
  { pattern: 'mediavine.com', category: 'native', description: 'MediaVine' },
  { pattern: 'gumgum.com', category: 'native', description: 'GumGum In-Image Ads' },
  { pattern: 'teads.tv', category: 'native', description: 'Teads In-Stream' },
  { pattern: 'triplelift.com', category: 'native', description: 'TripleLift Native' },
  { pattern: '3lift.com', category: 'native', description: 'TripleLift' },
  { pattern: 'connatix.com', category: 'native', description: 'Connatix Video Native' },
  { pattern: 'emxdgt.com', category: 'native', description: 'EMX Digital' },
  { pattern: 'boldwin.com', category: 'native', description: 'BoldWin Native' },

  // ── Header bidding wrappers ──
  { pattern: 'prebid.org', category: 'banner', description: 'Prebid.js' },
  { pattern: 'adnxs.com/ptv', category: 'banner', description: 'AppNexus Prebid' },
  { pattern: 'creative-preview', category: 'banner', description: 'Creative Preview' },

  // ── More popup / redirect domains ──
  { pattern: 'clkmg.com', category: 'popup', description: 'ClickMagick' },
  { pattern: 'yourtrackingdomain.com', category: 'popup', description: 'Generic tracker' },
  { pattern: 'lnk.parts', category: 'popup', description: 'Link Tracking' },
  { pattern: 'go2cloud.org', category: 'redirect', description: 'Go2Cloud Affiliate' },
  { pattern: 'dpbolvw.net', category: 'redirect', description: 'Commission Junction' },
  { pattern: 'jdoqocy.com', category: 'redirect', description: 'Commission Junction' },
  { pattern: 'kqzyfj.com', category: 'redirect', description: 'ShareASale' },
  { pattern: 'shareasale.com', category: 'redirect', description: 'ShareASale' },
  { pattern: 'anrdoezrs.net', category: 'redirect', description: 'LinkShare / Rakuten' },
  { pattern: 'nordstromrack.com', category: 'redirect', description: 'Nordstrom Affiliate' },
  { pattern: 'linksynergy.com', category: 'redirect', description: 'LinkShare' },
  { pattern: 'commission-junction.com', category: 'redirect', description: 'CJ Affiliate' },

  // ── Additional ad networks ──
  { pattern: 'buysellads.com', category: 'banner', description: 'BuySellAds' },
  { pattern: 'buysellads.net', category: 'banner', description: 'BuySellAds CDN' },
  { pattern: 'carbonads.com', category: 'banner', description: 'Carbon Ads' },
  { pattern: 'fiftyt.com', category: 'banner', description: 'Fifty/T' },
  { pattern: 'sail-horizon.com', category: 'banner', description: 'Sailthru' },
  { pattern: 'srv.us', category: 'banner', description: 'Generic Ad' },
  { pattern: 'srv2.us', category: 'banner', description: 'Generic Ad' },

  // ── In-video overlay ads ──
  { pattern: 'imasdk.googleapis.com', category: 'video', description: 'Google IMA SDK' },
  { pattern: 'vast.ymlp.com', category: 'video', description: 'VAST Ad' },
  { pattern: 'ad.adriver.ru', category: 'video', description: 'AdRiver Video' },

  // ── More anti-adblock ──
  { pattern: 'abp detectors', category: 'anti-adblock', description: 'ABP Detection' },
  { pattern: 'adblock-test', category: 'anti-adblock', description: 'Adblock Test' },
  { pattern: 'antiadblock', category: 'anti-adblock', description: 'Anti-Adblock Generic' },

  // ── Survey / newsletter popups ──
  { pattern: 'optinmonster.com', category: 'newsletter', description: 'OptinMonster Popups' },
  { pattern: 'sumo.com', category: 'newsletter', description: 'Sumo List Builder' },
  { pattern: 'sumome.com', category: 'newsletter', description: 'Sumo Me' },
  { pattern: 'hellotbar.com', category: 'newsletter', description: 'Hello Bar' },
  { pattern: 'sleeknote.com', category: 'newsletter', description: 'Sleeknote Popups' },
  { pattern: 'popupsmart.com', category: 'newsletter', description: 'PopupSmart' },
  { pattern: 'privy.com', category: 'newsletter', description: 'Privy Popups' },
  { pattern: 'convertbox.com', category: 'newsletter', description: 'ConvertBox' },
  { pattern: 'justuno.com', category: 'newsletter', description: 'Justuno Popups' },
  { pattern: 'wisepops.com', category: 'newsletter', description: 'WisePops' },
  { pattern: 'outgrow.co', category: 'survey', description: 'Outgrow Quizzes' },
  { pattern: 'typeform.com', category: 'survey', description: 'Typeform Embeds' },
  { pattern: 'surveymonkey.com', category: 'survey', description: 'SurveyMonkey' },

  // ── Self-promotion / referral ──
  { pattern: 'affiliate.', category: 'self-promotion', description: 'Affiliate Links' },
  { pattern: '/ref/', category: 'self-promotion', description: 'Referral Links' },
  { pattern: 'amzn.to', category: 'self-promotion', description: 'Amazon Short Links' },
  { pattern: 'bit.ly', category: 'self-promotion', description: 'Bitly Redirects' },
];

// ─── Comprehensive CSS selectors for DOM-level ad hiding ────────────────────

const AD_ELEMENT_SELECTORS: AdElementSelector[] = [
  // ── Google Ads ──
  { selector: '[id*="google_ads"]', category: 'banner', description: 'Google Ads iframe' },
  { selector: '[id*="google_ads_iframe"]', category: 'banner', description: 'Google Ads Iframe' },
  { selector: '[id*="adngin-"]', category: 'banner', description: 'Google Ad Manager' },
  { selector: '[id*="aswift_"]', category: 'banner', description: 'Google Ads Swift' },
  { selector: 'div[data-google-query-id]', category: 'banner', description: 'Google query ID' },
  { selector: 'ins.adsbygoogle', category: 'banner', description: 'AdSense ins element' },
  { selector: '.adsbygoogle', category: 'banner', description: 'AdSense class' },
  { selector: '.adsbygoogle-wrapper', category: 'banner', description: 'AdSense wrapper' },
  { selector: '[data-ad-client]', category: 'banner', description: 'AdSense data-ad-client' },
  { selector: '[data-ad-slot]', category: 'banner', description: 'AdSense data-ad-slot' },
  { selector: '[data-ad-layout-key]', category: 'banner', description: 'AdSense auto ad' },
  { selector: '[data-ad-format]', category: 'banner', description: 'AdSense auto format' },
  { selector: '#google_ads_frame', category: 'banner', description: 'Google Ads Frame' },
  { selector: '#aswift_0', category: 'banner', description: 'Google Ads Swift 0' },
  { selector: '.google-auto-placed', category: 'banner', description: 'Google Auto Placed' },
  { selector: 'amp-ad', category: 'banner', description: 'AMP Ad Component' },
  { selector: 'amp-embed[type="ad"]', category: 'banner', description: 'AMP Embed Ad' },

  // ── Generic ad containers ──
  { selector: '[id*="ad_"]', category: 'banner', description: 'Generic ad container' },
  { selector: '[id*="-ad-"]', category: 'banner', description: 'Generic ad element' },
  { selector: '[id*="Ads_"]', category: 'banner', description: 'Ads container' },
  { selector: '[id*="AD_"]', category: 'banner', description: 'AD container' },
  { selector: '[id*="AD_"]', category: 'banner', description: 'AD Container uppercase' },
  { selector: '[class*="ad_"]', category: 'banner', description: 'Ad class pattern' },
  { selector: '[class*="-ad-"]', category: 'banner', description: 'Ad class pattern' },
  { selector: '[class*="ads-"]', category: 'banner', description: 'Ads class pattern' },
  { selector: '[class*="ads_"]', category: 'banner', description: 'Ads class pattern' },
  { selector: '[class*="advert"]', category: 'banner', description: 'Advert class' },
  { selector: '[class*="adv-"]', category: 'banner', description: 'Adv class' },
  { selector: '[class*="adv_"]', category: 'banner', description: 'Adv underscore class' },
  { selector: '[class*="advt"]', category: 'banner', description: 'Advt class' },
  { selector: '[class*="ad-block"]', category: 'banner', description: 'Ad block class' },
  { selector: '[class*="adBlock"]', category: 'banner', description: 'AdBlock class' },
  { selector: '[class*="adSpace"]', category: 'banner', description: 'Ad Space class' },
  { selector: '[class*="adSpace"]', category: 'banner', description: 'Ad Space camelCase' },
  { selector: '[class*="adSlot"]', category: 'banner', description: 'Ad Slot class' },
  { selector: '[class*="ad-slot"]', category: 'banner', description: 'Ad Slot dash class' },
  { selector: '[class*="ad-unit"]', category: 'banner', description: 'Ad Unit class' },
  { selector: '[class*="adUnit"]', category: 'banner', description: 'AdUnit camelCase' },
  { selector: '[class*="advertisement"]', category: 'banner', description: 'Advertisement class' },
  { selector: '[class*="adwrapper"]', category: 'banner', description: 'Ad Wrapper class' },
  { selector: '[class*="ad-wrapper"]', category: 'banner', description: 'Ad Wrapper dash class' },
  { selector: '[class*="ads-wrapper"]', category: 'banner', description: 'Ads Wrapper class' },
  { selector: '[class*="ad-container"]', category: 'banner', description: 'Ad Container class' },
  { selector: '[class*="adContainer"]', category: 'banner', description: 'AdContainer camelCase' },
  { selector: '[class*="ads-container"]', category: 'banner', description: 'Ads Container class' },
  { selector: '[class*="ad-banner"]', category: 'banner', description: 'Ad Banner class' },
  { selector: '[class*="adBanner"]', category: 'banner', description: 'AdBanner camelCase' },
  { selector: '[class*="ad-leaderboard"]', category: 'banner', description: 'Ad Leaderboard' },
  { selector: '[class*="ad-sticky"]', category: 'banner', description: 'Ad Sticky' },
  { selector: '[class*="ad-overlay"]', category: 'banner', description: 'Ad Overlay' },

  // ── Banner class patterns ──
  { selector: '[class*="banner"]', category: 'banner', description: 'Banner class' },
  { selector: '[class*="sponsor"]', category: 'sponsored', description: 'Sponsor class' },
  { selector: '[class*="sponsored"]', category: 'sponsored', description: 'Sponsored class' },

  // ── Data attributes for ad containers ──
  { selector: 'div[data-ad]', category: 'banner', description: 'Data-ad attribute' },
  { selector: 'div[data-ad-slot]', category: 'banner', description: 'Data-ad-slot' },
  { selector: 'div[data-ad-unit]', category: 'banner', description: 'Data-ad-unit' },
  { selector: 'div[data-adunit]', category: 'banner', description: 'Data-adunit' },
  { selector: 'div[data-dfp-id]', category: 'banner', description: 'DFP Ad Unit' },
  { selector: 'div[data-dfpp-id]', category: 'banner', description: 'DFP Placement' },
  { selector: 'div[data-tesla]', category: 'banner', description: 'Tesla Ad' },

  // ── Ad iframes ──
  { selector: 'iframe[src*="doubleclick"]', category: 'banner', description: 'DoubleClick iframe' },
  { selector: 'iframe[src*="ads"]', category: 'banner', description: 'Ads iframe' },
  { selector: 'iframe[src*="adservice"]', category: 'banner', description: 'AdService iframe' },
  { selector: 'iframe[src*="adnxs"]', category: 'banner', description: 'AppNexus iframe' },
  { selector: 'iframe[src*="taboola"]', category: 'native', description: 'Taboola iframe' },
  { selector: 'iframe[src*="outbrain"]', category: 'native', description: 'Outbrain iframe' },
  { selector: 'iframe[src*="criteo"]', category: 'banner', description: 'Criteo iframe' },
  { selector: 'iframe[src*="amazon-adsystem"]', category: 'banner', description: 'Amazon iframe' },
  { selector: 'iframe[src*="pubmatic"]', category: 'banner', description: 'PubMatic iframe' },
  { selector: 'iframe[src*="openx"]', category: 'banner', description: 'OpenX iframe' },
  { selector: 'iframe[src*="rubiconproject"]', category: 'banner', description: 'Rubicon iframe' },
  { selector: 'iframe[src*="sharethrough"]', category: 'native', description: 'ShareThrough iframe' },
  { selector: 'iframe[src*="media.net"]', category: 'banner', description: 'Media.net iframe' },
  { selector: 'iframe[src*="smartadserver"]', category: 'banner', description: 'Smart AdServer iframe' },
  { selector: 'iframe[src*="casalemedia"]', category: 'banner', description: 'Casale iframe' },
  { selector: 'iframe[src*="indexww"]', category: 'banner', description: 'Index Exchange iframe' },
  { selector: 'iframe[src*="adroll"]', category: 'banner', description: 'AdRoll iframe' },
  { selector: 'iframe[src*="adzerk"]', category: 'banner', description: 'Adzerk iframe' },
  { selector: 'iframe[src*="pagead"]', category: 'banner', description: 'PageAd iframe' },
  { selector: 'iframe[src*="adserver"]', category: 'banner', description: 'AdServer iframe' },
  { selector: 'iframe[id*="google_ads"]', category: 'banner', description: 'Google Ads Iframe ID' },

  // ── Ad images / pixels ──
  { selector: 'img[src*="doubleclick"]', category: 'banner', description: 'DoubleClick pixel' },
  { selector: 'img[src*="ad."]', category: 'banner', description: 'Ad domain pixel' },
  { selector: 'img[src*="ads."]', category: 'banner', description: 'Ads domain pixel' },
  { selector: 'img[src*="pixel"]', category: 'tracking-ad', description: 'Tracking pixel' },
  { selector: 'img[src*="track"]', category: 'tracking-ad', description: 'Tracking image' },
  { selector: 'img[width="1"][height="1"]', category: 'tracking-ad', description: '1x1 pixel tracker' },
  { selector: 'img[width="0"][height="0"]', category: 'tracking-ad', description: '0x0 pixel tracker' },
  { selector: 'img[src*="facebook.com/tr"]', category: 'tracking-ad', description: 'Facebook Pixel' },
  { selector: 'img[src*="analytics"]', category: 'tracking-ad', description: 'Analytics Pixel' },

  // ── Video ad overlays ──
  { selector: '.video-ad-overlay', category: 'video', description: 'Video Ad Overlay' },
  { selector: '.video-ad', category: 'video', description: 'Video Ad container' },
  { selector: '[class*="vast"]', category: 'video', description: 'VAST ad container' },
  { selector: '[id*="vast"]', category: 'video', description: 'VAST ad element' },
  { selector: '.preroll', category: 'video', description: 'Preroll ad' },
  { selector: '.midroll', category: 'video', description: 'Midroll ad' },
  { selector: '.postroll', category: 'video', description: 'Postroll ad' },
  { selector: '[class*="ima-ad"]', category: 'video', description: 'IMA Ad container' },

  // ── Native ad containers ──
  { selector: '[class*="native-ad"]', category: 'native', description: 'Native ad class' },
  { selector: '[class*="nativeAd"]', category: 'native', description: 'NativeAd camelCase' },
  { selector: '[class*="sponsored-content"]', category: 'sponsored', description: 'Sponsored content' },
  { selector: '[class*="promoted"]', category: 'sponsored', description: 'Promoted content' },
  { selector: '[data-native-ad]', category: 'native', description: 'Native ad data attr' },

  // ── Popup / overlay containers ──
  { selector: '[class*="popup-ad"]', category: 'popup', description: 'Popup ad class' },
  { selector: '[class*="modal-ad"]', category: 'popup', description: 'Modal ad class' },
  { selector: '[class*="interstitial"]', category: 'popup', description: 'Interstitial ad' },
  { selector: '[id*="interstitial"]', category: 'popup', description: 'Interstitial ad ID' },
  { selector: '[class*="overlay-ad"]', category: 'popup', description: 'Overlay ad class' },
  { selector: '[class*="lightbox-ad"]', category: 'popup', description: 'Lightbox ad' },
  { selector: '[class*="fullpage-ad"]', category: 'popup', description: 'Fullpage ad' },

  // ── Social widget blocking ──
  { selector: '[class*="social-embed"]', category: 'tracking-ad', description: 'Social embed' },
  { selector: '.fb-like', category: 'tracking-ad', description: 'Facebook Like button' },
  { selector: '[class*="fb-like"]', category: 'tracking-ad', description: 'Facebook Like class' },
  { selector: '#fb-root', category: 'tracking-ad', description: 'Facebook Root' },
  { selector: '.twitter-tweet', category: 'tracking-ad', description: 'Twitter Embed' },
  { selector: '.tiktok-embed', category: 'tracking-ad', description: 'TikTok Embed' },
  { selector: '.reddit-embed', category: 'tracking-ad', description: 'Reddit Embed' },

  // ── Newsletter / popup annoyance ──
  { selector: '[class*="newsletter-popup"]', category: 'newsletter', description: 'Newsletter Popup' },
  { selector: '[class*="email-signup"]', category: 'newsletter', description: 'Email Signup' },
  { selector: '[class*="optin"]', category: 'newsletter', description: 'Opt-in Form' },
  { selector: '[id*="optin"]', category: 'newsletter', description: 'Opt-in Element' },
  { selector: '[class*="modal-overlay"]', category: 'annoyance', description: 'Modal Overlay' },
  { selector: '[class*="cookie-banner"]', category: 'annoyance', description: 'Cookie Banner' },
  { selector: '[class*="cookie-notice"]', category: 'annoyance', description: 'Cookie Notice' },
  { selector: '[id*="cookie"]', category: 'annoyance', description: 'Cookie Notice ID' },
  { selector: '[class*="consent"]', category: 'annoyance', description: 'Consent Dialog' },
  { selector: '[id*="consent"]', category: 'annoyance', description: 'Consent Dialog ID' },

  // ── More specific ad networks ──
  { selector: '[id*="taboola"]', category: 'native', description: 'Taboola container' },
  { selector: '[class*="taboola"]', category: 'native', description: 'Taboola class' },
  { selector: '[id*="outbrain"]', category: 'native', description: 'Outbrain container' },
  { selector: '[class*="outbrain"]', category: 'native', description: 'Outbrain class' },
  { selector: '[id*="taboola"]', category: 'native', description: 'Taboola ID' },
  { selector: '[class*="revcontent"]', category: 'native', description: 'RevContent' },
  { selector: '[id*="mgid"]', category: 'native', description: 'MGID container' },
  { selector: '[class*="mgid"]', category: 'native', description: 'MGID class' },

  // ── Crypto miner blocking ──
  { selector: 'script[src*="coinhive"]', category: 'crypto-miner', description: 'CoinHive Script' },
  { selector: 'script[src*="coin-hive"]', category: 'crypto-miner', description: 'CoinHive Script' },
  { selector: 'script[src*="cryptoloot"]', category: 'crypto-miner', description: 'CryptoLoot Script' },
  { selector: 'script[src*="crypto-loot"]', category: 'crypto-miner', description: 'CryptoLoot' },
  { selector: 'script[src*="minero"]', category: 'crypto-miner', description: 'Minero Script' },
  { selector: 'script[src*="webmine"]', category: 'crypto-miner', description: 'WebMine Script' },
  { selector: 'script[src*="jsecoin"]', category: 'crypto-miner', description: 'JSEcoin Script' },

  // ── Anti-adblock element hiding ──
  { selector: '[id*="ad-blocker"]', category: 'anti-adblock', description: 'Adblocker detection' },
  { selector: '[class*="ad-blocker"]', category: 'anti-adblock', description: 'Adblocker detection' },
  { selector: '[class*="adb-detect"]', category: 'anti-adblock', description: 'Adb Detect' },
  { selector: '[id*="adb-detect"]', category: 'anti-adblock', description: 'Adb Detect ID' },
  { selector: '[class*="adblock-detect"]', category: 'anti-adblock', description: 'Adblock Detect' },
  { selector: '.ab-dialog', category: 'anti-adblock', description: 'Adblock Dialog' },
  { selector: '[class*="ab-modal"]', category: 'anti-adblock', description: 'Adblock Modal' },

  // ── Survey / poll overlays ──
  { selector: '[class*="survey-popup"]', category: 'survey', description: 'Survey Popup' },
  { selector: '[class*="poll-popup"]', category: 'survey', description: 'Poll Popup' },
  { selector: '[class*="feedback-widget"]', category: 'survey', description: 'Feedback Widget' },

  // ── Paywall / subscription prompts ──
  { selector: '[class*="paywall"]', category: 'paywall', description: 'Paywall Container' },
  { selector: '[class*="subscription-wall"]', category: 'paywall', description: 'Subscription Wall' },
  { selector: '[class*="premium-wall"]', category: 'paywall', description: 'Premium Wall' },

  // ── Generic suspicious ad patterns ──
  { selector: 'a[href*="click.linksynergy.com"]', category: 'tracking-ad', description: 'Affiliate tracking link' },
  { selector: 'a[href*="go2cloud.org"]', category: 'tracking-ad', description: 'Go2Cloud redirect' },
  { selector: 'a[href*="amazon.com/gp/redirect"]', category: 'tracking-ad', description: 'Amazon redirect' },
  { selector: 'a[href*="amzn.to"]', category: 'self-promotion', description: 'Amazon short link' },
];

// ─── Cosmetic rules (domain-specific selectors) ──────────────────────────────

const COSMETIC_RULES: CosmeticRule[] = [
  { selector: '#player Daiad, .dai-ad, [id*="dai-ad"]', domain: 'youtube.com', category: 'video', description: 'YouTube DAI ad' },
  { selector: '.video-ads, .ytp-ad-overlay-container, .ytp-ad-text-overlay', domain: 'youtube.com', category: 'video', description: 'YouTube video ads' },
  { selector: '#masthead-ad, #ad-container, .ytd-promoted-sparkles-web-renderer', domain: 'youtube.com', category: 'banner', description: 'YouTube banner ads' },
  { selector: '.ytd-promoted-video-renderer, .ytd-ad-slot-renderer', domain: 'youtube.com', category: 'native', description: 'YouTube promoted' },
  { selector: '#related > .ytd-compact-video-renderer:has(.ytd-badge-supported-renderer:contains("Ad"))', domain: 'youtube.com', category: 'native', description: 'YouTube ad in related' },
  { selector: '#google_ads_frame, ins.adsbygoogle', domain: 'wikipedia.org', category: 'banner', description: 'Wikipedia Google Ads' },
  { selector: '[class*="dfp-ad"]', domain: 'nytimes.com', category: 'banner', description: 'NYT DFP Ads' },
  { selector: '[class*="ad-slot"]', domain: 'theguardian.com', category: 'banner', description: 'Guardian Ad Slots' },
  { selector: '.ad-unit, .ad-slot', domain: 'bbc.com', category: 'banner', description: 'BBC Ad Slots' },
  { selector: '#ad-top, .ad-container, [id*="banner-ad"]', domain: 'cnn.com', category: 'banner', description: 'CNN Ads' },
  { selector: '[class*="trc_"],.taboola-container', domain: 'yahoo.com', category: 'native', description: 'Yahoo Taboola' },
  { selector: '[class*="OUTBRAIN"],[class*="outbrain"]', domain: 'yahoo.com', category: 'native', description: 'Yahoo Outbrain' },
];

// ─── Redirect tracking rules ────────────────────────────────────────────────

const REDIRECT_RULES: RedirectRule[] = [
  { pattern: 'track.effiliation.com', redirectUrl: 'about:blank', description: 'Effiliation Tracker' },
  { pattern: 'go.skimresources.com', redirectUrl: 'about:blank', description: 'Skimlinks Tracker' },
  { pattern: 'dpbolvw.net', redirectUrl: 'about:blank', description: 'Commission Junction Redirect' },
  { pattern: 'linksynergy.com', redirectUrl: 'about:blank', description: 'LinkShare Redirect' },
  { pattern: 'anrdoezrs.net', redirectUrl: 'about:blank', description: 'Rakuten Redirect' },
  { pattern: 'kqzyfj.com', redirectUrl: 'about:blank', description: 'ShareASale Redirect' },
  { pattern: 'jdoqocy.com', redirectUrl: 'about:blank', description: 'CJ Redirect' },
];

// ─── Anti-adblock script patterns (JS patterns in page source) ──────────────

const ANTI_ADBLOCK_PATTERNS: readonly string[] = [
  'blockAdBlock',
  'blockAdBlocker',
  'ads-blocked',
  'adBlockDetected',
  'adBlockEnabled',
  'showAdBlockModal',
  'detectAdBlock',
  'isAdBlockActive',
  'adBlockDetection',
  'adBlockWarning',
  'disableAdBlocker',
  'antiAdBlock',
  'adblock-detect',
  'adBlockerDetect',
  'canRunAds',
  'canMakeAds',
  'AdBlockerMessage',
  'ad_blocker_detected',
  'adsbygoogle',
  'google_ad_client',
  'googleAdBlock',
  'displayAds',
  'showGoogleAds',
  'adblockModal',
  'blockedbyAdBlock',
  'allowAdBlocker',
  'noAdBlocker',
  'adsEnabled',
  'adblockerEnabled',
  'adsAreBlocked',
  'yourAdBlocker',
  'whitelisted',
  'AdBlocker Detected',
  'Please disable your ad blocker',
  'Please turn off your ad blocker',
  'We noticed you are using an ad blocker',
  'Ad blocker detected',
  'ad blocker may interfere',
  'disable your ad blocker',
  'allow ads on this site',
  'whitelist this site',
  'subscribe to continue',
  'You have ads blocker enabled',
  'support us by disabling',
  'turn off adblock',
  'adblocker off',
  'adguard detected',
  'adguardDetected',
  'ublock detected',
  'ublock === undefined',
  'pagefair.com',
  'pagefair.net',
  'sourcepoint.com',
  'Request access to content',
  'premium content',
  'subscribe to read',
  'sign in to continue reading',
  'members-only content',
  'You have reached your article limit',
  'You\'ve read all your free articles',
  'You have reached the free article limit',
  'You\'ve reached the limit',
  'No more free articles',
  'This article is for subscribers',
  'Become a subscriber',
  'To continue reading',
];

const ALL_AD_CATEGORIES: readonly AdCategory[] = [
  'banner', 'video', 'popup', 'native', 'malvertising', 'tracking-ad', 'sponsored',
  'anti-adblock', 'crypto-miner', 'fingerprinting', 'redirect', 'malware',
  'annoyance', 'newsletter', 'survey', 'self-promotion', 'paywall',
];

interface IAdBlocker extends IDisposable {
  readonly enabled: boolean;
  readonly totalBlocked: number;
  readonly blockedAds: readonly BlockedAd[];
  readonly enabledCategories: ReadonlySet<AdCategory>;
  setEnabled(enabled: boolean): void;
  setCategoryEnabled(category: AdCategory, enabled: boolean): void;
  shouldBlock(url: string, resourceKind?: string): { blocked: boolean; match?: AdBlockMatch };
  shouldBlockPopup(openerUrl: string, popupUrl: string): boolean;
  shouldRedirect(url: string): string | null;
  detectAntiAdblock(pageSource: string): { detected: boolean; patterns: string[] };
  shouldHideElement(selector: string, pageDomain?: string): boolean;
  getCosmeticRules(pageDomain?: string): CosmeticRule[];
  getElementSelectors(): readonly AdElementSelector[];
  recordBlocked(match: AdBlockMatch, resourceKind: string): void;
  getBlockedByCategory(): Record<AdCategory, number>;
  getBlockStats(): { total: number; byCategory: Record<AdCategory, number>; recentBlocks: BlockedAd[] };
  clearStats(): void;
  addCustomRule(rule: AdFilterRule): void;
  removeCustomRule(pattern: string): void;
  on(type: AdBlockerEventType, handler: AdBlockerEventHandler): void;
  off(type: AdBlockerEventType, handler: AdBlockerEventHandler): void;
}

function extractAdHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function extractAdPath(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function extractAdQueryString(url: string): string {
  try {
    return new URL(url).search.toLowerCase();
  } catch {
    return '';
  }
}

function matchesAdDomain(hostname: string, rulePattern: string): boolean {
  const h = hostname.toLowerCase();
  const p = rulePattern.toLowerCase();
  if (h === p) return true;
  if (h.endsWith('.' + p)) return true;
  if (p.startsWith('/') && urlPathMatches(h, p)) return true;
  return false;
}

function urlPathMatches(_hostname: string, _pattern: string): boolean {
  return false;
}

function matchesAdPattern(url: string, pattern: string): boolean {
  const hostname = extractAdHostname(url);
  const path = extractAdPath(url);
  const query = extractAdQueryString(url);
  const lower = url.toLowerCase();
  const p = pattern.toLowerCase();

  // Path-based rules (starting with /)
  if (p.startsWith('/')) {
    if (path.includes(p)) return true;
    if (lower.includes(p)) return true;
    return false;
  }

  // Domain-based matching (exact + subdomain boundary)
  if (matchesAdDomain(hostname, p)) return true;

  // For patterns that contain a path segment (e.g. "doubleclick.net/pfad/"),
  // also match the full URL
  if (p.includes('/') && lower.includes(p)) return true;

  // Query string matching (for tracking parameters)
  if (query.includes(p)) return true;

  return false;
}

function matchesDomainBoundary(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase();
  if (h === d) return true;
  if (h.endsWith('.' + d)) return true;
  // Handle wildcard domains (*.example.com)
  if (d.startsWith('*.')) {
    const stripped = d.slice(2);
    if (h === stripped || h.endsWith('.' + stripped)) return true;
  }
  return false;
}

function validateCustomAdRule(rule: AdFilterRule): boolean {
  if (!rule.pattern || rule.pattern.length === 0) return false;
  if (rule.pattern.length > 512) return false;
  if (/[<>"'`]/.test(rule.pattern)) return false;
  // Prevent overly broad rules that could break legitimate sites
  if (rule.pattern.length < 3) return false;
  return true;
}

class AdBlocker implements IAdBlocker {
  private _enabled = true;
  private _blockedAds: BlockedAd[] = [];
  private readonly customRules: AdFilterRule[] = [];
  private readonly _enabledCategories = new Set<AdCategory>(ALL_AD_CATEGORIES);
  private readonly eventHandlers = new Map<AdBlockerEventType, Set<AdBlockerEventHandler>>();

  get enabled(): boolean { return this._enabled; }
  get totalBlocked(): number { return this._blockedAds.length; }
  get blockedAds(): readonly BlockedAd[] { return [...this._blockedAds]; }
  get enabledCategories(): ReadonlySet<AdCategory> { return new Set(this._enabledCategories); }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.emit({ kind: 'adBlockerToggled', enabled });
  }

  setCategoryEnabled(category: AdCategory, enabled: boolean): void {
    if (enabled) {
      this._enabledCategories.add(category);
    } else {
      this._enabledCategories.delete(category);
    }
    this.emit({ kind: 'categoryToggled', category, enabled });
  }

  shouldBlock(url: string, resourceKind?: string): { blocked: boolean; match?: AdBlockMatch } {
    if (!this._enabled) return { blocked: false };

    const allRules = [...AD_FILTER_RULES, ...this.customRules];

    for (const rule of allRules) {
      // Skip rules for disabled categories
      if (!this._enabledCategories.has(rule.category)) continue;

      if (matchesAdPattern(url, rule.pattern)) {
        // Validate not a first-party request to the page's own domain
        if (resourceKind === 'script' && this.isFirstPartyToPage(url)) {
          continue;
        }

        const match: AdBlockMatch = { rule, matchedPattern: rule.pattern, url };
        return { blocked: true, match };
      }
    }

    // Check for crypto mining script patterns
    if (this.isCryptoMiningUrl(url)) {
      const rule: AdFilterRule = { pattern: url, category: 'crypto-miner', description: 'Detected crypto miner' };
      return { blocked: true, match: { rule, matchedPattern: 'crypto-miner-detection', url } };
    }

    // Check for suspicious third-party tracking
    if (resourceKind === 'script' && this.isSuspiciousThirdPartyScript(url)) {
      const rule: AdFilterRule = { pattern: url, category: 'tracking-ad', description: 'Suspicious third-party tracker' };
      return { blocked: true, match: { rule, matchedPattern: 'third-party-tracker-detection', url } };
    }

    return { blocked: false };
  }

  shouldBlockPopup(openerUrl: string, popupUrl: string): boolean {
    if (!this._enabled) return false;
    if (!popupUrl || popupUrl.length < 5) return false;

    const popupHost = extractAdHostname(popupUrl);

    // Block known popup ad domains
    const popupAdRules = AD_FILTER_RULES.filter(r => r.category === 'popup');
    for (const rule of popupAdRules) {
      if (matchesAdDomain(popupHost, rule.pattern)) {
        return true;
      }
    }

    // Block if popup URL contains ad-related path patterns
    const popupPath = extractAdPath(popupUrl);
    const adPathPatterns = ['/ad/', '/ads/', '/popup/', '/popunder/', '/click/', '/redirect/'];
    for (const p of adPathPatterns) {
      if (popupPath.includes(p)) return true;
    }

    // Block if popup URL has suspicious tracking parameters
    const query = extractAdQueryString(popupUrl);
    const trackingParams = ['utm_source=ad', 'utm_medium=cpc', 'click_id=', 'aff_id=', 'subid=', 'clickid='];
    for (const p of trackingParams) {
      if (query.includes(p)) return true;
    }

    return false;
  }

  shouldRedirect(url: string): string | null {
    if (!this._enabled) return null;

    const hostname = extractAdHostname(url);
    for (const rule of REDIRECT_RULES) {
      if (matchesAdDomain(hostname, rule.pattern)) {
        return rule.redirectUrl;
      }
    }
    return null;
  }

  detectAntiAdblock(pageSource: string): { detected: boolean; patterns: string[] } {
    const lower = pageSource.toLowerCase();
    const detected: string[] = [];

    for (const pattern of ANTI_ADBLOCK_PATTERNS) {
      if (lower.includes(pattern.toLowerCase())) {
        detected.push(pattern);
      }
    }

    if (detected.length > 0) {
      this.emit({
        kind: 'antiAdblockDetected',
        url: '',
        scriptPattern: detected[0] ?? 'unknown',
      });
    }

    return { detected: detected.length > 0, patterns: detected };
  }

  shouldHideElement(selector: string, pageDomain?: string): boolean {
    // Check if any AD_ELEMENT_SELECTORS match
    for (const rule of AD_ELEMENT_SELECTORS) {
      if (!this._enabledCategories.has(rule.category)) continue;
      if (rule.selector === selector || selector.includes(rule.selector)) return true;
    }

    // Check domain-specific cosmetic rules
    if (pageDomain) {
      for (const rule of COSMETIC_RULES) {
        if (matchesDomainBoundary(pageDomain, rule.domain ?? '')) {
          if (selector.includes(rule.selector) || rule.selector.includes(selector)) return true;
        }
      }
    }

    return false;
  }

  getCosmeticRules(pageDomain?: string): CosmeticRule[] {
    if (!pageDomain) return [...COSMETIC_RULES];
    return COSMETIC_RULES.filter(r => {
      if (!r.domain) return true;
      return matchesDomainBoundary(pageDomain, r.domain);
    });
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

    // Keep last 10000 entries to prevent memory leak
    if (this._blockedAds.length > 10_000) {
      this._blockedAds = this._blockedAds.slice(-5000);
    }

    this.emit({ kind: 'adBlocked', blocked, totalBlocked: this._blockedAds.length });
  }

  getBlockedByCategory(): Record<AdCategory, number> {
    const counts = {} as Record<AdCategory, number>;
    for (const cat of ALL_AD_CATEGORIES) counts[cat] = 0;
    for (const ad of this._blockedAds) counts[ad.category]++;
    return counts;
  }

  getBlockStats(): { total: number; byCategory: Record<AdCategory, number>; recentBlocks: BlockedAd[] } {
    return {
      total: this.totalBlocked,
      byCategory: this.getBlockedByCategory(),
      recentBlocks: this._blockedAds.slice(-50),
    };
  }

  clearStats(): void {
    this._blockedAds = [];
  }

  addCustomRule(rule: AdFilterRule): void {
    if (!validateCustomAdRule(rule)) return;
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

  private isFirstPartyToPage(url: string): boolean {
    try {
      const host = extractAdHostname(url);
      // Check if this is a first-party resource (same base domain)
      // This is a heuristic — in real use you'd pass the page domain
      if (host.includes('google.') && !host.includes('adservice') && !host.includes('pagead')) return true;
      return false;
    } catch {
      return false;
    }
  }

  private isCryptoMiningUrl(url: string): boolean {
    const lower = url.toLowerCase();
    const minerPatterns = [
      'coinhive', 'coin-hive', 'cryptoloot', 'crypto-loot',
      'minero.cc', 'authedmine', 'jsecoin', 'ppoi.org',
      'minr.pw', 'webmine', 'miner.ninja', 'browsermine',
      'monerominer', 'gridcash', 'cryptonight',
    ];
    return minerPatterns.some(p => lower.includes(p));
  }

  private isSuspiciousThirdPartyScript(url: string): boolean {
    const host = extractAdHostname(url);
    // Block known tracking scripts
    const trackerDomains = [
      'hotjar.com', 'sentry.io', 'newrelic.com', 'nr-data.net',
      'chartbeat.com', 'segment.io', 'segment.com', 'mixpanel.com',
      'amplitude.com', 'branch.io', 'adjust.com', 'appsflyer.com',
      'fullstory.com', 'luckyorange.com', 'mouseflow.com',
      'inspectlet.com', 'crazyegg.com', 'clicktale.com',
      'heap.io', 'pendo.io', 'gainsight.com',
    ];
    return trackerDomains.some(d => matchesDomainBoundary(host, d));
  }

  dispose(): void {
    this._blockedAds = [];
    this.customRules.length = 0;
    this._enabledCategories.clear();
    this.eventHandlers.clear();
  }
}

export {
  AdBlocker,
  AD_FILTER_RULES,
  AD_ELEMENT_SELECTORS,
  COSMETIC_RULES,
  REDIRECT_RULES,
  ANTI_ADBLOCK_PATTERNS,
  ALL_AD_CATEGORIES,
};
export type {
  IAdBlocker,
  AdCategory,
  AdFilterRule,
  AdBlockMatch,
  BlockedAd,
  AdElementSelector,
  CosmeticRule,
  RedirectRule,
  AdBlockerEvent,
  AdBlockerEventType,
};
