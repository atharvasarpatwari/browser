# Top-Level `this` Was `undefined`, and `'use strict'` Detection Never Actually Worked

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Bisected nextjs.org, angular.dev, and discord.com for real JS engine failures. nextjs.org's and discord.com's leads were traced to cascading fallout from a Turbopack/webpack runtime chunk failing early (and, separately, real Next.js/webpack chunk-loader scripts depending on state a prior script on the real page sets up, which the isolated per-external-script bisection step doesn't replicate) — not pursued further, consistent with last round's established precedent for this class of lead. angular.dev's lead led to two real, compounding root causes.
**Status:** Completed (3 root causes fixed)

---

## Summary

Three related-but-distinct gaps, all found bisecting angular.dev and its real bootstrap code, plus a reserved-word destructuring gap found on the same sweep:

1. **Top-level `this` was `undefined`**, not the global object — real Angular.dev code does `this.document.documentElement.classList` at the top of an inline `<script>`, expecting `this === window`.
2. **`'use strict'` directive detection never actually worked**, for two separate reasons: a parser lookahead bug (function-level) and a missing check entirely (program-level, the far more common real-world shape).
3. **A reserved word (`class`, `get`, `set`, `as`, etc.) couldn't be used as a destructuring pattern property key**, found on the same sweep (figma.com/tailwindcss.com's real minified `{class: r, className: n, ...o} = props` prop-forwarding pattern).

## Root Causes

### 1. Top-level `this` is `undefined` instead of the global object

