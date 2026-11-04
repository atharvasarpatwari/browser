# Nova Android 1.48: CSS Math With Mixed Units, Grid Rows That Fill Their Container

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". These fixes cover the remaining httpforever sizing items from the 1.45/1.46 phone tests.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
- **Mixed-unit math was wrong in three ways.** `clamp()`, `min()`, `max()` and `calc()` with mixed units (`rem` with `vw`, or with `%`) were evaluated:
  - for a 1920 px screen;
  - with `rem` set to the parent's font size;
  - or not at all in layout.

  So httpforever's logo was 12 px instead of 35, its name was too large, and any `width: calc(100% - 2rem)` box had no width.
- **Grid rows didn't fill their container.** Auto rows in a fixed-height grid didn't stretch, so `place-items: center` left an item at the top.

## Root Causes

### RC-1: The cascade evaluated math for a 1920 × 1080 viewport, with rem = the parent's size
**Files:** `src/browser/rendering/css5/cascade.ts`, `css5/computed-value-resolver.ts`
**Problem:**
- The second resolution pass got no viewport, so the math defaults applied (1920 × 1080). `rem` was passed the *parent's* font size.
- `clamp(2.2rem, 6vw, 3rem)` therefore picked 3rem and wrote it back as `2.8125vw`. Re-read at the phone's 423 px, that is 11.9 px.

**Fix:**
- The resolution context carries the page viewport and the root's font size.
- `rootFontSizePx` is set after the root is styled; for the root's own `rem`, it is 16.

### RC-2: Mixed-unit clamp/min/max results were fragile or wrong
**File:** `src/browser/rendering/css5/math-functions.ts`
**Problem:**
- `clamp` expressed a mixed result in its middle argument's unit (`8.3vw`), so it was re-scaled at the next viewport.
- `min`/`max` returned the *first* argument when they couldn't compare: `min(100%, 600px)` → `100%`.

**Fix:**
- Mixed units come out in px.
- Same-unit arguments compare directly.
- An argument that can't be converted here (`%`) leaves the whole function for layout.

### RC-3: Layout couldn't evaluate math at all
**File:** `src/browser/rendering/layout-engine.ts` `resolveLength`
**Problem:** Whatever the cascade had to leave (anything with `%`) reached `parseFloat`, which gave 0: `width: calc(100% - 2rem)` was 0 wide.
**Fix:** `%` is replaced by its px value against the containing width, then the expression goes through `resolveMathFunctions` with the layout's viewport and root font size.

### RC-4: Auto grid rows didn't stretch to a definite height
**Files:** `src/browser/rendering/formatting/grid-context.ts`, `layout-engine.ts`
**Problem:** With `align-content: normal` (the default), CSS Grid §12.8 stretches auto rows to fill the container. Nova kept them content-sized. httpforever's 2.4rem grid button had a 16 px row, so its centred icon sat at the top.
**Fix:**
- Leftover height is shared among `auto` rows when the height is definite and `align-content` is `normal`/`stretch`.
- A border-box height has padding and border subtracted first.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | Viewport and root font size in the resolution context; `rootFontSizePx` |
| `src/browser/rendering/css5/computed-value-resolver.ts` | `rootFontSize` in the context; rem uses it |
| `src/browser/rendering/css5/math-functions.ts` | Mixed-unit clamp/min/max in px; uncomparable min/max left alone |
| `src/browser/rendering/layout-engine.ts` | Math in `resolveLength` (`MATH_FN`, % → px); grid content-box height; `alignContent` passed |
| `src/browser/rendering/formatting/grid-context.ts` | Auto rows stretch (align-content normal/stretch) |
| `tests/page-events-147.test.ts` | +4 tests: math values; cascade viewport/rem and layout `calc(100% - 2rem)`; grid centring; explicit rows and `align-content: start` untouched |
| `android/app/build.gradle` | 1.48 (49) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `Nova-1.48.apk` | Signed build |

## Measured on the httpforever fixture (423 px)
| Element | Before | After |
|---------|--------|-------|
| `.brand__mark` (`clamp(2.2rem, 6vw, 3rem)`) | 12 × 12 | 35 × 35 |
| `.brand__name` font-size (`clamp(1.5rem, 1rem + 3vw, 2.6rem)`) | 46.8 px | 28.69 px |
| `.hero` padding (`clamp(3.5rem, 8vw, 7rem)`) | `6.5625vw` | 56 px |
| Theme icon in its 2.4rem grid button | top (y + 1) | centred |

## Also
A Python heredoc turned a `\b` into a backspace again (in `MATH_FN`). It was found by the control-character scan and fixed through a Write-tool script.

## Still open
- The on-device check of 1.46–1.48 (colour button, Wikipedia tables, example.com dark text, httpforever sizes).
- Table columns are equal-width; `load` fires before images finish; `rootFontSizePx` is per process.

## Test Results
```
npx tsc --noEmit                              -> clean
npx vitest run tests/page-events-147.test.ts  -> 7 passed (7)
npx vitest run                                -> Test Files 300 passed (300), Tests 10730 passed (10730)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.48.apk                -> Verifies; versionCode 49, versionName 1.48
```
