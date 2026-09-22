# Native Engine Errors Were Uncatchable, and Skipped `finally` When Uncaught

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Picked up a gap explicitly deferred from the same-day react.dev-bisection round: a native (non-guest-thrown) `ReferenceError` from a real TDZ violation wasn't catchable by a guest `try/catch`. Fixing it surfaced a second, closely-related bug in the exact same function.
**Status:** Completed (2 root causes fixed)

---

## Summary

`execTry()` only ever treated a `JSError`-wrapped value as catchable — any *native* TS-level exception reaching it (a real TDZ violation, or any other internal validation error thrown as a plain `Error`/`ReferenceError`/`TypeError`) always fell through to an unconditional re-throw, unwinding straight past a guest script's own `try/catch` as if it weren't there at all. Fixing that surfaced a second bug in the same re-throw path: when no `catch` clause existed at all (`try { ... } finally { ... }`), the re-throw happened *before* the `finally` block ever ran — silently skipping cleanup code for any native error, though a guest-level `throw` statement was unaffected (it flows through a completely different, signal-based completion path that already handled this correctly).

## Root Causes

### 1. A native engine exception was never catchable by a guest `try/catch`
**File:** `src/browser/js/interpreter.ts` (`execTry()`)
**Real trigger:** `try { let x = x + 1; } catch(e) { ... }` — a self-referencing `let` declaration, a real TDZ violation `Environment.get()` already correctly detects and throws for, found while verifying the `let`/`const` destructuring fix earlier the same day.
**Problem:** `callJSFunction()` already wraps a native throw from a *native function call* into a real, catchable `Error`-shaped guest value (with a comment explicitly noting why: "so sandboxed `catch(e)` sees `e.message`/`e.name` like a real thrown Error"). `execTry()` never got the same treatment for native throws from the interpreter's *own* statement/expression evaluation — its catch block only handled `e instanceof JSError`, and did `throw e` (bypassing any guest handler) for anything else, including TDZ `ReferenceError`s that are supposed to be exactly as catchable as any other real error.
**Fix:** When `execTry()` catches something that isn't already a `JSError` and this `try` statement has a handler, wrap it the same way `callJSFunction()` does (`name`/`message` from the native `Error`, built into a real error object via the existing `makeErrorObject()`) before running the guest catch block — reusing the established pattern rather than inventing a new one.

### 2. A native exception with no `catch` handler skipped its own `finally` block
**File:** `src/browser/js/interpreter.ts` (`execTry()`)
**Real trigger:** `try { let y = y; } finally { cleanup(); }` — found immediately while verifying fix #1, using the exact same TDZ trigger but with only a `finally`, no `catch`.
**Problem:** The no-handler branch re-threw the native error *from inside the catch block*, which unwinds the whole `execTry()` call immediately — the `if (stmt.finalizer) { ... }` logic that runs after the try/catch in source order never executed. A guest-level `throw` statement doesn't hit this at all, since `execThrow()` returns a `ThrowSignal` value through the normal (non-exception) completion path, which already reaches the finalizer correctly — this was specifically a native-exception-only gap, invisible to every existing test that only ever exercised guest `throw`.
**Fix:** Defer the re-throw: an uncaught native error is now stored (`uncaughtNative`) instead of thrown immediately, the finalizer always runs, and the original error is re-thrown only *after* — unless the finalizer itself produced a new completion (return/break/continue/throw), which correctly overrides the original exception per spec, matching how the finalizer already overrides a *guest*-level pending throw just above it.

## Notes

- Verified nested `try`/`catch`/`finally` combinations fire in the right order for a native error (inner `finally` first, then outer `catch`), and that a `return` inside a `finally` correctly overrides an in-flight native exception (`try { let y = y; } finally { return 'x'; }` returns `'x'`, doesn't propagate the TDZ error) — matching real JS finally-completion-overrides-exception semantics.
- Confirmed both fixes are purely additive for existing behavior: guest-thrown errors (`throw new Error(...)`) and native-function-call errors (`null.foo()`) continue to be caught exactly as before: verified with dedicated regression cases before considering either fix complete, alongside an uncaught-native-error-still-surfaces-at-the-top-level check.
- This closes out one of the two gaps deferred from the same-day react.dev-bisection round. The other (`{ let x = 5; } var out = typeof x;` leaking `x` outside a bare block) is unrelated block-scoping behavior, not a native-throw issue, and remains open for a future round.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | `execTry()`: wraps a native (non-`JSError`) exception into a real, catchable error object when a handler exists (reusing the `callJSFunction()` pattern); defers an uncaught native error's re-throw until after the finalizer runs, so `finally` is never skipped |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 2 new real-Electron regression checks (a real TDZ violation caught by a guest `try/catch`; a `try/finally` with no `catch` still running its finally block before a native error propagates) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed (one youtube-smoke run flaked on real network navigation timing, confirmed unrelated by re-running it alone — passed)
```

## Verification Steps

1. Confirmed the gap with the exact repro from the prior round's deferred note (`try { let x = x + 1; } catch(e) {}`) before writing any fix.
2. Applied the `callJSFunction()`-style wrapping to `execTry()`'s catch block; re-ran the repro plus a `const` reassignment `TypeError` case and confirmed both are now caught with the correct `instanceof`/`message`.
3. While adding a `try/finally`-with-no-catch regression case for the same fix, found it still failed — traced it to the immediate re-throw bypassing the finalizer, a second, distinct bug in the same function.
4. Restructured the re-throw to happen after the finalizer runs, verified against: a plain no-catch propagation case, a `finally`-with-`return`-override case, and a nested try/catch/finally ordering case — plus re-verified the original fix (#1) and existing guest-throw/native-function-call catching still work unchanged.
5. Added 2 permanent e2e regression checks, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
