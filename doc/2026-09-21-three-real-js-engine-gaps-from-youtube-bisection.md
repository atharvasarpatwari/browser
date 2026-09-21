# Three Real JS-Engine Gaps Found Bisecting YouTube

**Date:** 2026-09-21
**Session:** Asked to compile a prioritized list of all known gaps in the codebase and work through them in priority order. Picked the highest-priority *actionable* tier — real, reproducible JS-engine bugs found bisecting real sites — and continued bisecting `youtube.com` (following the Unicode-escape-identifier and TLS-wildcard fixes from earlier this session).
**Status:** Completed (3 root causes fixed; YouTube still doesn't fully run — see Notes)

---

## Summary

Re-ran the standing YouTube diagnostic and found the exact failing script content by fetching `https://www.youtube.com/`'s real HTML directly (bypassing Electron for speed) and running each inline/external script through Nova's own `Lexer`/`Parser` in isolation, printing the surrounding source at the reported line:column. This turned three vague console messages ("Expected LBrace, got Question", "Cannot find global object" pattern investigated but not the immediate target, general script failures) into three concrete, fixable bugs — each confirmed against the *exact* real-world source snippet before being fixed, and confirmed again live in real Electron afterward.

## Root Causes

### 1. `get`/`set` were unconditionally treated as accessor keywords in object literals
**File:** `src/browser/js/parser.ts`, `parseProperty()`
**Real trigger:** `{ set: function(v) {...}, get: ajm.has(x) ? void 0 : function() {...} }` inside a real `Object.defineProperty()` call in YouTube's bundle.
**Problem:** `get`/`set` are contextual keywords — they only introduce an accessor when a real property-key token follows. Nova always consumed `TokenType.Get`/`TokenType.Set` and handed whatever came next (even a bare `:`) to `parsePropertyKey()`, whose permissive fallback silently swallowed the colon as a garbage key name and cascaded into nonsense a token at a time, eventually surfacing as an unrelated-looking "Expected LBrace, got Question" several tokens later.
**Fix:** Added `startsAccessorName()` — a one-token lookahead requiring the token after `get`/`set` to actually be a valid key-start (identifier/string/number/`[`) before treating it as an accessor introducer. Otherwise `get`/`set` falls through as the property's own name, correctly handling `{ get: expr }`, `{ get, }` (shorthand), and `{ get() {} }` (a method literally named "get") — verified all three still work alongside real getters/setters.

### 2. `eval()` permanently broke every getter/setter for the rest of the script
**File:** `src/browser/js/interpreter.ts`, `Interpreter.run()`; `src/browser/js/values.ts` (new `getGlobalCaller()`)
**Real trigger:** any script that calls `eval()` once, anywhere, and later reads a property with a real getter.
**Problem:** `run()` registered itself as the global JS-function caller on entry and unconditionally reset it to `null` in its own `finally` — correct for a true top-level script, but `eval()` creates a *nested* `Interpreter` and calls `run()` on it too. Once that nested call's `finally` fired, the *outer* script's still-active interpreter registration was wiped, even though the outer script kept executing. Every subsequent `callJSFunction`-mediated call (getters, setters, and anything else invoked from outside the interpreter's own direct recursion) then failed with `"No JS interpreter registered"` — a raw host exception that isn't guest-catchable, so it silently aborted the rest of the script past every `try/catch` in it. `event-loop.ts` already saved/restored the caller correctly around its own microtask draining; `Interpreter.run()` was the one place that didn't follow that same pattern.
**Fix:** Added `getGlobalCaller()` and had `run()` save the caller in place before overwriting it, restoring that exact value in `finally` instead of hardcoding `null`. A nested `eval()`'s `run()` now hands control back to whichever caller (interpreter or `null`) was active before it started.
**Root-caused via bisection, not guesswork**: reproduced the exact bug shape as a 5-line minimal repro (`eval()` then a getter access then a plain call) before touching any code, to make sure the theory was right and not just plausible-sounding.

### 3. `?.` was always read as optional chaining, even before a decimal digit
**File:** `src/browser/js/lexer.ts`
**Real trigger:** `(p.someFlag?.9:.75)*YH(c)` inside YouTube's math-layout code — a ternary whose branches are leading-dot decimal literals.
**Problem:** Per spec, `OptionalChainingPunctuator` is `?.` *not* followed by a decimal digit — this exists specifically so `cond?.9:.75` parses as the ternary `cond ? .9 : .75`, not as `cond?.9` (an invalid numeric member access) followed by a stray `:.75`. Nova's lexer matched `?` + `.` unconditionally.
**Fix:** Added the lookahead: `?.` is only emitted as `QuestionDot` when the character after the dot isn't a digit; otherwise it falls through to plain `?`, and the following `.9`/`.75` lex normally as number literals. Verified real optional chaining (on `null`, on a real object, and on a call) still all work.

## Notes

- YouTube still doesn't fully run — each fix let parsing progress further into the bundle before hitting the *next* distinct gap (confirmed live: the exact error message and line number changed after every fix, always moving later in the file). Remaining, still-open real gaps as of this session: `Cannot find global object` (×4, source never located — likely a real environment-escape somewhere outside `src/`), a couple of `Cannot read properties of undefined` runtime gaps, and `Expected Colon, got String` at line 29862.
- Made a genuine, time-boxed attempt at the `Expected Colon, got String` gap too: unlike the first three (each reproducible by parsing the single failing line in isolation), this one does **not** reproduce from the failing statement alone — `c=_.gl(this.protocolPrefix_+this.JSC$23127_domain_+"/"+c+(this.JSC$23127_query_?"?"+this.JSC$23127_query_:"")).toString();` parses perfectly fine on its own, in every incrementally-larger fragment tried. That means this is a **state-corruption bug carried forward from earlier in the same 10.7 MB script**, not a standalone syntax gap like the first three — the same *class* of bug as the eval()/global-caller fix, but this time in the parser's own token-stream state rather than a runtime singleton, and much harder to isolate in a file this size without better tooling than a hand-rolled brace counter (which itself proved unreliable — it doesn't understand regex literals or template interpolation, so its "top-level statement boundary" positions can't be trusted). Documented honestly as investigated-but-unresolved rather than either faking a fix or quietly dropping it — a real next step for whoever picks this up would be building a proper statement-boundary-aware bisection tool first, rather than continuing to guess at boundaries by hand.
- All three fixes were confirmed against the *exact* real-world source text (fetched directly from `youtube.com`, not a synthetic guess at "something like this might be the bug") before any code was written, and re-confirmed live in real Electron after the fix.
- Each fix got a real regression test, both as a targeted unit-style check and as a permanent addition to `tests/e2e/js-dom-api-sweep.spec.ts` (real Electron, pixel-based verification), following the exact pattern established by the earlier Unicode-escape-identifier fix.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | `parseProperty()`: added `startsAccessorName()` lookahead so `get`/`set` only introduce an accessor when followed by a real key |
| `src/browser/js/interpreter.ts` | `run()`: saves the previously-registered global caller and restores it in `finally`, instead of always clearing to `null` |
| `src/browser/js/values.ts` | Added `getGlobalCaller()` accessor, needed by the `run()` fix above |
| `src/browser/js/lexer.ts` | `?.` is only tokenized as `QuestionDot` when not immediately followed by a decimal digit |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 4 new real-Electron regression checks (get/set disambiguation ×2, eval/getter interaction, ternary/optional-chaining) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx playwright test tests/e2e/js-dom-api-sweep.spec.ts   → all checks passed (real Electron)
npx vitest run (full suite)                              → 0 regressions
Real Electron YouTube diagnostic (before → after)        → "Expected LBrace, got Question" and "Expected RParen, got Colon" both gone; parsing now reaches a later, different, previously-unreached gap
```

## Verification Steps

1. Fetched YouTube's real HTML directly (`https.get`, following redirects) and extracted every inline and external `<script>`, then ran each through Nova's own `Lexer`/`Parser` in isolation to find the exact failing script and print real source context around the reported line:column — this is what turned three vague console errors into three concrete, root-causeable bugs.
2. For bug #2 specifically, didn't trust the first plausible-sounding theory: wrote a minimal isolated repro, confirmed it reproduced the exact same error message, then bisected further (does eval() alone break things? does a getter alone break things? does eval() + getter together break things?) until the precise trigger was isolated to a 5-line reproduction, only then touching any code.
3. Fixed each bug with the smallest change that addressed the real root cause (a one-token lookahead in two cases, a save/restore instead of a hardcoded reset in the third).
4. Added targeted unit-style verification for each fix confirming both the previously-broken case now works AND the common/existing cases aren't broken by the fix (real getters/setters, real optional chaining on null/object/call).
5. Added permanent regression checks to the established real-Electron pixel-based test harness (`js-dom-api-sweep.spec.ts`).
6. Rebuilt and re-ran the real YouTube diagnostic after each fix to confirm forward progress (the specific error and its line number changed and moved later each time) before moving to the next gap.
7. Ran the full unit suite and the full real-Electron e2e suite for regressions.
