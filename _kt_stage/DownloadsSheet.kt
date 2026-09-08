package com.nova.browser.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.DownloadItem
import com.nova.browser.model.DownloadState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsSheet(
    downloads: List<DownloadItem>,
    onOpen: (String) -> Unit,
    onShare: (String) -> Unit,
    onPause: (String) -> Unit,
    onResume: (String) -> Unit,
    onCancel: (String) -> Unit,
    onRemove: (String) -> Unit,
    onClearCompleted: () -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Downloads", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            TextButton(onClick = onClearCompleted, enabled = downloads.any { !it.isActive }) {
                Text("Clear completed")
            }
        }

        Box(modifier = Modifier.heightIn(min = 200.dp, max = 480.dp)) {
            if (downloads.isEmpty()) {
                EmptyDownloadsState()
            } else {
                LazyColumn {
                    items(downloads, key = { it.id }) { item ->
                        DownloadRow(
                            item = item,
                            onOpen = { onOpen(item.id) },
                            onShare = { onShare(item.id) },
                            onPause = { onPause(item.id) },
                            onResume = { onResume(item.id) },
                            onCancel = { onCancel(item.id) },
                            onRemove = { onRemove(item.id) }
                        )
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun DownloadRow(
    item: DownloadItem,
    onOpen: () -> Unit,
    onShare: () -> Unit,
    onPause: () -> Unit,
    onResume: () -> Unit,
    onCancel: () -> Unit,
    onRemove: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(item.filename, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                Text(
                    detailLine(item),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            when {
                item.isActive -> {
                    IconButton(onClick = onPause) { Icon(Icons.Filled.Pause, contentDescription = "Pause") }
                    IconButton(onClick = onCancel) { Icon(Icons.Filled.Cancel, contentDescription = "Cancel") }
                }
                item.state == DownloadState.PAUSED -> {
                    IconButton(onClick = onResume) { Icon(Icons.Filled.PlayArrow, contentDescription = "Resume") }
                    IconButton(onClick = onCancel) { Icon(Icons.Filled.Cancel, contentDescription = "Cancel") }
                }
                item.state == DownloadState.COMPLETED -> {
                    IconButton(onClick = onOpen) { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = "Open") }
                    IconButton(onClick = onShare) { Icon(Icons.Filled.Share, contentDescription = "Share") }
                    IconButton(onClick = onRemove) { Icon(Icons.Filled.Delete, contentDescription = "Remove") }
                }
                else -> {
                    IconButton(onClick = onRemove) { Icon(Icons.Filled.Delete, contentDescription = "Remove") }
                }
            }
        }

        when (item.state) {
            DownloadState.QUEUED -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth().height(4.dp))
            DownloadState.DOWNLOADING -> {
                LinearProgressIndicator(
                    progress = { item.progress },
                    modifier = Modifier.fillMaxWidth().height(4.dp)
                )
            }
            DownloadState.PAUSED -> LinearProgressIndicator(
                progress = { item.progress },
                modifier = Modifier.fillMaxWidth().height(4.dp)
            )
            DownloadState.COMPLETED -> Row(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(14.dp)
                )
                Spacer(Modifier.width(4.dp))
                Text("Completed", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            DownloadState.FAILED -> Row(
                modifier = Modifier.fillMaxWidth().padding(top = 2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    item.error?.let { "Failed: $it" } ?: "Failed",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            DownloadState.CANCELLED -> Text(
                "Cancelled",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun detailLine(item: DownloadItem): String {
    val size = humanSize(item.totalBytes)
    return when (item.state) {
        DownloadState.QUEUED -> "Queued"
        DownloadState.DOWNLOADING -> {
            val received = humanSize(item.receivedBytes)
            val speed = if (item.speedBytesPerSec > 0) " · ${humanSize(item.speedBytesPerSec)}/s" else ""
            val eta = if (item.etaSeconds > 0) " · ${etaText(item.etaSeconds)} left" else ""
            "$received of ${if (item.totalBytes > 0) size else "?"}$speed$eta"
        }
        DownloadState.PAUSED -> "Paused · ${receivedText(item)}"
        DownloadState.COMPLETED -> size
        DownloadState.FAILED -> item.url
        DownloadState.CANCELLED -> item.url
    }
}

private fun receivedText(item: DownloadItem): String =
    if (item.totalBytes > 0) "${humanSize(item.receivedBytes)} of ${humanSize(item.totalBytes)}" else humanSize(item.receivedBytes)

private fun etaText(seconds: Long): String {
    return when {
        seconds >= 3600 -> "${seconds / 3600}h ${(seconds % 3600) / 60}m"
        seconds >= 60 -> "${seconds / 60}m ${seconds % 60}s"
        else -> "${seconds}s"
    }
}

private fun humanSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.size - 1) {
        value /= 1024
        unit++
    }
    return if (unit == 0) "${bytes} B" else "%.1f %s".format(value, units[unit])
}

@Composable
private fun EmptyDownloadsState() {
    Box(
        modifier = Modifier.fillMaxWidth().padding(32.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            "No downloads yet. Files you download will show up here.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center
        )
    }
}
