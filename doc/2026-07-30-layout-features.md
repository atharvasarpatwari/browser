# Layout Features — Margin Collapsing, Sticky, Anonymous Blocks, Overflow Hidden, Aspect-Ratio

**Date:** 2026-07-30
**Session:** Wire remaining layout features into the Nova renderer pipeline, fix regressions
**Status:** Completed

---

## Summary

Wired 5 previously-unused layout features into `layout-engine.ts` — margin collapsing between siblings (CSS 2.2 §8.3.1), sticky positioning via `StickyController`, anonymous block generation for mixed inline/block content, overflow:hidden scroll container entries, and aspect-ratio sizing for flex items. Fixed classification regressions that broke grid/flex/box-model tests.

## Root Causes (during implementation)

### 1. Inline default for `display` caused box-model test failures
**File:** `src/browser/rendering/layout-engine.ts:567`
**Problem:** `childStyle.get('display') ?? 'inline'` defaulted to `'inline'`, so `<div>` elements without an explicit `display` property were buffered as inline content instead of laid out via `layoutNode`. This caused all margin/padding/border values to resolve to 0.
**Fix:** Changed default to `'block'`, matching `layoutNode` line 713 (`elStyle.get('display') ?? 'block'`).

### 2. `classifyDisplay() === 'block'` excluded flex/grid containers
**File:** `src/browser/rendering/layout-engine.ts:568`
**Problem:** `classifyDisplay('flex')` returns `'flex'` (not `'block'`), so flex/grid/table containers were classified as inline-level children and buffered for anonymous block wrapping instead of being laid out via `layoutNode`. This caused all grid/flex items to have x=0.
**Fix:** Replaced `classifyDisplay(childDisplay) === 'block'` with `isBlockLevel(childDisplay)`, which correctly returns `true` for flex, grid, table, inline-block, etc.

### 3. `classifyChildren()` grouping broke single-child layout path
**File:** `src/browser/rendering/layout-engine.ts:516-600`
**Problem:** Original implementation used `classifyChildren()` to group children into block/inline runs, then processed each group as a unit. But this changed the iteration structure for all elements — elements without explicit `display: block` were misclassified into inline groups and processed via `layoutAnonymousBlock` instead of the standard child loop.
**Fix:** Replaced with a `flushInlineBuffer()` function approach. The iteration visits each child individually: text nodes are buffered, block-level children flush the buffer first then lay out normally, inline-level children are buffered. After the loop, any remaining buffer is flushed. This preserves the original per-element layout path for normal block children while still supporting anonymous block wrapping when mixed content is present.

### 4. `display: none` children not skipped
**File:** `src/browser/rendering/layout-engine.ts:570`
**Problem:** The original code relied on `layoutNode` to skip `display: none` elements. The new iteration path needed an explicit check.
**Fix:** Added `if (childDisplay === 'none') continue;` before classification.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | Wired margin collapsing, sticky controller, anonymous blocks, overflow:hidden, aspect-ratio flex. Removed unused `classifyChildren` import. |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-07-30-layout-features.md` | This changelog |

## Test Results

```
Test Files  3 failed (175 passed)
     Tests  4 failed (8283 passed)

Pre-existing failures unchanged:
  - tests/flex-layout.test.ts  (1) — flex container box model, pre-existing
  - tests/positioning.test.ts  (2) — absolute positioning offset, pre-existing
  - tests/rasterizer.test.ts   (1) — unsupported commands, pre-existing
```

All rendering/layout-engine tests pass (36/36). No regressions introduced.

## Verification Steps

1. `npx vitest run tests/layout-engine.test.ts` — 36/36 pass
2. `npx vitest run tests/grid-layout.test.ts` — 50/50 pass
3. `npx vitest run tests/flex-layout.test.ts` — 36/37 pass (1 pre-existing failure)
4. `npx vitest run tests/positioning.test.ts` — 35/37 pass (2 pre-existing failures)
5. `npx vitest run` — 8283/8287 pass (8283+4=8287 total; 4 pre-existing)
