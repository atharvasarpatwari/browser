# Nova Android 2.10: Nine Script-Engine Bugs Found by Running the Ad-Block Test Page in Nova's Own Engine

**Date:** 2026-11-11
**Session:** "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Tested on the OnePlus Pad Go (2026-11-12, final build): the ad-block test page runs in Nova's own engine and scores **98%**.

---

## Summary
The public ad-block test page (adblock.turtlecute.org) only worked in compatibility mode; in Nova's own engine its script died at start ("expression is not a constructor"). Following that one page through the engine turned up nine separate bugs, none specific to it: webpack bundles, `eval`, `IntersectionObserver`, `var` hoisting and promise chains are on most sites.

| adblock.turtlecute.org in Nova's engine (compatibility mode off) | Result |
|---|---|
| 2.09 and earlier | script fails at start; the test never runs |
| 2.10, first build (#1–#4), tablet | page renders, no script errors logged, test still does not start |
| 2.10, second build (#1–#7), tablet | **test runs**; shield shows 126 requests blocked; the page's own score stays at 2% (#8, #9) |
| 2.10, final (#1–#9), tablet | **98%**; shield 126; no "Uncaught error" in the log |

## Root Causes

### 1. A nested script run unregistered the interpreter
**File:** `src/browser/js/interpreter.ts` (`run`)
**Problem:** after `eval(…)`, the next callback in the same script (`[1,2].forEach(function…)`) failed with "No JS interpreter registered".
**Root cause:** `run()` set the global function caller at its start and cleared it to `null` at its end. A nested `run()` (eval, `new Function`) therefore cleared the outer script's caller.
**Fix:** `run()` puts back the caller that was there before it.

### 2. Data blocks were run (and fetched) as JavaScript
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** `<script type="application/ld+json">` logged "Error executing blocking script: Cannot read properties of null"; a typed block with `src` was downloaded.
**Root cause:** the page's script list was every `<script>` element. Only scripts inserted later were filtered by `type`.
**Fix:** the same filter at collection: no type, a JavaScript type, or `module` (modules still run as classic scripts, as before).

### 3. `Object.defineProperty` on a function threw
**File:** `src/browser/js/index.ts`
**Problem:** the whole bundle died with "Cannot read properties of undefined (reading 'set')".
**Root cause:** functions carry no property map until they need one. Assignment creates it; `defineProperty` did not. Webpack's `require.n` defines a getter on a function in every bundle that imports a CommonJS module.
**Fix:** `defineProperty` creates the map, as assignment does.

### 4. `typeof AbortController` was `'object'`
**File:** `src/browser/js/values.ts` (`getType`)
**Problem:** feature checks such as `typeof AbortController === 'function'` failed (also `Headers`, `Request`, `Response`).
**Root cause:** these host classes are callable objects, which `getType` did not count as functions.
**Fix:** a callable object with a native function is `'function'`.

### 5. `IntersectionObserver` entries had no `target`
**File:** `src/browser/js/index.ts`
**Problem:** "Cannot read properties of undefined (reading 'classList')" in the page's `DOMContentLoaded` listener: `entry.target.classList.add(…)`, the standard lazy-load and scroll-animation code.
**Root cause:** the entry handed to the callback carried `isIntersecting`, `intersectionRatio` and `time` only.
**Fix:** the observer remembers the page's element object for each observed element and sets it as `target`.

### 6. `var` was not hoisted
**Files:** `src/browser/js/interpreter.ts` (`varNames`, `bindParams`, `execVarDecl`), `src/browser/js/values.ts` (`Environment.hoistVar`)
**Problem:** "o is not a function" on the second call of a11y-dialog's helper:

```js
function o(t,e){return o=(e||document).querySelectorAll(t),Array.prototype.slice.call(o);var o}
```

**Root cause:** a `var` binding was created when its declaration statement ran. Here it never runs (it follows `return`), so `o = …` assigned to the outer function `o` and replaced it with a node list.
**Fix:** at each call, the function's `var` names (anywhere in its body, not inside nested functions; cached on the body) are created as `undefined` unless a parameter or earlier binding has the name. `var x;` without a value no longer assigns `undefined`.

### 7. Errors in listeners, timers, microtasks and animation frames vanished
**Files:** `src/browser/js/event-loop.ts` (`reportUncaught`), `src/browser/js/dom-bindings.ts`
**Problem:** #5 and #6 stopped the page with nothing in the log.
**Root cause:** each of those call sites caught the error and dropped it.
**Fix:** they log `[ScriptEngine] Uncaught error in a <where>: <message>` (a warning, as browsers do) and carry on as before.

### 8. `promise.finally()` replaced the outcome
**File:** `src/browser/js/promise.ts`
**Problem:** the test page counted 2% blocked although Nova had blocked 126 requests. Its code is `await fetch(url, opts).finally(() => clearTimeout(t))`.
**Root cause:** `finally` used one wrapper for both outcomes and resolved with the callback's result, so a rejected fetch became a fulfilled promise and `await` did not throw.
**Fix:** after the callback, a fulfilled promise passes its value on and a rejected one rejects again with its reason.

### 9. A promise resolved with a pending promise never settled
**File:** `src/browser/js/promise.ts` (`resolvePromise`)
**Problem:** with #8 fixed, the same chain hung. The general case: `.then(() => somethingStillPending)`.
**Root cause:** the reaction queued on the pending promise was not recorded with its upstream, so it was dropped when that promise settled. It also named the outer promise as its own result promise, which would have settled it a second time.
**Fix:** the reaction is recorded with its upstream and gets a promise of its own for the machinery to settle.

## Not changed (recorded)
- **The page's layout in the engine** is still wrong (the gauge is drawn as a box, text overlaps), and the engine does not block `/ads.js` by name as compatibility mode does.
- **The missing 2%** is most likely the two ad-script checks (`/ads.js`, `/pagead.js`: the log shows the engine fetching both); the result list is not readable in the engine layout, so this is not confirmed.
- **On the OnePlus Pad**, `adblock.turtlecute.org` is now set to compatibility mode **off** (I switched it from the menu to test the engine).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | caller restored after a nested run (#1); `var` hoisting (#6) |
| `src/browser/js/values.ts` | `getType` for callable host classes (#4); `Environment.hoistVar` (#6) |
| `src/browser/js/index.ts` | `defineProperty` on functions (#3); `IntersectionObserver` entry `target` (#5) |
| `src/browser/js/promise.ts` | `finally` (#8); adoption of a pending promise (#9) |
| `src/browser/js/event-loop.ts` | `reportUncaught` for timers, microtasks, animation frames (#7) |
| `src/browser/js/dom-bindings.ts` | listener and `on<type>` handler errors reported (#7) |
| `src/browser/engine/page-renderer.ts` | data blocks are not scripts (#2) |
| `android/app/build.gradle` | 2.09 (110) → 2.10 (111) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/script-engine-210.test.ts` | 8 tests, one or more per root cause; all 8 fail with the source changes reverted |

## Test Results
```
npx vitest run tests/script-engine-210.test.ts → 8 passed; with src/ reverted (git apply -R): 8 failed
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (45 warnings)
npx vitest run                     → Test Files 341 passed (341); Tests 11479 passed (11479)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.10.apk     → verified; versionCode 111, versionName 2.10
Offline probe (the saved page and its script in the engine): before: script error at load; after #1–#6: the
  DOMContentLoaded handler completes, the test starts, the first cosmetic check turns green.

OnePlus Pad Go (OPD2305, Android 14), adblock.turtlecute.org:
  2.10 first build, compatibility mode on  → still 100% (130 of 130); shield 128
  2.10 first build, compatibility mode off → page rendered by the engine, no script error in the log, test did not start
  2.10 second build (#1–#7), engine        → test ran; shield 126; page score 2% and did not move in 2 minutes (→ #8, #9)
  2.10 final build (#1–#9), engine, 2026-11-12 → 98%; shield 126; no "Uncaught error" / script error lines in logcat
       (doc/img/2026-11-12-nova-2.10-ad-block-test-98-engine-oneplus-pad.png)
```
