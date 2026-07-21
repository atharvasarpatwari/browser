# VM Closure & Upvalue Fixes

**Date:** 2026-07-22
**Session:** Bytecode VM closure upvalue support — completing the upvalue implementation started in prior sessions
**Status:** Completed

---

## Summary

Completed the upvalue implementation for the bytecode VM, enabling closures to correctly capture and mutate variables from enclosing function scopes. Fixed 4 distinct bugs: missing upvalue propagation in `compileUpdate`, missing upvalue passing in `handleCall`/`handleCallMethod`/`handleNew`, missing `outerScopes` wiring in `compileFunctionExpr`, and missing `args` parameter in `vm.run()`.

## Root Causes

### 1. `compileUpdate` ignored upvalue variables
**File:** `src/browser/js/bytecode-compiler.ts:936-953`
**Problem:** `compileUpdate` only checked `resolveLocal()` then fell back to `LOAD_GLOBAL`/`STORE_GLOBAL`, never consulting upvalues. So `i++` in a closure compiled to `LOAD_GLOBAL`/`STORE_GLOBAL` instead of `LOAD_UPVALUE`/`STORE_UPVALUE`.
**Fix:** Added upvalue resolution between local and global checks:
```typescript
const upvalue = this.resolveUpvalue(name);
if (upvalue >= 0) {
  this.builder.emitU16(OP.LOAD_UPVALUE, upvalue);
  // ... arithmetic ...
  this.builder.emitU16(OP.STORE_UPVALUE, upvalue);
} else {
  // fall back to LOAD_GLOBAL/STORE_GLOBAL
}
```

### 2. VM `handleCall`/`handleCallMethod`/`handleNew` didn't pass upvalues
**File:** `src/browser/js/vm.ts:801,847,892`
**Problem:** When the VM called a bytecode function directly (not through the interpreter bridge), it called `pushFrame()` without `fn.upvalues`, so all upvalue slots were empty arrays. LOAD_UPVALUE would crash with `Cannot read properties of undefined`.
**Fix:** Changed all three `pushFrame` calls to pass `jsFn.upvalues ?? []`:
```typescript
this.pushFrame(bytecodeFn, jsFn.thisValue ?? undefined, args, jsFn.closure, jsFn.upvalues ?? []);
```

### 3. `compileFunctionExpr` didn't wire outer scopes to child compiler
**File:** `src/browser/js/bytecode-compiler.ts:compileFunctionExpr()`
**Problem:** The child compiler for inner function expressions received no `outerScopes`, so `resolveUpvalue()` always returned -1. Inner functions couldn't see enclosing locals.
**Fix:** Build `outerMap` from current compiler's locals and capturedUpvalues, then set `fnCompiler.outerScopes = [...this.outerScopes, outerMap]`. Pass `capturedUpvalues` to `builder.build()`.

### 4. `resolveUpvalue` return value checked incorrectly
**File:** `src/browser/js/bytecode-compiler.ts:947`
**Problem:** `resolveUpvalue()` returns -1 for "not found". The new code did `if (upvalue)` which is truthy for -1, causing program-level code to emit LOAD_UPVALUE/STORE_UPVALUE with index -1.
**Fix:** Changed to `if (upvalue >= 0)`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/bytecode-compiler.ts` | Added upvalue check in `compileUpdate`. Rewrote `compileFunctionExpr` to build outerScopes for child compiler and pass capturedUpvalues. |
| `src/browser/js/vm.ts` | Added `upvalues` param to `vm.run()`. Passed `jsFn.upvalues ?? []` in `handleCall`, `handleCallMethod`, `handleNew`. |
| `src/browser/js/interpreter.ts` | Pass `fn.upvalues` to `vm.run()` in `callFunction`. |

## Test Results

```
Bytecode VM:  141/141 pass
Full suite:    90/91 test files pass, 4089/4145 tests pass (56 pre-existing failures)
```

## Verification

1. `npx vitest run tests/bytecode-vm.test.ts` — 141/141 pass including closures test (`counter() { var n = 0; return function() { n++; return n; } }` returns 3 after 3 calls)
2. `npx vitest run` — no regressions introduced
3. Closure mutation via upvalue correctly propagates: `LOAD_UPVALUE` reads from shared `UpvalueRef`, `STORE_UPVALUE` writes back to the same ref, all closures sharing the same ref see mutations
