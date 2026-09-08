package com.nova.browser.model

/**
 * Mirrors one item of the app's download list. Unlike Tab/Bookmark/HistoryEntry
 * (which mirror engine state), downloads are OWNED natively: NativeDownloader
 * fetches and persists bytes into app-specific storage, and this model is the
 * single source of truth for the Compose DownloadsSheet.
 */
enum class DownloadState {
    QUEUED, DOWNLOADING, PAUSED, COMPLETED, FAILED, CANCELLED;

    val isActive: Boolean
        get() = this == QUEUED || this == DOWNLOADING
}

data class DownloadItem(
    val id: String,
    val url: String,
    val filename: String,
    val path: String,
    val mimeType: String,
    val totalBytes: Long,
    val receivedBytes: Long,
    val state: DownloadState,
    val error: String?,
    val createdAt: Long,
    val completedAt: Long?,
    val speedBytesPerSec: Long,
    val etaSeconds: Long
) {
    /** 0..1 download fraction; 0 when the total size is unknown. */
    val progress: Float
        get() = if (totalBytes > 0) (receivedBytes.toFloat() / totalBytes).coerceIn(0f, 1f) else 0f

    val isActive: Boolean
        get() = state == DownloadState.QUEUED || state == DownloadState.DOWNLOADING
}
