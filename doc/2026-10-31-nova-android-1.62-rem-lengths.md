# Nova Android 1.62: `rem` Lengths Resolved Against the Element's Font

**Date:** 2026-10-31
**Session:** continuous tablet testing, round after 1.61 — httpforever's 2.4rem switcher buttons were 41×30 instead of square
**Status:** Completed

---

## Summary

Any `rem` length that reached layout unresolved (heights, insets, grid tracks, used-style lengths) was multiplied by the element's own font size: `'2.4rem'.endsWith('em')` is true, so the `em` branch caught it first. Fixed in all four resolvers that had that order. On the tablet httpforever's buttons are now 2.4rem squares and its content card takes its `rem` padding and width, wrapping like a desktop browser.

## Root Causes

### 1. `em` checked before `rem` in layout lengths
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `resolveLength` tested `value.endsWith('em')` first, so `rem` never reached its own branch. A `<button>` has a 13.333 px UA font, so `height: 2.4rem` came out 32 px while the cascade-resolved width was right — the 41×30 buttons on the tablet.
**Fix:**
```ts
if (value.endsWith('rem')) { const n = parseFloat(value); return isFinite(n) ? n * this.rootFontSize : 0; }
if (value.endsWith('em'))  { const n = parseFloat(value); return isFinite(n) ? n * fontSize : 0; }
```

### 2. Positioned insets: same order, and `rem` used the element's font anyway
**File:** `src/browser/rendering/positioning.ts`
**Problem:** `parseLength` checked `em` first, and its `rem` branch multiplied by `fontSize` too, so `top: 1rem` on a 30 px element was 30 px.
**Fix:** `rem` first, against a module-level root font size the layout engine sets with each layout (`setPositioningRootFontSize`). ponytail: module state rather than threading it through every positioning signature.

### 3. Grid tracks and used styles: same order
**Files:** `src/browser/rendering/formatting/grid-context.ts`, `src/browser/rendering/css5/used-style.ts`
**Problem/Fix:** `grid-template-columns: 2rem …` and used-style `rem` lengths took the `em` branch; `rem` is now checked first.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | rem before em; sets the positioning root font size |
| `src/browser/rendering/positioning.ts` | rem before em, against the root font |
| `src/browser/rendering/formatting/grid-context.ts` | rem before em for track sizes |
| `src/browser/rendering/css5/used-style.ts` | rem before em |
| `tests/switcher-details-158.test.ts` | `rem lengths` test (button height/width, absolute inset, grid track) |
| `android/app/build.gradle` | versionCode 63, versionName 1.62 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| — | — |

## Verification

- The new test fails without the fix (`expected 31.9992 to be close to 38.4`) and passes with it.
- Tablet (1.62): httpforever switcher buttons square, sun icon centred, page card narrower with rem padding.

## Test Results

```
npx tsc --noEmit                      → clean
npx vitest run tests/switcher-details-158.test.ts → 9 passed
npx vitest run                        → Test Files 309 passed (309); Tests 10776 passed (10776)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.62.apk        → verified; aapt: versionCode 63, versionName 1.62
adb install -r Nova-1.62.apk          → Success (OPPO OPD2305)
```
