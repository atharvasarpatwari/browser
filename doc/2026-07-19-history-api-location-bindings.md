# History API & Location Bindings

**Date:** 2026-07-19
**Session:** History API / Navigation — window.history, window.location, popstate/hashchange events
**Status:** Completed

---

## Summary

Implemented the History API (`window.history`) and Location API (`window.location`) bindings for the JS engine, connecting them to the existing `NavigationController`. Added `popstate` and `hashchange` event dispatch, `go(delta)` navigation, and `pushState`/`replaceState` state management. Full test suite: 83 files, 3546 tests all pass.

## What Was Implemented

### NavigationController Enhancements
- **`state` field** added to `NavigationEntry` interface — stores arbitrary state from `pushState`/`replaceState`
- **`state` parameter** added to `navigate()`, `replace()`, and `NavigationRequest`
- **`go(delta)` method** — navigates by arbitrary delta relative to current position (positive = forward, negative = back)
- **`pushState(state, title, url?)` method** — updates current entry's state without creating a new entry (synchronous)
- **`replaceState(state, title, url?)` method** — replaces current entry state (synchronous)
- **`step(n)` method** on `NavigationStack` — moves cursor by arbitrary delta
- **Hash-only changes moved before guard chain** — same-page hash jumps are synchronous (no network/guard overhead)

### window.history (History API Binding)
- **`history.state`** — getter returning current entry's serialized state
- **`history.length`** — getter returning stack size
- **`history.back()`** — fires `popstate` event with previous entry's state
- **`history.forward()`** — fires `popstate` event with next entry's state
- **`history.go(delta)`** — fires `popstate` event; `go(0)` reloads current page
- **`history.pushState(state, title, url?)`** — does NOT fire `popstate` per WHATWG spec
- **`history.replaceState(state, title, url?)`** — does NOT fire `popstate` per WHATWG spec

### window.location (Location API Binding)
- **Read-only getters**: `href`, `origin`, `protocol`, `host`, `hostname`, `port`, `pathname`, `search`, `hash`
- **Setters**: `href` (navigates), `hash` (hash-only navigation)
- **Methods**: `assign(url)`, `replace(url)`, `reload()`, `toString()`
- All properties reflect the current `NavigationEntry` via `ParsedUrl`

### Window Event System
- **`window.addEventListener(type, fn, once?)`** — registers listeners for `popstate`/`hashchange`
- **`window.removeEventListener(type, fn)`** — removes listeners
- **`window.dispatchEvent(evt)`** — dispatches events to registered listeners
- **`popstate` event** — fires on `back()`/`forward()`/`go()` with `.state` property
- **`hashchange` event** — fires on same-page hash jumps with `.oldURL`/`.newURL` properties

### State Serialization
- **`jsValueToPlain()`** — recursively converts JSObjects (with `properties` Map) to plain objects
- Handles arrays, primitives, nested objects
- JSON round-trip for structured clone emulation

## Root Causes & Fixes

### 1. State serialization received JSObjects instead of plain objects

**File:** `src/browser/js/history-bindings.ts`
**Problem:** `JSON.stringify(JSObject)` produces `{"type":"object","properties":...}` because JSObjects have `properties: Map<string, PropertyDescriptor>` which doesn't serialize properly.
**Fix:** Added `jsValueToPlain()` that reads the `properties` Map and converts to a plain object before serialization.

### 2. Hash-only changes were async (after guard chain)

**File:** `src/browser/navigation/navigation-controller.ts:550-578`
**Problem:** Hash-only changes (same-origin, same-path, different hash) went through `await this.runGuards()` which yields to microtask queue. This broke synchronous hash navigation from JS.
**Fix:** Moved hash-only check before the guard chain — hash changes are same-document and don't need network/guard processing.

### 3. Relative URLs in pushState/replaceState

**File:** `src/browser/navigation/navigation-controller.ts:772-823`
**Problem:** `UrlParser.parse('/page2')` throws because `new URL('/page2')` is invalid without a base.
**Fix:** Use `new URL(url, current.url)` to resolve relative URLs against the current entry's URL before parsing.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/navigation/navigation-controller.ts` | Added `state` to `NavigationEntry` and `NavigationRequest`; added `go(delta)`, `pushState()`, `replaceState()` methods; added `step(n)` to `NavigationStack`; moved hash check before guards; state parameter on `navigate()`/`replace()` |
| `src/browser/js/history-bindings.ts` | **Created** — History API + Location bindings, window event system, popstate/hashchange event factories, state serialization |
| `src/browser/js/index.ts` | Import `history-bindings`; added `controller` to `RunJSOptions`; wired `window.history`, `window.location`, `window.addEventListener` when controller provided |
| `tests/history-api.test.ts` | **Created** — 65 tests across 6 describe blocks |
| `tests/navigation-controller.test.ts` | Added `state: null` to `makeEntry()` helper |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/js/history-bindings.ts` | History API + Location bindings for JS engine |
| `tests/history-api.test.ts` | 65 tests for History API, Location API, popstate, hashchange, window events, go(), pushState/replaceState |

## Test Results

```
Test Files  83 passed (83)
Tests      3546 passed (3546)
```

### New Tests (65)
- History API bindings: 23 tests (state, length, back, forward, go, pushState, replaceState, serialization)
- Location API bindings: 17 tests (href, origin, protocol, host, hostname, port, pathname, search, hash, assign, replace, reload)
- popstate events: 4 tests (back fires popstate, forward fires popstate, state in popstate, bubbles)
- hashchange events: 2 tests (hash navigation, oldURL/newURL)
- window event methods: 3 tests (addEventListener/removeEventListener/dispatchEvent)
- NavigationController.go(): 6 tests (go(0), go(-1), go(+1), go(-2), out of range)
- pushState/replaceState on controller: 6 tests (state update, URL update, relative URLs, invalid URLs)
- State persistence through navigation: 4 tests (back/forward/go preserve state)

## Verification

- All 83 existing test files continue to pass (no regressions)
- TypeScript compilation clean (no new errors from this session)
- Pre-existing TS errors in `main.ts` and `dom-bindings.ts` (void return types) unchanged
