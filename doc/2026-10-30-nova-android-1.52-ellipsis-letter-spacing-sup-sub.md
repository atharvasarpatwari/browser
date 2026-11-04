# Nova Android 1.52: `text-overflow: ellipsis`, `letter-spacing`, `<sup>`/`<sub>`

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". These are the three text gaps left from the 1.51 probe.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
| Feature | Before | After |
|---------|--------|-------|
| `text-overflow: ellipsis` (with `overflow: hidden`) | The text was cut off at the edge | The run crossing the edge ends in "…"; later runs on that line are dropped |
| `letter-spacing` | Ignored | Included in measurement (line breaking and widths) and painted character by character |
| `<sup>` / `<sub>` | Full-size text on the baseline | 0.83em, raised (`super`) or lowered (`sub`); lengths in px/em also shift the baseline |

Also: **`vertical-align` was marked as inherited**. It isn't (CSS 2.2 §10.8.1), and the fix stops a `<sup>`'s children from being raised a second time.

## Root Causes

### RC-1: No ellipsis
**File:** `src/browser/rendering/paint-engine.ts`
**Problem:** `text-overflow` was parsed but never used.
**Fix:**
- `ellipsisEdge()` returns the content box's right edge when `text-overflow: ellipsis` and a non-visible `overflow-x` apply.
- In the text-run loop:
  - the first run on a line that crosses the edge is shortened by `fitWithEllipsis()` (characters dropped until `text + "…"` fits);
  - runs starting at or beyond the edge, and later overflowing runs on that line, are skipped.

ponytail: text owned by inline children inside the clipped box isn't ellipsized.

### RC-2: `letter-spacing` ignored
**Files:** `formatting/inline-context.ts`, `formatting/types.ts`, `dom-tree.ts` (`TextRun`), `layout-engine.ts`, `paint-engine.ts`
**Problem:** Spacing affected neither measurement nor painting.
**Fix:**
- Layout sets `ifc.letterSpacing` from the text's element (`letterSpacingOf`) before each text run.
- `addTextRun` adds spacing × characters to every measured width.
- Boxes and text runs carry `letterSpacing`.
- The painter draws such runs one character at a time, advancing by glyph width plus spacing.

### RC-3: `<sup>`/`<sub>` on the baseline; `vertical-align` inherited
**Files:** `css5/cascade.ts` (UA), `css5/property-definitions.ts`, `layout-engine.ts`
**Problem:**
- The UA gave `sup`/`sub` neither `vertical-align` nor a smaller size.
- Text runs ignored `vertical-align`.
- `vertical-align` was defined as inherited.

**Fix:**
- UA: `sup { vertical-align: super; font-size: 0.83em }`, and `sub` likewise with `sub`.
- `baselineShift(owner, block)` sums `super` (−0.33 × the parent's font size), `sub` (+0.2) and px/em lengths over the inline ancestors up to the block, and moves the run's baseline.
- `vertical-align` is no longer inherited.

ponytail: the line box isn't grown for raised text, and `top`/`middle`/`text-top` aren't applied to text runs.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/paint-engine.ts` | Ellipsis (`ellipsisEdge`, `fitWithEllipsis`); per-character letter-spaced runs |
| `src/browser/rendering/formatting/inline-context.ts` | `letterSpacing` in measurement and on boxes |
| `src/browser/rendering/formatting/types.ts` | `InlineLevelBox.letterSpacing` |
| `src/browser/rendering/dom-tree.ts` | `TextRun.letterSpacing` |
| `src/browser/rendering/layout-engine.ts` | `letterSpacingOf`; `baselineShift` in text runs |
| `src/browser/rendering/css5/cascade.ts` | UA `sup`/`sub` |
| `src/browser/rendering/css5/property-definitions.ts` | `vertical-align` not inherited |
| `tests/css5-property-definitions.test.ts` | Expects `vertical-align` to be non-inherited |
| `android/app/build.gradle` | 1.52 (53) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/text-details-152.test.ts` | 4 tests: ellipsis cut and edge; untouched when it fits or without `overflow: hidden`; letter-spacing width and placement; sup/sub raised and lowered, children not double-shifted, smaller size |
| `Nova-1.52.apk` | Signed build |

## Test Results
```
npx tsc --noEmit                               -> clean
npx vitest run tests/text-details-152.test.ts  -> 4 passed (4)
npx vitest run                                 -> Test Files 304 passed (304), Tests 10749 passed (10749)
                                                  (after correcting the vertical-align inheritance expectation)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.52.apk                 -> Verifies; versionCode 53, versionName 1.52
```
