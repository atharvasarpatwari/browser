package com.nova.browser

import android.Manifest
import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebView
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.AndroidViewModel
import com.nova.browser.model.Bookmark
import com.nova.browser.model.DownloadItem
import com.nova.browser.model.DownloadState
import com.nova.browser.model.HistoryEntry
import com.nova.browser.model.PageError
import com.nova.browser.model.Tab
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * A long-press context-menu target resolved by the engine's layout hit-test
 * (see resolveContextTarget() in browser-window.ts) and pushed via
 * NovaStateBridge.onContextMenuRequested.
 */
data class ContextMenuTarget(
    val x: Int,
    val y: Int,
    val pageUrl: String,
    val pageTitle: String,
    val linkUrl: String?,
    val linkText: String?,
    val imageUrl: String?,
    val imageAlt: String?
)

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
 *
 * Downloads are the one exception: they are OWNED natively (NativeDownloader
 * fetches and persists the real bytes into app storage) — the engine only
 * triggers them via onDownloadRequested.
 */
class BrowserViewModel(application: Application) : AndroidViewModel(application) {

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

    /** Mirrors the engine's incognito (private browsing) session toggle. */
    var incognito = mutableStateOf(false)
        private set

    // ── Context menu (long-press, engine-resolved target) ────────────────────

    /** Non-null while a context menu is showing; dismissed via dismissContextMenu(). */
    var contextMenu = mutableStateOf<ContextMenuTarget?>(null)
        private set

    /** Parses a JS bridge payload: {x, y, pageUrl, pageTitle, linkUrl?, linkText?, imageUrl?, imageAlt?}. */
    fun onContextMenuRequested(json: String) {
        try {
            val obj = JSONObject(json)
            contextMenu.value = ContextMenuTarget(
                x = obj.optInt("x", 0),
                y = obj.optInt("y", 0),
                pageUrl = obj.optString("pageUrl", ""),
                pageTitle = obj.optString("pageTitle", ""),
                linkUrl = if (obj.isNull("linkUrl")) null else obj.optString("linkUrl"),
                linkText = if (obj.isNull("linkText")) null else obj.optString("linkText"),
                imageUrl = if (obj.isNull("imageUrl")) null else obj.optString("imageUrl"),
                imageAlt = if (obj.isNull("imageAlt")) null else obj.optString("imageAlt")
            )
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse context menu request", e)
        }
    }

    fun dismissContextMenu() {
        contextMenu.value = null
    }

