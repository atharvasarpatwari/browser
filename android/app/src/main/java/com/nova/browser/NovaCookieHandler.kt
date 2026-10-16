package com.nova.browser

import android.webkit.JavascriptInterface
import java.io.File
import java.net.CookieHandler
import java.net.HttpCookie
import java.net.URI

/**
 * Cookie store for every native HTTP request (NovaFetchBridge, NativeDownloader),
 * plus `document.cookie` for engine pages via the NovaCookies bridge.
 *
 * HttpURLConnection only handles cookies through CookieHandler.getDefault(), so this
 * is installed process-wide. Normal browsing persists in [normal]; incognito uses a
 * throwaway in-memory jar that is replaced whenever incognito is toggled.
 */
class NovaCookieHandler(private val normal: NativeCookieJar) : CookieHandler() {
    @Volatile private var privateJar = NativeCookieJar(null)

    @Volatile var incognito = false
        set(value) {
            if (field != value) privateJar = NativeCookieJar(null)
            field = value
        }

    private fun current() = if (incognito) privateJar else normal

    override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> =
        current().get(uri, requestHeaders)

    override fun put(uri: URI, responseHeaders: Map<String, List<String>>) =
        current().put(uri, responseHeaders)

    fun getForScript(url: String): String = webUri(url)?.let { current().cookieHeader(it, forScript = true) } ?: ""

    fun setFromScript(url: String, cookie: String) {
        webUri(url)?.let { current().setCookie(it, cookie, fromScript = true) }
    }

    /** Persists the normal jar (incognito is never written). */
    fun flush() = normal.save()

    /** See NativeCookieJar.importLegacy; always into the normal jar. */
    fun importLegacy(origin: URI, nameValuePairs: String) = normal.importLegacy(origin, nameValuePairs)

    private fun webUri(url: String): URI? = runCatching { URI(url) }.getOrNull()
        ?.takeIf { it.scheme.equals("http", true) || it.scheme.equals("https", true) }
}

/** `window.NovaCookies` for the engine bundle (main.ts installCookies). */
class NovaCookiesBridge(private val handler: NovaCookieHandler) {
    @JavascriptInterface fun getForScript(url: String): String = handler.getForScript(url)
    @JavascriptInterface fun setFromScript(url: String, cookie: String) = handler.setFromScript(url, cookie)
}

/**
 * RFC 6265 cookie jar with HttpOnly-aware script access, persisted to [file] (null =
 * memory only). Not java.net.CookieManager: that one turns any Max-Age cookie into an
 * RFC 2965 "version 1" cookie and sends `$Version="1"; sid="x";$Path="/"`, which many
 * servers don't parse. HttpCookie is only used to parse attributes.
 */
class NativeCookieJar(private val file: File?) : CookieHandler() {
    internal data class Stored(
        val name: String, val value: String, val domain: String, val hostOnly: Boolean, val path: String,
        val secure: Boolean, val httpOnly: Boolean, val expiresAt: Long?, // null = session cookie
    )

    private val cookies = LinkedHashMap<String, Stored>()
    private var dirty = false

    init { load() }

    override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> {
        val header = cookieHeader(uri, forScript = false)
        return if (header.isEmpty()) emptyMap() else mapOf("Cookie" to listOf(header))
    }

    override fun put(uri: URI, responseHeaders: Map<String, List<String>>) {
        for ((name, values) in responseHeaders) {
            if (name.equals("Set-Cookie", ignoreCase = true)) values.forEach { setCookie(uri, it, fromScript = false) }
        }
    }

    @Synchronized
    fun cookieHeader(uri: URI, forScript: Boolean): String {
        val host = uri.host?.lowercase() ?: return ""
        val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
        val https = uri.scheme.equals("https", true)
        val now = System.currentTimeMillis()
        return cookies.values
            .filter { c ->
                (c.expiresAt == null || c.expiresAt > now) && (!c.secure || https) && (!forScript || !c.httpOnly) &&
                    (if (c.hostOnly) host == c.domain else host == c.domain || host.endsWith(".${c.domain}")) &&
                    pathMatches(path, c.path)
            }
            .sortedByDescending { it.path.length }
            .joinToString("; ") { "${it.name}=${it.value}" }
    }

