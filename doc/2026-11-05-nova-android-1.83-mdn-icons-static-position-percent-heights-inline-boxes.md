# Nova Android 1.83: MDN — Icon Bars, Static Positions, Mask Icons, #rgba, Percentage Heights, Inline Box Heights

**Date:** 2026-11-05
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 330 files, 11387 tests passed |
| Android unit tests | OK |

`tsc` and ESLint reported one error, in my own temporary probe written while they ran (`tests/zz-ext.test.ts`, an octal escape). It was not a product failure; the probe was fixed and later deleted.

The work then took the MDN defects recorded open since 1.80: dark bars over the article, boxes after the navigation items, and a large outline. The MDN "HTML" reference page was saved as a fixture (`tests/fixtures/mdn-html-2026`, page + 17 stylesheets) and rendered through Nova's full pipeline to PNG at 412 and 1070px. The page reproduced all three defects, plus inline `<code>` backgrounds covering neighbouring lines.

Six root causes were traced and fixed. MDN now renders cleanly at both widths.

Saved real pages, old vs new code, pixels:
- 12 of 20 renders are identical: example.com, Google, HN, httpbin, httpforever, IANA.
- **MDN:** changes as intended.
- **Wikipedia (article, search, results):** the 20px header icons (menu, search, user), drawn with `mask-image: url()`, change from grey squares to blank. See #3.

## Root Causes

### 1. An absolutely positioned inline box's static position was the line start
**File:** `src/browser/rendering/layout-engine.ts` (`layoutInlineChildren`, `layoutAnonymousBlock`, `flowInlineElement`), `src/browser/rendering/formatting/inline-context.ts`
**Problem:** MDN's external-link icon, `.external::after { position: absolute }` with no offsets, was drawn at the left edge of the paragraph instead of after the link text. Several of them stacked at x≈0 as dark bars over the text.
**Root cause:** all three inline enqueue sites passed `contentX` and the block's top as the static position. The static position (CSS 2.2 §10.3.7) is where the box would have been in flow: where the line has got to.
**Fix:** new `InlineFormattingContext.cursor()` returns the line's current x and the line top. All three sites use it. (A first attempt added `startY` to the already-absolute line y and doubled it; caught by the repro.)

### 2. `content` alt text was rendered
**File:** `src/browser/rendering/generated-content.ts` (`contentText`)
**Problem:** with `content: "\200b" / " (external)"`, the text after the slash was appended. MDN's 1em icon box held " (external)" and wrapped three lines tall (48px), which is why the bars were 128px.
**Root cause:** the parser skipped any unknown character, including the top-level `/` that separates alternative text (CSS Content §1.1).
**Fix:** stop at a top-level `/`.

### 3. `mask-image: url()` icons painted as solid squares
**File:** `src/browser/rendering/paint-engine.ts`
**Problem:** MDN's nav and filter icons, and Wikipedia's header icons, are a `currentColor` background seen through an SVG mask. Nova painted the full background: dark squares.
**Root cause:**
- URL masks are never loaded. `applyMask` only zeroes near-transparent pixels, and runs after the background was painted.
- An unavailable mask image counts as transparent black (CSS Masking), so nothing should show.

**Fix:** a background under a `mask-image` / `-webkit-mask-image` / `mask` `url()` is not painted. `ponytail:` only the element's own background is dropped. The real icons need CSS `url()` image loading, which Nova doesn't do for `background-image` either. That is recorded below.

### 4. `#rgba` hex colours were opaque black
**File:** `src/browser/rendering/rasterizer.ts` (`parseColor`)
**Problem:** MDN's buttons have `border: 1px solid #0000` (transparent). Nova drew black borders. Behind the header this was the 1016px outline.
**Root cause:** `parseColor` handled 3-, 6- and 8-digit hex only. 4-digit `#rgba` (CSS Color 4 §5.2) fell through to black.
**Fix:** 4-digit hex with alpha.

