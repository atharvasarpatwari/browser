# Nova Android — Download Fixes (v1.3)

**Date:** 2026-10-15
**Session:** "keep improving the nova app and note the changes". This is the fourth Nova round today, after `2026-10-15-nova-android-renderer-crash-recovery.md` (v1.2). It audits `NativeDownloader.kt`.
**Status:** Completed (build + unit tests, including a real-socket redirect test). Not run on a device.

---

## Summary

Fixed four bugs in Nova's native downloader:
- a crash when a page-initiated download drops;
- same-name downloads corrupting or overwriting each other;
- redirect responses being saved as the downloaded file;
- missing sizes for files over 2 GB.

Version 1.3 (code 4).

## Root Causes

### 1. A dropped connection during a page-initiated download crashed the app
**File:** `android/app/src/main/java/com/nova/browser/NativeDownloader.kt` (`startFromConnection`)
**Problem:** When a page's own fetch turns out to be an attachment, `NovaFetchBridge` hands its open connection to `startFromConnection`. That path ran `streamFrom()` on an executor thread with **no try/catch**, unlike `runDownload()`. Any `IOException` (network drop, timeout, disk full) went uncaught, and on Android an uncaught exception on any thread kills the process.
**Fix:**
```kotlin
executor.execute {
    try {
        connection.readTimeout = 0
        streamFrom(state, connection)
    } catch (e: Exception) {
        // Uncaught exceptions on a worker thread kill the app process on Android.
        handleStreamError(state, e)
    } finally {
        connections.remove(id)
        emit(state)
    }
}
```

### 2. Downloads with the same name shared one file
**Problem:** The `.part` and final paths were just `Downloads/<name>`. Two concurrent downloads of `report.pdf` wrote into the same `report.pdf.part`, corrupting both. Downloading it again later overwrote the first file through `renameTo`, and removing either entry from the list then deleted the file the other entry pointed to.
**Fix:** `register()` (replacing `initialState()` + a separate `states[id] = state`) is `@Synchronized` and picks the first name not used by another download or an existing file: `report.pdf`, then `report (1).pdf`, `report (2).pdf`, and so on (`numberedFilename`). `startFromConnection`'s triple-repeated `copy(filename = sanitize(...))` was collapsed into the same call.

### 3. Redirects were saved as the file
**Problem:** `HttpURLConnection` follows redirects only within the same protocol. An `http://` link redirecting to `https://` (very common) came back as the raw 301/302. `streamFrom` only rejected `code >= 400`, so the redirect's empty or HTML body was saved as the download and marked COMPLETED.
**Fix:** `openFollowingRedirects()` follows up to 10 hops itself (`instanceFollowRedirects = false`, relative `Location` resolved against the current URL). It refuses non-http(s) targets and fails on loops. Each hop's connection is registered so pause and cancel still work mid-redirect. `streamFrom` now requires `code in 200..299`.

### 4. Files over 2 GB had no size or progress
**Problem:** `connection.contentLength` is an `Int` and returns `-1` past 2^31 bytes, so large downloads showed no total, progress, or ETA.
**Fix:** `contentLengthLong` (API 24+, minSdk 26) for both fresh and resumed downloads.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/NativeDownloader.kt` | try/catch on the adopted-connection path; `register()` with unique names; `openFollowingRedirects()`; 2xx-only; `contentLengthLong`; `numberedFilename()` |
| `android/app/build.gradle` | version 1.3 (code 4) |

## Files Created
| File | Purpose |
|------|--------|
| `android/app/src/test/java/com/nova/browser/DownloadFilenameTest.kt` | `report.pdf` → `report (1).pdf`; multi-dot and extension-less names |
| `android/app/src/test/java/com/nova/browser/DownloadRedirectTest.kt` | real loopback `ServerSocket` server: 301 → 302 (relative) → 200 delivers the payload; redirect loop throws; redirect to `file:` throws |
| `doc/2026-10-15-nova-android-download-fixes.md` | This changelog |

## Test Results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease
first attempt: DownloadRedirectTest used com.sun.net.httpserver -> "Unresolved reference: sun"
  (unit tests compile against android.jar) -> rewrote with java.net.ServerSocket
BUILD SUCCESSFUL in 56s   (0 warnings)
com.nova.browser.DownloadFilenameTest tests 1  fail 0 err 0
com.nova.browser.DownloadRedirectTest tests 3  fail 0 err 0
com.nova.browser.ExternalLinkTest     tests 1  fail 0 err 0
com.nova.browser.UrlInputResolverTest tests 18 fail 0 err 0
com.nova.browser.WebPermissionTest    tests 3  fail 0 err 0
after version bump: BUILD SUCCESSFUL in 1m 10s
aapt2: versionCode='4' versionName='1.3'; apksigner verify OK; 1,429,240 B
R8 mapping contains numberedFilename / openFollowingRedirects (48 matching lines incl. earlier rounds)
```
The APK's total byte size matches v1.1 and v1.2 because the v2 signing block pads the file to a 4 KB boundary. `classes.dex` itself changed (1,838,164 B raw), confirmed via the mapping above.

## Verification Steps
- Unit-tested the redirect follower against a real socket server. The cross-protocol case can't be exercised without TLS, but it uses the same loop.
- **On device:** download the same file twice and expect `name.pdf` and `name (1).pdf`, both openable. Download an `http://` link that redirects to `https://` and expect real content, not a 0-byte or HTML file. Turn on airplane mode mid-download and expect FAILED in the downloads sheet while the app stays open.

## What's new in Nova 1.3 (user-facing)
- Downloading the same file twice keeps both copies (`report.pdf`, `report (1).pdf`) instead of overwriting.
- Downloads behind a redirect (http → https) save the real file.
- Large downloads over 2 GB show their size and progress.
- Losing your connection during certain downloads no longer closes Nova.
