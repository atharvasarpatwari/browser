# Nova — Draw Page Text With Real Fonts (Unicode) — Plan

**Date:** 2026-10-18
**Session:** "keep improving the nova app…", round 6. This follows the gap found on the phone in 1.15 (see `2026-10-18-nova-android-1.15-element-dom-apis-find-focus.md`).
**Status:** Completed. Approved ("Real fonts for all text") and shipped in Nova 1.16; see `2026-10-19-nova-android-1.16-real-font-text-cjk-wrap.md`.

---

## Problem (traced)
- **What's wrong:** page text is drawn by `Rasterizer.fillText`/`strokeText` (`src/browser/rendering/rasterizer.ts`) from a built-in **8×8 bitmap font covering ASCII 32–126**. On the phone (1.15), Arabic, Chinese and Russian paragraphs on example.com were blank, and accented letters dropped out ("réservé" showed as "r serv").
- **Layout already uses real fonts:** in the WebView, layout measures text with the real canvas font (`CanvasTextMeasurer` → `ctx.measureText`). The bitmap glyphs are squeezed into those widths, so all text looks blocky and pixelated, and letter spacing is uneven ("doma in", "examp les").
- **No GPU path to change:** the app's `GpuRasterizer` renders synchronously through the same software `Rasterizer`, so `Rasterizer` is the only place text is drawn.

## Plan
1. **New `rendering/text-raster.ts`.** `rasterizeTextRun(text, cssFont, maxWidth)` draws the run once in white on a scratch 2D canvas: `OffscreenCanvas` where available, otherwise `document.createElement('canvas')`. It returns an alpha mask plus its offset from the baseline. Masks are cached by `(text, font, maxWidth)` in an LRU of a few hundred entries, so repaints and scrolling don't redraw glyphs. It returns `null` when no 2D canvas exists (Node/tests).
2. **`Rasterizer.fillText`/`strokeText`.** These use the mask when there is one: blend it in the fill colour, honouring `globalAlpha`, `clipRect` and `textAlign`. Otherwise they fall back to the existing bitmap path, so tests and headless builds are unchanged. `fillText(text, x, y, maxWidth)` keeps the run inside the width layout gave it.
3. **Font.** `state.font` is already the full CSS font string the painter builds (`"bold 16px Georgia, serif"`) and is passed straight to `ctx.font`. That gives the page's font family and weight where the device has them, and the system fallback fonts (Noto: Arabic, CJK, Cyrillic) for everything else, including Arabic shaping and RTL glyph order inside a run.
4. **Out of scope:**
   - Pages are still rastered at CSS-pixel resolution, so text on a 2.5× phone is somewhat soft. Rendering at `devicePixelRatio` is a separate, larger change, since every paint coordinate is affected.
   - Text decoration (underline) is not painted.

## Tests
- **Unit:** with a stub canvas (`OffscreenCanvas` mock returning a known mask), `fillText` blends the mask at the right place, in colour, clipped, with alpha. With no canvas it falls back to the bitmap path, and the existing rasterizer tests stay green.
- **Built-in browser:** render the 2026 example.com fixture with `s.js` at 412 px through the real pipeline and look at the pixels. The Arabic, Chinese and Russian paragraphs should be visible and "réservé" intact.
- **Phone:** the same page on the Realme.

## Deliverable
Nova **1.16**, with a change log, README and analytics entries (worktree and `E:\nova_1`).
