# Array Index Assignment Never Grew `.length` — Plus the Bugs That Unlocked Real jQuery's Selector Engine and DOM Manipulation

**Date:** 2026-09-23
**Session:** Asked to keep filling gaps. Continued the jQuery 1.8.2 investigation (`$('.selector')` finding zero elements, `.append()` crashing) that the previous round flagged and deferred. Found and fixed three separate, foundational bugs — the last of which (`arr[i] = x` never growing `.length`) is a fundamental JS array semantics gap likely affecting far more real-world code than jQuery alone.
**Status:** Completed (3 root causes fixed)

---

## Summary

Three unrelated, foundational bugs, each blocking a different piece of real jQuery functionality:

1. **`nodeType`/`nodeName` didn't exist on `document` or elements at all.** Real jQuery's Sizzle selector engine uses `documentElement.nodeName !== "HTML"` to decide whether a document is XML — with `nodeName` always `undefined`, every document looked like XML, permanently disabling Sizzle's optimized selector-matching paths. `$('.some-class')` silently matched nothing.
2. **`element.ownerDocument` didn't exist.** Real jQuery's `buildFragment()` resolves the owning document via `el.ownerDocument || el` before calling `.createDocumentFragment()` — without it, that call landed on the element itself and crashed. Appending a real `DocumentFragment` also didn't correctly move its children into the target.
3. **Assigning a numeric array index never grew `.length` at all** — only real array methods (`push`, `splice`, ...) did. Real jQuery's own internal `jQuery.map()` uses the classic `g[g.length] = value` idiom to append without calling `.push()`; with `.length` silently stuck at 0, every caller that read it back afterward saw an empty array even though the values were really there.

**Real jQuery 1.8.2's selector engine and core DOM manipulation now work end-to-end**: `$('.class')` finds real elements, `.text()`/`.addClass()`/`.attr()`/`.append()`/`.parent()`/`.children()`/`.find()` all function correctly against real DOM content.

## Root Causes

### 1. `nodeType`/`nodeName` missing on `document` and elements

**Files:** `src/browser/js/dom-bindings.ts` (`createDocumentBinding`, `wrapElement`, `wrapTextNode`)
**Real trigger:** Sizzle's `isXML=function(a){var b=a&&(a.ownerDocument||a).documentElement;return b?b.nodeName!=="HTML":!1}` — confirmed via `jQuery.isXMLDoc(document)` returning `true` when it should be `false`.
**Fix:** Added `nodeType`/`nodeName` to `document` (9, `"#document"`), elements via `wrapElement()` (1, the uppercase tag name — same value `tagName` already had), and `nodeName` to text nodes (`"#text"`, alongside the `nodeType: 3` they already had).
**Note:** Sizzle's `contains()` helper has a three-tier fallback (native `.contains` → `.compareDocumentPosition` → manual `parentNode` walk) and correctly used its fallback in the *absence* of those two APIs — so this fix didn't need to also implement `compareDocumentPosition`/`Node.contains()`.

### 2. `element.ownerDocument` missing; `DocumentFragment` insertion didn't move children

**Files:** `src/browser/js/dom-bindings.ts` (`wrapElement`, `appendChild`)
**Real trigger:** `c=c.ownerDocument||c` inside jQuery's real `buildFragment()`, immediately followed by `c.createDocumentFragment()`.
**Fix:** Added a module-level `documentCache: WeakMap<IDomTree, JSObject>`, populated once by `createDocumentBinding()`, so `wrapElement()` can answer `ownerDocument` with the exact same document object the page's `document` global refers to (real code relies on `el.ownerDocument === document` identity, not just a same-shaped copy). Also taught `appendChild` to detect a `DocumentFragment` (tagged `"#document-fragment"`, from the previous round's `createDocumentFragment()`) and move its children into the target instead of inserting the fragment node itself — completing a limitation that round's doc explicitly flagged as "upgrade if real code depends on it," which real jQuery's `.append()` now does.

### 3. Array index assignment never grew `.length`

