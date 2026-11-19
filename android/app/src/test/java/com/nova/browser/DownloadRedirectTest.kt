package com.nova.browser

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import javax.net.ssl.HttpsURLConnection
import kotlin.concurrent.thread

class DownloadRedirectTest {
    // Minimal HTTP/1.1 server (unit tests compile against android.jar, so no com.sun HttpServer).
    private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    private val base = "http://127.0.0.1:${server.localPort}"
    private val routes = mapOf(
        "/start" to "301 Moved\r\nLocation: /hop",
        "/hop" to "302 Found\r\nLocation: final.bin",
        "/loop" to "302 Found\r\nLocation: /loop",
        "/to-file" to "302 Found\r\nLocation: file:///etc/hosts",
        "/to-https" to "301 Moved\r\nLocation: https://127.0.0.1:${server.localPort}/final.bin",
    )

    init {
        thread(isDaemon = true) {
            while (!server.isClosed) {
                val socket = runCatching { server.accept() }.getOrNull() ?: break
                socket.use { s ->
                    val path = s.getInputStream().bufferedReader().readLine()?.split(" ")?.getOrNull(1)
                    val head = routes[path]
                    val response = if (head != null) "HTTP/1.1 $head\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    else "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\npayload"
                    s.getOutputStream().apply { write(response.toByteArray()); flush() }
                }
            }
        }
    }

    @After fun stop() = server.close()

    @Test
    fun followsRelativeRedirectChainToTheRealFile() {
        val conn = openFollowingRedirects("$base/start", emptyMap())
        assertEquals(200, conn.responseCode)
        assertEquals("$base/final.bin", conn.url.toString())
        assertEquals("payload", conn.inputStream.bufferedReader().readText())
    }

    @Test
    fun redirectLoopFailsInsteadOfSavingA3xxBody() {
        assertThrows(IOException::class.java) { openFollowingRedirects("$base/loop", emptyMap()) }
    }

    @Test
    fun refusesRedirectToNonHttpScheme() {
        assertThrows(IOException::class.java) { openFollowingRedirects("$base/to-file", emptyMap()) }
    }

    /**
     * The http->https hop HttpURLConnection will not make on its own. The loopback server
     * speaks plain HTTP, so the handshake cannot complete; what this pins is that the hop is
     * taken at all -- accepted by the scheme guard and opened as a TLS connection on the
     * redirect target -- rather than the 3xx being returned and saved as the download.
     */
    @Test
    fun crossesHttpToHttps() {
        val hops = mutableListOf<HttpURLConnection>()
        runCatching { openFollowingRedirects("$base/to-https", emptyMap()) { hops += it } }

        assertEquals(2, hops.size)
        val second = hops[1]
        assertEquals("https://127.0.0.1:${server.localPort}/final.bin", second.url.toString())
        assertTrue("second hop must be a TLS connection", second is HttpsURLConnection)
    }
}
