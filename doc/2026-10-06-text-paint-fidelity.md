# Engine-Painted Text No Longer Overprints Itself

**Date:** 2026-10-06
**Session:** First of two follow-ups (fix painted text → text selection)
**Status:** Completed — confirmed and verified in the real Electron app; GPU text path not changed (see below)

---

## Summary

On real pages the engine's text looked garbled: words painted on top of each other. Cause confirmed, fixed in the software rasteriser, and covered by tests. Text selection (next change) needs layout widths and paint to agree, which is why this came first.

## Root Causes

### 1. Layout measured words at ~0.5 em per character; the painter advanced every glyph a full em
**Files:** `src/browser/rendering/formatting/text-measure.ts` (layout, real font advances), `src/browser/rendering/rasterizer.ts` `fillText` (8×8 bitmap font, advance `FONT_W * fontSize/FONT_H` = 1 em)
**Evidence (real Electron, `/quasar` test page):** the sentence "The quasar is a luminous galactic nucleus" measures 297 px at 16 px; the painter advanced it 656 px (ratio 2.2). The screenshot showed neighbouring words printed over each other.
**Fix:** layout already knows each run's width; `TextRun` now carries it (`width`, from `populateTextRuns`), `fillText` commands pass it (paint engine and layer compositor), and the rasteriser squeezes each glyph horizontally into `width / text.length` (never wider than the original 1 em). The same screenshot afterwards is readable ("Quasar notes", whole sentences inside their boxes).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | `TextRun.width` |
| `src/browser/rendering/layout-engine.ts` | runs record the width layout gave them |
| `src/browser/rendering/paint-engine.ts`, `compositing/layer-compositor.ts` | `fillText` carries the width |
| `src/browser/rendering/rasterizer.ts` | glyphs fitted to the width (`scaleX`) |
| `tests/e2e/fidelity-audit.spec.ts` | revived: current address-bar selector, throw-away profile |

## Files Created

| File | Purpose |
|------|---------|
| `tests/text-paint-fit.test.ts` | 5 tests: no width = old behaviour; ink stays inside the width; no stretching beyond a full em; glyphs squeezed whole not cut off (an H keeps its right stem — mutation-checked); one character never takes the whole width |
| `doc/2026-10-06-text-paint-fidelity.md` | this change log |

## Test Results

```
$ npx tsc --noEmit        → 0 errors
$ npx vitest run          → 257 files; 10,309 of 10,312 pass; the 3 failures are the known DnsResolver environmental timeouts
$ npx playwright test … tests/e2e/fidelity-audit.spec.ts   → now launches and runs; fails at the `images` fixture
  ("must show checker quadrant #380000"), an assertion about image colours, not text (it never got that far before).
```

## Not done

- **GPU rasteriser** (`rendering/gpu/*`) still advances a full em. It cannot initialise in Electron (`GPUBufferUsage is not defined`, falls back to software), so it is unused today; it needs the same width if it is ever enabled.
- `setFont` still ignores font family and weight (bold is not drawn bolder); the canvas is rendered at CSS pixels and scaled by the browser (`dpr` 1.25 in my probe), which softens text a little. Neither causes overlap.
- The `images` fixture failure in the fidelity audit.
