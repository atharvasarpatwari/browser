# Add `getElementsByClassName` to DOM tree and JS bindings

**Date:** 2026-07-26
**Session:** Add getElementsByClassName support
**Status:** Completed

---

## Summary

Added `getElementsByClassName(names: string)` method to the `DomTree` class with BFS traversal, wired it to the JS engine via both document and element bindings, and added the mock stub for tests.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | Added `getElementsByClassName` to `IDomTree` interface and `DomTree` class |
| `src/browser/js/dom-bindings.ts` | Added JS bindings on document and element wrappers |
| `tests/js-builtins.test.ts` | Added `getElementsByClassName` stub to `makeMinimalDomTree` |

## Implementation Details

### DomTree method (`dom-tree.ts:209-227`)
- Parses space-separated class names into a token set
- BFS-traverses from `bodyElement` (falls back to `htmlElement`)
- Returns elements whose `class` attribute contains **all** tokens

### Document binding (`dom-bindings.ts:152-159`)
- Calls `domTree.getElementsByClassName(names)` and wraps results

### Element binding (`dom-bindings.ts:601-614`)
- BFS within the element's subtree only (excludes the element itself)
- Matches against the token set parsed from the `class` attribute

## Test Results

```
 ✓ tests/js-builtins.test.ts (115 tests) 161ms
 Tests  115 passed (115)
```
