# Nova Android 1.70: Tables (Column Groups, Rowspan, Column Widths, Spacing, Cell Alignment)

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a 20-case probe of table layout
**Status:** Completed (tablet not connected: verified by tests; APK built, not installed)

---

## Summary

A probe of 20 table layout cases passed 11. The worst find was in the HTML parser: any table with a `<colgroup>` (or a bare `<col>`, or a `<caption>`) lost the table itself, so the column group was inserted beside the table with every row nested inside it and nothing rendered as a table. In layout, explicit and percentage cell widths didn't size their columns, `rowspan` neither spanned nor pushed the next row's cells over, `border-spacing` never applied (the UA default was `border-collapse: collapse`), header/footer groups kept source order, `<col>` widths were ignored, and cells never aligned their content vertically. All 20 now pass.

## Root Causes

### 1. Column groups and captions destroyed the table
**File:** `src/browser/rendering/html5/modes/table.ts`
**Problem:** "in table" mode handled `caption`/`colgroup`/`col` with `popCurrentNodeUntil('table')`, which popped the table itself, then reprocessed them in "in table body" mode. `<colgroup>` ended up beside the table with the rows inside it.
**Fix:** HTML §13.2.6.9: `clearToTableContext()` pops back *to* the table; `colgroup` is inserted and switches to "in column group"; a bare `col` gets an implicit `colgroup`; `caption` pushes a marker and switches to "in caption". The mode is set before inserting, because "in table" foster-parents insertions out of the table.

### 2. border-spacing never applied
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** the UA defaults gave `<table>` `border-collapse: collapse`; browsers default to `separate`.
**Fix:** removed; tables keep `border-spacing: 2px`.

### 3. Cells weren't vertically centred
**File:** `cascade.ts`, `layout-engine.ts`
**Problem:** row groups and rows had no `vertical-align: middle` (HTML §15.3.8), and the row stretch only grew the cell box.
**Fix:** the UA default; the stretch moves the content by half (middle) or all (bottom) of the free height. Cells are laid out at their natural height (their `height` only sizes the row), so the alignment applies to cells with a specified height too.

### 4. Specified widths didn't size their columns
**Files:** `src/browser/rendering/formatting/table-context.ts`, `layout-engine.ts`
**Problem:** spare width was shared equally among all columns, so a `width:100px` cell's column grew to 246px beside a one-word column, while the cell box was laid out at its own width (100px, or 25% of its column).
**Fix:** columns with a specified width (a cell's or a `<col>`'s) are `fixed`; spare width goes to the auto columns in proportion to their content (CSS 2.2 §17.5.2.2), and fixed layout gives the remainder to unspecified columns only. A cell is laid out at its column width.

### 5. Rowspans
**Files:** `table-context.ts`, `layout-engine.ts`
**Problem:** columns were counted per row, so a cell after a rowspan landed in the spanned column; cells were placed by a running offset; a spanning cell kept one row's height.
**Fix:** an occupancy grid assigns each cell the next free column; cells sit at their column's x; `layoutCells` lays every cell out once, computes row heights (a spanning cell grows its last row when it needs more), then moves each cell to its row and stretches spanning cells over their rows.

### 6. Group order and `<col>` widths
**File:** `layout-engine.ts`
**Fix:** header groups first and footer groups last (CSS 2.2 §17.2); `<col>`/`<colgroup>` widths (with `span`) set fixed column widths.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/html5/modes/table.ts` | caption/colgroup/col handling, `clearToTableContext` (#1) |
| `src/browser/rendering/css5/cascade.ts` | no `border-collapse: collapse` default; rows middle-aligned (#2, #3) |
| `src/browser/rendering/formatting/table-context.ts` | fixed columns, distribution, `setColumnWidth`, row indices, two-phase `layoutCells` with rowspans (#4, #5) |
| `src/browser/rendering/layout-engine.ts` | occupancy grid, group order, `<col>` widths, cell width/height at layout, alignment shift, move callback (#3–#6) |
| `android/app/build.gradle` | versionCode 71, versionName 1.70 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/tables-170.test.ts` | 20 table layout cases + 3 parser checks (23 tests) |

## Verification

- Probe: 11/20 → 19 (parser, widths, rowspan, spacing, order, col) → 20 (alignment with specified height).
- Full suite: 317 files / 11069 passed (no existing test depended on the collapse default or top alignment).
- Device: the tablet was not connected (`adb devices` empty).

## Test Results

```
npx tsc --noEmit                                    → clean
npx vitest run tests/tables-170.test.ts             → 23 passed
npx vitest run                                      → Test Files 317 passed (317); Tests 11069 passed (11069)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.70.apk                      → verified; aapt: versionCode 71, versionName 1.70
```
