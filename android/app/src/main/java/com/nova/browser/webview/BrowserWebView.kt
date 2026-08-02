package com.nova.browser.webview

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.nova.browser.model.Tab

/**
 * A per-tab reference to the underlying Android WebView so toolbar actions
 * (back / forward / reload / navigate) can be driven from outside Compose.
 */
class WebViewHandle {
    var webView: WebView? = null
        internal set

    fun goBack() = webView?.takeIf { it.canGoBack() }?.goBack()
    fun goForward() = webView?.takeIf { it.canGoForward() }?.goForward()
    fun reload() = webView?.reload()
    fun stop() = webView?.stopLoading()
    fun loadUrl(url: String) = webView?.loadUrl(url)
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserWebView(
    tab: Tab,
    handle: WebViewHandle,
    modifier: Modifier = Modifier,
    onPageStarted: (String) -> Unit,
    onProgressChanged: (Int) -> Unit,
    onPageFinished: (url: String, title: String?, canGoBack: Boolean, canGoForward: Boolean) -> Unit,
    onFaviconReceived: (Bitmap?) -> Unit,
    onNewTabRequested: (String) -> Unit
) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                settings.setSupportZoom(true)
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                settings.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
                settings.mediaPlaybackRequiresUserGesture = true

                webViewClient = object : WebViewClient() {
                    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                        onPageStarted(url)
                    }

                    override fun onPageFinished(view: WebView, url: String) {
                        onPageFinished(url, view.title, view.canGoBack(), view.canGoForward())
                    }

                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: android.webkit.WebResourceRequest
                    ): Boolean {
                        // Keep normal http/https navigation inside this WebView.
                        val scheme = request.url.scheme
                        return if (scheme == "http" || scheme == "https") {
                            false
                        } else {
                            true // let the system handle unsupported schemes (mailto:, tel:, intent:, etc.)
                        }
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    override fun onProgressChanged(view: WebView, newProgress: Int) {
                        onProgressChanged(newProgress)
                    }

                    override fun onReceivedIcon(view: WebView, icon: Bitmap?) {
                        onFaviconReceived(icon)
                    }

                    override fun onCreateWindow(
                        view: WebView,
                        isDialog: Boolean,
                        isUserGesture: Boolean,
                        resultMsg: android.os.Message
                    ): Boolean {
                        // window.open() / target=_blank -> open in a fresh app tab.
                        val href = view.hitTestResult.extra
                        if (href != null) onNewTabRequested(href)
                        return false
                    }
                }

                loadUrl(tab.url)
                handle.webView = this
            }
        },
        update = { webView ->
            handle.webView = webView
        }
    )
}
