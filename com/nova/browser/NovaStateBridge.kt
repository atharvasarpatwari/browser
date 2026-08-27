package com.nova.browser

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Receives all JS -> Kotlin pushes from the engine's android-native-bridge.ts:
 *   - onStateChanged(json)     -> ChromeStateSnapshot (tabs/nav state)
 *   - onBookmarksChanged(json) -> full bookmark list, on install + every change
 *   - onHistoryChanged(json)   -> full history list, on install + every change
 *   - onDownloadRequested(json)-> engine-initiated download: {url, filename?, mimeType?, referrer?}
 *   - onContextMenuRequested(json) -> long-press menu: {x, y, pageUrl, pageTitle, linkUrl?, linkText?, imageUrl?, imageAlt?}
 * (see browser-window.ts for the exact shapes). The Kotlin -> JS half is
 * window.novaNative.*, driven from BrowserViewModel via evaluateJavascript.
 *
 * @JavascriptInterface methods are invoked on a WebView-internal thread, not
 * the main thread, so every callback is marshaled onto the main looper before
 * touching any Compose state.
 */
class NovaStateBridge(
    private val onSnapshot: (json: String) -> Unit,
    private val onBookmarks: (json: String) -> Unit,
    private val onHistory: (json: String) -> Unit,
    private val onDownloadRequest: (json: String) -> Unit,
    private val onContextMenu: (json: String) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onStateChanged(json: String) {
        Log.d(TAG, "onStateChanged len=${json.length}")
        mainHandler.post {
            try { onSnapshot(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle state snapshot", e) }
        }
    }

    @JavascriptInterface
    fun onBookmarksChanged(json: String) {
        Log.d(TAG, "onBookmarksChanged len=${json.length}")
        mainHandler.post {
            try { onBookmarks(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle bookmarks snapshot", e) }
        }
    }

    @JavascriptInterface
    fun onHistoryChanged(json: String) {
        Log.d(TAG, "onHistoryChanged len=${json.length}")
        mainHandler.post {
            try { onHistory(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle history snapshot", e) }
        }
    }

    @JavascriptInterface
    fun onDownloadRequested(json: String) {
        Log.d(TAG, "onDownloadRequested len=${json.length}")
        mainHandler.post {
            try { onDownloadRequest(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle download request", e) }
        }
    }

    @JavascriptInterface
    fun onContextMenuRequested(json: String) {
        Log.d(TAG, "onContextMenuRequested len=${json.length}")
        mainHandler.post {
            try { onContextMenu(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle context menu request", e) }
        }
    }

    companion object {
        private const val TAG = "NovaStateBridge"
    }
}
