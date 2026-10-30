# Nova Android 1.49: Table Columns Sized by Their Content

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". Closes the "table columns are equal-width" item left open in 1.46–1.48.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
Auto-layout table columns now come from their cells' measured content (CSS 2.2 §17.5.2.2):
- A Wikipedia-style infobox keeps its label column narrow and gives the rest to the values. It used to split 50/50.
- A small auto-width table is as wide as its content, instead of spanning the page.

## Root Causes

### RC-1: Auto cells contributed fixed numbers, not their content
**Files:** `src/browser/rendering/formatting/table-context.ts`, `src/browser/rendering/layout-engine.ts`
**Problem:**
- Every auto cell had min = 40 px and max = the whole available width.
- Each column's max was therefore the full width, and the extra space was shared equally.
- Columns ignored what they held: label and value columns split evenly, and a two-cell table filled the line.

**Fix:**
- `measureCellWidths()` gives each cell:
  - **min-content:** the content laid out in 1 px, measured unclamped. This is the widest word or image.
  - **max-content:** laid out in the available width, unwrapped.
  - Cell padding and border are added to both.
- Both are measured with the existing throwaway `measureContentWidth` layout, which now has an `uncapped` flag.
- Columns take the largest min/max of their cells.
- `autoWidth` (`width: auto` on the table): when the columns' max-content fits, each column gets its max and the table shrinks to it. Otherwise the existing proportional distribution of (max − min) applies.
- The table's own box shrinks to its columns, so its border and background no longer run past the cells.
- ponytail: past 400 cells, measuring stops (equal shares, as before), to bound two trial layouts per cell on huge tables.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/formatting/table-context.ts` | `TableCell.minContent/maxContent`; `autoWidth` option; content-fit branch |
| `src/browser/rendering/layout-engine.ts` | `measureCellWidths`; `measureContentWidth(…, uncapped)`; measure budget; table box shrinks; cells typed as `TableCell` |
| `tests/flex-items-145.test.ts` | The figure caption is now the table's (image's) width, 200 px, not the line's |
| `android/app/build.gradle` | 1.49 (50) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/table-columns-149.test.ts` | 3 tests: a small table shrinks to its content; an infobox gives the long value column most of the width; explicit cell widths and `width: 100%` still win |
| `Nova-1.49.apk` | Signed build |

## Still open
- The on-device check of 1.46–1.49 (install not requested).
- `load` fires before images finish; percentage cell widths; `table-layout: fixed` from the first row.

## Test Results
```
npx tsc --noEmit                                                   -> clean
npx vitest run tests/table-columns-149.test.ts tests/flex-items-145.test.ts -> 14 passed (14)
npx vitest run                                                     -> Test Files 301 passed (301), Tests 10733 passed (10733)
gradlew :app:testDebugUnitTest :app:assembleRelease                -> BUILD OK
apksigner verify Nova-1.49.apk                                     -> Verifies; versionCode 50, versionName 1.49
```
