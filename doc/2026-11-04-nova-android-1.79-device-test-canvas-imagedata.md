# Nova Android 1.79: Tablet Test of 1.78 — Canvas ImageData Unreadable from Page Scripts

**Date:** 2026-11-04
**Session:** "connected the tablet": install 1.78 and run the device test page
**Status:** Completed (1.79 installed on the tablet; device page **26/26**)

---

## Summary
1.78 was installed on the tablet (OPD2305, previously on 1.73). The device page `tests/fixtures/device-pages/v172.html` gained three 1.78 checks and a visual swatch:
- a block inside a link, with the next block below the card;
- a canvas nonzero overlap;
- a canvas evenodd hole;
- a `radial-gradient(circle closest-side …)` dot.

The first run was **24/26**:
- **Passed:** block-in-link, and the dot was round.
- **Failed:** both canvas checks, and not on the fill rule. `getImageData(…).data[3]` was `undefined`, so a page could not read canvas pixels at all.

That was traced, fixed, unit-tested, rebuilt as **1.79** and reinstalled: **26/26** on the tablet.

## Root Causes

### 1. ImageData.data was a host array that page scripts could not index
**File:** `src/browser/js/dom-bindings.ts` (`wrapImageData`), `src/browser/js/typed-arrays.ts`
**Problem:** in a page, `ctx.getImageData(x, y, w, h).data[i]` was `undefined` for every pixel, so canvas pixel reads failed on the device: colour pickers, hit-testing, image filters and charts that read back.
**Root cause:** `wrapImageData` put the host `Uint8ClampedArray` into the page object as it was (`d.data as unknown as JSValue`). Page scripts read indexes through Nova's property map and page typed arrays (`__nativeView`). A host array has neither, so every index read missed.

The Node tests of 1.78 drove the canvas through its TypeScript API, never from a page script, so only the device page exercised this path.
**Fix:** `wrapNativeTypedArray(view)` (new, in `typed-arrays.ts`) makes a page typed array over the **same bytes**. `ImageData.data` is that wrapper, so `data[i]` reads work and in-place edits followed by `putImageData` still reach the canvas.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/dom-bindings.ts` | `ImageData.data` as a page `Uint8ClampedArray` (#1) |
| `src/browser/js/typed-arrays.ts` | `wrapNativeTypedArray` (#1) |
| `tests/fixtures/device-pages/v172.html` | 1.78 checks: block in link, canvas nonzero / evenodd, radial circle swatch |
| `android/app/build.gradle` | 1.78 (79) → 1.79 (80) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/canvas-imagedata-178.test.ts` | page scripts read canvas pixels (nonzero, evenodd) and write back through `putImageData` |

## Test Results
```
Tablet (OPD2305), Nova 1.78, device page v172.html → 24/26 (canvas nonzero / evenodd: data[3] undefined)
npx vitest run tests/canvas-imagedata-178.test.ts  → 3 passed
npx vitest run                                     → Test Files 327 passed (327); Tests 11366 passed (11366)
npx tsc --noEmit                                   → clean
npx eslint src/ tests/                             → 0 errors (1005 warnings; the one new warning, an unused helper in the new test, removed)
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.79.apk                     → verified; versionCode 80, versionName 1.79
adb install -r Nova-1.79.apk                       → Success
Tablet, Nova 1.79, device page v172.html           → 26/26
```
