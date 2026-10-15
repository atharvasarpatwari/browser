package com.nova.browser

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class DownloadRedirectTest {
    // Minimal HTTP/1.1 server (unit tests compile against android.jar, so no com.sun HttpServer).
    private val routes = mapOf(
        "/start" to "301 Moved\r\nLocation: /hop",
        "/hop" to "302 Found\r\nLocation: final.bin",
        "/loop" to "302 Found\r\nLocation: /loop",
        "/to-file" to "302 Found\r\nLocation: file:///etc/hosts",
    )
    private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    private val base = "http://127.0.0.1:${server.localPort}"

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
}
