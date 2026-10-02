# Four Real Gaps Found Bisecting react.dev — Including Two Fundamental Destructuring Bugs

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Bisected `react.dev` after MDN/npmjs.com came back clean; its own dark-mode-detection script and a real Next.js chunk each surfaced a real bug, and root-causing the second one uncovered two more, much more fundamental bugs along the way.
**Status:** Completed (4 root causes fixed)

---

## Summary

Started from two concrete failures on `react.dev`: an inline script crashing on `window.matchMedia(...).matches`, and an external Next.js chunk failing to parse with `Expected Colon, got String`. The first was a straightforward missing API. Root-causing the second — a destructuring rename using the property key `as` (`let {as: r = "div"} = props`, a real React "polymorphic component" pattern) — led to discovering that `as` was an unused hard-keyword token, and *that* fix then exposed two much larger, previously-hidden bugs: `let`/`const` destructuring never actually bound its names (only `var` did), and `for...of` loops silently dropped a destructured loop variable entirely, in both cases regardless of whether `as` was involved at all.

## Root Causes

### 1. `window.matchMedia()` didn't exist
**File:** `src/browser/js/index.ts`, `src/browser/rendering/css5/{cascade,parser}.ts`
**Real trigger:** `window.matchMedia('(prefers-color-scheme: dark)').matches` — react.dev's own dark/light theme detection script.
**Problem:** No `matchMedia` binding existed anywhere in the JS environment, despite Nova's CSS engine already having full, real media-query parsing and evaluation logic for `@media` rules (width/height ranges, `prefers-color-scheme`, `prefers-reduced-motion`, and more) — it just wasn't exposed to JS at all.
**Fix:** Exported the CSS engine's existing `parseMediaQueries()` (string → AST) and `evaluateMediaQueries()` (AST → boolean) and used them directly to implement `window.matchMedia(query)`, returning a real object with `.media`, `.matches` (evaluated consistently with how a real stylesheet's `@media` rule would see the same query — not a separate, hand-rolled guess), and no-op-but-safe `addEventListener`/`addListener` (Nova has no live OS-preference-change or viewport-resize event source to ever fire a `change` event from, and the overwhelmingly common real-world usage only ever reads `.matches` once).

### 2. `as` was a hard keyword token with zero actual consumers
**File:** `src/browser/js/tokens.ts`
**Real trigger:** `let {as: r = "div"} = props` — a real React "polymorphic component" prop-renaming pattern (rename the `as` prop to a local `r`, defaulting to `"div"`), found in a Next.js chunk on react.dev.
**Problem:** `as` was tokenized as its own `TokenType.As`, presumably intended for `import { x as y }` renaming — but grepping the entire parser turned up *zero* references to `TokenType.As`, `TokenType.Import`, `TokenType.Export`, or `TokenType.From`: this parser doesn't implement static import/export declarations at all (it runs `<script>` tags, not ES modules; dynamic `import()` is a separate, already-working call-expression path). `as` is never a reserved word in real JS outside that one specifier context, so hard-keywording it broke every real use of `as` as a plain identifier, object key, or destructuring target — most visibly the exact pattern above, which choked destructuring-pattern parsing partway through and cascaded into an unrelated-looking "Expected Colon, got String" error much later in the file (the same "state corruption carried forward" shape as earlier gaps this session).
**Fix:** Removed `'as': TokenType.As` from the keyword table, so `as` now always lexes as a plain `Identifier` — matching real JS semantics exactly, since nothing in this parser ever gave the keyword form any meaning in the first place.

### 3. `let`/`const` destructuring never bound anything
**File:** `src/browser/js/interpreter.ts` (`execVarDecl`, new `collectPatternNames()`)
**Real trigger:** Found while verifying the `as` fix — `let {as: r = "div"} = props` still evaluated `r` to `undefined` even after the parse error was gone.
**Problem:** `execVarDecl`'s TDZ pre-declaration only ever ran `if (decl.id.type === 'Identifier')` — a plain `let x = ...` got pre-declared correctly, but a destructured `let {a, b} = obj` or `let [x, y] = arr` never pre-declared `a`, `b`, `x`, or `y` at all. `destructPattern`'s leaf case then called `env.initialize(name, value)` — which silently no-ops when no TDZ binding exists for that name yet. The result: **every** `let`/`const` destructuring pattern in Nova — object, array, nested, with defaults, with rest — bound none of its names to anything, silently, with no error. Only `var`-based destructuring worked, since `var`'s path uses `env.declare()` (create-or-overwrite), not the TDZ-gated `initialize()`.
**Fix:** Added `collectPatternNames()`, walking a (possibly nested) pattern to find every leaf identifier name, and changed `execVarDecl` to TDZ-predeclare *all* of them — not just a bare `Identifier` — before evaluating the initializer.

