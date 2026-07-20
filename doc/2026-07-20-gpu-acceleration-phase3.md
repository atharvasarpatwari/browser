# GPU Acceleration Phase 3 — Async Rasterize & Resize

**Date:** 2026-07-20
**Session:** GPU acceleration Phase 3
**Status:** Completed

---

## Summary

Added async rasterize path (`rasterizeAsync()`) that performs real GPU-to-CPU readback via `mapAsync()`, fixed GpuRasterizer resize, and cleaned up pre-existing type issues. The sync `rasterize()` continues to return software fallback pixels (GPU commands are submitted but readback can't complete synchronously). The async path is the correct way to get GPU-rendered pixels.

## Changes Made

### 1. Async Rasterize (`rasterizeAsync()`)
**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
**Problem:** `readBackStaging()` attempted sync `mapAsync()` which always fell back to software
**Fix:** 
- Added `rasterizeAsync()` method that `await`s `staging.mapAsync(GPUMapMode.READ)` for real GPU pixels
- Renamed `readBackStaging()` → `readBackStagingAsync()` with proper async/await
- Sync `rasterize()` now cleanly returns software fallback without attempting broken sync readback

### 2. Software Rasterizer Async API
**File:** `src/browser/rendering/rasterizer.ts`
**Problem:** `IPaintEngine` needed `rasterizeAsync()` but software `Rasterizer` had no async method
**Fix:** Added `rasterizeAsync()` to `Rasterizer` that wraps `rasterize()` in a resolved Promise

### 3. PaintEngine Async Support
**File:** `src/browser/rendering/paint-engine.ts`
**Fix:** 
- Added `rasterizeAsync()` to `IPaintEngine` interface
- Implemented `rasterizeAsync()` in `PaintEngine` class that delegates to the rasterizer's async method

### 4. GpuRasterizer Resize
**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
**Problem:** `resize()` was a no-op, making viewport changes impossible
**Fix:** Full resize implementation — disposes old DoubleBuffer, recreates software fallback, reallocates GPU buffers

### 5. Pre-existing Bug Fixes
**File:** `src/browser/rendering/rasterizer.ts`
- Removed duplicate `'gray'` key in NAMED_COLORS (line 49 was duplicate of line 26)
- Removed duplicate `'orange'` key in NAMED_COLORS (line 60 was duplicate of line 40)

**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
- Fixed `GPUAllowSharedBufferSource` type error: copy image data to fresh `ArrayBuffer` before `writeBuffer()`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | Added `rasterizeAsync()`, `readBackStagingAsync()`, full `resize()`, fixed writeBuffer type |
| `src/browser/rendering/rasterizer.ts` | Added `rasterizeAsync()`, removed duplicate color keys |
| `src/browser/rendering/paint-engine.ts` | Added `rasterizeAsync()` to interface and implementation |

## Test Results

```
68 tests | 68 passed | 0 failed (gpu-rasterizer.test.ts)
Full suite: 88 passed | 3904 tests passed (1 pre-existing failure in crash-recovery)
```

## Key Design Decisions

1. **Dual API**: Sync `rasterize()` for backward compat (returns software pixels), async `rasterizeAsync()` for real GPU readback
2. **DoubleBuffer swap order**: Swap happens after `copyToStaging` submit but before readback, so next frame's GPU work targets the other buffer
3. **Resize rebuilds everything**: Software fallback, DoubleBuffer, and GPU resources all recreated on resize to avoid stale state
