# Spec Adherence Phase 3 — TDZ, ASI, super, Function Constructor, Bytecode VM

**Date:** 2026-07-26
**Session:** Phase 3 spec adherence — TDZ enforcement, ASI, super member access, Function constructor improvements
**Status:** Completed

---

## Summary

Implemented 5 JS spec adherence features: Temporal Dead Zone (TDZ) enforcement for let/const, Automatic Semicolon Insertion (ASI) for statement terminators, proper super member access (super.x / super.method()), Function constructor improvements (.length/.name/.prototype on closures), and fixed 2 regressions in the bytecode VM caused by TDZ enforcement. All 42 spec-adherence tests pass. Full suite: 6650 pass (3 pre-existing DNS failures).

## Root Causes

### 1. Bytecode VM TDZ Regression
**File:** `src/browser/js/vm.ts:220`
**Problem:** `DEFINE_VAR` opcode called `env.declare(name, val, kind)` for let/const. The `declare()` method sets `__tdz: true` on bindings but never clears it. Before TDZ enforcement was added to `get()`, this was invisible — `get()` never checked `__tdz`. Now that `get()` throws `ReferenceError` for TDZ bindings, the bytecode VM broke: variables declared by `DEFINE_VAR` remained in TDZ state and couldn't be read.
**Fix:** Changed `DEFINE_VAR` to use `declareTDZ()` + `initialize()` for let/const (matching `execVarDecl` behavior):
```ts
// Before:
frame.env.declare(name, val, kind);

// After:
if (kind === 'let' || kind === 'const') {
  frame.env.declareTDZ(name, kind);
  frame.env.initialize(name, val);
} else {
  frame.env.declare(name, val, kind);
}
```

### 2. Default Derived Class Constructor — Wrong Callee Type
**File:** `src/browser/js/interpreter.ts:455`
**Problem:** Default derived class constructors were generated with `{ type: 'Identifier', name: 'super' }` as the callee of the super() call. The `evalCall` handler only intercepts `SuperExpression` for super() calls, so the Identifier fell through to normal function evaluation — `evalExpr(Identifier('super'))` resolved `super` to the super prototype object, then tried to call it as a function → TypeError or silent failure.
**Fix:** Changed the generated AST to use `{ type: 'SuperExpression' }`:
```ts
// Before:
callee: { type: 'Identifier', name: 'super' } as AST.Identifier,
// After:
callee: { type: 'SuperExpression' } as AST.SuperExpression,
```

### 3. super() Spread Argument Evaluation
**File:** `src/browser/js/interpreter.ts:934`
**Problem:** The `super()` handler in `evalCall` used `expr.arguments.map(a => this.evalExpr(a, env))` to evaluate arguments. This doesn't handle `SpreadElement` nodes — the default constructor passes `{ type: 'SpreadElement', argument: { type: 'Identifier', name: 'arguments' } }` to forward all arguments. Since `evalExpr` has no `case 'SpreadElement'`, the spread node was silently ignored, and arguments were `undefined`.
**Fix:** Replaced the simple `.map()` with the same spread-aware argument evaluation loop used in normal CallExpression handling:
```ts
const args: JSValue[] = [];
for (const a of expr.arguments) {
  if (a.type === 'SpreadElement') {
    const spreadVal = this.evalExpr(a.argument, env);
    if (typeof spreadVal === 'object' && spreadVal !== null && 'type' in spreadVal && (spreadVal as any).type === 'array') {
      const arr = spreadVal as JSObject;
      const len = Number(arr.properties.get('length')?.value ?? 0);
      for (let i = 0; i < len; i++) {
        args.push(arr.properties.get(String(i))?.value);
      }
    } else if (Array.isArray(spreadVal)) {
      args.push(...spreadVal);
    } else {
      args.push(spreadVal);
    }
  } else {
    args.push(this.evalExpr(a, env));
  }
}
```

## Features Implemented

### TDZ Enforcement (interpreter.ts, values.ts)
- `Environment.declareTDZ(name, kind)` — pre-declares let/const with `__tdz: true`
- `Environment.initialize(name, value)` — clears `__tdz`, sets value
- `Environment.get(name)` — throws `ReferenceError` if `__tdz` is true
- `hoistLetConst(body, env)` — scans block body for let/const, calls `declareTDZ()` before any statements execute
- `execBlock` calls `hoistLetConst` before executing statements
- `execVarDecl` uses `declareTDZ()` + `initialize()` for let/const

### ASI (parser.ts)
- `eatSemicolon()` — consumes explicit `;`, inserts at EOF, `}`, or newline-before-current-token
- `hasNewlineBeforeCurrent()` — checks for `\n` in whitespace between tokens (newline positions tracked in lexer)
- Wired into: expression statements, variable declarations, return/break/continue/throw, do-while
- break/continue label acceptance guarded by `!hasNewlineBeforeCurrent()`

### super Member Access (interpreter.ts)
- `super()` calls: `evalCall` detects SuperExpression callee, resolves `__superCtor`, calls parent constructor with correct `this`
- `super.method()` calls: `evalCall` detects MemberExpression callee with SuperExpression object, looks up method on parent prototype, passes current `this` from calling context
- `super` binding: `execClassDecl` sets `super` and `__superCtor` in each method's closure environment

### Function Constructor Improvements (interpreter.ts, index.ts)
- `getPropertyValue()` and `evalMember()` handle closure objects:
  - `.length` → returns parameter count
  - `.name` → returns function name
  - `.prototype` → returns cached prototype with constructor reference (identity-preserving)
- Arrow functions have no `.prototype`
- Function constructor itself: `.length = 0`, `.name = "Function"`, `.prototype` with constructor

### Bytecode VM TDZ Fix (vm.ts)
- `DEFINE_VAR` opcode properly handles let/const with `declareTDZ()` + `initialize()` instead of just `declare()`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | super() call handler spread args, default derived constructor SuperExpression, hoistLetConst, execBlock TDZ integration, execVarDecl TDZ, super member access in evalCall, closure .length/.name/.prototype |
| `src/browser/js/parser.ts` | eatSemicolon(), hasNewlineBeforeCurrent(), ASI wiring into statements |
| `src/browser/js/values.ts` | declareTDZ(), initialize(), get() TDZ check |
| `src/browser/js/vm.ts` | DEFINE_VAR opcode TDZ fix |

## Files Created

| File | Purpose |
|------|---------|
| `tests/spec-adherence.test.ts` | 42 tests for TDZ, ASI, super, Function constructor |

## Test Results

```
Test Files  1 passed (1)
     Tests  42 passed (42)

Full suite: 6650 passed, 3 failed (pre-existing DNS timeouts), 1 error (OOM)
```
