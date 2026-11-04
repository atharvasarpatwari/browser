# Nova Android 1.84: CSS url() Images — Background Images, Mask Icons, Data URLs

**Date:** 2026-11-05
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html" (the tablet was connected mid-round)
**Status:** Completed (1.84 installed on the tablet; live check pending: the tablet went to sleep on its lock screen)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 331 files, 11398 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

**Tablet check of 1.83:** when the tablet was connected, 1.83 was installed (OPD2305, versionCode 84) and MDN was opened live. The bars, squares and outline from 1.80 are gone. MDN's icons were blank, as recorded in 1.83.

This round took the item recorded open in 1.83: Nova never loaded CSS `url()` images.
- `background-image: url()` painted nothing (only gradients were drawn).
- `mask-image: url()` icons (MDN, Wikipedia) were solid squares, then blank.

Building it exposed five more root causes on the path from a stylesheet or `style=""` to the screen.

**Result:** background images paint with size, position and repeat, and mask icons show the background colour through the image's alpha. Images load after layout, once per URL and size, then the page repaints.

**Saved real pages, old vs new, offline (no image bytes):** all 20 renders are pixel-identical. The parser, shorthand and sanitizer changes don't disturb existing pages.

## Root Causes

### 1. CSS url() images were never loaded or painted
**Files:** `src/browser/rendering/css-images.ts` (new), `src/browser/rendering/paint-engine.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** photos, sprites and icons set from CSS were blank. MDN's and Wikipedia's mask icons were squares (≤1.82) or blank (1.83).
**Root cause:**
- The paint engine drew only gradient layers of `background-image`.
- Nothing fetched a CSS image. `<img>` has the lazy loader and inline `<svg>` has `renderInlineSvgs`, but CSS images had no loader.

**Fix:**
- **Load:** `loadCssImages()` runs after layout, like the inline-SVG pass. For each laid-out element (pseudo-elements included) it takes the first `url()` of the background and of the mask. It fetches and decodes each once per URL and size, with `data:` URLs decoded locally and SVGs rasterized at the box size × DPR, then repaints.
- **Background:** `cssImageCommands()` paints a background image with `background-size` (cover, contain, lengths, %, auto), `background-position` (keywords, lengths, %) and `background-repeat`, clipped to the box.
- **Mask:** `tintThroughMask()` paints the background colour through the mask image's alpha. A mask that fails to load still hides the box.

### 2. Stylesheet url()s were resolved against the page, not the sheet
**File:** `src/browser/engine/page-renderer.ts` (`fetchStylesheet`)
**Problem:** `url(../img/dot.png)` in `/static/css/site.css` would be fetched from the page's folder.
**Root cause:** relative `url()`s are relative to the stylesheet (CSS Values §4.5.1). Nova kept the text as written, and the only base available later was the page URL.
**Fix:** relative `url()`s are made absolute against the sheet's URL when it loads. `data:`, `#fragment` and URLs that already have a scheme are left alone.

### 3. An unquoted data: URL was cut at its ';'
**File:** `src/browser/rendering/css5/parser.ts` (`splitOnSemicolon`), `css5/cascade.ts` (`parseInlineDeclarations`), `src/browser/js/dom-bindings.ts` (`parseInlineStyle`)
**Problem:** `mask-image: url(data:image/png;base64,…)` was computed as `url(data:image/png`.
**Root cause:** these three declaration splitters split on every `;` outside strings but ignored parentheses. (`splitNestedBlock` already tracked them.)
**Fix:** `splitOnSemicolon` splits only at depth 0 outside strings. It is exported and used by the inline-style parser and `element.style` too.

