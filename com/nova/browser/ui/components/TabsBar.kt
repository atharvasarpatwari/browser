package com.nova.browser.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.Tab
import com.nova.browser.ui.theme.IncognitoContent
import com.nova.browser.ui.theme.IncognitoSurface

@Composable
fun TabsBar(
    tabs: List<Tab>,
    activeTabId: String,
    incognito: Boolean,
    onToggleIncognito: () -> Unit,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onNewTab: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .background(
                if (incognito) IncognitoSurface else MaterialTheme.colorScheme.background
            )
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(tabs, key = { it.id }) { tab ->
            val selected = tab.id == activeTabId
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (selected) MaterialTheme.colorScheme.surfaceContainerHigh else Color.Transparent)
                    .border(
                        width = if (selected) 0.dp else 1.dp,
                        color = if (incognito) IncognitoContent.copy(alpha = 0.4f) else MaterialTheme.colorScheme.outline,
                        shape = RoundedCornerShape(14.dp)
                    )
                    .clickable { onSelect(tab.id) }
                    .padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp)
                    .widthIn(max = 160.dp)
            ) {
                Text(
                    text = tab.title.ifBlank { "New Tab" },
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (incognito) IncognitoContent else LocalContentColor.current,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(4.dp))
                IconButton(onClick = { onClose(tab.id) }, modifier = Modifier.size(20.dp)) {
                    Icon(
                        Icons.Filled.Close,
                        contentDescription = "Close tab",
                        modifier = Modifier.size(14.dp),
                        tint = if (incognito) IncognitoContent else LocalContentColor.current
                    )
                }
            }
        }

        item {
            IconButton(onClick = onToggleIncognito) {
                Icon(
                    Icons.Filled.VisibilityOff,
                    contentDescription = "Incognito",
                    tint = if (incognito) IncognitoContent else MaterialTheme.colorScheme.primary
                )
            }
        }

        item {
            IconButton(onClick = onNewTab) {
                Icon(
                    Icons.Filled.Add,
                    contentDescription = "New tab",
                    tint = if (incognito) IncognitoContent else LocalContentColor.current
                )
            }
        }
    }
}
