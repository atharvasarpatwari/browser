# UI Broken Items — Root Cause Analysis & Fixes

**Date:** 2026-07-18
**Session:** 8 broken UI items identified and fixed
**Status:** Completed

---

## Summary

Systematic audit of the Nova browser UI identified 8 broken or non-functional items caused by boot-order issues, missing event wiring, duplicate DI instances, and incomplete integration. All 8 have been fixed.

## Test Results

- **43 UI tests:** All passing (navigation-bridge: 29, tab-strip: 14)
- **Full suite:** 4,053 passing, 9 pre-existing bytecode-vm failures (unrelated)

---

## Fix 1: NavigationFetcher Never Created

**File:** `src/app/main.ts:482-489`
**Problem:** `NavigationFetcher` was instantiated at line 482, but `setBrowserEngine()` (which sets the engine used by the fetcher) was called later at line 535. The fetcher's `start()` ran before the engine was available, so it never fetched content.
**Fix:** Added `tryCreateNavigationFetcher()` lazy initializer to `BrowserWindowPage`. Called from `setBrowserEngine()` and `setPaintEngine()` setters — when both engines are present, the fetcher is created and started.

## Fix 2: Toolbar View Never Updated

**File:** `src/ui/pages/browser-window.ts` (syncAll method)
**Problem:** `syncAll()` synced the Toolbar model but never called `this.toolbarView.update(this.toolbar.state)`. The DOM never reflected model changes.
**Fix:** Added `this.toolbarView?.update(this.toolbar.state)` at the end of `syncAll()`.

## Fix 3: Tab Title Doesn't Update

**File:** `src/ui/components/tab-strip/tab-strip.ts`
**Problem:** `TabStrip` created a `TabStripView` but never subscribed to the active tab's `titleChanged`, `urlChanged`, `loadingStateChanged`, or `faviconChanged` events. The active tab display was static.
**Fix:** Added `subscribeToActiveTab()` method with `_activeTabUnsubs` array for cleanup. Subscribes to 4 events on the active tab. Called on construction, tab activation, and tab creation. Cleanup runs in `dispose()`.

## Fix 4: Duplicate BookmarkService

**File:** `src/ui/components/bookmark-bar/bookmark-bar.ts`
**Problem:** `BookmarkBar` was constructed with `undefined` service (line 201 of browser-window.ts). The DI-registered `BookmarkService` was injected into `BrowserWindowPage` but never passed to `BookmarkBar`, which created its own local `InMemoryBookmarkStore`.
**Fix:** Changed `BookmarkBar.service` from `readonly` to mutable. Added `setService()` method. `BrowserWindowPage` passes `this.bookmarkService ?? undefined` at construction and syncs via `setBookmarkService()` setter call.

## Fix 5: Duplicate TrackerBlocker/AdBlocker

**File:** `src/ui/pages/browser-window.ts`
**Problem:** `BrowserWindowPage` created local `TrackerBlocker` and `AdBlocker` instances. The DI-registered blockers (shared with engine middleware) were injected into `BrowserWindowPage` but never used by the shield toggle handler.
**Fix:** Added `diTrackerBlocker` and `diAdBlocker` fields with `setTrackerBlocker()` and `setAdBlocker()` methods and interface declarations. Shield toggle handler uses DI instances when available: `this.diTrackerBlocker ?? this.trackerBlocker`. Wired in `main.ts` via `page.setTrackerBlocker(blocker)` and `page.setAdBlocker(adBlocker)`.

## Fix 6: Shared NavigationController for All Tabs

**File:** `src/ui/components/navigation-bridge.ts` (syncFromActiveTab method)
**Problem:** All tabs shared a single `NavigationController`. Back/forward operated on the shared history stack, not the active tab's history.
**Fix:** In `syncFromActiveTab()`, after updating UI state, if the active tab's URL differs from the controller's current entry, the controller is navigated to the tab's URL. This syncs the controller state with the active tab so back/forward operate correctly going forward.

## Fix 7: Settings Don't Persist Across Reload

**File:** `src/app/main.ts:449`
**Problem:** `SettingsStore` was constructed without a storage backend, defaulting to `undefined` (no persistence). All settings were lost on page reload.
**Fix:** Changed `SettingsStore` construction to pass `typeof window !== 'undefined' ? window.localStorage : undefined`, enabling browser localStorage persistence.

## Fix 8: Mobile Layout Never Activated

**File:** `src/ui/pages/browser-window.ts` (mount method)
**Problem:** `DesktopLayout` was always used regardless of viewport size. The `MobileLayout` class existed but was never instantiated.
**Fix:** Added viewport detection (`window.innerWidth < 768`). When mobile viewport is detected, `MobileLayout` is created instead of `DesktopLayout`. Mobile mount path attaches address bar, content area, and status bar to mobile layout areas. Desktop mount path unchanged.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/ui/pages/browser-window.ts` | Fixes 1,2,4,5,6,8 — layout branching, DI wiring, toolbar sync, fetcher lazy init |
| `src/ui/components/tab-strip/tab-strip.ts` | Fix 3 — active tab event subscriptions |
| `src/ui/components/bookmark-bar/bookmark-bar.ts` | Fix 4 — mutable service with setService() |
| `src/ui/components/navigation-bridge.ts` | Fix 6 — sync controller on tab switch |
| `src/app/main.ts` | Fixes 5,7 — DI blocker wiring, localStorage for settings |

## Files Created

| File | Purpose |
|------|---------|
| `docs/ui-broken-items-fixes.md` | This document |
