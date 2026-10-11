# JS Engine — Destructuring and Default Parameters Were Silently No-Ops

**Date:** 2026-09-14
**Session:** Swept the codebase for `TODO`/`FIXME`/"not implemented" markers looking for incomplete work to finish. `bytecode-compiler.ts` had two explicit TODOs — "default value in destructuring" and "full object destructuring" — inside a method that turned out to be unreachable from the parser's actual output, which led to three deeper, real bugs in the JS engine.
**Status:** Completed

---

## Summary
A page script using `var {a, b} = obj`, `var [a = 1] = arr`, `function f(a = 5) {}`, or `function f({a, b}) {}` silently produced wrong results — bound variables stayed `undefined` instead of throwing or working, so the failure was invisible until something downstream computed `NaN` or crashed on `undefined`. Fixed all four.

## Root Causes
1. **`compileDestructurePattern`'s two flagged TODOs** (array-element defaults, object patterns) were real gaps, but the method itself was only reachable through a declarator shape (`decl.id.type === 'AssignmentPattern'`) the parser never actually produces for `var pattern = expr` — so both TODOs were on effectively dead code. The parser's real shape for `var [a] = arr` / `var {a} = obj` is `decl.id.type === 'ArrayPattern' | 'ObjectPattern'` directly, which `compileVarDecl` had no branch for at all — that declarator was silently skipped, compiling to nothing.
2. **Function default parameter values were declared but never assigned.** `compileFunctionExpr`'s `AssignmentPattern` param branch called `declareLocal(...)` and stopped — it never read the passed argument, never evaluated the default expression, and never stored anything. `function f(a = 5) { return a; }` returned `undefined` whether called as `f()` or `f(9)`.
3. **Object/array-pattern function parameters (`function f({a,b})`) could never parse correctly at all.** `parser.ts`'s `parsePattern()` — used for every function parameter list — read the very first token as an identifier name unconditionally, so a `{` or `[` starting a parameter was mis-parsed as a garbage-named identifier rather than delegated to the existing `parseObjectPattern`/`parseArrayPattern`. The AST types (`ast.ts`) already declared `params` as allowing `ArrayPattern | ObjectPattern`, so this was a real, in-scope gap rather than an intentional omission — the parser just never finished it. (Fixing this also fixed a latent precedence bug: the identifier-default branch parsed the default expression at comma precedence, so `function f(a = 1, b)` would have swallowed `, b` into the default expression as a sequence.)
4. **The array-pattern loop had its own inline copy of the "bind an identifier" logic** instead of calling the shared `compileDestructurePattern` recursively, so it never got the top-level-global-scope handling added for fix #1 above — `var [a, c] = [1, 3]` bound `a` to a real local slot that nothing at program scope ever reads (top-level identifier reads always compile to `LOAD_GLOBAL`), so `a` read back as `undefined` even though the destructure ran.

## Notes
- **Rest parameters remain broken, left as-is.** `function f(...args)` only binds `args` to the *first* extra argument, not an array of all remaining ones — the VM's frame setup copies `args[i]` into `locals[i]` purely positionally, with no array construction for the rest slot. Fixing it needs a real runtime loop (there's no `slice`/`push` opcode to reach for) and touches the same param-binding path this session already changed twice; flagging it rather than bundling a third change into the same area. `ponytail:` comment left at the call site (`bytecode-compiler.ts`) naming the exact gap.
- **Rest elements inside destructuring patterns** (`[a, ...rest]`, `{a, ...rest}`) are also not implemented — same reason (needs a runtime remaining-elements loop). Left with `ponytail:` comments at both sites rather than silently dropped.
- Two doc comments in `layout-box.ts` and `paint-record.ts` (unrelated to the JS engine, found during the same TODO sweep) described z-index/stacking-context handling and float/absolute/flex/grid layout as future TODOs that were, in fact, already built in later sessions (`stacking-context.ts`, `positioning.ts`, `formatting/flex-context.ts`, `formatting/grid-context.ts`) — updated to point at where the real implementations live instead of claiming they don't exist.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/bytecode-compiler.ts` | Added `compileDefaultOr()` helper; implemented array-default and full object-pattern branches in `compileDestructurePattern`; added `ArrayPattern`/`ObjectPattern` branches to `compileVarDecl` and to function-param binding; fixed function default-parameter values to actually evaluate/bind; deduplicated the array-pattern identifier-binding path onto the shared (correctly scoped) method |
| `src/browser/js/parser.ts` | `parsePattern()` now delegates to `parseArrayPattern`/`parseObjectPattern` for `{`/`[`-led parameters instead of misreading them as identifiers; fixed default-value expression parsing to use assignment precedence instead of comma precedence |
| `src/browser/rendering/pipeline/layout-box.ts` | Updated stale doc comment (float/absolute/flex/grid no longer TODOs) |
| `src/browser/rendering/pipeline/paint-record.ts` | Updated stale doc comment (stacking contexts are applied, by `stacking-context.ts`) |
| `tests/bytecode-vm.test.ts` | Added 14 net-new tests: default parameters (missing/present/explicit-undefined/multi-param), object-destructuring params (plain + defaulted), and a `Destructuring` describe block covering array defaults, object patterns, renamed bindings, and nesting |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9230 tests passed (9216 baseline + 14 net new)
npx playwright test --config=playwright-electron.config.cjs       → 3/3 passed (electron-smoke, fidelity-audit, keep-alive)
```

## Verification Steps
1. Wrote scratch tests exercising each gap directly against the VM (`evalJSWithVM`) before touching any code, confirming the actual broken outputs first (`f(a=5){return a} f()` → `undefined`; `var {a,b}={a:1,b:2}; a+b` → `NaN`; `function f({a,b}){return a+b} f({a:1,b:2})` → `NaN`).
2. Fixed one root cause at a time, rerunning the scratch suite after each change — went from 4/13 passing to 17/17 passing across three separate fixes (dead declarator branch → global-scope binding mismatch → duplicated inline identifier logic → parser never handling pattern params).
3. Moved the scratch tests into `tests/bytecode-vm.test.ts`'s existing `Functions` describe block and a new `Destructuring` block, matching this file's existing helper conventions.
4. Ran the full unit suite and full Electron e2e suite (including the real-page-fidelity fixtures, which execute actual page scripts through this same compiler/parser) to confirm zero regressions.
