# Nova Android — Fetch Bridge: Parallel Requests & Correct Bodies (v1.4)

**Date:** 2026-10-15
**Session:** "keep improving the nova app and note the changes". This is the fifth Nova round today, after `2026-10-15-nova-android-download-fixes.md` (v1.3). It audits `NovaFetchBridge.kt`, the native HTTP transport every engine request goes through.
**Status:** Completed (build + unit tests). Not run on a device.

---

## Summary

Engine network requests now run in parallel instead of one at a time. Response bodies keep their exact bytes for non-text types (wasm, pdf, zip, octet-stream) and are decoded with the server's declared charset instead of always UTF-8. Version 1.4 (code 5).

Also checked, no change needed: a page can't make the bridge read `file:`/`content:` URLs. `URL(...).openConnection() as HttpURLConnection` throws `ClassCastException` for non-http(s) schemes, and that's caught and returned as an error payload.

## Root Causes

### 1. Every engine request ran on a single thread
**File:** `android/app/src/main/java/com/nova/browser/NovaFetchBridge.kt`
**Problem:** `Executors.newSingleThreadExecutor()`. A page with 50 subresources fetched them strictly one after another. A single slow response (long-poll, slow CDN, or a dead host up to the 30 s connect + 45 s read timeouts) blocked every request queued behind it, including the next navigation.
**Fix:**
```kotlin
// ponytail: fixed pool of 8, no per-host cap; HttpURLConnection keep-alive still pools per host.
private val executor: ExecutorService = Executors.newFixedThreadPool(8)
```
Results resolve by request `id` (`window.__novaFetchResolve(id, …)`), so nothing depends on completion order.

### 2. Non-media binary responses were corrupted
**Problem:** Only `image/`, `font/`, `audio/`, `video/` were sent as `bodyBase64`. Everything else went through `String(bytes, UTF_8)`, so `application/wasm`, `application/octet-stream`, `application/pdf`, `application/zip` and similar had invalid UTF-8 sequences replaced with U+FFFD. WebAssembly modules and any binary `fetch()` from a page came back broken.
**Fix:** The decision is inverted. Only text-like types (`text/*`, empty type, or anything containing `json`/`javascript`/`ecmascript`/`xml`, except `image/svg+xml`, which stays bytes as before) become `bodyText`. Everything else is sent as bytes. This is never worse for `Response.text()` consumers, because UTF-8-decoding the raw bytes in JS gives exactly what the old native decode did.

### 3. Non-UTF-8 pages were mis-decoded
**Problem:** Text was always decoded as UTF-8, ignoring `Content-Type: text/html; charset=Shift_JIS` / `ISO-8859-1` / `windows-1251` and so on, which produced mojibake on those sites.
**Fix:** `textCharsetFor()` uses the declared charset (unknown names fall back to UTF-8). Since the body then reaches JS as an already-decoded string, the `Content-Type` header is rewritten to `charset=utf-8` so the engine never decodes it a second time. The existing header is removed case-insensitively first, because `HttpURLConnection` keeps the server's casing and JS `Headers` would otherwise merge two values.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/NovaFetchBridge.kt` | 8-thread pool; `textCharsetFor()`; charset-aware decode + header rewrite; bytes for all non-text types |
| `android/app/build.gradle` | version 1.4 (code 5) |

## Files Created
| File | Purpose |
|------|--------|
| `android/app/src/test/java/com/nova/browser/FetchBodyEncodingTest.kt` | text types get the declared charset (Shift_JIS, quoted ISO-8859-1, bogus name → UTF-8); wasm, octet-stream, pdf, png, svg, woff2, mp4 → bytes |
| `doc/2026-10-15-nova-android-fetch-bridge-fixes.md` | This changelog |

## Test Results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease
BUILD SUCCESSFUL in 3m 53s   (0 warnings)
com.nova.browser.DownloadFilenameTest  tests 1  fail 0 err 0
com.nova.browser.DownloadRedirectTest  tests 3  fail 0 err 0
com.nova.browser.ExternalLinkTest      tests 1  fail 0 err 0
com.nova.browser.FetchBodyEncodingTest tests 2  fail 0 err 0
com.nova.browser.UrlInputResolverTest  tests 18 fail 0 err 0
com.nova.browser.WebPermissionTest     tests 3  fail 0 err 0
after version bump: BUILD SUCCESSFUL in 1m 12s
aapt2: versionCode='5' versionName='1.4'; apksigner verify OK; textCharsetFor present in R8 mapping
```

## Verification Steps
- Unit-tested the body-encoding decision, which decides whether bytes survive.
- **On device:** load an image-heavy page and compare time-to-full-render against 1.3 (expect a large improvement). Open a Shift_JIS or ISO-8859-1 site and expect correct characters. Open a page that loads a `.wasm` module.

## What's new in Nova 1.4 (user-facing)
- Pages load much faster: images, scripts, and styles now download in parallel instead of one at a time, and one slow file no longer holds up the whole page.
- Sites in non-UTF-8 encodings (many Japanese, Russian, and older European sites) display correctly.
- Pages that fetch binary data (WebAssembly apps, PDFs, file downloads via script) get uncorrupted bytes.
