# Nova Android 1.36–1.37 — Device Test Fixes: 33 s → 0.4 s Frames, Pseudo-Element Leak, Black Gradients, Contextual Keywords, Round Radios

**Date:** 2026-10-28
**Session:** "install 1.35 and do the testing". On-device test pass on the Realme RMX5264, plus fixes for everything it found.
**Status:** Completed (1.37 installed on the phone; the final re-check of 1.37 is pending because the phone locked)

---

## Summary
Testing 1.35 and 1.36 on the phone with httpbin.org and httpforever.com found:
- radio buttons drawn as four dashes;
- a text area's left border missing;
- a 33-second first frame on httpforever.com, a grey veil over its page and a vanished header;
- a black hero where the header should be green;
- a theme script failing with "expression is not a function".

Each traced to a separate engine bug, and all are fixed. In the test harness, httpforever.com now rasterizes in about **0.4 s instead of 7.4 s** (the phone was 33 s). The page lays out correctly with its green gradient header and its script runs.

## Device test (Realme RMX5264, Android 16)
| Build | Test | Result |
|-------|------|--------|
| 1.35 | Install over 1.33 | ✅ Success (the user approved the prompt) |
| 1.35 | httpbin form: pick Medium, then Small | ✅ Only Small selected (the 1.34 repaint fix); ❌ radios drawn as 4 dashes, text area missing its left/right borders → RC-1, RC-2 |
| 1.36 | Same form | ✅ Round radio buttons, all text area borders, rounded corners |
| 1.36 | `http://neverssl.com` | ✅ Behaviour right: https failed, then Nova fell back to http. The HTTP connect then timed out (`SocketTimeoutException … port 80 after 30000ms`) and Nova showed its error page. **The phone's network** can't reach that host (`ping` 100% loss); the PC gets 200. |
| 1.36 | `http://httpforever.com` | ✅ https fails (SSL handshake), falls back to http, loads; ❌ first frame took **32.6 s** (`frame 32630`), with a grey veil, missing header, black hero and a script error → RC-3…RC-7 |
| 1.37 | Install | ✅ Success, versionName 1.37; the phone then locked, so the re-check of httpforever, tabs after a restart, dark mode, the Wikipedia logo and a script-submitted form is pending |

## Root Causes

### RC-1 — Rounded borders drawn as stubs (radio buttons were four dashes)
**File:** `src/browser/rendering/paint-engine.ts`, `rasterizer.ts`
**Problem:** A border is four straight strips. With `border-radius` (radio buttons have 50%), the 1.34 rounded clip removed almost all of each strip.
**Fix:** A rounded border in one colour and style is sent as a new `fillRoundedRing` command, drawn as the outer rounded box minus the inner one, anti-aliased. The outer edge is exact, with no slack, so there is no stray pixel. The compositor translates the new command like the others.

### RC-2 — Border sides vanished at fractional positions
**File:** `rasterizer.ts` `roundedCoverage`
**Problem:** The coverage test used the pixel *centre*. A 1-px left border at x = 160.9 has its centre (160.5) just outside the box, so whole sides disappeared on the phone. The test fixture happened to sit at x = 114.48, which passed.
**Fix:** Half a pixel of slack at the box edges for straight fills. The ring's outer edge and inner hole use no slack.

### RC-3 — 33-second frames: rounded-corner fills were per-pixel everywhere
**File:** `rasterizer.ts`
**Problem:** The 1.34 rounded fill computed coverage (with closures, square roots and radius scaling) for every pixel of every rounded box.
**Fix:**
- `scaledRadii()` runs once per fill. `cornerCoverage()` and `roundedCoverage()` allocate nothing.
- Rows between the corners and the middle of each row are written directly; only corner zones get coverage.
- The ring skips its hole.
- Rounded fills for the whole page: 58–78 ms.

### RC-4 — Box shadows: an O(w·h·r²) blur, drawn over the element
**Files:** `rasterizer.ts` `applyBoxShadowToPixels`, `paint-engine.ts`
**Problem:**
- Each shadow copied the entire page buffer twice.
- It was blurred with a brute-force (2r+1)² kernel: about 400 M operations for a 20 px shadow on a large card.
- It was painted after the element's background and over the padding box, so every card got the translucent shadow colour, which was the grey veil.

**Fix:**
- An alpha mask of the spread box, blurred by three separable running-sum box passes (≈ the Gaussian CSS specifies, σ = blur/2), O(w·h).
- Composited straight into the page **outside** the element's border box.
- Emitted on the border box, **before** the background.

### RC-5 — `filter` applied to the whole page
**File:** `rasterizer.ts` `applyFiltersToBuffer`
**Problem:** The function ignored the element's rectangle. httpforever's logo has `filter: drop-shadow(…)`, so the whole 424 × 3000 page was drop-shadowed: 7 s per frame, plus a dark smear.
**Fix:** The filter is applied to the element's rectangle only. `drop-shadow` is skipped (ponytail: it needs the element's own pixels as a layer; over the rectangle it would cast a box-shaped shadow).

