# Nova Android 1.29 — JS Object Model, window as Global Object, Parser Precedence, Google's Scripts Run

**Date:** 2026-10-26
**Session:** "keep improving the nova app…". Implements Rounds A + B of [2026-10-25-nova-js-object-model-plan.md](2026-10-25-nova-js-object-model-plan.md). Google's results page (RC-2, blank results) was the acceptance test, and it turned up seven more root causes.
**Status:** Completed (APK built and signed; no device was connected, so there was no on-device run)

---

## Summary
The interpreter now has real prototypes: `new F()` links to `F.prototype`, and `instanceof` works for classes, constructors and built-ins. `Object.prototype`, `Array.prototype`, `String.prototype`, `Function.prototype` and `Error.prototype` exist, and `class X extends Error/Map/F` works. `window` is now the global object.

Two parser precedence bugs that mangled most minified code are fixed, along with `Array(n)`, the `/=/` regex lexing and `<noscript>` parsing. Google's JS challenge page, served to a `/search` URL, used to fail with 4 script errors. It now runs with none and no longer shows the noscript "Please click here" fallback.

## Root Causes

### 1. `new F()` did not link `F.prototype`; `instanceof` was false for classes and constructors (plan items 1–3)
**Files:** `src/browser/js/values.ts`, `src/browser/js/interpreter.ts`
**Problem:**
- `new F()` built a bare object;
- class prototypes had no `constructor`;
- `instanceof` compared against the constructor's internal `[[Prototype]]`.

**Fix:**
- `functionPrototypeObject(fn)` gives a function's `.prototype`: an assigned one wins, otherwise a cached object with `constructor`.
- `constructorPrototype(ctor)` covers classes, closures and native constructor objects.
- `instanceofCheck` walks the left side's chain looking for that prototype.
```ts
const ctorProto = constructorPrototype(right);
if (ctorProto === OBJECT_PROTOTYPE) return true; // x instanceof Object
```

### 2. No `Object.prototype` (plan item 5)
**Problem:** `o.hasOwnProperty`, `Object.prototype.hasOwnProperty.call(o, k)` and `Object.prototype.toString.call([])` were all undefined.
**Fix:**
- A shared `OBJECT_PROTOTYPE` holds hasOwnProperty, propertyIsEnumerable, isPrototypeOf, toString (`[object Array]` and so on), toLocaleString and valueOf.
- `evalMember` / `getPropertyValue` fall back to it at the end of every chain (`objectPrototypeMember(key)`). It is never stored on objects, so `for-in`, `Object.keys` and JSON are unchanged.
- `Object.prototype` and `Object.getPrototypeOf({})` both return it.

### 3. Error objects were bare objects (plan item 6)
**File:** `src/browser/js/index.ts`
**Fix:**
- Each Error constructor (Error, TypeError, RangeError, ReferenceError, SyntaxError, EvalError, URIError) creates objects linked to its own prototype; the subtype prototypes link to `Error.prototype`.
- `name` lives on the prototype. `message`, `stack` and `cause` are non-enumerable.
- `Error.prototype.toString` gives "Name: message".

### 4. `class X extends Error / Map / ES5 function` was broken (plan item 4)
**File:** `src/browser/js/interpreter.ts`
**Problem:** `super()` did nothing for a non-class parent, and the subclass prototype was linked to the parent's internal `[[Prototype]]`.
**Fix:** The superclass prototype comes from `constructorPrototype(superClass)` (three sites). For a native or ES5 parent, `super()` runs the parent, then `this` adopts what the parent built (its own properties and internal `__*` slots):
```ts
const made = 'closure' in parentFn && !parentFn.isNative
  ? callJSFunction(parentFn, thisObj, args)
  : parentFn.nativeFn ? parentFn.nativeFn(thisObj, args) : undefined;
```

