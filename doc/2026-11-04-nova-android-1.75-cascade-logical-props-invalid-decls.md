# Nova Android 1.75: Cascade — Logical Properties, Invalid Declarations, var() as unset, all:, @supports selector()

**Date:** 2026-11-04
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
A **61-case cascade and CSS-values probe** covered inheritance and keywords, custom properties, specificity, `!important`, `@layer`, `@media`, `@supports`, nesting, shorthands, colours and UA styles. It passed **51** at first and **60** now.
- **Left:** `place-content: center` on a grid without a column template. Nova's implicit tracks are `1fr`, so there is no free space to centre in. Content-sized `auto` tracks would be needed (`ponytail:`).
- **Real pages:** the IANA, httpforever and both Wikipedia renders are pixel-identical to the 1.74 baseline. The only difference is Wikipedia's header icons, which depend on fixture files in the working tree, not on the engine.

## Root Causes

### 1. Logical properties were dropped
**File:** `src/browser/rendering/css5/cascade.ts` (`expandShorthands`)
**Problem:**
- `padding-inline`, `padding-block`, `margin-inline`, `margin-block`, `inset-inline`, `inset-block`, `inline-size`, `block-size`, `min-`/`max-` sizes and `border-inline-*` / `border-block-*` were unknown properties.
- Tailwind 4 writes its `px-*` / `py-*` / `mx-*` utilities as `padding-inline` / `margin-block`, so they did nothing.
- `margin-inline: auto` centring did nothing.

**Fix:** they map to physical properties for horizontal, left-to-right text:
- `LOGICAL_PAIRS` covers the start/end shorthands;
- `LOGICAL_LONGHANDS` covers the `-start` / `-end`, size and corner-radius longhands;
- `border-inline` / `border-block` (and their `-start` / `-end`) expand through the `border` expander, keeping only the relevant sides.

### 2. Invalid declarations replaced valid ones
**Files:** `css5/cascade.ts` (`isInvalidLengthValue`, `parseInlineDeclarations`, `computeCascade`), `src/browser/rendering/css-parser.ts`
**Problem:**
- `width: 100%; width: -webkit-fill-available` (the common fallback pattern) and typos such as `width: banana` won and laid out as 0.
- The legacy rule converter keeps the last value per property in a map.

**Fix:** values that aren't valid for length-type properties are dropped at every entry point: the rule map, inline styles and cascade collection. That covers sizes, margins, paddings, insets, gaps, `font-size`, `flex-basis` and border widths. Valid values are lengths, percentages, numbers, size keywords and math functions; anything with `var()` / `env()` passes, because it can't be checked before substitution.

### 3. `var()` to a missing property left an empty value
**File:** `css5/cascade.ts` (`invalidAtComputedTime`)
**Problem:** `color: var(--missing)` computed to `''`, which dropped the inherited colour.
**Fix:** an empty substitution makes the declaration act as `unset` (CSS Variables §3.1), so it inherits or takes the initial value.

### 4. Smaller gaps
- **`all: unset | initial | inherit`** now resets every known property except `direction` and `unicode-bidi`.
- **`@supports selector(…)`** now evaluates true. It was read as a declaration and failed.
- **`flex` longhands:** the shorthand now also sets `flex-grow`, `flex-shrink` and `flex-basis` (`expandFlexShorthand`). Layout still reads the shorthand.
- **UA `<small>`:** now `font-size: smaller`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | logical properties (#1); invalid-value filter (#2); var() unset (#3); `all`, flex longhands, @supports selector(), UA small (#4) |
| `src/browser/rendering/css-parser.ts` | invalid values skipped in the legacy rule map (#2) |
| `tests/css5-computed-styles-pipeline.test.ts` | `var(--x, )` expected `''`, the old behaviour; now `canvastext` (unset) |
| `android/app/build.gradle` | 1.74 (75) → 1.75 (76) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/cascade-values-175.test.ts` | 60 probe cases as permanent tests |

## Test Results
```
Cascade probe (61)                         → 51 → 55 (logical + flex) → 56 (@supports) → 57 (invalid decls) → 58 (var unset) → 60 (all, small)
npx tsc --noEmit                           → clean
npx vitest run                             → Test Files 323 passed, 1 failed (324); Tests 11329 passed, 1 failed
  the 1: css5-computed-styles-pipeline "var() with empty fallback" expected '' (old behaviour) → updated; file 119 passed
Real-page renders vs 1.74 baseline         → iana, httpforever identical; wikipedia ×2 differ only in header icons (fixture artefact)
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.75.apk             → verified; versionCode 76, versionName 1.75
adb devices                                → none (not installed)
```
