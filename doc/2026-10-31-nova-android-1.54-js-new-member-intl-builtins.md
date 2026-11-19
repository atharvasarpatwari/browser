# Nova Android 1.54: `new a.B()`, `Intl`, Accessor Descriptors, ES2019–2023 Built-ins

**Date:** 2026-10-31
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". A probe of 30 JavaScript/DOM features that real sites' scripts use found the gaps below.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
These worked: classList, dataset, closest/matches, insertAdjacentHTML, optional chaining, spread/destructuring, private and static class members, generators, Map/Set/Symbol, getComputedStyle, style.setProperty, getBoundingClientRect, CustomEvent, `once` listeners, event delegation, innerHTML/textContent, JSON, labeled loops, matchMedia.

Fixed:
| Feature | Before | After |
|---------|--------|-------|
| `new o.C()`, `new ns.m.C()`, `new o["C"]()` | Parsed as `(new o).C()` → "C is not a function" | A member-expression callee |
| `Intl` | Missing (`typeof Intl` was `"undefined"`) | NumberFormat, DateTimeFormat, Collator, PluralRules, RelativeTimeFormat, ListFormat, getCanonicalLocales over the platform's Intl |
| `(1234.5).toLocaleString()` | `"[object Object]"` | `"1,234.5"` (locale and options honoured) |
| `Object.defineProperty(o, k, { get, set })` | Accessors dropped (read `undefined`) | Honoured; `getOwnPropertyDescriptor` reports `get`/`set` |
| `[].at`, `findLast`, `findLastIndex`, `lastIndexOf`, `flatMap`, `reduceRight`, `toSorted`, `toReversed`, `with` | "not a function" | Implemented |
| `"".at`, `replaceAll`, `localeCompare`, `codePointAt`, `normalize`, `matchAll` | Missing | Implemented |
| `str.match(re)` (non-global) | A bare array: no `index`/`input`/`groups` | Like `exec()` |

## Root Causes

### RC-1: `new` parsed its callee at the wrong precedence
**File:** `src/browser/js/parser.ts` `parseNewExpression`
**Problem:**
- The callee was `parseExpression(18)`, which stops before `.`, so `new o.C(3)` built `NewExpression(o)` and then called `.C(3)` on the result.
- Every namespaced constructor failed: `new Intl.NumberFormat`, `new google.maps.Map`, `new THREE.Scene`, `new window.Foo`.

**Fix:** The callee is a primary (`parsePrefix`) followed by any `.name`/`[expr]` accesses, as the spec's MemberExpression is. The first `(…)` is the arguments, and later member access applies to the new object.

### RC-2: No `Intl`; `Number#toLocaleString` fell through to Object's
**Files:** `src/browser/js/index.ts` (`createIntl`), `src/browser/js/interpreter.ts`
**Fix:**
- `createIntl()` wraps the host's formatters: each constructor converts its locales/options with `jsToPlain`. Methods include `format`, `formatToParts`, `compare`, `select` and `resolvedOptions`, and `Date` arguments use their `nativeDate`.
- Numbers get `toLocaleString(locale, options)`.

### RC-3: Accessor descriptors dropped by `defineProperty`
**File:** `src/browser/js/index.ts`
**Problem:** Only `value` was copied, while `get`/`set` (already supported for class and object-literal accessors) were ignored.
**Fix:** `getter`/`setter` are stored from the descriptor; `getOwnPropertyDescriptor` returns `get`/`set` for accessors.

### RC-4: Missing ES2019–2023 array and string methods; a bare `match()` result
**Files:** `src/browser/js/index.ts` (`arrProtoMethods`, `elementsOf`), `src/browser/js/interpreter.ts` (`stringMethods`)
**Fix:**
- The array methods are added to the shared `Array.prototype` table: `toSorted` reuses `sort` on a copy, and `with` throws RangeError out of range.
- The string methods are added; `at` is hand-written because the TS lib target predates it.
- A non-global `match()` returns `index`/`input`/`groups` like `exec()`.
- Helpers `jsToPlain` / `plainToJS` convert options and groups.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | Member-expression `new` callee |
| `src/browser/js/index.ts` | `createIntl`; defineProperty/getOwnPropertyDescriptor accessors; array methods; `elementsOf` |
| `src/browser/js/interpreter.ts` | String methods; `match` result; `Number#toLocaleString`; `jsToPlain`, `plainToJS` |
| `android/app/build.gradle` | 1.54 (55) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/js-builtins-154.test.ts` | 6 tests: Intl NumberFormat and toLocaleString; DateTimeFormat/PluralRules/Collator/RelativeTimeFormat/ListFormat; defineProperty accessors; array methods; string methods and match groups; `new` with member callees |
| `Nova-1.54.apk` | Signed build |

## Also
A shell heredoc ate a regex backslash in the first probe (`\\d` → `d`), so named groups looked broken. Probes with regexes are written with the Write tool now.

## Test Results
```
npx tsc --noEmit                              -> clean
npx vitest run tests/js-builtins-154.test.ts  -> 6 passed (6)
npx vitest run                                -> Test Files 306 passed (306), Tests 10758 passed (10758)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.54.apk                -> Verifies; versionCode 55, versionName 1.54
```
