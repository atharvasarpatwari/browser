# Android App — Source-Level Feature Audit

**Date:** 2026-08-27
**Session:** Full read-through of the native Android app (Kotlin/Compose shell + hosted WebView engine) in response to "make me a mobile app and make sure all the features are working," followed up with a field-by-field JS↔Kotlin bridge contract cross-check in response to "test the mobile app." File-bridge access only — **no shell/Gradle access to the connected machine this session**, so this is a source-level audit, not a build-and-run verification.
**Status:** Audit completed. One real, actionable gap found (stale bundled engine). Bridge contract cross-checked with no mismatches found. Build/install/on-device verification still outstanding — see "What this session could not do."

---

## Summary

The Android app is not a stub — it's a complete, hybrid native shell (Kotlin/Compose chrome) hosting a single long-lived WebView that runs the real Nova engine (parser/layout/paint/JS-VM), loaded from bundled assets via `WebViewAssetLoader`. Every user-facing feature the desktop app has an Android equivalent of is implemented: tabs, address bar with search-template resolution, bookmarks + history (mirrored from the engine's real services), a natively-owned download manager (pause/resume/cancel/share/open, streaming HTTP with resume support, gzip/deflate decompression, completion notifications), a long-press context menu (open-in-new-tab/copy/share/save-image, resolved by the engine's own hit-testing), file-upload (`<input type=file>` -> document picker), runtime permission flows for camera/mic/notifications, incognito mode, and the "Nova Flash" visual redesign (gold/violet theme).

Read in full: `BrowserViewModel.kt`, `MainActivity.kt`, `NativeDownloader.kt`, `NovaFetchBridge.kt`, `NovaStateBridge.kt`, `model/Tab.kt`, `model/DownloadItem.kt`, `ui/BrowserScreen.kt`, `ui/components/{AddressBar,BookmarksSheet,ContextMenuSheet,DownloadsSheet,EngineWebView,ErrorPage,TabsBar}.kt`, `ui/theme/{Color,Theme,Type}.kt`, `AndroidManifest.xml`, `app/build.gradle`, `nova-bridge.js`, `android/scripts/copy-web.mjs`. No missing symbols, no unresolved references, no stub/TODO markers found anywhere in this pass — permissions declared in the manifest match exactly what the runtime-permission code paths need; the `FileProvider` authority matches `NativeDownloader`'s constant; every theme color referenced by a component (`SuccessGreen`, `IncognitoSurface`, `IncognitoContent`, etc.) is defined in `Color.kt`.

## The one real finding: the bundled engine is stale

`android/app/src/main/assets/assets/main-DJgCeaiI.js` (the actual JS engine bundle the WebView loads, per `index.html`'s script tag) is dated **2026-08-14** and is a different build (different content hash, different byte size — 1,263,931 bytes) from the current `dist/assets/main-BWMQ7o7L.js` (1,313,423 bytes, built 2026-08-27 during this session's earlier Windows build work).

This means the installed Android app — regardless of whether its Kotlin/Compose shell compiles cleanly — would be running an engine snapshot from **before** WebRTC Phase 1, before the 9-session rendering-pipeline rewrite finished, and before every fix and feature added since mid-August. The native shell and the engine it hosts have drifted apart because `android/scripts/copy-web.mjs` (which copies `dist/` into the Android assets folder and injects `nova-bridge.js`) hasn't been re-run since the last Android-focused session, even though the web build itself has moved forward many times since.

**This is the actual reason "make sure all the features are working" can't be answered yes yet** — not because anything in the Android-specific code is broken, but because the app isn't currently packaging the engine that has those features.

**Fix — one command, already wired up in `package.json`:**
```bash
npm run build:android
# = npm run build:web && node android/scripts/copy-web.mjs && cd android && gradlew.bat assembleDebug
```
To install straight to a connected device/emulator afterward: `npm run android:install` (or `cd android && gradlew.bat installDebug`).

## Confirmed already applied (contrary to what TODO.md/the roadmap still said)

The "Nova Flash" visual redesign — believed still-unapplied and tracked as the oldest open P0 item on the roadmap — is **already present** in `android/app/src/main/java/com/nova/browser/ui/theme/{Color,Theme,Type}.kt` and `res/values{,-night}/styles.xml`. Evidence: byte-for-byte size match against the staged `com/` mirror at the repo root (the redesign's source-of-truth), and the destination `styles.xml` files are directly present and correctly themed. What's still actually unverified is only the Gradle build + on-device visual check — not whether the source was ever applied.

## Bridge contract cross-check: `window.novaNative` / `NovaStateBridge`

Follow-up to "test the mobile app" — since there's still no way to build/install/click through the app from here, the next-best form of testing available is a field-by-field cross-check of the two-way JS↔Kotlin bridge contract (`src/app/android-native-bridge.ts` on the TS side, `BrowserViewModel.kt` + `NovaStateBridge.kt` on the Kotlin side, wired up in `src/app/main.ts`). A mismatch here — a missing method, a renamed JSON field — would be a real runtime bug invisible to a Kotlin-only or TS-only read.

**Wiring confirmed correct** (`src/app/main.ts`): `BrowserWindowPage` is constructed with `hideChromeUI: isNativeHostPresent()`, and `installAndroidNativeBridge(page)` is called right after `page.mount(container)` — exactly matching what the 2026-08-14 bridge changelog documented.

**Kotlin → JS (`window.novaNative`):** every method `BrowserViewModel.kt`'s `callEngine()` calls — `navigate`, `back`, `forward`, `reload`, `stop`, `createTab`, `closeTab`, `activateTab`, `getState`, `addBookmark`, `removeBookmark`, `refreshBookmarks`, `removeHistoryEntry`, `clearHistory`, `refreshHistory`, `download`, `openInNewTab`, `setIncognito` — is implemented in `android-native-bridge.ts`'s `window.novaNative` object. No missing methods.

**JS → Kotlin (`window.NovaStateBridge`):** all 5 methods Kotlin's `@JavascriptInterface` (`NovaStateBridge.kt`) exposes — `onStateChanged`, `onBookmarksChanged`, `onHistoryChanged`, `onDownloadRequested`, `onContextMenuRequested` — are called from the TS side with matching names.

**JSON payload shapes, checked field-for-field:**
- `ChromeStateSnapshot` (`getChromeState()` in `src/ui/pages/browser-window.ts`, pushed via `onStateChanged`) returns `{ tabs: [{id, url, title, active, pinned, loading, error: {code, description, url} | null}], activeTabId, addressValue, canGoBack, canGoForward, homeUrl, searchTemplate, incognito }` — matches what `BrowserViewModel.applySnapshot()` parses on the Kotlin side exactly, including the nullable per-tab `error` object.
- `listBookmarksExternal()` returns `{id, title, url}[]`; `listHistoryExternal()` returns `{id, title, url, visitedAt}[]` — both match Kotlin's `applyBookmarksSnapshot`/`applyHistorySnapshot` parsing.
- The context-menu payload (`wireContextMenuDetection`'s `onContextMenuRequested` call) sends `{x, y, pageUrl, pageTitle, linkUrl, linkText, imageUrl, imageAlt}`, matching Kotlin's `ContextMenuTarget` shape.

**Result: no contract mismatches found.** Every method either side calls exists on the other, and every JSON payload's field names/types line up. Combined with the earlier full read of the Kotlin shell, this is as thorough a "test" as a source-only audit can give — the remaining unknown is purely runtime behavior (does `evaluateJavascript` actually fire correctly on-device, do the Compose recompositions look right, etc.), which needs the actual build + on-device pass described below.

## Cleanup opportunities (not blocking)

- The root-level `E:\nova_1\com\` folder is a leftover mirror from the original redesign delivery (`apply-android-redesign.bat`'s source). Since the redesign is already applied to its real destination, this folder — and `apply-android-redesign.bat` itself — are now redundant and safe to delete, the same way `nova-roadmap-groundwork/` was cleaned up earlier this session.
- `android/app/src/main/java/com/nova/browser/New folder/` is an empty, stray directory (harmless to Gradle — no source files in it — but worth deleting for hygiene).
- `android/app/src/main/assets/public/` (plus `capacitor.settings.gradle`, `capacitor-cordova-android-plugins/`, `android/bridge/` if unused elsewhere) look like leftover Capacitor/Cordova build output from an earlier prototyping approach, now superseded by the native WebView-hosting shell — `index.html` and the actual asset loader only ever reference `assets/assets/`, never `assets/public/`. Confirm nothing still depends on the Capacitor path, then remove it; it's dead weight in every APK build until then.

## What this session could not do

No shell/Gradle/adb access to the connected machine — everything above is a source-code read, not a build or runtime check. Still outstanding, and blocking a real "yes, it all works" answer:

1. Run `npm run build:android` to sync the fresh engine bundle and produce an APK.
2. Install it on a device or emulator (`npm run android:install`, or `adb install` the APK from `android/app/build/outputs/apk/debug/`).
3. Actually exercise the features on-device: load a real page, open multiple tabs, bookmark/revisit history, trigger a download and pause/resume/cancel it, long-press a link/image, upload a file, grant a camera/mic permission from a test page, toggle incognito, and confirm the Nova Flash theme renders as designed in both light and dark system settings.
4. If step 3 surfaces anything broken, that's the point where this becomes real Kotlin fixes rather than a source read.

## Verification Steps (for whoever has shell access)

```bash
npm run build:android          # web build + asset sync + assembleDebug
npm run android:install        # installDebug to a connected device/emulator
```
Then manually exercise the feature list in item 3 above. No automated on-device test harness exists for the Android app today — this is a manual pass.
