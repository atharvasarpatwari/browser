# Nova Android 2.12: `overflow:hidden` Clips to Rounded Corners

**Date:** 2026-11-12
**Session:** "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Tested on the OnePlus Pad Go (OPD2305, Android 14, screen on and unlocked).

---

## Summary
A box with `overflow:hidden` and `border-radius` clipped its children to a square. Round avatars, image cards and the ad-block test's gauge (its liquid drew past the circle as a box) are all this pattern. The clip now carries the box's padding-box radii.

## Root Causes

### 1. Clips were rectangles only
**Files:** `src/browser/rendering/clip.ts`, `src/browser/rendering/paint-engine.ts`, `src/browser/rendering/rasterizer.ts`
**Problem:** on adblock.turtlecute.org (engine), the gauge `.lt_circle {border-radius:50%; overflow:hidden}` showed its child `.lt_wave` as a square sticking out of the circle.
**Root cause:** `overflowClipRect` returned the padding box as `{x, y, w, h}` and the rasterizer's `clip` command intersected rectangles. `border-radius` only shaped the element's own background and border, never what it clips.
**Fix:**
- `overflowClipRect` adds `r`: the inner radii, outer radius minus border width per side (CSS Backgrounds §5.3).
- The paint engine passes `r` as a fifth `clip` parameter.
- The rasterizer keeps it as `clipRound` (saved and restored with the rest of the state). `setPixelRaw` multiplies alpha by the existing `roundedCoverage`, and the two fast paths that write pixels directly fall back to `setPixelRaw` while a rounded clip is active.

```ts
const round = this.state.clipRound;
if (round) a *= roundedCoverage(x + 0.5, y + 0.5, round.box, round.rr, 0);
```

## Not changed (recorded)
- **Nested rounded clips:** one survives, the one whose box is the intersection (normally the inner one). A rounded box only partly inside another keeps the rectangle intersection without corners (`ponytail:` comment in `clip.ts`).
- **GPU rasterizer:** its `clip` is still a no-op, as before; Android uses the software rasterizer.
- **The box under the gauge** (the re-test buttons) still draws empty.
- **Tab count:** the tablet showed 2 tabs after this run (40 before). The app was not cleared (`install -r` keeps data). The tablet was on its home screen before the run, so the tabs may have been closed by hand; not investigated.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/clip.ts` | `ClipBox.r`; inner radii in `overflowClipRect`; `intersectClip` keeps the radius of the box that is the intersection |
| `src/browser/rendering/paint-engine.ts` | `clip` commands pass the radius |
| `src/browser/rendering/rasterizer.ts` | `clipRound` state; coverage in `setPixelRaw`; fast paths skipped while it is set |
| `android/app/build.gradle` | 2.11 (112) → 2.12 (113) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/rounded-overflow-clip-212.test.ts` | a square child of a round `overflow:hidden` box is cut to the circle (fails with the source reverted); without `overflow:hidden` it is not |
| `doc/img/2026-11-12-nova-2.12-rounded-overflow-clip-oneplus-pad.png` | tablet result |

## Test Results
```
npx vitest run tests/rounded-overflow-clip-212.test.ts tests/rounded-corners-radios.test.ts tests/clip-path-padding-box-155.test.ts → 13 passed
  with src/ reverted (git apply -R): rounded-overflow-clip-212 → 1 failed | 1 passed
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 343 passed (343); Tests 11482 passed (11482)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.12.apk     → verified; versionCode 113, versionName 2.12

OnePlus Pad Go (OPD2305, Android 14), awake, home screen before the run, audio MODE_NORMAL:
  2.12 install "Success"; adblock.turtlecute.org in the engine → gauge liquid clipped to its circle; score 100%; shield 128
       (doc/img/2026-11-12-nova-2.12-rounded-overflow-clip-oneplus-pad.png)
       logcat: no "Uncaught error", no crash; [render] paint 27 ms, paint2 16 ms
```
