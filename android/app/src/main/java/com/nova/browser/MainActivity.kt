package com.nova.browser

import android.annotation.SuppressLint
import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Hosts the real Nova web engine.
 *
 * The Vite-built engine (dist/ → android/app/src/main/assets/web/) is served
 * from the secure appassets.androidplatform.net origin via WebViewAssetLoader
 * so its ES modules load correctly.  The engine drives everything itself —
 * it parses/renders pages to a canvas and manages its own tabs, history,
 * JS runtime, and networking (routed through NovaFetchBridge).  The system
 * WebView is only the JS host; it never navigates to page URLs.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(true)
        Log.i(TAG, "MainActivity starting; DEBUG=$ENGINE_URL")

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this).apply {
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

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    Log.i(TAG, "onPageStarted: $url")
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

                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    if (newProgress >= 100) Log.i(TAG, "Engine page finished loading")
                }
            }

            addJavascriptInterface(NovaFetchBridge(this), "NovaFetchBridge")

            loadUrl(ENGINE_URL)
        }

        setContentView(webView)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        webView.destroy()
    }

    private companion object {
        const val TAG = "NovaEngine"
        const val ENGINE_URL = "https://appassets.androidplatform.net/index.html"
    }
}
