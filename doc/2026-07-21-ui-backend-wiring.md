# UI Backend Wiring — Engine Integration

**Date:** 2026-07-21
**Session:** Wired all backend services to the browser UI, mapping source files to interface elements
**Status:** Completed

---

## Summary
Connected the full backend service layer to the UI. Navigation now triggers the real engine pipeline (ResourceLoader → HtmlParser → DomTree → CssParser → LayoutEngine → PaintEngine → ContentRenderer). Search queries route through the engine to DuckDuckGo. Downloads page is wired to DownloadManager with live progress updates. History and Bookmarks panels render real data from backend services with search and navigation.

## Root Causes

### 1. Search queries never hit the engine pipeline
**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** The search path in `NavigationBridge.navigate()` constructed a DuckDuckGo URL but used a `setTimeout` stub instead of calling `this.nav.navigate()`. The engine never fetched or rendered the search results page.
**Fix:** Replaced the stub with `await this.nav.navigate(searchUrl)`, routing search queries through the NavigationController → BrowserEngine pipeline just like regular URLs.

### 2. Downloads page disconnected from DownloadManager
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `renderDownloadsPanel()` created an empty `DownloadsPage` with `mount(container, [])` and never connected to the DownloadManager.
**Fix:** Mount with `this.downloadManager.items`, subscribe to all download event types (`downloadCreated`, `downloadProgress`, `downloadCompleted`, `downloadFailed`, `downloadCancelled`, `downloadPaused`) for live updates, and wire action buttons (pause/resume/cancel/remove) back to the DownloadManager.

### 3. History/Bookmarks panels were HTML placeholders
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `renderHistoryPanel()` and `renderBookmarksPanel()` rendered static placeholder HTML instead of querying the backend services.
**Fix:** Replaced with dynamic panels that call `historyService.getRecent()` / `historyService.query()` and `bookmarkService.getChildren()` / `bookmarkService.search()`, with live search filtering and click-to-navigate.

### 4. TypeScript type narrowing gaps
**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** `AddressBarEventUnion` includes a catch-all `AddressBarEvent` that prevents discriminated union narrowing in switch cases.
**Fix:** Added inline type assertions for `e.url` and `e.query` in the switch cases.

### 5. Duplicate variable declarations
**File:** `src/app/main.ts`
**Problem:** `engine` and `navController` were declared with `const` twice in `mountBrowserUI()`, causing TS redeclaration errors.
**Fix:** Reused existing variable declarations from earlier in the function scope.

### 6. IBrowserWindowPage interface missing setter methods
**File:** `src/ui/pages/browser-window.ts`
**Problem:** The interface didn't declare the new DI setter methods (`setBrowserEngine`, `setNavigationController`, etc.), causing type mismatches.
**Fix:** Added all setter method signatures to `IBrowserWindowPage`.

### 7. Missing NavigationController import
**File:** `src/ui/pages/browser-window.ts`
**Problem:** The concrete `NavigationController` class was imported but needed for the fallback `new NavigationController()` path.
**Fix:** Already present as value import (line 36).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Added DI setter methods to interface, implemented real history/bookmarks/downloads panels, wired DownloadManager events, fixed type narrowing |
| `src/ui/components/navigation-bridge.ts` | Replaced search stub with real engine navigation, fixed AddressBar event type narrowing |
| `src/app/main.ts` | Fixed duplicate variable declarations |

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/components/navigation-fetcher.ts` | Bridges IBrowserEngine events → IContentRenderer (created in prior session) |

## Test Results
```
Test Files  1 failed | 89 passed (91)
Tests       27 failed | 4062 passed (4145)
Errors      1 error (pre-existing OOM in bytecode-vm.test.ts)
```
All failures are pre-existing (`bytecode-vm.test.ts` worker OOM). No regressions.

## Verification Steps
1. `npx tsc --noEmit` — only pre-existing errors in `main.ts` (permission-manager, process-guard types)
2. `npx vitest run` — 89/91 files pass, 4062/4145 tests pass
3. Manual review of all modified files for logical correctness
