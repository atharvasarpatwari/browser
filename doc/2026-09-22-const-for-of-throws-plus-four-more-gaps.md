# `for (const x of/in ...)` Always Threw, Plus 4 More Gaps From a Fresh Bisection

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Bisected vuejs.org, reddit.com, nytimes.com, figma.com, notion.so, and tailwindcss.com for real JS engine failures. reddit.com came back clean; nytimes.com's and notion.so's leads were testing-harness artifacts (a DataDome anti-bot challenge page, and cross-script global state not persisting in the isolated per-script bisection harness — real page loads share one environment across all their scripts, so this doesn't affect real Nova behavior). The rest turned up five real, distinct root causes, the most impactful being a crash on one of the most common for-loop shapes in real JavaScript.
**Status:** Completed (5 root causes fixed)

---

## Summary

Five unrelated real gaps, found across figma.com, tailwindcss.com, and vuejs.org:

1. **`for (const x of arr)` / `for (const k in obj)` threw "Assignment to constant variable" on the very first iteration.** This is one of the most common for-loop shapes in real-world JavaScript, and it was completely broken.
2. **`for await (x of iterable)` failed to parse at all** ("Expected LParen, got Await").
3. **A regex literal as the first statement of an `if`/`while`/`for`/`switch` body was silently mis-parsed as division**, garbling every token after it.
4. **A destructuring pattern with a non-identifier string key and a default value** (e.g. `{"aria-hidden": h = true}`) failed to parse.
5. **`document.currentScript`** was never implemented at all.

## Root Causes

### 1. `for (const x of/in ...)` throws on the first iteration

**Files:** `src/browser/js/interpreter.ts` (`execForOf`, `execForIn`)
**Real trigger:** `for (const x of [1,2,3]) out.push(x);` — completely ordinary code.
**Problem:** Both loops declared and TDZ-initialized the loop variable **once**, before the loop started, then updated it every iteration via a plain assignment (`assignPatternValues`/`loopEnv.set()`). `Environment.set()` unconditionally throws `TypeError: Assignment to constant variable` for any `const` binding, regardless of TDZ state — so the very first iteration's "assignment" threw immediately.
**Fix:** For `let`/`const`, both loops now create a **fresh `Environment` per iteration** and declare+initialize the loop variable's real value directly into it (via `declareTDZ` + `destructPattern`/`initialize`, which never calls `set()`). `var` and a bare pre-existing identifier target are unaffected — they still correctly share one environment across iterations (via `env.declare(..., 'var')` for hoisting, or `env.set()` to reach the existing outer binding). This also fixes a real spec-correctness bug this exposed: a closure captured inside a `let`-based for-of/for-in body previously closed over one shared, mutated binding (so every closure saw the *last* iteration's value); now each one correctly closes over its own iteration's value. It additionally fixed `for (var k in obj)` never hoisting `k` out of the loop (it was being incorrectly TDZ-declared into the loop's own scope for `var` too).

### 2. `for await (x of iterable)` doesn't parse

**Files:** `src/browser/js/parser.ts` (`parseForStatement`), `src/browser/js/interpreter.ts` (`execForOf`, `evalAwait`)
**Real trigger:** `for await (let e of t) r = e;` (real Next.js/tailwindcss.com bundle code, async iteration over a readable-stream-like source).
**Problem:** The parser never looked for an `await` token after `for`, so `for await (` immediately failed expecting `(` right after `for`. The AST already had an unused `await: false` field on `ForOfStatement` from an earlier round, but nothing ever set it to `true`.
**Fix:** Parser now consumes an optional `Await` token right after `for` and threads it through as `await: isAwait`. `execForOf` now unwraps each drained value through the same fulfilled/rejected/pending-promise logic `await expr` already used (extracted into a shared `awaitValue()` helper) when `stmt.await` is true — a plain (non-Promise) value passes through unchanged, matching real `for await`'s behavior over a sync iterable of plain values.

### 3. A regex literal right after `if(cond)`/`while(cond)`/`for(...)` was silently mis-parsed as division

**Files:** `src/browser/js/lexer.ts` (`isRegexContext`, paren scanning)
**Real trigger:** `for(let e in n)/^(on(?:Click|Pointer|Mouse|Key)(?:Down|Up|Press)?)$/.test(e)&&(n[e]=1);` (real tailwindcss.com/figma.com minified event-prop-forwarding code).
**Problem:** `isRegexContext()` decides whether a `/` starts a regex literal purely from `lastTokenType`, and `RParen` was never in the regex-allowed list — so `/` right after **any** `)` was lexed as division. That's correct for `(a+b)/c`, but wrong for `if(cond)/regex/` — closing a control-flow header always means a *statement* follows, where a leading `/` can only be a regex (there's no left operand for division to act on). This didn't throw for simple regex bodies; it silently produced a garbled, wrong AST (confirmed by dumping it) — the more complex real-world pattern happened to garble far enough to hit an actual parse error, which is what surfaced it.
**Fix:** The lexer now tracks, per open paren, whether it's a control-header paren (`if`/`while`/`for`/`switch`/`catch`, based on the token immediately before the `(`) via a small stack. `isRegexContext()` now returns `true` for `RParen` only when the paren it closed was a control-header paren — so `if(cond)/regex/` is now regex, while `(a+b)/c` and `f()/2` are still correctly division (nothing changes for those, since their `)` never closed a control header).

