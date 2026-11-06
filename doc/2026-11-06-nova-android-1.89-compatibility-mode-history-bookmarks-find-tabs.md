# Nova Android 1.89: Compatibility Mode Completed — History, Bookmarks, Find in Page, Tab Titles, Sign-Out; Outside Gmail Links Fixed

**Date:** 2026-11-06
**Session:** "improvise it !!" (follow-up to 1.88's Gmail compatibility mode)
**Status:** Completed. Outside-link flow verified on the emulator. The remaining on-screen checks were cut short by emulator crashes (see Test Results). The tablet was not connected.

---

## Summary
This round filled the gaps 1.88 listed for daily Gmail use.

A compatibility-mode page (Gmail, Google sign-in…) now:
- goes into Nova's history;
- can be bookmarked;
- can be searched with Find in page;
- shows its own title and address in the tab switcher.

"Clear browsing data → cookies" now also signs out of compatibility-mode sites.

Emulator testing of outside links found a bug introduced in 1.88, which is fixed (#1).

## Root Causes

### 1. An outside Gmail link turned the new tab into another tab's page
**File:** `android/.../BrowserViewModel.kt` (`applySnapshot`, `goBack`)
**Problem:** opening `https://www.gmail.com` from another app opened a new tab. After compatibility mode took over, that tab showed the previous tab's page ("www.gmai"), and the tab switcher listed the same page twice.
**Root cause:**
- When an engine tab reached a compatibility site, 1.88 opened compatibility mode and called the engine's `back()` to step the tab off the site.
- The engine keeps one back/forward history for the whole window, not per tab. The new tab's "back" was the previous tab's entry.

**Fix:**
- On switching over, the engine only stops loading the page it can't run. The tab keeps its address.
- Backing out of compatibility mode onto an engine page that is the same site (a tab opened straight onto Gmail) opens Nova's new-tab page rather than calling the window-wide `back()`. It is not reopened automatically.

### 2. Compatibility pages were invisible to Nova's history
**Files:** `src/app/android-native-bridge.ts`, `src/ui/pages/browser-window.ts`, `BrowserViewModel.kt`, `CompatWebView.kt`
**Problem:** Gmail visits never appeared in History or in the address-bar suggestions.
**Root cause:** history is recorded by the engine's navigation, and the system WebView's navigations never pass through it. The bridge had no action to record an outside visit.
**Fix:**
- A new bridge action `novaNative.addHistoryEntry(url, title)` calls `HistoryService.addVisit`, then pushes history to the app. It handles http(s) only and records nothing in incognito.
- `CompatWebView.onPageFinished` reports each page once.

### 3. Bookmark, Find in page and the tab switcher acted on the engine tab, not the page shown
**Files:** `BrowserViewModel.kt`, `ui/BrowserScreen.kt`, `CompatWebView.kt`
**Problem:** 1.88 hid "Add bookmark" and "Find in page" in compatibility mode, and the tab switcher showed the engine tab's title and address.
**Root cause:** these features read the engine tab's state only.
**Fix:**
- **Bookmark** toggles the compatibility page (its title and URL).
- **Find in page** uses the WebView's `findAllAsync` / `findNext`, with match counts from its `FindListener`.
- **The tab switcher** shows the compatibility page's title and URL for that tab.

### 4. "Clear browsing data → cookies" left Google signed in
**File:** `BrowserViewModel.kt` (`clearBrowsingData`)
**Problem:** clearing cookies didn't sign out of Gmail in compatibility mode.
**Root cause:** compatibility-mode sign-ins live in the system WebView's cookie and storage stores, not Nova's cookie jar.
**Fix:** clearing cookies also clears the WebView cookies (`CookieManager.removeAllCookies` plus flush) and web storage (`WebStorage.deleteAllData`), and closes an open compatibility page. Clearing history also clears the compatibility view's back history.

## Not changed (recorded)
- **Window-wide engine history:** the engine's back/forward history is window-wide, not per tab. This predates this round and affects ordinary engine tabs too. It is a candidate for a future round.
- **Not restored after restart:** a compatibility page reopens automatically when its tab is shown again, but its WebView back history is not restored after an app restart.

## Files Modified
| File | Change |
|------|--------|
| `src/app/android-native-bridge.ts` | `addHistoryEntry` bridge action (#2) |
| `src/ui/pages/browser-window.ts` | `addHistoryEntryExternal` (#2) |
| `tests/android-native-bridge.test.ts` | 2 tests for #2; fake page updated |
| `android/.../BrowserViewModel.kt` | #1 switch-over and back-out; #2 history; #3 bookmark/find; #4 clear data |
| `android/.../ui/components/CompatWebView.kt` | page-finished history report; find listener |
| `android/.../ui/BrowserScreen.kt` | bookmark/find menu on compatibility pages; tab switcher titles |
| `android/app/build.gradle` | 1.88 (89) → 1.89 (90) |
| `android/app/src/main/assets/**` | rebuilt web bundle (bridge) |

## Test Results
```
npx vitest run tests/android-native-bridge.test.ts → 53 passed (2 new: bridge records a visit and pushes history;
  addHistoryEntryExternal adds web visits to the real HistoryService, skips about:)
npx vitest run                     → Test Files 335 passed (335); Tests 11438 passed (11438)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0 (44 unit tests, 0 failures)
apksigner verify Nova-1.89.apk     → verified; versionCode 90, versionName 1.89
Emulator (NovaEmu):
  outside link (am start VIEW https://www.gmail.com) → new tab, Gmail in compatibility mode
    (Google sent the unsigned-in WebView to its Gmail welcome page, workspace.google.com, Sign in / Get Gmail)
  menu on the compatibility page: Add bookmark, Find in page, Compatibility mode: on
  BUG (first 1.89 build): tab switcher showed the Gmail tab as "www.gmai" → traced to back() on window-wide
    engine history (#1) → fixed; rebuilt; outside link again → its own tab (3) stays on Gmail in compatibility mode
  The emulator process then crashed three times (exit 139, segfault in emulator.exe's graphics emulation) while
    drawing Gmail's animated welcome page (swiftshader_indirect twice, guest once), so Find in page, tab-switcher
    titles, history and cookie clearing were not confirmed on screen this round.
```
