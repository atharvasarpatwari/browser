# Phase 1: Persistent Passwords, Pluggable Font Metrics & Deferred Navigation

**Date:** 2026-08-08
**Session:** Phase 1 engine-integration/persistence gaps — closed the 3 genuinely remaining TODO items
**Status:** Completed

---

## Summary

Closed the three remaining Phase 1 gaps identified against the (stale) gap-analysis: persistent password store, pluggable `FontMetricsProvider`, and deferred navigation completion. 29 new tests; full suite 8,684/8,684, tsc clean, Electron e2e 2/2.

## What Was Already Done (gap analysis was stale)

- PageLoader/PageRenderer already wired in `src/app/main.ts:759,820`
- Persistent sessions/cookie/bookmark/history/token stores already in DI (`persistent-stores.ts`)
- Microtask queues, sticky font-size, `transform/filter/will-change` stacking triggers, PNG/JPEG/WebP decoding all done in earlier sessions
- IPC channel `direction` already config-driven; SOCKS, WebSocket-binary already shipped

## Changes

### 1. Persistent password store (the last in-memory store)
**Files:** `src/browser/storage/password-store.ts`, `src/browser/storage/persistent-stores.ts`, `src/app/main.ts`

`InMemoryPasswordStore.entries` was `private` → `protected`. Added `PersistentPasswordStore extends InMemoryPasswordStore` in `persistent-stores.ts`; it loads from `localStorage` key `nova-passwords` in the constructor and overrides every mutating method (`add`, `update`, `remove`, `removeByHostname`, `rotateMasterKey`, `importRaw`) to persist after the parent succeeds. The master password is never persisted — re-entered each session (Chrome/Edge vault semantics). Registered `PasswordStore` + `PasswordManager` DI singletons (previously unregistered, `PasswordManager` defaulted to the in-memory store).

### 2. Pluggable FontMetricsProvider (TODO #9)
**Files:** `src/browser/rendering/formatting/text-measure.ts`, `formatting/index.ts`

Added `FontMetricsProvider` (extends `TextMeasurer` with `name` + `isAvailable()`), `HeuristicFontMetricsProvider`, `CanvasFontMetricsProvider`, and `FontMetricsRegistry` (picks first available provider, caches selection). The global singleton is now backed by a registry seeded `[Canvas, Heuristic]`; consumers plug in overrides via `setFontMetricsProvider()`/`getFontMetricsRegistry().register()`. `getTextMeasurer()`/`setTextMeasurer()` kept for backward compatibility.

### 3. Deferred navigation completion (TODO #11)
**Files:** `src/browser/navigation/navigation-controller.ts`, `src/browser/engine/browser-engine.ts`

`NavigationController` gained `setDeferredCompletion(enabled)` and `completeNavigation(entryId?)`. In deferred mode, `navigateTo` stays in `Committed` and records `_pendingEntryId`; the owner transitions to `Complete` via `completeNavigation`, emitting `navigationCompleted` with real elapsed time. Caller errors (stale/mismatched id) return failure **without** corrupting the state machine. `BrowserEngine` enables deferred mode in its constructor and calls `completeNavigation(session.entry.id)` after `runPipeline` succeeds — so `navigationCompleted` now reflects the true end of a page load. `back/forward/go/hashChange` clear the pending id.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/storage/password-store.ts` | `entries` made `protected` for the persistent subclass |
| `src/browser/storage/persistent-stores.ts` | Added `PersistentPasswordStore` + export |
| `src/app/main.ts` | `PasswordStore`/`PasswordManager` DI tokens + registrations |
| `src/browser/rendering/formatting/text-measure.ts` | `FontMetricsProvider` interface, 2 adapters, `FontMetricsRegistry`, registry-backed singleton |
| `src/browser/rendering/formatting/index.ts` | Barrel exports for the new symbols |
| `src/browser/navigation/navigation-controller.ts` | `setDeferredCompletion`, `completeNavigation`, pending tracking in move ops |
| `src/browser/engine/browser-engine.ts` | Enable deferred completion + call `completeNavigation` after pipeline |
| `tests/persistent-stores.test.ts` | 11 `PersistentPasswordStore` tests |
| `tests/text-measure.test.ts` | 14 provider/registry tests |
| `tests/navigation-controller.test.ts` | 7 deferred-completion tests |

## Test Results

```
$ npm run typecheck        # tsc --noEmit → clean
$ npm test
Test Files  189 passed (189)
     Tests  8684 passed (8684)   # +29 vs 8655

$ npx playwright test --config=playwright-electron.config.cjs
2 passed (13.0s)   # electron-smoke + keep-alive
```

**Verification steps:** targeted runs (persistent-stores, password-manager, text-measure, navigation-controller, navigation-bridge, crash-recovery) → `tsc --noEmit` → full vitest suite → Electron e2e. All green.
