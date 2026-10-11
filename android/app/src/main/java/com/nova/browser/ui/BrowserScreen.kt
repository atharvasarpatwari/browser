package com.nova.browser.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nova.browser.BrowserViewModel
import com.nova.browser.ui.components.ContextMenuSheet
import com.nova.browser.ui.components.DownloadsSheet
import com.nova.browser.ui.components.EngineWebView
import com.nova.browser.ui.components.ErrorPage

/**
 * The engine's own chrome (toolbar/tab-strip/address-bar/bookmark-bar/status-bar
 * — the same code and look desktop uses, see forceDesktopChrome in
 * browser-window.ts) renders full-screen inside the WebView. This Activity's
 * Compose tree no longer duplicates any of that: it hosts the WebView, and
 * wires the handful of things a web page genuinely can't do itself on
 * Android — real file downloads (native DownloadManager, via NativeDownloader),
 * a long-press content menu (canvas-rendered pages have no native
 * HitTestResult), file chooser and runtime-permission grants for page JS.
 * The web chrome's own hamburger menu reaches Downloads/Incognito through
 * NovaStateBridge for exactly this reason — see android-native-bridge.ts.
 */
@Composable
fun BrowserScreen(viewModel: BrowserViewModel = viewModel()) {
    val activeTab = viewModel.activeTab
    val context = LocalContext.current
    val downloadsRequested by viewModel.downloadsRequested

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* Notifications are best-effort; downloads still complete without them. */ }

    // File picker for <input type=file> uploads. onShowFileChooser stashes the
    // WebView's callback in the ViewModel; this effect launches the document
    // picker, and the result resolves the pending callback (or null on cancel).
    val fileChooserLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> viewModel.onFileChosen(uri) }

    LaunchedEffect(viewModel.isFileChooserPending.value) {
        if (viewModel.isFileChooserPending.value) {
            fileChooserLauncher.launch(arrayOf("*/*"))
        }
    }

    // Runtime-permission grant for WebView onPermissionRequest flows
    // (camera/microphone from page JS).
    val webPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> viewModel.resolvePermissionRequest(granted) }

    LaunchedEffect(viewModel.permissionRequest.value) {
        val request = viewModel.permissionRequest.value ?: return@LaunchedEffect
        val needed = viewModel.androidPermissionFor(request)
        if (needed != null) {
            webPermissionLauncher.launch(needed)
        } else {
            viewModel.resolvePermissionRequest(true)
        }
    }

    LaunchedEffect(downloadsRequested) {
        if (downloadsRequested) {
            if (Build.VERSION.SDK_INT >= 33) {
                val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    BackHandler(enabled = viewModel.canGoBack.value) {
        viewModel.goBack()
    }

    Scaffold { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Mounted exactly once for the app's lifetime — the engine owns all
            // tabs internally, so there is no per-tab WebView to switch between.
            EngineWebView(viewModel = viewModel, modifier = Modifier.fillMaxSize())
            activeTab?.error?.let { error ->
                ErrorPage(error = error, onRetry = { viewModel.reload() })
            }
        }
    }

    if (downloadsRequested) {
        DownloadsSheet(
            downloads = viewModel.downloads,
            onOpen = { viewModel.openDownload(it) },
            onShare = { viewModel.shareDownload(it) },
            onPause = viewModel::pauseDownload,
            onResume = viewModel::resumeDownload,
            onCancel = viewModel::cancelDownload,
            onRemove = viewModel::removeDownload,
            onClearCompleted = viewModel::clearCompletedDownloads,
            onDismiss = { viewModel.clearDownloadsRequest() }
        )
    }

    val contextMenuTarget = viewModel.contextMenu.value
    if (contextMenuTarget != null) {
        ContextMenuSheet(
            target = contextMenuTarget,
            onOpenInNewTab = { url ->
                viewModel.openInNewTab(url)
                viewModel.dismissContextMenu()
            },
            onNavigate = { url ->
                viewModel.navigate(url)
                viewModel.dismissContextMenu()
            },
            onSaveImage = { url, alt ->
                viewModel.saveImage(url, alt)
                viewModel.dismissContextMenu()
            },
            onCopy = { label, text ->
                viewModel.copyToClipboard(label, text)
                viewModel.dismissContextMenu()
            },
            onShare = { title, url ->
                viewModel.shareUrl(title, url)
                viewModel.dismissContextMenu()
            },
            onDismiss = { viewModel.dismissContextMenu() }
        )
    }
}
