package com.nova.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File
import java.net.URI

class NovaCookieHandlerTest {
    private val site = URI("https://shop.test/account")
    private fun header(h: java.net.CookieHandler, uri: URI = site) = h.get(uri, emptyMap())["Cookie"]?.joinToString("; ") ?: ""
    private fun setCookie(h: java.net.CookieHandler, value: String, uri: URI = site) = h.put(uri, mapOf("Set-Cookie" to listOf(value)))

    @Test
    fun loginCookieIsStoredAndSentAsPlainNameValue() {
        val h = NovaCookieHandler(NativeCookieJar(null))
        setCookie(h, "sid=abc; Path=/; Max-Age=3600; Secure; HttpOnly") // Max-Age made java.net send $Version="1"
        assertEquals("sid=abc", header(h))
        assertEquals("", header(h, URI("http://shop.test/account"))) // Secure: https only
    }

    @Test
    fun incognitoNeitherSeesNorLeaksCookies() {
        val h = NovaCookieHandler(NativeCookieJar(null))
        setCookie(h, "sid=normal; Path=/")
        h.incognito = true
        assertEquals("", header(h))
        setCookie(h, "sid=private; Path=/")
        assertEquals("sid=private", header(h))
        h.incognito = false
        assertEquals("sid=normal", header(h))
        h.incognito = true
        assertEquals("", header(h))
    }

    @Test
    fun scriptsNeverSeeOrWriteHttpOnlyCookies() {
        val h = NovaCookieHandler(NativeCookieJar(null))
        setCookie(h, "sid=secret; Path=/; HttpOnly")
        setCookie(h, "theme=dark; Path=/")
        assertEquals("theme=dark", h.getForScript(site.toString()))
        h.setFromScript(site.toString(), "evil=1; HttpOnly")
        h.setFromScript(site.toString(), "sid=stolen; Path=/")
        h.setFromScript(site.toString(), "lang=en; Path=/")
        assertEquals("sid=secret; theme=dark; lang=en", header(h))
        assertEquals("", h.getForScript("javascript:alert(1)"))
    }

    @Test
    fun persistentCookiesSurviveRestartSessionOnesDont() {
        val file = File.createTempFile("nova-cookies", ".json").apply { delete() }
        try {
            val first = NativeCookieJar(file)
            setCookie(first, "keep=1; Path=/; Max-Age=86400")
            setCookie(first, "session=1; Path=/")
            setCookie(first, "gone=1; Path=/; Max-Age=86400")
            setCookie(first, "gone=; Path=/; Max-Age=0") // logout deletes
            first.save()
            assertEquals("keep=1", header(NativeCookieJar(file)))
        } finally {
            file.delete()
        }
    }

    @Test
    fun defaultPathAndForeignDomainsFollowRfc6265() {
        val jar = NativeCookieJar(null)
        setCookie(jar, "a=1", URI("https://shop.test/app/login"))
        assertEquals("a=1", header(jar, URI("https://shop.test/app/cart")))
        assertEquals("", header(jar, URI("https://shop.test/other")))
        assertFalse(jar.setCookie(site, "x=1; Domain=evil.test", fromScript = false))
        setCookie(jar, "wide=1; Domain=.shop.test; Path=/")
        assertEquals("wide=1", header(jar, URI("https://m.shop.test/")))
    }
}
