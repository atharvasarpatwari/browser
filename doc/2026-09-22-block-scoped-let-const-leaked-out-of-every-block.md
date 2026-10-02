# `let`/`const` Leaked Out of Every Bare, `if`, `while`, and `do-while` Block

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Picked up the last remaining gap deferred from earlier the same day: a bare `{ let x = 5; }` block didn't restrict `x`'s visibility to the block. Investigating showed the same problem affects every block reached through plain statement execution, not just standalone blocks.
**Status:** Completed (1 root cause fixed)

---

## Summary

`exec()`'s `BlockStatement` case passed the caller's own `Environment` straight into `execBlock()` instead of a fresh child scope. Since `if`, `while`, and `do-while` all execute their body via this same generic `exec()` dispatch, *every* block reachable that way — a bare `{ }`, an `if` consequent/alternate, a loop body — wrote its `let`/`const`/`class` bindings directly into the enclosing scope instead of its own. They leaked out and stayed visible after the block ended, for any block shape except a `for`/`for-in`/`for-of` body (those already got an incidental scope from the loop's own pre-existing per-loop `Environment`, created for the loop variable — not a deliberate fix, just a side effect that happened to mask this bug there).

## Root Cause

**File:** `src/browser/js/interpreter.ts` (`exec()`, `BlockStatement` case), `src/browser/js/index.ts` (`createGlobalEnv()`)
**Real trigger:** `if (cond) { let result = compute(); ... } // result now visible after the if, in the enclosing scope` — a correctness gap that would silently confuse any code relying on real block scoping.
**Problem:** `case 'BlockStatement': return this.execBlock(stmt.body, env);` — no new `Environment` was ever created for the block itself. `execBlock()`'s own TDZ pre-declaration (`hoistLetConst`) and `destructPattern`'s `env.initialize()` calls all operate on whatever `env` they're handed, so without a dedicated child scope, a block's `let`/`const` bindings landed in the same scope as code *outside* the block.
**Fix:** `case 'BlockStatement': return this.execBlock(stmt.body, new Environment(env));` — every block now gets its own real child scope, fixing bare blocks, `if`/`else` bodies, and `while`/`do-while` bodies uniformly through the one shared dispatch point, rather than needing a separate fix in each caller.
**A second, exposed-not-introduced bug this surfaced:** giving every block a real scope meant `var`'s function-scope-hoisting walk (`Environment.declare()`, which walks up looking for the nearest scope marked via `markFunctionScope()`) needed an actual function-scope boundary to walk up *to*. The real global environment returned by `index.ts`'s `createGlobalEnv()` was never marked this way — harmless before this fix, since a top-level `var` inside a block had nowhere else to land anyway (the block shared the enclosing scope outright), but with blocks now genuinely scoped, an unmarked root would have wrongly trapped a `var` inside whatever block it was declared in instead of hoisting it all the way out. Fixed by calling `env.markFunctionScope()` on the root environment, matching every other function scope in this engine.

## Notes

- Verified `for`, `for-in`, and `for-of` loop bodies were already correctly scoped (via their own pre-existing per-loop `Environment`) and remain so — this fix doesn't touch those paths at all.
- Verified `var` still correctly hoists out of *any* number of nested blocks to the true enclosing function/global scope after this fix, and that a block can still read and mutate outer-scope variables normally (only *new* `let`/`const`/`class` declarations are scoped to the block, matching real JS).
- One related, pre-existing, and *not newly introduced* limitation observed while verifying: `class Foo {}` declared inside a block still isn't block-scoped — it hoists out like `var`. This traces to `execClassDecl` already treating class declarations as `'var'`-kind (a simplification this codebase already made and documented, not something this fix changes the outcome of — a class leaked out of a block identically before this fix too, just via the "no scope at all" mechanism instead of the "class uses var-hoisting" mechanism). Left as-is; a real fix would need class declarations to use `let`-like TDZ semantics instead.
- This closes out the second and final gap deferred from the same-day react.dev-bisection round.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | `exec()`'s `BlockStatement` case now creates a fresh child `Environment` before running the block, instead of reusing the caller's own scope |
| `src/browser/js/index.ts` | `createGlobalEnv()` now calls `env.markFunctionScope()` on the root environment, so `var` still correctly hoists out through the newly-real block scopes above |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check (bare/`if`/`while`/`do-while` block scoping for `let`, plus `var` still hoisting correctly out of a block) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Confirmed the reported gap (`{ let x = 5; } var out = typeof x;` giving `'number'` instead of `'undefined'`) and, before assuming it was isolated to bare blocks, tested `if`/`while` bodies too — found the identical leak in all of them, tracing all three to the same shared `exec()` dispatch point.
2. Applied the single centralized fix (a new child `Environment` in `BlockStatement`'s case) and re-ran the same checks — immediately found a `var`-hoisting regression this exposed (a `var` inside any block became trapped in that block's new scope instead of hoisting out).
3. Root-caused the `var` regression to the global environment never being marked as a function-scope boundary — harmless before this fix (nothing to walk past), a real problem once blocks got genuine scopes. Fixed by marking it, matching every other function scope in the engine.
4. Re-verified the full matrix: bare/`if`/`while`/`do-while` blocks no longer leak `let`; `var` still hoists correctly through nested blocks; a block can still read/mutate outer variables; `for`/`for-of` bodies (already correctly scoped beforehand) are unaffected; and — found while double-checking, confirmed pre-existing and unaffected either way — a class declared inside a block still isn't block-scoped, due to the separate, already-documented "classes use var-kind hoisting" simplification.
5. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions — a meaningful check given this change touches the block-execution path shared by essentially every control-flow construct in the engine.
