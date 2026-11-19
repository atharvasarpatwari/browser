# Nova Android 1.9 — UI Redesign, Find, Scrolling, Pull-to-Refresh & Device-Found Fixes

**Date:** 2026-10-17
**Session:** "alter the android app". Plan: `2026-10-17-nova-android-ui-features-plan.md` (approved: bottom bar; settings + clear data, new-tab page, find in page, pull-to-refresh; test on the user's phone over USB). Tested on a **Realme RMX5264, Android 16** (`KNEUZTEE6TIBAIIV`).
**Status:** Completed, with the last on-device pass pending: the phone locked twice mid-session, so the final reload/pull-to-refresh/find check on device is outstanding (see *Verification*).

---

## Summary

- **Android UI rebuilt** around a one-handed bottom bar, a tab-switcher grid, a native New Tab page (from the design canvas), an overflow menu, a Settings screen and a native find bar.
- **Device testing on the user's phone found three Android bugs, all fixed:**
  - the address field never focused;
  - typing appended to the old URL;
  - **every page rendered 0 px tall**.
- **Making pages actually usable on a phone needed engine work:**
  - merged the `claude/search-subsystem` branch (scrolling and find engine);
  - added a phone-sized viewport with device-pixel-ratio painting;
  - made `@media` rules work (they were dropped everywhere);
  - touch scrolling with fling and pull-to-refresh.
- **Two pre-existing engine bugs fixed:** reload left the tab "loading" forever, and reloads were served from cache.
- **Privacy fix:** incognito visits were being saved to history.

## Root Causes

### 1. Address field never got focus on device (Android)
**File:** `ui/components/BottomChrome.kt`
**Problem:** Tapping the pill swapped in an editor that requested focus programmatically (`FocusRequester` in a `LaunchedEffect`, even after waiting a frame). On the phone `uiautomator` showed the field `focused=false` and `mInputShown=false`. With the engine WebView in the same window, programmatic Compose focus never landed, while a direct tap on a text field worked. Typed keys then went elsewhere: Enter activated the New Tab page's Bookmarks tile.
**Fix:** The pill *is* a `BasicTextField`, so the user's tap focuses it directly. Editing state follows `onFocusChanged`.

### 2. Typing appended to the current URL (Android)
**Problem:** Select-all ran in `onFocusChanged`, then the focusing tap placed the cursor, so `example.com` + typed text became `example.comhttp://…`, an engine error page.
**Fix:** Select-all one frame after editing starts (`LaunchedEffect(editing) { withFrameNanos {}; … }`).

### 3. Every page rendered 0 px tall (Android, pre-existing)
**File:** `ui/components/EngineWebView.kt`
**Problem:** Over CDP, `html`, `body`, `#browser-app` and the page canvas all measured **0 px**, while `innerHeight` was 822. `100vh` = 0, but `position:fixed; top:0; bottom:0` = 822. The WebView was created without layout params, so it got wrap-content; with a wrap-content height Chromium resolves `vh` and the root's `height:100%` to 0.
**Fix:** `layoutParams = ViewGroup.LayoutParams(MATCH_PARENT, MATCH_PARENT)`.

### 4. Pages were a tiny desktop image, unscrollable (engine, pre-existing)
**Files:** `src/browser/engine/page-renderer.ts`, `src/app/main.ts`
**Problem:** Layout and paint always used a 1920×1080 viewport (`LayoutEngine` default, `ReflowRepaintController`, `LazyLoader`). The content renderer then showed the 1920-wide bitmap with `object-fit: contain`, so on a 423-CSS-px screen text was ~4.5× too small. There was no touch scrolling at all.
**Fix:** `PageRenderer.setViewport(width, height, devicePixelRatio)` updates the layout config, paint config (painted at DPR for sharp text), lazy loader, reflow controller and the cascade viewport, and re-lays out the current page when the size changes. `main.ts` calls it with `innerWidth × innerHeight × devicePixelRatio` **only when the Android native host is present**, and again on `resize`. Desktop keeps 1920×1080.

### 5. `@media` rules never applied anywhere (engine, pre-existing)
**Files:** `src/browser/rendering/css-parser.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** The legacy CSS converter returned `[]` for every non-style rule (`if (rule.type !== 'style') return []`), so `@media` blocks were dropped before the cascade, which can evaluate them, ever saw them. The new viewport test showed it: at 412 px a `@media (max-width: 600px)` rule still didn't apply.
**Fix:** `convertRule` recurses into media rules and tags each legacy `CssRule` with its `media` query lists. `buildCss5Stylesheet` re-wraps them as `{ type: 'media', mediaQueries, rules }`, and the computed-style calls now pass the real viewport. (`@supports`/`@layer` blocks are still dropped by the same converter; not addressed here.)

### 6. Reload left the tab "loading" forever (engine, pre-existing)
**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** Found via pull-to-refresh on the phone (the bar stuck on ✕). `NavigationBridge.reload()` sets the **tab's** loading flag, but the `navigationCompleted`/`navigationFailed`/`navigationStopped` handlers only reset the address bar, toolbar and bridge flags; only `navigate()`'s own result path cleared the tab. Android's snapshot reads the tab flag. A controller + engine repro showed the reload itself completing fine.
**Fix:** All three handlers also `this.tabs.activeTab?.setLoading(false)`.

### 7. Reload was served from cache (engine, pre-existing)
**Files:** `resource-loader.ts`, `engine-types.ts`, `page-loader.ts`, `browser-engine.ts`
**Problem:** `ResourceLoader.loadResource` returns any cached copy unconditionally, so a user reload never reached the network (the test server's hit counter didn't move).
**Fix:** `ResourceLoadOptions.bypassCache`. `IPageLoader.load(url, signal, { bypassCache })` is set when `session.entry.type === 'reload'`, and the fresh response still refreshes the cache. (`ponytail:` normal navigations still trust the cache without revalidation; Cache-Control handling is a separate change.)

### 8. Incognito visits were recorded in history (engine)
**File:** `src/browser/history/history-service.ts`, `browser-window.ts`
**Problem:** `HistoryService` recorded every committed navigation and never checked incognito, which contradicted the new incognito New Tab page text.
**Fix:** `setRecordingPaused()`, toggled by `setIncognitoExternal`.

## New features
- **Merge** of `claude/search-subsystem` (25 commits: paint-engine scroll state, wheel/key/scrollbar scrolling, the find-in-page engine with scroll-to-match, the search subsystem). Committed as `7424677`; conflicts are listed in that commit.
- **Touch** (`page-scroll-controller.ts`):
  - a one-finger drag past an 8 px slop scrolls; taps still click (a drag cancels the click);
  - a fling decays 0.95 per frame;
  - **pull-to-refresh**: at the top of the page, pull down and a ↻ indicator follows; release past 72 px calls `onPullRefresh` → `reload()`.
- **Find in page:**
  - `SearchIntegration.findExternal/findStepExternal/clearFindExternal` share one engine-event path for highlights and scroll-to-match with the desktop find bar;
  - `browser-window` `*FindExternal`;
  - bridge `novaNative.find/findNext/findPrevious/clearFind`, which return `{total,index}` JSON;
  - Android `FindBar.kt` with a "3/12" count, previous/next and close, opened from the menu's **Find in page**.
- **Android UI** (built earlier this session, all screenshot-checked on the phone):
  - `BottomChrome.kt`: back · address pill · tab count · menu;
  - `TabSwitcher.kt`: a grid with Normal/Incognito and close ✕; *swipe-to-close skipped, add if wanted*;
  - `NewTabPage.kt`: greeting, date/time, search, 4 shortcuts, recently visited;
  - `SettingsScreen.kt` + `Settings.kt`: search engine (Google/DuckDuckGo/Bing/Brave), and clear history/cookies/downloads;
  - the overflow menu.

## Found, not fixed
- **Painter artefacts** (desktop too): an outline drawn for most block boxes, the first letters clipped at the left edge, and the `<h1>` missing on example.com. These are engine paint-fidelity issues.
- **Long-press:** the desktop `PageContextMenuController` is also attached on Android, so a long-press may open both its DOM menu and Android's native sheet. Not yet checked on device.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `setViewport`/`getViewport`, viewport in lazy loader, reflow controller and cascade; @media re-wrap |
| `src/browser/rendering/css-parser.ts` | `CssRule.media`; media rules converted, not dropped |
| `src/app/main.ts` | Android viewport fit + resize |
| `src/ui/components/page-scroll/page-scroll-controller.ts` | touch drag, fling, pull-to-refresh |
| `src/ui/pages/search-integration.ts` | `ensureFind` + headless find API |
| `src/ui/pages/browser-window.ts` | find external API, `onPullRefresh`, history pause on incognito |
| `src/app/android-native-bridge.ts` | `find`, `findNext`, `findPrevious`, `clearFind` |
| `src/ui/components/navigation-bridge.ts` | tab loading cleared on completed/failed/stopped |
| `src/browser/networking/resource-loader.ts`, `src/browser/engine/{engine-types,page-loader,browser-engine}.ts` | reload bypasses cache |
| `src/browser/history/history-service.ts` | `setRecordingPaused` |
| `android/.../BrowserViewModel.kt` | settings, clear data, new-tab detection, find state + `callEngineForString` |
| `android/.../ui/BrowserScreen.kt` | new layout: bottom chrome, overlays, menu, find bar |
| `android/.../ui/components/EngineWebView.kt` | MATCH_PARENT layout params |
| `android/.../ui/components/BookmarksSheet.kt` | `initialTab` |
| `android/.../NovaCookieHandler.kt` | `clearAll()` / `clear()` |
| `android/app/build.gradle` | version 1.9 (code 10) |
| `tests/page-scroll-controller.test.ts`, `tests/navigation-bridge.test.ts`, `tests/resource-loader.test.ts`, `tests/android-native-bridge.test.ts` | new cases (see below) |

## Files Created
| File | Purpose |
|------|--------|
| `android/.../ui/components/{BottomChrome,TabSwitcher,NewTabPage,SettingsScreen,FindBar}.kt`, `android/.../Settings.kt` | new UI + settings model |
| `android/app/src/test/.../SettingsTest.kt` | search-engine choice, fallback, clear-all cookies |
| `tests/page-viewport.test.ts` | desktop default kept; phone width → layout/paint/DPR + mobile @media; re-layout on resize, no-op ignored |
| `doc/2026-10-17-nova-android-ui-features.md` | This changelog |

## Files Deleted
`android/.../ui/components/TabsBar.kt`, `AddressBar.kt` (replaced by the tab switcher and bottom chrome).

## Test Results
```
Kotlin: gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 unit tests, all pass; 0 warnings
vitest (targeted): page-viewport + page-scroll-controller -> 36/36 (first runs: 7 failures = 5 touch tests
  placed in the wrong describe block + 2 real @media failures, which led to root cause 5)
vitest (targeted): navigation-bridge + resource-loader -> 44/44
vitest (full, after merge, before reload fix): 266 files / 10418 tests passed
vitest (full, final, all fixes in):           266 files / 10421 tests passed
npx tsc --noEmit -> clean (one test-only mock type error fixed along the way)
1.9 release: aapt2 versionCode='10' versionName='1.9'; apksigner verify OK; 1,515,256 B;
  packaged engine bundle contains setViewport and nova-pull-refresh
```

## Verification on the phone (Realme RMX5264, Android 16)
| Check | Result |
|------|--------|
| Smoke test (`npm run android:smoke-test`) | 8/8 PASS |
| New Tab page, dark theme | ✅ screenshot |
| Address pill: tap → keyboard, type, Go | ✅ after root causes 1–2 |
| example.com renders at phone width | ✅ after root causes 3–4 (painter artefacts noted) |
| Long local page: drag scroll, fling | ✅ Section 1→12 on drag, →33 on fling, scrollbar shown |
| Pull-to-refresh | Triggered reload, which exposed root causes 6–7; **re-check pending** (phone locked during install) |
| Find in page | **Pending** (built and unit-tested; not yet driven on device) |

## What's new in Nova 1.9 (user-facing)
- **New layout:**
  - one-handed bottom bar (back, address, tab count, menu);
  - a tab grid for switching tabs and incognito;
  - a New Tab page with shortcuts and recent sites;
  - Settings for your search engine and clearing data.
- **Pages fit your screen:** readable text, mobile layouts and sharp rendering.
- **Scroll with your finger, flick to fling, pull down to refresh.**
- **Find in page** from the menu, with match count and previous/next.
- **Reload actually reloads.**
- **Incognito** no longer saves history.
