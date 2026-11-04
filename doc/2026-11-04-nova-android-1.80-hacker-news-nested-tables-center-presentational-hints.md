# Nova Android 1.80: Live-Site Test — Hacker News (Nested Tables, `<center>`, Presentational Attributes, Absolute Units)

**Date:** 2026-11-04
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built and verified; the tablet disconnected before install, so it is not on the device)

---

## Summary
Nova 1.79 loaded four live public sites on the tablet:

| Site | Result on the tablet |
|---|---|
| example.com | Good |
| Wikipedia mobile | Mostly right; the lead figure overlaps a narrow column of text |
| Hacker News | Broken |
| MDN | Several paint and overflow problems |

On Hacker News, the orange header covered the page, each rank number sat at the end of the previous row, and titles ran into their points line.

The HN front page and its stylesheet were saved as a fixture (`tests/fixtures/hn-2026`) and the page was bisected in Node. **Seven** separate root causes were found and fixed. The saved page now lays out like a browser: a 24px orange header, a centred 85% table, and rank, vote and title cells on one row with the points line below.

The six saved real pages, rendered in the same environment with old and new code, are **pixel-identical**. The fixes change only pages that use nested tables, `<center>`, presentational attributes or absolute units.

## Root Causes

### 1. Nested tables broke the tree builder: every later row nested into the previous cell
**File:** `src/browser/rendering/html5/tree-builder.ts` (`resetInsertionMode`)
**Problem:** after a table inside a table cell closed, the outer `</td></tr>` closed nothing, and every following row was parsed **inside** that cell. On HN all 30 stories became children of the orange header cell.
**Root cause:** "reset the insertion mode appropriately" (§13.2.4.1) looked only at the current node and had no `td`, `th` or `tr` cases. After `</table>` the current node is the outer `td`, so the parser fell to "in body", where `</td>` and `</tr>` are ignored.
**Fix:** the spec algorithm walks the stack of open elements from the current node up to the first element that decides the mode: select (in table or not), td/th (cell), tr, tbody/thead/tfoot, caption, colgroup, table, template, head, body, frameset, html.

### 2. A `<tr>` opened inside an open row nested into it
**File:** `src/browser/rendering/html5/modes/table.ts` (`handleInRow`)
**Problem:** with `<tr style='height:10px'/>` followed by `<tr id="bigbox">` (HN), the second row was parsed inside the first. The slash doesn't self-close a non-void element.
**Root cause:** the "in row" start-tag case listed caption, col, colgroup, tbody, tfoot, thead and `table`, but not `tr` (§13.2.6.4.14), and its scope check tested the token's own tag instead of `tr`.
**Fix:**
- The case list is now the spec's, with `tr`; `table` now goes through the in-table rules.
- The scope check tests for `tr`.
- The stack is cleared back to the row before it is popped.

### 3. `<center>` had no UA style
**File:** `src/browser/rendering/css5/cascade.ts` (UA defaults), `layout-engine.ts`
**Problem:** HN wraps its whole page in `<center>`. Nova treated `<center>` as an inline element.
**Root cause:** `center` was missing from the UA block elements.
**Fix:**
- `<center>` is `display: block; text-align: -webkit-center` (HTML §15.3.3).
- `-webkit-center` aligns inline content like `center` (`effectiveTextAlign`).
- A block child of a `-webkit-center` parent that has zero horizontal margins is centred, like `margin: 0 auto`. This is the behaviour pages rely on in Blink and WebKit.

