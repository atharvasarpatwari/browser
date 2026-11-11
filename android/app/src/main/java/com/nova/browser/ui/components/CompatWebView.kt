package com.nova.browser.ui.components

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
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
import com.nova.browser.AdHosts
import com.nova.browser.BrowserViewModel

private const val TAG = "NovaCompat"

/**
 * The answer to a blocked request: no content, and a body that fails if it is read. Measured on
 * the tablet, a page's `fetch` still resolves with this answer (as it did with an empty 200 and
 * with a null body), so AdHosts.BLOCK_SCRIPT makes blocked fetches reject on the page side.
 */
private fun blockedResponse(): WebResourceResponse = WebResourceResponse(null, null, object : java.io.InputStream() {
    override fun read(): Int = throw java.io.IOException("Blocked by Nova")
    override fun read(b: ByteArray, off: Int, len: Int): Int = throw java.io.IOException("Blocked by Nova")
})

/**
 * Compatibility mode: the page is shown by Android's system WebView (Chromium) instead of Nova's
 * engine. Used for sites the engine can't run, such as Gmail and Google sign-in (CompatSites).
 * The address bar, back, reload, stop, downloads and file uploads drive this view while it is up;
 * a link to an ordinary site goes back to Nova's engine in the same tab.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CompatWebView(viewModel: BrowserViewModel, visible: Boolean, modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier,
        factory = { context ->
            WebView(context).apply {
                layoutParams = android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                )
                setBackgroundColor(android.graphics.Color.WHITE)
                settings.apply {
                    javaScriptEnabled = true
                    domStorageEnabled = true
                    databaseEnabled = true
                    allowFileAccess = false
                    builtInZoomControls = true
                    displayZoomControls = false
                    setSupportZoom(true)
                    loadWithOverviewMode = true
                    useWideViewPort = true
                    mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                    javaScriptCanOpenWindowsAutomatically = true
                    setSupportMultipleWindows(true)
                }
                // Google's sign-in sets cookies across its hosts; the WebView jar keeps them (flushed on pause).
                CookieManager.getInstance().setAcceptCookie(true)
                CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)

                fun push(url: String? = null, title: String? = null, progress: Int? = null) {
                    viewModel.onCompatState(url ?: this.url, title ?: this.title, progress, canGoBack())
                }

                // Blocked fetches reject in the page (every frame), before any of its scripts run.
                val documentStartBlock = androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.DOCUMENT_START_SCRIPT)
                if (documentStartBlock) androidx.webkit.WebViewCompat.addDocumentStartJavaScript(this, AdHosts.BLOCK_SCRIPT, setOf("*"))

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        val url = request.url.toString()
                        val scheme = request.url.scheme?.lowercase()
                        if (scheme != "http" && scheme != "https") {
                            // intent:, mailto:, tel:, market: … go to the app that handles them.
                            runCatching {
                                val intent = if (scheme == "intent") Intent.parseUri(url, Intent.URI_INTENT_SCHEME) else Intent(Intent.ACTION_VIEW, Uri.parse(url))
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                view.context.startActivity(intent)
                            }.onFailure { Log.w(TAG, "No app for $url") }
                            return true
                        }
                        if (!request.isForMainFrame || viewModel.staysInCompat(url, request.isRedirect)) return false
                        Log.i(TAG, "Leaving compatibility mode for $url")
                        viewModel.leaveCompatTo(url)
                        return true
                    }

                    /** Ad networks and trackers get an empty answer (Nova's engine blockers never see this view's requests); each is counted for the tab. */
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                        if (request.isForMainFrame) return null
                        val kind = AdHosts.classify(request.url.toString()) ?: return null
                        val what = if (kind == AdHosts.Kind.AD) "ad" else "tracker"
                        Log.i(TAG, "Blocked $what request: ${request.url.host}${request.url.path.orEmpty().take(60)}")
                        viewModel.recordCompatBlocked(kind)
                        return blockedResponse()
                    }

                    override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                        push(url = url, progress = 5)
                        // Old WebViews without document-start scripts: best effort, may run after the page's first scripts.
                        if (!documentStartBlock) view.evaluateJavascript(AdHosts.BLOCK_SCRIPT, null)
                    }
                    override fun onPageFinished(view: WebView, url: String?) {
                        push(url = url, progress = 100)
                        view.evaluateJavascript(AdHosts.HIDING_SCRIPT, null) // ad slots the site serves itself
                        viewModel.onCompatPageFinished(url, view.title)
                    }
                    override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                        push(url = url)
                        view.evaluateJavascript(AdHosts.HIDING_SCRIPT, null) // in-page navigation (Reddit, YouTube)
                    }

                    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                        Log.e(TAG, "Compatibility renderer gone (didCrash=${detail.didCrash()})")
                        viewModel.onCompatRendererGone()
                        return true
                    }
                }

                webChromeClient = object : WebChromeClient() {
                    /** The ad blocker's page script reports what it hid and skipped ("[nova-ad] …"). */
                    override fun onConsoleMessage(message: android.webkit.ConsoleMessage): Boolean {
                        val text = message.message()
                        if (text.startsWith("[nova-ad]")) Log.i(TAG, text)
                        return super.onConsoleMessage(message)
                    }

                    override fun onProgressChanged(view: WebView, newProgress: Int) { push(progress = newProgress) }
                    override fun onReceivedTitle(view: WebView, title: String?) { push(title = title) }

                    override fun onShowFileChooser(webView: WebView, filePathCallback: ValueCallback<Array<Uri>>, fileChooserParams: FileChooserParams): Boolean {
                        viewModel.openFileChooser(filePathCallback)
                        return true
                    }

                    override fun onPermissionRequest(request: android.webkit.PermissionRequest) {
                        viewModel.onPermissionRequested(request)
                    }

                    override fun onGeolocationPermissionsShowPrompt(origin: String, callback: android.webkit.GeolocationPermissions.Callback) {
                        viewModel.onGeolocationRequested(origin, callback)
                    }

                    /** window.open (Gmail's "open in new window", sign-in popups): load it in this view. */
                    override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message): Boolean {
                        val transport = WebView(view.context).apply {
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                                    val target = request.url.toString()
                                    if (viewModel.staysInCompat(target, false)) view.loadUrl(target) else viewModel.openInNewTab(target)
                                    return true
                                }
                            }
                        }
                        (resultMsg.obj as? WebView.WebViewTransport)?.webView = transport
                        resultMsg.sendToTarget()
                        return true
                    }
                }

                setFindListener { activeMatchOrdinal, numberOfMatches, isDoneCounting ->
                    if (isDoneCounting) viewModel.onCompatFindResult(activeMatchOrdinal, numberOfMatches)
                }

                setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
                    Log.i(TAG, "Download: $url ($contentDisposition)")
                    viewModel.startCompatDownload(url, contentDisposition, mimeType, userAgent)
                }

                viewModel.attachCompatView(this)
            }
        },
        // The ViewModel drives navigation (loadUrl/goBack/reload) directly. Off its tab the view is
        // zero-size *and* invisible: the system WebView can draw into its own surface layer, and a
        // zero-size view left its last frame (Gmail) on top of the other tab's page.
        update = { it.visibility = if (visible) android.view.View.VISIBLE else android.view.View.INVISIBLE },
        // Leaving compatibility mode removes the view: destroy it, or every Gmail visit leaks a WebView.
        onRelease = { view ->
            viewModel.detachCompatView(view)
            runCatching { view.stopLoading(); view.destroy() }
        },
    )
}
