# Nova Android 1.25 — Wikipedia Results in ~3 s Instead of ~13 s; Floats, Flex Items, min-height

**Date:** 2026-10-20
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 14.
**Status:** Completed (the speed-up was measured on the tablet; the final layout-only build could not be checked there because the tablet locked)

---

## Summary
Wikipedia's results page took about 13 s on the OPD2305 tablet. With a new per-page phase timing log, the cost turned out to be almost all in the first frame's text rasterization: about 10 s of GPU readbacks. Fixing that, and indexing the cascade, brings the page to about 3 s on the tablet. Locally the full render went from 5.7 s to 1.6 s.

Also fixed, all found on the same page:
- floats drew their content at the first float's position;
- inline children of flex containers were dropped;
- `inline-flex` boxes were 0×0;
- `min-height`/`max-height` were ignored;
- a `<select>` with `font-size: 1rem` was 1px tall.

## Root Causes

### 1. Every text run stalled the GPU (≈10 s of the first frame)
**File:** `src/browser/rendering/text-raster.ts`

**Problem:** Each run is drawn into a scratch canvas and read back with `getImageData` as a coverage mask. The 2D context had no `willReadFrequently`, so Android's WebView backed it with the GPU and every readback was a GPU sync. The canvas was also resized for every run, which reallocates it. Chrome even logged the warning ("Multiple readback operations using getImageData are faster with the willReadFrequently attribute").

**Fix:**
- `getContext('2d', { willReadFrequently: true })` keeps the canvas in CPU memory.
- The canvas only grows; a run uses a corner that is cleared first with `clearRect`.
- Whitespace-only runs keep their advance but skip the draw and readback.
- The mask cache limit went from 512 to 4096 (a long page churned through 512).

### 2. Every element re-flattened the stylesheet and tested every selector
**Files:** `src/browser/rendering/css5/cascade.ts`, `css5/selector.ts`

**Problem:** `computeComputedStyles` re-ran `collectStyleRules`, `@media` evaluation included, for each element. It then tested all 3,142 rules against all 666 elements. `parseClassList` re-split the `class` attribute on every selector test, even for selectors without classes.

**Fix:**
- `ruleIndexFor(stylesheet, viewport)` flattens once (memoized in a WeakMap, keyed by viewport size and rule count). It buckets rules by the key of each selector's rightmost compound: id, else first class (lowercased, as the matcher compares classes case-insensitively), else tag; anything else is universal.
- An element only tests the universal bucket plus its tag, id and class buckets, in stylesheet order. `matchesSelectorList` still does the full match, so results are unchanged.
- `parseClassList` is cached per class string and only called when a selector has classes.

### 3. No visibility into where a page's time goes on a device
**File:** `src/browser/engine/page-renderer.ts`

**Fix:** One `console.info` line per page, which reaches logcat on Android:
```
[render] html 66 · css 688 · style 481 · layout 114 · paint 27 · frame 9996 · scripts 170 · style2 342 · layout2 60 · paint2 25 ms
```
That line (before the fix) is what pointed at `frame`.

### 4. A float placed below earlier floats left its content behind
**File:** `src/browser/rendering/layout-engine.ts` (`layoutFloatElement`)

**Problem:** The children were laid out first, then `placeFloat` moved the float's box below earlier floats, and the children stayed put. Every floated `<li>` in Wikipedia's sister-project sidebar drew its text on top of the first one's. The float's box was also registered only after its children, so `populateTextRuns` found no box: a float's own text was dropped.

**Fix:**
- Register the box before laying out the children.
- After placement, `translateContent(el, dx, dy)` moves the subtree to the float's final content origin.

### 5. Inline children of flex/grid containers were dropped
**Problem:** The flex and grid item loops skipped `classifyDisplay(...) === 'inline'`, so Wikipedia's footer wordmark `<img>` got no box at all.

**Fix:** CSS Display §2.7: children of flex/grid containers are blockified items. Only `display: none` is skipped now.

