package com.nova.browser

import org.junit.Assert.assertEquals
import org.junit.Test
import java.net.URI

class SettingsTest {
    @Test
    fun searchEngineChoiceDrivesAddressBarSearches() {
        assertEquals("https://duckduckgo.com/?q=cats%20and%20dogs",
            UrlInputResolver.resolve("cats and dogs", SearchEngine.DUCKDUCKGO.template))
        assertEquals("https://example.com", UrlInputResolver.resolve("example.com", SearchEngine.BRAVE.template))
    }

    @Test
    fun unknownStoredEngineFallsBackToGoogle() {
        assertEquals(SearchEngine.GOOGLE, SearchEngine.fromId(null))
        assertEquals(SearchEngine.GOOGLE, SearchEngine.fromId("ASK_JEEVES"))
        assertEquals(SearchEngine.BING, SearchEngine.fromId("BING"))
    }

    @Test
    fun clearAllRemovesNormalAndIncognitoCookies() {
        val h = NovaCookieHandler(NativeCookieJar(null))
        val site = URI("https://shop.test/")
        h.put(site, mapOf("Set-Cookie" to listOf("sid=1; Path=/; Max-Age=3600")))
        h.incognito = true
        h.put(site, mapOf("Set-Cookie" to listOf("p=1; Path=/")))
        h.clearAll()
        assertEquals(emptyMap<String, List<String>>(), h.get(site, emptyMap()))
        h.incognito = false
        assertEquals(emptyMap<String, List<String>>(), h.get(site, emptyMap()))
    }
}
