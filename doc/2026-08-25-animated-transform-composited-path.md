# Animated Transform — Composited Path + Overlay Test Suite

**Date:** 2026-08-25
**Session:** Wired animated transforms into the compositing layer path; added 13-test overlay suite
**Status:** Completed

---

## Summary
Completed the animated-transform integration by wiring it into the composited path (`LayerPromoter` now promotes elements with active animated translations; `CompositingLayer` uses the animated translation as its `transformMatrix`) and added a dedicated test suite covering both the flat/software-rasterizer path and the composited path. Follows the flat-path work from earlier today (`2026-08-25-animated-transform-flat-path.md`).

## Root Causes
### 1. LayerPromoter ignored animated transforms
**File:** `src/browser/rendering/compositing/layer-promoter.ts`

**Problem:** `getHint()` only checked the static `style.get('transform')`. An element animated via CSS keyframes (no static transform, no will-change) was never promoted to a compositing layer, so the composited path never applied its animation.

**Fix:** The stacking builder already resolves animated pure translations into `ctx.translate`. Promotion now treats a non-zero `ctx.translate` as an active transform:
```ts
const hasAnimatedTransform = !!(ctx.translate && (ctx.translate.x !== 0 || ctx.translate.y !== 0));
const hasTransform = hasAnimatedTransform || !!(style.get('transform') && style.get('transform') !== 'none');
```
Reason precedence: `will-change` → `'animated transform'` → `'transform'`. Added `hasAnimatedTransform` field to `PromotionHint`.

### 2. CompositingLayer used a stale static transform matrix during animations
**File:** `src/browser/rendering/compositing/compositing-layer.ts`

**Problem:** The constructor always parsed the static computed-style `transform`, so while a translateX animation ran, `layer.transformMatrix` stayed at the static value (or null) and `LayerCompositor` composited the layer at the wrong position.

**Fix:** Animated translation takes precedence when present:
```ts
const animTranslate = stackingContext.translate;
if (animTranslate) {
  this.transformMatrix = translate3D(animTranslate.x, animTranslate.y, 0);
} else {
  const parsed = parseTransform(style.get('transform') ?? 'none');
  this.transformMatrix = parsed ? parsed.matrix : null;
}
this.hasTransform = !!this.transformMatrix;
```
Both trees rebuild every `paint()` call, so the matrix refreshes per frame.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/compositing/layer-promoter.ts` | Added `hasAnimatedTransform` hint field; non-zero `ctx.translate` promotes with reason `'animated transform'` |
| `src/browser/rendering/compositing/compositing-layer.ts` | Animated `stackingContext.translate` takes precedence over static transform for `transformMatrix`; import changed `identity4x4` → `translate3D` |

## Files Created
| File | Purpose |
|------|---------|
| `tests/animation-transform-overlay.test.ts` | 13-test suite: `resolveTransform` interpolation (mid/endpoints/wrap), flat-path `PaintLayer.translate` recording, stacking-path `translate` command emission, forced flat-fallback branch with save/translate/restore bracketing, promotion of animated translations, `CompositingLayer` animated/static/no-matrix cases |

## Test Results
```
npx vitest run tests/animation-transform-overlay.test.ts
  Test Files  1 passed (1)
       Tests  13 passed (13)

npx vitest run tests/compositing/{layer-promoter,compositing-layer,layer-tree,layer-compositor}.test.ts \
  tests/animation-track-b.test.ts tests/stacking.test.ts
  Test Files  6 passed (6)
       Tests  99 passed (99)

Full suite:
  Test Files  1 failed | 199 passed (200)
```
The single failing file is pre-existing `tests/paint-record.test.ts` (3 failures + 5 tsc errors, unrelated to rendering pipeline changes).

## Verification Steps Taken
1. New overlay suite passes 13/13 (includes forcing `(paint as any).stackingTree = null` to exercise the previously-unreachable flat fallback composite branch).
2. Targeted compositing/stacking/animation suites: 99/99 pass — no regressions from the promoter or layer constructor changes.
3. Full suite: 199/200 files green; only pre-existing `paint-record.test.ts` failures remain.
4. `npx tsc --noEmit`: no new errors (only the 5 pre-existing ones in `tests/paint-record.test.ts`).

## Architecture Notes
- **Software rasterizer constraint respected end-to-end**: animated pure translations are representable on all three paths (flat PaintLayer offset, stacking-context `save/translate/restore`, composited-layer matrix). Non-translation animations (rotate/scale/skew) remain unsupported at rasterization time — the interpolated `matrix3d(...)` is parsed but fails `isPureTranslation4x4` and is dropped on the flat paths; the composited layer likewise falls back to the static matrix.
- **Single source of truth**: the stacking builder's `ctx.translate` (computed once per frame from the transform resolver) drives promotion, the layer matrix, and the flat-path offset — no resolver threading needed into the compositing subsystem.
- **Test discovery**: infinite animations wrap at iteration boundaries (t=1000ms ≡ t=0 for a 1s linear loop); endpoint assertions must account for this.
