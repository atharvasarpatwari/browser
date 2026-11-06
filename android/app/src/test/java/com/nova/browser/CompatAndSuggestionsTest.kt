package com.nova.browser

import com.nova.browser.model.Bookmark
import com.nova.browser.model.HistoryEntry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        for (url in listOf("https://en.wikipedia.org/wiki/Web_browser", "https://www.google.com/search?q=x", "https://example.com",
            "https://notgmail.com", "https://gmail.com.evil.test/", "about:blank", "nova://settings", "javascript:alert(1)")) {
            assertFalse(url, CompatSites.needsCompat(url))
        }
    }

    @Test
    fun scriptBuiltSitesOpenInCompatibilityModeUnlessSwitchedOff() {
        for (url in listOf("https://www.youtube.com/", "https://m.youtube.com/watch?v=x", "https://reddit.com", "https://www.reddit.com/r/android")) {
            assertTrue(url, CompatSites.needsCompat(url))
        }
        assertFalse(CompatSites.needsCompat("https://m.youtube.com/", userOff = setOf("m.youtube.com")))
        assertFalse(CompatSites.needsCompat("https://notreddit.com/"))
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
