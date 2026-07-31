# GPU Acceleration Enabled

**Date:** 2026-07-31
**Session:** Enable the GPU acceleration setting and wire it into the PaintEngine so the app uses the WebGPU rasterizer.
**Status:** Completed

---

## Summary
Enabled GPU acceleration in all three process-model configs (`enableGpuAcceleration: true`) and wired the flag into the DI-registered `PaintEngine` (`hardwareAcceleration`) so the `GpuRasterizer` path is used when the app boots. Updated the affected test assertions.

## Changes
### 1. GPU setting flipped on
**File:** `src/app/config/process-model.ts`
**Problem:** All three process models defaulted `enableGpuAcceleration` to `false`, so the app never used the WebGPU rasterizer despite `GpuDeviceManager`/`GpuRasterizer` existing.
**Fix:** Set `enableGpuAcceleration: true` in `DEFAULT_PROCESS_MODEL`, `PER_TAB_PROCESS_MODEL`, and `PER_DOMAIN_PROCESS_MODEL`:

```ts
export const DEFAULT_PROCESS_MODEL: ProcessModelConfig = {
  isolationMode: 'none',
  enableRendererIsolation: false,
  maxRendererProcesses: 0,
  enableGpuAcceleration: true,  // was false
  ...
```

### 2. PaintEngine wired to the setting
**File:** `src/app/main.ts`
**Problem:** `Tokens.PaintEngine` was registered as `() => new PaintEngine()` with default config, so `hardwareAcceleration` stayed at its `false` default regardless of the app config.
**Fix:** Resolve `AppConfig` in the DI factory and pass `hardwareAcceleration` from the process model:

```ts
c.register<IPaintEngine>(
  Tokens.PaintEngine,
  (ctx) =>
    new PaintEngine({
      hardwareAcceleration: ctx.resolve<AppConfig>(Tokens.AppConfig).processModel.enableGpuAcceleration,
    }),
  ServiceLifetime.Singleton,
);
```

`PaintEngine.createRasterizer()` (paint-engine.ts ~line 311) now selects `GpuRasterizer`, which falls back to the software rasterizer when `navigator.gpu` is unavailable.

### 3. Tests updated
**File:** `tests/config/process-model.test.ts`
Updated the three "reasonable defaults" assertions from `.toBe(false)` to `.toBe(true)` for `DEFAULT_PROCESS_MODEL`, `PER_TAB_PROCESS_MODEL`, and `PER_DOMAIN_PROCESS_MODEL`. The `PaintEngine` default (`DEFAULT_PAINT_CONFIG.hardwareAcceleration: false`) and its assertion in `gpu-rasterizer.test.ts` are intentionally unchanged — direct `new PaintEngine()` usage still defaults to CPU.

## App Information
| Field | Value |
|-------|-------|
| App name | nova-browser |
| Version | 1.0.0 |
| Package | `type: module` (ESM) |
| GPU setting | `enableGpuAcceleration: true` (all 3 process models) |
| Paint engine | `hardwareAcceleration: true` via DI when app boots |
| GPU backend | WebGPU (`GpuRasterizer`, `GpuDeviceManager`, software fallback) |
| GPU deps | `webgpu` ^0.4.0, `@webgpu/types` ^0.1.71 |

## Files Modified
| File | Change |
|------|--------|
| `src/app/config/process-model.ts` | `enableGpuAcceleration: true` in all 3 process models |
| `src/app/main.ts` | PaintEngine DI registration resolves AppConfig → `hardwareAcceleration` |
| `tests/config/process-model.test.ts` | 3 assertions updated to expect GPU enabled |

## Test Results
```
Test Files  2 passed (2)
     Tests  85 passed (85)

tests/config/process-model.test.ts           17 passed
tests/browser/rendering/gpu-rasterizer.test.ts 68 passed
```

## Verification Steps
1. `npx vitest run tests/config/process-model.test.ts tests/browser/rendering/gpu-rasterizer.test.ts` — 85/85 pass.
2. Grep-confirmed no test bootstraps the real application container (`ApplicationBootstrap`/`createApplicationContainer`), so the `main.ts` DI change cannot regress existing tests.
3. `DEFAULT_PAINT_CONFIG.hardwareAcceleration` default left `false`; only app-level DI passes `true` — standalone `new PaintEngine()` tests unaffected.
