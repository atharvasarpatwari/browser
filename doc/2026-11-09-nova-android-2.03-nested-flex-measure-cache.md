# Nova Android 2.03: Nested Flex Layout Was Exponential in Nesting Depth: Measurements Are Cached Per Layout Pass

**Date:** 2026-11-09
**Session:** "keep improving the nova app and update analytics.html"
**Status:** Completed (offline measurements). No device was connected for a tablet run.

---

## Summary
After 2.02, the profile of CNN's real page still put about 4 s of its ~6 s of layout in `item.autoMinMainSize`. A test of 14 nested flex containers showed why: **82 seconds** before this change, under 4 s after it. Layout cost grew exponentially with flex nesting, and menus and card grids on news sites nest flex containers deeply.

| Offline (desktop CPU) | 2.02 | 2.03 |
|---|---|---|
| CNN render, scripts removed | ~22 s (layout 6.2 s) | 17.5 s (layout 2.2 s) |
| 14 nested flex containers | 82 s | under 4 s |

## Root Cause

### 1. Each flex container re-measured every level beneath it
**File:** `src/browser/rendering/layout-engine.ts` (`measureContentWidth`)
**Problem:** layout time doubled with each level of flex nesting.
**Root cause:**
- A flex item's `min-width: auto` is its min-content width, which `measureContentWidth` finds by laying out the whole item's subtree at 1 px.
- That layout contains nested flex containers, each of which measures its own items the same way.
- So an item at depth d was measured by every container above it, and each of those measurements measured it again: work doubled per level.
- Nothing remembered a measurement from earlier in the pass.

**Fix:** measurements are cached for the duration of one layout pass, keyed by element and arguments (available width, font size, flex, uncapped):

```ts
private measureCache = new Map<string, number>();
// measureContentWidth: look up `${el.domId}|${availableWidth}|${fontSize}|${flex}${uncapped}`,
// else measureContentWidthUncached(...) and store.
```

The cache is cleared at the start of every full layout and every incremental layout, since the DOM or styles may have changed in between. The measurement already restores the element's own box and undoes its side effects, so the same arguments give the same result within a pass.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | per-pass `measureCache` around `measureContentWidth`; cleared in `layout()` and `layoutIncremental()` |
| `tests/render-speed-202.test.ts` | nested-flex test (fails at 82 s without the cache) |
| `android/app/build.gradle` | 2.02 (103) → 2.03 (104) |

## Test Results
```
npx vitest run tests/render-speed-202.test.ts → 4 passed; without the cache the new test fails: 82,052 ms vs the 4,000 ms limit
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (10 warnings)
npx vitest run                     → Test Files 338 passed (338); Tests 11461 passed (11461) (before the new test; 11462 with it)
CNN probe (page saved in %TEMP%, scripts removed), 2 runs: 17.7 s and 17.5 s (2.02: 21.5-22 s); layout 6.2 s → 2.2 s
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.03.apk     → verified; versionCode 104, versionName 2.03
Device: none connected (adb listed no devices); not installed or timed on a tablet.
```
