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
    private val onHistory: (json: String) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onStateChanged(json: String) {
        mainHandler.post {
            try { onSnapshot(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle state snapshot", e) }
        }
    }

    @JavascriptInterface
    fun onBookmarksChanged(json: String) {
        mainHandler.post {
            try { onBookmarks(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle bookmarks snapshot", e) }
        }
    }

    @JavascriptInterface
    fun onHistoryChanged(json: String) {
        mainHandler.post {
            try { onHistory(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle history snapshot", e) }
        }
    }

    companion object {
        private const val TAG = "NovaStateBridge"
    }
}
