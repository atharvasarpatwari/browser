# `Array.prototype` Was Never Exposed as a Real Object

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Bisected cloudflare.com, gitlab.com, and python.org for real JS engine failures. python.org's failures were especially notable: every single one of its 10 checked external scripts failed, including jQuery 1.8.2, jQuery UI, and Modernizr — some of the most widely-used JS libraries on the real web.
**Status:** Completed (3 root causes fixed)

---

## Summary

`Array.prototype` didn't exist as an accessible object at all — `typeof Array.prototype` was `undefined`, while `Object.prototype`, `String.prototype`, and `Function.prototype` all correctly worked. This broke real jQuery 1.8.2 (and by extension every site still shipping it, which is still a lot of the real web) on its very first executable line: `j=Array.prototype.push`. Fixing this exposed a second, previously-dormant bug in a duplicate, never-reachable copy of the array method implementations. Also added `Array.prototype.findLast`/`findLastIndex` (missing entirely), found on the same sweep via a real cloudflare.com beacon script.

## Root Causes

### 1. `Array.prototype` was never exposed

**File:** `src/browser/js/index.ts` (`createGlobalEnv`)
**Real trigger:** `j=Array.prototype.push` — the very first executable statement of jQuery 1.8.2's IIFE, and the extremely common array-like-borrowing idiom `Array.prototype.slice.call(arguments)` used throughout the real web.
**Problem:** A real prototype object (`arrayProto`, populated with `push`/`slice`/`pop`/etc.) was already being built in `createGlobalEnv()`, but a stale comment right after it — `"But we need to update createArray to use our new proto — skip for now, the methods are on instances"` — marked it as deliberately never wired up. Every other constructor (`Object`, `Date`, `RegExp`, `Map`, `Set`, `Function`, ...) sets `xxxCtorObj.properties.set('prototype', { value: xxxProto, ... })`; `Array` was the one exception.
**Fix:** `(env.get('Array') as JSObject).properties.set('prototype', { value: arrayProto, ... })`, matching the exact pattern every other constructor already uses. Individual array instances still get their methods copied directly onto them (via `attachArrayMethods` in `values.ts`, unchanged) rather than through real prototype-chain delegation — this only fixes direct access to `Array.prototype` itself, which is what real code actually needs.

### 2. The array-method table built for `Array.prototype` had its own, previously-unreachable bug

**File:** `src/browser/js/index.ts` (deleted the dormant `arrProtoMethods` table entirely), `src/browser/js/values.ts` (`attachArrayMethods` now exported)
**Problem:** `createGlobalEnv()` had a *second*, separate, ~320-line copy of every array method (`arrProtoMethods`) used only to populate `arrayProto` — duplicating `attachArrayMethods`'s real, already-tested implementations in `values.ts`. Every function in this duplicate table used destructured/rest parameters (e.g. `push: (_this, ...args) => {...}`, `slice: (_this, start, end) => {...}`) instead of the actual `NativeFunction` calling convention (`(thisArg: JSValue, args: JSValue[])`), so every argument past `thisArg` arrived wrong — `args` would receive the whole real-arguments-array as its first (and only) element instead of the individual values. This was invisible until fix #1 made `Array.prototype` reachable at all; the moment `Array.prototype.push.call(arr, 1)` became callable, it broke in a new way (`obj.properties is not iterable`, since `push`'s own `...args` had captured `[1]`-wrapped-in-an-extra-array rather than `[1]` itself).
**Fix:** Deleted the entire duplicate `arrProtoMethods` table and its population loop; `arrayProto` is now built with a single `attachArrayMethods(arrayProto)` call, reusing the exact, correctly-calling-convention implementations real array instances already use and that are already covered by the existing array test suite.

### 3. `Array.prototype.findLast`/`findLastIndex` were missing entirely

**File:** `src/browser/js/values.ts`
**Real trigger:** A real cloudflare.com beacon script (`beacon.min.js`) reads `Array.prototype.findLast`.
**Fix:** Added `arrayFindLast`/`arrayFindLastIndex`, direct mirrors of the existing `arrayFind`/`arrayFindIndex` implementations but iterating from the end, registered in the same `arrayNativeMethods` table so every array instance and `Array.prototype` both get them for free.

## Notes

- python.org's other 8 failing scripts (jQuery UI, Modernizr, Masonry, an html-includes helper, and the site's own bundled main.js) were not individually root-caused this round — several may share this same `Array.prototype` root cause (jQuery UI and Masonry both build on jQuery's own conventions), and are worth re-bisecting in a future round now that this fix has landed.
- Bisecting jQuery 1.8.2 further after this fix surfaced a new, deeper "Maximum call stack size exceeded" failure later in its own load sequence — a genuinely different, unrelated bug, not chased down this round given the effort required to isolate a single recursive call site inside ~90KB of minified code. Flagged for a future round.
- cloudflare.com's `otSDKStub.js` (OneTrust) threw `Assignment to constant variable 'A'` only when run in the *shared*-environment multi-script bisection harness (sharing one environment across every script on the real page, as introduced two rounds ago to reduce false positives) — not when run standalone. This points to a cross-script global-name collision (`A`) between two of cloudflare.com's own third-party scripts sharing one page, which is either a real site-level bug (unlikely for professional third-party vendor code to collide on a bare single-letter global) or a subtler Nova scoping issue that would need isolating which of cloudflare.com's other 17 inline scripts also uses the name `A` — not conclusively diagnosed, so not fixed this round. When run standalone, the same script instead threw `Cannot read properties of undefined (reading 'Name')`, also not yet root-caused (heavily minified single-statement enum-building code, ambiguous scope tracing without further isolation work).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | `Array`'s constructor object now exposes a real `prototype` property; the dormant, buggy `arrProtoMethods` duplicate array-method table (~320 lines) deleted in favor of reusing `attachArrayMethods` |
| `src/browser/js/values.ts` | `attachArrayMethods` exported; added `arrayFindLast`/`arrayFindLastIndex`, registered in `arrayNativeMethods` |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Bisected cloudflare.com, gitlab.com, and python.org via the shared-environment multi-script harness; python.org's 10/10 external-script failure rate (including jQuery 1.8.2) stood out immediately.
2. Traced jQuery's failure to its very first line (`j=Array.prototype.push`) via temporary interpreter-level tracing of the exact member-expression throw site; confirmed `Array.prototype` itself evaluated to `undefined` while `Object.prototype`/`String.prototype`/`Function.prototype` all correctly worked.
3. Found the already-built-but-abandoned `arrayProto` object and its "skip for now" comment; wired it up following the identical pattern every other constructor already uses.
4. Re-verifying surfaced a second bug in the array-method table used to build that prototype (a native-function calling-convention mismatch across all ~22 methods, invisible until the prototype became reachable); root-caused to a duplicate, dormant implementation and fixed by deleting it in favor of the real, already-tested `attachArrayMethods` from `values.ts`.
5. Verified with targeted repro scripts: `Array.prototype`/`.push`/`.slice` all resolve correctly, `Array.prototype.push.call(arr, ...)` and `Array.prototype.slice.call(arr, ...)` both work correctly (the real array-like-borrowing idiom), and jQuery's own first line now runs without error (jQuery itself hits a separate, deeper, not-yet-diagnosed recursion issue further into its load — noted above, not fixed this round).
6. Found the `findLast`/`findLastIndex` gap on the same sweep; added as direct mirrors of the existing `find`/`findIndex` implementations, verified correct (including via `Array.prototype.findLast.call(...)`) with no regression to `find`/`findIndex`.
7. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
8. Cleaned up all temporary bisection/repro scripts and downloaded library files.
