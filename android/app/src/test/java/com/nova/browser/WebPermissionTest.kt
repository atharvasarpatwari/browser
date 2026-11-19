package com.nova.browser

import android.Manifest
import android.webkit.PermissionRequest
import org.junit.Assert.assertArrayEquals
import org.junit.Test

class WebPermissionTest {
    private val video = PermissionRequest.RESOURCE_VIDEO_CAPTURE
    private val audio = PermissionRequest.RESOURCE_AUDIO_CAPTURE
    private val midi = PermissionRequest.RESOURCE_MIDI_SYSEX

    @Test
    fun videoCallGetsBothWhenBothGranted() {
        val granted = mapOf(Manifest.permission.CAMERA to true, Manifest.permission.RECORD_AUDIO to true)
        assertArrayEquals(arrayOf(video, audio), grantableResources(arrayOf(video, audio), granted))
    }

    @Test
    fun deniedMicIsWithheldFromPage() {
        val granted = mapOf(Manifest.permission.CAMERA to true, Manifest.permission.RECORD_AUDIO to false)
        assertArrayEquals(arrayOf(video), grantableResources(arrayOf(video, audio), granted))
    }

    @Test
    fun supersededAskGrantsNothingThatNeedsPermission() {
        assertArrayEquals(arrayOf(midi), grantableResources(arrayOf(video, midi), emptyMap()))
    }
}
