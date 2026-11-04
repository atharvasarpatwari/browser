# Nova Android 1.31 — Function Params, Class Members, Real async/await + Generators, Page Timers

**Date:** 2026-10-26
**Session:** "keep improving the nova app…". Rounds 1 and 2 of [2026-10-26-nova-js-async-generators-plan.md](2026-10-26-nova-js-async-generators-plan.md), plus the gaps found on the way.
**Status:** Completed (APK built and signed; no device was connected, so there was no on-device run)

---

## Summary
This round fixed four groups of JS engine problems:
- **Parameters.** Defaults, destructuring and rest parameters now work, for arrows too, and arrows keep their lexical `this` when called back by built-ins.
- **Class and object members.** `get`/`set`/`async`/`*`/`static` work as modifiers, class fields are initialized, computed keys work, each class has its own `super`, inherited setters are called on assignment, and private `#names` work.
- **async/await and generators.** An `await` on a pending value used to drop the rest of the function. A resumable executor now really suspends and resumes `async` functions, and generators work (`next(v)`, endless generators, spread, `yield*`).
- **Page timers.** The page's event loop was never pumped after load, so no `setTimeout`/`setInterval` callback had ever run, and promise callbacks from fetch responses waited forever. A timer pump in `PageRenderer` runs them now and repaints what they change.

## Root Causes

### 1. Parameters were names only
**Files:** `src/browser/js/interpreter.ts`, `src/browser/js/parser.ts`, `src/browser/js/values.ts`
**Problem:**
- `createFunction(…, params.map(p => p.name))` kept only plain names, so default values, `{ x }`/`[a, b]` patterns and `...rest` were lost.
- `parsePattern` read one token as a name. A default was parsed with `parseExpression()`, which swallowed the commas after it: `f(a = 1, b)` lost `b`.

**Fix:**
- `makeFunction` stores the AST in `fn.paramPatterns` when any parameter is not a plain name.
- One `bindParams` runs at every call site: defaults are evaluated in the call scope, so they can use earlier parameters and `this`; patterns go through `destructPattern`; rest becomes an array.
- `parsePattern` uses `parseBindingName`, with defaults parsed at assignment level.
- Only `undefined` takes a default (`null` used to).

### 2. Arrow parameters could only be plain names
**File:** `parser.ts`
**Problem:** `([a, b]) => …`, `(...xs) => …` and `(x = 1, { y }) => …` failed to parse. The parser read the parenthesised list as an expression, then reinterpreted it as parameters.
**Fix:**
- `isArrowParamsAhead()` scans once to the matching `)` and checks for `=>`. It records the matches of the parens nested inside, so nested parens are not rescanned and parsing stays linear. It stops at a template with substitutions.
- When it finds `=>`, the list is parsed with `parseParams()`.
- `async (…) =>` uses the same path.

### 3. Arrows lost `this` when called by built-ins
**File:** `interpreter.ts`
**Problem:** `callFunction` (used by `forEach`, `setTimeout`, `then`…) gave arrows the caller's `this`.
**Fix:** Both call paths now go through one `invokeClosure`. It sets `this` (lexical for arrows) *before* binding parameters. A function without `return` now returns `undefined`; before, it returned the value of its last statement.

### 4. `get` / `set` / `async` / `*` read as member names
**File:** `parser.ts` (`parseClassBody`, `parseProperty`)
**Problem:** `class A { get v(){} async m(){} *g(){} }` parsed as fields named "get", "async" and "*", followed by plain methods. Getters and setters in classes never worked, async/generator methods were not async, and object literals had the same problem.
**Fix:**
- `parseMethodModifiers()` and `memberNameFollows()` treat these words as modifiers only when a member name follows, so `get()`, `{ get: 1 }` and `static()` stay ordinary members.
- Static members, fields, static fields and computed keys are recorded on the member.

