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
