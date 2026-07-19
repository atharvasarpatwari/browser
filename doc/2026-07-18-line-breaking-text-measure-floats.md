# Line Breaking, Text Measurement, and Float Handling

**Date:** 2026-07-18
**Session:** Text layout, line breaking, and CSS float layout
**Status:** Completed — integrated into layout and paint engines

---

## Summary

Implemented three text/layout modules: Unicode UAX #14 line break opportunity detection (`line-break.ts`), text measurement abstraction (`text-measure.ts`), and CSS float layout with exclusion zones (`float-context.ts`). Floats are fully integrated into the layout engine.

## 1. Line Breaking (`formatting/line-break.ts`)

Unicode Text Auxiliary Document #14 line break opportunities:

- Mandatory breaks: `\n`, `\r`, `\r\n`
- Break-after characters: `.!?:;` (Western punctuation)
- Break-before characters: `(` `[` `{` (opening brackets)
- No-break: inside words, after hyphens, between digits and punctuation
- CJK character boundaries (every character is a break opportunity)
- `white-space: nowrap` suppresses all breaks
- `word-break: break-all` allows breaks anywhere

## 2. Text Measurement (`formatting/text-measure.ts`)

Abstract text measurement interface:

```typescript
interface TextMeasurer {
  measureText(text: string, fontSize: number, fontFamily: string): TextMetrics;
  splitIntoLines(text: string, maxWidth: number, fontSize: number): string[];
}

interface TextMetrics {
  width: number;
  height: number;
  baseline: number;
}
```

- Used by `InlineFormattingContext` to determine line breaks
- Default implementation uses approximate character-width estimation
- Pluggable for future integration with actual font metrics

## 3. Float Handling (`formatting/float-context.ts`)

CSS float layout with exclusion zones:

```typescript
class FloatContext {
  placeFloat(box: LayoutBox, availableWidth: number): FloatPlacement;
  getExclusionZones(): ExclusionZone[];
  getAvailableWidth(y: number, height: number): number;
  clearFloats(direction: 'left' | 'right' | 'both'): void;
}
```

### Float Placement Algorithm

```
1. For each float element (in source order):
   a. Find the highest available position where the float fits
   b. Push against the left or right edge of the containing block
   c. Register an exclusion zone
2. Subsequent content flows around exclusion zones
3. `clear: left/right/both` moves content below the relevant float
```

### Exclusion Zones

```typescript
interface ExclusionZone {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'left' | 'right';
}
```

Content layout checks available width at each y-position, accounting for float exclusion zones.

## Files Created

| File | Purpose |
|------|---------|
| `formatting/line-break.ts` | UAX #14 line break detection |
| `formatting/text-measure.ts` | Text measurement abstraction |
| `formatting/float-context.ts` | Float placement + exclusion zones |

## Files Modified

| File | Change |
|------|--------|
| `layout-engine.ts` | Float handling in block layout, clear property support |

## Integration

- `FloatContext` is instantiated per block formatting context
- Floats are detected during child classification (`classifyChildren`)
- After block children are laid out, float placement adjusts exclusion zones
- Subsequent content queries `getAvailableWidth()` to avoid float overlap
