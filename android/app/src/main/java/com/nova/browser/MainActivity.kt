package com.nova.browser

import android.content.ComponentCallbacks2
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import com.nova.browser.ui.BrowserScreen
import com.nova.browser.ui.theme.NovaBrowserTheme

/**
 * Entry point for a single instance of the real Nova web engine, hosted in
 * one WebView for the app's lifetime (EngineWebView.kt). The engine renders
 * its own chrome full-screen — the same toolbar/tab-strip/address-bar/
 * bookmark-bar desktop uses (forceDesktopChrome, see browser-window.ts) —
 * and owns all tab/navigation state itself; this Activity's Compose tree
 * (BrowserScreen) just hosts the WebView and wires the handful of things a
 * web page can't do itself on Android (real downloads, permission grants,
 * file chooser, a long-press content menu) via NovaStateBridge.
 *
 * Back navigation is handled by Compose's BackHandler in BrowserScreen, so no
 * onBackPressed() override is needed here.
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

    override fun onPause() {
        super.onPause()
        viewModel.pause()
    }

    override fun onResume() {
        super.onResume()
        viewModel.resume()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE) {
            viewModel.trimMemory()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        viewModel.releaseWebView()
    }
}
