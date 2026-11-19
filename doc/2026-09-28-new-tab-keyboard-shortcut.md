# New Tab Keyboard Shortcut (Ctrl+T / Cmd+T)

**Date:** 2026-09-28
**Session:** Wire the missing Ctrl+T/Cmd+T "new tab" keyboard shortcut into the desktop chrome
**Status:** Completed

---

## Summary

Mouse-driven tab creation (the tab-strip "+" button, and the "0 tabs left" auto-recreate) already existed in `BrowserWindowPage`/`TabManager`, but no keyboard shortcut opened a new tab — the Electron application menu (`electron/main.cjs`) only installs the default `fileMenu`/`editMenu`/`viewMenu`/`windowMenu` roles, and `AddressBarView`'s global shortcut listener only covers navigation (back/forward/reload/stop, Ctrl+L, Ctrl+R). Added a `Ctrl+T` / `Cmd+T` document-level shortcut to `BrowserWindowPage` that opens (and activates) a new tab from anywhere in the window, mirroring the tab strip's existing `newTabRequested` handler.

## Root Causes

N/A — feature gap-fill, not a bug fix. (Investigated whether this was a regression: no prior implementation of a tab-creation keyboard shortcut was found anywhere in `src/` or `electron/main.cjs`.)

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Added `tabKeyHandler` field; in `mount()`, installs a `document`-level `keydown` listener that calls `tabManager.createTab()` + `syncAll()` on Ctrl+T/Cmd+T (same effect as the tab strip's `+` button); `unmount()` removes the listener and nulls the field, matching the existing `contentNavigateHandler` install/uninstall pattern. |

## Files Created

| File | Purpose |
|------|--------|
| `tests/browser-window-new-tab-shortcut.test.ts` | Verifies Ctrl+T opens and activates a new tab via `getChromeState()`, and that an unrelated Ctrl+ combo (Ctrl+B) does not. |

## Test Results

```
npx tsc --noEmit
(0 errors)

npx vitest run tests/android-native-bridge.test.ts tests/browser-window-new-tab-shortcut.test.ts
 Test Files  2 passed (2)
      Tests  39 passed (39)

npx vitest run  (full repo suite)
 Test Files  218 passed (218)
      Tests  9203 passed (9203)
   Duration  248.03s
[exited with code 0]
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors repo-wide.
2. `npx vitest run tests/browser-window-new-tab-shortcut.test.ts` — 2/2 new tests pass.
3. `npx vitest run tests/android-native-bridge.test.ts` — 37/37 pass (existing `BrowserWindowPage` mount/unmount coverage unaffected by the new field/listener).
4. `npx vitest run` (full repo suite) — 218/218 files, 9203/9203 tests, exit code 0. (Teardown-time happy-dom `AbortError` stack traces appear in raw output during fetch-related test cleanup; these are pre-existing async-cleanup noise, not failures — the run summary reports 0 failed tests.)
