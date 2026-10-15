# Nova Android — Renderer Crash Recovery (v1.2)

**Date:** 2026-10-15
**Session:** "keep improving the nova app and note the changes". This is the third Nova round today, after `2026-10-15-nova-android-web-permission-fixes.md` (v1.1).
**Status:** Completed (build + unit tests). Emulator run attempted and blocked; see Verification.

---

## Summary

Nova no longer crashes when the WebView's renderer process dies. It rebuilds the engine WebView in place. Also removed a redundant destroy-guard flag that would have blocked cleanup of a rebuilt WebView, and bumped the version to 1.2 (code 3).

## Root Causes

### 1. A renderer crash or low-memory kill took down the whole app
**File:** `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt`
**Problem:** Since Android 8, WebView pages run in a separate renderer process, which the system kills under memory pressure, and which can also crash. The `WebViewClient` didn't override `onRenderProcessGone`, so WebView's default behaviour applied: it kills the host app ("Render process's crash wasn't handled by all associated webviews"). On a low-RAM phone, backgrounding Nova and coming back could crash it.
**Fix:** Handle it, keep the app alive, and swap in a fresh WebView:
```kotlin
override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
    Log.e(TAG, "Renderer gone (didCrash=${detail.didCrash()}); rebuilding engine WebView")
    viewModel.onRendererGone()
    return true
}
```
```kotlin
// BrowserViewModel
fun onRendererGone() {
    releaseWebView()          // detach + destroy the dead WebView (must never be reused)
    engineGeneration.value++  // BrowserScreen keys EngineWebView on this
}
```
```kotlin
// BrowserScreen
key(viewModel.engineGeneration.value) {
    EngineWebView(viewModel = viewModel, modifier = Modifier.fillMaxSize())
}
```
`releaseWebView()` already resets `engineReady`, so a link from another app that arrives mid-rebuild is queued until the new engine's first snapshot (the v1.1 queue).

### 2. Destroy-guard flag would have leaked a rebuilt WebView
**File:** `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt`
**Problem:** `releaseWebView()` set `webViewDestroyed = true` permanently and returned early whenever it was set. With the WebView now rebuildable, the second WebView would never have been destroyed on exit. The flag was also redundant, because `webView ?: return` followed by `webView = null` already prevents a double destroy.
**Fix:** Deleted the flag.

## Investigated, not changed
- **Page file uploads (`<input type=file>`):** the native picker (`onShowFileChooser`) ignores `accept` and `multiple`. But no engine code creates a real host `<input type=file>` (grep of `src/`), and `src/browser/media/file-system.ts` is a simulated picker. So the native picker most likely never opens for page uploads, and tuning its options would change nothing. The real fix is engine-side: route page file inputs to a host `<input type=file>`. That's out of scope for an APK round and is flagged for a separate session. This also means the manual-checklist item "file upload" will probably fail on a device.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | `onRenderProcessGone` handler; header comment updated |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | `engineGeneration` + `onRendererGone()`; removed `webViewDestroyed` |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | `key(engineGeneration)` around `EngineWebView` |
| `android/app/build.gradle` | version 1.2 (code 3) |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-15-nova-android-renderer-crash-recovery.md` | This changelog |

## Test Results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug
BUILD SUCCESSFUL in 4m 24s   (0 warnings)
com.nova.browser.ExternalLinkTest     tests 1  fail 0 err 0
com.nova.browser.UrlInputResolverTest tests 18 fail 0 err 0
com.nova.browser.WebPermissionTest    tests 3  fail 0 err 0
R8 mapping: onRenderProcessGone kept, BrowserViewModel.onRendererGone() inlined into it
after version bump: BUILD SUCCESSFUL in 1m 13s
aapt2 dump badging -> versionCode='3' versionName='1.2'; apksigner verify -> OK (1,429,240 B)
```

## Verification Steps
- Built and unit-tested as above, with no warnings.
- **Emulator attempt (failed, environment):** the `NovaEmu` AVD (android-34 google_apis x86_64) exists. Booting it failed with:
  ```
  ERROR | x86_64 emulation currently requires hardware acceleration!
  emulator -accel-check -> Android Emulator hypervisor driver is not installed on this machine
  ```
  Fixing this needs a system-level change the user has to make: install the Android Emulator hypervisor driver (SDK Manager → SDK Tools), or enable "Windows Hypervisor Platform" in Windows Features and reboot.
- **To verify renderer recovery on a device or emulator:** open a page in Nova, then run `adb shell am kill com.nova.browser:sandboxed_process0` (or open `chrome://crash` in an engine tab). Expected: Nova stays open, the engine reloads, and logcat shows `Renderer gone (didCrash=...)`.

## What's new in Nova 1.2 (user-facing)
- Nova no longer closes itself when Android reclaims memory or a page's renderer crashes. The browser reloads in place.
