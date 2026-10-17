package com.nova.browser.ui.components

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.nova.browser.SearchEngine

/** Native settings: search engine, clear browsing data, about. */
@Composable
fun SettingsScreen(
    searchEngine: SearchEngine,
    onSearchEngine: (SearchEngine) -> Unit,
    onClearData: (history: Boolean, cookies: Boolean, downloads: Boolean) -> Unit,
    version: String,
    onDismiss: () -> Unit,
) {
    BackHandler(onBack = onDismiss)
    var clearHistory by remember { mutableStateOf(true) }
    var clearCookies by remember { mutableStateOf(true) }
    var clearDownloads by remember { mutableStateOf(false) }
    var cleared by remember { mutableStateOf(false) }

    Surface(color = MaterialTheme.colorScheme.background, modifier = Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState())) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(4.dp)) {
                IconButton(onClick = onDismiss) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                Text("Settings", style = MaterialTheme.typography.titleLarge)
            }

            Section("Search engine")
            SearchEngine.entries.forEach { engine ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().clickable { onSearchEngine(engine) }.padding(horizontal = 8.dp),
                ) {
                    RadioButton(selected = engine == searchEngine, onClick = { onSearchEngine(engine) })
                    Text(engine.label, style = MaterialTheme.typography.bodyLarge)
                }
            }

            Section("Clear browsing data")
            CheckRow("Browsing history", clearHistory) { clearHistory = it; cleared = false }
            CheckRow("Cookies and site data (signs you out of sites)", clearCookies) { clearCookies = it; cleared = false }
            CheckRow("Downloads list (files stay on the device)", clearDownloads) { clearDownloads = it; cleared = false }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Button(
                    onClick = { onClearData(clearHistory, clearCookies, clearDownloads); cleared = true },
                    enabled = clearHistory || clearCookies || clearDownloads,
                ) { Text("Clear data") }
                if (cleared) {
                    Spacer(Modifier.width(12.dp))
                    Text("Cleared", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium)
                }
            }

            Section("About")
            Text(
                "Nova Browser $version",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 4.dp),
    )
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 8.dp),
    ) {
        Checkbox(checked = checked, onCheckedChange = onChange)
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}
