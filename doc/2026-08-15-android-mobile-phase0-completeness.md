# Android Mobile App — Phase 0 Feature-Completeness (Correctness & Lifecycle)

**Date:** 2026-08-15
**Session:** First session of the approved all-phases (0–2) mobile feature-completeness plan. Phase 0 = correctness/lifecycle/data-loss fixes plus engine-derived home page and search engine.
**Status:** Completed

---

## Summary

Fixed four Android correctness/lifecycle defects (WebView destroy-while-attached crash, rotation/data-loss exposure, missing pause/resume/low-memory handling, dead `onBackPressed()` code) and removed the two hardcoded Google defaults in the mobile chrome (new-tab URL + search fallback) by pushing the engine's `homePage` and `defaultSearchEngine` settings to Kotlin through the existing `ChromeStateSnapshot` push channel. Verified end-to-end on device (Realme RMX5264, Android 16).

## Root Causes

### 1. `WebView.destroy()` called while the WebView is still attached
**File:** `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` (previous version)
**Problem:** `releaseWebView()` called `webView?.destroy()` directly. `WebView.destroy()` on a view still attached to its parent `ViewGroup` throws `IllegalStateException`. It also ran unconditionally, so a second call over a stale reference would double-destroy.
**Fix:** Detach from the parent first, null the reference, guard against double-destroy, and swallow teardown races with Compose:

```kotlin
fun releaseWebView() {
    val view = webView ?: return
    webView = null
    if (webViewDestroyed) return
    webViewDestroyed = true
    try { (view.parent as? android.view.ViewGroup)?.removeView(view) } catch (_: Exception) {}
    try { view.destroy() } catch (_: Exception) {}
}
```

### 2. Rotation could destroy the engine WebView and lose all tabs
**File:** `android/app/src/main/AndroidManifest.xml`
**Problem:** `configChanges` covered orientation/screenSize/keyboard only. `uiMode` (dark-mode toggle) and `screenLayout` (foldable/split-screen) changes recreate the Activity; because the engine WebView is created in Compose's `AndroidView` factory (once per composition), recreation means a brand-new WebView and a full engine restart with all tabs lost.
**Fix:** Added `screenLayout|uiMode` to `configChanges` so the single engine WebView and its tab state survive all configuration changes:

```xml
android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|keyboard|uiMode"
```

### 3. Hardcoded Google new-tab URL and search fallback in the mobile chrome
**Files:** `src/ui/pages/browser-window.ts`, `android/.../BrowserViewModel.kt` (previous versions)
**Problem:** `BrowserViewModel.newTab()` defaulted to `https://www.google.com` and `resolveInput()` built `https://www.google.com/search?q=` directly, ignoring the engine's `homePage` and `defaultSearchEngine` settings — desktop and Android disagreed.
**Fix:** The engine now resolves both from its `SettingsService` and ships them in `ChromeStateSnapshot` (no new round-trip plumbing — the Kotlin `applySnapshot` already receives every push):
- `browser-window.ts`: added `homeUrl`/`searchTemplate` fields to `ChromeStateSnapshot`; `getHomeUrl()` reads `homePage` (fallback `about:blank`); `getSearchTemplate()` maps the `defaultSearchEngine` setting (`google|bing|duckduckgo`) to a `%s` URL template.
- `BrowserViewModel.kt`: `applySnapshot()` parses the two new fields into state; `newTab(url = homeUrl.value)` and `resolveInput()` uses `searchTemplate.value.replace("%s", URLEncoder.encode(...))`.

