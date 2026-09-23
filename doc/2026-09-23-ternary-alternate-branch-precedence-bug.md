# A Ternary's Branches Were Parsed at the Wrong Precedence — Broke Real jQuery's Entire Event System

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Continued the jQuery 1.8.2 investigation — with the selector engine and DOM manipulation now working (previous round), `.on()`/`.trigger()` were the last major gap. Traced through jQuery's own event/data-cache internals to a genuine, high-impact parser bug: a conditional expression's alternate branch was parsed one precedence level too high, silently breaking any `cond ? a=x : a=y` pattern with a bare (unparenthesized) assignment in either branch.
**Status:** Completed (1 root cause fixed)

---

## Summary

Real ECMAScript grammar defines both branches of a ternary as full `AssignmentExpression`s: `ConditionalExpression: ... "?" AssignmentExpression ":" AssignmentExpression`. Nova's parser got the *alternate* branch wrong — it parsed it at the ternary operator's own precedence instead of assignment's, which stops one level too early: right after a bare identifier, before consuming a trailing `=`. `j ? x=5 : x=6` silently mis-parsed as `(j ? (x=5) : x) = 6` — a `ConditionalExpression` used as an assignment target, which isn't even a valid `LeftHandSideExpression` in real JS. Real jQuery's own per-element data-cache ID assignment (`l||(j?a[h]=l=X:l=h)`, inside `jQuery.data()`) is written exactly this way, so **every element silently never got a data-cache entry at all** — breaking `.on()`/`.trigger()`/`.data()` and anything else built on top of jQuery's internal cache.

## Root Cause

**File:** `src/browser/js/parser.ts` (the `Question`/ternary case inside `parseInfix`)
**Real trigger:** `l||(j?a[h]=l=p.deletedIds.pop()||p.guid++:l=h)` — jQuery's real `jQuery.data()` internals, assigning a fresh internal ID to an element the first time any data (including event handlers) is attached to it.
**Problem:** `const alternate = this.parseExpression(prec);` used `prec` — the current infix precedence for the `Question` token itself (3) — as the alternate branch's minimum precedence. Since assignment operators sit at precedence 2 (below 3), `parseExpression(3)`'s own loop (`if (prec === 0 || prec < minPrec) break;`) stopped consuming as soon as it hit the trailing `=`, leaving the alternate as just the bare identifier `x`. Whatever called this ternary parse then continued its own infix loop and picked up the leftover `= 6` as an assignment *onto the entire conditional expression* — producing a semantically nonsensical AST that happened not to throw. The *consequent* branch (`this.parseExpression()`, defaulting to precedence 0) had the opposite problem: too permissive, technically allowing a bare comma expression to sneak in where real JS requires explicit parens — not separately observed as a real-world bug, but the same category of mismatch.
**Fix:** Both branches now call `this.parseExpression(2)` — assignment-expression precedence — exactly matching the real grammar. This correctly consumes `=`/compound-assignment operators in either branch while still stopping at a bare comma (so `a ? b : c, d` still parses `, d` as a separate sequence element, not part of the alternate), and preserves right-associative nested-ternary chaining in the alternate position (`a ? b : c ? d : e`), since the `Question` token's own precedence (3) is still `>= 2`.

## Notes

- This bug had a wide potential blast radius (`cond ? a=x : a=y` is unusual but valid, ordinary JS — more common in older/minified code than modern code, which tends to prefer explicit `if`/`else` or parenthesized ternaries), yet none of the existing 9316 vitest tests or prior e2e regression checks happened to exercise this exact shape until now — a good illustration of why continuing to bisect real, popular, minified libraries keeps surfacing gaps this deep into the session.
- Verified with a 19-case regression matrix: the core fixed pattern (bare assignment/compound-assignment/chained-assignment in either or both branches, the exact real jQuery idiom), and every ternary shape that must remain unaffected — simple ternaries with no assignment, ternaries as function arguments/array elements/object values/return values, ternaries with function calls or `new` expressions in a branch, nested ternary chaining in both the consequent and alternate positions, the comma-still-requires-explicit-parens boundary, and a bare comma immediately *after* a ternary correctly staying a separate sequence element rather than being swallowed.
- With this fix, jQuery 1.8.2's `.on('click', fn)` + `.trigger('click')` genuinely round-trips end-to-end for the first time (confirmed via a real handler flag flipped by a real triggered event, with the event loop properly drained via `eventLoop.runAll()` — a real fix, not a false-negative test artifact like the `.ready()` "gap" from the previous round turned out to be, which was just jQuery's own intentional `setTimeout`-deferred callback that the test hadn't waited for).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/parser.ts` | Both branches of a `ConditionalExpression` now parse at assignment-expression precedence (2) instead of the alternate incorrectly using the ternary's own precedence (3) |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 6/7 passed; youtube-smoke.spec.ts fails
                                                             identically with this change stashed out
                                                             (pre-existing network/environment flake,
                                                             confirmed unrelated — see prior rounds'
                                                             docs for the same finding)
```

## Verification Steps

1. Continued the jQuery investigation: confirmed `$(document).ready()` was actually already working correctly — the previous round's test never drained the event loop, and real jQuery intentionally defers via `setTimeout` even when `document.readyState === "complete"`. Re-tested with `eventLoop.runAll()` and confirmed it fires correctly — a false-negative retraction, not a fix.
2. Confirmed `.on('click', fn)` + `.trigger('click')` still didn't work even with the event loop drained; traced through jQuery's real, unminified-equivalent `jQuery.event.add`/`jQuery.data`/`jQuery._data` source to the per-element ID assignment line.
3. Manually replicated jQuery's own `data()` logic step-by-step with real variable names — the manual replication *worked*, while the real minified jQuery code did not, isolating the divergence to something in the actual code shape rather than the algorithm itself.
4. Narrowed to the exact chained-assignment-inside-a-ternary-inside-a-`||`-short-circuit pattern; stripped away the `||` wrapper and computed-member assignment to find the true minimal repro: a bare `cond ? a=x : a=y` at the top level.
5. Dumped the AST directly and found the mis-parse: an `AssignmentExpression` wrapping a `ConditionalExpression` as its left-hand side, with the ternary's alternate cut short at a bare identifier.
6. Traced to `parseInfix`'s `Question` case and found the precedence mismatch between the two branches; fixed both to the spec-correct value.
7. Verified the exact real jQuery idiom now parses and evaluates correctly, then re-ran the full jQuery `.on()`/`.trigger()` round-trip end-to-end — genuinely works now.
8. Ran a 19-case regression matrix covering the fix and every ternary shape that must stay unaffected (see Notes).
9. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
10. The one e2e failure (`youtube-smoke.spec.ts`, a live-network smoke test against real youtube.com) was confirmed pre-existing by stashing this round's change and re-running in isolation — it failed identically either way, so it's unrelated to this fix (the same class of environment flake documented in earlier rounds).
11. Cleaned up all temporary bisection/repro scripts.
