package com.nova.browser.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.nova.browser.ContextMenuTarget

/**
 * Native context-menu bottom sheet for the engine-resolved long-press target
 * (see resolveContextTarget() in browser-window.ts). Options are built from
 * which target kinds (link/image) the engine reported under the finger.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContextMenuSheet(
    target: ContextMenuTarget,
    onOpenInNewTab: (String) -> Unit,
    onNavigate: (String) -> Unit,
    onSaveImage: (String, String?) -> Unit,
    onCopy: (String, String) -> Unit,
    onShare: (String, String) -> Unit,
    onDismiss: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 8.dp)
                .heightIn(max = 560.dp)
        ) {
            target.linkUrl?.let { linkUrl ->
                ListItem(
                    headlineContent = { Text(target.linkText?.takeIf { it.isNotBlank() } ?: linkUrl, maxLines = 2) },
                    supportingContent = { Text(linkUrl, maxLines = 1) },
                    leadingContent = { Icon(Icons.Filled.Link, contentDescription = null) },
                    modifier = Modifier.padding(bottom = 4.dp)
                )

                MenuItem(
                    text = "Open in new tab",
                    icon = { Icon(Icons.Filled.OpenInNew, contentDescription = null) },
                    onClick = { onOpenInNewTab(linkUrl) }
                )
                MenuItem(
                    text = "Copy link",
                    icon = { Icon(Icons.Filled.ContentCopy, contentDescription = null) },
                    onClick = { onCopy("Link", linkUrl) }
                )
                MenuItem(
                    text = "Share link",
                    icon = { Icon(Icons.Filled.Share, contentDescription = null) },
                    onClick = { onShare(target.linkText ?: target.pageTitle, linkUrl) }
                )
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
            }

            target.imageUrl?.let { imageUrl ->
                ListItem(
                    headlineContent = { Text(target.imageAlt?.takeIf { it.isNotBlank() } ?: imageUrl, maxLines = 1) },
                    supportingContent = { Text(imageUrl, maxLines = 1) },
                    leadingContent = { Icon(Icons.Filled.Image, contentDescription = null) },
                    modifier = Modifier.padding(bottom = 4.dp)
                )

                MenuItem(
                    text = "Save image",
                    icon = { Icon(Icons.Filled.Save, contentDescription = null) },
                    onClick = { onSaveImage(imageUrl, target.imageAlt) }
                )
                MenuItem(
                    text = "Copy image URL",
                    icon = { Icon(Icons.Filled.ContentCopy, contentDescription = null) },
                    onClick = { onCopy("Image URL", imageUrl) }
                )
                MenuItem(
                    text = "Open image in new tab",
                    icon = { Icon(Icons.Filled.Image, contentDescription = null) },
                    onClick = { onNavigate(imageUrl) }
                )
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
            }

            MenuItem(
                text = "Copy page URL",
                icon = { Icon(Icons.Filled.ContentCopy, contentDescription = null) },
                onClick = { onCopy("Page URL", target.pageUrl) }
            )
            MenuItem(
                text = "Share page",
                icon = { Icon(Icons.Filled.Share, contentDescription = null) },
                onClick = { onShare(target.pageTitle, target.pageUrl) }
            )

            HorizontalDivider(Modifier.padding(vertical = 6.dp))
            ListItem(
                headlineContent = { Text("Cancel", color = MaterialTheme.colorScheme.error) },
                modifier = Modifier.clickable(onClick = onDismiss)
            )
        }
    }
}

@Composable
private fun MenuItem(
    text: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = { Text(text) },
        leadingContent = icon,
        modifier = Modifier.clickable(onClick = onClick)
    )
}
