# Strict Mode Detection for Nova JS Engine

**Date:** 2026-07-26
**Session:** Add strict mode detection and enforcement to the JS engine
**Status:** Completed

---

## Summary

Implemented ES5 strict mode support in the Nova Browser's JavaScript engine: `'use strict'` directive detection, `this` binding semantics, `with` statement rejection, and duplicate parameter detection.

## Root Causes (if bug fix)

N/A — this is a feature addition.

## Implementation Details

### 1. Parser: `'use strict'` directive detection

Added `lookaheadStrictDirective()` helper that pre-scans the next tokens without consuming them to detect a `'use strict'` or `"use strict"` string literal directive at the start of a function body. Uses a `strictStack: boolean[]` to track whether the parser is inside a strict function, enabling the `with` statement guard during recursive body parsing.

- `parseFunctionDeclaration`: pushes strict mode to stack before parsing body, sets `strictMode` on AST node
- `parseFunctionExpression`: same pattern
- `parseArrowFunctionFromParams`: detects strict from block body when present
- `parseClassBody`: all class method bodies push `true` (class bodies are always strict per spec)

### 2. Parser: `with` statement guard

Added `parseWithStatement()` method that throws a `SyntaxError` when a `with` statement is encountered inside a strict mode function (checked via `strictStack`). Added `WithStatement` AST node type and `With` case to the statement parser.

### 3. Values: `isStrict` on JSFunction

- Added `isStrict?: boolean` field to the `JSFunction` interface
- Added `isStrict` parameter to `createFunction()` (default `false`)
- `createFunction()` now validates duplicate parameter names in strict mode, throwing `SyntaxError`

### 4. Interpreter: strict mode enforcement

- `execFuncDecl`: passes `stmt.strictMode` to `createFunction`
- `execClassDecl`: all class methods pass `isStrict = true`; default derived constructor also strict
- `evalFunctionExpr`: passes `expr.strictMode` to `createFunction`
- `evalArrowFunction`: detects strict directive from block body via `hasStrictDirective()` helper
- `callFunction` (bridge): non-strict functions called without receiver get global `this`; strict functions keep `undefined`
- `evalCall`: same `this` binding logic for inline function calls

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/ast.ts` | Added `strictMode?: boolean` to `FunctionDeclaration` and `FunctionExpression`; added `WithStatement` interface; added `WithStatement` to `Statement` union |
| `src/browser/js/values.ts` | Added `isStrict?: boolean` to `JSFunction`; added `isStrict` param to `createFunction()`; duplicate param validation |
| `src/browser/js/parser.ts` | Added `strictStack`, `lookaheadStrictDirective()`, `parseWithStatement()`; strict mode push/pop in function and class body parsing; `With` case in `parseStatement` |
| `src/browser/js/interpreter.ts` | `isStrict` propagation in all function creation sites; `this` binding for strict/non-strict; `hasStrictDirective()` helper; strict class methods and default constructor |

## Test Results

```
158 passed (all existing js-engine.test.ts tests pass)
```

## Verification Steps

1. Ran `npx vitest run tests/js-engine.test.ts` — all 158 existing tests pass
2. Verified no new TypeScript errors introduced in modified files (all errors in tsc output are pre-existing)
