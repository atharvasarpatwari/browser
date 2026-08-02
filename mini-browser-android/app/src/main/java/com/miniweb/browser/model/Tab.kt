package com.miniweb.browser.model

import android.graphics.Bitmap
import java.util.UUID

data class Tab(
    val id: String = UUID.randomUUID().toString(),
    val url: String = "https://www.google.com",
    val title: String = "New Tab",
    val favicon: Bitmap? = null,
    val isLoading: Boolean = false,
    val progress: Int = 0,
    val canGoBack: Boolean = false,
    val canGoForward: Boolean = false
)

data class Bookmark(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val url: String
)

data class HistoryEntry(
    val id: String = UUID.randomUUID().toString(),
    val title: String,
    val url: String,
    val visitedAt: Long = System.currentTimeMillis()
)