### 4. The `background` shorthand misread `position / size`
**File:** `css5/cascade.ts` (`expandBackgroundShorthand`)
**Problem:** `background: url(x) no-repeat right bottom / 10px 10px` gave `background-color: /` and `background-position: right bottom 10px 10px`.
**Root cause:** the expander knew no `/`, so it took the slash as the colour and kept the size as position. Negative positions (`-5px`) were also read as colours.
**Fix:**
- The slash, spaced or not, is its own token.
- The tokens after it (`cover`, `contain`, `auto`, lengths) go to `background-size`.
- Positions may be negative.

### 5. The DOM sanitizer stripped data:image URLs from style attributes and left junk
**File:** `src/browser/security/html-sanitizer.ts` (`DANGEROUS_CSS_PATTERNS`, `sanitizeStyleAttribute`), applied from `html5/mutation-observer.ts`
**Problem:** `style="background-image:url(data:image/png;base64,…)"` became `style="…;base64,…)"`, so every inline-style data-URL image was lost.
**Root cause:**
- Every `url(data:…)` counted as "data exfiltration", although a `data:` URL makes no request. A `data:image/…` URL is decoded as an image (no script), and all browsers allow it.
- `sanitizeStyleAttribute` also split on every `;`, so dropping the declaration left its tail behind.

**Fix:**
- Only `data:` URLs that aren't images are blocked. `data:text/html`, `javascript:`, `vbscript:`, `expression()`, `-moz-binding` and `behavior` stay blocked; the existing XSS suite still passes (46 tests).
- The sanitizer splits with `splitOnSemicolon`, so a blocked declaration goes whole.

## Not changed (recorded)
- **Live check of 1.84 icons on MDN and Wikipedia:** pending; the tablet went to sleep on its lock screen, which I don't touch.
- **Which layers are covered:** only the first `url()` layer of a background is painted. A mask covers the element's own background only, not its borders or children.
- **Image refresh:** CSS images load after the initial layout only. Elements shown later keep what they had.
- **From 1.83, still open:** cyclic percentage widths, and the `lh` unit.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/paint-engine.ts` | url() backgrounds and masks painted (#1) |
| `src/browser/engine/page-renderer.ts` | CSS image pass and fetcher (#1); sheet-relative url()s (#2) |
| `src/browser/rendering/css5/parser.ts` | paren-aware `splitOnSemicolon`, exported (#3) |
| `src/browser/rendering/css5/cascade.ts` | inline styles split with it (#3); background `/ size` (#4) |
| `src/browser/js/dom-bindings.ts` | `element.style` split with it (#3) |
| `src/browser/security/html-sanitizer.ts` | data:image allowed; whole declarations dropped (#5) |
| `android/app/build.gradle` | 1.83 (84) → 1.84 (85) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/css-images.ts` | CSS image loading, `data:` decoding, mask tinting |
| `tests/css-url-images-184.test.ts` | 11 tests: repeat; no-repeat with size and position; sheet-relative URL; mask shows and hides; failed mask hides; data URL in a sheet and in `style=""`; shorthand `/` spaced and unspaced; sanitizer allows data:image and blocks the rest; no leftover tail; helpers |

## Test Results
```
Start of round: npx vitest run → 331 files, 11398 passed; tsc exit 0; eslint 0 errors; gradle unit tests exit 0
Tablet: adb install Nova-1.83.apk → Success (versionName 1.83); MDN live → clean, icons blank
First run of the new tests: 2 failed → computed styles: background-color "/", mask-image "url(data:image/png" (#3, #4)
Inline-style case failed → Map.set trap: sanitizeAddedNode → sanitizeStyleAttribute rewrote the attribute (#5)
npx vitest run tests/css-url-images-184.test.ts tests/xss-injection-comprehensive.test.ts → 57 passed
npx vitest run                     → Test Files 332 passed (332); Tests 11409 passed (11409)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved pages old vs new, offline (10 pages × 412/1070) → 20/20 pixel-identical
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.84.apk     → verified; versionCode 85, versionName 1.84
adb install -r Nova-1.84.apk       → Success (versionName 1.84); screen asleep + lock screen → live check pending
```
