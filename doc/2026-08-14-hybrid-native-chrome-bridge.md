# Hybrid Native Chrome — Compose UI driving the Engine via JS Bridge

**Date:** 2026-08-14
**Session:** Apply the engine↔Kotlin hybrid bridge (`new/` files), fix P0/P1 bugs, verify on device.
**Status:** Completed

---

## Summary

Applied the hybrid-native-chrome integration: the native Android Compose chrome
(address bar, tab strip, bookmarks/history) now drives the TypeScript engine's
tabs/navigation through a two-way JS bridge, replacing the old per-tab system
WebView (`BrowserWebView`). There is now exactly **one** WebView hosting the
engine for the app's lifetime; the engine owns all tab state and Kotlin only
reflects it and dispatches actions. Verified end-to-end on a Realme RMX5264
(Android 16): state snapshots flow engine→Kotlin, actions flow Kotlin→engine,
and native HTTP fetch returns 200.

## Root Causes

### 1. AddressBar `progress` unresolved reference (compile error — P0)
**File:** `new/AddressBar.kt` (→ `android/.../ui/components/AddressBar.kt`)
**Problem:** The rewritten `AddressBar` dropped the `progress: Int` parameter
(engine snapshots only carry a boolean `loading` flag), but
`LinearProgressIndicator(progress = { progress / 100f })` still referenced the
now-undefined local `progress` → Kotlin would fail to compile.
**Fix:** Use the indeterminate overload, matching the data the engine actually sends:

```kotlin
LinearProgressIndicator(
    modifier = Modifier.fillMaxWidth().height(2.dp),
    color = MaterialTheme.colorScheme.primary,
    trackColor = Color.Transparent
)
```

### 2. `hideChromeUI` never applied on phones (functional bug — P1)
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `hideChromeUI` was only honoured in the DesktopLayout branch, but
the engine's `index.html` viewport meta (`width=device-width`) makes the phone
WebView report `innerWidth ≈ 360–412 < 768`, so **MobileLayout** is mounted —
where the engine's own status bar (20px), address bar (44px) and bottom nav
(5 dead buttons) render on top of the Compose chrome.
**Fix:** Hide the mobile chrome slots when `hideChromeUI` is set (wiring stays
intact; content untouched):

```ts
if (this.config.hideChromeUI) {
  if (areas.addressBar) areas.addressBar.style.display = 'none';
  if (areas.statusBar) areas.statusBar.style.display = 'none';
  if (areas.bottomNav) areas.bottomNav.style.display = 'none';
}
```

### 3. `BrowserViewModel` `optString(..., null)` type mismatch (warning)
**File:** `android/.../BrowserViewModel.kt:77`
**Problem:** `obj.optString("activeTabId", null)` passes `null` to a platform
`String` fallback → Kotlin inferred `Nothing?` (compile warning).
**Fix:** Guard with `isNull` and use the no-fallback overload:

```kotlin
activeTabId.value = if (obj.isNull("activeTabId")) null else obj.optString("activeTabId")
```

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Import `android-native-bridge`; DI `BrowserWindowPage({ hideChromeUI: isNativeHostPresent() })`; call `installAndroidNativeBridge(page)` after mount |
| `src/ui/pages/browser-window.ts` | Added `hideChromeUI` config, `onChromeState`/`offChromeState`/`getChromeState`/`createTab`/`closeTab`/`activateTabExternal`; loading-event → snapshot pushes; **+ mobile `hideChromeUI` fix (root cause #2)** |
| `tests/android-native-bridge.test.ts` | **+ mobile `hideChromeUI` regression test** (14 tests total) |
| `android/app/build.gradle` | Added `androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4` |
| `android/.../MainActivity.kt` | Compose entry point + `BrowserViewModel`; single engine WebView lifecycle |
| `android/.../BrowserViewModel.kt` | Mirrors engine snapshots; dispatches via `window.novaNative.*`; **warning fix (root cause #3)** |
| `android/.../ui/BrowserScreen.kt` | Compose chrome over `EngineWebView`; `LibrarySheet` (bookmarks/history) |
| `android/.../ui/components/AddressBar.kt` | **P0 fix (root cause #1)**; read-only display URL |
| `android/.../model/Tab.kt` | New `Tab(id,url,title,active,pinned,loading)` matching `ChromeStateSnapshot`; `Bookmark`/`HistoryEntry` unchanged |
| `android/.../webview/BrowserWebView.kt` | **Deleted** (old per-tab WebView + empty `webview/` folder) |

## Files Created

| File | Purpose |
|------|---------|
| `src/app/android-native-bridge.ts` | Detects `NovaStateBridge`, installs `window.novaNative`, pushes `ChromeStateSnapshot` JSON to Kotlin |
| `android/.../NovaStateBridge.kt` | `@JavascriptInterface` receiving `onStateChanged(json)`; marshals to main looper |
| `android/.../ui/components/EngineWebView.kt` | Single WebView: `WebViewAssetLoader`, `NovaFetchBridge` + `NovaStateBridge` registered before `loadUrl()`, engine host |

## Test Results

```
npx tsc --noEmit                                    → 5 errors, ALL pre-existing
    (uncommitted stacking.ts/paint-engine.ts/rasterizer.ts changed StackingContext
     & IPaintEngine; tests/compositing/* + page-renderer.test.ts mocks stale — 0 NEW errors)
npx vitest run tests/android-native-bridge.test.ts  → 14 passed (13 original + 1 mobile regression)
npm run build:web                                   → ✓ built (main-BfhWhm9K.js)
node android/scripts/copy-web.mjs                   → Bridge injected; assets copied
gradlew assembleDebug                               → BUILD SUCCESSFUL (2m27s incremental)
gradlew installDebug                                → Installed on RMX5264
```

## Verification Steps

On-device (Realme RMX5264, Android 16, arm64-v8a), via logcat + uiautomator + CDP:
1. App launches, top-resumed activity, no `AndroidRuntime` crashes.
2. `[AndroidNativeBridge] Native host detected — window.novaNative installed, chrome UI hidden.`
3. Compose chrome rendered: address bar + Back/Forward/Reload/Bookmark/New tab/Close tab/Bookmarks & History; initial engine tab `about:blank` mirrored into Compose.
4. Address-bar submit → `window.novaNative.navigate('https://example.com')` → engine committed `https://example.com/`.
5. Native fetch: `NovaBridge: fetch[1] GET https://example.com/ redirect=manual` → `result[1] status=200 bytes=559`.
6. Snapshot pushed back to Kotlin: Compose address bar now displays `example.com` (state round-trip proven).
7. `hideChromeUI` verified active on the phone viewport (MobileLayout) — no duplicate engine chrome in the hierarchy dump.

## Known Follow-ups (deferred)

- Bookmarks/history not synced with the engine's `IBookmarkService`/`IHistoryService` (native-local only).
- `MainActivity.releaseWebView()` calls `destroy()` while the WebView is still attached — harden with detach-first.
- Deprecated `onBackPressed()` override is dead code (Compose `BackHandler` already handles back) — remove.
- Hardcoded `https://www.google.com` default in `BrowserViewModel.newTab()` — derive from engine home page instead.
