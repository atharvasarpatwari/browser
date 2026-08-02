package com.miniweb.browser.ui.components

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
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.miniweb.browser.model.Tab

@Composable
fun TabsBar(
    tabs: List<Tab>,
    activeTabId: String,
    onSelect: (String) -> Unit,
    onClose: (String) -> Unit,
    onNewTab: () -> Unit,
    modifier: Modifier = Modifier
) {
    LazyRow(
        modifier = modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(tabs, key = { it.id }) { tab ->
            val selected = tab.id == activeTabId
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (selected) MaterialTheme.colorScheme.surfaceVariant else Color_Transparent())
                    .border(
                        width = if (selected) 0.dp else 1.dp,
                        color = MaterialTheme.colorScheme.outline,
                        shape = RoundedCornerShape(14.dp)
                    )
                    .clickable { onSelect(tab.id) }
                    .padding(start = 12.dp, end = 6.dp, top = 8.dp, bottom = 8.dp)
                    .widthIn(max = 160.dp)
            ) {
                Text(
                    text = tab.title.ifBlank { "New Tab" },
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(4.dp))
                IconButton(onClick = { onClose(tab.id) }, modifier = Modifier.size(20.dp)) {
                    Icon(Icons.Filled.Close, contentDescription = "Close tab", modifier = Modifier.size(14.dp))
                }
            }
        }

        item {
            IconButton(onClick = onNewTab) {
                Icon(Icons.Filled.Add, contentDescription = "New tab")
            }
        }
    }
}

// Small local helper kept in-file to avoid an extra import at the call site.
@Composable
private fun Color_Transparent() = androidx.compose.ui.graphics.Color.Transparent
