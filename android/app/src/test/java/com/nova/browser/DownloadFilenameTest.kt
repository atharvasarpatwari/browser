package com.nova.browser

import org.junit.Assert.assertEquals
import org.junit.Test

class DownloadFilenameTest {
    @Test
    fun duplicateDownloadsGetNumberedNames() {
        assertEquals("report.pdf", numberedFilename("report.pdf", 0))
        assertEquals("report (1).pdf", numberedFilename("report.pdf", 1))
        assertEquals("archive.tar (2).gz", numberedFilename("archive.tar.gz", 2))
        assertEquals("download (3)", numberedFilename("download", 3))
    }
}
