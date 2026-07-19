# Formatting Contexts — Block, Inline, Flex, List-Item, Anonymous Blocks

**Date:** 2026-07-18
**Session:** CSS formatting context model with margin collapsing, anonymous block generation
**Status:** Completed — integrated into layout engine

---

## Summary

Implemented the CSS formatting context model: `classifyDisplay()` and `classifyChildren()` for display type classification, `InlineFormattingContext` for inline/anonymous block generation, `FlexFormattingContext` for flex layout, and support for `list-item`, `inline-block`, and anonymous block wrapping.

## Architecture

```
formatting/
├── inline-context.ts    — InlineFormattingContext: line boxes, anonymous blocks
├── flex-context.ts      — FlexFormattingContext: flex items, main/cross axis
├── float-context.ts     — FloatContext: float placement, exclusion zones
├── line-break.ts        — Unicode UAX #14 line break opportunities
├── text-measure.ts      — Text measurement abstraction
└── stacking.ts          — StackingContext: CSS 2.2 Appendix E paint order
```

## Key Components

### 1. Display Classification (`formatting/classify.ts`)

```typescript
classifyDisplay(el: DomElement): DisplayType
classifyChildren(el: DomElement): ChildClassification[]
```

- Maps CSS `display` property to layout behavior
- Identifies block, inline, flex, grid, inline-block, list-item children
- Detects mixed content → triggers anonymous block wrapping

### 2. Anonymous Block Generation

When inline and block siblings are mixed, the CSS spec requires wrapping inline content in anonymous block boxes:

```html
<div>
  Text node          → anonymous block
  <p>Block element</p> → block box
  More text          → anonymous block
</div>
```

The `classifyChildren()` function identifies boundaries and creates anonymous wrappers.

### 3. Margin Collapsing

Adjacent block margins collapse per CSS §10.8.3:
- `margin-top` of first child collapses with parent's `margin-top`
- `margin-bottom` of last child collapses with parent's `margin-bottom`
- Adjacent siblings collapse (only the larger margin survives)

### 4. List-Item Support

- `display: list-item` elements get a marker box (bullet/number)
- Marker is positioned relative to the content box
- `list-style-type` and `list-style-position` respected

### 5. Inline-Block

- Generates a block box that participates in inline formatting
- Has full box model (margin, padding, border)
- Sized like a block but flows like inline content

## Files Created

| File | Purpose |
|------|---------|
| `formatting/inline-context.ts` | Inline formatting, line boxes, anonymous blocks |
| `formatting/flex-context.ts` | Flex layout algorithm |
| `formatting/classify.ts` | Display type classification |

## Integration

- `classifyDisplay()` and `classifyChildren()` are called from `layout-engine.ts`
- Anonymous blocks are inserted into the DOM tree during layout
- Layout engine dispatches to the appropriate formatting context based on display type
