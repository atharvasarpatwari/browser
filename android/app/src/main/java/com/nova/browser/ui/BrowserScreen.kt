package com.nova.browser.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nova.browser.BrowserViewModel
import com.nova.browser.ui.components.*

private enum class Overlay { NONE, TABS, SETTINGS }

@Composable
fun BrowserScreen(viewModel: BrowserViewModel = viewModel()) {
    var overlay by remember { mutableStateOf(Overlay.NONE) }
    var libraryTab by remember { mutableStateOf<LibraryTab?>(null) }
    var showDownloads by remember { mutableStateOf(false) }
    val activeTab = viewModel.activeTab
    val context = LocalContext.current
    val onNewTabPage = activeTab == null || (activeTab.error == null && viewModel.isNewTabUrl(activeTab.url))

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

    // Runtime-permission grant for page camera/microphone/location requests.
    val webPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result -> viewModel.resolvePermissionAsk(result) }

    LaunchedEffect(viewModel.permissionAsk.value) {
        val ask = viewModel.permissionAsk.value ?: return@LaunchedEffect
        webPermissionLauncher.launch(ask.permissions)
    }

    fun openDownloads() {
        showDownloads = true
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
            if (!granted) notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun openShortcut(s: NewTabShortcut) = when (s) {
        NewTabShortcut.BOOKMARKS -> libraryTab = LibraryTab.BOOKMARKS
        NewTabShortcut.HISTORY -> libraryTab = LibraryTab.HISTORY
        NewTabShortcut.DOWNLOADS -> openDownloads()
        NewTabShortcut.SETTINGS -> overlay = Overlay.SETTINGS
    }

    BackHandler(enabled = overlay == Overlay.NONE && viewModel.canGoBack.value) {
        viewModel.goBack()
    }

    Box(Modifier.fillMaxSize()) {
        Scaffold(
            bottomBar = {
              Column {
                viewModel.findState.value?.let { find ->
                    FindBar(
                        state = find,
                        onQuery = viewModel::find,
                        onNext = viewModel::findNext,
                        onPrevious = viewModel::findPrevious,
                        onClose = viewModel::closeFind,
                    )
                }
                BottomChrome(
                    url = activeTab?.url ?: "",
                    showUrl = !onNewTabPage,
                    isLoading = activeTab?.loading ?: false,
                    incognito = viewModel.incognito.value,
                    tabCount = viewModel.tabs.size,
                    canGoBack = viewModel.canGoBack.value,
                    onBack = { viewModel.goBack() },
                    onSubmit = { viewModel.navigate(it) },
                    onReload = { viewModel.reload() },
                    onStop = { viewModel.stop() },
                    onShowTabs = { overlay = Overlay.TABS },
                    menuContent = { close ->
                        MenuEntry("Forward", Icons.AutoMirrored.Filled.ArrowForward, enabled = viewModel.canGoForward.value) { close(); viewModel.goForward() }
                        MenuEntry("New tab", Icons.Filled.Add) { close(); viewModel.setIncognito(false); viewModel.newTab() }
                        MenuEntry("New incognito tab", Icons.Filled.VisibilityOff) { close(); viewModel.setIncognito(true); viewModel.newTab() }
                        if (!onNewTabPage && activeTab != null) {
                            val bookmarked = viewModel.isBookmarked(activeTab.url)
                            MenuEntry(if (bookmarked) "Remove bookmark" else "Add bookmark", if (bookmarked) Icons.Filled.Star else Icons.Filled.StarBorder) {
                                close(); viewModel.toggleBookmark()
                            }
                        }
                        HorizontalDivider()
                        MenuEntry("Bookmarks", Icons.Filled.Star) { close(); libraryTab = LibraryTab.BOOKMARKS }
                        MenuEntry("History", Icons.Filled.History) { close(); libraryTab = LibraryTab.HISTORY }
                        MenuEntry("Downloads", Icons.Filled.Download) { close(); openDownloads() }
                        if (!onNewTabPage && activeTab != null) {
                            HorizontalDivider()
                            MenuEntry("Find in page", Icons.Filled.Search) { close(); viewModel.openFind() }
                            MenuEntry("Share page", Icons.Filled.Share) { close(); viewModel.shareUrl(activeTab.title, activeTab.url) }
                            MenuEntry("Copy link", Icons.Filled.ContentCopy) { close(); viewModel.copyToClipboard("URL", activeTab.url) }
                        }
                        HorizontalDivider()
                        MenuEntry("Settings", Icons.Filled.Settings) { close(); overlay = Overlay.SETTINGS }
                    },
                )
              }
            },
        ) { padding ->
            Box(modifier = Modifier.padding(padding).fillMaxSize()) {
                // One WebView for all tabs (the engine owns them internally); rebuilt
                // only after a renderer crash (BrowserViewModel.onRendererGone).
                key(viewModel.engineGeneration.value) {
                    EngineWebView(viewModel = viewModel, modifier = Modifier.fillMaxSize())
                }
                if (onNewTabPage) {
                    NewTabPage(
                        history = viewModel.history,
                        incognito = viewModel.incognito.value,
                        onSubmit = { viewModel.navigate(it) },
                        onOpen = { viewModel.navigate(it) },
                        onShortcut = ::openShortcut,
                    )
                }
                activeTab?.error?.let { error ->
                    ErrorPage(error = error, onRetry = { viewModel.reload() })
                }
            }
        }

        when (overlay) {
            Overlay.TABS -> TabSwitcher(
                tabs = viewModel.tabs,
                activeTabId = viewModel.activeTabId.value,
                incognito = viewModel.incognito.value,
                onSelect = viewModel::selectTab,
                onClose = viewModel::closeTab,
                onNewTab = { viewModel.newTab() },
                onSetIncognito = viewModel::setIncognito,
                onDismiss = { overlay = Overlay.NONE },
            )
            Overlay.SETTINGS -> SettingsScreen(
                searchEngine = viewModel.searchEngine.value,
                onSearchEngine = viewModel::setSearchEngine,
                onClearData = viewModel::clearBrowsingData,
                version = viewModel.appVersion,
                onDismiss = { overlay = Overlay.NONE },
            )
            Overlay.NONE -> Unit
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

    libraryTab?.let { initial ->
        LibrarySheet(
            bookmarks = viewModel.bookmarks,
            history = viewModel.history,
            onOpen = { url ->
                viewModel.navigate(url)
                libraryTab = null
            },
            onRemoveBookmark = viewModel::removeBookmark,
            onRemoveHistory = viewModel::removeHistoryEntry,
            onClearHistory = viewModel::clearHistory,
            onDismiss = { libraryTab = null },
            initialTab = initial,
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

@Composable
private fun MenuEntry(label: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Icon(icon, contentDescription = null) },
        enabled = enabled,
        onClick = onClick,
    )
}
