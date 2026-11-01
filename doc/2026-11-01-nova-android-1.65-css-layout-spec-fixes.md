# Nova Android 1.65: CSS Layout Brought to Spec (41-case Probe: 26 → 41)

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — a probe of 41 everyday CSS layout behaviours against their spec values
**Status:** Completed (tablet not connected this round: verified by tests; APK built, not installed)

---

## Summary

A 41-case probe (flex, grid, box model, positioning, units, margins) passed 26. All 15 failures were real engine bugs, several of them on almost every page: every element defaulted to `box-sizing: border-box`, adjacent margins never collapsed (every gap between paragraphs, headings and list items was doubled), `repeat(auto-fill, minmax(…))` grids collapsed to zero-width tracks, and `inset: 0` overlays had no size. All 41 now pass.

## Root Causes

### 1. Every element was `box-sizing: border-box`
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** the UA defaults set `border-box` on all elements (noted in the 1.12 doc and left). The initial value is `content-box`, so pages without a `* { box-sizing: border-box }` reset lost their padding and borders from every width.
**Fix:** the shared default is gone; `<table>` and form controls keep their own UA border-box.

### 2. Adjacent sibling margins added instead of collapsing
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `layoutBlockChildren` stacked each block at the previous block's margin-bottom plus its own margin-top. CSS 2.2 §8.3.1 collapses them.
**Fix:** it tracks the previous block's bottom margin and pulls the next block up by `prev + top − collapseMargins(prev, top)` (the existing `block-context` helper, imported but unused). Inline content or clearance between them resets it.

### 3. `flex` shorthand misparsed
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `parseFloat('0') || 1` made shrink 0 into 1 (`flex: none` and `flex: 0 0 120px` items shrank), the three-value basis came from the `flex-basis` longhand (so `0 0 120px` was 0 wide), and `1 200px` read 200px as the shrink factor.
**Fix:** `parseFlexShorthand()` per Flexbox §7.2 (`none`, `auto`, `initial`, `<grow> <shrink>? || <basis>`; omitted grow/shrink 1, basis 0%).

### 4. `inset` never expanded
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem/Fix:** `inset: 0` didn't reach `top/right/bottom/left`, so overlays and backdrops were 0×0; it now expands like `margin`.

### 5. `%` height resolved against the width, and fixed heights grew
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `height: 50%` used the available *width* (300px in a 200px-tall parent on a 600px page), and a box with a height grew to fit its content even with `overflow: hidden`.
**Fix:** `percentHeightBase()` resolves against the parent's definite height (lengths, percentages of definite heights, the viewport for the root) and treats the height as `auto` otherwise; a box that clips its overflow keeps its specified height. ponytail: overflow-visible boxes still grow (it covers Nova's font metrics being wider than the page's).

### 6. Auto margins in flex were 0
**Files:** `src/browser/rendering/formatting/flex-context.ts`, `layout-engine.ts`
**Problem:** `margin-left: auto` (the standard way to push nav items right) did nothing.
**Fix:** items record which margins are auto; positive free space on the line is shared among them before `justify-content` (Flexbox §8.1).

### 7. Absolutely positioned boxes didn't centre with auto margins
**Files:** `src/browser/rendering/positioning.ts`, `layout-engine.ts`
**Problem:** `left:0; right:0; width:100px; margin:auto` (and the `inset:0; margin:auto` modal) stayed at the left/top.
**Fix:** CSS 2.2 §10.3.7 horizontally in `resolveOutOfFlow`; §10.6.4 vertically after layout, when the height is known.

### 8. `minmax()` mangled by the math-function evaluator
**File:** `src/browser/rendering/css5/math-functions.ts`
**Problem:** the scanner matched `max(` inside `minmax(` and evaluated it: `repeat(auto-fill,minmax(150px,1fr))` became `repeat(auto-fill,min150px)`.
**Fix:** function names must start at a boundary (`MATH_CALL`).

