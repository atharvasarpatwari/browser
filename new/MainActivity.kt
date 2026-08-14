package com.nova.browser

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.nova.browser.ui.BrowserScreen
import com.nova.browser.ui.theme.NovaBrowserTheme

/**
 * Hybrid entry point: native Compose chrome (address bar, tab strip,
 * bookmarks/history) driving a single instance of the real Nova web engine,
 * hosted in one WebView for the app's lifetime (EngineWebView.kt).
 *
 * The engine parses/renders pages and owns all tab/navigation state itself;
 * this Activity's only jobs are (1) mount the Compose UI, (2) let the
 * ViewModel dispatch native actions into the engine via evaluateJavascript,
 * and (3) receive engine state pushes back via NovaStateBridge.
 */
class MainActivity : ComponentActivity() {

    private val viewModel: BrowserViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WebView.setWebContentsDebuggingEnabled(true)

        setContent {
            NovaBrowserTheme {
                BrowserScreen(viewModel = viewModel)
            }
        }
    }

    override fun onBackPressed() {
        if (viewModel.canGoBack.value) {
            viewModel.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        viewModel.releaseWebView()
    }
}
