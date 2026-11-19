# Nova Android 1.30 — JS Semantics (Round C), Iteration, Destructuring, Live element.style, Web API Baseline

**Date:** 2026-10-26
**Session:** "keep improving the nova app…". Round C of [2026-10-25-nova-js-object-model-plan.md](2026-10-25-nova-js-object-model-plan.md), plus what probing turned up.
**Status:** Completed (APK built and signed; no device was connected, so there was no on-device run)

---

## Summary
- **Interpreter:**
  - ToPrimitive: `toString`/`valueOf` are now honoured by `String()`, `+`, templates and `<`/`>`.
  - Calling a non-function throws `TypeError: x is not a function`.
  - Labeled `continue`, `delete` and `toString(radix)` work.
  - A shared iteration protocol drives for-of, spread, destructuring and `Array.from` over strings, Map, Set and custom iterables.
  - `let`/`const` destructuring and per-iteration `for (let …)` bindings work.
  - for-in lists enumerable keys only.
  - Tagged templates, `function*` parsing and `new F(...args)` work.
- **Web platform:**
  - `element.style` is live: it writes the style attribute, so `el.style.display = "none"` now hides things.
  - Added `classList`, `dataset`, the common element methods, DocumentFragment, DOM interfaces (`instanceof HTMLElement`), Event/CustomEvent, URL/URLSearchParams, the viewport, matchMedia, getComputedStyle and the missing String/Number/Math/Reflect/console statics.
- **Next:** a plan for real async/await and generators is in [2026-10-26-nova-js-async-generators-plan.md](2026-10-26-nova-js-async-generators-plan.md).

## Root Causes

### 1. Objects never converted through toString/valueOf (plan item 7)
**Files:** `src/browser/js/values.ts`, `interpreter.ts`
**Problem:**
- `toString(obj)` returned "[object Object]" and `toNumber(obj)` returned NaN.
- `+` decided "string or number" on the raw objects.
- `<` and `>` used the host `<` on engine objects, so they were always false.
- Template literals used the host `String(val)`, so even `${[1,2]}` printed "[object Object]".

**Fix:** A new `toPrimitive(val, hint)` calls the chain's `valueOf`/`toString` in hint order. It is used by `toString`, `toNumber`, `+`, a new `compare()` for relational operators, and templates (`toString(val)`).

### 2. Calling a non-function returned undefined (plan item 8)
**File:** `interpreter.ts` `evalCall`
**Fix:** It now throws `TypeError(\`${calleeText(callee)} is not a function\`)`, which page `try/catch` can catch; optional calls still short-circuit. `new` on a non-constructor throws "x is not a constructor".

### 3. Missing APIs that calls now hit
Before #2, a call to a missing method was silently skipped; now it stops the script, as in a browser. An audit of about 200 commonly used names in a real page context found about 90 missing. Added this round:

| Area | Added |
|------|-------|
| Language | `String.fromCharCode/fromCodePoint/raw`; `Number.isInteger/isSafeInteger/isFinite/isNaN/parseFloat/parseInt` + constants; `Math.imul/clz32/expm1/log1p/asinh/acosh/atanh`; `Object.getOwnPropertyDescriptors`; `Reflect` (all but `construct`, which transpiled classes feature-test and fall back from); `escape/unescape`; console `debug/trace/dir/table/group*/time*/count*` |
| Window | `innerWidth/innerHeight/outerWidth/outerHeight/devicePixelRatio` from the renderer's real viewport (new `createGlobalEnv` parameter), `scrollX/scrollY…`, `screen`, `scrollTo/scrollBy/scroll`, `alert/confirm/prompt/open`, `getComputedStyle`, `matchMedia` (width/height/orientation/resolution plus phone preferences), `postMessage` (a 'message' event on a timer), `requestIdleCallback/cancelIdleCallback`, `navigator.sendBeacon` (returns false: nothing is queued) |
| Document | `createDocumentFragment`, `createComment`, `createElementNS`, `hasFocus` |
| Element | live `style` (+ `setProperty/getPropertyValue/removeProperty/cssText`), `classList`, `dataset`, `contains`, `click`, `focus/blur` (with focusin/out), `toggleAttribute`, `hasChildNodes`, `getClientRects`, `replaceWith`, `insertAdjacentElement`, `getElementsByTagName`, `scrollIntoView` and other no-ops |
| Constructors | DOM interfaces (EventTarget ← Node ← Element/HTMLElement ← HTMLDivElement…, Text, Document) with `Node.ELEMENT_NODE…`; `Event`, `CustomEvent`, `URL` (+ `canParse`), `URLSearchParams`, `Image`, `MutationObserver` (stub: never reports) |

