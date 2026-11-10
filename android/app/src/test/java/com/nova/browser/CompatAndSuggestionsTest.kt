package com.nova.browser

import com.nova.browser.model.Bookmark
import com.nova.browser.model.HistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Typing www.gmail.com: the address resolves to https://www.gmail.com (it always did), and Gmail's
 * redirects lead to Google's sign-in, which Nova's engine can't run, so the site opens in
 * compatibility mode. Plus the address-bar suggestions.
 */
class CompatAndSuggestionsTest {
    private val google = SearchEngine.GOOGLE.template

    @Test
    fun typedGmailAddressesResolveToTheSiteNotASearch() {
        assertEquals("https://www.gmail.com", UrlInputResolver.resolve("www.gmail.com", google))
        assertEquals("https://gmail.com", UrlInputResolver.resolve("gmail.com", google))
        assertEquals("https://www.gmail.com", UrlInputResolver.resolve("  www.gmail.com  ", google))
        assertEquals("https://mail.google.com/mail/u/0/", UrlInputResolver.resolve("https://mail.google.com/mail/u/0/", google))
        assertEquals("https://www.google.com/search?q=gmail", UrlInputResolver.resolve("gmail", google)) // a word searches
    }

    @Test
    fun gmailAndItsRedirectChainOpenInCompatibilityMode() {
        for (url in listOf(
            "https://www.gmail.com", "https://gmail.com/", "https://mail.google.com/mail/u/0/",
            "https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/u/0/",
            "https://docs.google.com/document/d/x/edit", "https://drive.google.com/drive/my-drive",
        )) assertTrue(url, CompatSites.needsCompat(url))
    }

    @Test
    fun ordinarySitesStayInNovasEngine() {
        for (url in listOf("https://en.wikipedia.org/wiki/Web_browser", "https://example.com",
            "https://notgmail.com", "https://gmail.com.evil.test/", "about:blank", "nova://settings", "javascript:alert(1)")) {
            assertFalse(url, CompatSites.needsCompat(url))
        }
    }

    @Test
    fun scriptBuiltSitesOpenInCompatibilityModeUnlessSwitchedOff() {
        for (url in listOf("https://www.youtube.com/", "https://m.youtube.com/watch?v=x", "https://reddit.com", "https://www.reddit.com/r/android",
            "https://m.facebook.com/", "https://www.instagram.com/", "https://www.amazon.in/", "https://www.linkedin.com/feed", "https://x.com/home")) {
            assertTrue(url, CompatSites.needsCompat(url))
        }
        assertFalse(CompatSites.needsCompat("https://m.youtube.com/", userOff = setOf("m.youtube.com")))
        assertFalse(CompatSites.needsCompat("https://notreddit.com/"))
        assertFalse(CompatSites.needsCompat("https://box.com/"))  // not x.com
    }

    @Test
    fun compatibilityModeBlocksAdNetworksButNotTheSitesThemselves() {
        for (url in listOf("https://securepubads.g.doubleclick.net/tag/js/gpt.js", "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
            "https://c.amazon-adsystem.com/aax2/apstag.js", "https://alb.reddit.com/i.gif", "https://www.redditstatic.com/ads/pixel.js",
            "https://www.youtube.com/pagead/viewthroughconversion/1", "https://m.youtube.com/api/stats/ads?ver=2", "https://www.google.com/aclk?sa=l",
            "https://www.googletagmanager.com/gtag/js?id=AW-123")) {
            assertTrue(url, AdHosts.isAd(url))
        }
        for (url in listOf("https://www.reddit.com/", "https://www.redditstatic.com/shreddit/en-US/app.js", "https://m.youtube.com/",
            "https://accounts.google.com/v3/signin", "https://notdoubleclick.net/x", "https://m.youtube.com/watch?v=abc",
            "https://www.youtube.com/api/stats/watchtime?x=1", "https://www.googletagmanager.com/gtag/js?id=G-123", "https://m.facebook.com/trending", "https://static.xx.fbcdn.net/rsrc.php/translations.js", "https://www.google.com/search?q=doubleclick.net", "not a url")) {
            assertFalse(url, AdHosts.isAd(url))
        }
    }

