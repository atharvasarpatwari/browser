# Nova Android — Request Bodies & PATCH (v1.5)

**Date:** 2026-10-15
**Session:** "keep improving the nova app and note the changes". This is the sixth Nova round today, after `2026-10-15-nova-android-fetch-bridge-fixes.md` (v1.4); that round fixed responses, and this one fixes requests. The emulator is still blocked on the AEHD driver install (`emulator -accel-check` → *not installed*).
**Status:** Completed (build + unit tests + JS shim tests). Not run on a device.

---

## Summary

Form posts, file uploads, and binary request bodies from pages were silently sent **empty**, and every `PATCH` request failed. Both are fixed. Version 1.5 (code 6).

## Root Causes

### 1. Non-string request bodies were dropped
**File:** `android/bridge/nova-bridge.js` (copied to `android/app/src/main/assets/nova-bridge.js`)
**Problem:** The fetch shim's `bodyToString()` only forwarded `string` and `URLSearchParams`, and returned `null` for everything else. So `FormData` (every multipart form post and file upload), `Blob`/`File`, `ArrayBuffer`, typed arrays, and streams reached the server as an empty body. Even when a body did get through, the shim never added the `Content-Type` that real `fetch()` implies. For `FormData`, that header carries the multipart boundary, so a server can't parse the body without it.
**Fix:** Let the browser serialize the body exactly as real `fetch()` would, then send the bytes as base64:
```js
function serializeBody(url, method, input, init) {
  var source = null;
  if (init && init.body != null) {
    source = new Request(url, { method: method, body: init.body, duplex: 'half' });
  } else if (typeof Request !== 'undefined' && input instanceof Request && input.body) {
    source = input.clone();
  }
  if (!source) return Promise.resolve(null);
  return source.arrayBuffer().then(function (buffer) {
    return { base64: bytesToBase64(buffer), contentType: source.headers.get('content-type') };
  });
}
```
The implied `Content-Type` is added only when the engine didn't set one. Request **headers** still come from the engine's own `init.headers`, not from the `Request`, because `Request` silently drops forbidden names (`Cookie`, `Referer`, …) that Nova's engine manages itself. An abort that lands during serialization is honoured before the native call. The `NovaFetchBridge.fetch` contract changed from `bodyText` to `bodyBase64`, and the Kotlin side writes `Base64.decode(...)` bytes. Shim and native ship together in the APK, so there's no version skew.

### 2. `PATCH` always failed
**File:** `android/app/src/main/java/com/nova/browser/NovaFetchBridge.kt`
**Problem:** `HttpURLConnection.setRequestMethod()` accepts only GET/POST/HEAD/OPTIONS/PUT/DELETE/TRACE and throws `ProtocolException` for `PATCH`. The bridge caught that and rejected the page's `fetch()`, which breaks the REST APIs many web apps use for edits.
**Fix:** Try the setter first. On `ProtocolException`, set the protected `method` field, which Android's OkHttp-backed implementation reads directly:
```kotlin
fun setMethod(connection: HttpURLConnection, method: String) {
    try {
        connection.requestMethod = method
    } catch (e: java.net.ProtocolException) {
        HttpURLConnection::class.java.getDeclaredField("method").apply { isAccessible = true }.set(connection, method)
    }
}
```
This can only be proven on Android, because the desktop JVM blocks that reflection, so it's covered by new device check #14 rather than a JVM unit test.

## Correction to an earlier doc
The v1.4 README row and commit `ba3e3fd`'s message say "29/29 unit tests". The real count at v1.4 was **28** (18 + 3 + 1 + 1 + 3 + 2). The v1.4 doc's own per-class table was correct. The README row is fixed; the commit message can't be changed without rewriting history, so the correction is recorded here.

## Files Modified
| File | Change |
|------|--------|
| `android/bridge/nova-bridge.js` | `serializeBody()` + `bytesToBase64()` + `hasHeader()`; native call passes `bodyBase64`; implied Content-Type; abort-during-serialize |
| `android/app/src/main/assets/nova-bridge.js` | synced copy (byte-identical, `cmp`) |
| `android/app/src/main/java/com/nova/browser/NovaFetchBridge.kt` | `bodyBase64` param + decode; `setMethod()` PATCH fallback |
| `android/scripts/emulator-feature-test.mjs` | `/echo` server route + check #14 (PATCH, FormData, binary body) |
| `android/app/build.gradle` | version 1.5 (code 6) |
| `doc/README.md` | v1.4 row: 29/29 → 28/28 |

## Files Created
| File | Purpose |
|------|--------|
| `tests/nova-bridge-shim.test.ts` | 5 tests running the real shim against a stub native bridge in Node's environment (real `Request`/`FormData`/`Blob`): multipart with boundary; byte-exact binary and Blob; URLSearchParams Content-Type; engine Content-Type/Cookie/Referer preserved on PATCH; GET has no body; non-http URLs use the real fetch; pre-aborted requests never reach native |
| `doc/2026-10-15-nova-android-request-body-fixes.md` | This changelog |

## Test Results
```
npx vitest run tests/nova-bridge-shim.test.ts tests/android-native-bridge.test.ts
 Test Files  2 passed (2)
      Tests  42 passed (42)          (5 new + 37 existing)

cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug
BUILD SUCCESSFUL in 3m 38s   (0 warnings)
unit tests 28 all pass
R8 mapping: setMethod present
aapt2: versionCode='6' versionName='1.5'; apksigner verify OK
packaged assets/nova-bridge.js contains serializeBody: True
```

## Verification Steps
- Shim behaviour was verified with real Web-platform body serialization (Node's undici `Request`).
- **On device / emulator:** `npm run android:feature-test -- --adb <sdk>\platform-tools\adb.exe --only 14`. That covers PATCH reaching the server as PATCH, a FormData post arriving as multipart with the file bytes, and a binary PUT matching by SHA-256.

## What's new in Nova 1.5 (user-facing)
- Web forms that upload files or post `FormData` now actually send their data.
- Sites that save edits with `PATCH` requests (many web apps) work.
- Binary uploads (images, blobs) from pages arrive intact.
