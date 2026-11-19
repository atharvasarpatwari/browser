# Nova Android 1.76: CSS Grid — Content-Sized Tracks, Line-Based Placement, Auto-Flow, Content Alignment

**Date:** 2026-11-04
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
1.75 left grid content alignment open, so this round ran a **32-case grid probe**. It passed only **13**, and the most severe failure was that auto rows ignored their content, so a grid of text cards was 0px tall and the following content overlapped it.

The track sizing, auto-placement and offset code in `GridFormattingContext` was reworked in focused steps, keeping its API. Placement now resolves lines, names and spans. The probe passes **32/32**.

Real pages: rendered with the same fixture environment, the new grid code changes **zero pixels** on Wikipedia article and search (412 and 1070px), IANA and httpforever. A first comparison showed differences in Wikipedia's header, but they came from the fixture files available to a fresh checkout, not from the code.

## Root Causes

### 1. Auto rows and columns ignored their content
**File:** `src/browser/rendering/formatting/grid-context.ts` (`sizeAxis`)
**Problem:** a track's size came only from items' explicit `width`/`height`. Auto rows holding text were 0px, and the grid's height was 0. `auto` and `max-content` columns were as narrow as their explicit widths.

**Fix:** tracks are sized in a simplified CSS Grid §11 order, columns first because row heights depend on column widths:
- **Content-sized tracks:** auto tracks, and fr tracks in an indefinite axis, take their largest single-span item, through engine callbacks:
  - `measureWidth`: the max-content width (`measureContentWidth`);
  - `measureHeight`: the height when laid out at the area's width (`measureLayout` + `layoutNode`).
- **Multi-track spans:** what a spanning item still needs is spread over the auto tracks it crosses.
- **Auto tracks:** they shrink together so they never overflow a definite container.
- **fr tracks:** they share the leftover space and never go below their base size (iterative freeze).
- **Stretch:** when there are no fr tracks and justify-/align-content is `normal` or `stretch`, auto tracks share whatever is left.

### 2. Content alignment was missing
**File:** `grid-context.ts` (`trackOffsets`)
**Problem:** `justify-content` and `align-content` (`center`, `end`, `space-between`, `space-around`, `space-evenly`) were ignored. A grid with no template got a forced `1fr` column, so `place-content: center` had no free space to centre in.
**Fix:** track offsets distribute the free space. A grid with no column template now has only implicit `auto` tracks, which stretch unless content alignment says otherwise.

### 3. Placement understood only positive line numbers
**Files:** `grid-context.ts` (`resolveGridAxis`, `gridLineNames`, `addAreaLineNames`), `layout-engine.ts` (`layoutGridContainer`)
**Problem:**
- Negative lines (`grid-column: 1 / -1`, full-width rows) and named lines (`[content-start]`, `grid-column: content`) were read as auto.
- The `grid-column-start/-end` and `grid-row-start/-end` longhands were ignored.
- Template areas spanning rows (`"h h" "s m"`) lost their extent.

**Fix:**
- Every axis resolves through `resolveGridAxis`: numbers (negative counts from the end of the explicit grid), names (an area name means its `-start`/`-end` lines), `span N` and `auto`.
- Line names come from the track list and from each template area.
- `grid-area` follows the CSS rules for omitted values (a single name fills all four).

### 4. Auto-placement: only sparse row flow
**File:** `grid-context.ts` (`autoPlaceItems`)
**Problem:** `grid-auto-flow: column` and `dense` were ignored, `order` didn't affect placement, and implicit tracks were always `auto`.
**Fix:** §8.5 in order:
1. items with both lines set;
2. items locked to a row (or column);
3. the rest by the placement cursor.

Items go in `order` order. Column flow swaps the axes and `dense` restarts the search for each item. Implicit tracks use `grid-auto-rows` / `grid-auto-columns`.

### 5. Smaller gaps
- **`grid-template: <rows> / <columns>`** is read when the longhands are `none`.
- **`margin: auto` on a grid item** centres it (or aligns it to the end) in its area (`autoMarginAlign`).
- **`repeat(auto-fit, …)`** columns no item occupies collapse, gaps included. `expandTrackList` reports their indices.
- **`recomputeAlignmentForAutoSize`** counted padding and border twice in the margin box, because a `LayoutBox` width is already the border box.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/formatting/grid-context.ts` | track sizing (#1); content alignment (#2); line/name resolution (#3); auto-placement (#4); auto-fit indices, recompute fix (#5) |
| `src/browser/rendering/layout-engine.ts` | `layoutGridContainer`: grid-template shorthand, implicit tracks, placement via `resolveGridAxis`, measure callbacks, auto margins, new options |
| `android/app/build.gradle` | 1.75 (76) → 1.76 (77) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/grid-layout-176.test.ts` | the 32 grid probe cases |

## Notes
- Another worktree (`ponytail-folder-browser-8b310d`) has uncommitted edits to `layout-engine.ts` on its own branch. These changes stay inside `layoutGridContainer` plus one helper, to keep a later merge small.
- `ponytail:` line names inside `repeat()` are not counted. Tracks use one bound of `minmax()` (as before). Baseline alignment is not implemented.

## Test Results
```
Grid probe (32)                                   → 13 → 30 (sizing, placement, alignment) → 32 (grid-template fallback, probe quoting fix)
npx tsc --noEmit                                  → clean
npx vitest run                                    → Test Files 325 passed (325); Tests 11331 passed (11331)
Real pages, same environment, old vs new code     → 0 px difference (wikipedia ×2 at 412/1070, iana, httpforever)
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.76.apk                    → verified; versionCode 77, versionName 1.76
adb devices                                       → none (not installed)
```