    @Test
    fun googleSearchResultsOpenInCompatibilityModeButTheHomePageDoesNot() {
        assertTrue(CompatSites.needsCompat("https://www.google.com/search?q=buy%20running%20shoes"))
        assertTrue(CompatSites.needsCompat("https://www.google.co.in/search?q=x"))
        assertFalse(CompatSites.needsCompat("https://www.google.com/"))
        assertFalse(CompatSites.needsCompat("https://www.google.com/searchengines"))
        assertFalse(CompatSites.needsCompat("https://notgoogle.com/search?q=x"))
        assertFalse(CompatSites.needsCompat("https://www.google.com/search?q=x", userOff = setOf("google.com")))
    }

    @Test
    fun trackersAreToldApartFromAds() {
        for (url in listOf("https://www.google-analytics.com/g/collect?v=2", "https://www.googletagmanager.com/gtag/js?id=G-123",
            "https://www.facebook.com/tr?id=1&ev=PageView", "https://static.hotjar.com/c/hotjar.js", "https://sb.scorecardresearch.com/b",
            "https://m.youtube.com/ptracking?x=1", "https://bat.bing.com/action/0", "https://api.segment.io/v1/t",
            "https://static.cloudflareinsights.com/beacon.min.js")) {
            assertEquals(url, AdHosts.Kind.TRACKER, AdHosts.classify(url))
        }
        assertEquals(AdHosts.Kind.AD, AdHosts.classify("https://www.googletagmanager.com/gtag/js?id=AW-123"))
        assertEquals(AdHosts.Kind.AD, AdHosts.classify("https://googleads.g.doubleclick.net/pagead/id"))
        assertNull(AdHosts.classify("https://m.youtube.com/watch?v=abc"))
        assertNull(AdHosts.classify("https://www.reddit.com/"))
    }

    @Test
    fun adBlockTestHostsAreCovered() {
        // Every host the public test (adblock.turtlecute.org) tries, except its own site.
        val hosts = """
            ad.doubleclick.net adc3-launch.adcolony.com adfox.yandex.ru adfstat.yandex.ru adm.hotjar.com
            ads-api.tiktok.com ads-api.twitter.com ads-sg.tiktok.com ads.linkedin.com ads.pinterest.com
            ads.tiktok.com ads.yahoo.com ads.youtube.com ads30.adcolony.com adserver.unityads.unity3d.com
            adservice.google.com adsfs.oppomobile.com adtago.s3.amazonaws.com adtech.yahooinc.com advice-ads.s3.amazonaws.com
            adx.ads.oppomobile.com afs.googlesyndication.com an.facebook.com analytics-api.samsunghealthcn.com analytics-sg.tiktok.com
            analytics.google.com analytics.pointdrive.linkedin.com analytics.query.yahoo.com analytics.s3.amazonaws.com analytics.tiktok.com
            analytics.yahoo.com analyticsengine.s3.amazonaws.com api-adservices.apple.com api.ad.xiaomi.com api.bugsnag.com
            api.luckyorange.com api.mouseflow.com app.bugsnag.com app.getsentry.com appmetrica.yandex.ru
            auction.unityads.unity3d.com bdapi-ads.realmemobile.com bdapi-in-ads.realmemobile.com books-analytics-events.apple.com browser.sentry-cdn.com
            business-api.tiktok.com careers.hotjar.com cdn-test.mouseflow.com cdn.luckyorange.com cdn.mouseflow.com
            ck.ads.oppomobile.com claritybt.freshmarketer.com click.googleanalytics.com click.oneplus.cn config.unityads.unity3d.com
            cs.luckyorange.net data.ads.oppomobile.com data.mistat.india.xiaomi.com data.mistat.rus.xiaomi.com data.mistat.xiaomi.com
            events.reddit.com events.redditmedia.com events3alt.adcolony.com extmaps-api.yandex.net freshmarketer.com
            fwtracks.freshmarketer.com gemini.yahoo.com geo.yahoo.com google-analytics.com grs.hicloud.com
            gtm.mouseflow.com iadsdk.apple.com identify.hotjar.com insights.hotjar.com iot-eu-logser.realme.com
            iot-logser.realme.com log.byteoversea.com log.fc.yahoo.com log.pinterest.com logbak.hicloud.com
            logservice.hicloud.com logservice1.hicloud.com luckyorange.com m.doubleclick.net media.net
            mediavisor.doubleclick.net metrics.data.hicloud.com metrics.icloud.com metrics.mzstatic.com metrics2.data.hicloud.com
            metrika.yandex.ru mouseflow.com nmetrics.samsung.com notes-analytics-events.apple.com notify.bugsnag.com
            o2.mouseflow.com offerwall.yandex.net pagead2.googleadservices.com pagead2.googlesyndication.com partnerads.ysm.yahoo.com
            pixel.facebook.com realtime.luckyorange.com samsung-com.112.2o7.net samsungads.com script.hotjar.com
            sdkconfig.ad.intl.xiaomi.com sdkconfig.ad.xiaomi.com sessions.bugsnag.com settings.luckyorange.net smetrics.samsung.com
            ssl.google-analytics.com static.ads-twitter.com static.doubleclick.net static.media.net stats.g.doubleclick.net
            stats.wp.com surveys.hotjar.com tools.mouseflow.com tracking.rus.miui.com trk.pinterest.com
            udcm.yahoo.com upload.luckyorange.net w1.luckyorange.com wd.adcolony.com weather-analytics-events.apple.com
            webview.unityads.unity3d.com
        """.trim().split(Regex("\\s+"))
        val missed = hosts.filter { AdHosts.classify("https://$it/x") == null }
        assertEquals("not blocked: $missed", emptyList<String>(), missed)
        // Ordinary pages of the same companies stay reachable.
        for (url in listOf("https://www.yahoo.com/", "https://www.apple.com/", "https://www.samsung.com/", "https://yandex.ru/search",
            "https://www.pinterest.com/", "https://www.tiktok.com/", "https://s3.amazonaws.com/bucket/file", "https://www.xiaomi.com/")) {
            assertNull(url, AdHosts.classify(url))
        }
    }

