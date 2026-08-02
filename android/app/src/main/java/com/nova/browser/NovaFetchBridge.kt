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
class NovaFetchBridge(private val webView: WebView) {

    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val active = ConcurrentHashMap<String, HttpURLConnection>()

    @JavascriptInterface
    fun fetch(id: String, method: String, url: String, headersJson: String, redirectMode: String, body: String?) {
        Log.i(TAG, "fetch[$id] $method $url redirect=$redirectMode")
        executor.execute {
            val connection = try {
                (URL(url).openConnection() as HttpURLConnection).apply {
                    requestMethod = method.uppercase()
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
                    if (!body.isNullOrEmpty() && requestMethod != "GET" && requestMethod != "HEAD") {
                        doOutput = true
                    }
                }
            } catch (e: Exception) {
                postResult(id, errorPayload(e))
                return@execute
            }

            active[id] = connection
            try {
                if (connection.doOutput && !body.isNullOrEmpty()) {
                    connection.outputStream.use { it.write(body.toByteArray(StandardCharsets.UTF_8)) }
                }

                val code = connection.responseCode
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

                val contentType = connection.getHeaderField("Content-Type") ?: ""
                val isBinary = contentType.startsWith("image/") || contentType.startsWith("font/") ||
                    contentType.startsWith("audio/") || contentType.startsWith("video/")

                val result = JSONObject()
                result.put("status", code)
                result.put("statusText", connection.responseMessage ?: "")
                result.put("headers", headers)
                result.put("finalUrl", connection.url.toString())
                if (bytes.isNotEmpty()) {
                    if (isBinary) {
                        result.put("bodyBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
                    } else {
                        result.put("bodyText", String(bytes, StandardCharsets.UTF_8))
                    }
                }
                Log.i(TAG, "result[$id] status=$code bytes=${bytes.size} binary=$isBinary finalUrl=${connection.url}")
                postResult(id, result)
            } catch (e: Exception) {
                Log.e(TAG, "error[$id] ${e.toString()}")
                postResult(id, errorPayload(e))
            } finally {
                active.remove(id)
                connection.disconnect()
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

    private companion object {
        const val TAG = "NovaBridge"
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
