# WebGPU Submit-Time Buffer Destroy Fix

**Date:** 2026-08-02
**Session:** Fix "used in submit while destroyed" WebGPU validation errors caused by destroying buffers before `queue.submit()`.
**Status:** Completed

---

## Summary

The GPU rasterizer was destroying uniform/character/image buffers immediately after encoding compute passes but before `queue.submit()`. WebGPU validation rejects this (`[Buffer (unlabeled)] used in submit while destroyed` at `gpu_device.cc:371`) because buffers must remain alive while referenced by a submitted command list. Buffers are now deferred and destroyed only after `queue.onSubmittedWorkDone()` resolves.

## Root Causes

### 1. Premature `uniformBuffer.destroy()` in `ComputeOps`

**File:** `src/browser/rendering/gpu/compute-ops.ts`
**Problem:** All six compute operations (`fillRect`, `clearRect`, `composite`, `compositeWithOffset`, `drawImage`, `fillText`) called `uniformBuffer.destroy()` right after `dispatchCompute(...)`. The command encoder still referenced the uniform buffer, and the encoder was submitted later by `GpuRasterizer` — so the buffer was destroyed before (and while) it was in a submitted command list.

**Fix:** Replaced `uniformBuffer.destroy()` with `this.deferDestroy(uniformBuffer)` which appends to a `pendingDestroy` array. Added `takePendingDestroy()` so the submit site can hand off and destroy the buffers after the queue completes the work. `dispose()` destroys any leftover pending buffers:

```ts
private deferDestroy(buffer: GPUBuffer): void {
  this.pendingDestroy.push(buffer);
}

takePendingDestroy(): GPUBuffer[] {
  const pending = this.pendingDestroy;
  this.pendingDestroy = [];
  return pending;
}
```

### 2. Premature `charBuffer.destroy()` / `imageBuffer.destroy()` in `GpuRasterizer`

**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts`
**Problem:** `gpuFillText()` destroyed `charBuffer` and `gpuDrawImage()` destroyed `imageBuffer` immediately after encoding, but the encoder (and therefore those buffers) was submitted later.

**Fix:** Both buffers are now pushed onto a new `pendingDestroy: GPUBuffer[]` field and destroyed after the submit completes. All five raw `this.device.queue.submit([encoder.finish()])` call sites now route through a new `submitEncoder()` helper that collects both its own pending buffers and `computeOps.takePendingDestroy()`, submits, then destroys everything after `onSubmittedWorkDone()`:

```ts
private submitEncoder(encoder: GPUCommandEncoder): void {
  if (!this.device) return;
  const commandBuffer = encoder.finish();
  const pending = [
    ...this.pendingDestroy,
    ...(this.computeOps?.takePendingDestroy() ?? []),
  ];
  this.pendingDestroy = [];

  this.device.queue.submit([commandBuffer]);

  if (pending.length === 0) return;
  const queue = this.device.queue;
  queue.onSubmittedWorkDone()
    .then(() => {
      for (const buffer of pending) buffer.destroy();
    })
    .catch(() => {
      for (const buffer of pending) buffer.destroy();
    });
}
```

### 3. Layer buffer returned to pool while in-flight

**File:** `src/browser/rendering/gpu/gpu-rasterizer.ts` — `rasterizeLayerToBuffer()`
**Problem:** The temporary layer buffer was `bufferPool.release()`d right after submit; if the pool was full, `returnToPool` → `destroyEntry` would destroy it while still referenced by the submitted command list.
**Fix:** The layer buffer is now pushed onto `pendingDestroy` (destroyed by `submitEncoder` after the submit completes) instead of being returned to the pool.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/gpu/compute-ops.ts` | Added `pendingDestroy` list, `deferDestroy()`, `takePendingDestroy()`; 6 uniform-buffer destroy sites now deferred; `dispose()` clears pending. |
| `src/browser/rendering/gpu/gpu-rasterizer.ts` | Added `pendingDestroy` field + `submitEncoder()` helper; 5 submit sites route through it; `charBuffer`/`imageBuffer`/layer buffer deferred; `dispose()` clears pending. |
| `tests/browser/rendering/gpu-rasterizer.test.ts` | Added regression test: uniform buffers must not be destroyed before submit; destroyed only after work-done resolves. |

## Files Created

| File | Purpose |
|------|---------|
| `C:\Users\athar\AppData\Local\Temp\opencode\webgpu-check.cjs` | Runtime probe capturing console/page errors while navigating data-URI pages that exercise canvas/fillText/drawImage. |

## Test Results

```
npx tsc --noEmit
  -> only the 10 pre-existing src/browser/js/* errors (no new errors)

npx vitest run tests/browser/rendering/gpu-rasterizer.test.ts
  Test Files  1 passed (1)
  Tests       68 passed (68)   <- includes new deferred-destroy regression test

npx vitest run tests/browser/rendering
  Test Files  1 passed (1)
  Tests       68 passed (68)

npx eslint src/browser/rendering/gpu/compute-ops.ts src/browser/rendering/gpu/gpu-rasterizer.ts tests/browser/rendering/gpu-rasterizer.test.ts
  -> 0 errors, 2 pre-existing warnings (test mock helpers)

npm run build:web
  -> ✓ built in ~1s (244 modules)

npm run test:electron
  -> 2 passed (electron-smoke + keep-alive, 13.0s)

node C:\Users\athar\AppData\Local\Temp\opencode\webgpu-check.cjs
  -> GPU_ERROR_COUNT 1 (only pre-existing soft-fallback: "GPUBufferUsage is not defined" -> software fallback)
     PAGE_ERROR_COUNT 0, no "used in submit while destroyed" errors
     PROBE {"running":true,...}
```

## Verification Steps

1. `npx tsc --noEmit` — confirmed no new type errors.
2. `npx vitest run tests/browser/rendering` — 68/68 pass, including the new deferred-destroy test that asserts a uniform buffer is NOT destroyed while un-submitted and IS destroyed only after `onSubmittedWorkDone()`.
3. `npx eslint` on the 3 changed files — 0 errors.
4. `npm run build:web` — static production bundle builds cleanly.
5. `npm run test:electron` — both e2e specs pass (app still launches, stays open, health probe responsive).
6. Live run via `webgpu-check.cjs`: navigated `nova://settings` plus three data-URI pages exercising canvas `fillRect`/`fillText`/`drawImage`. No "used in submit while destroyed" errors captured; only the pre-existing `GPUBufferUsage is not defined` soft-fallback path (GPU rasterizer degrades to software renderer, which is the designed behavior).
