# JS Engine Critical Language Gaps

**Date:** 2026-07-20
**Session:** Implementing optional chaining, nullish coalescing, labeled statements, eval, async/await, generators
**Status:** Completed

---

## Summary
Implemented 6 critical JavaScript language features in the custom tree-walking interpreter: optional chaining (`?.`), nullish coalescing (`??`/`??=`), labeled statements with `break`, `eval()`, `async`/`await`, and generator functions with `yield`/`yield*`. Also fixed a precedence regression in `parseNewExpression` that broke all class instantiation, and fixed break signal propagation through nested loops for labeled breaks.

## Root Causes

### 1. Class instantiation broken by precedence shift
**File:** `src/browser/js/parser.ts`
**Problem:** When `??` was added at precedence 4, all other operators were shifted up by 1. `LParen` moved from precedence 16 to 17. `parseNewExpression` still used `parseExpression(17)` for the callee, which meant `Dog("Rex")` was consumed as a `CallExpression` inside the callee (since `17 < 17` is false), rather than being parsed as the constructor name with separate arguments. This turned `new Dog("Rex")` into `new (Dog("Rex"))` — a no-argument `NewExpression` wrapping a call.
**Fix:** Changed `parseExpression(17)` to `parseExpression(18)` in `parseNewExpression` so that `(` at precedence 17 breaks the loop and is handled as constructor arguments.

### 2. Parser missing labeled statement support
**File:** `src/browser/js/parser.ts`
**Problem:** The interpreter had a `LabeledStatement` case in `exec()`, but the parser never produced `LabeledStatement` AST nodes. When encountering `outer: { ... }`, it parsed `outer` as an identifier expression, then `:` as part of the ternary operator, producing incorrect AST.
**Fix:** Added `parseLabeledStatement()` method that consumes `IdentifierColon`, parses the label, expects `Colon`, then parses the body statement. Added detection in `parseStatement()`'s default case: when current token is `Identifier` and next is `Colon`.

### 3. Labeled breaks swallowed by inner loops
**File:** `src/browser/js/interpreter.ts`
**Problem:** All loop constructs (`execFor`, `execWhile`, `execDoWhile`, `execForIn`, `execForOf`) and `execSwitch` caught ALL break signals with `if (isBreakSignal(result)) return undefined`. This meant labeled breaks like `break outer` intended for an outer labeled loop were caught by the inner loop, preventing them from propagating up to the matching `LabeledStatement` handler.
**Fix:** Changed all break handlers to only catch unlabeled breaks (`!result.label`). Labeled breaks (`result.label` is set) are re-thrown/propagated up the call stack to be caught by the correct `LabeledStatement`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/tokens.ts` | Added `QuestionDot`, `QuestionQuestion`, `QuestionQuestionAssign`, `Await`, `Async`, `Yield`, `Generator` token types + keyword mappings |
| `src/browser/js/lexer.ts` | Tokenization of `?.`, `??`, `??=`; added new tokens to `isRegexContext()` |
| `src/browser/js/parser.ts` | Optional chaining, nullish coalescing, `??=` assignment, async function decl/expr/arrow, await prefix, yield/yield* prefix, generator functions, labeled statements; precedence table shifted (`??=2`, `??=4`, `||=5`, `&&=6`, etc.); `parseNewExpression` fixed to use `parseExpression(18)` |
| `src/browser/js/interpreter.ts` | `??=` in both `evalAssignment` paths; `LabeledStatement` execution; `eval()` native function; `AwaitExpression`/`YieldExpression` handlers; async wrapping via `wrapAsyncResult()` in `callFunction`/`evalCall`; generator flag in `execFuncDecl`/`evalFunctionExpr`; fixed break signal propagation in all loops/switch to only catch unlabeled breaks |
| `src/browser/js/ast.ts` | Added `AwaitExpression`, `YieldExpression` to `Expression` union + interface definitions |
| `src/browser/js/values.ts` | Added `generator: boolean` to `JSFunction` interface; updated `createFunction` and `createNativeFunction` signatures |
| `src/browser/js/promise.ts` | Added `wrapAsyncResult()` export for async function wrapping |
| `tests/js-engine.test.ts` | Added 24 new tests: optional chaining (8), nullish coalescing (10), labeled statements (3), eval (3); total 158 tests |

## Test Results
```
✓ tests/js-engine.test.ts (158 tests) — 133ms
   158 passed | 0 failed

Full suite: 89/90 test files pass | 3948/4004 tests pass
```

## Verification Steps
1. All 158 JS engine tests pass (134 existing + 24 new)
2. Class instantiation regression verified and fixed — `new Dog("Rex")` correctly parses
3. Full test suite: 89/90 files pass (1 pre-existing failure in crash-recovery-isolation)
4. TypeScript errors: 74 in JS files (all pre-existing, none from changes)
5. No new regressions introduced
