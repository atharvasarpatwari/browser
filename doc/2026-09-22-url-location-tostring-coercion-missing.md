# `new URL(relative, base)` Threw "Invalid URL" for a Real URL or Location Base

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Bisected stripe.com, svelte.dev, and linkedin.com for real JS engine failures. svelte.dev's real bootstrap script crashed with "Invalid URL"; stripe.com's lead ("Cannot read properties of undefined (reading 'The')") turned out to be a testing-harness false positive — the bisection script's inline-script regex matched a non-JS `<script>` tag whose body was 290 characters of plain English prose (a GDP-ticker description string), not a JS parse/runtime bug. linkedin.com came back fully clean.
**Status:** Completed (1 root cause fixed)

---

## Summary

Real SvelteKit bootstrap code (shipped on svelte.dev) does `new URL(".", location).pathname.slice(0, -1)` to compute its base path. Nova's `URL` constructor coerces a non-string base argument via the engine's generic `toString()` helper, but that helper had no case for either a `Location` object or a `URL` object — both fell through to the generic `'[object Object]'` string, which the real `URL` parser then correctly rejects as an invalid base URL.

## Root Cause

**Files:** `src/browser/js/values.ts` (`toString()`), `src/browser/js/history-bindings.ts` (`createLocationBinding()`)
**Real trigger:** `new URL(".", location)` — `location` is a plain `createObject(null)`-based binding with native getter/setter descriptors, not a string, so the `URL` constructor's `toString(args[1])` coercion runs on it.
**Problem:** `toString()`'s object-coercion path only special-cased a handful of `__type_override` tags (error, arraybuffer, dataview, sharedarraybuffer, weakref, finalizationregistry, `*Array`) before falling through to `'[object Object]'`. `Location` objects had no `__type_override` tag at all, and `URL` objects were tagged `'url'` but that tag was never checked in `toString()` — so both a real `URL` object and `window.location` used as a base argument coerced to the literal string `"[object Object]"`, which Node's real `URL` parser rejects outright.
**Fix:** Two small additions. (1) `history-bindings.ts` now tags `locationObj.__type_override = 'location'` right after creating it. (2) `toString()` gained two new cases: `'url'` reads `obj.nativeURL?.href`, and `'location'` reads the `href` property's native getter via the already-imported `callJSFunction` helper. Both fall back to `'[object Object]'` only if the expected shape isn't there, so nothing else regresses.

## Notes

- This is the same generic `toString()` used for `String(x)`, template-literal interpolation, and `+` concatenation — so the fix also makes `String(location)`, `` `${location}` ``, and `'' + location` all correctly yield the real href, not just the `URL`-constructor path. All three were previously broken too, just less visibly (most real code stringifies `location` for logging/comparison, not construction).
- `Object.prototype.toString.call(location)` is unaffected — that spec-mandated algorithm lives in the separate `objectPrototypeToStringTag()` function added in an earlier round, which deliberately never touches an object's own coercion behavior.
- The stripe.com lead was investigated and discarded as a harness artifact, not a Nova bug: the bisection script's inline-script extraction regex excludes only `application/json`/`application/ld+json` script types, not other non-executable types. The matched "script" was 290 characters of plain English prose (a GDP figure description), which a real browser would also never execute as JS given its actual `type` attribute — trying to run English prose as JavaScript produced the "Cannot read properties of undefined (reading 'The')" error, not a real engine gap. No code change was needed or made for this lead.
- A test-harness bug in my own bisection tooling was found and fixed mid-investigation (not shipped, script deleted): an early repro script created a fresh, unnavigated `NavigationController` for the actual test run instead of reusing the one that was navigated, making the real fix look broken. Restructuring to use exactly one controller throughout resolved it.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/values.ts` | `toString()` gained `'url'` and `'location'` cases so a real `URL` object or `window.location` coerces to its href instead of `'[object Object]'` |
| `src/browser/js/history-bindings.ts` | `createLocationBinding()` now tags the location object with `__type_override = 'location'` so `toString()`'s new case can recognize it |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check (`new URL('.', location)`, `new URL('c', urlObject)`, `String(location)`, and `'' + location` all resolve/stringify correctly) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 6/7 passed; youtube-smoke.spec.ts fails
                                                             identically with this change stashed out
                                                             (pre-existing network/environment flake,
                                                             not a regression from this fix)
```

## Verification Steps

1. Bisected stripe.com, svelte.dev, and linkedin.com by fetching real HTML and running every inline/external `<script>` through Nova's real Lexer/Parser/`runJS()` with a real `NavigationController`.
2. Found svelte.dev's inline script #4 (real SvelteKit bootstrap, 22175 chars) throwing "Invalid URL" on `base: new URL(".", location).pathname.slice(0, -1)`.
3. Traced it to the `URL` constructor's `toString(args[1])` base-argument coercion falling through to `'[object Object]'` for both `Location` and `URL` objects.
4. Fixed by tagging the location object and adding two new `toString()` cases; verified with 7 targeted checks across two temporary repro scripts, including the exact real SvelteKit trigger line producing the correct value `"/docs/svelte"`.
5. Investigated stripe.com's separate lead in parallel; confirmed via direct inspection that the "failing script" content was plain English prose, not JavaScript — a testing-harness false positive from the bisection regex, not a Nova bug. Discarded, no fix needed.
6. Added 1 permanent e2e regression check, rebuilt (`npm run build:web`), and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
7. The one e2e failure (`youtube-smoke.spec.ts`, a live-network smoke test against real youtube.com) was confirmed pre-existing by stashing this round's changes and re-running in isolation — it failed identically either way, so it's unrelated to this fix.
8. Cleaned up all temporary bisection/repro scripts (`site-check4.mjs`, `stripe-check.mjs`, and both `url-tostring-repro*.mjs`).