### 4. `element.style` was a snapshot
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** `wrapElement` copied the computed style into a plain object. Writes such as `el.style.display = "none"` went nowhere, so menus, modals and toggles never changed on screen.
**Fix:** `StyleDeclarationMap` (a property-map subclass) reads and writes the element's `style` attribute, which the cascade applies. The verification test checks that the hidden text is no longer painted.

### 5. No iteration protocol
**Files:** `values.ts` (`iterateJS`, `createIteratorArray`), `interpreter.ts`, `index.ts`
**Problem:** for-of, spread, destructuring and `Array.from` only walked `length`/indices. Strings, Map, Set and custom `[Symbol.iterator]` objects gave nothing, and `map.entries().next` was not a function.
**Fix:**
- `iterateJS(value)` is a lazy host generator: strings by code point, arrays by index, everything else through `[Symbol.iterator]()`/`next()`. Because it is lazy, `break` out of an endless iterator works.
- Map/Set `keys/values/entries` return arrays that are also iterators, and `[Symbol.iterator]` is set on both.
- Computed property keys go through the engine's `toString`. The host `String()` made every symbol key "[object Object]", so `o[Symbol.iterator]` could never work.

### 6. `const [a, b] = …` lost its values
**File:** `values.ts` `Environment.initialize`
**Problem:** Destructured `let`/`const` names were never pre-declared, and `initialize` ignored unknown names. So `const [a, b] = [1, 2]; a + b` was NaN.
**Fix:** `initialize` creates a missing binding (with its kind).

### 7. `for (let i …)` shared one binding; for-in listed every key
**File:** `interpreter.ts` `execFor`, `execForIn`
**Fix:**
- `for (let …)` now gets a fresh environment per iteration with the loop variables copied, so closures keep their own `i` (was 3,3,3).
- for-in walks own then inherited enumerable string keys. `for (k in arr)` used to give "length,push,pop,…".
- A shared `bindLoopTarget` handles `x`, `var x`, `let/const` patterns.

### 8. Labeled `continue`
**File:** `interpreter.ts`
**Fix:** A `LabeledStatement` passes its labels to the loop it labels (`__labels`). `continuesHere()` makes a loop pass on a `continue other` instead of treating it as its own.

### 9. `delete` was a no-op that returned true
**Fix:** `delete o.k` / `delete o[k]` removes the property (false for non-configurable ones or frozen objects).

### 10. Tagged templates dropped their tag
**Files:** `parser.ts`, `interpreter.ts`
**Problem:** A template right after an expression had no infix precedence. So `` "x" + String.raw`y` `` parsed as two statements and evaluated to "y".
**Fix:** TemplateHead/TemplateEnd are postfix at precedence 17 and build a `TaggedTemplateExpression`. Evaluation calls the tag through `evalCall`, so `obj.tag` keeps its `this`, with `strings.raw`.

### 11. `function*` never parsed
**File:** `parser.ts`
**Problem:** The parser looked for `TokenType.Generator`, which the lexer never emits (`*` is `Star`).
**Fix:** Accept `Star` at the three sites. Generator semantics are still pass-through; see the async/generators plan.

### 12. Smaller fixes
- `Number#toString(radix)` ignored the radix.
- `new F(...args)` evaluated spread as undefined.
- Object spread `{...o}` copied non-enumerable properties (array methods, `length`).
- Host errors raised inside natives reached page `catch` as bare strings (`e.message` undefined, `e instanceof TypeError` false). `callJSFunction` and the native-call path now pass host Errors through, so `hostErrorToJS` builds a real TypeError/RangeError.