### 9. Grid tracks: `repeat()`/`minmax()`/auto-fill unsupported
**File:** `src/browser/rendering/formatting/grid-context.ts`
**Problem:** the whitespace tokenizer cut `repeat(…minmax(…))` at the first `)`; nothing resolved `minmax()` or `repeat(auto-fill, …)` (both 0px). Responsive card grids piled up at the origin.
**Fix:** `expandTrackList()` — a parenthesis-aware split; `repeat(N, …)` and `repeat(auto-fill|auto-fit, …)` expanded (count = how many minimum-size copies fit, with gaps); `minmax(a, b)` → `b` when it is `fr` or a length, else `a`; `fit-content()`/`min-content`/`max-content` → `auto`. ponytail: auto-fit doesn't collapse empty tracks.

### 10. `grid-column: span N` ignored
**File:** `grid-context.ts`, `layout-engine.ts`
**Problem/Fix:** `span 2`, `1 / span 2`, `span 2 / 4` parsed as auto (one cell); placements now carry spans and auto-placement finds a free run of that size.

### 11. `grid-area: name` skipped its template area
**File:** `layout-engine.ts`, `grid-context.ts`
**Problem:** a computed `grid-column: auto` counted as an explicit placement, so the area lookup never ran; template rows in single quotes weren't read at all.
**Fix:** `auto` is treated as unset; `'…'` rows are parsed like `"…"`.

### 12. `width: fit-content / max-content / min-content` were 0
**File:** `layout-engine.ts`
**Fix:** they size the box by measuring its content (`measureContentWidth`, at 1px for min-content).

### 13. `display: contents` wrappers laid out as one box
**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** a flex/grid whose items sat in a `display:contents` wrapper got one item.
**Fix:** `boxChildren()` replaces a `contents` element by its children. Dirty-flag walks now use `flagChildren()` (all DOM children + generated boxes): a walk that skipped a node left its flag set, and `markDirty` stops at a dirty ancestor.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | no border-box default (#1); `inset` expansion (#4) |
| `src/browser/rendering/layout-engine.ts` | margin collapse (#2); `parseFlexShorthand` (#3); % height, clipping heights (#5); flex auto margins (#6); vertical abs centring (#7); track expansion (#9); spans (#10); `auto` placements (#11); intrinsic widths (#12) |
| `src/browser/rendering/formatting/flex-context.ts` | auto main-axis margins (#6) |
| `src/browser/rendering/positioning.ts` | horizontal abs centring (#7) |
| `src/browser/rendering/css5/math-functions.ts` | name boundaries (#8) |
| `src/browser/rendering/formatting/grid-context.ts` | `expandTrackList`, spans, quoted areas (#9–#11) |
| `src/browser/rendering/dom-tree.ts` | `display: contents`, `flagChildren` (#13) |
| `tests/flex-layout.test.ts` | `flex: 2 1 100` now keeps its 100px basis: exact-sum assertion → `toBeCloseTo` |
| `android/app/build.gradle` | versionCode 66, versionName 1.65 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/css-layout-165.test.ts` | the 41 layout cases + flex shorthand, minmax/math, track-list parser tests (44 tests) |

## Verification

- Probe: 26/41 → 29 (box-sizing) → 30 (flex) → 31 (inset) → 32 (collapse) → 33 (% height) → 34 (flex auto margins) → 36 (abs centring) → 37 (span) → 38 (auto-fill) → 39 (areas) → 40 (fit-content) → 41 (contents).
- Full suite after the box-sizing change alone: 311 files / 10791 passed (nothing depended on the old default).
- Device: the tablet was not connected (`adb devices` empty), so 1.65 is built and signed but not yet installed or checked on it.

## Test Results

```
npx tsc --noEmit                                  → clean
npx vitest run tests/css-layout-165.test.ts       → 44 passed
npx vitest run                                    → Test Files 312 passed (312); Tests 10835 passed (10835)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.65.apk                    → verified; aapt: versionCode 66, versionName 1.65
```
