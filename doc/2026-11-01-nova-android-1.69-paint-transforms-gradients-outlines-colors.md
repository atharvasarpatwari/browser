# Nova Android 1.69: Painting (Transforms, Gradients, Outlines, currentColor, color-mix, Inset Shadows)

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a 40-case pixel probe of painting
**Status:** Completed (tablet not connected: verified by tests; APK built, not installed)

---

## Summary

Small pages were rasterized with Nova's CPU rasterizer and their pixels compared with the expected colours: 28 of 40 cases were right. The biggest miss was that static `transform`s weren't applied at all, so the standard `top:50%; left:50%; transform:translate(-50%,-50%)` centring sat half a box off. Writing the gradient fix exposed two more bugs that affected every linear gradient: the gradient line ran from −0.5 to 1.5 across the box, so colour changed only in the middle half, and automatic colour stops were sorted to the front. Fixed, along with `currentColor` (case-sensitive and whole-value only), `color-mix()`, outlines (never painted and never expanded), the colour under gradient layers, `background-clip`, inset box-shadows and px stops in repeating gradients. 37/40 pass; scale, rotate and rounded clipping of children remain (the rasterizer has no general matrix or rounded clip).

## Root Causes

### 1. Static transforms ignored
**Files:** `src/browser/rendering/layout-engine.ts`, `formatting/stacking.ts`
**Problem:** only animation-driven translations were applied (at paint time); a computed `transform` did nothing.
**Fix:** `applyStaticTranslation()` moves the box and its content after layout when the transform (or the `translate` property) is only translations, with `%` against the element's own border box — like a relative offset, so paint, tap hit-testing and `getBoundingClientRect` agree. Layout records each node's flow end (`flowEnds`) so incremental layout doesn't take a moved box as the flow position; the stacking tree subtracts the baked offset from an animated translation so the two don't add up. ponytail: scale/rotate/skew aren't drawn.

### 2. currentColor painted black
**File:** `src/browser/rendering/css5/computed-value-resolver.ts`
**Problem:** only the exact lower-case value `currentcolor` was resolved; the usual `currentColor`, and any value containing it (box-shadow, gradients), stayed unresolved and painted black.
**Fix:** case-insensitive, inside values too, for every property but `color`.

### 3. color-mix() painted black
**File:** `computed-value-resolver.ts`
**Fix:** `resolveColorMix()` turns `color-mix(in <space>, a [p], b [p])` into `rgba()` (percentages normalized per CSS Color 5). ponytail: mixed in sRGB whatever the space.

### 4. Outlines never appeared
**Files:** `css5/cascade.ts`, `paint-engine.ts`
**Problem:** the `outline` shorthand wasn't expanded, and nothing painted outlines.
**Fix:** `outline` expands to width/style/colour; the paint engine draws it outside the border box at `outline-offset`.

### 5. Background colour lost under gradients; background-clip ignored
**File:** `paint-engine.ts`
**Problem:** a gradient replaced the colour (so `background: linear-gradient(…transparent…), red` showed white) and only one image layer was drawn; `background-clip` was ignored.
**Fix:** the colour is painted first, then every gradient layer bottom-up; both stop at the `background-clip` edge.

### 6. Inset box-shadows never showed
**File:** `src/browser/rendering/rasterizer.ts`
**Problem:** inset shadows went through the outer-shadow path, which skips every pixel under the element.
**Fix:** `applyInsetShadowToPixels()` shades the box outside a blurred "hole" (the box shrunk by the spread and moved by the offset).

### 7. Linear gradients changed colour in their middle half only
**File:** `src/browser/rendering/css-gradients.ts`
**Problem:** `t = ((x/w − 0.5)·nx + (y/h − 0.5)·ny)·2 + 0.5` runs −0.5…1.5, so a left-to-right red→blue gradient was solid red for its first quarter and solid blue for its last.
**Fix:** the CSS Images §3.1.1 gradient line: length `|w·sinθ| + |h·cosθ|` through the centre.

### 8. Stop order and px stops
**File:** `css-gradients.ts`
**Problem:** stops were sorted by offset, so an automatic stop (−1) jumped to the front (`red 10%, blue, green 90%` started blue); px positions became automatic, so `repeating-linear-gradient(… #f00 0 10px, #00f 10px 20px)` didn't stripe; repetition used 0…1 instead of the stops' span; and a `t` past the last stop's offset fell back to the first colour.
**Fix:** `normalizeStops()` per CSS Images §3.5.1 (first/last default to 0/100%, clamp to the previous position, spread automatic runs, no sorting); px stops resolve against the gradient length at paint time (cached per length); repeating gradients repeat their stop span; colours continue beyond the first/last stop.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | `applyStaticTranslation`, `flowEnds` (#1) |
| `src/browser/rendering/formatting/stacking.ts` | animated translate minus the baked one (#1) |
| `src/browser/rendering/css5/computed-value-resolver.ts` | currentColor everywhere, `resolveColorMix` (#2, #3) |
| `src/browser/rendering/css5/cascade.ts` | `outline` shorthand (#4) |
| `src/browser/rendering/paint-engine.ts` | outlines, colour + gradient layers, background-clip (#4, #5) |
| `src/browser/rendering/rasterizer.ts` | inset shadows (#6) |
| `src/browser/rendering/css-gradients.ts` | gradient line, stop normalization, px stops, repetition, end colours (#7, #8) |
| `android/app/build.gradle` | versionCode 70, versionName 1.69 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/paint-pixels-169.test.ts` | 37 pixel cases + translate centring, gradient midpoint, automatic stop order (40 tests) |

## Verification

- Probe: 28/40 → 29 (translate) → 30 (currentColor) → 35 (color-mix, outline, layers, clip; one probe point moved off a dash gap) → 36 (inset) → 37 (gradients).
- Full suite: 316 files / 11046 passed.
- Device: the tablet was not connected (`adb devices` empty).

## Test Results

```
npx tsc --noEmit                                    → clean
npx vitest run tests/paint-pixels-169.test.ts       → 40 passed
npx vitest run                                      → Test Files 316 passed (316); Tests 11046 passed (11046)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.69.apk                      → verified; aapt: versionCode 70, versionName 1.69
```
