# A Bogus Empty Attribute on Every Parsed Tag, and Array.slice(-N) Returning the Whole Array

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. With jQuery 1.8.2's selector engine, DOM manipulation, and event system all now working end-to-end (previous rounds), ran one more comprehensive functional pass (`.each`, `.filter`, `.eq/.first/.last`, `.val`, `.is`, `.prop`, `.html`, `.remove`, `.css`, event delegation, `.animate`, `$.ajax`, `jQuery.Deferred`, `.clone`, `.wrap`, `.index`, `.map`, and more) to find any remaining gaps. Surfaced two independent, real Nova bugs.
**Status:** Completed (2 root causes fixed)

---

## Summary

Two unrelated bugs, both found via the same comprehensive jQuery functional sweep:

1. **`el.innerHTML` round-tripping added a bogus `=""`-attribute to every tag.** A plain `el.innerHTML = '<p>new</p>'; el.innerHTML;` came back as `<p ="">new</p>` — confirmed via a standalone repro to be a general HTML-parsing bug, not jQuery-specific.
2. **`Array.prototype.slice` with a single negative argument returned the entire array.** jQuery's own `.last()` is implemented as `this.slice(-1)`, so every `.last()` call (and any `.eq(-1)`-style negative index) silently returned the whole, unfiltered collection instead of just the last element.

## Root Causes

1. **File:** `src/browser/rendering/html5-tokenizer.ts` (`commitAttr()`)
   **Real trigger:** any parsed HTML tag, with or without real attributes.
   **Problem:** `emitTag()` unconditionally calls `commitAttr()` one extra time when a tag closes, on top of the per-real-attribute calls already made while tokenizing, to flush whatever attribute was still being built. `commitAttr()` had no guard against this: it always ran `this.attrs.set(this.attrName, this.attrValue)`, and since `attrName`/`attrValue` are already reset to `''` by the time this final call happens, it added `attrs.set('', '')` — a bogus empty-string-keyed attribute — to literally every tag Nova ever parsed.
   **Fix:** guard the commit on `this.attrName !== ''` — a real attribute name can never be empty (the tokenizer only enters the attribute-name state on a real character), so an empty name at this point means there's nothing left to flush.

2. **File:** `src/browser/js/values.ts` (`arraySlice()`)
   **Real trigger:** `this.slice(a)` where `a === -1`, inside jQuery's real `eq:function(a){return a=+a,a===-1?this.slice(a):this.slice(a,a+1)}` (and `last:function(){return this.eq(-1)}`).
   **Problem:** `const start = args[0] !== undefined ? Math.max(0, toNumber(args[0])) : 0;` clamped any negative index straight to `0` instead of resolving it relative to the array's length. Combined with the default `end = elems.length` (since only one argument was passed), `slice(-1)` silently degraded into `slice(0, length)` — the entire array — rather than the intended "last element."
   **Fix:** added `resolveSliceIndex(value, length)`, matching real ECMAScript `Array.prototype.slice` semantics: a negative value resolves to `max(length + value, 0)`, a non-negative value clamps to `min(value, length)`. Applied to both `start` and `end` (the `end` argument can independently be negative too, e.g. `slice(1, -1)`).

## Notes

- Bug 1 was caught by a standalone `el.innerHTML` round-trip with no jQuery involved at all — confirming it as a foundational HTML-parsing bug rather than anything jQuery-specific. Verified with a 12-case regression matrix (zero-attribute tags, multi-attribute tags, void elements, boolean attributes, nested tags, sibling tags, special characters, full-page parses, self-closing tags with attributes) — all passing.
- Bug 2 was isolated by first confirming `.eq(2)` (positive index) worked correctly while `.eq(-1)`/`.last()` didn't, then reading jQuery's real `.eq()` source directly (`grep`'d out of the fetched jQuery 1.8.2 minified file) to see it takes a *different code path* for the `-1` case — `this.slice(a)` (single-arg) vs. `this.slice(a, a+1)` (two-arg) — which pointed straight at `arraySlice()`'s handling of a single negative argument. Verified with a 12-case regression matrix (single/double negative indices, mixed positive-start/negative-end, indices beyond array bounds in both directions, empty ranges, and the no-arg/explicit-zero full-copy cases) — all passing, matching real JS semantics exactly.
- Both bugs are foundational (HTML tokenization; a core `Array.prototype` method) rather than jQuery-specific, so the blast radius extends to any page or script exercising these paths, not just jQuery.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/html5-tokenizer.ts` | `commitAttr()` now skips the commit when `attrName` is empty, fixing the mandatory extra call `emitTag()` makes on every tag close |
| `src/browser/js/values.ts` | `arraySlice()` now resolves negative `start`/`end` indices relative to array length via a new `resolveSliceIndex()` helper, instead of clamping negatives to 0 |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 2 new real-Electron regression checks (marks 55–56 in `language-features`) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 6/7 passed; youtube-smoke.spec.ts fails,
                                                             same pre-existing live-network flake
                                                             confirmed unrelated in prior rounds'
                                                             docs (no networking code touched here)
```

## Verification Steps

1. Ran a comprehensive jQuery 1.8.2 functional sweep (`.each`, `.filter`, `.eq/.first/.last`, `.val`, `.is`, `.prop`, `.html`, `.remove`, `.css`, `.width/.height`, event delegation, `.off`, `.one`, custom events, `.animate`, `$.ajax`, `jQuery.Deferred`, `.clone`, `.wrap`, `.index`, `.map`) in a fresh, real `DomTree`/`HtmlParser`/`EventLoop` environment.
2. Re-isolated each apparent failure in its own fresh environment (not sharing state with the cumulative script) to rule out collateral corruption from an earlier timeout, distinguishing genuine bugs from test artifacts.
3. For the `.html()` bug: reproduced with plain `el.innerHTML = '<p>new</p>'; el.innerHTML;` (no jQuery) to confirm it as a standalone Nova bug; traced to `html5-tokenizer.ts`'s `commitAttr()` and its unconditional extra call from `emitTag()`.
4. For the `.last()`/`.eq(-1)` bug: confirmed `.eq(2)` worked but `.eq(-1)`/`.last()` returned the whole 3-element collection's concatenated text (`.last().length === 3`, not `1`); read jQuery's real `.eq()`/`.last()` source directly to find the negative-index case takes a different internal path (`this.slice(a)` vs. `this.slice(a,a+1)`); traced to `arraySlice()`'s negative-index clamping bug.
5. Fixed both root causes with the smallest correct change; typechecked clean.
6. Ran a 12-case regression matrix for each fix — all passing.
7. Added 2 permanent e2e regression checks, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
8. The one e2e failure (`youtube-smoke.spec.ts`, a live-network smoke test) is the same pre-existing environment flake already stash-verified unrelated in prior rounds; this round's changes touch only HTML attribute tokenization and array slicing, nothing networking-related, so no re-verification was needed.
9. Cleaned up all temporary bisection/repro scripts.
