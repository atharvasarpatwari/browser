# Nova Android 1.87: W3C — Visually-Hidden Labels, nowrap Under break-word, Specified Widths Wider Than Their Container

**Date:** 2026-11-06
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 334 files, 11429 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

These ran through the tool's own background mode, and nothing else ran beside them.

A new real page was saved, the W3C homepage (`tests/fixtures/w3c-home-2026`: page + `core.css`), and rendered at 412 and 1070px. It showed three defects:
- **Columns of single letters** down the left edge and beside the header (W3C's visually-hidden labels).
- **Main nav broken between letters:** at 412 every item was one letter per line; at 1070 "Resources" broke as "Resource / s".
- **Grey bands too short:** the full-width bands stopped short of the right edge (at x=963 of 1070, and 371 of 412).

Three root causes were traced and fixed. W3C now renders with its labels hidden, the nav on one line and the bands edge to edge.

**Saved real pages, old vs new, offline (12 pages × 412/1070):**
- **Identical:** 21 of 24 renders.
- **W3C ×2:** changes as intended.
- **Hacker News @412:** the text after each row's vote arrow moves 1px right. This was traced to root cause #3 (the cell now reserves the arrow's 10px), which is correct.

## Root Causes

### 1. Positioned boxes always grew to their content, even with overflow hidden
**File:** `src/browser/rendering/layout-engine.ts` (`layoutSinglePositioned`)
**Problem:** W3C's skip link and icon labels use `position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%)`. They were 1px wide and 230–450px tall, running down the page.
**Root cause:** a positioned box took `max(specified height, content height)`, a grow-to-content allowance meant for visible overflow. `layoutNode` already limits that allowance to boxes that don't clip; the positioned path didn't.
**Fix:** a specified height holds when the box clips its overflow (`hidden`, `clip`, `scroll`, `auto`).

### 2. `white-space: nowrap` text broke between letters under `overflow-wrap: break-word`
**File:** `src/browser/rendering/formatting/inline-context.ts` (`addTextRun`)
**Problem:** with W3C's global `overflow-wrap: break-word`, `nowrap` labels broke into one letter per line. At 1070 the nowrap nav link "Resources" broke as "Resource / s".
**Root cause:** the break-a-long-word path ran before, and regardless of, the no-wrap check. `nowrap` and `pre` allow no soft wrap at all (CSS Text §5.1), so `overflow-wrap` has nothing to act on.
**Fix:** the break-word path is skipped under `noWrap`.

### 3. Specified widths were capped at the available width
**File:** `layout-engine.ts` (`layoutNode`, `layoutInlineBlockElement`)
**Problem:**
- W3C's full-bleed bands (`width: 100vw; margin: 0 -50vw; position: relative; left: 50%`) were 371px wide at 412, so the grey stopped short of the right edge.
- While a table measured a cell's minimum width (a 1px pass), a fixed-width block in it was squeezed to 1px. This was Hacker News' 10px vote arrow.

**Root cause:** `borderWidthBox = Math.min(specified, availableWidth)`. CSS never caps a specified width at the containing block: the box overflows it (CSS 2.2 §10.3.3). There was no documented reason for the cap; it dates from an early commit.
**Fix:** a specified width is used as is, for blocks and inline-blocks.
**Verified on HN:** only the vote column's minimum changed (`div.votearrow` spec 10 vs avail 1, ×120). Its rows' text moves 1px right.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | positioned specified height holds when clipping (#1); no width cap (#3) |
| `src/browser/rendering/formatting/inline-context.ts` | no break-word under nowrap (#2) |
| `android/app/build.gradle` | 1.86 (87) → 1.87 (88) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/w3c-home-2026/` | saved W3C homepage + core.css |
| `tests/visually-hidden-full-bleed-187.test.ts` | 7 tests: a 1×1 hidden box keeps its height; nowrap never breaks under break-word (fails on the old code); break-word still breaks without nowrap; full-bleed band spans the viewport; a wide block overflows its parent; a fixed-width block keeps its width in a table cell's minimum; W3C at 412 end to end |

## Test Results
```
Start of round: npx vitest run → 334 files, 11429 passed; tsc exit 0; eslint 0 errors; gradle unit tests exit 0
W3C @1070/@412: span.visuallyhidden 1x454 (position absolute, height 1px, overflow hidden, nowrap computed);
  ul nav items one letter per line @412; div.u-full-width 371 wide (100vw = 412)
Bisect of the HN @412 change (box dumps old vs new): reverting the inline-block cap → still differs; reverting
  the block cap → identical. Instrumented: div.votearrow spec=10 avail=1 measuring=true (×120)
nowrap test against the old inline-context.ts → fails; against the new → passes
npx vitest run tests/visually-hidden-full-bleed-187.test.ts → 7 passed
npx vitest run                     → Test Files 335 passed (335); Tests 11436 passed (11436)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved pages old vs new, offline (12 pages × 412/1070) → 21 identical; w3c ×2 (intended); hn @412 30631 px (vote column, #3)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.87.apk     → verified; versionCode 88, versionName 1.87
adb devices                        → none (not installed)
```
