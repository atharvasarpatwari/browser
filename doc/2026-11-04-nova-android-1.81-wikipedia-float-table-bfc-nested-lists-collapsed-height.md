# Nova Android 1.81: Wikipedia Figure Overlap — Floated Tables, BFCs Beside Floats, Nested Lists, Collapsed Heights

**Date:** 2026-11-04
**Session:** "make a new version changes in the app and make sure all the test cases are been satisfied … identified by the root cause … notified in the analytics page for the tracking"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 328 files, 11377 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

The work then took the defect recorded open in 1.80: on live Wikipedia (tablet, 1070px), the lead figure overlapped a narrow column of squeezed text ("Browsers / are / use / on / a / ran / of").

The saved Wikipedia article reproduces it at 1070px. The 1.80 render shows the same squeezed column, and also a large empty "Contents" box. Four root causes were traced and fixed. The page now lays out like mobile Wikipedia:
- the figure (250px) floats at the right edge, with its caption below;
- text wraps beside it;
- the contents box sits beside it and stays collapsed (46px).

Saved real pages, old vs new code in the same environment: only `wikipedia-article-2026` at 1070px changes (the intended fix). The other six pages at both widths, Wikipedia at 412px and Hacker News included, are pixel-identical.

## Root Causes

### 1. A floated `display: table` was laid out as inline content
**File:** `src/browser/rendering/layout-engine.ts` (`layoutFloatElement`)
**Problem:** Wikipedia's `<figure class="mw-halign-right">` is `display: table; float: right`. Its box took the whole column (941px wide), and the image and caption ran side by side as inline text. Next to it, the paragraph was squeezed into a narrow column.
**Root cause:**
- Float layout had branches for flex, grid and block content only. A floated table fell through to `layoutInlineChildren`.
- Its shrink-to-fit width was measured as block content, which counts the caption's full unwrapped sentence. A table caption doesn't widen a table; it wraps to the table's width.

**Fix:** a floated `table` or `inline-table` starts at the available room and goes through `layoutTableContainer`. Table layout shrinks the box to its columns (the 250px image) and wraps the caption to that width.

### 2. Tables and BFC blocks were laid out under floats instead of beside them
**File:** `layout-engine.ts` (`layoutBlockChildren`)
**Problem:** the contents box (`div.toc`, `display: table`) ran the full column width underneath the floated figure and painted over its caption.
**Root cause:** CSS 2.2 §9.5 says the border box of a table, or of a block that starts a new formatting context, must not overlap floats, but nothing enforced it. Such boxes were laid out at the full width like ordinary blocks.
**Fix:**
- If floats share the box's top edge, the box is laid out in the free band beside them: left offset and available width come from the float context.
- If that band is narrower than min(⅓ of the width, 200px), the box is placed below the floats instead.
- `ponytail:` the band is measured at the box's top edge only.

### 3. A nested list's first `<li>` closed the outer item and list
**File:** `src/browser/rendering/html5/modes/body.ts`
**Problem:** in `<ul><li>B<ul><li>B1</li></ul></li><li>C</li></ul>`, `B1` became a sibling of `B` and `C` ended up outside the list. In Wikipedia's contents, every entry after the first nested sub-list escaped the folded list, so it showed and lost its indent.
**Root cause:**
- The `<li>` start-tag rule (§13.2.6.4.7) walks up the stack and must stop at a special element other than address, div and p. The code instead treated `ul` and `ol` as transparent, so it walked past the inner list and closed the outer `<li>`.
- The `dd`/`dt` rule had the opposite error: it stopped at `div` and `address`, which the spec passes through.

**Fix:** both rules stop at special elements except address, div and p.

### 4. `height: 0` collapsed boxes grew to their content
**File:** `layout-engine.ts` (`layoutNode` content height)
**Problem:** Wikipedia folds its contents list with `.toctogglecheckbox ~ ul { visibility: hidden; height: 0 }`. Nova still gave the list its full 156px, leaving a large empty grey box.
**Root cause:** a deliberate simplification lets a visible-overflow box with a specified height grow to its content. It absorbs Nova's font metrics being slightly larger than real browsers'. That also applied to boxes meant to be collapsed.
**Fix:** a box keeps its specified height when that height is `0`, or when the box is `visibility: hidden`, since its content can't be seen anyway. The growth simplification is unchanged for ordinary heights.

## Not changed (recorded)
- **Line break before a comma:** "As of 2026 / , the most used". A break is allowed before the comma where an inline element boundary falls (an empty `<span>` follows a hidden `<sup>`). UAX #14 has no break opportunity before a comma.
- **MDN (live, from 1.80):** stray boxes after the navigation items, grey bars over the article, and the heading clipped at the left.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | floated tables through table layout (#1); tables and BFCs beside floats (#2); collapsed heights kept (#4) |
| `src/browser/rendering/html5/modes/body.ts` | li / dd / dt stop at special elements per spec (#3) |
| `android/app/build.gradle` | 1.80 (81) → 1.81 (82) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/wikipedia-figure-toc-181.test.ts` | 7 tests: floated table with caption; table and overflow:hidden block beside floats; nested lists; dd in div; `height: 0`; the saved Wikipedia article at 1070px end to end |

## Test Results
```
Start of round: npx vitest run → 328 files, 11377 passed; tsc clean; eslint 0 errors; gradle unit tests OK
Saved Wikipedia @1070 (before): figure 941x163 at x=38, caption beside the image at x=288; toc 963x389 under the float
Diagnosis: float → layoutInlineChildren; toc ul visibility:hidden but 156px tall; "Security" li parented to div.toc
Parser probe: <ul><li>B<ul><li>B1 → B1 sibling of B, C outside the list (fixed → nested correctly)
Saved Wikipedia @1070 (after): figure 250x202 at the right edge, caption below; toc 691x46 beside the float
npx vitest run tests/wikipedia-figure-toc-181.test.ts → 7 passed
npx vitest run                     → Test Files 329 passed (329); Tests 11384 passed (11384)
npx tsc --noEmit                   → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved real pages, old vs new (7 pages × 412/1070) → only wikipedia-article @1070 differs (intended); all others 0 px
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.81.apk     → verified; versionCode 82, versionName 1.81
adb devices                        → none (not installed)
```