## Still missing (next rounds)
- Real async/await resumption and generators ([plan](2026-10-26-nova-js-async-generators-plan.md)).
- FormData, Blob, TextEncoder/TextDecoder, Proxy, DOMParser, Intl, BigInt, Promise.any.
- Shadow DOM, `compareDocumentPosition`, `getRootNode`.
- MutationObserver records.
- Raw strings in tagged templates.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/values.ts` | `toPrimitive`; `toString`/`toNumber` use it; `iterateJS`, `ITERATOR_KEY`, `createIteratorArray`; `Environment.initialize` creates missing bindings; host Errors pass through `callJSFunction` |
| `src/browser/js/interpreter.ts` | `+` / relational ToPrimitive (`compare`); templates use engine `toString`; non-function call / non-constructor TypeErrors (`calleeText`); labeled continue (`continuesHere`); `delete`; `toString(radix)`; engine `toString` for computed keys; spread/destructuring/for-of via `iterateJS`; `bindLoopTarget`; for-in enumerable keys; per-iteration `let`; object spread enumerable-only; tagged templates; `new` with spread |
| `src/browser/js/parser.ts` | `function*` / `yield*` accept `Star`; tagged-template postfix |
| `src/browser/js/index.ts` | String/Number/Math/Reflect/console/escape built-ins; `Object.getOwnPropertyDescriptors`; `Array.from` over iterables; Map/Set iterators; window viewport/screen/methods/matchMedia/getComputedStyle/postMessage/requestIdleCallback; DOM interface constructors; Event/CustomEvent/URL/URLSearchParams/Image/MutationObserver; `navigator.sendBeacon`; `viewport` parameter |
| `src/browser/js/dom-bindings.ts` | DOM interface prototypes for wrappers; live `style` (`StyleDeclarationMap`); `classList`; `dataset` (`DatasetMap`); element methods (`defineElementExtras`); DocumentFragment insertion (`expandFragment`); `createDocumentFragment/createComment/createElementNS/hasFocus` |
| `src/browser/engine/page-renderer.ts` | Passes the viewport to `createGlobalEnv` |
| `android/app/build.gradle` | versionCode 31, versionName 1.30 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |
| `doc/2026-10-25-nova-js-object-model-plan.md` | Status: all rounds done |
| `tests/typed-arrays.test.ts` | Two expectations corrected to browser behaviour (`'' + typedArray` lists the elements) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/js-semantics-round-c.test.ts` | ToPrimitive, relational ops, radix, non-function calls, labels, delete, destructuring, per-iteration let, for-in, object spread, iteration protocol, `function*` parse |
| `tests/web-api-baseline.test.ts` | Live style (including a render check that `display = "none"` hides text), classList, dataset, element methods, fragments, DOM interfaces, window/viewport/matchMedia, built-in statics, Event/URL/URLSearchParams/Image/MutationObserver, `new` with spread |
| `doc/2026-10-26-nova-js-async-generators-plan.md` | Plan for real async/await resumption and generators |
| `Nova-1.30.apk` | Signed release build |

## Test Results
```
npx vitest run                                   (full suite)
 Test Files  1 failed | 286 passed (287)
      Tests  2 failed | 10629 passed (10631)
 FAIL tests/typed-arrays.test.ts > TypedArray toString > should toString as [object Uint8Array] / [object Float64Array]
   expected '0,0,0,0' to be '[object Uint8Array]'
   -> the old expectation was wrong: in browsers '' + new Uint8Array(4) is "0,0,0,0"
      (TypedArray.prototype.toString is join), which ToPrimitive now gives. Expectations updated.
npx vitest run tests/typed-arrays.test.ts        -> 88 passed (88)
=> 287 files / 10631 tests pass
npx vitest run (the 7 JS/end-user files)          -> 63 passed (63)
npx tsc --noEmit                                  -> clean
gradlew :app:testDebugUnitTest :app:assembleRelease -> OK
apksigner verify Nova-1.30.apk                    -> Verifies (v2 + v3); versionCode 31, versionName 1.30
```

## Verification
- Probed every item with `runJS` before and after the fix.
- Ran the API audit (about 200 names) in a real `PageRenderer` page context. Missing names went from about 90 to the long tail listed under "Still missing".
- The Google challenge fixture still runs with no script errors (`tests/google-challenge-page.test.ts`), including after calls began throwing.
- `adb devices`: none connected.
