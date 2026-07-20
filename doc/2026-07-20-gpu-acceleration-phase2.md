# GPU Acceleration Phase 2 — Shaders, Readback, PaintEngine Integration

**Date:** 2026-07-20
**Session:** GPU acceleration Phase 2
**Status:** Completed

---

## Summary

Extended the GPU acceleration infrastructure with drawImage and fillText compute shaders, double-buffered async readback, and full PaintEngine integration. GpuRasterizer now handles all PaintCommand types (fillRect, clearRect, strokeRect, fillText, strokeText, drawImage) with automatic software fallback. PaintEngine accepts `hardwareAcceleration` config and dynamically selects the appropriate rasterizer.

## Changes Made

### 1. Uniform Buffer Overflow Fix
**File:** `src/browser/rendering/gpu/compute-ops.ts`
**Problem:** `fillText()` allocated 44-byte uniform buffer but wrote 12 fields × 4 bytes = 48 bytes, causing `RangeError: Offset is outside the bounds of the DataView`
**Fix:** Changed `new ArrayBuffer(44)` to `new ArrayBuffer(48)`

### 2. GPUAllowSharedBufferSource Type Error
**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
**Problem:** `queue.writeBuffer()` rejected `Uint8ClampedArray` as `GPUAllowSharedBufferSource`
**Fix:** Copy image data into a fresh `ArrayBuffer` before passing to `writeBuffer()`

### 3. PaintCmd Type Mismatch
**File:** `src/browser/rendering/paint-engine.ts:232`
**Problem:** `renderStackingContext()` returns `PaintCmd[]` but `allCommands` is `PaintCommand[]`
**Fix:** Added type assertion `as PaintCommand[]`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | Full rewrite: DoubleBuffer class for double-buffered readback, execGpu() dispatches all command types, async init with software fallback |
| `src/browser/rendering/gpu/compute-ops.ts` | Added drawImage() and fillText() operations, ensureFontAtlas() for 95-char bitmap font, createUniformBuffer() and dispatchCompute() helpers |
| `src/browser/rendering/gpu/shader-modules.ts` | Added DRAW_IMAGE_SHADER (nearest-neighbor scaling, source-over blending) and FILL_TEXT_SHADER (8x8 bitmap atlas, textAlign support) |
| `src/browser/rendering/paint-engine.ts` | Added GpuRasterizer import, hardwareAcceleration to PaintConfig, createRasterizer() factory, rasterize() uses instance rasterizer, resize/updateConfig re-create rasterizer |

## Files Created

| File | Purpose |
|------|---------|
| `tests/setup-gpu.ts` | WebGPU test globals for Dawn polyfill |

## Test Results

```
61 tests | 61 passed | 0 failed (gpu-rasterizer.test.ts)
```

## Key Design Decisions

1. **Double-buffered readback**: `DoubleBuffer` class manages two GPU buffers; swap after each frame to overlap async GPU work with CPU readback
2. **Software fallback always present**: GpuRasterizer internally creates a Rasterizer; if GPU unavailable, falls back silently
3. **Font atlas on GPU**: 95 ASCII chars × 8 bytes = 760-byte STORAGE buffer for fillText compute shader
4. **strokeRect as fillRect sequences**: GPU strokeRect dispatches 4 fillRect calls (top, bottom, left, right edges)

## Known Limitations

- `readBackStaging()` returns software fallback because `mapAsync` cannot be awaited in synchronous `rasterize()`; needs async rasterize() or polling in a future phase
- fillText only supports ASCII printable characters (32-126); non-ASCII falls back to '?'
- drawImage uses nearest-neighbor scaling only; bilinear filtering deferred to Phase 3
