package com.nova.browser.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Public
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.Tab
import com.nova.browser.ui.theme.IncognitoContent
import com.nova.browser.ui.theme.IncognitoSurface

/**
 * The mobile-native "switch tabs" surface: a full list of open tabs behind one
 * tap, instead of a permanently-visible horizontal strip (that's the desktop
 * chrome's pattern — see DesktopLayout in browser-window.ts — not a mobile
 * one; every mainstream Android browser hides its tab list behind a
 * tab-count button for exactly this reason).
 *
 * ponytail: rows are text-only (title/url), no per-tab thumbnail — the engine
 * doesn't capture a bitmap per tab today. Upgrade to a thumbnail grid once
 * that capture exists; a list is the honest, fully-functional version now.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabSwitcherSheet(
    tabs: List<Tab>,
    activeTabId: String,
    incognito: Boolean,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onNewTab: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                if (tabs.size == 1) "1 tab" else "${tabs.size} tabs",
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f)
            )
            TextButton(onClick = onNewTab) {
                Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("New tab")
            }
        }

        LazyColumn(modifier = Modifier.heightIn(min = 120.dp, max = 480.dp)) {
            items(tabs, key = { it.id }) { tab ->
                TabRow(
                    tab = tab,
                    selected = tab.id == activeTabId,
                    incognito = incognito,
                    onSelect = {
                        onSelect(tab.id)
                        onDismiss()
                    },
                    onClose = { onClose(tab.id) }
                )
            }
        }

        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun TabRow(
    tab: Tab,
    selected: Boolean,
    incognito: Boolean,
    onSelect: () -> Unit,
    onClose: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .background(if (selected) (if (incognito) IncognitoSurface else MaterialTheme.colorScheme.surfaceContainerHigh) else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onSelect)
            .padding(horizontal = 16.dp, vertical = 12.dp)
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                Icons.Filled.Public,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                tab.title.ifBlank { "New Tab" },
                style = MaterialTheme.typography.bodyLarge,
                color = if (incognito) IncognitoContent else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                tab.url.ifBlank { "about:blank" },
                style = MaterialTheme.typography.bodySmall,
                color = if (incognito) IncognitoContent.copy(alpha = 0.7f) else MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onClose) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Close tab",
                tint = if (incognito) IncognitoContent else MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