### 4. `for...of` silently dropped a destructured loop variable
**File:** `src/browser/js/interpreter.ts` (`execForOf`, new `assignPatternValues()`)
**Real trigger:** Found while writing regression coverage for root cause #3 — `for (let {a, b} of list)` never bound `a`/`b` inside the loop body, for *any* declaration kind (`var`, `let`, or `const`).
**Problem:** `execForOf` cast its loop variable straight to `AST.Identifier` and read `.name` unconditionally — the exact same "assumed every parameter/pattern is a bare identifier" bug this session's own comments describe already having been fixed once for function-parameter binding (`bindParams`). A pattern has no `.name` field, so this silently bound a variable literally named `undefined` on every iteration, leaving every real destructured name unbound for the whole loop body.
**Fix:** Reused `collectPatternNames()` to TDZ-predeclare `let`/`const` loop-pattern names once before the loop (matching the original code's up-front declare-and-initialize-to-undefined for the simple-identifier case), then added `assignPatternValues()` — a destructuring walker parallel to `destructPattern` but using real *assignment* (`env.set()`) instead of declare/initialize semantics, since `initialize()`'s one-shot TDZ guard would otherwise silently stop updating the loop variable after the first iteration. `var`-based loop patterns still go through `destructPattern` each iteration (safe, since `var`'s `declare()` path unconditionally overwrites with no TDZ gate).

## Notes

- Both destructuring bugs (#3 and #4) are real, general engine gaps — not edge cases, and not specific to `as` in any way. They were simply never exercised by any of the ~9,300 existing unit tests or 4 real-Electron e2e sweep cases until this investigation added the first one. Given how common `let {a, b} = props` and `for (const [k, v] of map)` are in real-world (especially React/modern) JavaScript, this is likely the highest-impact fix from this entire gap-filling thread.
- Found and explicitly **deferred** two more, smaller pre-existing gaps while verifying #3/#4, confirmed unrelated to these fixes (identical behavior with and without them): (a) a native (non-`JSError`-wrapped) `ReferenceError` thrown for a genuine TDZ violation (e.g. `let x = x;`) isn't catchable by a guest `try/catch` — the same "native throw escapes the sandbox" class of bug this session's `eval()` fix (2026-09-21) already named; (b) a bare `{ let x = 5; }` block doesn't actually restrict `x`'s visibility to the block — it leaks to the enclosing scope, for both destructured and plain `let`. Neither blocks this round's fixes; both are real, separate architectural gaps for a future round.
- Root cause #4's fix intentionally does *not* give each `for...of` iteration its own fresh `let` binding (the classic "closures inside a for-let-loop each capture their own iteration's value" JS behavior) — Nova's for-of already shared one `loopEnv` across all iterations before this fix, and correcting that is a separate, bigger change than what was reported broken here.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Added `window.matchMedia()`, backed by the CSS engine's real media-query parser/evaluator |
| `src/browser/rendering/css5/cascade.ts` | Exported `evaluateMediaQueries()` (previously module-private) |
| `src/browser/rendering/css5/parser.ts` | Exported `parseMediaQueries()` (previously module-private) |
| `src/browser/js/tokens.ts` | Removed `as` from the keyword table — lexes as a plain `Identifier` everywhere now |
| `src/browser/js/interpreter.ts` | Added `collectPatternNames()`; `execVarDecl` now TDZ-predeclares every leaf name in a `let`/`const` pattern, not just a bare `Identifier`; added `assignPatternValues()`; `execForOf` now destructures its real loop-variable pattern instead of assuming a plain identifier |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 4 new real-Electron regression checks (`as` as a plain identifier/key/rename, `let`/`const` destructuring across object/array/nested/rest/defaults, `for-of` with a destructured loop variable for `var`/`let`/`const`, `window.matchMedia()`) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed (0 failures — even the usually-flaky DNS tests passed this run)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
Real react.dev (before → after)                          → inline scripts: 0 runtime failures (was 1); the failing Next.js chunk (307KB) now parses with 0 errors
```

## Verification Steps

1. Bisected `react.dev` (after adding a request timeout to the bisection harness — an earlier run against a batch of sites hung indefinitely on an unresponsive connection with no timeout set) and found both the inline `matchMedia` crash and the external chunk's parse failure independently.
2. Implemented `matchMedia()` by reusing existing CSS engine internals rather than writing a second, parallel media-query evaluator; verified against 6 cases including the exact real trigger.
3. Root-caused the parse failure with the same `parseProperty()`-monkeypatch bisection technique from earlier GitHub-bisection work, tracing it to a destructuring pattern using `as` as a key; confirmed `TokenType.As` (and `Import`/`Export`/`From`) have zero consumers anywhere in the parser before removing the keyword mapping.
4. Verified the `as` fix, then noticed the "fixed" destructuring still produced the wrong *value* — traced this to `let`/`const`'s TDZ-only `initialize()` never being reachable for destructured leaf names, confirmed with a plain (non-`as`) key to rule out any remaining connection to the keyword fix.
5. Fixed the TDZ predeclaration gap; while writing broader regression coverage, found the identical symptom independently in `for...of` loops (any destructured loop variable, any declaration kind) and traced it to the loop's own separate, unrelated `.name`-casting bug.
6. Verified all four fixes together plus explicit regression checks for right-associative `let x = x = ...` chaining, self-reference TDZ throwing, nested/rest destructuring, and `var`/`let`/`const` for-of — surfacing the two deferred, unrelated gaps (native-throw catchability, block-scope leakage) along the way and confirming both are pre-existing and unaffected by these fixes.
7. Rebuilt, added 4 permanent e2e regression checks, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
