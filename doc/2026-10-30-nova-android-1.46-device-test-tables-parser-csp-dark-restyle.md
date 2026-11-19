# Nova Android 1.46: Device Test of 1.45; HTML Tables, Parser, CSP Navigation, Dark-Text Restyle

**Date:** 2026-10-30
**Session:** "install again and do all the tests". 1.45 was installed and tested on the phone. Everything it found is fixed in 1.46.
**Status:** Completed (1.46 built and signed; the phone locked before it could be installed)

---

## Summary
- **What 1.45 confirmed on the phone:**
  - httpforever's card text is back;
  - "exist?" stays on one line;
  - the brand name is drawn;
  - the theme icon is centred horizontally;
  - the fixed switcher stays pinned while scrolling;
  - the Wikipedia wordmark is crisp.
- **What the test found, and 1.46 fixes:**
  1. Reloading httpforever was blocked by its own CSP.
  2. example.com in dark mode had black text after its first reflow.
  3. Wikipedia's figure caption overlapped the article.

  Behind 3 were four more bugs: the HTML parser nested every table cell inside the previous one; tables weren't tables; table rows and captions were 20 px tall; and `querySelector` didn't follow document order.

## Device test (Realme RMX5264, Android 16, night mode) — 1.45
| Test | Result |
|------|--------|
| Install 1.45 | ✅ Success (versionCode 46) |
| httpforever.com | ✅ Card text in dark mode; ✅ "exist?" / "screen." whole; ✅ "HTTP Forever" brand name; ✅ green kickers; ✅ theme icon centred horizontally (still at the top vertically); frame 835 ms |
| Scroll httpforever | ✅ The fixed switcher stays at the top right over the content; the white streaks were gone in that frame |
| Tap the colour button while scrolled | The page kept scrolling (a fling), so it was inconclusive |
| Pull to refresh at the top | ❌ "Navigation to http://httpforever.com/ blocked by guard 'csp': CSP navigation-to blocked" → RC-1 |
| en.wikipedia.org/wiki/Web_browser | ✅ Crisp wordmark; ❌ the lead image's caption ("Safari", "MacBook", "Wikipedia web page") drawn one word per line over the second paragraph → RC-3…RC-6 |
| example.com (dark mode) | ❌ Near-black text (8,8,8) on #222 → RC-2 |

## Root Causes

### RC-1: Navigation directives fell back to `default-src`
**File:** `src/browser/security/csp-parser.ts` `getEffectiveSources`
**Problem:**
- Every directive except a few fell back to `default-src`.
- httpforever sends `default-src 'none'`, so the navigation guard's `navigation-to`, plus `form-action` and `base-uri`, became `'none'`.
- The result: every reload, link and form submit out of the page was blocked.

**Fix:** Only fetch directives fall back (CSP3 §6.8.3): `child-`, `connect-`, `font-`, `frame-`, `img-`, `manifest-`, `media-`, `object-`, `prefetch-`, `script-`, `style-` and `worker-src`.

### RC-2: The incremental restyle dropped the dark default text colour
**File:** `src/browser/engine/page-renderer.ts` `recalcStylesIncremental`
**Problem:** The 1.38 `applyDarkCanvasText` ran only in the first style pass. A reflow that restyled `<html>` put the text back to black on example.com's `light-dark(#eee, #222)` background.
**Fix:** The root gets it in the incremental pass too. A test confirms it fails without the fix.

### RC-3: Text in a table cell took the parser out of the table
**File:** `src/browser/rendering/html5/tree-builder.ts` `reprocessInBody`
**Problem:**
- "Process the token using the rules for in body" switched the insertion mode to IN_BODY and left it there, the same mistake fixed earlier for `reprocessInHead`.
- After the first text in a cell, `</td>` was ignored, so every later cell nested inside the one before: `<tr><td>1</td><td>2</td>` → `td(1, td(2))`.

**Fix:** Keep the mode unless the body rules changed it. A `<script>`/`<textarea>` (TEXT mode) returns to the cell.

### RC-4: Tables were never tables
**File:** `src/browser/rendering/css5/cascade.ts` (UA defaults)
**Problem:** `<table>` was in the block list, and `tr`/`td`/`tbody`/… had no display, so they were inline. Plain HTML tables ran together as text.
**Fix:** HTML §15.3.8 displays: `table`, `table-caption`, `table-row-group`/`-header-`/`-footer-group`, `table-row`, `table-cell`, `table-column(-group)`. Also `border-spacing: 2px`, cell padding 1px, and bold centred `<th>`.

### RC-5: Table layout ignored content
**Files:** `src/browser/rendering/formatting/table-context.ts`, `layout-engine.ts`
**Problem:**
- A row's non-cell children (a `<figure>`'s `<a><img>`) went into the row unwrapped and were skipped.
- Rows were 20 px (or the CSS height), whatever their content, so tall cells overflowed onto what followed.
- Captions were laid out at the columns' width (0 for a table without cells) and given 20 px.
- `caption-side` was read only from the table.

**Fix:**
- Loose content (elements and non-blank text) is wrapped in an anonymous cell (CSS 2.2 §17.2.1).
- `layoutCell` returns the laid-out height: rows grow to their tallest cell, and `stretchCell` gives each cell the row's height.
- Captions use the table width (or the available width when there are no columns) and their own height.
- `caption-side` is read per caption.
- The total height is the real one.

### RC-6: `querySelector` and `querySelectorAll` were breadth-first
**File:** `src/browser/rendering/css5/selector.ts`
**Problem:** The shallowest match was returned first, not the first in document order. On Wikipedia, `querySelector('section')` returned a footer section. This surfaced when the parser fix changed nesting depths.
**Fix:** Pre-order depth-first search (document order) for both.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/csp-parser.ts` | `FETCH_DIRECTIVES`; only they fall back to default-src |
| `src/browser/engine/page-renderer.ts` | Dark default text in the incremental restyle |
| `src/browser/rendering/html5/tree-builder.ts` | `reprocessInBody` keeps the insertion mode |
| `src/browser/rendering/css5/cascade.ts` | UA table displays (`TABLE_DISPLAYS`), th/td defaults |
| `src/browser/rendering/formatting/table-context.ts` | Anonymous cells; content row heights; caption width, height and side |
| `src/browser/rendering/layout-engine.ts` | Cell callback returns the height; `stretchCell` |
| `src/browser/rendering/css5/selector.ts` | Document-order `querySelector` / `querySelectorAll` |
| `tests/flex-items-145.test.ts` | +7 tests (CSP fallback; dark text after restyle; figure with anonymous cell and caption; row heights; parser cells; querySelector order; UA table displays) |
| `android/app/build.gradle` | 1.46 (47) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `Nova-1.46.apk` | Signed build |

## Still open
- **Table columns:** auto columns share the width equally (no min/max-content measurement).
- **httpforever:** the theme icon isn't centred vertically (grid auto rows don't stretch); the brand mark is 12 px (`clamp()` in replaced sizes); the brand name is too large (`clamp()` font size).
- The colour-button tap test (inconclusive); the white streaks at the top of the hero (absent after scrolling).

## Test Results
```
npx tsc --noEmit                                  -> clean
npx vitest run tests/flex-items-145.test.ts       -> 11 passed (11)
npx vitest run tests/end-user-regressions.test.ts -> 5 passed (5)  (failed before the querySelector fix)
npx vitest run                                    -> Test Files 299 passed (299), Tests 10723 passed (10723)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.46.apk                    -> Verifies; versionCode 47, versionName 1.46
adb install -r Nova-1.45.apk                      -> Success (device tests above)
```
