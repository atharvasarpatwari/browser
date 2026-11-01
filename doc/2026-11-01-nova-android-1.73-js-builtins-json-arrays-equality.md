# Nova Android 1.73: JS Built-ins — JSON.stringify, Array slice/fill/iterators, Loose Equality, Static Blocks, Sets, Promise.any, RegExp Flags

**Date:** 2026-11-01
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (installed on the tablet; the device page was checked in Node, not on screen, because the tablet was in use in another app)

---

## Summary

The 1.72 JS probe found real parser bugs, so this round ran a broader one: **161 cases** (built-ins, syntax, async ordering), each run through Nova's page JS and compared with V8 (Node). **139 matched** at first and **157 match** now. The fixes are below. Four are left on purpose:
- **Primitive `this`:** sloppy-mode `this` is not boxed (`typeof this` is `"number"` in `f.call(5)`).
- **Undeclared variables:** reading one evaluates to `undefined` instead of throwing a `ReferenceError`. This is kept because pages that use a browser global Nova lacks keep running.
- **Async iteration:** `for await` and async generators are not supported.

## Root Causes

### 1. `Array.prototype.slice` ignored negative indices
**File:** `src/browser/js/values.ts`
**Problem:** `start` was clamped with `Math.max(0, …)`, so `arr.slice(-2)` copied the whole array instead of the last two items. This is a very common idiom: last N items, file extensions, `slice(1, -1)`.
**Fix:** the arguments go straight to the host `slice`, which applies the spec's relative-index rules.

### 2. `fill(value, start, end)` filled everything
**File:** `values.ts`
**Problem:** `start` and `end` were ignored.
**Fix:** relative start and end are resolved (negative counts from the end, clamped to the length).

### 3. `keys()` / `values()` / `entries()` returned plain arrays
**File:** `values.ts`
**Problem:** `arr.keys().next()` threw "next is not a function".
**Fix:** they return `createIteratorArray` (iterable, with `next()`).

### 4. `JSON.stringify` crashed on functions; ignored `space`, replacers and `toJSON`
**File:** `src/browser/js/index.ts`
**Problem:**
- An object with a method threw "obj.properties is not iterable".
- `JSON.stringify(x, null, 2)` came out on one line.
- Replacer functions and key lists were ignored.
- Dates were serialised as `{}`.

**Fix:** `toPlainJSON` converts the value first:
- it calls `toJSON` and the replacer with the right holder and key;
- it filters to the replacer's key list, keeps enumerable own keys only, and drops functions and symbols;
- it detects cycles.

The result goes to the host's `JSON.stringify` for escaping and indentation.

### 5. `class { static { … } }` was a syntax error
**File:** `src/browser/js/parser.ts`
**Problem:** `static {` parsed as a field named `{`, which dropped the whole script.
**Fix:** a static block becomes a static field initialised by an immediately-called arrow, which runs once with `this` = the class.

### 6. `==` with objects was never equal
**File:** `src/browser/js/interpreter.ts`
**Problem:** `==` used the host's `==` on Nova's object records, so `[] == false`, `[1] == 1` and `obj == "[object Object]"` were all false.
**Fix:** `looseEquals` follows IsLooselyEqual (§7.2.14):
- `null` and `undefined` are equal only to each other;
- booleans are compared as numbers;
- objects are converted with ToPrimitive, falling back to their built-in string form.

`!=` uses the same function.

### 7. `new Set(iterable)` only accepted arrays
**File:** `index.ts`
**Problem:** `new Set("hello")` and `new Set(otherSet)` were empty, so `Array.from(new Set(str))` dedupes failed.
**Fix:** the constructor iterates any iterable with `iterateJS`.

### 8. Smaller gaps
- **`Promise.any`** (`promise.ts`): added. The first fulfilment wins; if every promise rejects, it rejects with an AggregateError-like error carrying `errors`.
- **RegExp** (`index.ts`): `source`, `flags`, `global`, `ignoreCase`, `multiline`, `sticky`, `unicode`, `dotAll` and `hasIndices` are getters on the native RegExp. `flags` was `''` and the rest were missing.
- **`Symbol.prototype.description`** (`index.ts`): added.
- **`String#split(sep, limit)`** (`interpreter.ts`): the limit was ignored.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/values.ts` | slice negative indices; fill start/end; keys/values/entries iterators (#1–#3) |
| `src/browser/js/index.ts` | JSON.stringify rewrite (#4); Set from any iterable (#7); RegExp flag getters; Symbol description (#8) |
| `src/browser/js/parser.ts` | static initialization blocks (#5) |
| `src/browser/js/interpreter.ts` | spec loose equality (#6); split limit (#8) |
| `src/browser/js/promise.ts` | Promise.any (#8) |
| `android/app/build.gradle` | 1.72 (73) → 1.73 (74) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Verification
- **Device page:** `tests/fixtures/device-pages/v172.html` gained five 1.73 checks (slice(-2), JSON indent and methods, `[] == false`, static block, `Set(string)`) and passes **23/23** in Node.
- **Tablet:** 1.73 is installed. It was not opened, because Brave was in front.
- **Side finding:** Nova's lexer accepts a raw newline inside a quoted string, where V8 throws a SyntaxError. It's lenient, not harmful, so it's left as is.

## Files Created

| File | Purpose |
|------|--------|
| `tests/fixtures/device-pages/v172.html` (modified) | five 1.73 checks |
| `tests/js-builtins-173.test.ts` | 26 cases for the fixes above (each a script on a real page, checked against V8's answer) |

## Test Results

```
JS probe (161 cases vs V8)                 → 139 → 157
npx vitest run tests/js-builtins-173.test.ts → 26 passed
npx tsc --noEmit                           → clean
npx vitest run                             → Test Files 321 passed (321); Tests 11151 passed (11151)
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.73.apk             → verified; versionCode 74, versionName 1.73
adb install -r Nova-1.73.apk               → Success (installed in the background)
device page v172.html run through Nova in Node → 23/23
```
