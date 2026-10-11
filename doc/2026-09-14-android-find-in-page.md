# Android — Find in Page, a Real Engine Feature With No Way to Trigger It

**Date:** 2026-09-14
**Session:** User asked to audit the Android app's UI buttons and get as many as possible fully wired to real behavior. Read every Kotlin UI component and the full `BrowserViewModel` — every existing button was already wired to real, working code (navigate, tabs, bookmarks, history, downloads, context menu, file chooser, permissions). The one real gap was a missing *entry point*: find-in-page, a fully-built and e2e-verified engine feature from earlier this session, had no way to be triggered from the Android app at all — no button, and no bridge method to reach it even if there were one.
**Status:** Completed

---

## Summary
`BrowserWindowPage`'s find-in-page (DOM search, match count, highlight overlay) is desktop-only reachable — it's wired to a `Ctrl+F` keydown handler, and the JS-rendered `FindBar` it shows doesn't belong on Android's native chrome (would look like the web version leaking through, the exact problem fixed earlier today). Added a native counterpart: a `findInPageExternal()`-family API on the page, exposed through `window.novaNative`, and a real Compose `FindBar` reachable from the address bar's overflow menu.

## What Was Built
- **`IBrowserWindowPage`** (`browser-window.ts`): four new public methods — `findInPageExternal(query)`, `findNextExternal()`, `findPreviousExternal()`, `closeFindExternal()` — each returning `{current, total}` so a caller gets the match count back synchronously. Implemented by refactoring the existing `runFind`/find-bar-button handlers into named methods (`runFind` now returns its result instead of discarding it; new `advanceFind(direction)`/`closeFind()` helpers) that both the desktop `FindBar` wiring and the new external methods call — one implementation, two front ends.
- **`android-native-bridge.ts`**: `window.novaNative.findInPage/findNext/findPrevious/closeFind`, each returning a JSON-encoded `{current, total}` string (matching the existing bridge convention of JSON-string returns for structured data).
- **`BrowserViewModel.kt`**: `openFind()`/`closeFind()`/`findInPage(query)`/`findNext()`/`findPrevious()`, plus `callEngineForResult()` — a `callEngine()` variant that reads back `evaluateJavascript`'s callback value (JSON-encoded twice over, since the JS side already returns a JSON string) instead of discarding it.
- **`FindBar.kt`** (new): a real Compose find bar — text field, match count, prev/next, close — the native counterpart of the engine's own `find-bar.ts`, styled with this app's own theme instead of reusing the web-rendered one.
- **`AddressBar.kt`**: added a "Find in page" entry to the existing overflow menu (alongside Copy URL / Share URL).
- **`BrowserScreen.kt`**: renders `FindBar` below the compact top row when active; system Back closes find first if it's open, before falling back to page-back navigation.

## Notes
- Audited every other Android UI component (`TabSwitcherSheet`, `DownloadsSheet`, `LibrarySheet`/`BookmarksSheet`, `ContextMenuSheet`, `ErrorPage`, the `BottomAppBar` actions) against `BrowserViewModel` — every button already called a real, fully-implemented method (no stubs, no dead click handlers, no TODOs found in the Kotlin source at all). Find-in-page was the one capability with a real, tested implementation and zero way to reach it from the app.
- Rest parameters (`function f(...args)`) and a few other JS-engine gaps from earlier sessions remain open — unrelated to this UI audit, already tracked in their own docs.
- No settings/preferences screen exists in the Android app (search engine choice, clear-data, etc.) — that's a real, legitimately bigger feature (a new screen, not a button fix) rather than something in scope for "wire up existing buttons."

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Added `findInPageExternal`/`findNextExternal`/`findPreviousExternal`/`closeFindExternal` to `IBrowserWindowPage`; refactored `runFind` to return a result and extracted `advanceFind`/`closeFind` helpers shared by the desktop find-bar wiring and the new external methods |
| `src/app/android-native-bridge.ts` | Added `findInPage`/`findNext`/`findPrevious`/`closeFind` to `window.novaNative` |
| `tests/android-native-bridge.test.ts` | Added default stubs + 2 new tests for the find-in-page bridge methods |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | Added find state + `openFind`/`closeFind`/`findInPage`/`findNext`/`findPrevious`/`callEngineForResult` |
| `android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt` | Added "Find in page" overflow menu item |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | Renders the native `FindBar`; Back closes find before navigating back |

## Files Created
| File | Purpose |
|------|---------|
| `android/app/src/main/java/com/nova/browser/ui/components/FindBar.kt` | Native find-in-page bar |
| `doc/2026-09-14-android-find-in-page.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9232 tests passed (9230 baseline + 2 new)
npx playwright test --config=playwright-electron.config.cjs       → 3/3 passed (confirms the runFind/advanceFind/closeFind
                                                                     refactor didn't change desktop Ctrl+F behavior)
Kotlin compile (gradlew assembleDebug)                            → BUILD SUCCESSFUL
node android/scripts/device-smoke-test.mjs (real device)          → all Tier 1 + Tier 2 checks passed
```

## Verification Steps
1. Navigated the real device to example.com (via the CDP bridge), tapped the overflow menu → "Find in page" — the native find bar opened with focus and the keyboard up, showing "0/0".
2. Typed "domain" — real match count "1/3" against the actual page DOM.
3. Tapped next — advanced to "2/3" with a real yellow highlight box drawn over the matched "Example Domain" heading, using the same highlight mechanism the desktop feature already used.
4. Closed the find bar — highlight cleared, page rendered normally.
5. Before committing this refactor, wrote a scratch e2e test confirming desktop Ctrl+F still works end to end (1/2 → 2/2 match progression) after extracting `runFind`/`advanceFind`/`closeFind`, then removed the scratch test once confirmed (no permanent find-in-page e2e fixture exists in this repo yet).
