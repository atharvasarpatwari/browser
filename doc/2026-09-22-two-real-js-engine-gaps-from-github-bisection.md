# Two Real JS-Engine Gaps Found Bisecting GitHub's Own Assets

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Having exhausted the YouTube-bisection thread and found a `document.cookie` gap on Wikipedia, tried Bing next — its runtime failures all turned out to be missing third-party bootstrap globals (`sj_evt`, `BM`, `_w.rms`) from external scripts the test harness doesn't fetch, a dead end, not a Nova bug. Switched to `github.com`, whose own first-party assets (`github.githubassets.com`) are real, well-maintained, first-party JS — a better bisection target — and found two genuine, distinct parser bugs.
**Status:** Completed (2 root causes fixed)

---

## Summary

Bisected two real external scripts from `github.githubassets.com`. Both are confirmed valid JS via `node --check` before any Nova code was touched. The first (`&&=`/`||=` never tokenized, plus a related assignment-precedence bug) was found via a minimal repro after noticing the lexer had `??=` support but not its two logical-assignment siblings. The second (class-body `get`/`set` disambiguation) is the exact same bug class fixed for object literals in the 2026-09-21 session — but in a completely separate, parallel code path that never got the same fix.

## Root Causes

### 1. `&&=`/`||=` were never tokenized as compound-assignment operators, and assignment's right-hand side used the wrong precedence
**File:** `src/browser/js/lexer.ts`, `src/browser/js/tokens.ts`, `src/browser/js/parser.ts`
**Real trigger:** `` ready: () => n ||= new Promise(e => {...}), firstInteraction: () => u() `` — real GitHub code using the ES2021 logical-OR-assignment operator inside an object-literal property's concise arrow body.
**Problem, part A:** The lexer's `&&`/`||` case only ever advanced 2 characters and returned `AmpersandAmpersand`/`PipePipe` — unlike `**`, `??`, and every other compound operator, it never checked for a following `=`. `n||=x` tokenized as three separate tokens (`n`, `||`, `=`, `x`) instead of `n`, `||=`, `x`.
**Fix, part A:** Added `AmpersandAmpersandAssign`/`PipePipeAssign` token types and the missing `if (peek(0) === '=')` check to the lexer, following the exact pattern already used for `**=`/`??=`. Added both to the parser's assignment-operator case list and precedence table, and to the interpreter's two assignment-evaluation switches (identifier and member-expression targets) using the same short-circuit-free style already used for `??=` there (the bytecode compiler already had fully correct, properly short-circuiting `&&=`/`||=` codegen for both — it was simply unreachable, since the lexer never produced the tokens the parser needed to build the AST nodes it expected).
**Problem, part B (found while verifying part A):** Even after fixing the lexer, `{ ready: () => n ||= 5, other: () => 1 }` still failed — but so did the exact same shape with plain `=`, `+=`, and the pre-existing `??=`, proving this second bug was unrelated to the new operators and already present. Assignment's right-hand side was parsed with `parseExpression(prec - 1)` where `prec` (2) is assignment's own precedence — and Comma's precedence is also `prec - 1` (1). Since the parser's loop continues on `prec >= minPrec` (inclusive), the assignment's right side incorrectly kept parsing past a following comma, swallowing the next object property's key as a bogus `SequenceExpression` continuation and desyncing every token after it.
**Fix, part B:** Changed the right-hand-side recursion to `parseExpression(prec)` (the same precedence, not one less) — right-associativity for `a = b = c` only requires accepting another assignment at the *same* precedence, not also annexing the next-lower-precedence comma operator.

### 2. Class-body `get`/`set` had the same accessor-disambiguation bug fixed for object literals — in a separate, un-fixed code path
**File:** `src/browser/js/parser.ts` (`parseClassBody()`)
**Real trigger:** A real LRU-cache class from GitHub's asset bundle with a method literally named `get` (`get(e){...}`) alongside a real getter with a computed key (`get [Symbol.toStringTag](){...}`).
**Problem:** The 2026-09-21 session fixed exactly this bug for *object literals* (`parseProperty()`) by adding a `startsAccessorName()` lookahead before treating `get`/`set` as accessor introducers. `parseClassBody()` is a completely separate function with its own independent (static and non-static) `get`/`set` handling that never got the same fix — it unconditionally treated `get`/`set` as accessors, so `get(e){...}` cascaded into nonsense a token at a time (exactly the same failure shape as the original object-literal bug, just one field over in the codebase).
**Fix:** Added the same `&& this.startsAccessorName()` check to both branches (static and instance members) in `parseClassBody()`, reusing the existing helper as-is.

