package com.nova.browser

import java.net.URI

/**
 * Ad and tracker blocking for compatibility mode. Those pages are shown by the system WebView, which
 * Nova's engine blockers (src/browser/security/ad-blocker.ts, tracker-blocker.ts) never see, so
 * Reddit and YouTube showed their ads. Requests to ad networks and trackers are answered empty
 * ([classify]), and [HIDING_CSS] hides the ad slots sites serve from their own servers.
 */
object AdHosts {

    /** What a blocked request was, for the per-tab counts. */
    enum class Kind { AD, TRACKER }

    // ponytail: short lists of the big ad networks and trackers, not full filter lists
    // (EasyList / EasyPrivacy); grow them as sites need.
    private val AD_HOSTS: Set<String> = setOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "googletagservices.com", "pagead2.googlesyndication.com", "imasdk.googleapis.com",
        "amazon-adsystem.com", "adnxs.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
        "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com", "indexww.com",
        "smartadserver.com", "adsrvr.org", "media.net", "sharethrough.com", "33across.com", "yieldmo.com",
        "teads.tv", "adform.net", "ads-twitter.com", "ads.linkedin.com", "advertising.com", "adroll.com", "zedo.com",
        "ads.reddit.com", "alb.reddit.com", "redditstatic.com/ads",
        "googletagmanager.com/gtag/js?id=AW-", "2mdn.net", "adcolony.com", "applovin.com", "unityads.unity3d.com",
        "inmobi.com", "mopub.com", "vungle.com", "chartboost.com", "ironsrc.com", "bidswitch.net", "contextweb.com",
        "lijit.com", "sovrn.com", "gumgum.com", "triplelift.com", "spotxchange.com", "springserve.com", "adskeeper.co.uk",
        "mgid.com", "revcontent.com", "propellerads.com", "popads.net", "popcash.net", "exoclick.com", "adsterra.com",
        "hilltopads.net", "trafficjunky.net", "juicyads.com", "yandex.ru/ads", "an.yandex.ru", "ads.yahoo.com",
        "gemini.yahoo.com", "ads.pubmatic.com", "c.amazon-adsystem.com", "aax.amazon-adsystem.com", "ads.tiktok.com",
        // Ad endpoints on the sites themselves (YouTube's ad requests, search ad clicks).
        "youtube.com/pagead", "youtube.com/api/stats/ads", "youtube.com/get_midroll_info",
        "google.com/aclk", "bing.com/aclk", "duckduckgo.com/y.js",
    )

    /** Analytics, session recording, social pixels, measurement and fingerprinting services. */
    private val TRACKER_HOSTS: Set<String> = setOf(
        "google-analytics.com", "analytics.google.com", "cloudflareinsights.com", "googletagmanager.com", "stats.g.doubleclick.net",
        "scorecardresearch.com", "quantserve.com", "moatads.com", "doubleverify.com", "adsafeprotected.com",
        "chartbeat.com", "chartbeat.net", "parsely.com", "comscore.com", "omtrdc.net", "demdex.net", "krxd.net",
        "bluekai.com", "hotjar.com", "hotjar.io", "clarity.ms", "fullstory.com", "mouseflow.com", "crazyegg.com",
        "segment.io", "cdn.segment.com", "api.segment.io", "mixpanel.com", "amplitude.com", "heap.io", "heapanalytics.com",
        "nr-data.net", "newrelic.com/nr-", "bat.bing.com", "connect.facebook.net", "facebook.com/tr?", "facebook.com/tr/",
        "analytics.tiktok.com", "analytics.twitter.com", "static.ads-twitter.com", "px.ads.linkedin.com", "snap.licdn.com",
        "appsflyer.com", "adjust.com", "kochava.com", "branch.io/v1/", "mc.yandex.ru", "yandex.ru/metrika",
        "youtube.com/ptracking", "youtube.com/api/stats/atr", "reddit.com/static/pixel", "events.redditmedia.com",
        "pixel.reddit.com",
    )

    private fun matchesAny(list: Set<String>, host: String, hostAndPath: String): Boolean = list.any { site ->
        if (site.contains('/')) hostAndPath.startsWith(site) || hostAndPath.contains(".$site")
        else host == site || host.endsWith(".$site")
    }

    /** Whether [url] goes to an ad network or ad endpoint, a tracker, or neither (null). */
    fun classify(url: String): Kind? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val hostAndPath = host + (uri.rawPath ?: "") + (uri.rawQuery?.let { "?$it" } ?: "")
        return when {
            matchesAny(AD_HOSTS, host, hostAndPath) -> Kind.AD
            matchesAny(TRACKER_HOSTS, host, hostAndPath) -> Kind.TRACKER
            else -> null
        }
    }

    /** True when [url] goes to an ad network or ad endpoint. */
    fun isAd(url: String): Boolean = classify(url) == Kind.AD

    /** Ad slots served by the sites themselves (Reddit's promoted posts, YouTube's ad renderers). */
    const val HIDING_CSS: String =
        "shreddit-ad-post,shreddit-dynamic-ad-link,shreddit-comments-page-ad,shreddit-sidebar-ad," +
        "[data-testid=\"promoted-post\"],.promotedlink," +
        "ytm-promoted-sparkles-web-renderer,ytm-promoted-video-renderer,ytm-companion-ad-renderer," +
        "ad-slot-renderer,ytm-ad-slot-renderer,.ytp-ad-overlay-container," +
        "ins.adsbygoogle,[data-ad-client],[id^=\"google_ads_iframe\"],amp-ad," +
        // Sponsored search results (Google, Bing, DuckDuckGo) and YouTube's feed/player ad slots.
        "#tads,#tadsb,#bottomads,div[data-text-ad],.uEierd,div[aria-label=\"Ads\"],.commercial-unit-mobile-top," +
        "li.b_ad,.b_adTop,.b_adBottom,.result--ad,[data-testid=\"ad\"],li[data-layout=\"ad\"]," +
        "ytd-ad-slot-renderer,ytd-in-feed-ad-layout-renderer,ytd-promoted-sparkles-web-renderer,ytm-promoted-sparkles-text-search-renderer," +
        ".ytp-ad-module .ytp-ad-image-overlay,ytd-banner-promo-renderer,ytm-companion-slot" +
        "{display:none !important}"

    /** Script that adds [HIDING_CSS] to the page once (it stays across in-page navigation). */
    val HIDING_SCRIPT: String by lazy {
        "(function(){" +
        "if(!document.getElementById('nova-ad-hiding')){var s=document.createElement('style');s.id='nova-ad-hiding';" +
        "s.textContent=${org.json.JSONObject.quote(HIDING_CSS)};(document.head||document.documentElement).appendChild(s);}" +
        // How many ad slots the style hides on this page (logged by CompatWebView as evidence).
        "try{var n=document.querySelectorAll(${org.json.JSONObject.quote(HIDING_CSS.substringBefore('{'))}).length;" +
        "if(n)console.log('[nova-ad] hid '+n+' ad slot(s) on '+location.hostname);}catch(e){}" +
        // YouTube video ads: while the player shows one, mute it, press Skip and jump it to its end
        // (or play it at 16x when its length isn't known yet).
        "if(location.hostname.indexOf('youtube.com')>=0&&!window.__novaAdSkip){window.__novaAdSkip=setInterval(function(){" +
        // Any of the player's ad markers means an ad is playing (m.youtube.com doesn't always use .ad-showing).
        "var ad=document.querySelector('.ad-showing,.ad-interrupting,.ytp-ad-player-overlay,.ytp-ad-player-overlay-layout," +
        ".ytp-ad-text,.ytp-ad-preview-container,.ytp-ad-skip-button-container,.ytp-skip-ad,.ytm-ad-overlay');" +
        // Only a marker that is on screen counts, so a leftover hidden one never skips the real video.
        "if(!ad||!ad.getClientRects().length){window.__novaAdSeen=false;return;}" +
        "var b=document.querySelector('.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-skip-ad-button,.ytp-ad-skip-button-container button');" +
        "if(b)b.click();" +
        "var v=(ad.closest&&ad.closest('.html5-video-player')||document).querySelector('video');" +
        "if(v){v.muted=true;if(isFinite(v.duration)&&v.duration>0)v.currentTime=v.duration;else v.playbackRate=16;}" +
        "if(!window.__novaAdSeen){window.__novaAdSeen=true;console.log('[nova-ad] removed a video ad ('+(v&&isFinite(v.duration)?Math.round(v.duration)+' s':'length unknown')+(b?', pressed Skip':'')+')');}" +
        "},250);}" +
        "})();"
    }
}
