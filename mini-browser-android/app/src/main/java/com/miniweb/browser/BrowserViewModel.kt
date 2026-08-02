package com.miniweb.browser

import android.graphics.Bitmap
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.ViewModel
import com.miniweb.browser.model.Bookmark
import com.miniweb.browser.model.HistoryEntry
import com.miniweb.browser.model.Tab
import java.util.UUID

/**
 * Holds all mutable browser state: open tabs, the active tab, bookmarks and history.
 * Kept intentionally framework-light (no Flow/StateFlow) since Compose's
 * snapshot state (mutableStateOf / mutableStateListOf) is sufficient here and
 * recomposes automatically.
 */
class BrowserViewModel : ViewModel() {

    val tabs = mutableStateListOf(Tab())
    var activeTabId = mutableStateOf(tabs.first().id)
        private set

    val bookmarks = mutableStateListOf<Bookmark>()
    val history = mutableStateListOf<HistoryEntry>()

    var addressBarText = mutableStateOf(tabs.first().url)

    val activeTab: Tab
        get() = tabs.first { it.id == activeTabId.value }

    fun selectTab(id: String) {
        activeTabId.value = id
        addressBarText.value = tabs.first { it.id == id }.url
    }

    fun newTab(url: String = "https://www.google.com") {
        val tab = Tab(url = url)
        tabs.add(tab)
        activeTabId.value = tab.id
        addressBarText.value = url
    }

    fun closeTab(id: String) {
        val index = tabs.indexOfFirst { it.id == id }
        if (index == -1) return
        tabs.removeAt(index)
        if (tabs.isEmpty()) {
            newTab()
            return
        }
        if (activeTabId.value == id) {
            val newIndex = (index - 1).coerceAtLeast(0)
            activeTabId.value = tabs[newIndex].id
            addressBarText.value = tabs[newIndex].url
        }
    }

    fun updateTab(id: String, transform: (Tab) -> Tab) {
        val index = tabs.indexOfFirst { it.id == id }
        if (index != -1) {
            tabs[index] = transform(tabs[index])
        }
    }

    fun onPageStarted(id: String, url: String) {
        updateTab(id) { it.copy(url = url, isLoading = true, progress = 5) }
        if (id == activeTabId.value) addressBarText.value = url
    }

    fun onProgressChanged(id: String, progress: Int) {
        updateTab(id) { it.copy(progress = progress) }
    }

    fun onPageFinished(id: String, url: String, title: String?, canGoBack: Boolean, canGoForward: Boolean) {
        updateTab(id) {
            it.copy(
                url = url,
                title = title?.takeIf { t -> t.isNotBlank() } ?: url,
                isLoading = false,
                progress = 100,
                canGoBack = canGoBack,
                canGoForward = canGoForward
            )
        }
        history.add(0, HistoryEntry(title = title ?: url, url = url))
    }

    fun onFaviconReceived(id: String, favicon: Bitmap?) {
        updateTab(id) { it.copy(favicon = favicon) }
    }

    fun toggleBookmark() {
        val tab = activeTab
        val existing = bookmarks.firstOrNull { it.url == tab.url }
        if (existing != null) {
            bookmarks.remove(existing)
        } else {
            bookmarks.add(0, Bookmark(title = tab.title, url = tab.url))
        }
    }

    fun isBookmarked(url: String): Boolean = bookmarks.any { it.url == url }

    fun removeBookmark(id: String) {
        bookmarks.removeAll { it.id == id }
    }

    fun clearHistory() = history.clear()

    /** Normalizes address-bar text into a navigable URL: adds scheme, or builds a search query. */
    fun resolveInput(input: String): String {
        val trimmed = input.trim()
        val looksLikeUrl = trimmed.contains(".") && !trimmed.contains(" ")
        return when {
            trimmed.startsWith("http://") || trimmed.startsWith("https://") -> trimmed
            looksLikeUrl -> "https://$trimmed"
            else -> "https://www.google.com/search?q=" + java.net.URLEncoder.encode(trimmed, "UTF-8")
        }
    }
}
