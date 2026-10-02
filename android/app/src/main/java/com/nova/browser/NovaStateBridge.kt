package com.nova.browser

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Receives all JS -> Kotlin pushes from the engine's android-native-bridge.ts.
 * The engine now renders its own real chrome full-screen (same toolbar/tab
 * strip/address bar as desktop — see forceDesktopChrome in browser-window.ts),
 * so this bridge only carries what a web page genuinely cannot do itself on
 * Android:
 *   - onStateChanged(json)     -> ChromeStateSnapshot (tabs/nav state) — kept
 *     available for any native surface that wants it, though no native UI
 *     currently mirrors it
 *   - onBookmarksChanged(json) -> full bookmark list, on install + every change
 *   - onHistoryChanged(json)   -> full history list, on install + every change
 *   - onDownloadRequested(json)-> real file download the OS should own: {url, filename?, mimeType?, referrer?}
 *   - onDownloadsPageRequested() -> main-menu "Downloads": open the native sheet
 *     instead of nova://downloads, which has no idea a native download happened
 *   - onIncognitoToggleRequested() -> main-menu "Incognito": toggle the engine's
 *     session from the web chrome, since no native UI shows this state anymore
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
    private val onContextMenu: (json: String) -> Unit,
    private val onDownloadsPageRequest: () -> Unit,
    private val onIncognitoToggleRequest: () -> Unit
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

    @JavascriptInterface
    fun onDownloadsPageRequested() {
        Log.d(TAG, "onDownloadsPageRequested")
        mainHandler.post {
            try { onDownloadsPageRequest() } catch (e: Exception) { Log.e(TAG, "Failed to handle downloads page request", e) }
        }
    }

    @JavascriptInterface
    fun onIncognitoToggleRequested() {
        Log.d(TAG, "onIncognitoToggleRequested")
        mainHandler.post {
            try { onIncognitoToggleRequest() } catch (e: Exception) { Log.e(TAG, "Failed to handle incognito toggle request", e) }
        }
    }

    companion object {
        private const val TAG = "NovaStateBridge"
    }
}
