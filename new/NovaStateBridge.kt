package com.nova.browser

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface

/**
 * Receives window.NovaStateBridge.onStateChanged(json) calls pushed by the
 * engine's android-native-bridge.ts every time tabs/navigation state changes
 * (see ChromeStateSnapshot in src/ui/pages/browser-window.ts). This is the
 * JS -> Kotlin half of the hybrid bridge; the Kotlin -> JS half is
 * window.novaNative.*, driven from BrowserViewModel via evaluateJavascript.
 *
 * @JavascriptInterface methods are invoked on a WebView-internal thread, not
 * the main thread, so every callback is marshaled onto the main looper before
 * touching any Compose state.
 */
class NovaStateBridge(
    private val onSnapshot: (json: String) -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun onStateChanged(json: String) {
        mainHandler.post {
            try {
                onSnapshot(json)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to handle state snapshot", e)
            }
        }
    }

    companion object {
        private const val TAG = "NovaStateBridge"
    }
}
