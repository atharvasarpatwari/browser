# Nova Android 1.86: Flex/Grid Item Blockification and Positioned-Box Percentages

**Date:** 2026-11-05
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
**Baseline.** The start-of-round checks were launched with a shell `&` from the tool shell, and the chain was killed when that shell exited. The vitest log stops with no summary or exit line, and the tsc, ESLint and gradle outputs were never written. (Its `AbortError` traces are routine happy-dom teardown noise and appear in normal runs too.) The code was unchanged since 1.85's final run on `71bcbc1`: 333 files, 11424 tests, `tsc` clean, ESLint 0 errors, gradle unit tests OK. That run is the baseline. Later runs used the tool's own background mode.

**This round.** A new real page was saved, the Python documentation tutorial (`tests/fixtures/pydoc-tutorial-2026`: page + 6 stylesheets), and rendered at 412 and 1070px.
- At 1070 it renders well: sidebar, code blocks, header.
- At 412 the mobile header was wrong: a solid black square where the menu button belongs, and the fixed top bar narrower than the screen.

Both were traced to general root causes and fixed.

## Root Causes

### 1. Flex and grid items were not blockified
**File:** `src/browser/rendering/css5/cascade.ts` (`computeComputedStyles`)
**Problem:** Python docs' hamburger bar, `<span style="height: 2px; width: 100%">` inside `display: flex`, was a 24×20 black square instead of a 2px bar. Its `::before`/`::after` bars stacked on it.
**Root cause:**
- A flex or grid item's computed `display` is blockified: inline → block, inline-block → block, inline-flex → flex and so on (CSS Display §2.7, Flexbox §4).
- Nova blockified floats and absolutely positioned boxes only. The span item stayed `inline`, and an inline box ignores `height`, so it was a line tall.

**Fix:** a child of a `flex` / `inline-flex` / `grid` / `inline-grid` parent is blockified with the existing table. `ponytail:` the DOM parent is checked; a `display: contents` parent's own parent isn't.

### 2. A positioned box's percentages came from where it sat in the flow
**File:** `src/browser/rendering/layout-engine.ts` (`layoutSinglePositioned`)
**Problem:**
- Python docs' mobile bar (`position: fixed; width: 100%`) was 380px wide, its parent's width, not the 412px viewport.
- An absolute `width: 50%` box inside a 100px block inside a `position: relative` 300px box was 50px, not 150px.

**Root cause:** percentages, margins, padding and the shrink-to-fit room used the available width at the place the box was queued in the flow. CSS 2.2 §10.1 resolves them against the containing block: the viewport for fixed boxes (or no positioned ancestor), else the positioned ancestor's padding box.
**Fix:** `layoutSinglePositioned` takes its width basis from the containing block: the viewport, or the ancestor's border box minus its borders.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | flex/grid items blockified (#1) |
| `src/browser/rendering/layout-engine.ts` | positioned percentages from the containing block (#2) |
| `android/app/build.gradle` | 1.85 (86) → 1.86 (87) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/pydoc-tutorial-2026/` | saved Python docs tutorial page + 6 stylesheets |
| `tests/flex-item-blockify-fixed-percent-186.test.ts` | 5 tests: span flex item keeps its 2px height; inline-flex/inline-block/grid items blockified and non-items untouched; fixed `width: 100%` is the viewport; absolute % from the positioned ancestor; the saved Python docs page at 412 end to end |

## Test Results
```
Start-of-round run: killed with its launching shell (no summary/exit line; tsc/eslint/gradle outputs never written); baseline = 1.85 final run on 71bcbc1
  (333 files, 11424 passed; tsc clean; eslint 0 errors; gradle OK)
Python docs @412: toggler span 24x20 (display inline, height 2px ignored); .mobile-nav 380 wide (viewport 412)
Repro: span flex item 24x20 → 24x2; div flex item 24x2 (unchanged); fixed width:100% in padded parent 380 → 412
npx vitest run tests/flex-item-blockify-fixed-percent-186.test.ts → 5 passed
npx vitest run (1st, while vite build, gradle, tsc and eslint ran beside it) → 2 failed | 11422 passed:
  search-performance timing gates (p95 69.4 ms vs 32; 31.2 ms vs 30), calibration ×2.8–2.9 = a loaded machine
  Root cause: CPU contention from my concurrent build/lint, not the code. src/browser/search imports neither
  changed module (cascade.ts, layout-engine.ts); npx vitest run tests/search-performance.test.ts alone → 16 passed
npx vitest run (2nd, idle machine) → Test Files 334 passed (334); Tests 11429 passed (11429)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved pages old vs new, offline (11 pages × 412/1070):
  identical: example.com, google, hn, httpbin, httpforever, iana, wikipedia-results, wikipedia-search (×2 each); pydoc @1070
  changed (each checked):
    pydoc @412: the hamburger is three 2px bars; the mobile bar spans the viewport (intended)
    mdn: an empty <mdn-placement-sidebar> flex item was an inline line box (22px); blockified, it is 0 tall,
      so the article below moves up 22px, as in browsers
    wikipedia-article: 278 / 48 px; a footer icon item is its square size, not a line-tall bar
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.86.apk     → verified; versionCode 87, versionName 1.86
adb devices                        → none (not installed)
```
