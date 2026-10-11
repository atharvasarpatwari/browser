# Core Browser Keyboard Shortcuts Added — Including a Real Ctrl+L Focus Bug Caught by Live Testing

**Date:** 2026-09-26
**Session:** Asked to implement a large list of standard browser keyboard shortcuts. Investigated what already existed before writing anything, then wired the missing ones to real existing functionality only.
**Status:** Completed (1 root cause fixed, 11 shortcuts added)

---

## Summary

Only `Ctrl+T`/`Ctrl+W`/`Ctrl+Tab`/`Ctrl+Shift+Tab`/`Ctrl+F`/`F11`/`Ctrl+Shift+J` were wired before this session. Added 11 more (`Ctrl+L`, `Alt+Left/Right`, `Ctrl+R`, `Ctrl+D`, `Ctrl+H`, `Ctrl+J`, `Ctrl+±/0`, `Ctrl+Shift+N`, `Ctrl+1-9`, `Ctrl+Shift+T`, `Ctrl+Shift+R`), all mapped to functionality that already existed in the codebase — no new features invented to fill out the list. Live-testing the result in the dev preview (not just unit tests) caught a real bug before it shipped: the new `Ctrl+L` handler called the wrong layer's `focus()` method and silently did nothing.

Deliberately did not bind 9 of the requested shortcuts (`Ctrl+N`, `Ctrl+S`/`Ctrl+P`, `F12`/`Ctrl+Shift+I`, `Ctrl+Shift+C`, `Ctrl+Shift+P`, `Ctrl+Shift+Esc`) because the features behind them don't exist yet (no save/print pipeline, no command palette, no per-process task manager) or would conflict with Electron's own built-in accelerators — binding a key to nothing would have been a fake fix.

## Root Cause

**File:** `src/ui/pages/browser-window.ts`
**Problem:** The new `Ctrl+L` handler called `this.addressBar.focus()` — `addressBar` is the address bar's *model* (`AddressBar` in `address-bar.ts`), whose `focus()` only sets an internal `_focused` flag and emits an event; nothing subscribes to that event to move real DOM focus. The actual DOM-focusing method lives on the separate *view* object, `AddressBarView.focus()`, which calls `this.inputElement?.focus()`. Calling the model's method compiled fine, ran without error, and did nothing — the address bar never actually gained keyboard focus.
**Fix:** Changed the call to `this.addressBarView?.focus()`. Caught by live-testing in the dev preview and checking `document.activeElement` after dispatching the shortcut, rather than trusting that "no error was thrown" meant it worked.

## Notes

- Consolidated 4 separate, duplicated "close tab and recreate if empty" code paths (the keyboard handler, the tab-strip's own × button, and two context-menu actions) into one `removeTabTracked()` method — this is also what makes `Ctrl+Shift+T` (reopen closed tab) work correctly no matter which of the 4 ways a tab was closed, via a small capped history stack.
- `Ctrl+Shift+R` (hard reload) needed one small piece of real plumbing, not just a binding: the existing `CacheManager` singleton was never connected to `BrowserWindowPage`, so hard-reload had nothing to actually clear. Added `setCache()` and wired it through the DI container in `main.ts`.
- `Ctrl+9` matches Chrome's own convention (jumps to the *last* tab, not literally tab index 9).
- Verified every binding against the running app, not just automated dispatch: real tab-count changes for `Ctrl+T`/`Ctrl+W`/`Ctrl+1`/`Ctrl+9`, a real bookmark appearing in the bookmark bar for `Ctrl+D`, real canvas `transform: scale(...)` changes for zoom, and real navigation-history traversal for `Alt+Left`/`Alt+Right`.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Extended the keyboard-shortcut handler with 11 new bindings; consolidated 4 duplicated close-tab code paths into `removeTabTracked()`; added a closed-tab history stack; added `setCache()` |
| `src/app/main.ts` | Wired the existing `CacheManager` DI singleton into `BrowserWindowPage` via the new `setCache()`, needed for real hard-reload |

## Files Created

| File | Purpose |
|------|---------|
| `tests/browser-window-shortcuts.test.ts` | Real end-to-end tests (real `BrowserWindowPage`, real dispatched `KeyboardEvent`s) for tab-index selection (incl. the `Ctrl+9`-means-last edge case), reopen-after-close, and the never-close-the-last-tab guard |
| `doc/2026-09-26-core-browser-keyboard-shortcuts-added.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 230/230 files, 9343/9343 tests (4 new)
```

## Verification Steps

1. Investigated the existing shortcut handler and every target feature (bookmarks, history, downloads, zoom, incognito, devtools) before writing anything, to wire only to real functionality — confirmed via direct file reads, not assumption.
2. Ran the dev preview and dispatched every new shortcut against a real running app: tab count changes for `Ctrl+T`/`Ctrl+W`, tab-index selection for `Ctrl+1`/`Ctrl+9`, a real bookmark appearing for `Ctrl+D`, real `nova://history`/`nova://downloads` navigation, real canvas zoom transforms, real back/forward through navigation history, and incognito badge toggling.
3. That live check caught the `Ctrl+L` bug — `document.activeElement` stayed `<body>` instead of becoming the address input — traced to the wrong `focus()` layer, fixed, re-verified.
4. Ran the full test suite before and after the fix to confirm zero regressions.
