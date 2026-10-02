# Five More Real JS-Engine Gaps Found Continuing the YouTube Bisection

**Date:** 2026-09-22
**Session:** Asked to continue with the "Cannot find global object" bug — one of the still-open gaps left documented (but unresolved) by the prior session's YouTube-bisection work (`doc/2026-09-21-three-real-js-engine-gaps-from-youtube-bisection.md`). After fixing it, asked to keep going through the gap list; continuing the same real-bisection methodology surfaced four more real, distinct bugs the same session — including the one other gap that prior doc explicitly left unresolved (`Expected Colon, got String`, a "state corruption carried forward" bug the prior session couldn't isolate with a naive brace-counting bisector).
**Status:** Completed (5 root causes fixed; a full real-`youtube.com` sweep of all 34 inline scripts AND the 10.7MB external bundle now shows 0 parse failures and 0 runtime errors — the entire original gap list from `doc/2026-09-21-*.md` is now resolved)

---

## Summary

Root-caused "Cannot find global object" to a real, well-known JS idiom (the UMD "find the true global object" feature-detection pattern) legitimately throwing its own designed error, because Nova's `window` never mirrored global built-ins and `self`/`globalThis` didn't exist at all. Fixing that let parsing/execution progress further into YouTube's bundle, which surfaced four more real bugs in turn: a regex escaped-slash pattern/flags corruption, global `var`/`window` bindings being two independently-updated copies instead of one live store, a missing legacy `performance.timing` object, and — finally closing out the prior session's one unresolved gap — a regex-vs-divide-assign disambiguation bug in a 10.7MB external bundle that corrupted the token stream for the rest of the file. Each was confirmed against the exact real-world triggering source before being fixed, and re-confirmed against live `youtube.com` and in real Electron afterward. The full diagnostic now shows **zero** failing scripts across all 34 inline scripts and the one 10.7MB external bundle (parse or runtime).

## Root Causes