### 5. Assigning a property to a function crashed ("reading 'get'")
**Problem:** In `f.custom = 3`, a closure has no `properties` map; this broke jQuery-style `$.fn = …` and Google's first script.
**Fix:** Member assignment creates `obj.properties` lazily. call/apply/bind are also readable as values now (`typeof f.bind`, `var call = f.call`) through `functionMethod(fn, key)`.

### 6. `s.replace(/=/g, "")` lexed as divide-assign
**File:** `src/browser/js/lexer.ts`
**Problem:** The `/=` operator check ran before the regex-context check, so the parser failed with "Expected LBrace, got Return".
**Fix:** The regex-context check now runs first.

### 7. `Array.prototype`, `String.prototype` methods and `Function.prototype.call` were undefined
**Files:** `values.ts`, `interpreter.ts`, `index.ts`
**Problem:** `Array.prototype.slice.call(arguments, 1)`, `Array.prototype.forEach.call(nodes, …)` and `String.prototype.trim.call(x)` all threw. `arrayProto` existed but was never exposed, and its methods had the wrong native signature.
**Fix:**
- `ARRAY_PROTOTYPE`: every `createArray` result links to it, so `[] instanceof Array` and `Array.prototype.foo = …` polyfills work. `Array.prototype` and `.constructor` are set.
- The string method table moved to a shared `stringMethods(s)`, used by both member paths. `String.prototype` exposes each method as a function of `this`.
- Member reads use own-key checks; `'constructor' in {}` is true, so `"x".constructor` used to return a bogus native.
- `Function.prototype` now has call/apply/bind.

### 8. `Array(n)` made `[n]`
**File:** `src/browser/js/index.ts`
**Problem:** Google pads generated code with `Array(Math.random()*7824|0).join("\n")`. That came out as the number itself, so the generated script began with `5528(function(){…})` and threw "reading 'call'".
**Fix:** A single number argument now creates an empty array of that length, and an invalid length throws RangeError.

### 9. Assignment swallowed the comma operator (the worst one)
**File:** `src/browser/js/parser.ts`
**Problem:** The assignment's right side was parsed at `prec - 1`, and comma is precedence 1. So:
- `(a = 1, b = 2)` parsed as `a = (1, b = 2)`;
- `(C7 = x, C7.m)` set `C7` to `C7.m` and threw;
- `for (i = 0, j = 5; …)` started `i` at 5.

Minified code does this constantly.

**Fix:**
```ts
const assignRight = this.parseExpression(prec); // still right-associative: a = b = c
```

### 10. `c ? a : Z = x` parsed as `(c ? a : Z) = x`
**File:** `src/browser/js/parser.ts`
**Problem:** The alternate was parsed above assignment level. In Google's `…?(…,Z=…):Z=Promise.resolve(!1); Z.then(…)`, Z stayed undefined.
**Fix:** `const alternate = this.parseAssignExpr();`

### 11. `window` was not the global object; top-level `this` / `globalThis` / `self` were wrong
**Files:** `values.ts` (Environment), `index.ts`
**Problem:**
- `window.google = …` followed by a bare `google.tick()` failed, and `var x` never showed up as `window.x`.
- Top-level `this` was an empty object; `globalThis` and `self` were undefined.
- Undeclared assignments (`x = 1`) were silently dropped.

**Fix:**
- `Environment.linkGlobalObject(windowObj)` replaces `window.properties` with a `GlobalPropertyMap`. The map reads its own properties first, then the root scope's variables. Writing a data property that is also a variable updates the variable, so the two never disagree.
- The root `Environment.get`, `has` and `set` fall back to `window`'s own properties.
- An undeclared assignment creates a global (sloppy mode).
- `this`, `globalThis`, `self`, `top`, `parent` and `frames` are `window`.

### 12. `<noscript>` content was parsed as markup and displayed
**File:** `src/browser/rendering/html5-tokenizer.ts`
**Problem:** Nova runs scripts, so the spec makes noscript a raw-text element. The tokenizer parsed its contents, which spilled out of the (empty) noscript into the body. On Google that showed "Please click here if you are not redirected…".
**Fix:** `noscript` joins style/xmp/iframe/noembed/noframes in the tokenizer's RAWTEXT switch.

