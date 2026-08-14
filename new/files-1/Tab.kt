package com.nova.browser.model

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

/** Mirrors one entry from the engine's real BookmarkService (see listBookmarksExternal() in browser-window.ts). */
data class Bookmark(
    val id: String,
    val title: String,
    val url: String
)

/** Mirrors one entry from the engine's real HistoryService (see listHistoryExternal() in browser-window.ts). */
data class HistoryEntry(
    val id: String,
    val title: String,
    val url: String,
    val visitedAt: Long
)
