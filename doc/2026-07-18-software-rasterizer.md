# Software Rasterizer

**Date:** 2026-07-18
**Session:** Software rasterizer — CSS color parser, 8×8 bitmap font, alpha compositing, state stack
**Status:** Completed — 56 tests passing

---

## Summary

Implemented a software rasterizer that converts `PaintCommand[]` to `ImageData`. Includes a full CSS color parser, 8×8 bitmap font for text rendering, alpha compositing over white background, and a graphics state stack.

## Key Implementations

### CSS Color Parser (`parseColor`)

```typescript
function parseColor(color: string): [number, number, number, number] | null
// Returns [r, g, b, a] — all 0-255, alpha 0-255
```

- Named colors (148 CSS named colors)
- Hex: `#rgb`, `#rrggbb`, `#rrggbbaa`
- `rgb()` / `rgba()` functions
- HSL / HSLA functions
- `transparent`, `currentColor`

### 8×8 Bitmap Font

Each ASCII character (32-126) encoded as 8 bytes (8×8 bitmap). The rasterizer renders text by blitting individual character bitmaps to the pixel buffer.

```typescript
function drawChar(ctx: PixelBuffer, char: string, x: number, y: number,
                  color: [number, number, number, number], scale: number): void
```

### Alpha Compositing

Source-over compositing over the destination buffer:

```
out_a = src_a + dst_a * (1 - src_a)
out_r = (src_r * src_a + dst_r * dst_a * (1 - src_a)) / out_a
```

Background defaults to opaque white `(255, 255, 255, 255)`.

### Graphics State Stack

```typescript
save()  // push current transform, clip, styles
restore() // pop previous state
```

Supports nested save/restore for transforms and clipping.

### Rasterizer Class

```typescript
class Rasterizer {
  clear(color?: string): void
  fillRect(x, y, w, h, color): void
  strokeRect(x, y, w, h, color, lineWidth): void
  drawText(text, x, y, font, color): void
  drawImage(imageData, x, y, w, h): void
  getImageData(x, y, w, h): ImageData
  getPixels(): Uint8ClampedArray
}
```

## Files Created

| File | Purpose |
|------|---------|
| `rasterizer.ts` | Rasterizer class, parseColor, bitmap font, compositing |

## Test Results

```
rasterizer.test.ts: 56 tests ✓
  - Color parsing (named, hex, rgb, rgba, hsl, transparent)
  - fillRect / strokeRect
  - Text rendering (8×8 bitmap font)
  - Alpha compositing
  - save/restore state stack
  - drawImage
  - Clear to arbitrary color
  - Edge cases (out-of-bounds, zero-size)
```
