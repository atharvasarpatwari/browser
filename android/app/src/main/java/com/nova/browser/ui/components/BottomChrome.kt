package com.nova.browser.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nova.browser.AddressSuggestion
import com.nova.browser.ui.theme.IncognitoContent
import com.nova.browser.ui.theme.IncognitoSurface
import com.nova.browser.ui.theme.SuccessGreen

/**
 * One-handed bottom chrome: back · address pill · tab count · menu.
 * Tapping the pill turns the bar into a full-width address editor.
 */
@Composable
fun BottomChrome(
    url: String,
    isLoading: Boolean,
    incognito: Boolean,
    tabCount: Int,
    canGoBack: Boolean,
    onBack: () -> Unit,
    onSubmit: (String) -> Unit,
    onReload: () -> Unit,
    onStop: () -> Unit,
    onShowTabs: () -> Unit,
    menuContent: @Composable ColumnScope.(close: () -> Unit) -> Unit,
    modifier: Modifier = Modifier,
    showUrl: Boolean = true,
    /** Rows shown above the bar while typing (AddressSuggestions); the first is what Go does. */
    suggestions: (String) -> List<AddressSuggestion> = { emptyList() },
    /** Ads and trackers blocked in this tab; a shield with the number shows when it is above 0. */
    blockedCount: Int = 0,
    onShowBlocked: () -> Unit = {},
) {
    var editing by remember { mutableStateOf(false) }
    var draft by remember { mutableStateOf(TextFieldValue("")) }
    var menuOpen by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val content = if (incognito) IncognitoContent else MaterialTheme.colorScheme.onSurface
    val pillColor = if (incognito) Color.White.copy(alpha = 0.08f) else MaterialTheme.colorScheme.surfaceVariant

    fun stopEditing() {
        focusManager.clearFocus()
        editing = false
    }

    BackHandler(enabled = editing) { stopEditing() }

    // Select the whole address once editing starts, a frame after focus: the tap that
    // focused the field places its cursor after onFocusChanged, which would undo an
    // immediate select-all and make typing append to the old URL.
    LaunchedEffect(editing) {
        if (editing) {
            withFrameNanos { }
            draft = draft.copy(selection = TextRange(0, draft.text.length))
        }
    }

    Surface(
        color = if (incognito) IncognitoSurface else MaterialTheme.colorScheme.surface,
        tonalElevation = 3.dp,
        modifier = modifier,
    ) {
        Column {
            if (editing && draft.text.isNotBlank()) {
                val rows = remember(draft.text) { suggestions(draft.text) }
                rows.forEach { s ->
                    SuggestionRow(s, content) {
                        onSubmit(s.url)
                        stopEditing()
                    }
                }
                if (rows.isNotEmpty()) HorizontalDivider()
            }
            if (isLoading) {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth().height(2.dp),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = Color.Transparent,
                )
            } else {
                Spacer(Modifier.height(2.dp))
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
            ) {
                if (!editing) {
                    IconButton(onClick = onBack, enabled = canGoBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = content.copy(alpha = if (canGoBack) 1f else 0.38f))
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .weight(1f)
                        .height(40.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(pillColor)
                        .padding(start = 12.dp, end = 2.dp),
                ) {
                    val secure = url.startsWith("https://")
                    if (!editing) {
                        Icon(
                            imageVector = when {
                                !showUrl -> Icons.Filled.Search
                                secure -> Icons.Filled.Lock
                                else -> Icons.Filled.Info
                            },
                            contentDescription = if (!showUrl) null else if (secure) "Secure" else "Not secure",
                            tint = if (showUrl && secure) SuccessGreen else content.copy(alpha = 0.7f),
                            modifier = Modifier.size(16.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                    }
                    // The pill IS the text field, so a tap focuses it directly. A separate
                    // editor that requested focus programmatically never got it on device
                    // (the engine WebView holds view focus in the same window).
                    BasicTextField(
                        value = if (editing) draft else TextFieldValue(if (showUrl) displayUrl(url) else ""),
                        onValueChange = { if (editing) draft = it },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyMedium.copy(color = content, fontSize = 15.sp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = {
                            if (draft.text.isNotBlank()) onSubmit(draft.text)
                            stopEditing()
                        }),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        decorationBox = { field ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (!editing && !showUrl) {
                                    Text("Search or enter URL", color = content.copy(alpha = 0.6f), style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                                }
                                field()
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .semantics { contentDescription = "Address bar" }
                            .onFocusChanged { state ->
                                if (state.isFocused && !editing) {
                                    val start = if (showUrl) url else ""
                                    draft = TextFieldValue(start, TextRange(0, start.length))
                                }
                                editing = state.isFocused
                            },
                    )
                    if (editing && draft.text.isNotEmpty()) {
                        IconButton(onClick = { draft = TextFieldValue("") }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Filled.Close, contentDescription = "Clear", tint = content, modifier = Modifier.size(18.dp))
                        }
                    }
                    if (!editing && showUrl && blockedCount > 0) {
                        // Shield with this tab's blocked ads + trackers; a tap shows the breakdown.
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .clickable(onClick = onShowBlocked)
                                .padding(horizontal = 6.dp, vertical = 4.dp)
                                .semantics { contentDescription = "$blockedCount ads and trackers blocked" },
                        ) {
                            Icon(Icons.Filled.Shield, contentDescription = null, tint = SuccessGreen, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(3.dp))
                            Text(
                                if (blockedCount > 999) "999+" else blockedCount.toString(),
                                color = content.copy(alpha = 0.85f),
                                fontSize = 12.sp,
                                maxLines = 1,
                            )
                        }
                    }
                    if (!editing && showUrl) {
                        IconButton(onClick = if (isLoading) onStop else onReload, modifier = Modifier.size(36.dp)) {
                            Icon(
                                if (isLoading) Icons.Filled.Close else Icons.Filled.Refresh,
                                contentDescription = if (isLoading) "Stop" else "Reload",
                                tint = content,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }

                if (editing) {
                    TextButton(onClick = { stopEditing() }) { Text("Cancel", color = content) }
                } else {
                    IconButton(onClick = onShowTabs, modifier = Modifier.semantics { contentDescription = "Tabs, $tabCount open" }) {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier.size(24.dp).border(1.5.dp, content, RoundedCornerShape(6.dp)),
                        ) {
                            Text(
                                text = if (tabCount > 99) "∞" else tabCount.toString(),
                                color = content,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }) {
                            Icon(Icons.Filled.MoreVert, contentDescription = "Menu", tint = content)
                        }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            menuContent { menuOpen = false }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SuggestionRow(s: AddressSuggestion, content: Color, onClick: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .semantics { contentDescription = "Suggestion: ${s.title}" },
    ) {
        Icon(
            imageVector = when (s.kind) {
                AddressSuggestion.Kind.GO -> Icons.Filled.Public
                AddressSuggestion.Kind.SEARCH -> Icons.Filled.Search
                AddressSuggestion.Kind.BOOKMARK -> Icons.Filled.Star
                AddressSuggestion.Kind.HISTORY -> Icons.Filled.History
            },
            contentDescription = null,
            tint = content.copy(alpha = 0.7f),
            modifier = Modifier.size(18.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            val label = when (s.kind) {
                AddressSuggestion.Kind.GO -> s.title
                AddressSuggestion.Kind.SEARCH -> "Search for “${s.title}”"
                else -> s.title
            }
            Text(label, color = content, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (s.kind == AddressSuggestion.Kind.BOOKMARK || s.kind == AddressSuggestion.Kind.HISTORY) {
                Text(displayUrl(s.url), color = content.copy(alpha = 0.6f), style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Scheme and trailing slash dropped for a cleaner read-only display. */
private fun displayUrl(url: String): String =
    url.removePrefix("https://").removePrefix("http://").removePrefix("www.").removeSuffix("/")
