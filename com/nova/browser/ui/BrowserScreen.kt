package com.nova.browser.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.LibraryBooks
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nova.browser.BrowserViewModel
import com.nova.browser.ui.components.AddressBar
import com.nova.browser.ui.components.ContextMenuSheet
import com.nova.browser.ui.components.DownloadsSheet
import com.nova.browser.ui.components.EngineWebView
import com.nova.browser.ui.components.ErrorPage
import com.nova.browser.ui.components.LibrarySheet
import com.nova.browser.ui.components.TabsBar

@Composable
fun BrowserScreen(viewModel: BrowserViewModel = viewModel()) {
    var showLibrary by remember { mutableStateOf(false) }
    var showDownloads by remember { mutableStateOf(false) }
    val activeTab = viewModel.activeTab
    val context = LocalContext.current

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

    fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    BackHandler(enabled = viewModel.canGoBack.value) {
        viewModel.goBack()
    }

    Scaffold(
        topBar = {
            Column {
                TabsBar(
                    tabs = viewModel.tabs,
                    activeTabId = viewModel.activeTabId.value ?: "",
                    incognito = viewModel.incognito.value,
                    onToggleIncognito = { viewModel.setIncognito(!viewModel.incognito.value) },
                    onSelect = viewModel::selectTab,
                    onClose = viewModel::closeTab,
                    onNewTab = { viewModel.newTab() }
                )
                AddressBar(
                    text = viewModel.addressBarText.value,
                    onTextChange = { /* draft state is handled locally inside AddressBar */ },
                    onSubmit = { input -> viewModel.navigate(input) },
                    isLoading = activeTab?.loading ?: false,
                    isSecure = viewModel.addressBarText.value.startsWith("https://"),
                    isBookmarked = viewModel.isBookmarked(activeTab?.url ?: ""),
                    onReload = { viewModel.reload() },
                    onStop = { viewModel.stop() },
                    onToggleBookmark = { viewModel.toggleBookmark() },
                    onCopyUrl = {
                        activeTab?.let { viewModel.copyToClipboard("URL", it.url) }
                    },
                    onShareUrl = {
                        activeTab?.let { viewModel.shareUrl(it.title, it.url) }
                    }
                )
            }
        },
        bottomBar = {
            BottomAppBar(actions = {
                IconButton(onClick = { viewModel.goBack() }, enabled = viewModel.canGoBack.value) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                IconButton(onClick = { viewModel.goForward() }, enabled = viewModel.canGoForward.value) {
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = "Forward")
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = {
                    showDownloads = true
                    requestNotificationPermissionIfNeeded()
                }) {
                    Icon(Icons.Filled.Download, contentDescription = "Downloads")
                }
                IconButton(onClick = { showLibrary = true }) {
                    Icon(Icons.Filled.LibraryBooks, contentDescription = "Bookmarks & History")
                }
            })
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Mounted exactly once for the app's lifetime — the engine owns all
            // tabs internally, so there is no per-tab WebView to switch between.
            EngineWebView(viewModel = viewModel, modifier = Modifier.fillMaxSize())
            activeTab?.error?.let { error ->
                ErrorPage(error = error, onRetry = { viewModel.reload() })
            }
        }
    }

    if (showDownloads) {
        DownloadsSheet(
            downloads = viewModel.downloads,
            onOpen = { viewModel.openDownload(it) },
            onShare = { viewModel.shareDownload(it) },
            onPause = viewModel::pauseDownload,
            onResume = viewModel::resumeDownload,
            onCancel = viewModel::cancelDownload,
            onRemove = viewModel::removeDownload,
            onClearCompleted = viewModel::clearCompletedDownloads,
            onDismiss = { showDownloads = false }
        )
    }

    if (showLibrary) {
        LibrarySheet(
            bookmarks = viewModel.bookmarks,
            history = viewModel.history,
            onOpen = { url ->
                viewModel.navigate(url)
                showLibrary = false
            },
            onRemoveBookmark = viewModel::removeBookmark,
            onRemoveHistory = viewModel::removeHistoryEntry,
            onClearHistory = viewModel::clearHistory,
            onDismiss = { showLibrary = false }
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
