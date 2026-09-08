package com.nova.browser.ui.components

import android.annotation.SuppressLint
import android.net.Uri
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
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
                    setSupportMultipleWindows(true)
                    setGeolocationEnabled(true)
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

                    /**
                     * <input type=file> — hand the callback to the ViewModel, which
                     * surfaces it as an OpenDocument launcher in BrowserScreen.
                     */
                    override fun onShowFileChooser(
                        webView: WebView,
                        filePathCallback: ValueCallback<Array<Uri>>,
                        fileChooserParams: FileChooserParams
                    ): Boolean {
                        Log.i(TAG, "onShowFileChooser mode=${fileChooserParams.mode}")
                        viewModel.openFileChooser(filePathCallback)
                        return true
                    }

                    /**
                     * Camera/mic/midi/permission requests from page JS. Requests that
                     * need a runtime grant surface an Android permission dialog via
                     * BrowserScreen; the grant result resolves this request.
                     */
                    override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                        val needed = viewModel.androidPermissionFor(request)
                        if (needed == null) {
                            Log.i(TAG, "onPermissionRequest auto-grant: ${request.resources.joinToString()}")
                            request.grant(request.resources)
                        } else {
                            Log.i(TAG, "onPermissionRequest waiting for runtime grant: $needed")
                            viewModel.onPermissionRequested(request)
                        }
                    }

                    /**
                     * Geolocation prompt — auto-grant: the engine resolves coordinates
                     * in-process (its own Geolocation shim), so there is no separate
                     * origin to gate; an explicit runtime permission (if ever needed)
                     * is handled by onPermissionRequest.
                     */
                    override fun onGeolocationPermissionsShowPrompt(
                        origin: String,
                        callback: android.webkit.GeolocationPermissions.Callback
                    ) {
                        Log.i(TAG, "onGeolocationPermissionsShowPrompt origin=$origin (auto-grant)")
                        callback.invoke(origin, true, false)
                    }

                    /**
                     * window.open()/target=_blank at the WebView level. The engine owns
                     * tabs, so instead of rendering a real popup we spin up a blank
                     * transport view whose navigations are swallowed and forwarded to
                     * the engine as a new tab (openInNewTab -> createTab).
                     */
                    override fun onCreateWindow(
                        view: WebView,
                        isDialog: Boolean,
                        isUserGesture: Boolean,
                        resultMsg: android.os.Message
                    ): Boolean {
                        Log.i(TAG, "onCreateWindow requested (userGesture=$isUserGesture) -> engine tab")
                        val popup = WebView(view.context).apply {
                            settings.javaScriptEnabled = false
                            webChromeClient = object : WebChromeClient() {}
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(
                                    v: WebView,
                                    request: WebResourceRequest
                                ): Boolean {
                                    val url = request.url.toString()
                                    Log.i(TAG, "Popup navigation forwarded to engine tab: $url")
                                    viewModel.openInNewTab(url)
                                    return true
                                }
                            }
                        }
                        (resultMsg.obj as? WebView.WebViewTransport)?.webView = popup
                        resultMsg.sendToTarget()
                        return true
                    }
                }

                // NovaFetchBridge: outbound networking for the engine (unchanged).
                // Attachment responses (Content-Disposition) hand off to the
                // native downloader instead of being buffered into JS memory.
                addJavascriptInterface(NovaFetchBridge(this, viewModel.nativeDownloader), "NovaFetchBridge")

                // NovaStateBridge: JS -> Kotlin tab/nav state pushes. Registering
                // this BEFORE loadUrl() is what makes isNativeHostPresent() true
                // when android-native-bridge.ts runs (it checks for this exact
                // global at page-mount time).
                addJavascriptInterface(
                    NovaStateBridge(
                        onSnapshot = { json -> viewModel.applySnapshot(json) },
                        onBookmarks = { json -> viewModel.applyBookmarksSnapshot(json) },
                        onHistory = { json -> viewModel.applyHistorySnapshot(json) },
                        onDownloadRequest = { json -> viewModel.startDownloadFromBridge(json) },
                        onContextMenu = { json -> viewModel.onContextMenuRequested(json) }
                    ),
                    "NovaStateBridge"
                )

                // DownloadListener: safety net for WebView-level attachment
                // navigations that never pass through NovaFetchBridge. In this
                // architecture all page content flows through the engine's fetch
                // shim, so this is a backstop, not the primary path.
                setDownloadListener { url, _, contentDisposition, mimeType, _ ->
                    Log.i(TAG, "DownloadListener: $url ($contentDisposition)")
                    viewModel.startDownloadFromDisposition(url, contentDisposition, mimeType)
                }

                viewModel.attachWebView(this)
                loadUrl(ENGINE_URL)
            }
        },
        update = { /* no-op: never reloaded or re-navigated by Compose recomposition */ }
    )
}
