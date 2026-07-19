# Layout Engine Rewrite — CSS Box Model, Borders, Unit Resolution

**Date:** 2026-07-18
**Session:** Complete rewrite of the layout engine with proper CSS box model
**Status:** Completed — 36 layout tests + 86 CSS tests passing

---

## Summary

Rewrote `layout-engine.ts` from scratch to implement the CSS box model properly: named font sizes, `resolveLength()` with em/rem/% units, `resolveFontSize()`, `resolveLineHeight()`, `parseBorderWidth()`, `box-sizing: content-box | border-box`, block/inline layout, text node handling, and `position: relative` with `top`/`left` offsets.

## Key Implementations

### 1. Unit Resolution

```typescript
resolveLength(value: string, context: LengthContext): number
```

- `px` → direct numeric conversion
- `em` → relative to parent font size
- `rem` → relative to root font size
- `%` → relative to containing block width/height
- Named font sizes: `xx-small` through `xx-large`, `smaller`, `larger`
- Negative values clamped to 0 for widths/heights

### 2. Box Sizing

```typescript
function resolveWidth(el: DomElement, contentWidth: number): number
function resolveHeight(el: DomElement, contentHeight: number): number
```

- `content-box` (default): width = content + padding + border
- `border-box`: width = declared width (content = width - padding - border)

### 3. Border Fields on LayoutBox

**File:** `src/browser/rendering/dom-tree.ts`

Added to `LayoutBox` interface:
```typescript
borderTopWidth: number;
borderRightWidth: number;
borderBottomWidth: number;
borderLeftWidth: number;
```

### 4. Block Layout Algorithm

```
For each block-level child:
  1. Compute child width (resolveLength from computedStyle)
  2. Apply box-sizing
  3. Compute child height (auto or resolved)
  4. Position child at (x + paddingLeft, y + accumulatedHeight)
  5. Accumulate height + margin
  6. Apply margin collapsing
```

### 5. Inline/Text Layout

- Text nodes: measure text, create `InlineLevelBox` with `TextRun` data
- White-space collapsing per CSS Text Module Level 3
- Line wrapping at content box boundaries

### 6. Named Font Sizes

Map from CSS named sizes to pixel values:
```
xx-small: 9px, x-small: 10px, small: 13px, medium: 16px,
large: 18px, x-large: 24px, xx-large: 32px
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | Complete rewrite |
| `src/browser/rendering/dom-tree.ts` | Added `borderTopWidth` etc. to `LayoutBox` |
| `src/browser/rendering/paint-engine.ts` | Background in content+padding area, `paintBorders()`, opacity |

## Test Results

```
layout-engine.test.ts: 36 tests ✓ (box model, units, sizing, borders)
css5.test.ts:          86 tests ✓ (CSS parsing/cascade still working)
```
