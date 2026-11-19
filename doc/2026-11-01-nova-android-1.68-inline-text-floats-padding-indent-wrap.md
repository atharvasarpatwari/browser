# Nova Android 1.68: Inline Text Layout (Text Beside Floats, Inline Padding, text-indent, Word Breaking, rtl)

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a 34-case probe of inline text layout
**Status:** Completed (tablet not connected: verified by tests; APK built, not installed)

---

## Summary

A probe of 34 inline layout cases passed 20. The biggest misses: text beside a float ran underneath it (the float maths in the inline formatting context was broken), and inline elements' own padding, border and margin took no room on the line (padded `<span>` badges and pill links ran into their neighbours, their backgrounds drawn over them). Also missing: `text-indent`, breaking long words (`overflow-wrap`/`word-break`), `word-spacing`, `dir="rtl"` alignment, tab stops in preformatted text and the `ch`/`ex` units. All fixed; the three remaining probe "failures" were expectations written for real font metrics, not Node's approximate ones, and the permanent tests state them relative to Node's metrics.

## Root Causes

### 1. Text beside a float ran under it
**File:** `src/browser/rendering/formatting/inline-context.ts`
**Problem:** `getAvailableWidthAt(y)` / `getLeftOffsetAt(y)` were called with the line's *used width* as `y`, compared zones against `startY + y`, and computed the left offset as `zone.x - this.startY` (a y from an x); text segments ignored the offset entirely (`pushTextSegment` placed runs at `originX + usedWidth`). Floats almost never narrowed or shifted a line.
**Fix:** `zoneBounds(lineY)` gives each line's free span between the floats beside it; wrapping uses that width, and `finalize()` shifts every box on the line past the left float and aligns within the narrowed span.

### 2. Inline padding, border and margin ignored
**Files:** `inline-context.ts`, `src/browser/rendering/layout-engine.ts`
**Problem:** `flowInlineElement` built the inline's box with all spacing 0, so `padding: 4px 10px` added nothing to the line and the box (its background) hugged the text.
**Fix:** `ifc.addSpace()` puts the left margin+border+padding before the inline's content and the right ones after; the box keeps its padding/border values and grows around the text by them (vertically without moving the line, as CSS 2.2 §10.8.1 specifies).

### 3. text-indent ignored
**Files:** `inline-context.ts`, `layout-engine.ts`
**Fix:** `setTextIndent()` starts the first line in; applied in both inline paths (`layoutInlineChildren` and `layoutAnonymousBlock`, the latter only when the run starts the block's content). Percentages resolve against the block's width.

### 4. Long words never broke
**Files:** `inline-context.ts`, `layout-engine.ts`
**Problem:** `overflow-wrap: anywhere/break-word` and `word-break: break-all/break-word` were ignored; long URLs and identifiers overflowed narrow columns.
**Fix:** `applyTextSpacing()` sets `breakWords` per run; a word wider than the line is broken between characters (`pushBrokenWord`).

### 5. word-spacing, tabs, ch/ex
**Files:** `inline-context.ts`, `layout-engine.ts`
**Fix:** `word-spacing` widens word separators; under `pre*` tabs advance to the next 8-column stop (a tab measured as nothing); `ch` is the advance of "0", `ex` half an em (both parsed as plain numbers before: `width: 10ch` was 10px).

### 6. dir="rtl" was left-aligned
**Files:** `src/browser/rendering/css5/cascade.ts`, `layout-engine.ts`
**Problem:** the `dir` attribute never reached `direction`, and alignment ignored `direction` anyway.
**Fix:** `dir` sets `direction` (HTML §15.3.6 presentational hint); `effectiveTextAlign()` maps `start`/`end` by direction. ponytail: bidi reordering within a line isn't done.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/formatting/inline-context.ts` | `zoneBounds`, float-aware finalize/alignment, `addSpace`, `setTextIndent`, `wordSpacing`, `breakWords`/`pushBrokenWord`, tab stops (#1–#5) |
| `src/browser/rendering/layout-engine.ts` | inline spacing and box growth, text-indent in both inline paths, `applyTextSpacing`, `effectiveTextAlign`, ch/ex (#2–#6) |
| `src/browser/rendering/css5/cascade.ts` | `dir` → `direction` (#6) |
| `android/app/build.gradle` | versionCode 69, versionName 1.68 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/inline-text-168.test.ts` | 34 inline layout cases + padded-span geometry (35 tests) |

## Verification

- Probe: 20/34 → 30 (spacing, indent, word breaking, floats, ch/ex) → 31 (rtl); the last three were metric-dependent expectations (Node measures spaces ~2px, "0" ~5.3px) and pass as relative checks.
- Full suite after the changes: 315 files / 11006 passed — nothing depended on floats being ignored.
- Device: the tablet was not connected (`adb devices` empty).

## Test Results

```
npx tsc --noEmit                                    → clean
npx vitest run tests/inline-text-168.test.ts        → 35 passed
npx vitest run                                      → Test Files 315 passed (315); Tests 11006 passed (11006)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.68.apk                      → verified; aapt: versionCode 69, versionName 1.68
```
