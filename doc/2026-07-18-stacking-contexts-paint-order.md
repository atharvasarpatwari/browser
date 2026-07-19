# Stacking Contexts & Paint Order — CSS 2.2 Appendix E

**Date:** 2026-07-18
**Session:** CSS 2.2 Appendix E stacking context tree, 7-layer paint order, z-index ordering
**Status:** Completed — 26 tests passing

---

## Summary

Implemented the CSS 2.2 Appendix E stacking context model. The stacking context tree is built from the DOM tree during layout, organizing elements into layers based on `z-index`, `opacity`, `position`, and `float`. The paint engine renders elements in 7-layer order per the CSS 2.2 specification.

## 7-Layer Paint Order (per stacking context)

| Layer | Content |
|-------|---------|
| 1 | Background and borders of the element forming the context |
| 2 | Child stacking contexts with negative z-index |
| 3 | In-flow, non-inline-level, non-positioned descendants |
| 4 | Non-positioned floats |
| 5 | In-flow, inline-level, non-positioned descendants |
| 6 | Child stacking contexts with z-index: 0 and positioned descendants with z-index: 0 |
| 7 | Child stacking contexts with positive z-index |

## Key Implementations

### Stacking Context Creation

An element creates a new stacking context when:
- `position` is `relative`/`absolute`/`fixed` AND `z-index` is not `auto`
- `opacity` < 1
- `transform`, `filter`, `will-change` are set (future)

### Tree Building

```typescript
function buildStackingContextTree(root: DomNode): StackingContext
```

Recursive traversal of the DOM tree. Each element is either:
- Added to the current stacking context (if it doesn't create one)
- Creates a child stacking context (if it does)

### Rendering

```typescript
function renderStackingContext(ctx: StackingContext, painter: Painter): void
```

Walks the tree in document order, rendering each context's 7 layers in sequence.

## Files Created

| File | Purpose |
|------|---------|
| `formatting/stacking.ts` | StackingContext, buildStackingContextTree, renderStackingContext |

## Test Results

```
stacking.test.ts: 26 tests ✓
  - Negative z-index renders below content
  - Positive z-index renders above content
  - Opacity creates stacking context
  - Float elements in layer 4
  - Inline elements in layer 5
  - Nested stacking contexts
  - Document order within same z-index
```
