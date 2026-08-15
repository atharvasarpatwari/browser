# Bookmarks & History Shared With the Engine (Android Native Bridge Round 2)

**Date:** 2026-08-14
**Session:** Apply second round of hybrid native-chrome bridge changes — bookmarks/history now backed by the engine's real BookmarkService/HistoryService; address-bar loading spinner now reflects navigation start/end.
**Status:** Completed

---

## Summary
Applied the files from `E:\nova_1\new\files-1` onto `E:\nova_1`, overwriting the previous round's versions. Bookmarks and history are no longer native-Android-only local lists — they are now mirrored from the engine's real `BookmarkService`/`HistoryService` (the same ones the desktop build uses) via the existing NovaStateBridge push channel. Also wired loading-state events so the address-bar spinner updates on navigation start/end instead of only on tab create/remove/activate/navigate.

## Root Causes
### 1. Bookmarks/history were disconnected from the engine
**File:** `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` (previous version)
**Problem:** Bookmarks and history were local Compose lists mutated in place (`bookmarks.add(0, ...)`, `bookmarks.remove(existing)`, `history.clear()`), with no connection to the engine's `BookmarkService`/`HistoryService`. Desktop and Android shared nothing.
**Fix:** `toggleBookmark()`/`removeBookmark()`/`clearHistory()`/`removeHistoryEntry()` are now fire-and-forget calls into `window.novaNative.*`; the resulting list update arrives via the next `onBookmarksChanged`/`onHistoryChanged` push, same pattern tabs already use. Added `applyBookmarksSnapshot()`/`applyHistorySnapshot()` parsers and `Bookmark`/`HistoryEntry` model classes.

### 2. Loading spinner lagged behind actual load state
**File:** `src/ui/pages/browser-window.ts` (previous version)
**Problem:** `emitChromeState()` only fired on tab lifecycle events, so a slow-loading page wouldn't show as loading until after it finished.
**Fix:** `NavigationBridge` now also re-syncs on `navigationStarted`/`navigationCompleted`/`navigationFailed` via the new `onBridgeLoadingChanged` handler, so pushed snapshots carry a current per-tab `loading` flag.

## Files Modified
| File | Change |
|------|--------|
| `src/app/android-native-bridge.ts` | Added `onBookmarksChanged`/`onHistoryChanged` bridge methods; `window.novaNative` gains `addBookmark/removeBookmark/refreshBookmarks/removeHistoryEntry/clearHistory/refreshHistory`; subscribes to `onLibraryChanged` and pushes full bookmark/history lists on install + every change |
| `src/ui/pages/browser-window.ts` | Added external bookmark/history pass-through API (`listBookmarksExternal`, `addBookmarkExternal`, `removeBookmarkExternal`, `isBookmarkedExternal`, `listHistoryExternal`, `removeHistoryEntryExternal`, `clearHistoryExternal`, `onLibraryChanged`) + loading-state event wiring |
| `tests/android-native-bridge.test.ts` | Now 18 tests, including 2 exercising the REAL `BookmarkService`/`HistoryService` (round-trip add/remove + `onLibraryChanged`), plus bridge tests for bookmark/history pushes and `addBookmark`/`clearHistory` delegation |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | Bookmarks/history state + snapshot parsers; mutation actions now delegate to `window.novaNative.*` |
| `android/app/src/main/java/com/nova/browser/NovaStateBridge.kt` | Now takes `onBookmarks` and `onHistory` callbacks in addition to `onSnapshot` |
| `android/app/src/main/java/com/nova/browser/model/Tab.kt` | Added `Bookmark` and `HistoryEntry` data classes |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | Registers the extended `NovaStateBridge` (bookmarks + history callbacks) before `loadUrl()` |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-08-14-android-bookmarks-history-sync.md` | This change log |

## Test Results
```
npx tsc --noEmit
  -> 5 pre-existing errors ONLY in tests/compositing/*.test.ts and
     tests/page-renderer.test.ts (StackingContext 'translate',
     IPaintEngine 'setTransformResolver') — unrelated to this change;
     0 errors in the 3 touched TS files.

npx vitest run tests/android-native-bridge.test.ts
  -> 18 passed (18)  [previously 13]
```

## Verification Steps
1. Diffed each incoming file against the repo copy to confirm the changes are the intended round-2 delta (not regressions).
2. `npx tsc --noEmit` — no new errors; the 5 reported are pre-existing in untouched test files.
3. `npx vitest run tests/android-native-bridge.test.ts` — 18/18 pass (includes 2 real-service round-trip tests).
4. Kotlin NOT compiled — no Gradle/Android SDK in this environment (same limitation as round 1); the 4 Kotlin files were read through against the TS contract before applying.
