# Canvas 2D Graphics API — Implementation & Bug Fixes

**Date:** 2026-07-25
**Session:** Canvas 2D API creation and bug fixes
**Status:** Completed

---

## Summary

Implemented a full Canvas 2D Graphics API with software rasterizer, then fixed 9 test failures across transforms, stroke rendering, arc paths, text rendering, gradients, and alpha compositing. All 67 Canvas tests pass, 132/133 test files pass, 5899/5955 tests pass.

## Implementation

Created 7 source files implementing the HTML Canvas 2D API:

| File | Lines | Purpose |
|------|-------|---------|
| `canvas-types.ts` | ~90 | PathCommand union, CanvasContextState, DOMMatrix2DInit, ColorStop, TextMetrics |
| `canvas-path.ts` | ~115 | Path2D class — command buffer, clone, current position tracking, implicit moveTo for arc/ellipse |
| `canvas-gradient.ts` | ~154 | CanvasGradient — linear + radial, addColorStop, per-point color resolution |
| `canvas-pattern.ts` | ~80 | CanvasPattern — tiled image patterns with repeat modes |
| `canvas-context.ts` | ~1455 | CanvasRenderingContext2D — full implementation |
| `canvas-element.ts` | ~50 | HTMLCanvasElement — width/height, getContext('2d'), toDataURL, toBlob |
| `index.ts` | ~15 | Public exports |

### CanvasRenderingContext2D Features

- **State management**: save/restore with state stack, path stack, clip stack, transform stack
- **Transforms**: translate, rotate, scale, transform, setTransform, resetTransform (2D affine matrix)
- **Line dash**: setLineDash, getLineDash, lineDashOffset
- **Path operations**: moveTo, lineTo, quadraticCurveTo, bezierCurveTo, arc, arcTo, ellipse, rect, closePath
- **Fill/stroke**: scanline rasterizer with edge intersection sorting, nonzero winding
- **Stroke rendering**: thick line rasterization with quad-based scanline, line caps (butt/round/square)
- **Text**: fillText, strokeText, measureText via 8x8 bitmap font (ASCII 32-126)
- **Images**: drawImage (2/4/8 arg forms) with transform-aware blitting
- **Pixel data**: getImageData, putImageData, createImageData
- **Gradients**: linear and radial with per-pixel color resolution
- **Patterns**: tiled image with repeat/repeat-x/repeat-y/no-repeat
- **Clipping**: rectangular clip via intersection
- **PNG export**: toDataURL with minimal PNG encoder (stored-blocks zlib, CRC32, Adler32)
- **Alpha blending**: source-over compositing

## Root Causes (Bug Fixes)

### 1. Transform not saved/restored
**File:** `canvas-context.ts:259-275`
**Problem:** `save()`/`restore()` managed state, path, and clip stacks but NOT the transform matrix (`_a`-`_f`). After `translate()` + `save()` + `translate()` + `restore()`, the transform was lost.
**Fix:** Added `_transformStack` array. `save()` pushes `{a,b,c,d,e,f}`, `restore()` pops and restores.

### 2. Stroke edge-crossing boundary condition
**File:** `canvas-context.ts:1002`
**Problem:** `_drawThickLine` used `(ay <= scanY && by > scanY)` for edge intersection. When a stroke edge endpoint was exactly on the scanline boundary (e.g., 1px stroke at canvas edge), the intersection was missed, producing no visible pixels.
**Fix:** Changed to `(ay < scanY && by >= scanY) || (by < scanY && ay >= scanY)` — standard half-open interval for scanline rasterization.

### 3. Arc path missing implicit moveTo
**File:** `canvas-path.ts:53-60`
**Problem:** `Path2D.arc()` on an empty path didn't add an implicit `moveTo` to the arc's start point. The scanline rasterizer drew a line from (0,0) to the arc start, filling the entire area between the origin and the circle.
**Fix:** Added `if (this._commands.length === 0) { this.moveTo(startX, startY); }` before the arc command. Same for `ellipse()`.

### 4. Text baseline double-subtraction
**File:** `canvas-context.ts:506-517`
**Problem:** `fillText()` computed `startY` with baseline offset, then did `charY = startY - charH * scale`, subtracting the character height a second time. For alphabetic baseline: `charY = 8 - 6.4 - 8 = -6.4` instead of `charY = 0`.
**Fix:** Replaced with direct switch: `'top'→y`, `'middle'→y - charH*scale/2`, default `'alphabetic'→y - charH*scale`.

### 5. Gradient resolved once instead of per-pixel
**File:** `canvas-context.ts:457-486`
**Problem:** `fill()` resolved the fill style color once at `(0,0)` and used it for all pixels. Gradients/patterns need per-pixel resolution.
**Fix:** For string fill styles (solid colors), resolve once. For gradient/pattern objects, resolve per-pixel in the scanline callback.

### 6. ImageData missing colorSpace
**File:** `canvas-context.ts:614,636,653`
**Problem:** TypeScript `ImageData` requires `colorSpace` property. Object literals `{ data, width, height }` didn't include it.
**Fix:** Added `colorSpace: 'srgb'` to all ImageData returns. Used `new Uint8ClampedArray()` for pattern data to satisfy ArrayBuffer type constraints.

### 7. Blob Uint8Array type mismatch
**File:** `canvas-context.ts:670`
**Problem:** `new Blob([png])` failed because `Uint8Array<ArrayBufferLike>` wasn't assignable to `BlobPart`.
**Fix:** Cast via `png as unknown as ArrayBuffer`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/canvas/canvas-context.ts` | TypeScript fixes, transform save/restore, scanline boundary fix, text baseline fix, gradient per-pixel resolution |
| `src/browser/rendering/canvas/canvas-path.ts` | Implicit moveTo for arc/ellipse on empty path |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/rendering/canvas/canvas-types.ts` | Canvas 2D type definitions |
| `src/browser/rendering/canvas/canvas-path.ts` | Path2D class |
| `src/browser/rendering/canvas/canvas-gradient.ts` | CanvasGradient class |
| `src/browser/rendering/canvas/canvas-pattern.ts` | CanvasPattern class |
| `src/browser/rendering/canvas/canvas-context.ts` | CanvasRenderingContext2D |
| `src/browser/rendering/canvas/canvas-element.ts` | HTMLCanvasElement |
| `src/browser/rendering/canvas/index.ts` | Public exports |
| `tests/canvas2d.test.ts` | 67 tests across all features |

## Test Results

```
✓ tests/canvas2d.test.ts (67 tests)
  Test Files  1 passed (1)
  Tests       67 passed (67)

Full suite: 132 passed (133), 5899 passed (5955)
```

## Verification

1. `npx tsc --noEmit src/browser/rendering/canvas/index.ts` — clean compilation
2. `npx vitest run tests/canvas2d.test.ts` — 67/67 pass
3. `npx vitest run` — 5899/5955 pass (132/133 files)
