# WHATWG/W3C Spec Adherence — Phase 1 Complete (querySelector + Event Propagation)

**Date:** 2026-07-19
**Session:** Phase 1 completion — querySelector/querySelectorAll wiring and JS event propagation
**Status:** Completed

---

## Summary

Completed the final two Phase 1 items: wired CSS5 selector engine into DomTree for querySelector/querySelectorAll, and upgraded JS bridge event dispatch from flat (target-only) to full three-phase (capture → target → bubble) propagation. Fixed HTML parser bug that dropped unknown elements. Total: 82 test files, 3481 tests, all green.

## Root Causes

### 1. querySelector/querySelectorAll Stubs
**File:** `src/browser/rendering/dom-tree.ts:153-158`
**Problem:** `querySelector()` and `querySelectorAll()` were no-op stubs returning `null`/`[]`, even though the CSS5 selector engine (`css5/selector.ts`) was fully implemented with matching, BFS traversal, and all selector types.
**Fix:** Added `SelectableDomNode` adapter class that wraps `DomElement` to satisfy the `SelectableElement` interface. Uses `WeakMap` cache for identity stability (required for sibling combinators `indexOf`). `DomTree.querySelector()` and `querySelectorAll()` now delegate to CSS5 engine. Searched from `bodyElement` (or `htmlElement` as fallback).

### 2. HTML Parser Drops Unknown Elements
**File:** `src/browser/rendering/html5/modes/body.ts:435`
**Problem:** The "in body" insertion mode's `inBodyStartTag` function had no default case for unknown elements (like `<span>`). It just called `ctx.parseError(token)` and dropped the element entirely. Per WHATWG §13.2.6.7, "Any other start tag" should reconstruct active formatting elements and insert an HTML element.
**Fix:** Changed the fallthrough from `ctx.parseError(token)` to:
```typescript
ctx.reconstructActiveFormattingElements();
ctx.insertHTMLElement(token);
```

### 3. Flat Event Dispatch (No Propagation)
**File:** `src/browser/js/dom-bindings.ts:382-402`
**Problem:** `dispatchEvent` only invoked listeners registered on the target element itself. No capture/bubble phases, no ancestor chain traversal. `addEventListener` didn't support capture option. `stopPropagation`/`preventDefault` were no-ops.
**Fix:** Complete rewrite of event infrastructure:
- Shared `WeakMap<DomNode, DomListenerEntry[]>` replaces per-element closure maps
- `DomListenerEntry` stores `{ type, fn, capture, once, thisArg }`
- `addEventListener` now accepts third arg (boolean for capture, or options object with capture/once)
- `dispatchEvent` implements full three-phase propagation:
  - **Capture phase**: walks ancestor chain root→target, fires capture listeners
  - **Target phase**: fires all listeners (both capture and non-capture)
  - **Bubble phase**: walks ancestor chain target→root, fires non-capture listeners (only if `bubbles`)
- `createEventObject` now includes working `stopPropagation()`, `stopImmediatePropagation()`, `preventDefault()`, `bubbles`, `cancelable`, `eventPhase`
- Document-level `addEventListener`/`dispatchEvent` upgraded to same shared infrastructure

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | Added `SelectableDomNode` adapter, `toSelectable()` method with WeakMap cache, implemented `querySelector()`/`querySelectorAll()` delegating to CSS5 engine |
| `src/browser/rendering/html5/modes/body.ts` | Changed fallthrough in `inBodyStartTag` from `parseError` to `reconstructActiveFormattingElements` + `insertHTMLElement` |
| `src/browser/js/dom-bindings.ts` | Rewrote event system: shared WeakMap listener storage, capture/bubble in addEventListener, three-phase dispatchEvent, working stopPropagation/preventDefault, added `document.createEvent()` |
| `tests/js-engine.test.ts` | Added 10 event propagation tests (fire, order, remove, bubble, capture, full-cycle, stopPropagation, preventDefault, target/currentTarget) |
| `tests/dom-tree.test.ts` | Added 15 querySelector/querySelectorAll tests (tag, ID, class, descendants, child combinator, attribute, multi-match) |

## Test Results

```
Test Files:  82 passed (82)
Tests:       3481 passed (3481)
```

New test additions:
- 15 querySelector/querySelectorAll tests on DomTree
- 10 event propagation tests via JS engine (capture, bubble, full cycle, stopPropagation, preventDefault, eventPhase, target/currentTarget)
- 2 createEventObject tests (bubbles/cancelable options)

## Phase 1 Complete — All 6 Items

| # | Item | Status |
|---|------|--------|
| 1.1 | Capture phase bug (events.ts) | Done (previous session) |
| 1.2 | CSS specificity comparison (css5/parser.ts) | Done (previous session) |
| 1.3 | Regex literal lexing (js/lexer.ts) | Done (previous session) |
| 1.4 | Template literal `${expr}` interpolation | Done (previous session) |
| 1.5 | querySelector/querySelectorAll wiring | Done (this session) |
| 1.6 | JS event propagation wiring | Done (this session) |