### 4. A destructuring pattern's string-keyed property never checked for a default value

**Files:** `src/browser/js/parser.ts` (`parseObjectPattern`)
**Real trigger:** `let {icon:e, "aria-hidden":h=!0, ...g} = t;` (real minified Figma icon-component code — renaming a non-identifier-safe key like `"aria-hidden"` to a valid binding name, with a default).
**Problem:** `parseObjectPattern()`'s branch for computed (`[expr]:`) and non-identifier-literal (`"key":`/`123:`) property keys parsed the key, the colon, and the binding — then immediately pushed the property, never checking for a trailing `= default`. Only the identifier-key branch had that check. Any default value following one of those two key shapes broke parsing.
**Fix:** Both branches now check for `Equal` after parsing the binding and wrap it in an `AssignmentPattern`, exactly mirroring the identifier-key branch.

### 5. `document.currentScript` was never implemented

**Files:** `src/browser/js/dom-bindings.ts` (`createDocumentBinding`), `src/browser/engine/page-renderer.ts` (`executeAllScripts`)
**Real trigger:** `var fathomScript = document.currentScript || document.querySelector(...); var siteId = fathomScript.getAttribute("data-site");` (real Fathom Analytics embed script, used on vuejs.org) — `document.currentScript` was `undefined` (the property didn't exist at all), and in an isolated single-script bisection harness the `querySelector` fallback also found nothing (no real `<script>` element in the DOM), so `fathomScript` was `null` and `.getAttribute` crashed.
**Fix:** `createDocumentBinding()` now has a plain, mutable `currentScript` property (default `null`). `executeAllScripts()` — the real page-load script orchestrator — sets it to the currently-executing `<script>` element (via the existing `wrapElement()`) immediately before each of its three script-execution calls (blocking, defer, async) and resets it to `null` immediately after, since `runJS()` is synchronous and only one script ever executes at a time.

## Notes

- reddit.com's and figma.com's `_next`/Netlify bundle chunks produced hundreds of "Cannot read properties of undefined (reading 'push')" / "(reading 'bind')" runtime failures in the bisection sweep — these are webpack/Next.js chunk-loader fragments (`(self.webpackChunk=...||[]).push(...)`) that depend on a shared global initialized by an *earlier* script on the same page. The bisection harness runs each script in total isolation (fresh environment per script) for speed, so these are expected harness artifacts, not real Nova bugs — a real page load shares one environment across all its scripts (confirmed: `page-renderer.ts`'s `executeAllScripts` builds exactly one `globalEnv` for the whole page).
- nytimes.com returned a DataDome anti-bot challenge page (HTTP 403, 771 bytes), not real site content — its one runtime failure was the challenge script reading a `dd.host` global that a separate inline script (run in isolation, per the harness limitation above) never populated. Not pursued further, consistent with this session's established precedent of not chasing anti-bot/fingerprinting scripts.
- notion.so's two leads were the same class of harness cross-script-isolation artifact as figma.com/tailwindcss.com's chunk-loader failures.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/interpreter.ts` | `execForOf`/`execForIn` give `let`/`const` a real fresh per-iteration `Environment` instead of reusing one shared binding; `for await` unwraps each value via a new shared `awaitValue()` helper (extracted from `evalAwait`) |
| `src/browser/js/parser.ts` | `parseForStatement` accepts an optional `await` after `for`; `parseObjectPattern`'s computed-key and string/number-literal-key branches now check for a trailing default value |
| `src/browser/js/lexer.ts` | Paren-tracking stack marks control-header parens; `isRegexContext()` treats `/` right after a control-header's closing `)` as regex-context |
| `src/browser/js/dom-bindings.ts` | `createDocumentBinding()` adds a mutable `currentScript` property, default `null` |
| `src/browser/engine/page-renderer.ts` | `executeAllScripts()` sets/resets `document.currentScript` around each of its three script-execution loops |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 5 new real-Electron regression checks |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Bisected vuejs.org, reddit.com, nytimes.com, figma.com, notion.so, and tailwindcss.com via a fresh multi-site harness (each `<script>`, inline or external, run in isolation through Nova's real Lexer/Parser/`runJS()`), capped at 15 external scripts per site.
2. For each lead, confirmed real-world validity independently before touching code: `node --check` for the destructuring-default and for-await snippets, and direct token/AST dumps of Nova's own lexer/parser output for the regex-vs-divide bug (which doesn't throw on its own — confirmed by inspecting the actual mis-parsed AST, not just checking for a thrown exception).
3. For the `const` for-of/for-in crash: reduced to a minimal repro (`for (const x of [1,2,3])`), confirmed it throws via the real public `runJS()` entry point (not just raw interpreter wiring), then traced to `Environment.set()`'s unconditional `const`-write rejection being hit by the loop's per-iteration "assignment".
4. Fixed each independently; verified with targeted repro scripts covering: destructured object/array/nested/default/rest loop variables, `break`/`continue`/`return` inside the loop body, nested loops, `var`/bare-identifier-target loops (confirming these still correctly share one environment and still hoist), and the `let`-closure-capture-per-iteration correctness improvement — all passing before any e2e run.
5. Added 5 permanent e2e regression checks, rebuilt (`npm run build:web`), and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
6. Cleaned up all temporary bisection/repro scripts.
