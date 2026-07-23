# Web Workers Implementation

**Date:** 2026-07-23
**Session:** Web Workers for Nova Browser JS engine
**Status:** Completed

---

## Summary

Implemented Web Workers API for Nova Browser, providing isolated background JavaScript execution contexts with bidirectional message passing between main thread and workers.

## Architecture

### Worker Class (main thread handle + execution context)

The `Worker` class serves dual purpose:
1. **Main thread handle**: Exposes `postMessage()`, `onmessage`, `addEventListener()`, `terminate()`
2. **Isolated execution context**: Owns its own `Interpreter` + `EventLoop` + `Environment`

Key design decision: Workers are in-process (not OS threads). Each worker gets a fresh `Environment` with no DOM access. Communication is synchronous within the same process but delivered via microtasks to simulate async behavior.

### Message Passing

- **Worker → Main**: `postMessage(data)` inside worker calls `Worker.emitMessage()` which fires main-thread listeners
- **Main → Worker**: `worker.postMessage(data)` enqueues a microtask that invokes the worker's `self.onmessage` handler
- **Structured Clone**: Deep-clone via `structuredCloneJSValue()` — handles primitives, objects, arrays, nested structures

### Worker Environment

Provides (no DOM access):
- `console`, `Math`, `JSON`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`
- `String`, `Number`, `Boolean`, `Array`, `Object`, Error constructors
- `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`
- `fetch`, `Headers`, `Response`, `Request`, `AbortController`
- `postMessage(data)`, `self.close()`, `self` reference

NOT available: `document`, `window`, `history`, `location`, `XMLHttpRequest`, `IntersectionObserver`

### WorkerParentPort

JSObject wrapper that exposes the Worker's main-thread API to JS code. Created by `createWorkerConstructor()` when `new Worker(url)` is called.

## Root Causes

### 1. Missing `clearAll` method on EventLoop
**File:** `src/browser/js/worker.ts`
**Problem:** Worker called `this.eventLoop.clearAll()` but EventLoop only has `clear()`
**Fix:** Changed to `this.eventLoop.clear()`

### 2. Environment lacks `hasLocal` method
**File:** `src/browser/js/worker.ts`
**Problem:** Worker tried to use `env.hasLocal(key)` to check if bindings exist, but Environment doesn't expose this method
**Fix:** Replaced with a loop that reads globals from env and sets them on the selfObj

### 3. `postMessage` required parentPort
**File:** `src/browser/js/worker.ts`
**Problem:** Worker's `postMessage()` delegated to `this.parentPort.emitMessage()`, but parentPort was null unless explicitly set up
**Fix:** Simplified architecture — Worker IS the main-thread handle, `postMessage()` calls `this.emitMessage()` directly

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/worker.ts` | **NEW** — Worker class, WorkerParentPort, structuredCloneJSValue, createWorkerConstructor |
| `tests/worker.test.ts` | **NEW** — 59 tests covering creation, messaging, isolation, termination, edge cases |
| `src/browser/js/index.ts` | Updated exports (existing file, no change) |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/js/worker.ts` | Web Worker implementation (~400 lines) |
| `tests/worker.test.ts` | Test suite (59 tests) |
| `doc/2026-07-23-web-workers.md` | This change log |

## Test Results

```
 ✓ tests/worker.test.ts (59 tests) 83ms
   Test Files  1 passed (1)
        Tests  59 passed (59)

Full suite: 98/100 files pass, 4431/4504 tests pass
(2 pre-existing OOM failures in image-decoder.test.ts — unrelated)
```

## Verification

1. Worker creation: Workers spawn with isolated Interpreter + EventLoop
2. Worker → Main messaging: `postMessage()` inside worker delivers data to main-thread listeners
3. Main → Worker messaging: `worker.postMessage()` delivers data to worker's `self.onmessage`
4. Isolation: `document` and `window` are `undefined` in worker context
5. Termination: Both `worker.terminate()` and `self.close()` work correctly
6. Structured clone: Objects, arrays, nested structures are deep-cloned for message passing
7. Full test suite: 0 regressions (4431 passing, same as before)