**File:** `src/browser/js/interpreter.ts` (`evalAssignment`, `evalUpdate`)
**Real trigger:** `g[g.length]=e` inside jQuery's real `jQuery.map()` — confirmed by bisecting down from "`.parent()`/`.children()` return 0 elements" through jQuery's `dir()`/`map()` internals to this exact line.
**Problem:** All three of `evalAssignment`'s plain-`=` branch, its compound-assignment (`+=`, `||=`, etc.) branch, and `evalUpdate`'s `++`/`--` branch wrote a numeric-index property directly via `obj.properties.set(key, {...})` with no array-specific handling at all — real JS arrays are exotic objects whose `[[DefineOwnProperty]]` auto-updates `.length` whenever a valid array index at or past the current length is written, and nothing in Nova replicated that for a plain indexed write (only the hand-written array methods like `push`/`splice` updated `.length` themselves, since they're separate native implementations that always did it manually).
**Fix:** Extracted a shared `growArrayLengthIfNeeded(obj, key)` helper and call it from all three write paths after the property write succeeds (only for `obj.type === 'array'` and a key matching a valid non-negative-integer array index, growing `.length` to `index + 1` when the index is at or past the current length).

## Notes

- Bisecting this round used the same interpreter-level tracing technique as prior rounds (temporary `NOVA_DEBUG_MEMBER` prints at `evalMember`'s throw site), but the actual breakthroughs here came from methodically peeling back jQuery's own minified internals layer by layer — Sizzle's `isXML` check, `buildFragment`'s `ownerDocument` resolution, and finally `jQuery.map`'s array-like detection and append loop — rather than a single stack trace pointing directly at the bug, since none of these three produced an outright crash on their own (wrong/empty results, not exceptions, for #1 and #3).
- Found (but did not fix, and confirmed via `git stash` to be unrelated to this round's changes) a separate, real, pre-existing bug: a setter created via `Object.defineProperty` is never actually invoked by a plain assignment. Flagged as a follow-up task rather than chased here, since it's an unrelated engine feature (accessor descriptors created via the `Object.defineProperty` API specifically, not the property-write paths this round's fix touches).
- jQuery's own custom event-delegation system (`jQuery.fn.on`/`.trigger`, backed by `jQuery.event.trigger` — a large, self-contained reimplementation that does its own bubbling/handler-registry bookkeeping rather than delegating to native `dispatchEvent`) and `$(document).ready()` still don't work. These are a substantially larger, separate subsystem (jQuery's own event internals, not a simple DOM-API or JS-semantics gap) and weren't investigated this round.
- Verified the array-length fix doesn't regress: real `.push()`, plain object property assignment (non-array), array-literal initial length, a real `for`-loop building an array via indices, negative/non-numeric/decimal-looking keys (none of which are valid array indices, so `.length` correctly stays untouched), TypedArray indexed writes (a completely separate code path, unaffected), array destructuring/spread after manual growth, and `Array.isArray()`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | `document`/elements/text-nodes gain `nodeType`/`nodeName`; elements gain `ownerDocument` (backed by a new per-domTree document cache); `appendChild` flattens a `DocumentFragment`'s children into the target instead of inserting the fragment itself |
| `src/browser/js/interpreter.ts` | New shared `growArrayLengthIfNeeded()` helper, called from `evalAssignment`'s plain-`=` and compound-assignment branches and from `evalUpdate`'s `++`/`--` branch |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 2 new real-Electron regression checks |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 228/228 files, 9316/9316 tests passed
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Continued from the previous round's flagged jQuery selector-engine gap: built a step-by-step repro isolating `jQuery.find('.x', document)` (Sizzle itself) returning empty while `document.getElementsByClassName`/`querySelectorAll` both correctly worked — confirming the bug was inside Sizzle's own logic, not Nova's DOM APIs.
2. Tested Sizzle's own class-selector feature-detection snippet directly — it passed — ruling that out, then traced to Sizzle's separate `isXML()` document-type check and confirmed `jQuery.isXMLDoc(document)` incorrectly returned `true`.
3. Found the exact real check (`documentElement.nodeName !== "HTML"`) and confirmed `nodeName` didn't exist anywhere in Nova's DOM bindings; fixed it for document, elements, and text nodes; verified `jQuery('.x').length` went from `0` to `1`, then ran a broader functional check (`.text()`, `.addClass()`, `.each()`, `.attr()`, `.find()` all newly working).
4. That check surfaced `.append()` throwing; traced through jQuery's real `domManip`/`buildFragment` source to `c.ownerDocument||c` followed by `c.createDocumentFragment()`; confirmed `ownerDocument` didn't exist; fixed via a per-domTree document cache; re-tested and found `.append()` still needed the fragment-child-flattening behavior explicitly deferred in a prior round's `createDocumentFragment()` doc — implemented that too.
5. Re-running the full functional check found `.parent()`/`.children()` both returning `0` (not just wrong values); bisected through jQuery's `dir()`/`map()` internals down to `jQuery.map()` itself returning `[]}` for a real 1-element collection; built minimal repros that isolated the exact failing line (`g[g.length]=e`) independent of jQuery entirely, confirming a foundational `arr[i]=x` `.length`-growth bug.
6. Fixed with a shared helper across all three array-index write paths (`=`, compound-assignment, `++`/`--`); verified with a 17-case regression matrix covering the fix itself and every adjacent case that must remain unaffected (see Notes).
7. Found the pre-existing `Object.defineProperty` setter gap incidentally; confirmed via `git stash` that it predates this round's changes; flagged as a separate follow-up task rather than fixed here.
8. Added 2 permanent e2e regression checks, rebuilt, and ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck (catching and fixing one backtick-in-comment slip against the established harness gotcha along the way).
9. Cleaned up all temporary bisection/repro scripts.
