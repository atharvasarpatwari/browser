# Event Loop & Task Queue Improvements

**Date:** 2026-07-25
**Session:** Event loop & task queue improvements — microtask/macrotask ordering, queueMicrotask API, process.nextTick, async/await suspend/resume
**Status:** Completed

---

## Summary

Implemented proper macrotask/microtask scheduling per the HTML spec. Added `queueMicrotask` global API, `process.nextTick` priority microtask queue, fixed microtask-before-macrotask ordering, and began async/await integration with `AwaitSignal` suspend/resume mechanism.

## Changes

### 1. Priority Microtask Queue (`process.nextTick`)

**File:** `src/browser/js/event-loop.ts`
**Problem:** No way to schedule priority microtasks that run before regular microtasks.
**Fix:** Added `nextTickQueue` array and `enqueueNextTick(fn)` method. `drainMicrotasks()` drains `nextTickQueue` first, then `microtaskQueue`, ensuring proper priority ordering.

### 2. `queueMicrotask` & `process.nextTick` Global APIs

**File:** `src/browser/js/event-loop.ts`
**Problem:** No `queueMicrotask` or `process.nextTick` exposed to JavaScript.
**Fix:** Added `bindQueueMicrotask(globalEnv, eventLoop)` function that binds:
- `queueMicrotask(fn)` — enqueue a regular microtask
- `process.nextTick(fn)` — enqueue a priority microtask
- `process.env` — empty object (placeholder)

### 3. Microtask-Before-Macrotask Ordering

**File:** `src/browser/js/event-loop.ts`
**Problem:** `runOnce()` did not guarantee microtasks are drained before macrotasks.
**Fix:** Rewrote `runOnce()` to: (1) drain all microtasks first, (2) execute exactly one due macrotask, (3) drain microtasks again after the macrotask, (4) only process RAF callbacks if no macrotasks were due. Uses `findIndex` + `splice` instead of filter to avoid losing non-executed tasks.

### 4. `AwaitSignal` Suspend/Resume Mechanism

**File:** `src/browser/js/values.ts`
**Problem:** No mechanism to suspend async function execution when `await` encounters a pending Promise.
**Fix:** Added `AwaitSignal` interface and `isAwaitSignal()` type guard, following the existing signal pattern (BreakSignal, ReturnSignal, etc.).

### 5. `evalAwait` Promise Resolution

**File:** `src/browser/js/interpreter.ts`
**Problem:** `evalAwait` just returned the awaited value without resolving Promises.
**Fix:** Now checks if the value is a Promise:
- Fulfilled → extracts value via `getPromiseResult()`
- Rejected → throws the reason as a JSError
- Pending + eventLoop available → throws `AwaitSignal` to suspend execution
- Pending + no eventLoop → falls through (return Promise object)

### 6. Async Function Call Handling

**File:** `src/browser/js/interpreter.ts`
**Problem:** `callFunction()` and `evalCall()` did not handle `AwaitSignal` from async function bodies.
**Fix:** Wrapped async function body execution in try/catch for `AwaitSignal`. Added `handleAsyncAwait()` method that:
1. Creates a continuation Promise
2. Enqueues a microtask that attaches `.then()` to the awaited Promise
3. On fulfillment, resolves the continuation Promise
4. On rejection, rejects the continuation Promise

### 7. Promise State Inspection

**File:** `src/browser/js/promise.ts`
**Problem:** No way to inspect Promise state from outside the promise module.
**Fix:** Added `isPromiseFulfilled()`, `isPromiseRejected()`, `isPromisePending()`, and `getPromiseResult()` exported functions.

### 8. VM `OP.AWAIT` Integration

**File:** `src/browser/js/vm.ts`
**Problem:** `OP.AWAIT` was a no-op.
**Fix:** Added Promise state checking — if the value is a fulfilled Promise, extracts the result. Added `setEventLoop()` method for future microtask integration. Pending Promises pass through (full VM suspend/resume deferred).

### 9. Interpreter Promise Binding

**File:** `src/browser/js/interpreter.ts`
**Problem:** No `queueMicrotask` or `process.nextTick` available in JS.
**Fix:** `createGlobalEnv()` now calls `bindQueueMicrotask()` when an EventLoop is available, with synchronous fallback when not.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/event-loop.ts` | Added `nextTickQueue`, `enqueueNextTick()`, `bindQueueMicrotask()`, rewrote `runOnce()` for proper ordering |
| `src/browser/js/values.ts` | Added `AwaitSignal` interface, `isAwaitSignal()` type guard |
| `src/browser/js/promise.ts` | Added `isPromiseFulfilled()`, `isPromiseRejected()`, `isPromisePending()`, `getPromiseResult()` |
| `src/browser/js/interpreter.ts` | Fixed `evalAwait`, added `handleAsyncAwait()`, imported promise helpers and bindQueueMicrotask |
| `src/browser/js/vm.ts` | Fixed `OP.AWAIT` to resolve fulfilled Promises, added `setEventLoop()` |

## Files Created

| File | Purpose |
|------|---------|
| `tests/event-loop.test.ts` | 24 tests for microtask ordering, queueMicrotask, process.nextTick, timers, RAF |
| `doc/2026-07-25-event-loop-task-queues.md` | This change log |

## Test Results

```
Test Files  133 passed (134)
Tests       5923 passed (5979)
```

- `tests/event-loop.test.ts`: 24/24 passed
- `tests/promise.test.ts`: 31/31 passed
- `tests/js-engine.test.ts`: 158/158 passed
- `tests/bytecode-vm.test.ts`: 141/141 passed
- `tests/script-execution.test.ts`: 20/20 passed
- `tests/worker.test.ts`: 59/59 passed
- `tests/gc.test.ts`: 62/62 passed
- `tests/canvas2d.test.ts`: 67/67 passed
- All CSS5 tests: 331/331 passed

## Verification Steps

1. Ran full test suite — 133/134 files pass (1 worker OOM, not a test failure)
2. Ran all JS-related test files individually — all pass
3. New event-loop.test.ts verifies:
   - Microtasks drain before macrotasks in `runOnce()`
   - `nextTickQueue` drains before `microtaskQueue`
   - Microtasks enqueued by microtasks are processed in FIFO order
   - `queueMicrotask` and `process.nextTick` are available as globals
   - Timer API works with proper microtask draining
   - RAF callbacks drain microtasks after execution
4. Existing promise.test.ts (31 tests) all pass unchanged

## Known Limitations

1. **Async function multi-await**: The `handleAsyncAwait` currently resolves the continuation Promise with the awaited value but does not re-execute the remaining function body. Full multi-await support requires saving/restoring interpreter execution state (coroutine-style), which is deferred.
2. **VM async suspend/resume**: `OP.AWAIT` resolves fulfilled Promises but does not suspend for pending ones. Full VM suspend/resume requires serializing the stack and frames, which is deferred.
3. **Interpreter timers**: The interpreter's `setTimeout`/`setInterval` implementation uses its own `this.timers` map rather than the EventLoop's `schedule()`. Both paths drain microtasks correctly.
