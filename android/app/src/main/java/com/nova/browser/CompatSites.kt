package com.nova.browser

import java.net.URI

/**
 * Which sites open in compatibility mode: Android's system WebView (Chromium) instead of Nova's
 * engine, inside the same tab.
 *
 * Nova's engine follows www.gmail.com's redirects to Google's sign-in page, but Google's sign-in
 * and Gmail are large JavaScript applications its interpreter can't run (the sign-in script, 1.2 MB,
 * fails on `_._DumpException`), so the page could never sign in. Those sites, and any the user
 * switches over from the menu, are shown by the system WebView, which runs them in full.
 */
object CompatSites {

    /** Google's signed-in apps: they need a full JavaScript engine to work at all. */
    val DEFAULT_HOSTS: Set<String> = setOf(
        "gmail.com", "mail.google.com", "accounts.google.com", "myaccount.google.com",
        "docs.google.com", "drive.google.com", "calendar.google.com", "meet.google.com",
        "keep.google.com", "photos.google.com", "contacts.google.com", "chat.google.com",
    )

    /**
     * Hosts a compatibility-mode page may move between without handing the page back to Nova's
     * engine: Google's sign-in hops through several of them (accounts.youtube.com, ogs.google.com…).
     */
    private val STAY_SUFFIXES = listOf("google.com", "gmail.com", "googleusercontent.com", "gstatic.com", "youtube.com", "googleapis.com")

    /** The lower-case host of an http(s) URL, without a leading "www."; null for anything else. */
    fun hostOf(url: String): String? {
        val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return null
        if (uri.scheme?.lowercase() !in setOf("http", "https")) return null
        return uri.host?.lowercase()?.removePrefix("www.")?.takeIf { it.isNotEmpty() }
    }

    private fun matches(host: String, site: String): Boolean = host == site || host.endsWith(".$site")

    /**
     * True when [url] should open in compatibility mode: its site is a default one or one the user
     * switched on ([userOn]), and the user hasn't switched it off ([userOff]).
     */
    fun needsCompat(url: String, userOn: Set<String> = emptySet(), userOff: Set<String> = emptySet()): Boolean {
        val host = hostOf(url) ?: return false
        if (userOff.any { matches(host, it) }) return false
        return DEFAULT_HOSTS.any { matches(host, it) } || userOn.any { matches(host, it) }
    }

    /**
     * True when a navigation inside a compatibility-mode page to [url] stays there: a server
     * redirect, a site in compatibility mode, or one of the hosts Google's sign-in moves through.
     * Other links go back to Nova's engine.
     */
    fun staysInCompat(url: String, isRedirect: Boolean, userOn: Set<String> = emptySet(), userOff: Set<String> = emptySet()): Boolean {
        if (isRedirect) return true
        val host = hostOf(url) ?: return true // non-http(s) schemes are handled by the caller
        if (needsCompat(url, userOn, userOff)) return true
        if (userOff.any { matches(host, it) }) return false
        return STAY_SUFFIXES.any { matches(host, it) }
    }
}
