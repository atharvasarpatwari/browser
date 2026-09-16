# Android — Replaced the Native Compose Chrome with the Real Desktop Web Chrome

**Date:** 2026-09-16
**Session:** Follow-up after fixing the Android app's color theme to match desktop (a prior session had given it its own invented gold/violet identity instead of desktop's actual obsidian/cyan/amber palette — see the earlier same-day work). Asked to check the theme fix on-device, which surfaced screenshots of the native Compose chrome (address bar, tab switcher, downloads, bookmarks/history) working correctly but structurally different from desktop's own toolbar/tab-strip/bookmark-bar. Confirmed via a direct question: the ask was to replace the native chrome with the actual web-rendered desktop chrome, not just restyle the native one further.
**Status:** Completed

---

## Summary
The Android app used two independently-built UIs for the same functionality: a native Kotlin/Compose chrome (top row with tab-count button, incognito toggle, address bar; bottom app bar with back/forward/downloads/library; three bottom sheets for tabs/bookmarks/downloads) driving the engine through a JS bridge, while the engine's own real chrome (the same toolbar/tab-strip/address-bar/bookmark-bar/status-bar code desktop uses) sat hidden inside the WebView the whole time. Investigating why — `hideChromeUI: isNativeHostPresent()` — found the mechanism was deliberate but had a second problem underneath: even with that flag off, the page's `mount()` picks a layout by viewport width, and a phone screen is always narrow enough to route into `MobileLayout`, an unfinished stub whose bottom-nav buttons were never wired to anything. Un-hiding the chrome without also addressing that would have shown broken, non-functional emoji buttons instead of desktop's chrome. Fixed both: the engine now always builds the real desktop chrome on the Android host regardless of viewport width, and the native Compose chrome that duplicated it was removed. Three features that need genuine OS integration (real file downloads, canvas content long-press, and reaching the two of those without native chrome buttons anymore) stayed native, reached through a small, unchanged bridge pattern. Verified end-to-end on the connected device: real toolbar, tab strip, bookmark bar, and status bar all render and work, the main menu's new Downloads/Incognito/Find entries correctly hand off to native or open the web's own find bar, and the full desktop e2e suite plus unit suite still pass with zero regressions.

## Root Causes

1. **`hideChromeUI` hid the engine's real chrome, but the mobile-viewport branch of `mount()` would have shown the wrong thing anyway if simply un-hidden.** `BrowserWindowPage.mount()` picks `MobileLayout` (an unfinished prototype — see the 2026-09-14 "duplicate mobile chrome" fix, which only ever wired its bottom-nav buttons to nothing, since native chrome was expected to cover navigation) whenever `window.innerWidth < 768`, which is always true on a phone. Renamed the config flag from `hideChromeUI` to `forceDesktopChrome` and changed its meaning: instead of hiding the desktop chrome's DOM via CSS, it now forces `mount()` to always choose the real, fully-wired desktop layout (Toolbar/TabStrip/AddressBar/BookmarkBar/StatusBar) regardless of viewport width, so Android gets the exact same chrome desktop does rather than routing into the broken stub. Removed the two now-dead `display:none` blocks that used to hide the chrome once it was no longer being hidden at all.
2. **Traffic lights (macOS-style close/minimize/maximize dots) would have rendered on a full-screen Android app with no window to control them.** `ToolbarView`'s `showTrafficLights` defaults to `true` and nothing previously varied it. Passed `showTrafficLights: !forceDesktopChrome` when constructing it, so the native host gets three fewer inert decorations instead of three fake window controls.
3. **Two menu actions need OS integration the web page cannot provide, and would have silently misbehaved once the menu was reachable on Android.** "Downloads" navigates to `nova://downloads`, an engine-rendered page reflecting the portable, cross-platform `DownloadManager`/`localStorage`-backed state — fine for Bookmarks and History (pure data, no native dependency), but Android's *real* downloads are owned entirely natively (`NativeDownloader.kt`, actual OS `DownloadManager` writes, pause/resume/share) and never update that page's list at all, so navigating there would show a permanently-empty page while real downloads happen invisibly elsewhere. Added a native-bridge escape hatch (`window.NovaStateBridge.onDownloadsPageRequested()`) that the menu action calls instead of navigating, when present; desktop has no such bridge, so it always falls through to the normal `nova://downloads` navigation there. Incognito got the same treatment (`onIncognitoToggleRequested()`) for a different reason: with the native chrome's own always-visible incognito icon removed, there was no persistent UI left to reflect that state, so it became a menu action instead — reachable the same way regardless of platform, handed off to native on Android purely because that's where the existing `setIncognito` plumbing already lived.
4. **Touch devices had no way to trigger find-in-page at all.** Desktop's find bar only ever opens via `Ctrl+F`/`Cmd+F` — there was no menu entry, because a keyboard shortcut was assumed to always be available. Added a `showFindBarExternal()` method (thin wrapper around the existing private `showFindBar()`) and a "Find in Page" main-menu entry, benefiting keyboard-less desktop users too, not just Android.

