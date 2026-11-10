# Nova Android 2.04: Collapsed Flex Boxes Collapse: Zero Main Size and Zero Cross Size Were Skipped

**Date:** 2026-11-10
**Session:** "keep improving the nova app and update analytics.html"
**Status:** Completed (offline). No device was connected.

---

## Summary
Two flex layout cases treated a size of 0 as "not set". Both are common in collapsed UI: accordion panels, collapsed menus and tab strips.

| Case | Before | After |
|------|--------|-------|
| `overflow: hidden` flex item (`flex: 1 1 0`) in a `height: 0` column | item 40 px tall | 0 |
| item in a `height: 0` row | item 40 px tall (its content height) | 0 |

A second look at the "`height: 0` column doesn't shrink its contents" bug recorded in 1.91 showed the container was always 0 tall and the next block sat in the right place. Only the flex *items* inside kept their content height, so the bug was in the items, not the container.

## Root Causes

### 1. A zero main size was never applied to the item
**File:** `src/browser/rendering/layout-engine.ts` (`layoutFlexContainer`)
**Problem:** a `flex: 1 1 0; overflow: hidden` item in a `height: 0` column was laid out at its content height. A 50 px column still split 25 + 25, so only 0 was wrong.
**Root cause:** the flex algorithm computes each item's main size, and the layout then sets it as the item's `width`/`height` before laying the item out. That step was guarded by `item.mainSize > 0`, so a computed size of exactly 0 was skipped and the item used its natural height.
**Fix:** the guard is `item.mainSize >= 0`.

### 2. A zero cross size left the line at its content size
**File:** `src/browser/rendering/formatting/flex-context.ts` (`computePositions`)
**Problem:** items in a `height: 0` row (with `overflow: hidden`) stayed at their content height.
**Root cause:** the line was stretched to the container's definite cross size only when it was greater than 0 (`availableCrossSize > 0`), so a definite 0 left the line as tall as its tallest item, and `align-items: stretch` stretched to that.
**Fix:** a single-line container's line takes the container's definite cross size including 0 (CSS Flexbox §9.4). Multi-line containers keep the old rule, so lines are never squeezed below their content by a 0 container.

## Not changed (recorded)
- **Missing spaces in bold headings (httpforever.com on the tablet):** investigated offline with the saved page. The offline render shows only a narrow space (2.6 px at ~19 px type) because it uses the heuristic font measurer. The device uses the real canvas measurer, so the actual cause is still unknown. It needs a device run: print the per-character advances for the heading.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | zero main size applied (#1) |
| `src/browser/rendering/formatting/flex-context.ts` | single line stretched to a zero cross size (#2) |
| `tests/flex-grid-172.test.ts` | 3 cases: column h0, row h0, a 50 px column still splits 25 + 25 |
| `android/app/build.gradle` | 2.03 (104) → 2.04 (105) |

## Test Results
```
npx vitest run tests/flex-grid-172.test.ts → 44 passed; with the two source files stashed: 2 failed (the new h0 column and row cases)
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (13 warnings)
npx vitest run                     → Test Files 338 passed (338); Tests 11465 passed (11465)
Device: none connected (adb listed no devices); not installed or timed on a tablet.
```
