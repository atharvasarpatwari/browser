# Nova JS Interpreter — Real async/await and Generators — Plan

**Date:** 2026-10-26
**Session:** "keep improving the nova app…". Found during the 1.30 Round C work.
**Status:** Rounds 1–2 done in 1.31 (async functions, generators); round 3 (async generators, for await) planned

---

## Problem (probed with `runJS`)
| Script | Nova | A browser |
|--------|------|-----------|
| `async function f(){ const r = await fetchSomething(); render(r); return 1 }` (pending promise) | `render` never runs; `f()` resolves to the awaited value, not `1` | runs `render(r)`, resolves to `1` |
| `function* g(){ yield 1; yield 2 } [...g()]` | `g()` runs the whole body at once and returns `undefined` | `[1, 2]` |
| `const it = g(); it.next()` | throws (no generator object) | `{ value: 1, done: false }` |

Modern sites ship native `async` functions, so the first row stops their start-up code at the first `await fetch(…)`. Generators are rarer (mostly inside transpiled async code and some libraries).

## Root causes (code)
| # | Where | What |
|---|-------|------|
| 1 | `src/browser/js/interpreter.ts` `evalAwait` | On a pending promise it throws an `AwaitSignal` that unwinds the JS call stack. |
| 2 | `interpreter.ts` `handleAsyncAwait` | It cannot resume, so it resolves the function's promise with the awaited value; the code after `await` is lost. The comment there says so ("we can't easily do that"). |
| 3 | `interpreter.ts` `evalYield` | Returns its argument. No generator object exists; `fn.generator` is set but never used. |
| 4 | `src/browser/js/vm.ts` `OP.AWAIT` / `OP.YIELD` | The bytecode VM has the same pass-through behaviour. |

## Approach: a resumable executor for async/generator bodies only
A tree-walking interpreter can't suspend its host stack. The plan adds a second, resumable evaluator written as host generator functions (`*execR`, `*evalR`), used only for the body of an `async` or `function*` function:

- **Delegate when possible.** A node with no `await`/`yield` inside it (precomputed once per function by an AST scan that stops at nested functions) goes straight to the existing fast `exec`/`evalExpr`. Only the statements and expressions on the path to an `await`/`yield` need resumable versions.
- **Statements to cover:**
  - block, expression, variable declaration, return, if;
  - while, do-while, for, for-in, for-of (with the existing label and per-iteration-binding logic);
  - try/catch/finally, switch, labeled.
- **Expressions to cover:**
  - `await` / `yield` / `yield*` themselves;
  - assignment, call and new arguments, member, binary, unary;
  - logical / conditional (short-circuit preserved);
  - template, array, object, sequence, spread.
- **Drivers:**
  - An async function runs its host generator until it yields an awaited value. It then chains `.then` on that promise to resume with the value, or throws the reason into the generator. Its result promise resolves with the return value.
  - A generator function returns a generator object: `next(v)`, `return(v)` and `throw(e)`, plus `[Symbol.iterator]` returning itself, so `iterateJS` (1.30) handles it with no change.
  - Async generators and `for await` come last.

## Rounds
1. **Async functions.** `await` anywhere in statements and expressions. Acceptance: an `await fetch()` start-up flow runs its rest, and the promise resolves with the return value.
2. **Generators.** `function*`, `yield`, `yield*`, `next/return/throw`, and spread / for-of over a generator.
3. **Async generators and `for await…of`.**

## Risks
- **Every async function now really resumes.** Code that was silently skipped after the first pending `await` will run, and can surface the next missing API. The 1.30 baseline audit lowered this risk; re-run the saved real-site fixtures (Wikipedia, Google challenge) after each round.
- **Speed.** Host generators are slower than direct recursion. Delegating `await`-free subtrees keeps that cost to the nodes on the path to an `await`.
