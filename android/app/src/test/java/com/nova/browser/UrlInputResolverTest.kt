package com.nova.browser

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Unit tests for [UrlInputResolver].
 *
 * Mirrors the engine-side coverage of `src/browser/navigation/url-parser.ts`
 * (`tests/url-parser.test.ts`) and the omnibox heuristics
 * (`tests/omnibox.test.ts`), plus the `hostname:port` case the engine's
 * normalize() mis-reads as a scheme.
 */
class UrlInputResolverTest {

    private val ddg = "https://duckduckgo.com/?q=%s"
    private val google = "https://www.google.com/search?q=%s"

    // ── URL-vs-search classification + scheme inference ────────────────────

    @Test
    fun `bare hostname gets https prefix`() {
        assertEquals("https://google.com", UrlInputResolver.resolve("google.com", ddg))
    }

    @Test
    fun `subdomain with path query fragment keeps shape`() {
        assertEquals(
            "https://sub.domain.co.uk/path?q=1#section",
            UrlInputResolver.resolve("sub.domain.co.uk/path?q=1#section", ddg)
        )
    }

    @Test
    fun `dotted hostname with port is a URL not a scheme`() {
        assertEquals("https://example.com:3000", UrlInputResolver.resolve("example.com:3000", ddg))
    }

    @Test
    fun `localhost variants navigate`() {
        assertEquals("https://localhost", UrlInputResolver.resolve("localhost", ddg))
        assertEquals("https://localhost:3000", UrlInputResolver.resolve("localhost:3000", ddg))
        assertEquals("https://localhost:4000/app", UrlInputResolver.resolve("localhost:4000/app", ddg))
    }

    @Test
    fun `ipv4 variants navigate`() {
        assertEquals("https://192.168.1.1", UrlInputResolver.resolve("192.168.1.1", ddg))
        assertEquals("https://192.168.1.1:8080", UrlInputResolver.resolve("192.168.1.1:8080", ddg))
        assertEquals("https://10.0.0.1:8080/api", UrlInputResolver.resolve("10.0.0.1:8080/api", ddg))
    }

    @Test
    fun `single-label hostnames with a port or path navigate`() {
        assertEquals("https://intranet/", UrlInputResolver.resolve("intranet/", ddg))
        assertEquals("https://wiki/Main_Page", UrlInputResolver.resolve("wiki/Main_Page", ddg))
        assertEquals("https://www:3000/api", UrlInputResolver.resolve("www:3000/api", ddg))
        assertEquals("https://router:8080", UrlInputResolver.resolve("router:8080", ddg))
    }

    @Test
    fun `a lone word is a search, not a host`() {
        assertEquals("https://duckduckgo.com/?q=hello", UrlInputResolver.resolve("hello", ddg))
        assertEquals("https://duckduckgo.com/?q=gmail", UrlInputResolver.resolve("gmail", ddg))
        assertEquals("https://duckduckgo.com/?q=www", UrlInputResolver.resolve("www", ddg))
        assertEquals("https://localhost", UrlInputResolver.resolve("localhost", ddg)) // still a host
    }

    // ── Explicit-scheme pass-through (idempotent) ──────────────────────────

    @Test
    fun `explicit https and http pass through unchanged`() {
        assertEquals("https://example.com", UrlInputResolver.resolve("https://example.com", ddg))
        assertEquals("http://example.com", UrlInputResolver.resolve("http://example.com", ddg))
    }

    @Test
    fun `absolute url with spaced path passes through`() {
        assertEquals(
            "https://example.com/path with%20space",
            UrlInputResolver.resolve("https://example.com/path with%20space", ddg)
        )
    }

    @Test
    fun `non-http schemes pass through unchanged - never rewrapped`() {
        assertEquals("ftp://example.com", UrlInputResolver.resolve("ftp://example.com", ddg))
        assertEquals("file:///C:/path/to/file.html", UrlInputResolver.resolve("file:///C:/path/to/file.html", ddg))
        assertEquals("ws://example.com/socket", UrlInputResolver.resolve("ws://example.com/socket", ddg))
        assertEquals("wss://example.com/socket", UrlInputResolver.resolve("wss://example.com/socket", ddg))
    }

    @Test
    fun `special pages pass through so the engine can canonicalize them`() {
        assertEquals("about:blank", UrlInputResolver.resolve("about:blank", ddg))
        assertEquals("about:settings", UrlInputResolver.resolve("about:settings", ddg))
        assertEquals("nova://settings", UrlInputResolver.resolve("nova://settings", ddg))
        assertEquals("mailto:user@example.com", UrlInputResolver.resolve("mailto:user@example.com", ddg))
    }

    // ── Search fallback ─────────────────────────────────────────────────────

    @Test
    fun `space-separated text becomes a search query`() {
        assertEquals("https://duckduckgo.com/?q=hello%20world", UrlInputResolver.resolve("hello world", ddg))
        assertEquals("https://duckduckgo.com/?q=grill%20recipes", UrlInputResolver.resolve("  grill   recipes  ", ddg))
    }

    @Test
    fun `sentences with a dot are still searches`() {
        assertEquals("https://duckduckgo.com/?q=version%201.0", UrlInputResolver.resolve("version 1.0", ddg))
    }

    @Test
    fun `google template is used when configured`() {
        assertEquals("https://www.google.com/search?q=what%20is%20the%20weather", UrlInputResolver.resolve("what is the weather", google))
    }

    @Test
    fun `query is percent-encoded like encodeURIComponent`() {
        assertEquals("https://duckduckgo.com/?q=1%2B1%3F", UrlInputResolver.resolve("1+1?", ddg))
        assertEquals("https://duckduckgo.com/?q=a%20b%20c", UrlInputResolver.resolve("a b c", ddg))
    }

    @Test
    fun `template without placeholder disables substitution`() {
        assertEquals("https://example.com/search", UrlInputResolver.resolve("hi there", "https://example.com/search"))
    }

    // ── Empty input ─────────────────────────────────────────────────────────

    @Test
    fun `empty or whitespace input resolves to empty`() {
        assertEquals("", UrlInputResolver.resolve("", ddg))
        assertEquals("", UrlInputResolver.resolve("   ", ddg))
    }

    // ── buildSearchUrl (direct) ─────────────────────────────────────────────

    @Test
    fun `buildSearchUrl encodes and substitutes`() {
        assertEquals("https://duckduckgo.com/?q=how%20to%20code", UrlInputResolver.buildSearchUrl("how to code", ddg))
        assertEquals("https://duckduckgo.com/?q=%E2%9C%93", UrlInputResolver.buildSearchUrl("\u2713", ddg))
    }

    @Test
    fun aHostTypedWithoutASchemeGoesToTheEngineAsHttpSoItCanFallBack() {
        val template = "https://www.google.com/search?q=%s"
        fun engine(typed: String) = UrlInputResolver.engineAddress(typed, UrlInputResolver.resolve(typed, template))
        assertEquals("http://httpforever.com", engine("httpforever.com"))
        assertEquals("http://example.org/a/b?x=1", engine("  example.org/a/b?x=1 "))
        // unchanged: explicit schemes, searches, local addresses, built-in pages
        assertEquals("https://example.com", engine("https://example.com"))
        assertEquals("http://example.com", engine("http://example.com"))
        assertEquals("https://www.google.com/search?q=buy%20shoes", engine("buy shoes"))
        assertEquals("https://localhost:4000/app", engine("localhost:4000/app"))
        assertEquals("https://192.168.1.1:8080", engine("192.168.1.1:8080"))
    }
}
