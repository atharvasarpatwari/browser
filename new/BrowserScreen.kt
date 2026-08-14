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
import com.nova.browser.ui.components.EngineWebView
import com.nova.browser.ui.components.LibrarySheet
import com.nova.browser.ui.components.TabsBar

@Composable
fun BrowserScreen(viewModel: BrowserViewModel = viewModel()) {
    var showLibrary by remember { mutableStateOf(false) }
    val activeTab = viewModel.activeTab

    BackHandler(enabled = viewModel.canGoBack.value) {
        viewModel.goBack()
    }

    Scaffold(
        topBar = {
            Column {
                TabsBar(
                    tabs = viewModel.tabs,
                    activeTabId = viewModel.activeTabId.value ?: "",
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
                    onToggleBookmark = { viewModel.toggleBookmark() }
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
        }
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
            onClearHistory = viewModel::clearHistory,
            onDismiss = { showLibrary = false }
        )
    }
}
