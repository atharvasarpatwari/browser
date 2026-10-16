package com.nova.browser

import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.GZIPInputStream
import java.util.zip.InflaterInputStream

/**
 * Native HTTP transport for the Nova engine.
 *
 * The engine runs inside a WebView on the appassets.androidplatform.net origin
 * (WebViewAssetLoader).  fetch() from that origin to arbitrary http(s) URLs is
 * CORS-blocked, so every engine network request is routed here through the
 * injected window.fetch shim (nova-bridge.js).  HttpURLConnection performs the
 * real exchange with no CORS.  Redirects are NOT auto-followed when the engine
 * requests redirect:"manual" — RequestManager enforces redirect safety itself.
 *
 * Compression is handled here (not in JS): the request is forced to
 * Accept-Encoding: identity and gzip/deflate responses are decompressed so the
 * engine's JS never needs Node's zlib.
 */
class NovaFetchBridge(private val webView: WebView, private val downloader: NativeDownloader) {

    // Engine requests run in parallel: one thread serialized every image/script/style and
    // let a single slow response (up to its 45s timeout) stall the whole page and new navigations.
    // ponytail: fixed pool of 8, no per-host cap; HttpURLConnection keep-alive still pools per host.
    private val executor: ExecutorService = Executors.newFixedThreadPool(8)
    private val active = ConcurrentHashMap<String, HttpURLConnection>()

    @JavascriptInterface
    fun fetch(id: String, method: String, url: String, headersJson: String, redirectMode: String, bodyBase64: String?) {
        Log.i(TAG, "fetch[$id] $method $url redirect=$redirectMode")
        executor.execute {
            val connection = try {
                (URL(url).openConnection() as HttpURLConnection).apply {
                    setMethod(this, method.uppercase())
                    connectTimeout = 30_000
                    readTimeout = 45_000
                    instanceFollowRedirects = redirectMode != "manual"
                    val headers = try { JSONObject(headersJson) } catch (_: Exception) { JSONObject() }
                    val keys = headers.keys()
                    while (keys.hasNext()) {
                        val key = keys.next()
                        setRequestProperty(key, headers.getString(key))
                    }
                    setRequestProperty("Accept-Encoding", "identity")
                    if (!bodyBase64.isNullOrEmpty() && requestMethod != "GET" && requestMethod != "HEAD") {
                        doOutput = true
                    }
                }
            } catch (e: Exception) {
                postResult(id, errorPayload(e))
                return@execute
            }

            active[id] = connection
            var handedOff = false
            try {
                if (connection.doOutput && !bodyBase64.isNullOrEmpty()) {
                    // Bytes exactly as the page's fetch() serialized them (nova-bridge.js).
                    connection.outputStream.use { it.write(Base64.decode(bodyBase64, Base64.NO_WRAP)) }
                }

                val code = connection.responseCode

                // ── Download interception ─────────────────────────────────────
                // Content-Disposition: attachment means "save this, don't render
                // it". Hand the already-open connection to the native downloader
                // (it streams straight to disk — the body is NEVER read into JS
                // memory) and resolve the engine's fetch with a benign empty page.
                val contentDisposition = connection.getHeaderField("Content-Disposition") ?: ""
                val contentType = connection.getHeaderField("Content-Type") ?: ""
                if (code in 200..399 && contentDisposition.contains("attachment", ignoreCase = true)) {
                    handedOff = true
                    active.remove(id)
                    downloader.startFromConnection(
                        url = connection.url.toString(),
                        connection = connection,
                        disposition = contentDisposition,
                        mimeType = contentType.split(";")[0].trim().ifEmpty { null },
                        requestHeaders = requestHeadersMap(headersJson)
                    )
                    val benign = JSONObject()
                    benign.put("status", 200)
                    benign.put("statusText", "OK")
                    val respHeaders = JSONObject()
                    respHeaders.put("Content-Type", "text/html; charset=utf-8")
                    benign.put("headers", respHeaders)
                    benign.put("finalUrl", connection.url.toString())
                    benign.put(
                        "bodyText",
                        "<!DOCTYPE html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body></body></html>"
                    )
                    Log.i(TAG, "result[$id] download handoff: ${connection.url} ($contentDisposition)")
                    postResult(id, benign)
                    return@execute
                }

                val headers = JSONObject()
                connection.headerFields.forEach { (key, values) ->
                    if (key != null && !values.isNullOrEmpty()) {
                        headers.put(key, values.joinToString(", "))
                    }
                }

                val contentEncoding = connection.getHeaderField("Content-Encoding")?.trim()?.lowercase()
                val raw: InputStream? = if (code >= 400) connection.errorStream else connection.inputStream
                val bytes: ByteArray = try {
                    val stream: InputStream? = when (contentEncoding) {
                        "gzip" -> raw?.let { GZIPInputStream(it) }
                        "deflate" -> raw?.let { InflaterInputStream(it) }
                        else -> raw
                    }
                    if (stream == null) ByteArray(0) else readAll(stream)
                } catch (_: IOException) {
                    ByteArray(0)
                }

                if (contentEncoding == "gzip" || contentEncoding == "deflate") {
                    headers.remove("Content-Encoding")
                    headers.remove("Content-Length")
                }

                val textCharset = textCharsetFor(contentType)
                if (textCharset != null && textCharset != StandardCharsets.UTF_8 && contentType.isNotEmpty()) {
                    // The body below is decoded to a JS string; say so, so the engine never re-decodes it.
                    // Header names keep the server's casing; drop it case-insensitively so JS Headers
                    // doesn't merge two Content-Type values.
                    headers.keys().asSequence().toList()
                        .filter { it.equals("Content-Type", ignoreCase = true) }
                        .forEach { headers.remove(it) }
                    headers.put("Content-Type", contentType.substringBefore(';').trim() + "; charset=utf-8")
                }

                val result = JSONObject()
                result.put("status", code)
                result.put("statusText", connection.responseMessage ?: "")
                result.put("headers", headers)
                result.put("finalUrl", connection.url.toString())
                if (bytes.isNotEmpty()) {
                    if (textCharset == null) {
                        result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    } else {
                        result.put("bodyText", String(bytes, textCharset))
                    }
                }
                Log.i(TAG, "result[$id] status=$code bytes=${bytes.size} binary=${textCharset == null} finalUrl=${connection.url}")
                postResult(id, result)
            } catch (e: Exception) {
                Log.e(TAG, "error[$id] ${e.toString()}")
                postResult(id, errorPayload(e))
            } finally {
                active.remove(id)
                if (!handedOff) connection.disconnect()
            }
        }
    }