    fun copyToClipboard(label: String, text: String) {
        val cm = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    fun shareUrl(title: String, url: String) {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, title)
            putExtra(Intent.EXTRA_TEXT, url)
        }
        runCatching {
            getApplication<Application>().startActivity(
                Intent.createChooser(intent, "Share link").apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            )
        }.onFailure { Log.e(TAG, "Failed to share url", it) }
    }

    // ── File chooser (WebChromeClient.onShowFileChooser) ─────────────────────

    private val pendingFileChooser = mutableStateOf<ValueCallback<Array<Uri>>?>(null)
    var isFileChooserPending = mutableStateOf(false)
        private set

    /** Stores the WebView's file-chooser callback and signals the UI to open the document picker. */
    fun openFileChooser(callback: ValueCallback<Array<Uri>>) {
        pendingFileChooser.value = callback
        isFileChooserPending.value = true
    }

    /** Resolves the pending file chooser with the picked URI (or null on cancel). */
    fun onFileChosen(uri: Uri?) {
        val callback = pendingFileChooser.value
        pendingFileChooser.value = null
        isFileChooserPending.value = false
        callback?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
    }

    // ── Web permissions (WebChromeClient.onPermissionRequest) ────────────────

    /** Non-null while a WebView permission request awaits a runtime-permission grant. */
    var permissionRequest = mutableStateOf<PermissionRequest?>(null)
        private set

    fun onPermissionRequested(request: PermissionRequest) {
        permissionRequest.value = request
    }

    /**
     * Maps a WebView permission request to the Android runtime permission it
     * needs, or null when the request needs no user grant (MIDI sync, protected
     * media) and can be auto-granted.
     */
    fun androidPermissionFor(request: PermissionRequest): String? {
        val res = request.resources.toSet()
        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE in res) return Manifest.permission.CAMERA
        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE in res) return Manifest.permission.RECORD_AUDIO
        return null
    }

    fun resolvePermissionRequest(granted: Boolean) {
        val request = permissionRequest.value ?: return
        permissionRequest.value = null
        if (granted) request.grant(request.resources) else request.deny()
    }

    // ── Downloads (natively owned, see NativeDownloader) ─────────────────────

    val downloads = mutableStateListOf<DownloadItem>()

    private val downloader = NativeDownloader(
        context = application,
        onItemChanged = { upsertDownload(it) },
        onItemRemoved = { id -> downloads.removeAll { it.id == id } }
    )

    /** Shared with NovaFetchBridge so attachment responses can hand off to the native downloader. */
    internal val nativeDownloader: NativeDownloader get() = downloader

    private fun upsertDownload(item: DownloadItem) {
        val idx = downloads.indexOfFirst { it.id == item.id }
        if (idx >= 0) downloads[idx] = item else downloads.add(item)
    }

    /** Starts a download with explicit metadata (engine bridge / DownloadListener path). */
    fun startDownload(url: String, filename: String?, mimeType: String?, referrer: String?) {
        downloader.start(url, filename, mimeType, referrer)
    }

    /** Parses a JS bridge payload: {url, filename?, mimeType?, referrer?}. */
    fun startDownloadFromBridge(json: String) {
        try {
            val obj = JSONObject(json)
            val url = obj.optString("url")
            if (url.isEmpty()) return
            val filename = if (obj.isNull("filename")) null else obj.optString("filename")
            val mimeType = if (obj.isNull("mimeType")) null else obj.optString("mimeType")
            val referrer = if (obj.isNull("referrer")) null else obj.optString("referrer")
            startDownload(url, filename, mimeType, referrer)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse bridge download request", e)
        }
    }

    /** Starts a download from a WebView DownloadListener (content-disposition string). */
    fun startDownloadFromDisposition(url: String, contentDisposition: String?, mimeType: String?) {
        val filename = parseDispositionFilename(contentDisposition)
        downloader.start(url, filename, mimeType, null)
    }

    /** Downloads an image through the native downloader (context-menu "save image"). */
    fun saveImage(url: String, alt: String?) {
        val ext = url.substringAfterLast('.', "").substringBefore('/')
            .takeIf { it.length in 2..5 && it.all(Char::isLetterOrDigit) }?.let { ".$it" } ?: ".jpg"
        val name = alt?.replace(Regex("[^A-Za-z0-9._-]+"), "-")?.trim('-')?.take(60)
            ?.takeIf { it.isNotBlank() } ?: "image"
        startDownload(url, name + ext, "image/*", null)
    }

    fun pauseDownload(id: String) = downloader.pause(id)
    fun resumeDownload(id: String) = downloader.resume(id)
    fun cancelDownload(id: String) = downloader.cancel(id)
    fun removeDownload(id: String) = downloader.remove(id)
    fun clearCompletedDownloads() = downloader.clearCompleted()

    /** Opens a completed download through a content provider (FileProvider + ACTION_VIEW). */
    fun openDownload(id: String) {
        val item = downloads.firstOrNull { it.id == id && it.state == DownloadState.COMPLETED } ?: return
        val file = File(item.path)
        if (!file.exists()) return
        val uri = fileProviderUri(file)
        val mime = item.mimeType.ifEmpty { NativeDownloader.mimeTypeFor(item.filename) }
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, mime)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { getApplication<Application>().startActivity(intent) }
            .onFailure { Log.e(TAG, "No app to open ${item.filename}", it) }
    }

    /** Shares a completed download via ACTION_SEND. */
    fun shareDownload(id: String) {
        val item = downloads.firstOrNull { it.id == id && it.state == DownloadState.COMPLETED } ?: return
        val file = File(item.path)
        if (!file.exists()) return
        val uri = fileProviderUri(file)
        val mime = item.mimeType.ifEmpty { NativeDownloader.mimeTypeFor(item.filename) }
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching {
            getApplication<Application>().startActivity(Intent.createChooser(intent, "Share ${item.filename}").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            })
        }.onFailure { Log.e(TAG, "Failed to share ${item.filename}", it) }
    }

    private fun fileProviderUri(file: File): Uri =
        androidx.core.content.FileProvider.getUriForFile(
            getApplication(),
            "${getApplication<Application>().packageName}${NativeDownloader.PROVIDER_AUTHORITY_SUFFIX}",
            file
        )

    private fun parseDispositionFilename(disposition: String?): String? {
        if (disposition.isNullOrEmpty()) return null
        val star = Regex("filename\\*\\s*=(?:UTF-8|utf-8)''([^;]*)").find(disposition)
        if (star != null) {
            return try {
                java.net.URLDecoder.decode(star.groupValues[1].trim().trim('"'), "UTF-8")
            } catch (_: Exception) {
                null
            }
        }
        val plain = Regex("filename\\s*=\\s*\"?([^\";]+)\"?").find(disposition)
        return plain?.groupValues?.get(1)?.trim()
    }

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
                loading = t.optBoolean("loading", false),
                error = parsePageError(t)
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
        incognito.value = obj.optBoolean("incognito", false)
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

    /** Parses the optional per-tab `error` object {code, description, url} pushed in ChromeStateSnapshot. */
    private fun parsePageError(tab: JSONObject): PageError? {
        if (tab.isNull("error")) return null
        return try {
            val e = tab.getJSONObject("error")
            PageError(
                code = e.optString("code"),
                description = e.optString("description"),
                url = e.optString("url")
            )
        } catch (ex: Exception) {
            Log.e(TAG, "Failed to parse tab error", ex)
            null
        }
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

    /** Opens a URL in a fresh engine tab (context-menu "open in new tab" / popup targets). */
    fun openInNewTab(url: String) {
        callEngine("window.novaNative && window.novaNative.openInNewTab(${jsString(url)});")
    }

    /** Toggles the engine's incognito (private browsing) session. */
    fun setIncognito(enabled: Boolean) {
        incognito.value = enabled
        callEngine("window.novaNative && window.novaNative.setIncognito($enabled);")
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

    companion object {
        private const val TAG = "BrowserViewModel"
    }
}
