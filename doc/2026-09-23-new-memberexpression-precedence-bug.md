# `new a.b.c(args)` Misparsed as `(new a.b).c(args)`, Recursing Forever in Real jQuery

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Continued last round's jQuery investigation — after fixing `Array.prototype` not existing, jQuery 1.8.2 got past its first line but then hit "Maximum call stack size exceeded". Traced that to a genuine, high-impact parser precedence bug affecting any `new` expression whose callee is a member-expression chain.
**Status:** Completed (1 root cause fixed)

---

## Summary

`new`'s callee grammar production is a MemberExpression — it can chain `.prop`/`[expr]` accesses (`new a.b.c(...)`) but must never swallow a following `(...)` call, since that argument list belongs to `new` itself, not to the callee. Nova's parser got this wrong: `new p.Init(a, b)` silently parsed as `(new p()).Init(a, b)` — construct bare `p` with **no** arguments, then call the unrelated `.Init` property as a plain method with `(a, b)`. jQuery's own real core factory function does exactly this shape on every single call (`jQuery = function(a, b) { return new jQuery.fn.init(a, b); }`), so the misparse meant *calling* `jQuery(...)` re-entered *constructing* `jQuery` itself, forever.

## Root Cause

**File:** `src/browser/js/parser.ts` (`parseNewExpression`)
**Real trigger:** `p=function(a,b){return new p.fn.init(a,b,c)}` — jQuery 1.8.2's actual, unminified-equivalent core factory pattern (the near-universal "constructor function returns `new Ctor.fn.init(...)` so instances share one shared `.fn` prototype" idiom, not unique to jQuery).
**Problem:** `parseNewExpression()` parsed its callee via `this.parseExpression(18)`. The parser's single shared infix-precedence table groups `Dot`, `LBracket`, and `LParen` all at the same level (17) — chosen so a generic `parseExpression()` call can stop *before* consuming a trailing `(args)` call. But since `Dot`/`LBracket` share that exact level too, `parseExpression(18)` (precedence 18, one above 17) refused to consume *any* of them — it returned after just the first token (a bare identifier), never reaching `.Init` at all. Control returned to whatever was already parsing the surrounding expression, which then picked up `.Init(...)` as an ordinary postfix member-call on the (already-fully-parsed, args-less) `NewExpression` result.
**Fix:** Replaced the `parseExpression(18)` call with a dedicated loop: parse the base via `parsePrefix()` (which already handles nested `new`, parenthesized groups, and every other primary form), then manually chain `.prop`/`[expr]` accesses — stopping the moment a `(` is seen, so `new`'s own trailing argument list is left for the existing code right after the loop to consume. This mirrors the real ECMAScript `MemberExpression`/`NewExpression` grammar productions directly rather than trying to force the shared, general-purpose Pratt precedence table to express a distinction it isn't built to make.

## Notes

- This bug was invisible until last round's `Array.prototype` fix let jQuery's execution reach its own core factory line at all — before that, jQuery failed on its very first statement (`Array.prototype` didn't exist), so this parser bug in the very next line never got exercised.
- Continuing past this fix, jQuery hits a *third*, different, not-yet-diagnosed failure in its own DOM-feature-detection routine (`n.getElementsByTagName("a")[0]` apparently returning `undefined`) — a DOM-API-correctness question, not a JS-engine-semantics one, and not pursued this round. Flagged for a future round; getting jQuery fully loading end-to-end will likely take at least one more pass.
- Verified the fix doesn't regress any other `new` shape: zero-arg constructors, classes, built-ins (`Date`), a parenthesized callee (`new (Foo)(x)`), a call-expression-in-parens callee (`new (makeCtor())(x)`), nested `new new Foo()`, bracket-computed member callees (`new a[key](x)`), and a call chained immediately after construction (`new Foo.Bar(a,b).method()`) — all continue to parse and evaluate correctly.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | `parseNewExpression()` now manually chains `.prop`/`[expr]` member accesses onto its callee instead of delegating to the generic `parseExpression()`, which couldn't distinguish "consume member access" from "consume a call" |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Continued last round's jQuery 1.8.2 investigation: added temporary interpreter-level call-depth tracing (both `callFunction` and `evalExpr`) to localize the stack-overflow source, since it produced no useful native stack trace on its own.
2. Found the recursion depth climbing right at jQuery's own core factory line; built a minimal standalone repro (`var p = function(){ return new p.Init(); }; p.Init = function(){...}; new p();`) that reproduced the same crash outside the full 93KB file.
3. Narrowed further: even `new p.Init()` alone (no wrapping factory function) produced a wrong result, confirming a parser-level bug rather than anything specific to self-referential closures.
4. Dumped the actual AST for `new p.Init(1,2)` and found the misparse directly: a `CallExpression` wrapping a `MemberExpression` wrapping a zero-argument `NewExpression` — confirming `new`'s argument list was being lost to the callee-parsing boundary.
5. Traced the boundary to `parseNewExpression()`'s `parseExpression(18)` call and the shared precedence table lumping `Dot`/`LBracket`/`LParen` together; fixed with a dedicated member-access-chaining loop.
6. Verified with a comprehensive matrix of 13 checks: the core fixed pattern (plain, bracket-computed, and mixed dot/bracket member chains), every previously-working `new` shape (identifiers, classes, built-ins, parenthesized/call-expression callees, nested `new`, post-construction method chaining), and the exact real jQuery factory idiom end-to-end (including `instanceof`) — all correct.
7. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
8. Cleaned up all temporary bisection/repro scripts, including the interpreter-level debug tracing added and removed during investigation.
