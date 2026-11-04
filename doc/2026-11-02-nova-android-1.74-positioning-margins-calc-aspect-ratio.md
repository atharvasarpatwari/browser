# Nova Android 1.74 (engine): Margin Collapsing, em in calc(), aspect-ratio, vertical-align, Fixed Boxes in Transformed Ancestors

**Date:** 2026-11-02
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"; then "commit the changes"
**Status:** Committed (engine changes only; no version bump or APK; the full suite was not re-run after the last two fixes, see Test Results)

---

## Summary
A 51-case probe of positioning, sizing and margins passed 45 at first and **51/51** after the fixes below. Before the last two fixes (vertical-align and fixed containing blocks) the full suite passed 322 files and 11152 tests, and three real pages were compared with a HEAD baseline:
- **IANA:** the lower content moves up about 8px, from margins now collapsing.
- **Wikipedia:** the header now shows its icons.
- **httpforever:** identical.

## Root Causes

### 1. `em` inside `calc()` / `min()` / `max()` used the parent's font size
**File:** `src/browser/rendering/css5/computed-value-resolver.ts`
**Problem:** the cascade evaluated math functions with `fontSize: ctx.parentFontSize` for every property. So `font-size: 10px; width: calc(2em + 5px)` was 37px wide instead of 25px.
**Fix:** `resolveAllComputedValues` resolves `font-size` first. Other properties then evaluate `em` against the element's own font size, through a new `ResolutionContext.fontSize`; only `font-size` itself uses the parent's.

### 2. `aspect-ratio` needed an explicit width
**File:** `src/browser/rendering/layout-engine.ts` (`layoutNode`)
**Problem:** with `width: auto`, the height was 0, so 16/9 video and card frames collapsed.
**Fix:** the height comes from the used width whenever a ratio is set.

### 3. Parent and first-child top margins never collapsed
**File:** `layout-engine.ts`
**Problem:** with `body { margin: 8px }` and `h1 { margin: 21px }`, the heading sat 29px down instead of 21px. A wrapper's background also started above its child's margin.
**Fix:**
- `firstChildTopMargin()` / `effectiveTopMargin()` follow the first in-flow block child chain, stopping at borders, padding, BFC roots and inline content (§8.3.1).
- `layoutNode` places a box by its own top margin collapsed with that chain, and `layoutBlockChildren(…, collapseFirstTop)` lifts the first child to the content top.
- Sibling collapsing uses the same effective top margin.

### 4. Empty blocks didn't let margins collapse through them
**File:** `layout-engine.ts` (`layoutBlockChildren`)
**Problem:** an empty `<div style="margin:10px 0">` between blocks added 10px to a 20px gap.
**Fix:** a zero-height block with no text collapses its top and bottom margins with the pending margin.
`ponytail:` not when it is a first child whose margin already collapsed into the parent.

### 5. `vertical-align: middle | top | bottom` on inline-blocks and images was ignored
**Files:** `formatting/inline-context.ts`, `formatting/types.ts`, `layout-engine.ts`
**Problem:** atomic inlines were all baseline-aligned. A middle-aligned icon in a 40px line sat at y≈3 instead of being centred.
**Fix:** `InlineLevelBox.lineAlign`. `finalize()` centres `middle` boxes in the finished line box and pins `top` and `bottom` boxes to its edges. These boxes don't raise the line's baseline.
`ponytail:` "middle" centres in the line box rather than using baseline + x-height/2. Text baselines carry no half-leading here, so the spec formula would land too high.

### 6. Transformed ancestors didn't contain fixed (or absolute) boxes
**Files:** `src/browser/rendering/positioning.ts`, `layout-engine.ts`, `paint-engine.ts`
**Problem:** `position: fixed` always used the viewport, even inside a transformed modal or slide-in panel.
**Fix:**
- `createsFixedContainingBlock(style)` covers `transform`, `perspective`, `filter`, `backdrop-filter`, `will-change` of those, and `contain` paint/layout. `findContainingBlock` uses it for both fixed and absolute boxes.
- All six layout call sites stopped short-circuiting `fixed` to `null`.
- The painter's fixed-layer test (`isInFixedBox`) skips fixed boxes that have such a containing block, so they scroll with it.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/computed-value-resolver.ts` | own-font em in math functions (#1) |
| `src/browser/rendering/layout-engine.ts` | aspect-ratio (#2); margin collapse through parents and empty blocks (#3, #4); vertical-align line alignment (#5); fixed containing blocks (#6) |
| `src/browser/rendering/formatting/inline-context.ts` | line-relative alignment in `addBox` / `finalize` (#5) |
| `src/browser/rendering/formatting/types.ts` | `InlineLevelBox.lineAlign` (#5) |
| `src/browser/rendering/positioning.ts` | `createsFixedContainingBlock`; `findContainingBlock` (#6) |
| `src/browser/rendering/paint-engine.ts` | fixed layer excludes boxes inside transformed ancestors (#6) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/layout-positioning-174.test.ts` | the 51 probe cases as permanent tests |

## Test Results
```
Probe (51 cases)                                    → 45 → 46 (calc em) → 47 (aspect-ratio) → 49 (margins) → 50 (vertical-align) → 51 (fixed CB)
npx vitest run (after #1–#4)                         → Test Files 322 passed (322); Tests 11152 passed (11152)
npx tsc --noEmit (final)                             → clean
npx vitest run tests/layout-positioning-174.test.ts tests/layout-engine.test.ts
  tests/real-page-fixes-171.test.ts tests/flex-grid-172.test.ts (final) → 4 files, 128 passed
Full suite after #5–#6                               → not run (interrupted; to run before the next build)
```