### 4. Block-level tables, flex and grid boxes inside an inline were flowed as text
**File:** `src/browser/rendering/layout-engine.ts` (`layoutInlineChildren`, `flowInlineElement`)
**Problem:** a table inside an inline element (`<span><table>…`, or HN's table inside the then-inline `<center>`) had its rows and cells laid out as inline content, so cells ran together on lines.
**Root cause:** only `display: block` took the block-in-inline path (1.78's `breakForBlock`). Table, flex, grid, list-item and flow-root boxes fell through to inline flow.
**Fix:** `BLOCK_LEVEL` covers every block-level display. `ponytail:` `inline-table` is still flowed inline instead of being laid out as an atomic inline.

### 5. No HTML presentational attributes were applied
**File:** `src/browser/rendering/css5/cascade.ts` (`presentationalHints`)
**Problem:**
- `<table width="85%">` shrank to its content.
- `bgcolor="#ff6600"` (the orange header) and `bgcolor="#f6f6ef"` weren't drawn.
- `cellspacing="0"` left 2px gaps between cells.
- `align="right"` rank numbers stayed left.

**Root cause:** the cascade had no presentational-hint step (HTML §15.1). Attributes reached only a few elements' intrinsic sizes.
**Fix:** after the UA styles and below every author rule, these attributes now map to CSS:
- **Colours:** `bgcolor`, with the legacy bare-hex form (`ff6600` → `#ff6600`), and `<body text>`.
- **Sizes:** `width` and `height` on tables, cells, `col`/`colgroup` and `hr`.
- **Alignment:** `align` becomes `text-align` on cells, rows and blocks. On tables, `align=center` gives auto margins and `left`/`right` floats the table.
- **Cells:** `valign`, and `nowrap`.
- **Tables:** `cellspacing`, `cellpadding` (on the table's own cells), and `border="N"` (outset table border, 1px inset cell borders).
- **`<font>`:** `color`, `face` and `size` (1 to 7 and relative values).

### 6. A table nested in a table cell measured one border-spacing too narrow
**File:** `src/browser/rendering/layout-engine.ts` (`FILLS_LINE`)
**Problem:** a table inside a shrink-to-fit cell got 2px less than its content. Its widest column, the HN titles, wrapped onto two lines and the row doubled in height.
**Root cause:** `contentExtent` treated `display: table` as a line-filling block, measuring to its last cell's edge plus its own padding. That leaves out the trailing border-spacing. An auto-width table shrinks to its columns, so its box is its extent.
**Fix:** `table` is removed from `FILLS_LINE`.

### 7. `line-height: 12pt` became 12 × the font size; absolute units were read as px
**Files:** `src/browser/rendering/css5/computed-value-resolver.ts`, `layout-engine.ts` (`resolveLineHeight`, `resolveLength`)
**Problem:** HN's header cell (`line-height: 12pt`, 10pt font) was 120px tall instead of about 16px.
**Root cause:**
- **Cascade:** the computed-value resolver treated any line-height not ending in px/em/rem/% as a bare multiplier and dropped its unit (`12pt` → `12`).
- **Layout:** `resolveLineHeight` had the same pattern, and also resolved `%` against a containing width of 0, so `line-height: 150%` gave lines no height.
- **Lengths:** `resolveLength` had no case for pt, pc, in, cm, mm or Q, so `12pt` laid out as 12px.

**Fix:**
- Only a bare number is a multiplier, and a percentage is of the font size.
- Absolute units convert as in CSS Values §6.2 (1in = 96px, 1pt = 1/72in).

### Quirks mode, needed for #3
**Files:** `cascade.ts` (`setQuirksMode`), `src/browser/engine/page-renderer.ts`
In quirks mode, tables don't inherit `text-align`. HN has no doctype, so a browser leaves its titles left-aligned inside `<center>`. The page renderer now sets quirks mode when the document has no doctype, and tables then reset `text-align`. `ponytail:` legacy public-id quirks are not detected.

## Not changed (recorded for the next round)
- **Wikipedia (live):** the lead figure overlaps a narrow column of text beside it.
- **MDN (live):** boxes after the navigation items (probably `mask-image` / SVG icons), grey bars over the article (positioned or sticky elements), and the heading clipped at the left.
- **`inline-table`:** still flowed inline (see #4).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/html5/tree-builder.ts` | spec insertion-mode reset (#1) |
| `src/browser/rendering/html5/modes/table.ts` | `<tr>` in a row (#2) |
| `src/browser/rendering/css5/cascade.ts` | `<center>` UA style (#3); presentational hints (#5); quirks-mode table `text-align` |
| `src/browser/rendering/layout-engine.ts` | `-webkit-center`, centring block children (#3); `BLOCK_LEVEL` (#4); `FILLS_LINE` (#6); `resolveLineHeight` and absolute units (#7) |
| `src/browser/rendering/css5/computed-value-resolver.ts` | line-height keeps its unit (#7) |
| `src/browser/engine/page-renderer.ts` | quirks mode from the doctype |
| `android/app/build.gradle` | 1.79 (80) → 1.80 (81) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/hn-2026/index.html`, `news.css` | the HN front page as served on 2026-11-04 (public page, fixture for render tests) |
| `tests/hn-tables-180.test.ts` | 11 tests: nested tables, `<tr>` in a row, `<center>`, block-level boxes in inlines, hints and their precedence, quirks mode, nested-table measuring, line-height units, the saved HN page end to end |

## Test Results
```
Tablet, Nova 1.79, live sites         → example.com OK; Wikipedia mostly OK; Hacker News broken; MDN broken (screenshots)
HN fixture in Node (before)           → header cell 896x1461 holding all stories; rank cells at x=212 beside rows; title cells 34px lower
Bisect: minimal row fine → nested → <center> → parser (tr nested in td) → line-height 12pt → 120px header
HN fixture in Node (after)            → header 896x24, #hnmain 896px (85%) #f6f6ef, rank / vote / title on one row
npx vitest run tests/hn-tables-180.test.ts → 11 passed
npx vitest run                        → Test Files 328 passed (328); Tests 11377 passed (11377)
npx tsc --noEmit                      → clean
npx eslint src/ tests/                → 0 errors (1005 warnings)
Saved real pages, old vs new code (6 pages × 412/1070) → 0 px difference
gradlew :app:testDebugUnitTest :app:assembleRelease → OK
apksigner verify Nova-1.80.apk        → verified; versionCode 81, versionName 1.80
adb install                           → no devices (the tablet disconnected); not installed
```