### RC-6 — `::before` / `::after` rules styled the element itself
**File:** `src/browser/rendering/css5/selector.ts`
**Problem:** The comment said pseudo-elements were "not matched", but `matchesCompound` ignored the pseudo-element and returned true. `.hero::before { position: absolute; inset: 0; background: … }` therefore made the hero absolutely positioned, with the motif as its background, so the header fell out of flow. This affects any site that uses pseudo-elements for decoration.
**Fix:** A compound with a pseudo-element never matches the element. Generated content is not rendered yet, so those rules simply don't apply.

### RC-7 — Gradients painted black
**File:** `src/browser/rendering/css-gradients.ts`
**Problem:**
1. The stop regex required the colour part to contain **no digits**, so `#2f8f4e 45%` and `rgb(…) 10%` fell through to black. Most real gradients were black.
2. A radial prelude (`120% 140% at 50% -20%`) was parsed as a colour stop.
3. `at` positions rejected negative values and keywords.
4. Explicit radial sizes were ignored.

**Fix:**
- Stops are a colour followed by one or two positions (the double-position form too); px positions become automatic.
- The radial prelude is recognised and removed.
- Positions accept `-20%` and keywords.
- Explicit radii (`%`/px, one or two values) drive the distance.

### RC-8 — Contextual keywords weren't usable as names
**File:** `src/browser/js/parser.ts`
**Problem:** `get`, `set`, `of`, `from`, `as`, `static` and `async` are keyword tokens. In expression position they weren't identifiers, so httpforever's `function get(key, fallback)` … `get('hf-mode')` threw "expression is not a function". Since 1.30, calling a non-function throws (before it silently returned undefined). `var async = 1; async + 1` failed to parse because any `async` started an async arrow.
**Fix:**
- These tokens are identifiers in `parsePrefix`.
- `async` only starts an async arrow when one really follows: `asyncArrowAhead()` checks `async x =>` and `async (…) =>` with the existing paren lookahead.

### Also
- Python heredoc escapes had written backspace characters into a regex. All sources were scanned for control characters and are now clean.
- The 1-px nub under ring borders was removed (exact outer edge).

## Still open (seen on httpforever.com)
- The inline SVG brand logo isn't drawn, and the fixed `.switcher` buttons sit at top-left instead of top-right.
- A white strip where `.hero__wave` should be.
- The native error page shows the raw Java exception text.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/rasterizer.ts` | `fillRoundedRing`; fast rounded fills (`scaledRadii`, `cornerCoverage`, banded loop); edge slack; region-limited filters; fast outer box-shadows outside the element |
| `src/browser/rendering/paint-engine.ts` | Rounded uniform borders as rings; box-shadow before the background on the border box; `fillRoundedRing` command type |
| `src/browser/rendering/compositing/layer-compositor.ts` | Translates `fillRoundedRing` |
| `src/browser/rendering/css5/selector.ts` | Pseudo-element compounds never match the element |
| `src/browser/rendering/css-gradients.ts` | Stop parsing (digits, double positions); radial prelude, positions, radii |
| `src/browser/js/parser.ts` | Contextual keywords as identifiers; `asyncArrowAhead` |
| `tests/rounded-corners-radios.test.ts` | Fractional-x border, ring outline/hole, no stray pixel |
| `android/app/build.gradle` | 1.36 (37), then 1.37 (38) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/device-findings-137.test.ts` | 9 tests: contextual keywords; async arrows/getters still parse; httpforever theme script runs; ::before/::after don't style the element (hero relative, radial background, at y = 0); frame rasterizes in < 2.5 s; hex/rgb stops and double positions; radial prelude/position; filter stays in its rectangle; box-shadow around, not over, the element |
| `tests/fixtures/httpforever-2026/{index.html,style.css,theme.js}` | httpforever.com (23 KB) |
| `Nova-1.36.apk`, `Nova-1.37.apk` | Signed builds (1.37 installed on the phone) |

## Test Results
```
npx vitest run                          -> Test Files 294 passed (294), Tests 10683 passed (10683), 283 s
npx vitest run tests/device-findings-137.test.ts -> 9 passed (9)
npx vitest run (6 JS suites)            -> 69 passed
npx vitest run (raster/paint/border/form-control, 10 files) -> 238 passed
httpforever.com raster (424 x 3000)     -> 7397 ms before the filter/shadow fixes, 399–475 ms after
npx tsc --noEmit                        -> clean
gradlew :app:assembleRelease + apksigner verify Nova-1.37.apk -> Verifies; versionCode 38
adb install -r Nova-1.37.apk            -> Success; versionName 1.37
```