### 5. Class fields were ignored; computed keys and `super` were wrong
**File:** `interpreter.ts` (`execClassDecl`, `evalNew`, `super()`)
**Fix:**
- **Fields:**
  - Fields are collected per class and initialized with `this` = the instance by `initFields`: for a base class before its constructor body, for a derived class when `super()` returns.
  - A base parent's fields are initialized as `super()` runs it.
  - Static fields run once, with `this` = the class.
- **Accessors:** getters and setters become accessor descriptors on the prototype (or on the class, if static).
- **Computed keys** are evaluated (`[Symbol.iterator]()` used to be `"[object Object]"`).
- **`super`:** each class gets its own scope holding `super`. It used to be stored on the enclosing scope, so two classes declared side by side shared the last one's parent.

### 6. Assignment skipped inherited setters
**File:** `interpreter.ts` `evalAssignment`
**Fix:**
- `o.x = v` looks up the prototype chain for a setter before creating an own property.
- Writes to getter-only or read-only properties are ignored, as in sloppy mode.
- Overwriting a property keeps its attributes.
- `arr.length = n` truncates the array.

### 7. `#private` names and non-ASCII identifiers
**File:** `lexer.ts`
**Fix:**
- `#name` lexes as an identifier spelled with the `#` (it was dropped), which is enough for `this.#x` reads and writes.
- Identifiers may use non-ASCII letters (`\p{ID_Start}`).

### 8. `await` dropped the rest of the async function
**File:** `interpreter.ts`
**Problem:**
- `evalAwait` threw an `AwaitSignal` that unwound the JS stack.
- `handleAsyncAwait` then resolved the function's promise with the *awaited* value and never ran the code after the `await`.

**Fix:**
- **Resumable executor:** async and generator bodies run as host generators (`execR`, `evalR`, `execTryR`, `runBodyR`).
  - `hasSuspend()` (a cached AST scan that stops at nested functions) sends every subtree without an `await`/`yield` straight to the normal fast `exec`/`evalExpr`.
  - Generic expressions evaluate their operands in source order up to the last one that suspends, then substitute them with their values (`cloneWithSlots` + `__NovaValue` nodes).
  - Short-circuit `&&`/`||`/`??`, `?:` and sequences are handled directly.
- **Driver (`runAsyncFunction`):**
  - It resumes through `awaitValue`: settled promises and plain values on the next microtask, thenables through `then`.
  - Rejections are thrown into the body, so `try/catch` around `await` works.
  - The function's promise resolves with the return value (adopting a returned promise via the now-exported `resolvePromise`).
  - Each resumption gets a fresh time budget.
- **Cleanup:** the old `handleAsyncAwait` is deleted.

### 9. Generators did nothing
**Problem:** `yield` returned its argument and `function*` bodies ran to the end at once.
**Fix:**
- `makeGenerator` returns a generator object with `next(v)`, `throw(e)`, `return(v)` and `[Symbol.iterator]`.
- Works with for-of (with `break`), spread and `iterateJS`.
- `yield*` forwards an iterable's values.

### 10. `(async function(){ … })()` failed to parse
**File:** `parser.ts` `parsePrefix`
**Fix:** `async function` is accepted in expression position.

### 11. Page timers never ran
**Files:** `src/browser/engine/page-renderer.ts`, `src/browser/js/event-loop.ts`
**Problem:**
- `PageRenderer` created a per-page event loop and drained microtasks after scripts, but nothing ever called `runOnce()`. So `setTimeout`/`setInterval` callbacks never ran in a page.
- Promise reactions queued later, from fetch responses, were never drained.

**Fix:**
- `EventLoop.onWake` fires when a timer or microtask is queued.
- `PageRenderer.schedulePagePump()` arms a host timer for the next due work. `pumpPage()` runs up to 50 due timers inside `runWithInterpreter`, then repaints if `domTree.getMutations()` changed. It is re-armed after every pump, and cleared on dispose.
- In Node the timer is `unref`'d, so pending page timers don't keep the process alive.

