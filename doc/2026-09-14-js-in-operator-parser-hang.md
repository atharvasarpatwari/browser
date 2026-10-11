# JS Engine — `in` Operator Hung the Parser Forever (www.google.com Never Loaded)

**Date:** 2026-09-14
**Session:** User reported the Android app hangs forever on `www.google.com`. Reproduced in Electron (same shared engine), traced it past DNS/network — the hang was inside the JS parser itself, on a real script from Google's own homepage.
**Status:** Completed

---

## Summary
Any page whose JavaScript used the `in` operator (`"prop" in obj`) as a plain binary expression — one of the most common operators in real-world JS — hung the parser in a true infinite loop, freezing the entire renderer (Electron's own watchdog detected it as "unresponsive" and kept reloading the window every 5 seconds, forever, without ever recovering). Google's homepage happens to use `in` in its very first bootstrap script (`"navigationStart" in window.performance.timing`), so it hit this on every load.

## Root Cause
`parser.ts`'s Pratt-parser loop (`parseExpression`) asks `infixPrecedence(tokenType)` for the current token's precedence, and keeps looping — calling `parseInfix(left, prec)` — as long as that precedence is non-zero. `infixPrecedence()` correctly lists `TokenType.In` at precedence 11 (same tier as `instanceof`/`<`/`>`). But `parseInfix()`'s switch statement, which is supposed to consume the operator token and parse the right-hand side, never had a `case TokenType.In:` — so an `in` token fell through to `default: return left`, which returns *without advancing the token position*. The outer loop then asked for the same token's precedence again (still 11), called `parseInfix` again, hit the same `default` branch again — forever. Nothing in the parser has a hang-detection safety net (unlike the interpreter's `checkTimeout()`), so once the parser itself loops without making progress, there is no recovery: the loop spins for real, forever, on the same synchronous call stack that also runs Electron's own renderer thread.

## Second Bug Found During Verification
While minimizing Google's actual homepage script down to the exact failing construct, a second, separate, real gap surfaced: `parseForStatement()`'s `for (var x = …; …)` branch only ever parsed **one** variable declarator — `for (var i = 0, len = arr.length; i < len; i++)` (an extremely common loop-optimization idiom) threw `Expected Semicolon, got Comma` instead of parsing correctly. The statement-level `parseVariableDeclaration()` already handled multiple comma-separated declarators correctly; the for-loop's own inline declarator parsing just never got the same treatment. Fixed by looping on `TokenType.Comma` the same way, collecting one `VariableDeclarator` per iteration — the interpreter and bytecode compiler already execute a `VariableDeclaration` with multiple `declarations` correctly (confirmed: both delegate to the shared `execVarDecl`/`compileVarDecl`, unchanged), so this was a pure parser gap, not a runtime one.

## Notes
- This was **not** a DNS, TLS, or Android-specific bug — it reproduced identically and immediately in the desktop Electron build, since both platforms share the exact same JS engine. Confirmed via a from-scratch bisection: extracted the actual 21,861-character hanging script from a real `www.google.com` load, bisected it down to a one-line repro (`var x = "foo" in window;`), fixed it, then re-verified the *entire original* Google script now parses successfully end-to-end (previously: hangs forever; now: 14 top-level statements, clean).
- After the fix, `www.google.com` still logs a handful of unrelated `[ScriptEngine] Error executing ... script` lines for other syntax the engine doesn't yet support (template-literal/regex lexing ambiguity, a few undefined-property accesses) — this is expected, normal behavior for a from-scratch engine handling Google's Closure-Compiler-optimized JS, and is exactly how a real browser handles a script error: log it, skip that script, keep rendering the rest of the page. The page now actually loads (images fetch, DOM renders) instead of never finishing.
- Verified the fix doesn't regress the one real edge case that touches the same code path: `for (someExpr.prop in obj)` (a member-expression for-in target, not a bare identifier or declaration) was already broken before this fix — it hit the exact same infinite loop via the general expression parser. After the fix it now fails with a clean, fast parse error instead of hanging forever. Never worse, sometimes better; implementing the full ECMAScript "NoIn" grammar restriction for this rare pattern is out of scope here.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | Added `case TokenType.In` to `parseInfix()`'s binary-operator group (root cause); `parseForStatement()`'s `for (var x = …)` branch now loops on `,` to collect multiple `VariableDeclarator`s instead of just one |
| `tests/bytecode-vm.test.ts` | Added 2 tests: `in` operator (`"a" in o`), and a `for` loop with multiple comma-separated declarators |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9234 tests passed (9232 baseline + 2 new)
npx playwright test --config=playwright-electron.config.cjs       → 3/3 passed
```

## Verification Steps
1. Reproduced the exact user-reported symptom in Electron: navigated to `www.google.com`, watched Electron's own renderer-unresponsive watchdog kick in and reload the window every 5 seconds, forever (60s test timeout hit, still hanging).
2. Added temporary instrumentation to `page-renderer.ts`/`index.ts` logging before/after each blocking script's parse and execute phases — found the hang was inside `parser.parse()` for one specific 21,861-character inline script, dumped its exact source to a file.
3. Bisected that source (binary search on prefix length, then narrowed to individual characters) down to the exact boundary: `"navigationStart" in window...` — confirmed with a one-line standalone repro (`var x = "foo" in window;`) run through the parser directly via `tsx`, outside Electron entirely, with a hard process timeout to prove it was a true infinite loop (not just slow).
4. Fixed the parser, reran the one-line repro (now completes instantly), reran the full 21,861-character script (now parses to completion, 14 statements), removed all temporary instrumentation, and reran the original `www.google.com` Electron test — it now loads successfully instead of hanging.
5. While bisecting, found and fixed the second, unrelated multi-declarator `for` loop gap the same way (isolated to a one-line repro, confirmed the fix, added a permanent test).
6. Ran the full unit suite and full Electron e2e suite — no regressions.
