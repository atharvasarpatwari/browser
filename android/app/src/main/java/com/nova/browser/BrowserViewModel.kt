package com.nova.browser

import android.webkit.WebView
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import com.nova.browser.model.Bookmark
import com.nova.browser.model.HistoryEntry
import com.nova.browser.model.Tab
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reflects the engine's tab/navigation/bookmark/history state (pushed via
 * NovaStateBridge from window.novaNative — see android-native-bridge.ts /
 * browser-window.ts) and dispatches user actions back into the engine
 * through window.novaNative.*, called via WebView.evaluateJavascript().
 *
 * This ViewModel owns none of that state itself — the engine's
 * NavigationController/TabManager/BookmarkService/HistoryService are the
 * single source of truth, shared with desktop. This is a thin, one-way-
 * mirrored read model plus an action-dispatch surface. Bookmark/history
 * mutations are fire-and-forget: the resulting change arrives back through
 * the next onBookmarksChanged/onHistoryChanged push, same pattern tabs use.
 */
class BrowserViewModel : ViewModel() {

    val tabs = mutableStateListOf<Tab>()
    var activeTabId = mutableStateOf<String?>(null)
        private set
    var addressBarText = mutableStateOf("")
        private set
    var canGoBack = mutableStateOf(false)
        private set
    var canGoForward = mutableStateOf(false)
        private set

    val bookmarks = mutableStateListOf<Bookmark>()
    val history = mutableStateListOf<HistoryEntry>()

    /** New-tab/home URL resolved from the engine's `homePage` setting (see getHomeUrl() in browser-window.ts). */
    var homeUrl = mutableStateOf("about:blank")
        private set

    /** Default search URL template with a `%s` placeholder (see getSearchTemplate() in browser-window.ts). */
    var searchTemplate = mutableStateOf("https://www.google.com/search?q=%s")
        private set

    /** Set once by EngineWebView right after the single engine WebView is created. */
    private var webView: WebView? = null
    private var webViewDestroyed = false

    fun attachWebView(webView: WebView) {
        this.webView = webView
    }

    /**
     * Called from MainActivity.onDestroy(). Detaches the WebView from its parent
     * BEFORE destroy() — WebView.destroy() on an attached view throws
     * IllegalStateException — and guards against a second destroy on the same
     * instance (the engine never recreates its WebView, so a stale reference
     * must not be destroyed twice).
     */
    fun releaseWebView() {
        val view = webView ?: return
        webView = null
        if (webViewDestroyed) return
        webViewDestroyed = true
        try {
            (view.parent as? android.view.ViewGroup)?.removeView(view)
        } catch (_: Exception) {
            // Parent may already be detached (e.g. Compose disposed the AndroidView).
        }
        try {
            view.destroy()
        } catch (_: Exception) {
            // destroy() may race a Compose teardown; nothing else to release.
        }
    }

    /** Pauses the engine WebView (JS timers, video) when the app leaves the foreground. */
    fun pause() {
        webView?.onPause()
    }

    /** Resumes the engine WebView when the app returns to the foreground. */
    fun resume() {
        webView?.onResume()
    }

    /**
     * Low-memory hint: releases the WebView's in-memory caches. freeMemory()
     * is deprecated (API 29+) but is the only WebView API for this hint; it is
     * intentionally retained for older minSdk-26 devices.
     */
    @Suppress("DEPRECATION")
    fun trimMemory() {
        webView?.freeMemory()
    }

    val activeTab: Tab?
        get() = tabs.firstOrNull { it.id == activeTabId.value }

    /**
     * Parses a ChromeStateSnapshot JSON payload (see browser-window.ts) and
     * replaces the local tab list wholesale. Called on the main thread by
     * NovaStateBridge.
     */
    fun applySnapshot(json: String) {
        val obj = JSONObject(json)
        val tabsArr: JSONArray = obj.optJSONArray("tabs") ?: JSONArray()
        val parsed = (0 until tabsArr.length()).map { i ->
            val t = tabsArr.getJSONObject(i)
            Tab(
                id = t.getString("id"),
                url = t.getString("url"),
                title = t.getString("title"),
                active = t.getBoolean("active"),
                pinned = t.getBoolean("pinned"),
                loading = t.optBoolean("loading", false)
            )
        }
        tabs.clear()
        tabs.addAll(parsed)
        activeTabId.value = if (obj.isNull("activeTabId")) null else obj.optString("activeTabId")
        addressBarText.value = obj.optString("addressValue", addressBarText.value)
        canGoBack.value = obj.optBoolean("canGoBack", false)
        canGoForward.value = obj.optBoolean("canGoForward", false)
        homeUrl.value = obj.optString("homeUrl", "about:blank")
        searchTemplate.value = obj.optString("searchTemplate", "https://www.google.com/search?q=%s")
    }

