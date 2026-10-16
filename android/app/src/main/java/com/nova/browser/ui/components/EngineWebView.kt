package com.nova.browser.ui.components

import android.annotation.SuppressLint
import android.net.Uri
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewFeature
import com.nova.browser.BrowserViewModel
import com.nova.browser.NovaCookiesBridge
import com.nova.browser.NovaFetchBridge
import com.nova.browser.NovaStateBridge

private const val TAG = "NovaEngine"
private const val ENGINE_URL = "https://appassets.androidplatform.net/index.html"

/**
 * Hosts the Nova engine in a single WebView. It is created once (factory{} only
 * runs on first composition) and rebuilt only if the renderer process dies
 * (BrowserScreen keys this on viewModel.engineGeneration). The engine owns all tabs
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
                // The engine paints real page content (its own canvas, real-world
                // colors) — Android's automatic WebView dark-mode inversion must
                // never touch it, or a light page renders as an inverted black
                // frame (this is exactly what produced the "blank black screen"
                // bug: an unstyled/just-booted WebView plus a system dark theme
                // triggers algorithmic darkening on a WebView that never opted
                // out). White here is also the correct base color for a browser
                // engine's blank/loading state regardless of app theme, since
                // web content assumes a white canvas unless it says otherwise.
                setBackgroundColor(android.graphics.Color.WHITE)

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

                    // Disable both dark-mode mechanisms Android WebView has used
                    // across API levels — force-dark (pre-13) and algorithmic
                    // darkening (13+) — guarded so this is a no-op on WebView
                    // builds that predate either feature rather than crashing.
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                        WebSettingsCompat.setAlgorithmicDarkeningAllowed(this, false)
                    }
                    @Suppress("DEPRECATION")
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
                        WebSettingsCompat.setForceDark(this, WebSettingsCompat.FORCE_DARK_OFF)
                    }
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

                    /**
                     * Without this, a renderer crash or low-memory kill takes the whole
                     * app down with it. Returning true keeps the app alive; the ViewModel
                     * then swaps in a fresh WebView.
                     */
                    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                        Log.e(TAG, "Renderer gone (didCrash=${detail.didCrash()}); rebuilding engine WebView")
                        viewModel.onRendererGone()
                        return true
                    }

                    override fun onPageFinished(view: WebView, url: String?) {
                        super.onPageFinished(view, url)
                        Log.i(TAG, "onPageFinished: $url")
                    }

                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError
                    ) {
                        super.onReceivedError(view, request, error)
                        Log.e(TAG, "WebView error ${error.errorCode}: ${error.description} @ ${request.url}")
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
                     * Camera/mic/midi requests from page JS. Capture resources go through
                     * an Android runtime-permission dialog (BrowserScreen) and only the
                     * granted ones are passed to the page.
                     */
                    override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                        Log.i(TAG, "onPermissionRequest: ${request.resources.joinToString()}")
                        viewModel.onPermissionRequested(request)
                    }

                    /**
                     * Geolocation prompt. WebView only returns a position when the app holds
                     * the location runtime permission, so ask for it (no dialog if already held).
                     */
                    override fun onGeolocationPermissionsShowPrompt(
                        origin: String,
                        callback: android.webkit.GeolocationPermissions.Callback
                    ) {
                        Log.i(TAG, "onGeolocationPermissionsShowPrompt origin=$origin")
                        viewModel.onGeolocationRequested(origin, callback)
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

                // NovaCookies: document.cookie for engine pages (main.ts installCookies),
                // backed by the same native jar HttpURLConnection uses. HttpOnly stays hidden.
                addJavascriptInterface(NovaCookiesBridge(viewModel.cookies), "NovaCookies")

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
