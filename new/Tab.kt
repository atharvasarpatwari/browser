package com.nova.browser.model

import java.util.UUID

/**
 * Mirrors one entry of the engine's ChromeStateSnapshot.tabs (see
 * src/ui/pages/browser-window.ts). The engine — not this Kotlin layer — owns
 * tab lifecycle and navigation state; NovaStateBridge.onStateChanged() parses
 * the JSON snapshot pushed from window.novaNative and replaces this list
 * wholesale on every change. There is no local mutation of Tab fields here.
 */
data class Tab(
    val id: String,
    val url: String,
    val title: String,
    val active: Boolean,
    val pinned: Boolean,
    val loading: Boolean
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
