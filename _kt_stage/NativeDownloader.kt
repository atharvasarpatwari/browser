package com.nova.browser

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.MimeTypeMap
import com.nova.browser.model.DownloadItem
import com.nova.browser.model.DownloadState
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream

/**
 * Native download engine for the mobile app. Owns the authoritative download
 * state and the real bytes: a streaming HttpURLConnection writes straight to
 * app-specific external storage (no JS bridge round-trip, no full-body buffer).
 *
 * Trigger paths:
 *  1. NovaFetchBridge hands an already-open connection here (attachment
 *     responses) via [startFromConnection] — no double-fetch.
 *  2. The engine bridge calls window.novaNative.download() -> [start].
 *  3. EngineWebView's DownloadListener (WebView-level safety net).
 *
 * All progress/state callbacks are marshaled onto the main looper so Compose
 * state can be updated directly.
 */
class NativeDownloader(
    private val context: Context,
    private val onItemChanged: (DownloadItem) -> Unit,
    private val onItemRemoved: (String) -> Unit
) {
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val states = ConcurrentHashMap<String, State>()
    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val mainHandler = Handler(Looper.getMainLooper())

    private data class State(
        val id: String,
        val url: String,
        var filename: String,
        var mimeType: String,
        var partFile: File,
        var finalFile: File,
        val createdAt: Long,
        val requestHeaders: Map<String, String>,
        var receivedBytes: Long = 0L,
        var totalBytes: Long = 0L,
        var speedBytesPerSec: Long = 0L,
        var etaSeconds: Long = 0L,
        var supportsResume: Boolean = false,
        var error: String? = null,
        var state: DownloadState = DownloadState.QUEUED,
        var completedAt: Long? = null
    )

    /** Path 1 (engine bridge / DownloadListener): open a brand-new connection and stream it. */
    fun start(url: String, filename: String?, mimeType: String?, referrer: String?, requestHeaders: Map<String, String> = emptyMap()): String {
        val id = newId()
        val headers = if (referrer.isNullOrBlank()) requestHeaders else requestHeaders + ("Referer" to referrer)
        val state = initialState(id, url, filename, mimeType, headers)
        states[id] = state
        Log.i(TAG, "start[$id] $url -> ${state.filename}")
        emit(state)
        executor.execute { runDownload(state) }
        return id
    }

    /** Path 2 (NovaFetchBridge): adopt an already-open connection whose headers are read but whose body is NOT. */
    fun startFromConnection(
        url: String,
        connection: HttpURLConnection,
        disposition: String?,
        mimeType: String?,
        requestHeaders: Map<String, String> = emptyMap()
    ): String {
        val id = newId()
        val suggested = parseDispositionFilename(disposition)
        val state = initialState(id, url, null, mimeType, requestHeaders).copy(
            filename = sanitizeFilename(suggested ?: guessFilename(url, mimeType)),
            partFile = File(downloadsDir(), "${sanitizeFilename(suggested ?: guessFilename(url, mimeType))}.part"),
            finalFile = File(downloadsDir(), sanitizeFilename(suggested ?: guessFilename(url, mimeType)))
        )
        states[id] = state
        emit(state)
        executor.execute {
            // Long/streaming read: lift the fetch-path's 45s read timeout.
            connection.readTimeout = 0
            streamFrom(state, connection)
            connections.remove(id)
            emit(state)
        }
        return id
    }

    fun pause(id: String) {
        val s = states[id] ?: return
        if (!s.state.isActive) return
        s.state = DownloadState.PAUSED
        connections[id]?.disconnect()
        emit(s)
    }

    fun resume(id: String) {
        val s = states[id] ?: return
        if (s.state != DownloadState.PAUSED) return
        s.state = DownloadState.DOWNLOADING
        emit(s)
        executor.execute { runDownload(s) }
    }

    fun cancel(id: String) {
        val s = states[id] ?: return
        if (s.state == DownloadState.COMPLETED || s.state == DownloadState.CANCELLED) return
        s.state = DownloadState.CANCELLED
        connections[id]?.disconnect()
        s.partFile.delete()
        emit(s)
    }

    fun remove(id: String) {
        val s = states[id] ?: return
        if (s.state.isActive) {
            s.state = DownloadState.CANCELLED
            connections[id]?.disconnect()
        }
        s.partFile.delete()
        s.finalFile.delete()
        states.remove(id)
        mainHandler.post { onItemRemoved(id) }
    }

    fun clearCompleted() {
        for (s in states.values.toList()) {
            if (s.state == DownloadState.COMPLETED || s.state == DownloadState.FAILED || s.state == DownloadState.CANCELLED) {
                s.partFile.delete()
                s.finalFile.delete()
                states.remove(s.id)
                mainHandler.post { onItemRemoved(s.id) }
            }
        }
    }

    fun activeCount(): Int = states.values.count { it.state.isActive }

    // ── Internals ────────────────────────────────────────────────────────────

    private fun initialState(id: String, url: String, filename: String?, mimeType: String?, requestHeaders: Map<String, String>): State {
        val name = sanitizeFilename(filename ?: guessFilename(url, mimeType))
        return State(
            id = id,
            url = url,
            filename = name,
            mimeType = mimeType ?: "",
            partFile = File(downloadsDir(), "$name.part"),
            finalFile = File(downloadsDir(), name),
            createdAt = System.currentTimeMillis(),
            requestHeaders = requestHeaders
        )
    }

    private fun downloadsDir(): File =
        File(context.getExternalFilesDir(null), "Downloads").apply { mkdirs() }

    private fun runDownload(state: State) {
        var connection: HttpURLConnection? = null
        try {
            val headers = state.requestHeaders.toMutableMap()
            if (state.receivedBytes > 0 && state.supportsResume) {
                headers["Range"] = "bytes=${state.receivedBytes}-"
            }
            connection = (URL(state.url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 30_000
                readTimeout = 60_000
                setRequestProperty("Accept-Encoding", "identity")
                headers.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            connections[state.id] = connection
            streamFrom(state, connection)
        } catch (e: Exception) {
            handleStreamError(state, e)
        } finally {
            connections.remove(state.id)
            connection?.disconnect()
            emit(state)
        }
    }

    private fun streamFrom(state: State, connection: HttpURLConnection) {
        val code = connection.responseCode
        if (code >= 400) {
            throw IOException("HTTP $code while downloading ${state.url}")
        }

        val acceptRanges = connection.getHeaderField("Accept-Ranges")
        val contentRange = connection.getHeaderField("Content-Range")
        if (acceptRanges == "bytes" || contentRange != null) state.supportsResume = true

        val isResume = code == 206 && state.receivedBytes > 0
        if (isResume) {
            val remaining = connection.contentLength
            if (remaining > 0) state.totalBytes = state.receivedBytes + remaining
        } else {
            val total = connection.contentLength
            if (total > 0) state.totalBytes = total.toLong()
            if (state.receivedBytes > 0) {
                // Server ignored the Range header — restart from scratch.
                state.receivedBytes = 0
                state.totalBytes = 0
                state.partFile.delete()
            }
        }

        state.state = DownloadState.DOWNLOADING
        emit(state)

        val raw: InputStream = connection.inputStream
        val contentEncoding = connection.getHeaderField("Content-Encoding")?.trim()?.lowercase()
        val input: InputStream = when (contentEncoding) {
            "gzip" -> GZIPInputStream(raw)
            "deflate" -> InflaterInputStream(raw)
            else -> raw
        }

        input.use { stream ->
            val outStream: OutputStream = java.io.FileOutputStream(state.partFile, isResume)
            outStream.use { out -> copyWithProgress(state, stream, out) }
        }

        if (state.state == DownloadState.PAUSED || state.state == DownloadState.CANCELLED) {
            return
        }

        val done = File(state.partFile.parentFile, state.filename)
        if (!state.partFile.renameTo(done)) {
            throw IOException("Failed to finalize ${state.filename}")
        }
        state.finalFile = done
        state.state = DownloadState.COMPLETED
        state.completedAt = System.currentTimeMillis()
        state.speedBytesPerSec = 0
        state.etaSeconds = 0
        Log.i(TAG, "completed[${state.id}] ${state.filename} (${state.receivedBytes} bytes)")
        emit(state)
        notifyCompleted(state)
    }

    private fun copyWithProgress(state: State, input: InputStream, out: OutputStream) {
        val buffer = ByteArray(64 * 1024)
        var lastSampleTime = System.currentTimeMillis()
        var lastSampleBytes = state.receivedBytes
        var lastEmit = System.currentTimeMillis()

        while (true) {
            if (state.state == DownloadState.PAUSED || state.state == DownloadState.CANCELLED) break
            val n = input.read(buffer)
            if (n < 0) break
            out.write(buffer, 0, n)
            state.receivedBytes += n

            val now = System.currentTimeMillis()
            val dT = now - lastSampleTime
            if (dT >= 500 && now > lastSampleTime) {
                state.speedBytesPerSec = ((state.receivedBytes - lastSampleBytes) * 1000L / dT).coerceAtLeast(0)
                lastSampleBytes = state.receivedBytes
                lastSampleTime = now
            }
            if (state.totalBytes > 0 && state.speedBytesPerSec > 0) {
                state.etaSeconds = ((state.totalBytes - state.receivedBytes) / state.speedBytesPerSec).coerceAtLeast(0)
            }
            if (now - lastEmit >= 250) {
                lastEmit = now
                emit(state)
            }
        }
    }

    private fun handleStreamError(state: State, e: Exception) {
        if (state.state == DownloadState.PAUSED) {
            Log.i(TAG, "paused[${state.id}] ${state.filename}")
            return
        }
        if (state.state == DownloadState.CANCELLED) {
            Log.i(TAG, "cancelled[${state.id}] ${state.filename}")
            return
        }
        state.state = DownloadState.FAILED
        state.error = e.message ?: e.toString()
        Log.e(TAG, "failed[${state.id}] ${state.filename}: ${state.error}")
    }

    private fun emit(state: State) {
        val item = DownloadItem(
            id = state.id,
            url = state.url,
            filename = state.filename,
            path = state.finalFile.path,
            mimeType = state.mimeType,
            totalBytes = state.totalBytes,
            receivedBytes = state.receivedBytes,
            state = state.state,
            error = state.error,
            createdAt = state.createdAt,
            completedAt = state.completedAt,
            speedBytesPerSec = state.speedBytesPerSec,
            etaSeconds = state.etaSeconds
        )
        mainHandler.post { onItemChanged(item) }
    }

    // ── Completion notification ──────────────────────────────────────────────

    private fun notifyCompleted(state: State) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return

        val channelId = "nova_downloads"
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(channelId, "Downloads", NotificationManager.IMPORTANCE_LOW)
        )

        val fileUri = FileProviderCompat.getUriForFile(context, state.finalFile)
        val openIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(fileUri, state.mimeType.ifEmpty { "application/octet-stream" })
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pi = PendingIntent.getActivity(
            context,
            state.id.hashCode(),
            openIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification: Notification = Notification.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(state.filename)
            .setContentText("Download complete")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        nm.notify(state.id.hashCode(), notification)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun newId(): String = "dl-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}"

    private fun guessFilename(url: String, mimeType: String?): String {
        try {
            val path = URL(url).path
            val last = path.split('/').lastOrNull { it.isNotEmpty() }
            if (last != null && last.contains('.')) return last
        } catch (_: Exception) {
        }
        val ext = mimeType?.substringAfter('/', "")?.split(';')?.first() ?: ""
        return if (ext.isNotEmpty()) "download.$ext" else "download"
    }

    private fun sanitizeFilename(name: String): String {
        val cleaned = name
            .replace(Regex("[/\\\\]"), "_")
            .replace(Regex("[\\x00-\\x1F]"), "")
            .replace(Regex("^[.\\s]+"), "")
            .trim()
        return if (cleaned.isEmpty() || cleaned == "." || cleaned == "..") "download" else cleaned.take(180)
    }

    private fun parseDispositionFilename(disposition: String?): String? {
        if (disposition.isNullOrEmpty()) return null
        val star = Regex("filename\\*\\s*=(?:UTF-8|utf-8)''([^;]*)").find(disposition)
        if (star != null) {
            return try {
                URLDecoder.decode(star.groupValues[1].trim().trim('"'), "UTF-8")
            } catch (_: Exception) {
                null
            }
        }
        val plain = Regex("filename\\s*=\\s*\"?([^\";]+)\"?").find(disposition)
        return plain?.groupValues?.get(1)?.trim()
    }

    companion object {
        const val PROVIDER_AUTHORITY_SUFFIX = ".fileprovider"
        private const val TAG = "NativeDownloader"

        fun mimeTypeFor(fileName: String): String {
            val ext = fileName.substringAfterLast('.', "").lowercase()
            return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
        }
    }
}

/** Thin indirection so the downloader stays free of androidx imports. */
private object FileProviderCompat {
    fun getUriForFile(context: Context, file: File): Uri =
        androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}${NativeDownloader.PROVIDER_AUTHORITY_SUFFIX}",
            file
        )
}