## Google results (RC-2) status
The fixture `tests/fixtures/google-search-2026/index.html` is what Google serves to a fresh client at `/search`: a JS challenge page (BotGuard/"knitsail") that then reloads with results.

| | Before this round | Now |
|---|---|---|
| Script errors | 4 ("reading 'get'", parse error, "reading 'call'", "Error: a") | 0 |
| Painted text | "Please click … here" (the noscript fallback) | none (the challenge page has no visible content) |

What happens after the challenge, its follow-up request and the results page, needs a device or network run to confirm.

## Not done (Round C of the plan)
- Labeled `continue outer` behaves like a plain `continue`.
- Calling a non-function returns undefined instead of throwing TypeError.
- `String(obj)` and `+` don't call a user `toString` / `valueOf`.
- `delete` is a no-op that returns true.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/values.ts` | `constructorPrototype`, `functionPrototypeObject`, `OBJECT_PROTOTYPE` + `objectPrototypeMember`, `ARRAY_PROTOTYPE` linked from `createArray`, instanceof rewrite, `Environment.linkGlobalObject` + `GlobalPropertyMap`, implicit globals |
| `src/browser/js/interpreter.ts` | `new` links prototypes; class `constructor`/`prototype`; super() for native/ES5 parents; Object.prototype fallback; lazy `properties` on assignment; `functionMethod` (exported); shared `stringMethods` (exported) with own-key lookup |
| `src/browser/js/index.ts` | Error constructors and prototypes; Object statics (getPrototypeOf, setPrototypeOf, getOwnPropertyNames, getOwnPropertySymbols, hasOwn, is, isExtensible/isFrozen/isSealed, preventExtensions, fromEntries, defineProperties); `Object.prototype`; `Array.prototype`; `String.prototype`; `Function.prototype.call/apply/bind`; `Array(n)`; window linked as global object with this/globalThis/self/top/parent/frames |
| `src/browser/js/lexer.ts` | Regex context checked before `/=` |
| `src/browser/js/parser.ts` | Assignment RHS precedence; ternary alternate at assignment level |
| `src/browser/rendering/html5-tokenizer.ts` | `noscript` is RAWTEXT |
| `android/app/build.gradle` | versionCode 30, versionName 1.29 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |
| `doc/2026-10-25-nova-js-object-model-plan.md` | Status: Rounds A + B done |

## Files Created
| File | Purpose |
|------|--------|
| `tests/js-object-model.test.ts` | 21 tests: constructors, classes, Object.prototype, errors, subclassing built-ins, function properties, built-in prototypes, Array(n), window as global, parser precedence, `/=/` regex, Object statics |
| `tests/google-challenge-page.test.ts` | noscript is raw text; the Google challenge page runs with no script errors and no fallback text |
| `tests/fixtures/google-search-2026/index.html` | Google's challenge page (92 KB) |
| `Nova-1.29.apk` | Signed release build |

## Test Results
```
npx vitest run
 Test Files  285 passed (285)
      Tests  10605 passed (10605)
   Duration  320.36s
```
```
npx tsc --noEmit                         → clean
npx vitest run tests/js-object-model.test.ts tests/google-challenge-page.test.ts → 23 passed
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD OK
apksigner verify Nova-1.29.apk           → Verifies (v2 + v3); versionCode 30, versionName 1.29
```

## Verification
- Probed each bug with `runJS` before and after the fix (built-in prototype probe, sequence/assignment probe, window/global probe).
- Traced Google's failing expressions to source by temporarily printing the failing member expression's AST, then reverted that edit.
- Rendered the Google fixture through `PageRenderer`: there are no `[ScriptEngine]` errors.
- `adb devices`: none connected, so there was no on-device test this round.
