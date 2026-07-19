# Promise + Microtask Queue — Implementation Plan

**Date:** 2026-07-19
**Phase:** 2 — High-Impact Features (Item 7)
**Status:** Planned

---

## Summary

Implement Promise (constructor, .then/.catch/.finally, Promise.all/race/resolve/reject) and a proper microtask queue. This is foundational for async/await (Phase 2, Item 8).

## Current State

- `EventLoop.enqueueMicrotask()` calls fn synchronously (stub) — no queue, no drain
- No Promise type in `JSValue` union
- No `.then()` / `.catch()` / `.finally()`
- `JSFunction.async` flag exists but is never used at runtime
- No `AwaitExpression` handling in interpreter

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ event-loop  │     │ promise.ts       │     │ interpreter  │
│             │     │                  │     │              │
│ microtaskQ  │◄────│ enqueueMicrotask │◄────│ drainMicros  │
│ drainMicros │────►│ resolvePromise   │────►│ run()        │
│ (called by  │     │ rejectPromise    │     │ execBlock()  │
│  interpreter)     │ PromiseAll       │     │ execTry()    │
│             │     │ PromiseRace      │     │              │
└─────────────┘     └──────────────────┘     └──────────────┘
```

## Files to Create

### 1. `src/browser/js/promise.ts`

Core Promise implementation. Dependencies: `values.ts`, `event-loop.ts`.

**Internal state** — stored per-Promise JSObject:
```typescript
interface PromiseState {
  state: 'pending' | 'fulfilled' | 'rejected';
  result: JSValue;
  reactions: Array<{ onFulfilled, onRejected, promise }>;
}
const promiseStates = new WeakMap<JSObject, PromiseState>();
```

**Exports:**
- `createPromiseConstructor(eventLoop)` → JSFunction (native constructor)
- `createPromiseResolve` / `createPromiseReject` — static methods
- `createPromiseAll(eventLoop)` / `createPromiseRace(eventLoop)` — static methods  
- `createPromiseProtoThen(eventLoop)` — `.then()` method
- `isPromiseObject(val)` — type guard

**Key algorithms:**

1. **Promise(resolve, reject)** — executor runs synchronously; resolve/reject capture callbacks
2. **resolvePromise(promise, x)** — handles thenables, native Promises, plain values
3. **enqueueReaction(promise, reaction)** — if fulfilled/rejected, enqueue microtask immediately; if pending, push to reactions array
4. **PromiseProtoThen(onFulfilled, onRejected)** — creates new Promise, registers reaction, enqueues microtask if already settled
5. **PromiseProtoCatch(onRejected)** — alias for `then(undefined, onRejected)`
6. **PromiseProtoFinally(onFinally)** — wraps and re-throws/re-sets value
7. **PromiseResolve(x)** — returns x if already a Promise, else wraps
8. **PromiseReject(x)** — returns rejected promise with reason
9. **PromiseAll(promises)** — counts pending, collects results, resolves when all fulfilled
10. **PromiseRace(promises)** — first settlement wins

### 2. `tests/promise.test.ts`

Test file for Promise + microtask queue behavior.

## Files to Modify

### 3. `src/browser/js/event-loop.ts`

- Add `private microtaskQueue: Array<() => void> = []`
- Replace `enqueueMicrotask(fn)` body: `this.microtaskQueue.push(fn)` (no immediate call)
- Add `drainMicrotasks()`: loop while queue not empty, shift + try/catch each
- Add `get microtaskCount` getter
- Update `clear()` to also clear `microtaskQueue`

### 4. `src/browser/js/interpreter.ts`

- Add optional `eventLoop?: EventLoop` parameter to constructor
- Store as `private eventLoop?: EventLoop`
- In `run()`: after `execBlock`, call `this.eventLoop?.drainMicrotasks()`
- In `execBlock()`: after each statement execution, call `this.eventLoop?.drainMicrotasks()` — ensures microtasks from side effects drain correctly
- Register `Promise` in `createGlobalEnv()`: `env.setLocal('Promise', createPromiseConstructor(eventLoop))`

### 5. `src/browser/js/index.ts`

- Pass `eventLoop` to `Interpreter` constructor in `runJS()`
- Import and re-export `isPromiseObject` from promise.ts

### 6. `src/browser/js/values.ts`

- Add `isPromiseObject()` type guard (exported from promise.ts, not values.ts — values.ts stays pure)
- No changes to `JSValue` union needed — Promises are `JSObject` instances with internal `[[PromiseState]]`

## Microtask Drain Strategy

Per WHATWG/ECMAScript spec:
1. After each synchronous statement execution in `execBlock()` — drain microtasks
2. After `Interpreter.run()` completes — drain microtasks (catch stragglers)
3. After `EventLoop.runOnce()` drains each macrotask — drain microtasks

**Important:** `execBlock` runs many statements in sequence. Draining after EACH statement is correct per spec but expensive. We drain only at specific checkpoints:
- After `execBlock()` returns (not mid-block)
- After `run()` completes
- After each task in `EventLoop.runOnce()`

This matches the "perform a microtask checkpoint" at script evaluation completion and after each macrotask.

## Promise Resolution (Thenable Handling)

```
resolvePromise(promise, x):
  if x === promise → reject with TypeError
  if x is not object → fulfill with x
  then = x.then
  if then is not function → fulfill with x
  if resolving is already true → return
  resolving = true
  enqueue microtask:
    call then.call(x, resolve, reject)
```

**The resolving flag** prevents resolve/reject from being called twice.

## Test Plan

### Promise basics (15 tests)
- Constructor runs synchronously
- resolve() fulfills, reject() rejects
- Double resolve/reject is no-op
- Resolve with value, object, another Promise
- Reject with value
- State transitions: pending→fulfilled, pending→rejected

### .then() (10 tests)
- Handler receives fulfilled value
- Handler receives rejected value (with .catch())
- Chain: then().then().then()
- Return value becomes next promise's value
- Async handlers (via microtask)
- Exception in handler → next catch
- Handler not called if not a function

### .catch() (5 tests)
- Catches rejection
- Chaining after catch

### .finally() (4 tests)
- Called on fulfill and reject
- Doesn't change value unless returns

### Promise.resolve/reject (6 tests)
- Promise.resolve(x) wraps non-promises
- Promise.resolve(promise) returns same promise
- Promise.reject(x) creates rejected promise
- Rejection reason preserved

### Promise.all (6 tests)
- Resolves when all fulfill
- Rejects if any rejects
- Empty array → resolves []
- Non-promise values auto-wrapped
- Order preservation

### Promise.race (4 tests)
- First settle wins
- Empty array → never settles
- Non-promise values auto-wrapped

### Microtask queue (5 tests)
- Microtasks drain after macrotask
- Microtasks drain after run()
- Microtask errors don't crash
- Nested microtasks
- Microtask ordering

**Total: ~55 tests**

## Edge Cases

1. **Resolve with thenable** — `then` is called as microtask, not synchronously
2. **Promise.resolve(promise)** — returns same promise (not new one)
3. **Circular thenable** — resolving flag prevents infinite loop
4. **Handler exception** — caught by try/catch, rejects next promise
5. **Empty `.then()`** — passes through value
6. **Promise.all with empty array** — resolves immediately with `[]`
7. **Promise.race with empty array** — never resolves (test with timeout)
8. **Resolve with Promise that rejects** — chains rejection

## Verification

1. Run `npx vitest run tests/promise.test.ts` — all new tests pass
2. Run `npx vitest run` — full suite still passes (no regressions)
3. Run TypeScript check if available