### 12. JS timer callbacks failed silently even when timers ran
**File:** `event-loop.ts`
**Problem:** `drainMicrotasks()` set the global caller to `null` when it finished. `runOnce()` drains *before* running a task, so the task's `callJSFunction` found no interpreter, threw, and the error was swallowed. Only native callbacks (`setTimeout(resolve)`) survived.
**Fix:** `drainMicrotasks` and `runWithInterpreter` restore the previous caller (new `getGlobalCaller()`).

## Not done
- Async generators (`async function*`) and `for await…of` (round 3 of the plan).
- `return()` on a generator skips its pending `finally` blocks.
- `yield*` doesn't forward `next(v)`/`throw`.
- Raw template strings.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | `parsePattern` via binding patterns; arrow lookahead (`isArrowParamsAhead`, `parseArrowBody`); async arrow params; computed keys in object patterns; class/object member modifiers (`parseMethodModifiers`, `memberNameFollows`), static/computed fields; `async function` expressions |
| `src/browser/js/interpreter.ts` | `makeFunction` / `bindParams`; `invokeClosure` (one call path, lexical arrow `this`, async/generator dispatch); resumable executor (`hasSuspend`, `cloneWithSlots`, `evalR`, `execR`, `execBlockR`, `execVarDeclR`, `execTryR`, `runBodyR`, `runAsyncFunction`, `awaitValue`, `makeGenerator`); `forInKeys`; class members, fields (`initFields`), per-class scope; setter lookup and attribute-keeping assignment, `arr.length` truncation; default only for `undefined`; removed `handleAsyncAwait` |
| `src/browser/js/lexer.ts` | `#private` names; non-ASCII identifier starts |
| `src/browser/js/values.ts` | `JSFunction.paramPatterns`; `getGlobalCaller()` |
| `src/browser/js/promise.ts` | `resolvePromise` exported |
| `src/browser/js/event-loop.ts` | `onWake` hook; drain/runWithInterpreter restore the previous caller |
| `src/browser/engine/page-renderer.ts` | Page event-loop pump (`schedulePagePump`, `pumpPage`), cleared on dispose |
| `android/app/build.gradle` | versionCode 32, versionName 1.31 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |
| `doc/2026-10-26-nova-js-async-generators-plan.md` | Status: rounds 1–2 done |

## Files Created
| File | Purpose |
|------|--------|
| `tests/js-functions-classes-async.test.ts` | 14 tests: params, arrow params, lexical this, class accessors/statics/computed keys/fields/private names/per-class super, object literal members, `arr.length`, async/await (resume, ordering, try/catch, loops, literals, methods), generators, and a page-level test that a `setTimeout` callback and an `async` flow update the DOM after load |
| `Nova-1.31.apk` | Signed release build |

## Test Results
```
npx vitest run                                     (full suite; machine heavily loaded, 762 s)
 Test Files  1 failed | 287 passed (288)
      Tests  1 failed | 10635 passed | 9 skipped (10645)
 FAIL tests/search-performance.test.ts > … typing renders the dropdown within a frame / gates
   (a wall-clock timing gate; the 9 skipped tests are the same file's tests that depend on it)
npx vitest run tests/search-performance.test.ts    -> 16 passed (16)   (re-run alone)
npx vitest run tests/end-user-regressions.test.ts  -> 5 passed (5), tests 3.05 s (no slowdown)
npx vitest run tests/js-functions-classes-async.test.ts -> 14 passed (14)
npx vitest run (8 JS / end-user files)              -> 76 passed + the Wikipedia test under load; passes alone
npx tsc --noEmit                                    -> clean
gradlew :app:testDebugUnitTest :app:assembleRelease -> OK
apksigner verify Nova-1.31.apk                      -> Verifies (v2 + v3); versionCode 32, versionName 1.31
```

## Verification
- Probed parameters, class members, async/await (18 cases) and generators with `runJS` plus a real `EventLoop`, before and after each fix.
- Traced "timers never fire" to the swallowed "No JS interpreter registered" error by calling the callback directly, then through `runOnce`.
- End-to-end: a page whose script changes text from a `setTimeout` and from an `async` function shows both changes about 100 ms after `render()` returned.
- `adb devices`: none connected.