**File:** `src/browser/js/index.ts` (`createGlobalEnv`)
**Real trigger:** `this.document.documentElement.classList` at the top of an inline `<script>` (real angular.dev dark-mode-detection bootstrap code) — `this` is `undefined` at the top level of a real, non-strict, non-module script, so it must equal the global object (`window`).
**Problem:** `createGlobalEnv()` builds `windowObj` and aliases `self`/`globalThis` to it, but never binds `'this'` on the root environment at all. `ThisExpression`'s evaluation (`env.get('this') ?? undefined`) and every plain function call's non-strict `this`-fallback (`this.globalEnv.get('this') ?? createObject(null)`) both read this same, never-set root binding — so top-level `this` was `undefined`, and a plain function called without a receiver got a throwaway empty object (or, combined with root cause #2 below, sometimes silently ended up `undefined` too) instead of the real global object.
**Fix:** `env.setLocal('this', windowObj)` right alongside the existing `self`/`globalThis` aliasing.

### 2. `'use strict'` directive detection never actually worked

**File:** `src/browser/js/parser.ts` (`lookaheadStrictDirective`, `parse`)
**Real trigger:** Any function with its own `'use strict';` directive, and — far more commonly in real bundled/transpiled output — a `'use strict';` directive at the very top of the whole script/file, which real JS makes strict everywhere in that file.
**Problem, part A (function-level):** `lookaheadStrictDirective()` is called at all three function-parsing call sites (declaration, expression, arrow) *before* `parseBlock()`, with the body's opening `{` still the current token — but it checked `this.peek()` (the `{` itself) for a string literal, which can never match. `'use strict'` inside a function body was silently ignored everywhere, unconditionally, at every call site.
**Problem, part B (program-level):** `parse()` — the top-level entry point — never checked for a leading `'use strict'` directive at all, and nothing propagated strictness from an already-strict enclosing function down to a function nested inside it either.
**Fix, part A:** `lookaheadStrictDirective()` now checks `this.peek(1)`/`this.peek(2)` (the token after the `{`, and the one after that), matching what every call site actually has in front of it.
**Fix, part B:** `parse()` now checks for a leading `'use strict'` directive (no enclosing brace, so no `RBrace` case needed) and pushes it onto the existing `strictStack` for the whole program. All three function-parsing call sites now compute `strict` as `lookaheadStrictDirective() || inStrictContext()` (a small new helper reading the current `strictStack` top) — so a function correctly inherits strictness from an enclosing already-strict function or the program itself, not just from its own directive.
**Why this compounds with #1:** the `this`-fallback logic (`!fn.isStrict`) exists specifically to give a strict function's `this` a real `undefined` instead of the global-object fallback — but with strict-mode detection completely non-functional, *every* function looked non-strict to that check, so a strict function's `this` incorrectly fell back to the (also-broken, per #1) global-object logic instead of staying `undefined`.

### 3. A reserved word can't be used as a destructuring pattern property key

**File:** `src/browser/js/parser.ts` (`parseObjectPattern`)
**Real trigger:** `let {class: r, className: n, ...o} = t;` (real minified React/Tailwind-adjacent prop-forwarding code renaming the reserved-word `class` prop to a valid binding name).
**Problem:** `parseObjectPattern()`'s key dispatch only treated a real `TokenType.Identifier` as a plain named key; every other token — including reserved-word keywords like `class`, `get`, `set`, `as` — fell into the general-expression fallback meant for string/number/computed keys. For `class` specifically, that fallback's `parseExpression()` call correctly recognized `class` as introducing a *class expression* and then failed expecting `{` (a class body) instead of `:`.
**Fix:** The dispatch now routes any token that isn't specifically a `String` or `Number` literal into the identifier-like-key branch (which already supports shorthand, `:` renaming, and default values) — matching how `parseProperty()` (used for plain object *literals*, where `{class: 1}` already worked) already treats any leftover token as a valid property name.

## Notes

- Angular.dev's own external bundle (`main-XKOEL45I.js`) had a separate, unrelated failure (`Cannot read properties of undefined (reading 'major')`, from `var en = rs.major`) that traces to a large single-file bundle referencing a variable (`rs`, presumably Angular's own version-info object) defined via some cross-script or module-federation mechanism this bisection step doesn't replicate — not pursued, same class of harness limitation as last round's webpack chunk-loader findings.
- nextjs.org's ~10 "chunk path empty but not in a worker" / null-property failures all trace back to one earlier Turbopack runtime chunk failing (`Cannot read properties of null (reading 'type')`) — inspected that chunk directly and found no literal `.type` access at all in its own ~12KB source, meaning the actual failure point is in cross-chunk/cross-script state this bisection step's isolated-per-script execution doesn't set up correctly (the same known limitation documented in the prior round's doc). Not pursued further given the effort-to-confidence ratio.
- Verified the strict-mode fix doesn't regress the existing `with`-statement-rejection check (`strictStack` is also read there) — a `with` statement is still allowed in ordinary non-strict code, and is now *also* correctly rejected under a program-level `'use strict'` (a related, previously-broken case this incidentally fixed too, since `strictStack` was never populated at the program level before).
- Verified strict-mode directive scoping stays function-local, not file-wide: a function using `'use strict'` for its own body doesn't affect a sibling function declared afterward.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | `createGlobalEnv()` now binds the root environment's `this` to the same `windowObj` as `window`/`self`/`globalThis` |
| `src/browser/js/parser.ts` | `lookaheadStrictDirective()` checks the correct look-ahead offset; `parse()` detects a program-level `'use strict'` directive; all three function-parsing call sites inherit strictness from the enclosing context via a new `inStrictContext()` helper; `parseObjectPattern()`'s key dispatch accepts any non-string/non-number token (including reserved words) as a named key |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 3 new real-Electron regression checks |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Bisected nextjs.org, angular.dev, and discord.com via the multi-site harness, this time sharing one environment/controller across all of a page's scripts (an improvement over the previous round's per-script isolation, to reduce cross-script-state false positives).
2. Traced angular.dev's inline-script failure to `this.document` at the top level; confirmed the isolated repro (`this === window`) was `false` before any fix, via the real public `runJS()` entry point.
3. Root-caused to the root environment never binding `this`; fixed, then found the fix didn't fully resolve a plain-function-call regression check because strict-mode detection was *also* completely broken (a second, independent bug affecting the same `this`-fallback code path) — traced separately to the lookahead-offset bug and the missing program-level check.
4. Fixed both, then re-verified the full matrix: top-level `this`, non-strict function-call fallback, strict function-call `this` staying `undefined`, method/constructor/explicit-`call`/arrow `this` all unaffected, function-level and program-level (via `eval`, isolating the check) strict detection, strict-mode inheritance into a nested function, sibling-function strictness NOT leaking, and the `with`-statement rejection regression (in both directions).
5. Found the reserved-word destructuring-key gap on the same sweep (figma.com/tailwindcss.com); fixed and verified with `class`/`get`/`set`/`as`/`await`/`default`/`new` as keys, plus a full regression pass over every other destructuring shape (string/number keys, arrays, nested patterns, shorthand defaults, object literals).
6. Added 3 permanent e2e regression checks, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
7. Cleaned up all temporary bisection/repro scripts.