    /** Parses the full bookmark list pushed from listBookmarksExternal() (browser-window.ts). */
    fun applyBookmarksSnapshot(json: String) {
        val arr = JSONArray(json)
        val parsed = (0 until arr.length()).map { i ->
            val b = arr.getJSONObject(i)
            Bookmark(id = b.getString("id"), title = b.getString("title"), url = b.getString("url"))
        }
        bookmarks.clear()
        bookmarks.addAll(parsed)
    }

    /** Parses the full recent-history list pushed from listHistoryExternal() (browser-window.ts). */
    fun applyHistorySnapshot(json: String) {
        val arr = JSONArray(json)
        val parsed = (0 until arr.length()).map { i ->
            val h = arr.getJSONObject(i)
            HistoryEntry(
                id = h.getString("id"),
                title = h.getString("title"),
                url = h.getString("url"),
                visitedAt = h.optLong("visitedAt", System.currentTimeMillis())
            )
        }
        history.clear()
        history.addAll(parsed)
    }

    private fun callEngine(expr: String) {
        webView?.post {
            webView?.evaluateJavascript(expr, null)
        }
    }

    private fun jsString(s: String): String = JSONObject.quote(s)

    fun navigate(url: String) {
        val resolved = resolveInput(url)
        addressBarText.value = resolved
        callEngine("window.novaNative && window.novaNative.navigate(${jsString(resolved)});")
    }

    fun goBack() {
        callEngine("window.novaNative && window.novaNative.back();")
    }

    fun goForward() {
        callEngine("window.novaNative && window.novaNative.forward();")
    }

    fun reload() {
        callEngine("window.novaNative && window.novaNative.reload();")
    }

    fun stop() {
        callEngine("window.novaNative && window.novaNative.stop();")
    }

    fun newTab(url: String = homeUrl.value) {
        callEngine("window.novaNative && window.novaNative.createTab(${jsString(url)});")
    }

    fun closeTab(id: String) {
        callEngine("window.novaNative && window.novaNative.closeTab(${jsString(id)});")
    }

    fun selectTab(id: String) {
        callEngine("window.novaNative && window.novaNative.activateTab(${jsString(id)});")
    }

    /** Toggles a bookmark for the active tab through the engine's real BookmarkService. */
    fun toggleBookmark() {
        val tab = activeTab ?: return
        val existing = bookmarks.firstOrNull { it.url == tab.url }
        if (existing != null) {
            callEngine("window.novaNative && window.novaNative.removeBookmark(${jsString(existing.id)});")
        } else {
            callEngine("window.novaNative && window.novaNative.addBookmark(${jsString(tab.title)}, ${jsString(tab.url)});")
        }
    }

    fun isBookmarked(url: String): Boolean = bookmarks.any { it.url == url }

    fun removeBookmark(id: String) {
        callEngine("window.novaNative && window.novaNative.removeBookmark(${jsString(id)});")
    }

    fun removeHistoryEntry(id: String) {
        callEngine("window.novaNative && window.novaNative.removeHistoryEntry(${jsString(id)});")
    }

    fun clearHistory() {
        callEngine("window.novaNative && window.novaNative.clearHistory();")
    }

    /**
     * Normalizes address-bar text into a navigable URL: adds scheme, or builds a
     * search query through the engine's configured default search engine
     * (searchTemplate, e.g. "https://duckduckgo.com/?q=%s").
     */
    fun resolveInput(input: String): String {
        val trimmed = input.trim()
        val looksLikeUrl = trimmed.contains(".") && !trimmed.contains(" ")
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            looksLikeUrl -> "https://$trimmed"
            else -> searchTemplate.value.replace("%s", java.net.URLEncoder.encode(trimmed, "UTF-8"))
        }
    }
}
