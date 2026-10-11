# An Empty Statement (`;`) as an `if`/Loop Body Crashed the Whole Engine — Real jQuery Now Loads End-to-End

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Completed the multi-round jQuery 1.8.2 investigation (`Array.prototype`, the `new a.b.c()` parser precedence bug, `getElementsByTagName`/`createDocumentFragment` from the last three rounds) — this was the final blocker. **Real jQuery 1.8.2 now loads completely without error for the first time this session.**
**Status:** Completed (1 root cause fixed)

---

## Summary

`parseStatement()` returns `null` for a bare `;` (empty statement) rather than a dedicated AST node — an existing, deliberate simplification the parser already relies on elsewhere (`parse()`'s and `parseBlock()`'s own body-building loops filter it out: `if (stmt) body.push(stmt)`). But every single-statement `if`/loop body (`if`/`else`, `for-in`, `for-of`, `for(;;)`, `while`, `do-while`) reads it via `this.parseStatement()!` — a non-null assertion that's a lie the moment the body really is just `;`. Two separate interpreter functions then read `.type` straight off that `null` without checking: `exec()`'s own dispatch, and a let/const TDZ-hoisting pre-scan that recurses into an `if`'s branches. Real jQuery 1.8.2's own `isPlainObject` does exactly this — `for(d in a);` — to leave its loop variable set to the last enumerable key, and hit this immediately.

## Root Cause

**File:** `src/browser/js/interpreter.ts` (`exec`, `hoistLetConst`)
**Real trigger:** `var d; for(d in a); return d===b||n.call(a,d)` — jQuery 1.8.2's real `isPlainObject` implementation.
**Problem:** `parseStatement()` legitimately returns `null` for an empty statement, and 10 separate call sites across `if`/`for-in`/`for-of`/`for(;;)`/`while`/`do-while` parsing force it non-null with `!`. `AST.ForInStatement.body` (and the equivalent fields on every other construct) is typed `AST.Statement` (non-nullable) in the AST, so nothing at the type level flags this — until a real empty-bodied loop makes the assertion false at runtime. `execForIn` (and every sibling loop executor) then calls `this.exec(stmt.body, loopEnv)`, and `exec()`'s dispatch immediately does `switch (stmt.type)` — a crash on `null.type`. Separately, `hoistLetConst` — the pass that pre-declares TDZ bindings for `let`/`const` — recurses into an `if`'s `consequent`/`alternate` the same way (`this.hoistLetConst([stmt.consequent], env)`), hitting the identical hazard for `if (cond);` specifically.
**Fix:** Rather than patching all 10 parser call sites (or introducing a new `EmptyStatement` AST node type — a bigger, unnecessary change given the parser's own existing "null = filtered out" convention), fixed both real *consumers* of a single-statement body/consequent/alternate at once: `exec()` now returns `undefined` immediately for a `null` statement (matching real JS's empty-statement no-op semantics — this is the single, shared execution entry point every loop/if body already funnels through), and `hoistLetConst` skips `null` entries in its recursive if-branch scan.

## Notes

- This was the last of four compounding bugs found across four rounds of the same jQuery investigation (`Array.prototype` missing → the `new a.b.c()` parser precedence bug → `getElementsByTagName`/`createDocumentFragment` missing → this). **Real jQuery 1.8.2 now loads with zero parse or runtime errors** — confirmed via a full end-to-end functional check: `jQuery`/`$` are defined, `jQuery.fn.jquery` reads `"1.8.2"`, `jQuery.each`/`jQuery.extend` work correctly on real data.
- That same functional check surfaced a *new*, much larger area not yet investigated: `$('.selector')` finds zero real DOM elements, `.text()`/`.addClass()`/chained manipulation don't work, and `$(document).ready(fn)`-style usage never invokes its callback. This points at jQuery's Sizzle selector engine and/or its DOM-ready detection doing something Nova doesn't support yet — a substantially different, larger area (CSS selector engine internals, not core JS-engine semantics) than the bugs fixed in this and the prior three rounds. Flagged for a future round; getting jQuery's actual DOM manipulation working will need real investigation into how Sizzle itself is implemented, not just isolated language/DOM-API gaps.
- Verified no other statement-array consumer shares this hazard: `execBlock`'s own two loops and `hoistLetConst`'s top-level entry both only ever iterate `BlockStatement.body`/`Program.body` arrays, which `parseBlock()`/`parse()` already null-filter by construction — only the single-field (non-array) `consequent`/`alternate`/loop-`body` fields were ever exposed to a raw, unfiltered `null`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | `exec()` now returns `undefined` immediately for a `null` statement instead of dispatching on it; `hoistLetConst()` skips `null` entries in its recursive if-branch scan |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Continued the jQuery 1.8.2 investigation with the same temporary tracing approach as the prior three rounds, this time widening it: added debug prints not just at the three previously-known "Cannot read properties of X" throw sites, but at every native-function-call catch site (`values.ts`'s `callJSFunction`, `interpreter.ts`'s own `callFunction`, `vm.ts`'s `VM.run`) and the top-level `runJS()` catch — since none of the earlier sites fired, meaning the error was propagating uncaught all the way to the outermost handler.
2. That widened trace produced a real host-level stack trace for the first time, pointing directly at `Interpreter.exec` (line 376, `switch (stmt.type)`) called from `Interpreter.execForIn` — confirming this was a bug in Nova's own interpreter code, not a guest-JS-level issue.
3. Found the exact real trigger in jQuery's own minified source (`for(d in a);`) and confirmed it against `isPlainObject`'s real, well-known implementation.
4. Traced the root cause to `parseStatement()`'s intentional `null`-for-`;` return and the 10 call sites across the parser that force it non-null; found `exec()`'s dispatch was the direct consumer for loop bodies.
5. Fixed `exec()`, re-tested — found `if (true);`/`if (false); else ...` *still* crashed via a completely separate code path (`hoistLetConst`'s if-branch recursion), confirming the hazard had two independent consumers, not one; fixed that too.
6. Verified with a 13-case regression matrix: the exact real trigger, every other construct with an empty body (for-of, `for(;;)`, while, do-while, if, if/else, a bare top-level `;`, a labeled empty statement), and every construct with a *real* body (unaffected, including one nested-loop case combining a real outer for-in with an empty inner one).
7. Ran the full jQuery 1.8.2 minified source through Nova end-to-end — zero parse or runtime errors — then a further functional check confirming `jQuery`/`$`, `jQuery.fn.jquery`, `jQuery.each`, and `jQuery.extend` all genuinely work; noted (but did not chase) the newly-surfaced Sizzle-selector-engine gap.
8. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
9. Cleaned up all temporary bisection/repro scripts, including every debug trace added and removed during investigation (confirmed via `git diff` showing zero net changes to `values.ts`/`vm.ts`/`index.ts`, and only the real fix remaining in `interpreter.ts`).
