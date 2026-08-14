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

    /** Set once by EngineWebView right after the single engine WebView is created. */
    private var webView: WebView? = null

    fun attachWebView(webView: WebView) {
        this.webView = webView
    }

    /** Called from MainActivity.onDestroy() to avoid leaking the WebView/Activity context. */
    fun releaseWebView() {
        webView?.destroy()
        webView = null
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
        activeTabId.value = if (obj.isNull("activeTabId")) null else obj.optString("activeTabId", null)
        addressBarText.value = obj.optString("addressValue", addressBarText.value)
        canGoBack.value = obj.optBoolean("canGoBack", false)
        canGoForward.value = obj.optBoolean("canGoForward", false)
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

    fun newTab(url: String = "https://www.google.com") {
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

    /** Normalizes address-bar text into a navigable URL: adds scheme, or builds a search query. */
    fun resolveInput(input: String): String {
        val trimmed = input.trim()
        val looksLikeUrl = trimmed.contains(".") && !trimmed.contains(" ")
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            looksLikeUrl -> "https://$trimmed"
            else -> "https://www.google.com/search?q=" + java.net.URLEncoder.encode(trimmed, "UTF-8")
        }
    }
}
