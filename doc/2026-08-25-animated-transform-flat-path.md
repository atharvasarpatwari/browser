# Animated Transform Overlay on Flat Layer Path

**Date:** 2026-08-25
**Session:** Implemented animated transform support for the flat/software rasterizer path in PaintEngine
**Status:** Completed

---

## Summary
Added animated transform (pure translation) support to the flat layer compositing path in `PaintEngine`. Previously, animated transforms only worked on the composited layer path (via `LayerCompositor`). Now the flat fallback path in `compositeFrame()` also applies animated translations as paint-time `translate` commands, matching the behavior of the stacking context rendering path.

## Root Causes
### 1. Missing Animated Transform in Flat Layer Path
**File:** `src/browser/rendering/paint-engine.ts`

**Problem:** The `PaintLayer` interface lacked a `translate` field, and the `paintElement()` method only applied animated opacity via `_opacityResolver`. The `_transformResolver` was wired through `stackingBuildOptions()` to the stacking context tree (which correctly handles animated translate), but the flat layer fallback path in `compositeFrame()` (lines 280-293) ignored transforms entirely.

**Fix:** 
1. Added `translate: { x: number; y: number } | null` field to `PaintLayer` interface
2. In `paintElement()`, call `_transformResolver(node)`, parse with `parseTransform()`, check `isPureTranslation4x4()`, and extract translation if pure
3. In `compositeFrame()` fallback path, wrap layer commands with `save`/`translate`/`restore` when `layer.translate` is present (matching `renderStackingContext()` logic in `formatting/stacking.ts`)

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/paint-engine.ts` | Added `translate` field to `PaintLayer`; added import for `parseTransform`, `isPureTranslation4x4` from `transform-parser`; updated `paintElement()` to resolve and parse animated transform; updated `buildFlatLayers()` background layer to include `translate: null`; updated `compositeFrame()` fallback path to apply translate |

## Files Created
| File | Purpose |
|------|---------|
| (none) | — |

## Test Results
```
Test Files  198 passed | 1 failed
Tests       8998 passed | 3 failed
```

The 1 failed test file (`tests/paint-record.test.ts`) and 3 failed tests are pre-existing issues unrelated to this change:
- `tests/paint-record.test.ts` has 4 pre-existing TypeScript errors (TS2531, 3× TS2475)
- The 3 test failures in that file existed before this change

**Animation Track B tests:** 27/27 passing (verified before and after change)

## Verification Steps Taken
1. Ran `npx vitest run tests/animation-track-b.test.ts` — 27/27 tests pass
2. Ran full test suite `npx vitest run` — 8998 tests pass, only pre-existing failures in unrelated test file
3. Ran `npx tsc --noEmit` — only pre-existing errors in `tests/paint-record.test.ts` (no new errors)
4. Verified code compiles: `npx tsc` produces no new errors
5. Confirmed stacking context path already handled animated translate (no changes needed there)
6. Confirmed composited layer path via `LayerCompositor` already handles transform matrices (no changes needed there)

## Architecture Notes
- **Software rasterizer constraint respected**: Only pure translations (no rotation/scale/skew/perspective) are applied on the flat path. Non-translation transforms remain composited-only via `LayerCompositor` and `CompositingLayer.transformMatrix`.
- **Animated values not written to computedStyle**: The resolver pattern (`_transformResolver`, `_opacityResolver`) keeps animated values as paint-time overlays only.
- **Consistency**: The flat path now mirrors the stacking context render path (`renderStackingContext` in `formatting/stacking.ts` lines 352-362, 408-411) which wraps with `save`/`translate`/`restore`.