### 1. `window`/`self`/`globalThis` never mirrored the real global built-ins
**File:** `src/browser/js/index.ts`, end of `createGlobalEnv()`
**Real trigger:** `[globalThis, this, window, self, global].find(c => c && c.Math === Math) || throw new Error('Cannot find global object')` — an extremely common real-world idiom (Closure-compiled code, polyfills, bundlers) for reliably locating the global object across environments.
**Problem:** Nova created `window` as a bare object (`createObject(null)`) that nothing ever copied built-ins onto, and never defined `self` or `globalThis` at all. In a real browser, `window === self === globalThis` and every global (`Math`, `Array`, `JSON`, `fetch`, ...) is really just a property of that one object, so `window.Math === Math` is true by construction. In Nova, `window.Math` didn't exist, so the identity check failed for every candidate and the library's own fallback fired for real.
**Fix:** After every other global is wired up, mirror each binding in the environment onto `window` by the same reference (only filling in names `window` doesn't already have its own value for), then alias `self` and `globalThis` to the same `window` object. Runs last in `createGlobalEnv()` so every global it copies actually exists by then.

### 2. Regex literal pattern/flags extraction broke on escaped slashes
**File:** `src/browser/js/lexer.ts` (`readRegex()`), `src/browser/js/tokens.ts` (`Token`), `src/browser/js/parser.ts` (regex literal AST construction)
**Real trigger:** `/\x3c(script|style)([\s\S]*?)\x3e([\s\S]*?)\x3c\/\1\x3e/ig` — a real closing-tag matcher from YouTube's bundle, using a backreference and an escaped slash.
**Problem:** `readRegex()` already tracked `pattern` and `flags` as separate, escape-aware strings while scanning character-by-character (so an escaped `/` never prematurely ends the literal) — but then merged them into one display string (`` `/${pattern}/${flags}` ``) for the token's `.value`, discarding that separation. The parser re-derived pattern/flags by calling `tok.value.split('/')`, which is lossy the instant the pattern contains any `/` — even a correctly-escaped one — corrupting the resulting `RegExp`.
**Fix:** Added `regexParts?: { pattern, flags }` to `Token` (following the existing `raw?: string` precedent for token-kind-specific fields). `readRegex()` now returns the already-correct `pattern`/`flags` on the token instead of just the merged display string, and the parser reads from `regexParts` instead of re-splitting `.value`.

### 3. Global `var`/function declarations and `window.X` assignments were two independently-updated stores
**File:** `src/browser/js/values.ts` (`Environment`), `src/browser/js/index.ts` (`createGlobalEnv()`)
**Real trigger:** `var ytcfg = {set: function(){...}}; window.ytcfg.set('EMERGENCY_BASE_URL', ...);` — two consecutive top-level statements in YouTube's bundle, the second reading back what the first just declared.
**Problem:** In a real browser, the global object *is* the global environment record — a top-level `var`/function declaration creates a property on `window`, and assigning `window.foo = ...` is immediately visible to a bare `foo` reference, because there's only one underlying store. Nova's window-mirroring fix (root cause #1 above) only copied bindings that existed *at setup time*; it was a one-time snapshot, not a live link. Any `var` declared once a script started running stayed invisible to `window.<name>`, and any `window.<name> = ...` assignment stayed invisible to a bare `<name>` read — reproduced directly: `var ytcfg = {...}; window.ytcfg.set()` threw `Cannot read properties of undefined (reading 'set')`, and `window.foo = {...}; foo.bar` threw the same way in reverse.
**Fix:** Added `Environment.linkWindow(windowObj)`, called once on the real global environment after every built-in is wired up. `declare()` now writes global (`var`-hoisted-to-root-scope) bindings directly into `windowLink.properties` instead of a separate internal map when a window is linked; `get()`/`set()`/`has()` fall back to checking `windowLink.properties` when a name isn't found locally. Every other `Environment` (function scopes, block scopes, worker/VM environments) has no `windowLink` and is completely unaffected — this only changes behavior for the one real global scope.

### 4. `window.performance.timing` (legacy `PerformanceTiming`) didn't exist at all
**File:** `src/browser/js/web-apis.ts` (`createPerformanceObject()`)
**Real trigger:** `ytcsi.setStart(w.performance?w.performance.timing.responseStart:null)` — YouTube's page-load timing beacon, unconditionally reading `.timing.responseStart` once it's confirmed `performance` itself exists.
**Problem:** Nova's `performance` object implements the modern `mark`/`measure`/`getEntries*` surface but never added the older `timing` sub-object, which real-world page-load instrumentation (a very common, if deprecated, pattern) still reads directly.
**Fix:** Added a `timing` object with all 21 standard `PerformanceTiming` fields. Nova has no real per-phase navigation timing to report, so every field shares one `Date.now()` epoch timestamp captured at `performance` object creation — enough for existence/type checks and for duration arithmetic (`x - navigationStart`) to produce a real number instead of throwing or `NaN`ing.

### 5. `/=` was checked before regex context, so a regex pattern starting with `=` corrupted the rest of the file
**File:** `src/browser/js/lexer.ts` (the `/` dispatch in `nextToken()`)
**Real trigger:** `.match(/=[a-z]+/g)` — real query-string-parsing code in YouTube's 10.7MB `kevlar_base` bundle, the exact source of the prior session's unresolved `Expected Colon, got String` gap.
**Problem:** This is the prior session's documented-but-unresolved gap, finally isolated. The naive brace-counting bisector the prior session tried couldn't find it because the corruption doesn't come from an unbalanced brace — it comes from the lexer's own dispatch order. When the lexer sees `/`, it checked `peek(1) === '='` (→ emit `/=`, SlashAssign) *before* checking `isRegexContext()` (→ read a regex literal). After `LParen`/`Comma`/`Return`/etc., `/` should always start a regex if the grammar allows one there, regardless of what the next character is — a real JS engine resolves this via grammar position, not by peeking one character ahead. `.match(/=[a-z]+/g)` was misread as `.match(` + `/=` (SlashAssign) + garbage, and the "regex" scanner never ran; instead the lexer resumed normal tokenizing mid-pattern, hit the pattern's own literal `=` and `[a-z]+` characters as if they were real code, and its next `"` (from something else in the pattern or later real code) got treated as an unrelated string boundary — corrupting every token for the rest of the 10.7MB file. **Isolating this required real differential tooling, not guesswork**: confirmed the whole bundle is valid JS via `node --check` (ruling out a real minifier syntax error), then ran Nova's own lexer across the *entire* file in one continuous pass (not a fresh isolated re-lex, which hides any cumulative-state bug) and found the first anomalously-shaped token — a `SlashAssign` immediately followed by a corrupted, hundreds-of-characters-long "string" swallowing real code — which pointed straight at `.match(/=[a-z]+/g)` at the true origin, thousands of lines before the reported error line.
**Fix:** Reordered the dispatch so `isRegexContext()` is checked *before* the `/=` lookahead. Verified real `/=` (divide-assign) still works correctly after identifiers and call results (division-eligible contexts), where `isRegexContext()` correctly returns `false`.

## Notes

- Every fix was confirmed against a live fetch of `youtube.com`'s real HTML (and, for #5, the real external bundle it references) before any code was written, and re-confirmed the same way afterward.
- Root causes #1–#4 chained: each fix let execution progress further into scripts that previously aborted earlier, which is precisely what surfaced the next bug. #5 was different — it lived in an external 10.7MB bundle the inline-script sweep never reaches, and was independently reachable the whole time; it just took real differential tooling (see root cause #5) instead of guesswork to isolate, which is exactly why the prior session left it undiagnosed rather than misdiagnosed.
- Adding the new e2e regression checks initially made the entire `language-features` case fail (all 32 marks, not just the new ones at the time) in the real Electron run. Root cause was a test-authoring mistake, not a Nova bug: two of the new checks' explanatory *comments* contained the literal text `</script>`, and the HTML tokenizer scans for that literal byte sequence to end a `<script>` element regardless of JS string/comment context — truncating the whole harness script mid-file. Fixed by rewording the comments to avoid the literal substring. Confirmed via `page.on('console'/'pageerror')` wiring (temporarily added, then removed) that the real Electron `ScriptEngine` was reporting `Expected RBrace, got EOF` — a truncated-script signature — which pointed straight at the real cause once the local `runJS`-only reproduction (which doesn't go through HTML tokenization) failed to show any problem.
- Root cause #3 (global var/window sync) is scoped tightly to the one real global `Environment` via an opt-in `linkWindow()` call — every other environment (function scopes, block scopes, worker/VM environments) has no window link and is completely unaffected, keeping the blast radius to exactly the place the real bug lived.
- This closes out every gap the prior session's doc left open: "Cannot find global object" (#1), and `Expected Colon, got String` (#5) are both fixed; the "couple of `Cannot read properties of undefined` runtime gaps" turned out to be exactly the 3 scripts fixed by #3 and #4 above.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | `createGlobalEnv()`: mirrors every global binding onto `window`, aliases `self`/`globalThis` to it, and links the environment to `window` for live var/property sync |
| `src/browser/js/lexer.ts` | `readRegex()` returns `regexParts: { pattern, flags }` on the token instead of only the merged display string; `/` dispatch now checks regex context before assuming `/=` is an operator |
| `src/browser/js/tokens.ts` | `Token` gains optional `regexParts?: { pattern, flags }` field |
| `src/browser/js/parser.ts` | Regex literal AST construction reads `regexParts` instead of re-splitting `tok.value` on `/` |
| `src/browser/js/values.ts` | `Environment` gains `linkWindow()`/`windowLink`; `declare()`/`get()`/`set()`/`has()` read/write through it for the global scope |
| `src/browser/js/web-apis.ts` | `createPerformanceObject()` adds a `timing` object with all 21 legacy `PerformanceTiming` fields |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 7 new real-Electron regression checks (UMD global-object pattern, window/self/globalThis identity + mirrored built-ins, escaped-slash regex with backreference, more escaped-slash shapes, live var/window sync in both directions, `performance.timing` fields, regex-starting-with-`=` vs real `/=`) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 227/228 files, 9313/9316 tests passed (3 pre-existing DNS-timeout failures, unrelated — see doc/known-test-failures.md)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
Real YouTube diagnostic (before → after)                 → 0/34 inline scripts fail to parse or run; the 10.7MB external kevlar_base bundle now parses cleanly too (previously: "Cannot find global object" ×4, regex corruption, 3 "Cannot read properties of undefined" errors, "Expected Colon, got String" in the external bundle)
```

## Verification Steps

1. Fetched YouTube's real HTML directly and ran every inline script through Nova's own `Lexer`/`Parser`/`runJS` in isolation to confirm the exact failing script and reproduce "Cannot find global object" from real source before writing any fix.
2. Fixed the window-mirroring gap, then re-ran the same real-YouTube check and found a new, previously-unreached regex parse failure — confirmed it against the exact real source snippet before fixing it too.
3. Fixed the regex bug, re-ran again: 0/34 parse failures, but 3 scripts now failed at *runtime*. Wrote a minimal 3-statement repro (`var x = {...}; window.x.method()` and the reverse) before touching any code, confirming the var/window desync theory precisely.
4. Fixed the var/window sync gap; one runtime failure remained (`performance.timing.responseStart`) — traced to a genuinely missing API surface, not an architectural gap, and added it.
5. Re-ran the full real-YouTube inline-script diagnostic: 0/34 scripts fail to parse or execute.
6. Turned to the prior session's one remaining documented gap (`Expected Colon, got String` in a 10.7MB external bundle). Confirmed the bundle is valid JS via `node --check` first (ruling out a real syntax error), then ran Nova's lexer across the whole file in one continuous pass and scanned for anomalous tokens — found a corrupted, hundreds-of-characters `String` token immediately following a `SlashAssign`, traced it back to `.match(/=[a-z]+/g)`, and confirmed the dispatch-order bug with a 5-line repro before touching any code.
7. Fixed the dispatch order; re-parsed the full 10.7MB bundle — 0 syntax errors.
8. Added 7 permanent regression checks to `tests/e2e/js-dom-api-sweep.spec.ts`; diagnosed and fixed an unrelated test-authoring mistake along the way (literal `</script>` in a comment truncating the harness page) using real Electron console/pageerror capture.
9. Rebuilt (`npm run build:web`) and re-ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
