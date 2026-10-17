package com.nova.browser.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.Tab
import com.nova.browser.ui.theme.IncognitoContent
import com.nova.browser.ui.theme.IncognitoSurface

/** Full-screen grid of open tabs; replaces the old always-visible tab strip. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TabSwitcher(
    tabs: List<Tab>,
    activeTabId: String?,
    incognito: Boolean,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onNewTab: () -> Unit,
    onSetIncognito: (Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    BackHandler(onBack = onDismiss)
    val content = if (incognito) IncognitoContent else MaterialTheme.colorScheme.onBackground

    Column(
        Modifier
            .fillMaxSize()
            .background(if (incognito) IncognitoSurface else MaterialTheme.colorScheme.background)
            .statusBarsPadding(),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp)) {
            FilterChip(selected = !incognito, onClick = { onSetIncognito(false) }, label = { Text("Tabs") })
            Spacer(Modifier.width(8.dp))
            FilterChip(
                selected = incognito,
                onClick = { onSetIncognito(true) },
                label = { Text("Incognito") },
                leadingIcon = { Icon(Icons.Filled.VisibilityOff, contentDescription = null, modifier = Modifier.size(16.dp)) },
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { onNewTab(); onDismiss() }) {
                Icon(Icons.Filled.Add, contentDescription = "New tab", tint = content)
            }
            TextButton(onClick = onDismiss) { Text("Done", color = content) }
        }
        Text(
            text = if (tabs.size == 1) "1 tab" else "${tabs.size} tabs",
            style = MaterialTheme.typography.labelLarge,
            color = content.copy(alpha = 0.7f),
            modifier = Modifier.padding(horizontal = 16.dp),
        )
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 150.dp),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            items(tabs, key = { it.id }) { tab ->
                TabCard(
                    tab = tab,
                    active = tab.id == activeTabId,
                    onOpen = { onSelect(tab.id); onDismiss() },
                    onClose = { onClose(tab.id) },
                )
            }
        }
    }
}

@Composable
private fun TabCard(tab: Tab, active: Boolean, onOpen: () -> Unit, onClose: () -> Unit) {
    val host = hostOf(tab.url)
    val title = tab.title.ifBlank { host.ifBlank { "New tab" } }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .then(if (active) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(12.dp)) else Modifier)
            .clickable(onClick = onOpen),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 10.dp, end = 2.dp, top = 6.dp)) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier.size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary),
            ) {
                Text(
                    text = (host.firstOrNull() ?: 'N').uppercase(),
                    color = MaterialTheme.colorScheme.onPrimary,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.width(8.dp))
            Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose, modifier = Modifier.size(32.dp)) {
                Icon(Icons.Filled.Close, contentDescription = "Close tab", modifier = Modifier.size(16.dp))
            }
        }
        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxWidth().height(96.dp).padding(8.dp)) {
            Text(
                text = host.ifBlank { "New tab" },
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

internal fun hostOf(url: String): String =
    runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull() ?: ""
