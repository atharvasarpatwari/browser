# Nova Android 1.16 — Page Text in Real Fonts (Unicode), CJK Line Breaking

**Date:** 2026-10-19
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 6. This carries out the approved plan `2026-10-18-nova-real-font-text-plan.md` ("Real fonts for all text").
**Status:** Completed (verified in the built-in browser; the 1.16 install to the phone is queued and waits for the user to unlock and approve)

---

## Summary
- **Real fonts:** page text is now drawn with the device's own fonts through a cached canvas coverage mask, instead of the built-in 8×8 ASCII bitmap font. Arabic, Chinese, Cyrillic and accented letters show, and text looks like a normal browser's. Layout already measured with these fonts, so widths now match exactly.
- **CJK line breaking:** two copies of a `||`-for-`&&` range bug in the line breaker meant Chinese/Japanese/Korean text never got break opportunities and ran off the right edge on one line. Fixed, and kana is added.
- **Version:** Nova **1.16** (versionCode 17).

## Root Causes
### 1. Text drawn from an 8×8 ASCII bitmap font
**File:** `src/browser/rendering/rasterizer.ts` (+ the new `text-raster.ts`)
**Problem:** `Rasterizer.fillText` looked up each character in a bitmap table covering U+0020–U+007E, so anything else was skipped. The glyphs were squeezed into the widths layout measured with the real font, which made text blocky with uneven spacing. On the phone (1.15), example.com's Arabic, Chinese and Russian paragraphs were blank, and "réservé" showed as "r serv". The app's `GpuRasterizer` renders synchronously through this same software path, so it was the only place to fix.
**Fix:**
- **New module:** `rasterizeTextRun(text, cssFont, maxWidth)` draws the run once in white on a scratch `OffscreenCanvas` (or a `<canvas>` element) with the painter's full CSS font string. It returns the alpha channel as a mask, padded for overhang and placed relative to the pen position and baseline. `maxWidth` keeps the run inside its laid-out width.
- **Caching:** masks are cached in a 512-entry LRU keyed by font, width and text, so repaints and scrolling don't redraw glyphs.
- **Drawing:** `fillText` and `strokeText` call `blendTextMask`, which blends the mask in the run's colour with `globalAlpha`, the clip rect and `textAlign`.
- **Fallback:** where there's no 2D canvas (Node, happy-dom tests), it returns `null` and the old bitmap path runs, so headless output and existing tests are unchanged.
- `ponytail:` stroked text is drawn filled.

### 2. CJK text never wrapped
**File:** `src/browser/rendering/formatting/line-break.ts`
**Problem:**
- `if (code >= 0x203C || code <= 0x203D) return LB.AI;` is true for every code point. So everything checked after it was classified "ambiguous": CJK ideographs, Hangul syllables, CJK punctuation and fullwidth forms. `findBreakOpportunities` found no break inside a Chinese sentence, and it stayed on one line.
- A second copy of the bug, `if (code >= 0xFF1A || code <= 0xFF1B) return LB.IS;`, matched every remaining code point.
- Hiragana and katakana had no range of their own.

**Fix:** both conditions are now `&&`. Kana (U+3040–U+30FF, U+31F0–U+31FF) breaks like ideographs.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/rasterizer.ts` | `fillText`/`strokeText` use the font mask; `blendTextMask` |
| `src/browser/rendering/formatting/line-break.ts` | two `||` → `&&` range fixes; kana ranges |
| `doc/2026-10-18-nova-real-font-text-plan.md` | Status → Completed |
| `android/app/build.gradle` | 1.15 (16) → 1.16 (17) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/text-raster.ts` | `rasterizeTextRun`, `resetTextRaster`, the mask LRU |
| `tests/text-raster.test.ts` | 6 tests. With a stub canvas: placement on the baseline and in colour; Arabic/CJK/Cyrillic/accents drawn; clip and `text-align`; mask caching. Plus the no-canvas bitmap fallback and CJK break opportunities |
| `doc/2026-10-19-nova-android-1.16-real-font-text-cjk-wrap.md` | This change log |

## Test Results
The rendering tests were confirmed to fail with the old `fillText`: reverting only `rasterizer.ts` made 3 fail. The CJK test failed until both `||` fixes and the kana ranges were in. The cache and fallback tests exercise the new module directly.
```
npx vitest run tests/text-raster.test.ts  -> 6 passed (6)
npx tsc --noEmit                          -> exit 0
npx vitest run                            -> 271 files, 10494 passed (10494)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.16.apk            -> verified (1,519,352 B)
```

## Verification Steps
1. In the built-in browser (a real canvas, like the WebView), rendered the 2026 example.com fixture with its `s.js` through `PageRenderer` → `rasterize()` at 412 px, with no script errors.
   - **First render:** English, Arabic (shaped), Chinese, French with "réservé"/"éviter" intact, and Russian all drew in real fonts, but the Chinese line ran off the right edge. That led to root cause 2.
   - **After the line-break fix:** Chinese wraps onto two centred lines.
2. 1.16 is built, and its install to the phone is queued and waits for the user to unlock and approve.

## Known ceilings
- Pages are still rastered at CSS-pixel resolution, so text is somewhat soft on high-density screens. Rendering at `devicePixelRatio` is the next step for crispness, and it touches every paint coordinate.
- Text decoration (link underlines) isn't painted.
- On example.com, `p+p { font-size: .875em; opacity: .6 }` doesn't apply to the translations (the `p+p` sibling combinator and/or `opacity` on text isn't honoured). Not investigated yet.

## What's new in Nova 1.16 (user-facing)
- Text in any language shows, including Arabic, Chinese, Japanese, Korean, Russian and accented letters.
- Page text uses the phone's real fonts: smooth, properly spaced, bold where the page says bold.
- Chinese and Japanese paragraphs wrap to the screen instead of running off the edge.
