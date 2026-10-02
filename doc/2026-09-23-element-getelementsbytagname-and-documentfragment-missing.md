# A Plain Element Had No `getElementsByTagName`, and `createDocumentFragment` Didn't Exist

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Continued the ongoing jQuery 1.8.2 investigation from the previous two rounds — after fixing `Array.prototype` and the `new a.b.c()` parser precedence bug, jQuery's real feature-detection setup code hit two more, separate, real DOM gaps in quick succession.
**Status:** Completed (2 root causes fixed)

---

## Summary

jQuery 1.8.2's `jQuery.support` feature-detection routine builds a detached scratch `<div>`, fills it with `innerHTML`, and probes it — real code that hit two genuine, separate DOM gaps back to back:

1. `div.getElementsByTagName(...)` didn't exist at all — only `document.getElementsByTagName` did — and even that document-level version never matched the `"*"` wildcard tag.
2. `document.createDocumentFragment()` didn't exist at all.

## Root Causes

### 1. Only `document` had `getElementsByTagName`, and it never matched `"*"`

**Files:** `src/browser/js/dom-bindings.ts` (`wrapElement`), `src/browser/rendering/dom-tree.ts` (`DomTree.getElementsByTagName`)
**Real trigger:** `n=e.createElement("div"); n.innerHTML="...<a href='/a'>a</a>..."; c=n.getElementsByTagName("*"); d=n.getElementsByTagName("a")[0];` — jQuery 1.8.2's own feature-detection scratch code.
**Problem:** `wrapElement()` (the JS bindings for a plain element, e.g. one returned by `document.createElement()`) already had element-scoped `querySelector`, `querySelectorAll`, and `getElementsByClassName` — but `getElementsByTagName` was simply missing from that list, even though `document`'s own (document-wide) version existed. Calling it on an element silently resolved to `undefined` and calling that as a function returned `undefined` rather than throwing — so `n.getElementsByTagName("a")[0]` produced `undefined` with no clear error until something read a property off it. Separately, `DomTree.getElementsByTagName()`'s own tag match (`tagName === lower`) never special-cased `"*"`, so even `document.getElementsByTagName("*")` — a common "give me every element" idiom — always returned an empty list.
**Fix:** Added an element-scoped `getElementsByTagName` to `wrapElement()`, mirroring the existing `getElementsByClassName`'s manual BFS-over-descendants pattern (rather than delegating to the whole-document `DomTree.getElementsByTagName`, which has no way to scope to one element's subtree). Also fixed `DomTree.getElementsByTagName()` to match every element when the tag is `"*"`, fixing the document-level version too.

### 2. `document.createDocumentFragment()` didn't exist

**File:** `src/browser/js/dom-bindings.ts`
**Real trigger:** `i=e.createDocumentFragment(),i.appendChild(n.lastChild)` — jQuery's own checkbox-`checked`-state-cloning feature-detection code.
**Fix:** Added `createDocumentFragment()`, modeled as a detached element (reusing the existing `makeElement`/`wrapElement` machinery, tagged `"#document-fragment"`) — this gets `appendChild`/`removeChild`/`cloneNode`/`children`/`querySelector`/the just-added `getElementsByTagName` all for free, since they're already generic over any wrapped element. **Deliberate simplification** (marked `ponytail:` in the code): this isn't a spec-accurate `DocumentFragment` — its `nodeType` stays the generic element value rather than the real spec's `11`, and inserting the fragment into a live document doesn't flatten its children into the target (real fragments do). Neither is exercised by the currently-observed real-world trigger; upgrade if something depends on either.

## Notes

- Continuing past both fixes, jQuery reaches a *third* failure (`Cannot read properties of null (reading 'type')`) that doesn't originate from any of the three known interpreter/VM throw sites for that exact message — suggesting a host-level (native TypeScript binding code) null-property access rather than a guest-JS-level one, which would need broader tracing than a simple debug print to localize. Not pursued this round; flagged for a future one.
- A quick correctness check on the same feature-detection snippet (checkbox `checked` state surviving a fragment clone) returned `null`/`null` instead of the expected `true`/`true` — this points to a separate, deeper gap in checkbox `.checked` property-vs-attribute reflection, not something this round's two fixes address. Also flagged for a future round.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | `wrapElement()` gains an element-scoped `getElementsByTagName`; `createDocumentFragment()` added to the document bindings |
| `src/browser/rendering/dom-tree.ts` | `DomTree.getElementsByTagName()` now matches every element when the tag argument is `"*"` |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Continued the jQuery 1.8.2 investigation with the same temporary interpreter-level tracing approach as the prior two rounds (adding/removing debug prints at each of the three known "Cannot read properties of X" throw sites in `interpreter.ts` and `vm.ts`), since the engine produces no native stack trace on its own.
2. Localized the first new failure to jQuery's own `n.getElementsByTagName("a")[0]` on a detached scratch div; confirmed via a targeted repro that `children`/`querySelector` already worked correctly on the same detached element while `getElementsByTagName` alone did not, isolating it to a missing element-level binding rather than a broader detached-element or `innerHTML`-parsing gap.
3. Fixed and re-verified with a repro matrix covering the wildcard tag, a specific tag, and the exact real jQuery snippet end-to-end.
4. Re-ran jQuery, found the next failure at `document.createDocumentFragment()`, confirmed it was missing entirely, and added it by reusing the existing element machinery.
5. Verified `appendChild`/`removeChild`/`cloneNode` all work correctly on a fragment via a targeted repro; noted (but did not chase) a separate checkbox-`checked`-reflection quirk surfaced by the exact real jQuery snippet's *values*, since the snippet itself now runs without throwing, which was the actual regression this round targets.
6. Re-ran jQuery once more, found a third, different failure not matching any known interpreter/VM throw site for its exact message — flagged as a host-level lead for a future round rather than chased further this round.
7. Added 1 permanent e2e regression check, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck.
8. Cleaned up all temporary bisection/repro scripts, including every debug trace added and removed during investigation (confirmed via `git diff` showing zero net changes to `interpreter.ts`/`vm.ts`).