## Notes

- Both real GitHub asset files (`element-registry-*.js`, `behaviors-*.js`, ~330KB combined) now parse cleanly; each was confirmed valid JS via `node --check` before investigating, and root-caused via real bisection tooling — a `parseProperty()`/`parseStatement()` monkeypatch that records exact source spans of the last several successfully-parsed constructs during the real failing parse, rather than guessing at boundaries or trusting column numbers on a giant single-line minified file (which drift unreliably over 100,000+ characters — confirmed the hard way mid-investigation).
- One dead end worth recording: a hand-rolled "tokenize in a loop" test harness for template literals produces misleading results, because interpolation (`${...}`) tokenizing requires the *parser* to explicitly tell the lexer when to resume template-continuation mode after an interpolation expression closes — a bare `lexer.nextToken()` loop has no way to do that hand-off and will show every template literal with an interpolation as "broken," even though real parser-mediated parsing handles it correctly. Re-verified through the real `Parser` before concluding anything.
- Also found, but explicitly **not fixed this round**: `Object.prototype.toString`/`Symbol.toStringTag`-aware formatting doesn't exist (`Object.prototype` itself has no shared `toString` method) — surfaced while verifying the class-body fix against a getter with a computed `Symbol.toStringTag` key. The getter itself works fine (`instance[Symbol.toStringTag]` returns the right value); it's specifically `Object.prototype.toString.call(x)` that's missing. Scoped out as a separate, likely larger gap (needs a real `Object.prototype` as the root of the prototype chain) rather than folded into this round's fix.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/lexer.ts` | `&&`/`||` dispatch now checks for a following `=`, emitting `&&=`/`||=` |
| `src/browser/js/tokens.ts` | `Token` gains `AmpersandAmpersandAssign`/`PipePipeAssign` types and display strings |
| `src/browser/js/parser.ts` | Added the two new tokens to the assignment case list and precedence table; fixed assignment's right-hand-side recursion from `prec - 1` to `prec`; added `startsAccessorName()` checks to both branches of `parseClassBody()`'s get/set handling |
| `src/browser/js/interpreter.ts` | Added `&&=`/`||=` evaluation to both assignment switches (identifier and member-expression targets) |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 2 new real-Electron regression checks (class method literally named get/set + computed-key getter; compound-assignment concise arrow body as an object property value + real `&&=`/`||=` behavior) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 227/228 files, 9313/9316 tests passed (3 pre-existing DNS-timeout failures, unrelated — see doc/known-test-failures.md)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
Real GitHub assets (before → after)                      → both files: 0 parse errors (previously: "Expected LBrace, got RParen", "Expected LBrace, got Arrow")
```

## Verification Steps

1. Bisected `github.com`'s own real assets (not third-party scripts) after Bing's runtime failures turned out to be an unfetched-dependency dead end. Confirmed both failing files are valid JS via `node --check` before touching any code.
2. For gap #1: noticed the lexer had `??=` support but not `&&=`/`||=` while reviewing the dispatch code; wrote a minimal repro confirming the missing tokenization before fixing it. Discovered the deeper comma-precedence bug only while verifying the fix against the *exact* real object-literal shape — used a plain `=`/`+=`/`??=` control group to prove it was a pre-existing, unrelated bug before fixing it too.
3. For gap #2: used a `parseProperty()`/`parseStatement()` monkeypatch to record real, internally-consistent source spans from the actual failing parse run (far more reliable on a 246KB single-line minified file than manually reverse-computing offsets from reported line:column, which drift). Traced the failure to immediately after a real constructor, at a method literally named `get`, and recognized it as the same bug class as the 2026-09-21 object-literal fix living in a different function.
4. Verified both fixes with targeted repros (right-associative chaining `a=b=c=5`, comma-sequence expressions, real getters/setters at instance/static/computed-key positions, a method literally named `get`/`set` taking real parameters) before considering either complete.
5. Re-parsed both real GitHub asset files to confirm 0 remaining errors.
6. Added 2 permanent regression checks to `tests/e2e/js-dom-api-sweep.spec.ts`, rebuilt, and re-ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
