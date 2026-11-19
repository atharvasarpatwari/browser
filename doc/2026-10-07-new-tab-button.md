# The + Button Opens the New Tab Page

**Date:** 2026-10-07
**Session:** Small fix on request ("I want the new tab to be added when the + is clicked")
**Status:** Completed — verified in the real Electron app

## Summary

Clicking + in the tab strip did add a tab, but an empty `about:blank` one that stayed on a "Loading …" spinner. It now opens the browser's New Tab page (`about:newtab`: search box, quick links, frequently visited), the same page the omnibox's "new tab" action opens. Ctrl+T and the tab menu's "New Tab" had the same blank-tab behaviour and share the fix.

## Root Cause

**File:** `src/ui/pages/browser-window.ts`
**Problem:** the `newTabRequested` handler (+), the Ctrl+T handler and the tab menu each called `tabManager.createTab()` with no address, giving an `about:blank` tab that never finished loading.
**Fix:** one `openNewTab()` (`this.createTab('about:newtab')`, which also syncs the chrome) used by all three.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `openNewTab()`; + button, Ctrl+T, tab menu use it |
| `tests/e2e/search-electron.spec.ts` | +1 test: + and Ctrl+T give a second and third tab at `about:newtab` showing the page, not a spinner |

## Test Results

```
$ npx tsc --noEmit   → 0 errors
$ npx vitest run     → 262 files; 10,384 of 10,387 pass (the 3 known DnsResolver environmental timeouts)
$ npx playwright test … -g "New Tab page"  → passed
```

The first tab at start-up is still `about:blank` (unchanged).
