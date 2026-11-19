package com.nova.browser.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.nova.browser.BrowserViewModel.FindState

/** Find-in-page bar shown above the bottom chrome; the engine highlights and scrolls to matches. */
@Composable
fun FindBar(
    state: FindState,
    onQuery: (String) -> Unit,
    onNext: () -> Unit,
    onPrevious: () -> Unit,
    onClose: () -> Unit,
) {
    BackHandler(onBack = onClose)
    var text by remember { mutableStateOf(state.query) }
    Surface(tonalElevation = 3.dp, color = MaterialTheme.colorScheme.surface) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 8.dp)) {
            Box(
                contentAlignment = Alignment.CenterStart,
                modifier = Modifier.weight(1f).height(38.dp).clip(RoundedCornerShape(19.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 14.dp),
            ) {
                if (text.isEmpty()) Text("Find in page", color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
                BasicTextField(
                    value = text,
                    onValueChange = { text = it; onQuery(it) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { onNext() }),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Text(
                text = when {
                    state.query.isEmpty() -> ""
                    state.total == 0 -> "0/0"
                    else -> "${state.index + 1}/${state.total}"
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 8.dp),
            )
            IconButton(onClick = onPrevious, enabled = state.total > 0) { Icon(Icons.Filled.KeyboardArrowUp, contentDescription = "Previous match") }
            IconButton(onClick = onNext, enabled = state.total > 0) { Icon(Icons.Filled.KeyboardArrowDown, contentDescription = "Next match") }
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close find") }
        }
    }
}
