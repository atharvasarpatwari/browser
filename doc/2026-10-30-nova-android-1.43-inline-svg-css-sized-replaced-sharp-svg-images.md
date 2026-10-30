# Nova Android 1.43: Inline SVG Drawn, CSS-Sized Replaced Elements, Sharp SVG Images

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", the fourth round of the day. The phone was not connected.
**Status:** Completed (built and signed; the on-device check of 1.42 and 1.43 is pending)

---

## Summary
This round fixes three things:
- **Inline `<svg>` now draws.** Logos and icons, including httpforever's brand mark and theme glyphs, were blank.
- **Replaced elements honour CSS sizes.** `<svg>`, `<img>`, `<video>` and friends now take their size from CSS as well as attributes, and keep their aspect ratio. A CSS-sized icon used to be laid out page-wide and one line tall.
- **SVG images are sharp.** An `<img src="….svg">` is rasterized at its display size × DPR, not its intrinsic size (the Wikipedia wordmark was a blur).

## Root Causes

### RC-1: No renderer for inline SVG
**Files:** `src/browser/rendering/inline-svg.ts` (new), `src/browser/engine/page-renderer.ts`
**Problem:** The engine has no vector renderer. An `<svg>` element was an empty box, and its `<path>`/`<circle>` children were unknown elements.
**Fix:** The engine runs inside a WebView, whose image decoder already rasterizes SVG (the `<img>` path since 1.2x). After load, with the iframe step, `renderInlineSvgs()` does the following:
- takes each outermost `<svg>` that has a box;
- serializes it as a standalone document:
  - `xmlns` is added;
  - `width`/`height` are set to the content box × DPR;
  - `class`/`style` are dropped, and the computed `color`, `fill`, `stroke`, `stroke-width` and `opacity` go on the root, so `currentColor` works without the page's CSS;
  - `<script>` and `<foreignObject>` are dropped;
  - the text and attribute values are escaped;
- restores the SVG case that the HTML parser lowercased (`viewBox`, `linearGradient`, `gradientUnits` …, the HTML spec's "adjust SVG" lists);
- decodes it, and sets `imageData`/`loadingState = 'loaded'`, so the existing image paint path draws it.

A decoder failure leaves the SVG blank, as before. The decoder is injectable (`svgDecode` dep) for tests.

ponytail: an SVG is rendered once after load. Scripts that later change its children don't redraw it, and `<use href>` into another SVG on the page isn't resolved.

### RC-2: Replaced elements were sized from attributes only
**File:** `src/browser/rendering/layout-engine.ts` `resolveIntrinsicSize`
**Problem:** The comment said "intrinsic width/height attributes when CSS does not override them", but CSS was never read. `svg.ic { width: 1.2rem; height: 1.2rem }` (no attributes) therefore laid out at the full available width and one line height.
**Fix:**
- A CSS `width`/`height` length beats the attribute.
- A missing side follows the aspect ratio: the attributes, else the SVG `viewBox`.
- Percentages still fall back to the attribute (they need the containing width here).

### RC-3: An `<svg>`'s children were laid out as boxes
**Files:** `src/browser/rendering/form-controls.ts` `skipsChildLayout`, `layout-engine.ts` `layoutInlineElement`
**Problem:** Each child (`<linearGradient>`, `<path>`, even `<script>`) was flowed as content, adding a line of height each. A 24 px icon with three children became 72 px tall.
**Fix:** `skipsChildLayout` includes `svg`, and the inline path now checks it like the block path does.

### RC-4: SVG images decoded at their intrinsic size
**Files:** `src/browser/image/decoder.ts`, `src/browser/rendering/lazy-loader.ts`
**Problem:** `<img src="wordmark.svg">` was turned into a bitmap at its natural size (for example 119 × 18), then scaled up for the box and the DPR, so it was blurry.
**Fix:**
- `decode(bytes, mime, size?)` takes the display size in device pixels.
- SVG is drawn from the decoded `<img>` onto a canvas scaled up to cover that size, keeping the SVG's own aspect, because the box can still be a placeholder. It is capped at 2048 px.
- The decoder reports `naturalWidth`/`naturalHeight` separately, so layout still uses the natural size.
- Raster formats ignore `size`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `renderInlineSvgs` after iframes (repaint when any drew); `svgDecode` dep |
| `src/browser/rendering/layout-engine.ts` | `resolveIntrinsicSize`: CSS lengths, aspect from attributes/viewBox; the inline path respects `skipsChildLayout` |
| `src/browser/rendering/form-controls.ts` | `skipsChildLayout` includes `svg` |
| `src/browser/image/decoder.ts` | `DecodeSize`; `decodeSvg` at display size; `naturalWidth/Height` |
| `src/browser/rendering/lazy-loader.ts` | Passes the box × DPR; uses the natural size for layout |
| `android/app/build.gradle` | 1.43 (44) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/inline-svg.ts` | `serializeInlineSvg`, `renderInlineSvgs` |
| `tests/inline-svg-143.test.ts` | 6 tests: serialized markup (case, colour, device-pixel size, no script); painted at its box, nested and hidden skipped; httpforever's brand mark and visible glyph decoded; decoder failure leaves it blank; escaping; SVG decode covers the display size, keeps the aspect, reports the natural size |
| `Nova-1.43.apk` | Signed build |

## Still open
- The on-device check of 1.42 (dark cards) and 1.43 (logo and icons visible and crisp), the pinned switcher while scrolling, and "exist?" on one line.
- The white streaks at the top of httpforever's hero on the phone.
- SVG sprites (`<use href="#id">` across SVGs), and SVGs changed by scripts after load.

## Test Results
```
npx tsc --noEmit                                         -> clean
npx vitest run tests/inline-svg-143.test.ts tests/image-decoder-native.test.ts tests/image-decoder.test.ts -> 34 passed (34)
npx vitest run                                           -> Test Files 297 passed (297), Tests 10703 passed (10703)
gradlew :app:testDebugUnitTest :app:assembleRelease      -> BUILD OK
apksigner verify Nova-1.43.apk                           -> Verifies; versionCode 44, versionName 1.43
adb devices                                              -> no device attached
```