### 6. `inline-flex`/`inline-grid` flowed as plain inlines (0×0)
**Problem:** Only `inline-block` was laid out as an atomic inline. Wikipedia's footer icon links are `inline-flex; overflow:hidden`. Before 1.24 they showed only because `overflow` never clipped; after it, they vanished.

**Fix:**
- `isAtomicInline()` covers inline-block, inline-flex and inline-grid at all three IFC sites.
- `layoutInlineBlockElement` lays their content out with `layoutFlexContainer`/`layoutGridContainer`.

### 7. `min-height`/`max-height` were never applied
**Fix:** `clampContentHeight()` (CSS 2.2 §10.7, box-sizing aware) runs for block boxes and inline-blocks.

> ponytail: percentages are skipped; they need a definite containing-block height.

### 8. `font-size: 1rem` made a `<select>` 1px tall
**Problem:** `resolveIntrinsicSize` read the computed `font-size` with `parseFloat`. The value can still be `1rem` there, which reads as 1px.

**Fix:** It goes through `resolveFontSize` (rem/em/%). Together with `min-height`, Wikipedia's results-per-page select is now 128×32 and shows "20 items".

## Files Modified
| File | Change |
|------|--------|
| `android/app/build.gradle` | versionCode 26, versionName 1.25 |
| `src/browser/rendering/text-raster.ts` | `willReadFrequently`; grow-only canvas + `clearRect`; no draw for whitespace runs; cache 4096 |
| `src/browser/rendering/css5/cascade.ts` | `ruleIndexFor` (flatten once, bucket by rightmost compound) |
| `src/browser/rendering/css5/selector.ts` | `parseClassList` cached and only used when needed |
| `src/browser/engine/page-renderer.ts` | `[render]` phase timing line |
| `src/browser/rendering/layout-engine.ts` | Float box registered first + content translated after placement; flex/grid inline items; `isAtomicInline` + flex/grid inside inline boxes; `clampContentHeight`; control font size via `resolveFontSize` |
| `tests/text-raster.test.ts` | Stub canvas gains `clearRect`; +1 test |
| `tests/wikipedia-render.test.ts` | +4 tests (floats, min/max-height, flex items + inline-flex, results-page select) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/cascade-rule-index.test.ts` | 3 tests: classes matched case-insensitively, tags in any case, ids; `:is()`/attribute/`*` rules and source order across buckets; `@media` re-evaluated per viewport, no mixing of stylesheets |

## Test Results
```
npx tsc --noEmit                      → exit 0
npx vitest run                        → Test Files 279 passed (279) · Tests 10563 passed (10563)   (+8 incl. new file)
./gradlew :app:testDebugUnitTest      → exit 0
apksigner verify Nova-1.25.apk        → verified
```

### Timings
| Where | Before | After |
|-------|--------|-------|
| Local (vitest, results page): applyComputedStyles ×2 | 4,527 ms | 951 ms |
| Local: total render | 5,696 ms | 1,628 ms |
| Tablet: first-frame raster (`frame`) | 9,996 ms | 1,179 ms |
| Tablet: page in hand (fetch → final paint) | ~13 s | ~3.1 s |

## Verification
- **Tablet (OPD2305), build with the raster + cascade changes:** the `[render]` line shows `frame 1179` (was `9996`). The results page renders identically: heading, count, query, results with bold matches.
- **Final build** (adds the float, flex, inline-flex, min-height and select fixes): installed with "Success". The tablet then went to sleep, locked, so it isn't checked on the device yet. The fixes are covered by the new tests and by local layout dumps:
  - sidebar `li`s each carry their content (header y follows each li's y: 474, 596, …);
  - the footer `<img>` is 70×22;
  - the icon links are 415×44;
  - the select is 128×32.

## Known Remaining
- Hit testing doesn't follow paint order: positioned boxes should be tested before in-flow ones.
- Wikipedia's sister-project sidebar is laid out 900px wide at x=645, so it runs off the page edge. That's a percentage width inside an inline-block.
- `iw-result__content` divs come out 0px tall.
- From earlier rounds:
  - the user menu is placed ~400px up;
  - the inline `className` script has no effect;
  - orphan table cells stack;
  - POST forms are still Round B.
