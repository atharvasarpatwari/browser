# CSS Positioning — Static, Relative, Absolute, Fixed, Sticky

**Date:** 2026-07-18
**Session:** CSS positioning with containing block resolution and z-index stacking
**Status:** Completed — 37 tests passing, positioning.ts extracted

---

## Summary

Implemented CSS 2.2 positioning for all 5 position values: static, relative, absolute, fixed, and sticky. Extracted positioning logic to `positioning.ts` module. Added `getStackingLevel()` for z-index-based layer ordering. Updated paint engine for CSS z-index ordering.

## Key Implementations

### Position Values

| Value | Behavior |
|-------|----------|
| `static` | Default. No offset applied. |
| `relative` | Offset from normal position via `top`/`right`/`bottom`/`left`. Space preserved. |
| `absolute` | Removed from flow. Positioned relative to nearest positioned ancestor. |
| `fixed` | Removed from flow. Positioned relative to viewport. |
| `sticky` | Toggles between relative and fixed based on scroll position. |

### Containing Block Resolution

```typescript
function getContainingBlock(el: DomElement): DomElement | null
```

- For `absolute`: nearest ancestor with `position !== static`
- For `fixed`: viewport (root element)
- For `sticky`: nearest scrollable ancestor

### Inset Resolution

```typescript
function resolveInset(el: DomElement, containingBlock: LayoutBox): { top, left, width, height }
```

- `top`/`left` offset from containing block's content edge
- `bottom`/`right` offset from containing block's content edge
- Auto margins for centering

### Z-Index and Stacking Levels

```typescript
function getZIndex(el: DomElement): number
function getStackingLevel(el: DomElement): number
```

- `z-index` only applies to positioned elements (`position !== static`)
- Stacking level determines paint order in the paint engine

## Files Created/Modified

| File | Change |
|------|--------|
| `positioning.ts` | **NEW** — `getContainingBlock`, `resolveInset`, `getZIndex`, `getStackingLevel` |
| `layout-engine.ts` | Positioned element handling in block/inline layout |
| `paint-engine.ts` | CSS z-index-based layer ordering |

## Test Results

```
positioning.test.ts: 37 tests ✓
  - Static positioning (no offset)
  - Relative positioning (offset + space preserved)
  - Absolute positioning (nearest positioned ancestor)
  - Fixed positioning (viewport-relative)
  - Sticky positioning (scroll-based toggling)
  - Containing block resolution
  - Z-index ordering
  - Auto margins
```
