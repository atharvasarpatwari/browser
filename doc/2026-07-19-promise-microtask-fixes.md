# Promise + Microtask Queue — Bug Fixes

**Date:** 2026-07-19
**Session:** Promise chain failures + Promise.all() resolution
**Status:** Completed

---

## Summary

Fixed 3 root causes preventing 4 Promise tests from passing: a parser comma-precedence bug causing multi-declarator `var` statements to be misparsed, and a missing array `length` update in `Promise.all()` / `Promise.allSettled()` result accumulation.

## Root Causes

### 1. Parser comma operator consuming variable declaration separator

**File:** `src/browser/js/parser.ts`
**Problem:** `parseVariableDeclaration` called `parseExpression()` with default `minPrec=0`, which allows the comma operator (precedence 1) to consume the comma separator in `var a = 0, b = 0;`, treating it as `var a = (0, (b = 0));`. Only the first declarator was ever parsed — `b` was never declared, so assignments to `b` silently failed via `Environment.set()`.
**Fix:** Changed `parseExpression()` to `parseExpression(2)` to stop at comma precedence. Same fix applied to for-loop initializer.
```typescript
// Before
const init = this.parseExpression();
// After
const init = this.parseExpression(2);
```
Impact: Unblocked `Promise chaining` tests (items 1 & 4) which used multi-declarator `var` statements.

### 2. Promise.all() result array missing `length` update

**File:** `src/browser/js/promise.ts`
**Problem:** `createPromiseAllFn` created `resultArr = createArray([])` with `length=0`. The `onFulfilled` callback set indexed properties (`resultArr[0]`, `resultArr[1]`, etc.) but never updated `length`. When `vals.join(',')` was called in the test, `getArrayElements()` read `length=0` and returned `[]`.
**Fix:** Added `resultArr.properties.set('length', { value: len, ... })` in the `onFulfilled` callback after setting each index.
**Fix applied identically to:** `createPromiseAllSettledFn` (both `onFulfilled` and `onRejected` callbacks).

### 3. (Root cause identified but not directly fixed in this session) — `Promise.all()` was the only failing path

The `Promise.all()` non-promise-values test had the same `length` issue. Once #2 was fixed, both Promise.all tests passed.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | `parseExpression()` → `parseExpression(2)` in `parseVariableDeclaration` and for-loop initializer |
| `src/browser/js/promise.ts` | Added `length` update in `Promise.all` and `Promise.allSettled` result accumulators; removed all debug `console.log` statements |
| `src/browser/js/event-loop.ts` | Removed all debug `console.log` statements from `enqueueMicrotask` and `drainMicrotasks` |
| `src/browser/js/interpreter.ts` | Removed all debug `console.log` statements from `callFunction` and `execVarDecl` |

## Test Results

```
Test Files  84 passed (84)
     Tests  3577 passed (3577)
```

Promise tests: 31/31 passing (was 27/31 before fixes)

## Verification

- `npx vitest run tests/promise.test.ts` — 31/31 pass
- `npx vitest run` — 84 files, 3577 tests, all green
- No debug logging remains in modified files