    /** Stores, replaces, or (Max-Age=0 / past Expires) deletes one cookie. Scripts can't touch HttpOnly ones. */
    @Synchronized
    fun setCookie(uri: URI, header: String, fromScript: Boolean): Boolean {
        val host = uri.host?.lowercase() ?: return false
        val parsed = runCatching { HttpCookie.parse(header) }.getOrNull()?.firstOrNull() ?: return false
        if (fromScript && parsed.isHttpOnly) return false
        val attrDomain = parsed.domain?.trimStart('.')?.lowercase()?.takeIf { it.isNotEmpty() }
        if (attrDomain != null && host != attrDomain && !host.endsWith(".$attrDomain")) return false
        val requestPath = uri.rawPath?.takeIf { it.startsWith("/") } ?: "/"
        val path = parsed.path?.takeIf { it.startsWith("/") } ?: defaultPath(requestPath)
        val cookie = Stored(
            name = parsed.name, value = parsed.value ?: "", domain = attrDomain ?: host, hostOnly = attrDomain == null,
            path = path, secure = parsed.secure, httpOnly = parsed.isHttpOnly,
            expiresAt = if (parsed.maxAge < 0) null else System.currentTimeMillis() + parsed.maxAge * 1000,
        )
        val key = "${cookie.domain}|${cookie.path}|${cookie.name}"
        if (fromScript && cookies[key]?.httpOnly == true) return false
        if (cookie.expiresAt != null && cookie.expiresAt <= System.currentTimeMillis()) {
            if (cookies.remove(key) != null) dirty = true
            return true
        }
        cookies[key] = cookie
        if (cookie.expiresAt != null) dirty = true
        return true
    }

    /**
     * One-time import of a cookie that only exists in the old (v1.6) WebView store,
     * which exposes just "name=value". Attributes are unknown, so it's host-only,
     * path "/", hidden from scripts, and kept 30 days.
     */
    @Synchronized
    fun importLegacy(origin: URI, nameValuePairs: String) {
        val host = origin.host?.lowercase() ?: return
        for (pair in nameValuePairs.split(";")) {
            val eq = pair.indexOf('=')
            if (eq <= 0) continue
            val name = pair.substring(0, eq).trim()
            val key = "$host|/|$name"
            if (cookies.containsKey(key)) continue
            cookies[key] = Stored(
                name, pair.substring(eq + 1).trim(), host, hostOnly = true, path = "/",
                secure = origin.scheme.equals("https", true), httpOnly = true,
                expiresAt = System.currentTimeMillis() + 30L * 24 * 3600 * 1000,
            )
            dirty = true
        }
    }

    /** Writes persistent cookies (session ones never touch disk). */
    @Synchronized
    fun save() {
        val target = file ?: return
        if (!dirty) return
        val now = System.currentTimeMillis()
        // One cookie per line, tab-separated: RFC 6265 forbids control characters in
        // names, values, domains and paths, so no escaping is needed.
        val text = cookies.values.filter { it.expiresAt != null && it.expiresAt > now }.joinToString("\n") { c ->
            listOf(c.name, c.value, c.domain, c.hostOnly, c.path, c.secure, c.httpOnly, c.expiresAt).joinToString("\t")
        }
        runCatching {
            val tmp = File(target.path + ".tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
            dirty = false
        }
    }

    private fun load() {
        val source = file?.takeIf { it.exists() } ?: return
        val now = System.currentTimeMillis()
        runCatching {
            for (line in source.readLines()) {
                val f = line.split('\t')
                if (f.size != 8) continue
                val c = Stored(f[0], f[1], f[2], f[3].toBoolean(), f[4], f[5].toBoolean(), f[6].toBoolean(), f[7].toLongOrNull() ?: continue)
                if (c.expiresAt!! > now) cookies["${c.domain}|${c.path}|${c.name}"] = c
            }
        }
    }

    private companion object {
        fun pathMatches(requestPath: String, cookiePath: String): Boolean =
            requestPath == cookiePath || (requestPath.startsWith(cookiePath) &&
                (cookiePath.endsWith("/") || requestPath.getOrNull(cookiePath.length) == '/'))

        /** RFC 6265 §5.1.4: the request path up to (not incl.) its last "/". */
        fun defaultPath(requestPath: String): String {
            val last = requestPath.lastIndexOf('/')
            return if (last <= 0) "/" else requestPath.substring(0, last)
        }
    }
}
