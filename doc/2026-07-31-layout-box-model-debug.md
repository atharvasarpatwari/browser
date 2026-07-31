# Layout Box Model Debug and Verification

**Date:** 2026-07-31
**Session:** Debug layout/box-model regression and document the fix
**Status:** Completed

---

## Summary

Debugged failing layout tests in the box model and positioning subsystems. Discovered a border-resolution bug in `src/browser/rendering/layout-engine.ts` where explicit `border-*-width` values were ignored when `border-style` was omitted. Fixed the layout engine and verified targeted layout regression tests.

## Root Cause

- **File:** `src/browser/rendering/layout-engine.ts`
- **Problem:** `resolveBorder()` treated a missing `border-style` the same as `none` and returned `0`, even when an explicit `border-*-width` was provided.
- **Effect:** layout offsets for absolute positioning and flex container content placement omitted border widths, causing tests to fail for:
  - `tests/positioning.test.ts`
  - `tests/flex-layout.test.ts`
  - `tests/layout-engine.test.ts`

## Fix

- Updated `resolveBorder()` so that an explicit border width is respected when `border-style` is not specified.
- Continued to treat `border-style: none` and `border-style: hidden` as zero-width.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | Fixed border-width resolution for missing border-style in layout engine |
| `doc/2026-07-31-layout-box-model-debug.md` | Added debug and verification summary |

## Verification

Ran the targeted layout-related test suite:

- `npx vitest run tests/layout-engine.test.ts tests/flex-layout.test.ts tests/positioning.test.ts --reporter=verbose --run`

Result:

- Test Files: 3 passed
- Tests: 110 passed

No regressions were observed in the targeted box model, flex layout, or positioning tests.
