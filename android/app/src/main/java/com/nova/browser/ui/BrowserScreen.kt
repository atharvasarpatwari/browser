package com.nova.browser.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.LibraryBooks
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.nova.browser.BrowserViewModel
import com.nova.browser.ui.components.AddressBar
import com.nova.browser.ui.components.LibrarySheet
import com.nova.browser.ui.components.TabsBar
import com.nova.browser.webview.BrowserWebView
import com.nova.browser.webview.WebViewHandle

@Composable
fun BrowserScreen(viewModel: BrowserViewModel = viewModel()) {
    val activeTab = viewModel.activeTab
    var showLibrary by remember { mutableStateOf(false) }

    // One WebViewHandle per tab id, so switching tabs doesn't lose each WebView's own state.
    val handles = remember { mutableStateMapOf<String, WebViewHandle>() }
    fun handleFor(id: String) = handles.getOrPut(id) { WebViewHandle() }

    BackHandler(enabled = activeTab.canGoBack) {
        handleFor(activeTab.id).goBack()
    }

    Scaffold(
        topBar = {
            Column {
                TabsBar(
                    tabs = viewModel.tabs,
                    activeTabId = viewModel.activeTabId.value,
                    onSelect = viewModel::selectTab,
                    onClose = viewModel::closeTab,
                    onNewTab = { viewModel.newTab() }
                )
                AddressBar(
                    text = viewModel.addressBarText.value,
                    onTextChange = { viewModel.addressBarText.value = it },
                    onSubmit = { input ->
                        val url = viewModel.resolveInput(input)
                        viewModel.addressBarText.value = url
                        handleFor(activeTab.id).loadUrl(url)
                    },
                    isLoading = activeTab.isLoading,
                    progress = activeTab.progress,
                    isSecure = activeTab.url.startsWith("https://"),
                    isBookmarked = viewModel.isBookmarked(activeTab.url),
                    onReload = { handleFor(activeTab.id).reload() },
                    onStop = { handleFor(activeTab.id).stop() },
                    onToggleBookmark = { viewModel.toggleBookmark() }
                )
            }
        },
        bottomBar = {
            BottomAppBar(actions = {
                IconButton(onClick = { handleFor(activeTab.id).goBack() }, enabled = activeTab.canGoBack) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                }
                IconButton(onClick = { handleFor(activeTab.id).goForward() }, enabled = activeTab.canGoForward) {
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = "Forward")
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { showLibrary = true }) {
                    Icon(Icons.Filled.LibraryBooks, contentDescription = "Bookmarks & History")
                }
            })
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            // Only the active tab's WebView is composed. Switching tabs reloads the
            // page for the newly-selected tab; each tab still keeps its own URL,
            // title, and nav-history state in the ViewModel across switches.
            key(activeTab.id) {
                BrowserWebView(
                    tab = activeTab,
                    handle = handleFor(activeTab.id),
                    modifier = Modifier.fillMaxSize(),
                    onPageStarted = { url -> viewModel.onPageStarted(activeTab.id, url) },
                    onProgressChanged = { p -> viewModel.onProgressChanged(activeTab.id, p) },
                    onPageFinished = { url, title, back, fwd ->
                        viewModel.onPageFinished(activeTab.id, url, title, back, fwd)
                    },
                    onFaviconReceived = { bmp -> viewModel.onFaviconReceived(activeTab.id, bmp) },
                    onNewTabRequested = { url -> viewModel.newTab(url) }
                )
            }
        }
    }

    if (showLibrary) {
        LibrarySheet(
            bookmarks = viewModel.bookmarks,
            history = viewModel.history,
            onOpen = { url ->
                viewModel.addressBarText.value = url
                handleFor(activeTab.id).loadUrl(url)
                showLibrary = false
            },
            onRemoveBookmark = viewModel::removeBookmark,
            onClearHistory = viewModel::clearHistory,
            onDismiss = { showLibrary = false }
        )
    }
}
