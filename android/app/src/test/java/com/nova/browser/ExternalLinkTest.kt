package com.nova.browser

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalLinkTest {
    @Test
    fun onlyHttpLinksFromOtherAppsAreOpened() {
        assertTrue(isWebLink("https://example.com/a?b=c"))
        assertTrue(isWebLink("HTTP://EXAMPLE.COM"))
        assertFalse(isWebLink("javascript:alert(1)"))
        assertFalse(isWebLink("file:///sdcard/x.html"))
        assertFalse(isWebLink("intent://scan#Intent;end"))
        assertFalse(isWebLink("example.com"))
    }
}
