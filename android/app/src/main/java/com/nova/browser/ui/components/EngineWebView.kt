package com.nova.browser.ui.components

import android.annotation.SuppressLint
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import com.nova.browser.BrowserViewModel
import com.nova.browser.NovaFetchBridge
import com.nova.browser.NovaStateBridge

private const val TAG = "NovaEngine"
private const val ENGINE_URL = "https://appassets.androidplatform.net/index.html"

/**
 * Hosts the Nova engine in a single WebView for the lifetime of the app.
 * Unlike the old per-tab MiniWeb-era BrowserWebView, this is created exactly
 * once (factory{} only runs on first composition) — the engine owns all tabs
 * internally, so there is no per-tab WebView to switch between. Native
 * Compose chrome (AddressBar/TabsBar) drives this WebView purely through
 * viewModel actions -> window.novaNative.* (evaluateJavascript); this
 * composable never calls webView.loadUrl() again after the initial load.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EngineWebView(
    viewModel: BrowserViewModel,
    modifier: Modifier = Modifier
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            val assetLoader = WebViewAssetLoader.Builder()
                .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()

            WebView(context).apply {
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    allowFileAccess = false
                    builtInZoomControls = true
                    displayZoomControls = false
                    setSupportZoom(true)
                    mediaPlaybackRequiresUserGesture = false
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                    javaScriptCanOpenWindowsAutomatically = true
                }
                setLayerType(View.LAYER_TYPE_HARDWARE, null)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                setOnLongClickListener { true }

                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(
                        view: WebView,
                        request: WebResourceRequest
                    ): WebResourceResponse? {
                        val response = assetLoader.shouldInterceptRequest(request.url)
                        if (response == null) {
                            Log.w(TAG, "Unhandled resource: ${request.url}")
                        }
                        return response ?: super.shouldInterceptRequest(view, request)
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        super.onPageFinished(view, url)
                        Log.i(TAG, "onPageFinished: $url")
                    }

                    override fun onReceivedError(
                        view: WebView,
                        errorCode: Int,
                        description: String?,
                        failingUrl: String?
                    ) {
                        super.onReceivedError(view, errorCode, description, failingUrl)
                        Log.e(TAG, "WebView error $errorCode: $description @ $failingUrl")
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                        Log.d(TAG, "[engine:${msg.messageLevel().name}] ${msg.message()} @ ${msg.sourceId()}:${msg.lineNumber()}")
                        return true
                    }
                }

                // NovaFetchBridge: outbound networking for the engine (unchanged).
                addJavascriptInterface(NovaFetchBridge(this), "NovaFetchBridge")

                // NovaStateBridge: JS -> Kotlin tab/nav state pushes. Registering
                // this BEFORE loadUrl() is what makes isNativeHostPresent() true
                // when android-native-bridge.ts runs (it checks for this exact
                // global at page-mount time).
                addJavascriptInterface(
                    NovaStateBridge { json -> viewModel.applySnapshot(json) },
                    "NovaStateBridge"
                )

                viewModel.attachWebView(this)
                loadUrl(ENGINE_URL)
            }
        },
        update = { /* no-op: never reloaded or re-navigated by Compose recomposition */ }
    )
}
