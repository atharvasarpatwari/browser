# Nova JS Interpreter — Object Model Repair (Prototypes, instanceof, Subclassing Built-ins) — Plan

**Date:** 2026-10-25
**Session:** "keep improving the nova app…". Found while fixing RC-19 ("[object Object]" script errors) from the end-user test report.
**Status:** Rounds A + B done in 1.29 (see 2026-10-26-nova-android-1.29-js-object-model-google-scripts.md); Round C planned

---

## Problem (probed this session with `runJS` on a blank document)
| Script | Nova | A browser |
|--------|------|-----------|
| `function F(){this.a=1} F.prototype.hi=function(){return "hi"+this.a}; new F().hi()` | `undefined` | `"hi1"` |
| `Object.getPrototypeOf(new F()) === F.prototype` | `false` | `true` |
| `new F() instanceof F` | `false` | `true` |
| `class A{}; new A() instanceof A` | `false` | `true` |
| `new A().constructor === A` | `false` | `true` |
| `class E extends Error { constructor(m){ super(m) } }; new E("x").message` | `undefined` | `"x"` |
| `new E("x") instanceof Error` | `false` | `true` |
| `class M extends Map {}; m.set("a",1); m.get("a")` | `undefined` | `1` |
| `typeof Object.prototype` | throws ("reading 'hasOwnProperty'") | `"object"` |
| `typeof ({}).toString`, `({}).hasOwnProperty("x")` | `"undefined"`, `undefined` | `"function"`, `false` |
| `String(new Error("m"))` | `"[object Object]"` | `"Error: m"` |
| `var u; u(); "after"` | `"after"` (no error) | `TypeError: u is not a function` |

Libraries depend on all of these:
- `instanceof` checks (React and every framework, polyfills);
- prototype methods on constructor functions (pre-ES6 code: jQuery plugins, Google's closure library);
- `class X extends Error` (nearly every library's custom errors);
- `obj.hasOwnProperty`.

This is the most likely reason real sites' scripts fail in Nova. It is a candidate cause for RC-2 (Google results blank: `Cannot read properties of undefined (reading 'get')`).

## Root causes (code)
| # | Where | What |
|---|-------|------|
| 1 | `src/browser/js/interpreter.ts` `evalNew`, function-constructor branch | `const instance = createObject(null)`: never links `F.prototype` (from `properties.get('prototype')`) as the instance's `[[Prototype]]` |
| 2 | `src/browser/js/values.ts:369` `instanceofCheck` | Only handles native functions and closures (`isNativeFn`); a class (`type: 'class'`) returns false at once. It reads only `properties.get('prototype')`, while classes keep their prototype object in the internal `.prototype` slot |
| 3 | `interpreter.ts` class declaration (~line 446) | `classProto.prototype = superClass.prototype` uses the parent's *internal* `[[Prototype]]`. That is right for user classes in this representation, wrong for native constructors, whose prototype object is in `properties.get('prototype')` |
| 4 | `interpreter.ts` `evalCall`, `super(...)` | Only runs a parent written in JS (`constructor` closure). A native parent (Error, Map, Set, EventTarget, HTMLElement) is never called, so `message`, the Map storage and so on are never initialized on `this` |
| 5 | `src/browser/js/index.ts` `createGlobalEnv` | `Object` has no `prototype` object with `hasOwnProperty`/`toString`/`valueOf`/`isPrototypeOf`/`propertyIsEnumerable`. Object literals (`evalObject`) are created with `createObject(null)`, so they inherit nothing. Same for `Function.prototype` (`call`/`apply`/`bind` presumably special-cased) |
| 6 | `index.ts` Error constructors (line ~468) | They build plain objects: no `Error.prototype`, no prototype chain between TypeError and Error, no `toString` |
| 7 | `values.ts` `toString` / `String()` | Never calls a user or prototype `toString`/`valueOf`, so `String(err)` and `"" + obj` give `[object Object]` |
| 8 | `interpreter.ts` call evaluation | Calling a non-callable value returns `undefined` silently instead of throwing `TypeError: x is not a function` |

## Plan
**Round A: prototype chain plumbing.** Items 1–3, 5 and 6. Mostly a few lines each, plus a shared `Object.prototype`.
1. `createGlobalEnv` builds `Object.prototype` (hasOwnProperty, isPrototypeOf, propertyIsEnumerable, toString, toLocaleString, valueOf) once. `createObject` keeps its signature. `evalObject` and the `new F()` path link to it.
2. `new F()`: `[[Prototype]]` = `F.prototype` when that is an object, else `Object.prototype`. `F.prototype.constructor = F` is set when a function is created.
3. `instanceofCheck`: handle classes (internal `.prototype`), closures and natives the same way, walking the left value's chain.
4. Errors get a real `Error.prototype` (name, message `''`, toString `"Name: message"`), with TypeError/RangeError/… inheriting from it.

**Round B: subclassing built-ins.** Item 4.
- For a native parent, `super(...)` calls the native constructor with `this` as the receiver where the native supports it (Error: set `message` on `this`). Otherwise it uses the native result as `this`, re-parented to the subclass prototype (Map/Set/Array keep their internal slots on the created object).
- `extends` takes a native parent's prototype from `properties.get('prototype')`.

**Round C: ToPrimitive and call errors.** Items 7–8.
- `toString(value)` / `String()` / `+` call a `toString`/`valueOf` found on the chain.
- Calling a non-function throws `TypeError: <expr> is not a function`, now catchable thanks to this session's try/catch fix.
- Risk: pages that "half work" today because the bad call was ignored will now stop at the error, as they do in browsers. That needs a check on the device with the real-site fixtures (Wikipedia, iana, example.com).

**Each round:** new `tests/js-object-model-*.test.ts` covering every row of the table above. The full suite (10k tests, many JS ones) must pass, re-run against the saved real-site fixtures. Google's search page (fixture to be saved) is the acceptance test for RC-2.

## Already done this session (no approval needed: bug fixes in place)
- Host errors raised by the engine (`null.x`, CSP blocks) are now catchable by page `try/catch`. Before, they escaped every catch and killed the script.
- `finally` now runs when an exception passes through a `try` with no `catch`.
- `JSError` messages read `Name: message` instead of `[object Object]`.