## Notes
- Bookmarks and History intentionally now go through the exact same `nova://bookmarks`/`nova://history` web pages on Android as on desktop, with **no native handoff** — their backing stores (`PersistentBookmarkStore`/`PersistentHistoryStore`) are `window.localStorage`-based and have no Electron- or Android-specific dependency, so there's no functional gap to work around, unlike downloads.
- Deliberately **not** touched: `window.novaNative.*` (Kotlin-callable engine commands) and the `onStateChanged`/`onBookmarksChanged`/`onHistoryChanged` state-push channel remain defined and still fire, even though no native UI currently consumes them (the whole point of removing native chrome was to stop needing a mirrored read-model of engine state in Kotlin). Left in place rather than pruned: the command surface costs nothing while uncalled and might serve a future native-triggered action (e.g. an OS share-target or Assistant integration); the state pushes are a larger, riskier removal (touching `BrowserViewModel`'s tab/bookmark/history mirror fields) for a real but purely internal efficiency win, not a user-visible correctness issue. Flagged here rather than attempted under the same session's time budget as the rest of this work.
- `IncognitoSurface`/`IncognitoContent` (the reserved-purple constants added earlier the same day) became unused once the native chrome that rendered an incognito-tinted tab switcher and icon was removed — deleted them from `Color.kt` rather than leaving orphaned constants.
- Deleted four now-fully-unused Kotlin files outright rather than leaving them as dead code: `AddressBar.kt`, `FindBar.kt`, `TabSwitcherSheet.kt`, `BookmarksSheet.kt` (the `LibrarySheet` composable). Confirmed via grep that `BrowserScreen.kt` was the only importer of any of them before deleting.
- The web tab strip's tabs are noticeably small on a phone-width screen (built for a mouse, `max-width: 170px` per tab, `draggable=true` HTML5 drag-and-drop for reordering, which is unreliable on touch) — a real, known tradeoff of "the exact same chrome as desktop" rather than a mobile-optimized redesign. Tap-to-select and tap-to-close both use plain click handlers, which work fine on touch; only drag-reorder is likely to feel worse than a purpose-built mobile tab switcher would. Not fixed this round, since the request was specifically to match desktop, not to design a new mobile-specific tab UI.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Renamed `hideChromeUI` → `forceDesktopChrome`; changed its effect from CSS-hiding the chrome to forcing the desktop layout branch regardless of viewport width; removed the two now-dead chrome-hiding blocks; disabled traffic lights when `forceDesktopChrome`; added `showFindBarExternal()`; added "Find in Page", "Downloads" (native-bridge-aware), and incognito toggle entries to the main menu |
| `src/app/main.ts` | Updated the `BrowserWindowPage` construction site and its doc comment for the renamed config option |
| `src/app/android-native-bridge.ts` | Updated header doc to reflect that chrome is no longer hidden; added `onDownloadsPageRequested()`/`onIncognitoToggleRequested()` to `NovaStateBridgeHost`; updated the install log message |
| `tests/android-native-bridge.test.ts` | Renamed 22 occurrences of `hideChromeUI: true` → `forceDesktopChrome: true`; updated one test's now-inaccurate title/comment |
| `android/app/src/main/java/com/nova/browser/NovaStateBridge.kt` | Added `onDownloadsPageRequested()`/`onIncognitoToggleRequested()` `@JavascriptInterface` methods and constructor params; updated class doc comment |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | Added `downloadsRequested` state + `onDownloadsPageRequested()`/`clearDownloadsRequest()`; added `onIncognitoToggleRequested()` (delegates to existing `setIncognito`) |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | Wired the two new `NovaStateBridge` callbacks; updated doc comments (no more "native Compose chrome drives this WebView") |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | Rewritten: removed the top Row (tab-count button, incognito icon, native `AddressBar`, native `FindBar`) and `BottomAppBar` (back/forward/downloads/library) entirely; removed `TabSwitcherSheet`/`LibrarySheet`; `Scaffold` now has no `topBar`/`bottomBar`, so `EngineWebView` fills the full screen; kept file-chooser/permission-grant plumbing and `DownloadsSheet`/`ContextMenuSheet`, now triggered via `viewModel.downloadsRequested` instead of a native button tap |
| `android/app/src/main/java/com/nova/browser/MainActivity.kt` | Updated doc comment to describe the new architecture |
| `android/app/src/main/java/com/nova/browser/ui/theme/Color.kt` | Removed now-unused `IncognitoSurface`/`IncognitoContent` |

## Files Deleted
- `android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt`
- `android/app/src/main/java/com/nova/browser/ui/components/FindBar.kt`
- `android/app/src/main/java/com/nova/browser/ui/components/TabSwitcherSheet.kt`
- `android/app/src/main/java/com/nova/browser/ui/components/BookmarksSheet.kt`

## Files Created
- `doc/2026-09-16-android-web-chrome-unification.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                → 0 errors (repo-wide)
npx vitest run tests/android-native-bridge.test.ts                   → 38/38 passed
npx vitest run (full suite)                                          → 223 files / 9256 tests passed (0 regressions;
                                                                          one JWT test flaked on a Date.now() second
                                                                          boundary, confirmed unrelated — passes in isolation)
npx playwright test --config=playwright-electron.config.cjs          → 5/5 spec files passed (electron-smoke, fidelity-audit,
                                                                          css-feature-sweep, js-dom-api-sweep, keep-alive) —
                                                                          confirms desktop chrome is unaffected
Gradle compileDebugKotlin / assembleDebug / installDebug              → all succeeded
Real device (Realme RMX5264): visual + interaction verification       → see Verification Steps
```

## Verification Steps
1. Rebuilt the web bundle, copied it into Android assets, rebuilt and reinstalled the debug APK.
2. Screenshotted the freshly-launched app: the real desktop toolbar (back/forward/reload/home/address-bar/bookmark-star/shield/menu), tab strip (one tab + new-tab button), an empty bookmark bar, the content area, and the status bar (Ready/blocked-count/HTTPS/Secure/zoom) all render full-screen, with none of the old native duplicate elements (tab-count square, separate address bar, bottom back/forward/downloads/library bar) present.
3. Opened the hamburger menu and confirmed all expected entries render, including the two new ones (Find in Page, New Incognito Session) alongside the existing Bookmarks/History/Downloads/AI Research/Settings.
4. Tapped "Downloads" and confirmed the native `DownloadsSheet` opens correctly (visible behind the system notification-permission prompt it triggers) — the bridge handoff works end-to-end rather than navigating to a dead `nova://downloads` page.
5. Tapped "New Incognito Session", reopened the menu, and confirmed the label flipped to "Exit Incognito" — the toggle reaches the engine's real `IncognitoManager` through the bridge and is reflected back correctly. Toggled it back off.
6. Ran the full `npx vitest run` (0 regressions) and the complete Electron e2e suite (5/5 specs, confirming desktop's own chrome — which shares this exact code path minus `forceDesktopChrome` — is unaffected) after rebuilding.
7. Deleted all scratch verification screenshots before finishing.