    @Test
    fun userChoicesSwitchSitesInAndOut() {
        assertTrue(CompatSites.needsCompat("https://app.example.com/x", userOn = setOf("example.com")))
        assertFalse(CompatSites.needsCompat("https://mail.google.com/", userOff = setOf("mail.google.com")))
        assertTrue(CompatSites.needsCompat("https://accounts.google.com/", userOff = setOf("mail.google.com")))
    }

    @Test
    fun signInHopsStayInCompatibilityModeAndOtherLinksLeave() {
        assertTrue(CompatSites.staysInCompat("https://accounts.youtube.com/accounts/SetSID", isRedirect = false))
        assertTrue(CompatSites.staysInCompat("https://ogs.google.com/widget", isRedirect = false))
        assertTrue(CompatSites.staysInCompat("https://anything.test/", isRedirect = true))
        assertFalse(CompatSites.staysInCompat("https://en.wikipedia.org/wiki/Email", isRedirect = false))
    }

    @Test
    fun hostOfIgnoresWwwAndNonWebSchemes() {
        assertEquals("gmail.com", CompatSites.hostOf("https://WWW.Gmail.com/inbox"))
        assertEquals(null, CompatSites.hostOf("mailto:a@b.test"))
        assertEquals(null, CompatSites.hostOf("not a url"))
    }

    @Test
    fun firstSuggestionIsWhatGoDoes() {
        val go = AddressSuggestions.suggest("www.gmail.com", emptyList(), emptyList(), google)
        assertEquals(AddressSuggestion.Kind.GO, go.first().kind)
        assertEquals("https://www.gmail.com", go.first().url)
        val search = AddressSuggestions.suggest("best pizza", emptyList(), emptyList(), google)
        assertEquals(AddressSuggestion.Kind.SEARCH, search.first().kind)
        assertEquals("https://www.google.com/search?q=best%20pizza", search.first().url)
        assertTrue(AddressSuggestions.suggest("   ", emptyList(), emptyList(), google).isEmpty())
    }

    @Test
    fun sitesStartingWithTheTextRankFirstAndDuplicatesCollapse() {
        val history = listOf(
            HistoryEntry("1", "Inbox (3) - Gmail", "https://mail.google.com/mail/u/0/", 3),
            HistoryEntry("2", "Gmail tips", "https://blog.example.com/gmail-tips", 5),
            HistoryEntry("3", "GitHub", "https://github.com/", 9),
            HistoryEntry("4", "GitHub", "https://github.com/", 1),
        )
        val bookmarks = listOf(Bookmark("b", "Gmail", "https://www.gmail.com/"))
        val rows = AddressSuggestions.suggest("gi", history, bookmarks, google)
        assertEquals("https://github.com/", rows[1].url) // site starts with "gi"
        assertEquals(1, rows.count { it.url == "https://github.com/" })
        val gm = AddressSuggestions.suggest("gm", history, bookmarks, google)
        assertEquals(AddressSuggestion.Kind.BOOKMARK, gm[1].kind) // gmail.com starts with "gm"
        assertTrue(gm.any { it.url == "https://blog.example.com/gmail-tips" })
        assertTrue(gm.size <= 6)
    }
}
