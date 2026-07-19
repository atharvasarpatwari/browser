# Fetch API Implementation + EventLoop Interpreter Fix

**Date:** 2026-07-19
**Session:** Fetch API implementation, EventLoop interpreter wiring, native→JS Promise bridging
**Status:** Completed

---

## Summary

Implemented complete Fetch API (`fetch()`, `Headers`, `Response`, `Request`, `AbortController`/`AbortSignal`) for the JS engine. Fixed critical EventLoop bug where microtask reactions (including Promise `.then()` callbacks) couldn't call JS functions after `interp.run()` returned. 36 new fetch-api tests, 3613→3732 total tests (86 files, all green).

## Root Causes

### 1. EventLoop `_globalCaller` null after `interp.run()` returns
**File:** `src/browser/js/event-loop.ts`
**Problem:** Native Promise `.then()` callbacks fire asynchronously after `interp.run()` has returned. When they call `fulfillPromise`/`rejectPromise`, reactions are enqueued on EventLoop. But `drainMicrotasks()` → `callJSFunction()` needs `_globalCaller` which is `null` → throws "No JS interpreter registered" → swallowed by `drainMicrotasks()` catch block. All Promise `.then()` chains silently failed.
**Fix:** Added `_interpreter` field + `setInterpreter()` method on EventLoop. `drainMicrotasks()` temporarily sets `_globalCaller` via `setGlobalCaller()` during processing.

```typescript
// event-loop.ts
private _interpreter: JSFunctionCaller | null = null;

setInterpreter(interpreter: JSFunctionCaller): void {
  this._interpreter = interpreter;
}

drainMicrotasks(): void {
  if (this._interpreter) {
    setGlobalCaller(this._interpreter);
  }
  while (this.microtaskQueue.length > 0) {
    const task = this.microtaskQueue.shift()!;
    try { task(); } catch (e) { /* swallow */ }
  }
  if (this._interpreter) {
    setGlobalCaller(null as any);
  }
}
```

```typescript
// interpreter.ts constructor
this.eventLoop.setInterpreter(this);
```

### 2. Native function throws not wrapped in JSError (evalCall)
**File:** `src/browser/js/interpreter.ts:725`
**Problem:** `fn.nativeFn(thisObj, args)` in `evalCall` had no try/catch. Native errors from `throwIfAborted()` escaped uncaught, causing `fetch()` to abort without rejection.
**Fix:** Added identical JSError wrapping as `callFunction`:

```typescript
// evalCall native path
try {
  const result = fn.nativeFn(thisObj, args);
  return result;
} catch (e) {
  if (e instanceof JSError) throw e;
  if (e instanceof Error) throw new JSError(e.message, 'Error');
  throw new JSError(String(e), 'Error');
}
```

### 3. Native→JS Promise bridging via `Promise.resolve()`
**File:** `src/browser/js/fetch-api.ts`
**Problem:** `Promise.resolve(fetchFn(url, platformInit)).then(...)` was needed to properly chain native Promise results. The `fetchFn` returns a native Promise but the JS engine needs it wrapped in its own Promise system.
**Fix:** Used `Promise.resolve()` wrapper for proper chaining; added `signalInternal?.aborted` check inside `.then()` callback to catch late aborts.

### 4. `evalCall` member expression double-evaluation
**File:** `src/browser/js/interpreter.ts`
**Problem:** Member expression objects evaluated twice (once for function lookup, once for `this`), causing duplicate promise creation in Promise chain resolution.
**Fix:** Refactored to evaluate object once as `thisObj`, look up property separately via new `getPropertyValue()` helper.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/fetch-api.ts` | **Created** — Headers, Response, Request, AbortController, AbortSignal, fetch(). ~770 lines. |
| `src/browser/js/event-loop.ts` | Added `_interpreter` field, `setInterpreter()`, `drainMicrotasks()` sets/restores `_globalCaller` |
| `src/browser/js/interpreter.ts` | `callFunction` wraps native throws in JSError; `evalCall` native path wraps in JSError; constructor calls `eventLoop.setInterpreter(this)`; JSError class removed (moved to values.ts); re-exports JSError |
| `src/browser/js/values.ts` | `JSError` class moved here; `callJSFunction` wraps native throws in JSError; exports `setGlobalCaller` |
| `src/browser/js/promise.ts` | Exported `createPromiseObj`, `fulfillPromise`, `rejectPromise`, `createWiredPromise`; debug logging removed; Promise.all/allSettled length bug fixed |
| `src/browser/js/index.ts` | Imports fetch-api; wires 5 globals; `platformFetch` param on `createGlobalEnv` |
| `src/browser/js/parser.ts` | `parseExpression(2)` fix in `parseVariableDeclaration` and for-loop initializer |

## Files Created

| File | Purpose |
|------|--------|
| `tests/fetch-api.test.ts` | 36 tests — Headers (8), Response (9), Request (4), AbortController (6), fetch (9) |
| `doc/fetch-api-xhr-plan.md` | Implementation plan for Fetch API + XHR |
| `doc/2026-07-19-fetch-api-implementation.md` | This document |

## Test Results

```
86 files, 3732 tests — ALL GREEN
fetch-api.test.ts: 36/36 passing
promise.test.ts: 31/31 passing
Full suite: 86 files, 3732 tests
```

## Verification Steps

1. Ran individual fetch-api test file: 36/36 passing
2. Ran full test suite: 86 files, 3732 tests, all green
3. Verified EventLoop microtask fix: Promise `.then()` chains work after `interp.run()` returns
4. Verified abort signal handling: AbortController.abort() rejects fetch Promise
5. Verified JSError wrapping: native function throws properly caught by JS try/catch
