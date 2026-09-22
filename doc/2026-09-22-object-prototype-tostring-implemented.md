# `Object.prototype.toString`/`Symbol.toStringTag` Were Never Implemented

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Picked up a gap explicitly deferred from the GitHub-bisection round earlier the same day: verifying the class-body `get`/`set` fix against a getter with a computed `Symbol.toStringTag` key worked for direct property access, but `Object.prototype.toString.call(x)` — the classic real-world type-tag idiom — threw `Cannot read properties of undefined (reading 'toString')`.
**Status:** Completed (1 root cause fixed; caught and fixed a real regression introduced mid-fix before it shipped)

---

## Summary

`Object.prototype` didn't exist as a real object at all — `Object` (the constructor) had static methods (`keys`, `values`, `entries`, ...) but no `.prototype` property, so `Object.prototype.toString.call(x)`/`Object.prototype.hasOwnProperty.call(x, k)` — both extremely common real-world idioms for reading a value's type tag or dodging a shadowed own property — were simply `undefined`. Separately, even a *direct* `x.toString()` call on a plain object (handled by a different, synthetic fallback mechanism, not a real prototype) ignored a class's own `Symbol.toStringTag`.

## Root Cause

**File:** `src/browser/js/values.ts` (new `objectPrototypeToStringTag()`), `src/browser/js/index.ts` (`Object.prototype`), `src/browser/js/interpreter.ts` (`objectPrototypeFallback()`)
**Real trigger:** `Object.prototype.toString.call(new LRUCache())` where `LRUCache` defines `get [Symbol.toStringTag]() { return "LRUMap"; }` — found while verifying the same-day class-body `get`/`set` parser fix against the exact real GitHub source that motivated it.
**Problem:** Two separate gaps compounded: (1) `Object.prototype` was never created as a real object on the `Object` constructor, so the constructor-based idiom had nothing to call; (2) the *existing* per-instance native fallback for `x.toString()` (`objectPrototypeFallback()` in `interpreter.ts`, used when nothing more specific defines `toString`) delegated to the generic `toString()` value-coercion helper, which has no concept of `Symbol.toStringTag` at all — it can't invoke a getter, since it's plain native TS code with no interpreter access.
**Fix:** Added `objectPrototypeToStringTag(val, toStringTagKey)` in `values.ts` — the real, spec-shaped algorithm: `undefined`/`null` special cases, then a getter-aware walk of the object's own+inherited properties for `Symbol.toStringTag` (using the existing `callJSFunction` helper to invoke it if it's a getter), then built-in exotic checks (Array, Function/closure, Date, RegExp, Error), falling back to the *existing* generic `toString()` coercion helper for everything else (ArrayBuffer, DataView, TypedArrays, SharedArrayBuffer, WeakRef, FinalizationRegistry, plain objects — all of which already had correct `[object Type]` formatting there, just without the `Symbol.toStringTag` override check). Wired this into both call sites: a real `Object.prototype` object added to the `Object` constructor (with `toString`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `valueOf`, `toLocaleString` — mirroring the existing per-instance fallback set for consistency), and `objectPrototypeFallback()`'s `toString` case updated to use the same helper instead of the plain coercion function.

## Notes

- **Caught a real regression mid-fix, before it shipped**: the first version of `objectPrototypeToStringTag()` only special-cased Array/Function/Date/RegExp/Error and fell through to a hardcoded `[object Object]` for everything else — which broke `ArrayBuffer`/`DataView`'s existing `[object ArrayBuffer]`/`[object DataView]` `toString()` formatting (2 real test failures in `tests/typed-arrays.test.ts`, caught by the routine full-suite run before committing anything). Fixed by falling back to the *existing* generic `toString()` coercion helper instead of re-deriving the same `__type_override` list a second time — the generic helper already handled these types correctly; it just needed the `Symbol.toStringTag` check layered in front of it, not replaced.
- `Object.prototype.toString.call(closure)` needed its own explicit check before the generic object-shape logic: a `JSFunction` (Nova's closure representation) has `type: 'closure'`, distinct from `JSObject`'s `type: 'function'`/`'class'` — a plain `obj.type === 'function'` check silently missed every real closure.
- `Object.prototype` (the constructor's own property) and the per-instance `objectPrototypeFallback()` synthetic mechanism remain two separate things, as before — this fix makes both correctly `Symbol.toStringTag`-aware and gives the first one a real, callable object, but doesn't unify them into one real prototype-chain link (a bigger, separate architectural change out of scope here).
- `Error.prototype.toString()` is deliberately unaffected — real spec gives `Object.prototype.toString.call(errorInstance)` the generic `[object Error]` tag, while `errorInstance.toString()` uses `Error.prototype`'s own, more specific `"Name: message"` formatting; both are exercised and confirmed to still differ correctly.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/values.ts` | New exported `objectPrototypeToStringTag(val, toStringTagKey)` — the real `Object.prototype.toString` algorithm, falling back to the existing generic `toString()` coercion for types it doesn't special-case itself |
| `src/browser/js/index.ts` | Added a real `Object.prototype` object (`toString`, `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `valueOf`, `toLocaleString`) to the `Object` constructor |
| `src/browser/js/interpreter.ts` | `objectPrototypeFallback()`'s `toString` case now uses `objectPrototypeToStringTag()` instead of the plain coercion helper, so a direct `x.toString()` also respects `Symbol.toStringTag` |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check (`Object.prototype.toString.call()` on a plain object, an array, and a class with a computed `Symbol.toStringTag` getter) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 227/228 files, 9313/9316 tests passed (3 pre-existing DNS-timeout failures, unrelated — see doc/known-test-failures.md)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Confirmed the gap with a minimal repro (`Object.prototype.toString.call({})` → `Cannot read properties of undefined`) before writing any fix.
2. Implemented the real algorithm and wired it into both `Object.prototype.toString` and the per-instance `x.toString()` fallback.
3. Ran a 12-case verification sweep (plain object, array, null/undefined, function, custom `Symbol.toStringTag`, the exact real LRU-cache shape, `hasOwnProperty` via `.call()`, direct `toString()` with and without a tag, `Error.prototype.toString()` staying unaffected) — this is what caught the ArrayBuffer/DataView regression before it was considered done.
4. Fixed the regression by falling back to the existing generic coercion helper instead of re-deriving its type list, then re-ran the full 12-case sweep plus the specific `tests/typed-arrays.test.ts` file to confirm both the fix and the regression fix.
5. Added 1 permanent e2e regression check, rebuilt, and re-ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
