# Nova Android 2.16: Inline SVG Icons Drawn (Stylesheet Styles, Flex Sizing), Selector-List Specificity, Letter-Spaced Word Gaps

**Date:** 2026-11-14
**Session:** "the next implementation on this further implementing" (plan: `C:\Users\athar\.claude\plans\replicated-tickling-ember.md`, release 2.16: defects 1 and 3)
**Status:** Code complete and tested offline. Not checked on a device: the realme tablet was not connected this session (adb listed nothing) and 2.15 is still not on it.

---

## Summary
Planned for this release: the blank hamburger button and the lost word space in letter-spaced headings, both seen on the realme tablet with 2.14. Chasing the hamburger icon through the engine turned up four causes, two of them general: every inline `<svg>` that is a flex item was 0 px wide (never drawn), and a selector list gave each of its selectors the highest specificity in the list, so a rule like `button, input[type=button]` beat a more specific `nav > button`.

## Root Causes

### 1. A stylesheet's style never reached an svg's shapes
**File:** `src/browser/rendering/inline-svg.ts` (`serializeElement`)
**Problem:** the hamburger lines are styled only by the page's CSS (`nav>button>svg line{stroke:currentColor;stroke-width:4;stroke-linecap:round}`, `line:first-child{opacity:0;transform:translateY(-100%)}`). The serialized markup had no stroke, so the icon was blank.
**Root cause:** `serializeElement` copied a child's attributes only, and the root's `color/fill/stroke` only.
**Fix:** a shape gets a `style` with the values the cascade gave it for `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `fill`, `opacity`, `transform`, `transform-origin`, but only where they differ from what it would have anyway (the parent's value for an inherited property, the initial value otherwise). A shape styled only by its attributes (`<path stroke="red">`) is left as it was, so its attributes still apply; a rule beats a presentation attribute, as in a browser. The element's own `style` attribute is appended last.

### 2. An svg sized by its attributes was 0 px wide as a flex item
**File:** `src/browser/rendering/layout-engine.ts` (flex item basis and automatic minimum, `contentExtent`)
**Problem:** `<svg width="24" height="24">` inside a `display:flex` element had a 0 px wide box and was never drawn: the check and cross icons next to the test page's result rows (box `109,622,0,24` in the tablet dump) and the hamburger lines. Inside an `inline-flex` button the button was as wide as its padding only.
**Root cause:** three places treat an svg's content as empty because its children are never laid out: the flex basis for `width:auto` is the measured content width (0); the automatic minimum size (`min-width:auto`) is the measured min-content (0, so the item may shrink to nothing); and `contentExtent`, which sizes a shrink-to-fit box, counted a blockified auto-width svg as an empty line-filling block (its own padding, 0).
**Fix:** a replaced item (`REPLACED_TAGS`) uses its intrinsic width (from `resolveIntrinsicSize`, i.e. the attributes) as flex basis and as automatic minimum; `contentExtent` no longer treats a replaced box as filling the line.

### 3. A selector list gave every selector the list's highest specificity
**File:** `src/browser/rendering/css-parser.ts` (`convertRule`)
**Problem:** the hamburger button was 100 px wide although `nav>button{min-width:auto}`. Bisected offline: `nav>button{min-width:auto}button{min-width:100px}` gave `auto`, but with `button,input[type=button]{min-width:100px}` it gave `100px`.
**Root cause:** each selector of a rule's list became its own rule, all carrying the rule's single specificity (the highest, `(0,1,1)` for `input[type=button]`). `button` therefore beat `nav > button` `(0,0,2)`.
**Fix:** each selector's own specificity (`computeSelectorSpecificity(selector)`). This applies to every page with a selector list.

### 4. Letter-spaced glyphs were placed by summed single-character widths
**File:** `src/browser/rendering/paint-engine.ts` (the `letterSpacing` loop)
**Problem:** "Ad Blocker Test" read "Ad BlockerTest" and "Star on GitHub" "Staron GitHub" on the realme tablet.
**Root cause:** layout sizes a run from one whole-string measure plus the spacing (`inline-context.ts`), while paint placed each glyph at the sum of single-character widths. A real canvas measures a string narrower than the sum of its characters, so painted words ran past their layout width and into the space after them. A lone space measures correctly.
**Fix:** glyph `i` is placed at `run.x + measure(text before it).width + i * letterSpacing`.

## Not changed (recorded)
- **Not checked on a device** (see Status). The causes of 1 and 2 were established offline; #4 matches the pattern seen on the tablet but its cause rests on how a real canvas measures, which node cannot show (a fake measurer with narrower whole strings stands in for it in the test).
- **Gauge clip and the "See the tested setups" button offset** (plan items 2.17 and 2.18) are not done.
- **Heading space:** only the paint side is changed; if the tablet still loses a space, the measurer used for layout is the next place to look.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/inline-svg.ts` | shapes carry their cascade-set styles (#1) |
| `src/browser/rendering/layout-engine.ts` | intrinsic width as flex basis and automatic minimum for replaced items; `contentExtent` (#2) |
| `src/browser/rendering/css-parser.ts` | per-selector specificity (#3) |
| `src/browser/rendering/paint-engine.ts` | letter-spaced glyph placement (#4) |
| `android/app/build.gradle` | 2.15 (116) to 2.16 (117) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/svg-child-style-216.test.ts` | rule-styled lines get a stroke; an attribute-styled path is untouched; `nav>button` min-width is `auto` with a `button, input[type=button]` list; an svg keeps 24x24 as a flex item (4 tests, all fail with the source reverted) |
| `tests/letter-spacing-glyph-positions-216.test.ts` | glyphs sit at the measured prefix width plus spacing, with a fake measurer whose strings are narrower than their characters' sum (fails with the source reverted) |

## Test Results
```
npx vitest run tests/svg-child-style-216.test.ts tests/inline-svg-143.test.ts → 10 passed; the 4 new svg tests fail with src/ reverted (git apply -R)
npx vitest run tests/letter-spacing-glyph-positions-216.test.ts               → 1 passed; fails with src/ reverted (expected 28 close to 24)
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 347 passed (347); Tests 11491 passed (11491)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0 (see below)
Device: not connected this session (adb devices listed nothing); 2.15 and 2.16 not installed on the realme tablet.
```
