package com.nova.browser.ui.components

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nova.browser.model.HistoryEntry
import com.nova.browser.ui.theme.IncognitoContent
import com.nova.browser.ui.theme.IncognitoSurface
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

enum class NewTabShortcut(val label: String, val icon: ImageVector) {
    BOOKMARKS("Bookmarks", Icons.Filled.Star),
    HISTORY("History", Icons.Filled.History),
    DOWNLOADS("Downloads", Icons.Filled.Download),
    SETTINGS("Settings", Icons.Filled.Settings),
}

/**
 * Native start page (from the "Nova Browser Interface" design canvas, NewTab
 * artboard): greeting + date/time, search box, shortcut tiles, recently visited.
 * Covers the engine's own about: start page.
 */
@Composable
fun NewTabPage(
    history: List<HistoryEntry>,
    incognito: Boolean,
    onSubmit: (String) -> Unit,
    onOpen: (String) -> Unit,
    onShortcut: (NewTabShortcut) -> Unit,
    modifier: Modifier = Modifier,
) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) { delay(30_000); now = System.currentTimeMillis() }
    }
    val content = if (incognito) IncognitoContent else MaterialTheme.colorScheme.onBackground
    var query by remember { mutableStateOf("") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(if (incognito) IncognitoSurface else MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 32.dp),
    ) {
        if (incognito) {
            Icon(Icons.Filled.VisibilityOff, contentDescription = null, tint = content, modifier = Modifier.size(32.dp))
            Spacer(Modifier.height(8.dp))
            Text("You're incognito", style = MaterialTheme.typography.headlineSmall, color = content, fontWeight = FontWeight.SemiBold)
            Text(
                "Pages you visit here aren't saved to history, and cookies are cleared when you leave incognito.",
                style = MaterialTheme.typography.bodyMedium,
                color = content.copy(alpha = 0.75f),
            )
        } else {
            Text(greeting(now), style = MaterialTheme.typography.headlineSmall, color = content, fontWeight = FontWeight.SemiBold)
            Text(
                SimpleDateFormat("EEEE, MMMM d · h:mm a", Locale.getDefault()).format(Date(now)),
                style = MaterialTheme.typography.bodyMedium,
                color = content.copy(alpha = 0.7f),
            )
        }

        Spacer(Modifier.height(24.dp))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(RoundedCornerShape(26.dp))
                .background(if (incognito) Color.White.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 16.dp),
        ) {
            Icon(Icons.Filled.Search, contentDescription = null, tint = content.copy(alpha = 0.7f))
            Spacer(Modifier.width(10.dp))
            Box(Modifier.weight(1f)) {
                if (query.isEmpty()) {
                    Text("Search the web or enter a URL", color = content.copy(alpha = 0.55f), style = MaterialTheme.typography.bodyLarge)
                }
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = content),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { if (query.isNotBlank()) onSubmit(query) }),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            NewTabShortcut.entries.forEach { s ->
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { onShortcut(s) }.padding(8.dp),
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier.size(52.dp).clip(CircleShape)
                            .background(if (incognito) Color.White.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surfaceContainerHigh),
                    ) {
                        Icon(s.icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(s.label, style = MaterialTheme.typography.labelMedium, color = content)
                }
            }
        }

        val recent = remember(history) { history.sortedByDescending { it.visitedAt }.distinctBy { it.url }.take(5) }
        if (!incognito && recent.isNotEmpty()) {
            Spacer(Modifier.height(28.dp))
            Text("Recently visited", style = MaterialTheme.typography.titleSmall, color = content, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            recent.forEach { entry ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { onOpen(entry.url) }.padding(vertical = 10.dp, horizontal = 4.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(entry.title.ifBlank { entry.url }, style = MaterialTheme.typography.bodyMedium, color = content, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(hostOf(entry.url), style = MaterialTheme.typography.bodySmall, color = content.copy(alpha = 0.6f), maxLines = 1)
                    }
                    Text(
                        DateUtils.getRelativeTimeSpanString(entry.visitedAt, now, DateUtils.MINUTE_IN_MILLIS).toString(),
                        style = MaterialTheme.typography.bodySmall,
                        color = content.copy(alpha = 0.6f),
                    )
                }
            }
        }
    }
}

private fun greeting(now: Long): String = when (Calendar.getInstance().apply { timeInMillis = now }.get(Calendar.HOUR_OF_DAY)) {
    in 5..11 -> "Good morning"
    in 12..16 -> "Good afternoon"
    else -> "Good evening"
}