### 4. Dead/duplicated back handling + missing WebView lifecycle hooks
**File:** `android/app/src/main/java/com/nova/browser/MainActivity.kt`
**Problem:** The deprecated `onBackPressed()` override duplicated Compose's `BackHandler` in `BrowserScreen.kt` (dead code). The Activity also never paused the WebView in the background (JS timers/video kept running) and never released memory under pressure.
**Fix:** Removed the `onBackPressed()` override; added `onPause()`/`onResume()` → `viewModel.pause()/resume()` (WebView `onPause/onResume`), and `onTrimMemory()` (≥ `TRIM_MEMORY_MODERATE`) → `viewModel.trimMemory()` (`WebView.freeMemory()`, `@Suppress("DEPRECATION")` for API 29+).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `ChromeStateSnapshot` + `homeUrl`/`searchTemplate`; `getHomeUrl()`/`getSearchTemplate()` from `SettingsService`; `SEARCH_URL_TEMPLATES` map |
| `tests/android-native-bridge.test.ts` | +2 tests (default snapshot fields; fields reflect `settingsService` values) → 20 total |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | Safe `releaseWebView()`; `pause()/resume()/trimMemory()`; `homeUrl`/`searchTemplate` state; `newTab()` default + `resolveInput()` from engine settings; `optString("activeTabId")` no-fallback warning fix |
| `android/app/src/main/java/com/nova/browser/MainActivity.kt` | Removed dead `onBackPressed()`; added `onPause`/`onResume`/`onTrimMemory` wiring |
| `android/app/src/main/AndroidManifest.xml` | `configChanges` += `screenLayout\|uiMode` |
| `android/app/src/main/assets/**` | Regenerated by `npm run build:web` + `copy-web.mjs` (new bundle hashes) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-08-15-android-mobile-phase0-completeness.md` | This change log |

## Test Results

```
npx tsc --noEmit
  -> 5 pre-existing errors ONLY in tests/compositing/*.test.ts and
     tests/page-renderer.test.ts (StackingContext 'translate',
     IPaintEngine 'setTransformResolver') — untouched, 0 new errors.

npx vitest run tests/android-native-bridge.test.ts
  -> 20 passed (20)  [previously 18]

npx vitest run
  -> Test Files 192 passed (192) / Tests 8725 passed (8725)

gradlew :app:assembleDebug
  -> BUILD SUCCESSFUL in 16s — Kotlin warnings resolved (freeMemory deprecation
     suppressed, optString null-fallback removed; only pre-existing deprecations
     for LibraryBooks/onReceivedError remain)
```

## Verification Steps (on-device, Realme RMX5264 / KNEUZTEE6TIBAIIV)

1. `npm run build:web` → `node android/scripts/copy-web.mjs` → `gradlew :app:assembleDebug` → `adb install -r` → cold launch `am start -W`.
2. Logcat: engine boots in-process, `[AndroidNativeBridge] Native host detected — window.novaNative installed, chrome UI hidden.`, `onPageFinished` for `index.html`. No `AndroidRuntime` crashes.
3. `dumpsys activity top`: `ACTIVITY com.nova.browser/.MainActivity mResumed=true` (top-resumed).
4. uiautomator dump: address bar shows `about:blank` (homeUrl default flows to Kotlin).
5. CDP (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`, `Runtime.evaluate`):
   `window.novaNative.getState()` → `{"homeUrl":"about:blank","searchTemplate":"https://www.google.com/search?q=%s", ...}` — new snapshot fields round-trip engine→Kotlin.
6. Rotation test: `settings put system user_rotation 1` then `0` — pid unchanged (12167), `logcat -c` buffer shows NO new `[Bootstrap]`/engine-reload lines ⇒ Activity not recreated, tabs/engine survive.

## Follow-ups (next sessions of the plan)

- **Phase 1.1:** Find-in-page bridge + native find bar; engine Downloads bridge + WebView `DownloadListener` + Downloads sheet.
- **Phase 1.2:** Long-press context menu (`HitTestResult`), `onCreateWindow` → engine tab, `onShowFileChooser` uploads, `onPermissionRequest` runtime-permission flow, incognito/private tabs.
- **Phase 2:** Native settings screen, per-entry history delete, share/copy URL, native error page, tab favicons.
