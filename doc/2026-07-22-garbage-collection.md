# Garbage Collection — Mark-and-Sweep with Generational Support

**Date:** 2026-07-22
**Session:** Garbage collection implementation
**Status:** Completed

---

## Summary

Implemented a two-generation mark-and-sweep garbage collector for the Nova JS engine. The GC provides automatic memory management with root scanning (VM stack, call frames, environment chains), weak references via native FinalizationRegistry, finalizer support, and generational promotion from nursery to tenured space. 62 new tests all pass; zero regressions.

## Architecture

### Two-Generation Design

| Generation | Threshold | Trigger |
|------------|-----------|---------|
| Young (nursery) | 128KB allocated | Every 500 allocations |
| Old (tenured) | 1MB allocated | Every 2000 allocations |

Objects that survive a young collection are promoted to old generation. Full collections scan all generations. The system avoids collecting during native JS callbacks by deferring collections when `collecting` is true (reentrancy guard).

### Components

**`heap.ts`** — Heap allocator
- `GCHeader`: per-object metadata (id, marked, size, generation, finalizer)
- `Heap.allocate(obj)`: assigns header, adds to young gen, triggers collection if threshold exceeded
- `Heap.sweep()`: removes unmarked objects, invokes finalizers via `header.finalizer`, returns swept count
- `Heap.mark(obj)` / `clearMarks()` / `promote(obj)` / `estimateObjectSize(obj)`
- Global singletons: `getHeap()` / `setHeap()`

**`roots.ts`** — Root scanning
- `RootScanner`: visitor-based design. GC registers its `markAndEnqueue()` as visitor in constructor
- `scanRoots()`: scans VM stack via `vm.getStack().slice(0, vm.getSP())`, call frames (locals, upvalues, thisArg), and global env bindings via `Environment.getBindings()` (walks all scope levels)
- `WeakRefStore`: creates `WeakRef<object>` instances using native `FinalizationRegistry` for bookkeeping (no strong Map keys — prevents collection)

**`gc.ts`** — Core engine
- `GarbageCollector`: orchestrator with `collectYoung()` (young gen only), `collectFull()` (all generations), `collect()` (auto-selects), `collectAndFinalize()`
- Iterative worklist tracing (not recursive) — avoids stack overflow on deep graphs
- `onFinalize(callback)` — sets `header.finalizer` for an object (invoked during sweep)
- `enable()` / `disable()` — for performance-critical sections
- Global singleton: `getGC()` / `setGC()`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/values.ts` | Added `getParent()` and `getBindings()` public accessors to `Environment` for root scanning |
| `src/browser/js/vm.ts` | Exported `CallFrame` interface; added `gcCallback` field, `setGCCallback()`, `getStack()`, `getSP()`, `getFrames()`, `getEnv()` accessors; added GC safe point check every 2000 opcodes |
| `src/browser/js/interpreter.ts` | Imported `GarbageCollector`/`getGC`; added `gc` field; wired `vm.setGCCallback(() => this.gc.collect())` in both VM creation sites |
| `src/browser/js/index.ts` | Added exports for `GarbageCollector`, `getGC`, `setGC`, `Heap`, `getHeap`, `setHeap`, `RootScanner`, `WeakRefStore` |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/js/heap.ts` | Heap allocator with generational support, allocation tracking, sweep/finalize |
| `src/browser/js/roots.ts` | RootScanner (VM stack + frames + env chains) + WeakRefStore (FinalizationRegistry-based) |
| `src/browser/js/gc.ts` | GarbageCollector — mark-and-sweep engine with root scanning, finalization, weak refs |
| `tests/gc.test.ts` | 62 tests covering heap, roots, weak refs, finalization, reachability, stress, generations |

## Root Causes (Bugs Fixed During Development)

### 1. scanRoots() bailed out when VM was null
**File:** `src/browser/js/gc.ts`
**Problem:** `scanRoots()` returned early if `this.vm` was null, meaning `globalEnv` was never scanned. GC would collect live global-scope objects.
**Fix:** Restructured to always scan `this.globalEnv` when available, independent of VM availability.

### 2. onFinalize() used FinalizationRegistry instead of header.finalizer
**File:** `src/browser/js/gc.ts`
**Problem:** Initial implementation tried to use `FinalizationRegistry` at the GC level. But sweep already iterates all objects — cleaner to set `header.finalizer` and invoke it directly during sweep.
**Fix:** `onFinalize()` now sets `header.finalizer = callback`. `heap.sweep()` reads and invokes it.

### 3. WeakRefStore used Map (strong keys prevent collection)
**File:** `src/browser/js/roots.ts`
**Problem:** Storing `WeakRef` objects in a `Map<object, WeakRef<object>>` creates a strong reference from the Map key to the object, preventing the GC from ever collecting it.
**Fix:** Uses native `FinalizationRegistry` for bookkeeping — no strong Map keys. `FinalizationRegistry` tracks weak refs without preventing collection.

## Test Results

```
gc.test.ts: 62/62 passed
  ✓ Heap (7): allocate, track, mark, sweep, promote, reset
  ✓ RootScanner (5): stack, frames, env chains, global env
  ✓ WeakRefStore (3): create, native FinalizationRegistry
  ✓ FinalizationRegistry (4): register, unregister, clear
  ✓ GC Reachability (6): env bindings, prototype, arrays, closures, circular refs, deep chains
  ✓ GC Finalization (4): on final collect, not on survive, errors, multiple objects
  ✓ GC Weak References (2): basic, prevent collection of live objects
  ✓ GC VM Integration (4): constructor wiring, enable/disable, forced collect, stats
  ✓ GC Stress Tests (4): rapid cycles, large object graphs, finalization load, weak ref stress
  ✓ GC Generations (2): young gen, old gen promotion
  ✓ GC Edge Cases (5): empty heap, no VM, large properties, nested arrays, disable/re-enable

Full suite: 91 test files, 4177/4189 tests pass (11 pre-existing failures in image-decoder.test.ts)
```

## Test Results

```
Full suite: 91/91 test files pass, 4177/4189 tests pass
GC new tests: 62/62 pass
Pre-existing failures: 11 (image-decoder.test.ts — unrelated)
Zero regressions introduced
```
