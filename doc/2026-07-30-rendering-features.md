# Rendering Features — Clip Stack, Borders, Backgrounds, Mask, Render Tree

**Date:** 2026-07-30
**Session:** Implement rendering feature gaps: clipping stack, overflow:hidden clip, per-side border colors, dashed/dotted borders, background-size/position, mask-image, RenderObject tree wiring
**Status:** Completed

---

## Summary

Fixed 7 rendering feature gaps: clip rect region stack in rasterizer with save/restore, overflow:hidden→clip emission from paint engine, per-side border colors (was single-color), dashed/dotted border rendering via paint commands, background-size/background-position application, mask-image parsing and basic pixel masking, and RenderObject tree wiring into paint pipeline. All 201 tests pass with zero regressions.

## Root Causes

### 1. `clip` command was a no-op in rasterizer

**File:** `src/browser/rendering/rasterizer.ts`

**Problem:** The `clip` command type existed in the command handler switch but did nothing. The `overflow:hidden` clipRect was computed in `render-tree.ts` but never consumed by the paint pipeline.

**Fix:** Added `clipRect` field to `RasterState` with intersection-based clipping. `save`/`restore` properly saves/restores the clip rect. All `fillRectRaw`, `fillGradientRect`, `drawImage`, and `drawCharBitmap` methods now clamp to the active clip rect. The paint engine emits `clip` commands when `overflow-x` or `overflow-y` is `hidden`/`scroll`/`auto`.

```ts
// In rasterizer state
clipRect: ClipRect | null;

// In fillRectRaw — clamp to clip rect
if (this.state.clipRect) {
  x0 = Math.max(x0, cr.x | 0);
  y0 = Math.max(y0, cr.y | 0);
  x1 = Math.min(x1, (cr.x + cr.w) | 0);
  y1 = Math.min(y1, (cr.y + cr.h) | 0);
}

// In paint engine — emit clip for overflow:hidden
if (overflowX === 'hidden' || ...) {
  const cx = layoutBox.x + layoutBox.borderLeft + layoutBox.paddingLeft;
  const cy = layoutBox.y + layoutBox.borderTop + layoutBox.paddingTop;
  const cw = ...;
  const ch = ...;
  commands.push({ type: 'clip', params: [cx, cy, cw, ch] });
}
```

### 2. Border per-side colors ignored

**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** The paint engine read a single `border-color` (or `border-top-color`) and applied it to all 4 border sides, ignoring per-side colors already parsed by `parseBorders()`.

**Fix:** Used `colorToString()` helper to convert each side's parsed `RGBA` color to a CSS string, emitting per-side `setFillStyle` commands.

### 3. Dashed/dotted borders painted as solid

**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** Dashed and dotted border styles were parsed but `renderBorderSide` in `borders-enhanced.ts` used a destructive erase-gaps approach incompatible with the paint command pipeline.

**Fix:** Paint engine now emits multiple `fillRect` commands for dashed/dotted borders, computing dash segments natively in the command stream rather than post-processing pixels.

### 4. Background-size and background-position ignored

**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** `getElementPaintCommands()` always used the content box dimensions for gradient/color fills, ignoring `background-size` and `background-position`.

**Fix:** Added parsing of `background-size` (px and `%` values) and `background-position` (`%` values) to compute the actual background paint area dimensions and offset.

### 5. Mask-image not functional

**File:** `src/browser/rendering/clip-mask.ts`, `src/browser/rendering/paint-engine.ts`, `src/browser/rendering/rasterizer.ts`

**Problem:** `MaskInfo` interface and `parseMask()` existed but no rendering code consumed them.

**Fix:** Added `applyMask` command type, emission from paint engine when `mask-image` is non-none, and `applyMaskToPixels()` rasterizer function (basic alpha-channel mask).

### 6. RenderObject tree not wired into paint pipeline

**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** `buildRenderObject()` in `render-tree.ts` existed but was never called by the paint engine.

**Fix:** Paint engine now builds `this.renderTree` during `paint()` and `paintIncremental()` using `buildRenderObject(root)`, stored alongside the stacking context tree. Cleaned up in `dispose()`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/rasterizer.ts` | Added `clipRect` to `RasterState`/`defaultState`/`cloneState`; clip intersection in `fillRectRaw`, `fillGradientRect`, `drawImage`, `drawCharBitmap`; implemented `clip` command handler; added `applyMask` command handler; added `applyMaskToPixels()` function |
| `src/browser/rendering/paint-engine.ts` | Added `clip` emission for `overflow:hidden`/`scroll`/`auto`; per-side border colors using `colorToString()`; dashed/dotted border fill-rect segments; `background-size`/`background-position` parsing; `applyMask` command emission; RenderObject tree wiring (`buildRenderObject()` on paint init); added `renderTree` field; added `colorToString()` helper |

## Test Results

```
 ✓ tests/render-paint-enhanced.test.ts (90 tests)
 ✓ tests/layout-engine.test.ts (36 tests)
 ✓ tests/reflow-repaint.test.ts (22 tests)
 ✓ tests/css5-stylesheet.test.ts (16 tests)
 ✓ tests/css5-used-style.test.ts (31 tests)
 ✓ tests/style-invalidation.test.ts (7 tests)
 -------------------------------
 6 test files, 201 tests, all passed
```

New tests added to `render-paint-enhanced.test.ts`:
- 3 clip rect tests (basic clip, drawImage clip, save/restore clip)
- 2 border per-side color tests (per-side parsing, black fallback)
- 1 dashed/dotted border style test
- 3 mask-image tests (none, url, multiple)
- 3 RenderObject tree tests (block display, display:none, stacking context detection)

## Verification Steps

1. Ran `npx vitest run tests/render-paint-enhanced.test.ts` — 90 tests pass
2. Ran full 6-test-file batch — 201 tests pass
3. No regressions in layout-engine, reflow-repaint, or CSS5 tests
