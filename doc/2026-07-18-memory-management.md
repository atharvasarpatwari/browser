# Memory Management & Leak Prevention

**Date:** 2026-07-18
**Session:** Memory leak audit and fixes across all subsystems
**Status:** Completed

---

## Summary

Comprehensive audit and fix of memory leak patterns across the Nova Browser codebase. Fixed 14 issues: 2 HIGH severity timer leaks in the JS interpreter, 1 HIGH architectural gap (missing disposal for rendering pipeline), and 11 MEDIUM severity unbounded growth patterns.

## Root Causes

### 1. Interpreter Timer Leaks (HIGH)

**File:** `src/browser/js/interpreter.ts`
**Problem:** `clearTimeout` and `clearInterval` were no-ops (line 1088-1089). `taskQueue` was an unbounded array with no ID-based removal, so timers could never be cancelled and closures accumulated forever.
**Fix:** Replaced `taskQueue: Array<...>` with `timers: Map<number, {...}>` keyed by auto-incrementing ID. `setTimeout`/`setInterval` now assign an ID via `nextTimerId++`. `clearTimeout`/`clearInterval` now call `this.timers.delete(id)` for O(1) removal.

### 2. Interpreter Output Unbounded Growth

**File:** `src/browser/js/interpreter.ts`
**Problem:** `console.log`, `console.error`, and `console.warn` appended to `this.output[]` without any limit.
**Fix:** Added `MAX_OUTPUT = 1000` constant. After each push, if `output.length > MAX_OUTPUT`, splice oldest entries. Added `clearOutput()` method.

### 3. Missing Pipeline Disposal (HIGH)

**File:** `src/browser/rendering/reflow-repaint-controller.ts`
**Problem:** `ReflowRepaintController` had no `dispose()` — scheduler, damage trackers, and document reference were never cleaned up on shutdown.
**Fix:** Added `dispose()` that cancels pending frames, clears damage trackers, and nulls the document reference.

### 4. EventLoop Bulk Cleanup (HIGH)

**File:** `src/browser/js/event-loop.ts`
**Problem:** No way to bulk-clear all pending timers, RAF callbacks, and running state.
**Fix:** Added `dispose()` that clears `tasks`, `timers`, `rafCallbacks`, and resets `running`.

### 5. DomTree idIndex Leak

**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** `removeChild()` removed from `nodeIndex` but never cleaned `idIndex` — elements with `id` attributes leaked permanently.
**Fix:** After `nodeIndex.delete(child.domId)`, added check: if child is an element with an `id` attribute, and `idIndex.get(id) === child`, delete from `idIndex`.

### 6. PaintEngine elementCommands Leak

**File:** `src/browser/rendering/paint-engine.ts`
**Problem:** `elementCommands` Map used `DomElement` as key — removed elements stayed in the map between incremental paints.
**Fix:** In `paintIncremental()`, after processing dirty elements, sweep `elementCommands` against a Set of current DOM elements and delete stale entries.

### 7. LazyLoader/IntersectionObserver Cleanup

**Files:** `src/browser/rendering/lazy-loader.ts`, `src/browser/rendering/intersection-observer.ts`
**Problem:** `LazyLoader.dispose()` didn't null `domTree`/`document`. `IntersectionObserver.dispose()` didn't null `root`/`callback`.
**Fix:** Added null assignments for all held references after disposal.

### 8. MutationObserver Module Globals

**File:** `src/browser/rendering/html5/mutation-observer.ts`
**Problem:** Module-level `registrations[]`, `recordQueue[]`, `pendingObservers` Set, and `microtaskScheduled` flag were never cleaned at application shutdown.
**Fix:** Wired existing `clearAllRegistrations()` export into `ApplicationBootstrap.stop()` in `main.ts`.

### 9. Unbounded Stores (MEDIUM)

**Files:** `third-party-security.ts`, `permission-manager.ts`, `history-store.ts`
**Problem:** `_blockedRequests[]`, `requests[]`, and `entries` Map grew without bound.
**Fix:**
- ThirdPartySecurityManager: cap `_blockedRequests` at 5000, splice oldest
- PermissionManager: cap `requests` at 5000, splice oldest
- InMemoryHistoryStore: cap at 10000 entries, evict oldest by `lastVisitTime`

### 10. LayoutEngine floatContext

**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `floatContext` retained references to float layout state after `layout()` completed.
**Fix:** Added `this.floatContext = null` at end of `layout()`.

### 11. FrameScheduler/DamageTracker API Consistency

**Files:** `frame-scheduler.ts`, `damage-tracker.ts`
**Problem:** No `dispose()` method — only `cancel()` and `clear()`.
**Fix:** Added `dispose()` aliases for consistent IDisposable pattern.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | Timer Map, output cap, proper clearTimeout/clearInterval |
| `src/browser/js/event-loop.ts` | Added `dispose()` |
| `src/browser/rendering/reflow-repaint-controller.ts` | Added `dispose()` |
| `src/browser/rendering/frame-scheduler.ts` | Added `dispose()` |
| `src/browser/rendering/damage-tracker.ts` | Added `dispose()` |
| `src/browser/rendering/dom-tree.ts` | idIndex cleanup in `removeChild()` |
| `src/browser/rendering/paint-engine.ts` | Stale element cleanup in `paintIncremental()` |
| `src/browser/rendering/lazy-loader.ts` | Null references in `dispose()` |
| `src/browser/rendering/intersection-observer.ts` | Null references in `dispose()` |
| `src/browser/rendering/layout-engine.ts` | Null `floatContext` after layout |
| `src/browser/security/third-party-security.ts` | Cap blocked requests at 5000 |
| `src/browser/security/permission-manager.ts` | Cap requests at 5000 |
| `src/browser/storage/history-store.ts` | Cap entries at 10000 with LRU eviction |
| `src/app/main.ts` | Import and call `clearAllRegistrations()` on stop |

## Files Created

| File | Purpose |
|------|---------|
| `tests/memory-management.test.ts` | 37 tests covering all fixes |

## Test Results

```
 Test Files  1 passed (1)
      Tests  37 passed (37)

 Full suite: 61 test files, 2362 tests, all passing
```

## Verification Steps

1. Ran `npx vitest run tests/memory-management.test.ts` — all 37 tests pass
2. Ran `npx vitest run` — full suite of 2362 tests passes, no regressions
3. Verified interpreter `clearTimeout`/`clearInterval` actually remove timers from the Map
4. Verified `DomTree.removeChild()` removes from idIndex
5. Verified `InMemoryHistoryStore` evicts oldest when exceeding 10000
6. Verified `ThirdPartySecurityManager` caps at 5000 blocked requests
7. Verified `PermissionManager` caps at 5000 requests
8. Verified `LazyLoader.dispose()` nulls domTree/document
9. Verified `IntersectionObserver.dispose()` nulls root/callback
10. Verified `ReflowRepaintController.dispose()` cancels frames and clears damage