### 5. Percentage heights resolved against the available width
**File:** `layout-engine.ts` (`layoutInlineBlockElement`, `layoutFloatElement`, `layoutFlexContainer`: container and item cross size)
**Problem:**
- MDN's sidebar toggle (`mdn-button { height: 100% }` and `button { width: 100%; height: 100% }` in a 32px flex header) was 1016×1016 and centred at y = −395.
- `display: inline-flex; height: 100%` came out as tall as it was wide.

**Root cause:**
- `layoutNode` was fixed earlier to resolve `%` heights against the containing block (auto when indefinite, CSS 2.2 §10.5).
- These four sibling paths still called `resolveLength(height, …, availableWidth)`, so `100%` meant 100% of the width.

**Fix:** a shared `specifiedHeight(el)`: a length, a percentage of a definite parent height (`percentHeightBase`), or null (auto). It is used in all four places.

### 6. Inline boxes were a whole line tall
**File:** `layout-engine.ts` (`populateTextRuns`)
**Problem:** MDN's inline `<code>` backgrounds were 32px tall (28px line + padding). They covered the lines above and below.
**Root cause:** an inline element's bounds were the union of its line fragments, and each fragment is a full line-height tall. An inline box's height is its content area: the font's ascent + descent around the baseline (CSS 2.2 §10.6.1).
**Fix:** each fragment contributes baseline − 0.905em … baseline + 0.212em, within the line. `ponytail:` these are Arial-like metrics; per-font metrics need the font's tables.

## Not changed (recorded)
- **CSS `url()` images:** `background-image: url()` and `mask-image: url()` are not loaded or painted. Wikipedia's header icons are now blank (previously grey squares) and MDN's icons are blank. This is the next item.
- **Cyclic percentage widths:** `width: 100%` inside a shrink-to-fit box resolves against the outer width (MDN's toggle is 1016px wide, now invisible). CSS Sizing §5.2.1 treats it as auto for the intrinsic size.
- **`lh` unit:** `transform: translateY(calc(.5lh - .5em))` is ignored.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | static position from the IFC cursor (#1); `specifiedHeight()` in inline-block, float and flex (#5); inline content-area bounds (#6) |
| `src/browser/rendering/formatting/inline-context.ts` | `cursor()` (#1) |
| `src/browser/rendering/generated-content.ts` | stop at alt-text `/` (#2) |
| `src/browser/rendering/paint-engine.ts` | no background under an unloaded url() mask (#3) |
| `src/browser/rendering/rasterizer.ts` | `#rgba` (#4) |
| `android/app/build.gradle` | 1.82 (83) → 1.83 (84) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/mdn-html-2026/` | saved MDN "HTML" reference: index.html + 17 stylesheets |
| `tests/mdn-icons-percent-heights-183.test.ts` | 11 tests: static position; alt text; url() mask; #rgba; % height in inline-flex, inline-block, float and flex item; definite % height still works; inline content-area height; MDN at 412/1070 has no bars and a toggle under 60px (was 1016) |

## Test Results
```
Start of round: npx vitest run → 330 files, 11387 passed; gradle unit tests exit 0
                tsc/eslint → 1 error, in my in-progress probe tests/zz-ext.test.ts (octal escape), not product code
MDN saved, rendered to PNG @412/1070 → bars, squares, 1016px outline, tall <code> backgrounds reproduced
Repro: .external::after → fillRect [0,200,16,16] (line start), alt text → 16x48, mask → solid square, #0000 → rgba(0,0,0,1)
Repro: inline-flex height:100% in a 600px-wide block → 11x11; with width:100% → 600x600
After fixes: icon at x=70.84 (after the link), alt text dropped, no square, transparent border, 24px tall boxes
npx vitest run tests/mdn-icons-percent-heights-183.test.ts → 11 passed
npx vitest run                     → Test Files 331 passed (331); Tests 11398 passed (11398)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved pages old vs new pixels (10 pages × 412/1070) → MDN (intended), Wikipedia ×3 header icons (squares → blank); 12 identical
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.83.apk     → verified; versionCode 84, versionName 1.83
adb devices                        → none (not installed)
```