    @JavascriptInterface
    fun abort(id: String) {
        active.remove(id)?.disconnect()
    }

    private fun errorPayload(e: Exception): JSONObject {
        val result = JSONObject()
        result.put("status", 0)
        result.put("error", e.toString())
        return result
    }

    /** Extracts the JS-supplied request headers for the downloader to reuse (needed for resume). */
    private fun requestHeadersMap(headersJson: String): Map<String, String> {
        val map = LinkedHashMap<String, String>()
        try {
            val headers = JSONObject(headersJson)
            val keys = headers.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                map[key] = headers.getString(key)
            }
        } catch (_: Exception) {
        }
        map["Accept-Encoding"] = "identity"
        return map
    }

    private companion object {
        const val TAG = "NovaBridge"

        /**
         * HttpURLConnection.setRequestMethod() rejects PATCH (ProtocolException), which
         * broke every PATCH from web apps. Android's OkHttp-backed implementation reads
         * the protected `method` field directly, so set it there when the setter refuses.
         */
        fun setMethod(connection: HttpURLConnection, method: String) {
            try {
                connection.requestMethod = method
            } catch (e: java.net.ProtocolException) {
                HttpURLConnection::class.java.getDeclaredField("method").apply { isAccessible = true }.set(connection, method)
            }
        }
    }

    private fun postResult(id: String, payload: JSONObject) {
        val json = payload.toString()
        webView.post {
            webView.evaluateJavascript("window.__novaFetchResolve($id, $json);", null)
        }
    }

    private fun readAll(stream: InputStream): ByteArray {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(16 * 1024)
        while (true) {
            val n = stream.read(chunk)
            if (n < 0) break
            buffer.write(chunk, 0, n)
        }
        return buffer.toByteArray()
    }
}

/**
 * Charset to decode a response body to a JS string with, or null to pass it as raw
 * bytes. Only text-like types are decoded (so wasm, pdf, zip, octet-stream etc. keep
 * their exact bytes), using the declared charset rather than always UTF-8.
 */
internal fun textCharsetFor(contentType: String): Charset? {
    val type = contentType.substringBefore(';').trim().lowercase()
    val textLike = type.isEmpty() || type.startsWith("text/") ||
        (!type.startsWith("image/") && listOf("json", "javascript", "ecmascript", "xml").any { it in type })
    if (!textLike) return null
    val declared = Regex("charset\\s*=\\s*\"?([^\";\\s]+)", RegexOption.IGNORE_CASE).find(contentType)?.groupValues?.get(1)
    return declared?.let { runCatching { Charset.forName(it) }.getOrNull() } ?: StandardCharsets.UTF_8
}
