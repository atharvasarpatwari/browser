package com.nova.browser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.charset.Charset
import java.nio.charset.StandardCharsets.UTF_8

class FetchBodyEncodingTest {
    @Test
    fun textTypesDecodeWithDeclaredCharset() {
        assertEquals(UTF_8, textCharsetFor("text/html"))
        assertEquals(UTF_8, textCharsetFor(""))
        assertEquals(UTF_8, textCharsetFor("application/json"))
        assertEquals(UTF_8, textCharsetFor("application/javascript; charset=UTF-8"))
        assertEquals(Charset.forName("Shift_JIS"), textCharsetFor("text/html; charset=Shift_JIS"))
        assertEquals(Charset.forName("ISO-8859-1"), textCharsetFor("text/css;charset=\"iso-8859-1\""))
        assertEquals(UTF_8, textCharsetFor("text/plain; charset=bogus-charset"))
    }

    @Test
    fun binaryTypesKeepTheirBytes() {
        assertNull(textCharsetFor("application/wasm"))
        assertNull(textCharsetFor("application/octet-stream"))
        assertNull(textCharsetFor("application/pdf"))
        assertNull(textCharsetFor("image/png"))
        assertNull(textCharsetFor("image/svg+xml"))
        assertNull(textCharsetFor("font/woff2"))
        assertNull(textCharsetFor("video/mp4"))
    }
}
