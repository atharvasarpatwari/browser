package com.nova.browser.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.Bookmark
import com.nova.browser.model.HistoryEntry

private enum class LibraryTab { BOOKMARKS, HISTORY }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LibrarySheet(
    bookmarks: List<Bookmark>,
    history: List<HistoryEntry>,
    onOpen: (String) -> Unit,
    onRemoveBookmark: (String) -> Unit,
    onClearHistory: () -> Unit,
    onDismiss: () -> Unit
) {
    var tab by remember { mutableStateOf(LibraryTab.BOOKMARKS) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        TabRow(selectedTabIndex = tab.ordinal) {
            Tab(
                selected = tab == LibraryTab.BOOKMARKS,
                onClick = { tab = LibraryTab.BOOKMARKS },
                text = { Text("Bookmarks") },
                icon = { Icon(Icons.Filled.Star, contentDescription = null) }
            )
            Tab(
                selected = tab == LibraryTab.HISTORY,
                onClick = { tab = LibraryTab.HISTORY },
                text = { Text("History") },
                icon = { Icon(Icons.Filled.History, contentDescription = null) }
            )
        }

        Box(modifier = Modifier.heightIn(min = 200.dp, max = 480.dp)) {
            when (tab) {
                LibraryTab.BOOKMARKS -> BookmarksList(bookmarks, onOpen, onRemoveBookmark)
                LibraryTab.HISTORY -> HistoryList(history, onOpen, onClearHistory)
            }
        }

        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun BookmarksList(
    bookmarks: List<Bookmark>,
    onOpen: (String) -> Unit,
    onRemove: (String) -> Unit
) {
    if (bookmarks.isEmpty()) {
        EmptyState(text = "No bookmarks yet. Tap the star icon to save a page.")
        return
    }
    LazyColumn {
        items(bookmarks, key = { it.id }) { bookmark ->
            ListItem(
                headlineContent = { Text(bookmark.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                supportingContent = { Text(bookmark.url, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                trailingContent = {
                    IconButton(onClick = { onRemove(bookmark.id) }) {
                        Icon(Icons.Filled.Delete, contentDescription = "Remove bookmark")
                    }
                },
                modifier = Modifier.clickable { onOpen(bookmark.url) }
            )
        }
    }
}

@Composable
private fun HistoryList(
    history: List<HistoryEntry>,
    onOpen: (String) -> Unit,
    onClear: () -> Unit
) {
    if (history.isEmpty()) {
        EmptyState(text = "Your browsing history will show up here.")
        return
    }
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.End
        ) {
            TextButton(onClick = onClear) { Text("Clear history") }
        }
        LazyColumn {
            items(history, key = { it.id }) { entry ->
                ListItem(
                    headlineContent = { Text(entry.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    supportingContent = { Text(entry.url, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    modifier = Modifier.clickable { onOpen(entry.url) }
                )
            }
        }
    }
}

@Composable
private fun EmptyState(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}
