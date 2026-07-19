# Navigation Bridge — Address Bar & Navigation Controls Wiring

**Date:** 2026-07-19
**Session:** NavigationBridge orchestration layer + AddressBar keyboard shortcuts + BrowserWindowPage wiring
**Status:** Completed

---

## Summary

Created NavigationBridge to orchestrate data flow between Toolbar, AddressBar, NavigationController, TabManager, and StatusBar. Enhanced AddressBarView with keyboard shortcuts. Updated BrowserWindowPage to use the bridge. Fixed re-entrancy infinite recursion and blocked-protocol detection. 29 new tests; full suite 78 files, 3082 tests passing.

## Root Causes

### 1. Infinite recursion in NavigationBridge.navigate()

**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** `bridge.navigate()` called `addressBar.setValue()`, which emitted a `navigate` event, which the bridge's address-bar event handler caught and called `bridge.navigate()` again — infinite recursion causing stack overflow / OOM.
**Fix:** Added `_navigating` boolean guard flag. Set to `true` at start of `navigate()`, reset to `false` at end. All address-bar event handlers check this flag before re-entering `navigate()`. Same guard applied to `goBack()`, `goForward()`, and `syncFromActiveTab()` which also call `addressBar.setValue()`.

```typescript
async navigate(url: string): Promise<void> {
  const trimmed = url.trim();
  if (trimmed.length === 0) return;
  if (this._navigating) return; // re-entrancy guard
  this._navigating = true;
  // ... navigation logic ...
  this._navigating = false;
}
```

### 2. `_isSearchQuery()` misclassified scheme-only URLs

**File:** `src/ui/components/navigation-bridge.ts`
**Problem:** The regex checked for `scheme://` (`^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\/`) but URLs like `javascript:alert(1)` don't have `//` after the scheme, so they were classified as search queries instead of URLs.
**Fix:** Changed regex to `^[a-zA-Z][a-zA-Z0-9+\-.]*:` to match any scheme prefix. Added separate `_isBlockedProtocol()` method to detect dangerous schemes (`javascript:`, `data:`) and emit `navigationFailed` before reaching NavigationController.

### 3. Tests assumed TabManager creates tabs on navigation

**File:** `tests/navigation-bridge.test.ts`
**Problem:** Tests accessed `tabs.activeTab` after `bridge.navigate()`, but `NavigationBridge` only updates existing tabs — it never creates them. TabManager starts empty, so `activeTab` was null.
**Fix:** Test harness creates a default tab (`tabs.createTab('about:blank')`) so `activeTab` is always non-null during navigation.

### 4. Per-tab history test mismatched architecture

**File:** `tests/navigation-bridge.test.ts`
**Problem:** Test assumed switching tabs preserves per-tab navigation history via a single NavigationController. The bridge uses one NavigationController — switching tabs syncs UI via `syncFromActiveTab()` but doesn't swap history stacks.
**Fix:** Test rewritten to verify that tab switching correctly restores the target tab's URL in the address bar, and that other tabs retain their own URL state.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/navigation-bridge.ts` | Added `_navigating` re-entrancy guard, `_isBlockedProtocol()` method, fixed `_isSearchQuery()` regex, guarded all methods that call `addressBar.setValue()` |
| `src/ui/components/address-bar/address-bar.view.ts` | Added keyboard shortcuts: Escape (restore+blur), ArrowUp/Down (suggestions), Tab (accept), Ctrl+L (select all), global shortcuts (Alt+Left/Right, F5, Ctrl+R, Escape stop, Ctrl+L focus), `setNavigationCallbacks()` |
| `src/ui/pages/browser-window.ts` | NavigationBridge + NavigationController creation, goBack/goForward/reload/stop delegate to bridge, tab switch calls `syncFromActiveTab()` |
| `tests/navigation-bridge.test.ts` | Fixed harness to create default tab, added blocked-protocol test, fixed per-tab history test |

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/components/navigation-bridge.ts` | NavigationBridge orchestration — NavigationBridgeEventBus, search detection, blocked protocols, tab switching, config |
| `tests/navigation-bridge.test.ts` | 29 tests: NavigationBridge (14), NavigationBridgeEventBus (6), config (2), TabManager integration (2), keyboard/toolbar integration (5) |

## Test Results

```
NavigationBridge: 29 tests (29 passed)
Full suite:       78 test files, 3082 tests, all passing
```
