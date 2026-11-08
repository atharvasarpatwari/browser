package com.nova.browser

import java.net.URI

/**
 * Ad blocking for compatibility mode. Those pages are shown by the system WebView, which Nova's
 * engine ad blocker (src/browser/security/ad-blocker.ts) never sees, so Reddit and YouTube showed
 * their ads. Requests to ad-network hosts are answered empty, and [HIDING_CSS] hides the ad
 * slots sites serve from their own servers.
 */
object AdHosts {

    // ponytail: a short list of the big ad networks, not a full filter list (EasyList); grow it as sites need.
    private val HOSTS: Set<String> = setOf(
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
        "googletagservices.com", "pagead2.googlesyndication.com", "imasdk.googleapis.com",
        "amazon-adsystem.com", "adnxs.com", "criteo.com", "criteo.net", "taboola.com", "outbrain.com",
        "pubmatic.com", "rubiconproject.com", "openx.net", "casalemedia.com", "indexww.com",
        "smartadserver.com", "adsrvr.org", "moatads.com", "scorecardresearch.com", "quantserve.com",
        "media.net", "sharethrough.com", "33across.com", "yieldmo.com", "teads.tv", "adform.net",
        "ads-twitter.com", "ads.linkedin.com", "advertising.com", "adroll.com", "zedo.com",
        "ads.reddit.com", "alb.reddit.com", "redditstatic.com/ads",
    )

    /** True when [url] goes to an ad network (the host or any subdomain of a listed one). */
    fun isAd(url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        val host = uri.host?.lowercase() ?: return false
        val hostAndPath = host + (uri.rawPath ?: "")
        return HOSTS.any { site ->
            if (site.contains('/')) hostAndPath.startsWith(site) || hostAndPath.contains(".$site")
            else host == site || host.endsWith(".$site")
        }
    }

    /** Ad slots served by the sites themselves (Reddit's promoted posts, YouTube's ad renderers). */
    const val HIDING_CSS: String =
        "shreddit-ad-post,shreddit-dynamic-ad-link,shreddit-comments-page-ad,shreddit-sidebar-ad," +
        "[data-testid=\"promoted-post\"],.promotedlink," +
        "ytm-promoted-sparkles-web-renderer,ytm-promoted-video-renderer,ytm-companion-ad-renderer," +
        "ad-slot-renderer,ytm-ad-slot-renderer,.ytp-ad-overlay-container," +
        "ins.adsbygoogle,[data-ad-client],[id^=\"google_ads_iframe\"],amp-ad" +
        "{display:none !important}"

    /** Script that adds [HIDING_CSS] to the page once (it stays across in-page navigation). */
    val HIDING_SCRIPT: String by lazy {
        "(function(){if(document.getElementById('nova-ad-hiding'))return;" +
        "var s=document.createElement('style');s.id='nova-ad-hiding';" +
        "s.textContent=${org.json.JSONObject.quote(HIDING_CSS)};" +
        "(document.head||document.documentElement).appendChild(s);})();"
    }
}
