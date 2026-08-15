# Native Download Bridge Fix — Kotlin Name-Shadowing Recursion

**Date:** 2026-08-15
**Session:** Phase 1.1 (downloads) on-device verification follow-up
**Status:** Completed

---

## Summary
Fixed the broken JS → Kotlin download bridge (`window.novaNative.download(...)` / `NovaStateBridge.onDownloadRequested`). The direct bridge path never reached `startDownloadFromBridge` because of a Kotlin member-function/constructor-property name collision that caused infinite message self-reposting on the main looper. Also added lifecycle logging to `NativeDownloader` to make download start/completed/failed events observable in logcat.

## Root Causes

### 1. Member function shadowed constructor property of the same name
**File:** `android/app/src/main/java/com/nova/browser/NovaStateBridge.kt`
**Problem:** The constructor parameter property `onDownloadRequested` (a `(json: String) -> Unit` callback) shared its name with the `@JavascriptInterface` member function `onDownloadRequested`. Inside the marshaled lambda, the call `onDownloadRequested(json)` resolved to the **member function** (function declarations shadow same-named properties in invocation context), not the callback property. Each invocation therefore posted *another* copy of itself to `mainHandler` instead of calling `viewModel.startDownloadFromBridge(json)`. The chain grew unboundedly (silent on logcat; no file ever created) and `NativeDownloader.start()` never ran.
**Fix:** Renamed the constructor property to `onDownloadRequest` and updated the named-argument call site:

```kotlin
class NovaStateBridge(
    private val onSnapshot: (json: String) -> Unit,
    private val onBookmarks: (json: String) -> Unit,
    private val onHistory: (json: String) -> Unit,
    private val onDownloadRequest: (json: String) -> Unit   // was onDownloadRequested
) {
    @JavascriptInterface
    fun onDownloadRequested(json: String) {
        Log.d(TAG, "onDownloadRequested len=${json.length}")   // entry probe
        mainHandler.post {
            try { onDownloadRequest(json) } catch (e: Exception) { Log.e(TAG, "Failed to handle download request", e) }
        }
    }
```

```kotlin
// ui/components/EngineWebView.kt
onDownloadRequest = { json -> viewModel.startDownloadFromBridge(json) }   // was onDownloadRequested
```

### 2. Downloads invisible in logcat
**File:** `android/app/src/main/java/com/nova/browser/NativeDownloader.kt`
**Problem:** Download lifecycle events were silent, making on-device diagnosis (start vs. stream-failure vs. never-invoked) impossible.
**Fix:** Added `Log.i(TAG, "start[...]...")`, `Log.i(TAG, "completed[...]...")`, `Log.i(TAG, "paused[...]...")`, `Log.i(TAG, "cancelled[...]...")`, `Log.e(TAG, "failed[...]...")` plus a `TAG` companion const, and entry `Log.d` probes in all four `NovaStateBridge` methods.

## Diagnostic Trail (why it took 3 attempts to isolate)
1. First CDP test of `window.novaNative.download(...)` produced no `NativeDownloader` logs and no file; the parallel fetch-handoff path worked (it goes through `NovaFetchBridge`, bypassing the state bridge).
2. CDP probe confirmed `window.NovaStateBridge` exposed all 4 methods and calling `onDownloadRequested` returned without throwing — Java-side was the only place left to fail.
3. After adding entry probes, a fresh run logged `NovaStateBridge: onDownloadRequested len=153` → `NativeDownloader: start[...]` → `completed[...]` — proving the invocation now reaches Kotlin.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/NovaStateBridge.kt` | Renamed constructor property to `onDownloadRequest`; added `Log.d` entry probes to all 4 `@JavascriptInterface` methods |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | Named-arg call site updated to `onDownloadRequest =` |
| `android/app/src/main/java/com/nova/browser/NativeDownloader.kt` | Added `TAG` + start/completed/paused/cancelled/failed lifecycle logs |

## Files Created
| File | Purpose |
|------|---------|
| (none) | — |

## Test Results
```
npx tsc --noEmit              -> 5 errors (all pre-existing, unchanged)
npx vitest run                -> 192 files passed / 8727 tests passed
gradlew :app:assembleDebug    -> BUILD SUCCESSFUL in 17s / 8s (clean)
```

## Verification Steps (on device KNEUZTEE6TIBAIIV)
1. `adb install -r` rebuilt APK; `am force-stop` + `monkey` fresh launch; forwarded `webview_devtools_remote_<pid>` → :9222.
2. CDP probe: `window.NovaStateBridge` exposes exactly `onBookmarksChanged/onDownloadRequested/onHistoryChanged/onStateChanged`; `window.novaNative.download` present.
3. Direct call `window.NovaStateBridge.onDownloadRequested({...probe-direct.zip...})`:
   - logcat: `NovaStateBridge: onDownloadRequested len=153` → `NativeDownloader: start[dl-...] ... -> probe-direct.zip` → `completed[...] probe-direct.zip (351 bytes)`
   - file confirmed: `/storage/emulated/0/Android/data/com.nova.browser/files/Downloads/probe-direct.zip` (351 B)
4. Real bridge path `window.novaNative.download('https://github.com/octocat/Hello-World/archive/refs/heads/master.zip', {filename:'via-bridge.zip'})`:
   - logcat: `start[dl-...] -> via-bridge.zip` → `completed[...] via-bridge.zip (351 bytes)`
   - file confirmed on disk. **Previously failing path now works.**
5. Fetch-handoff path (`Hello-World-master.zip`, engine `fetch` intercepted by `NovaFetchBridge`) regression intact.
