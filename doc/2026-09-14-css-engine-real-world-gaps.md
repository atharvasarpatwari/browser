# CSS Engine — Six Real Gaps Found Sweeping Against Real-World Fixtures

**Date:** 2026-09-14
**Session:** Follow-up to a requirements-verification pass that flagged the CSS engine as "~55% spec compliance, not re-audited since" (per `2026-07-19-spec-adherence-audit.md`). Built a real e2e sweep (8 fixtures, HTTP-served, pixel-sampled through the real Electron canvas — same methodology as `fidelity-audit.spec.ts`) covering custom properties, `calc()`/`clamp()`/`min()`, `grid-template-areas`, `:has()`/`:is()`/`:where()`, CSS nesting, cascade layers, logical properties, and `aspect-ratio`. Started at 9 failures; bisected each to a root cause instead of patching symptoms.
**Status:** Completed

---

## Summary
Six real, independent bugs found and fixed, each confirmed by tracing a failing pixel check back through the real rendering pipeline (not by reading code and guessing). Two additional "failures" turned out to be test-authoring artifacts (canvas coordinate rounding right at a box edge) rather than engine bugs — fixed by widening the sample margin, not by touching the engine. All 24 checks across the 8 fixtures pass; the full unit and e2e suites stay green.

## Root Causes
1. **`@media`/`@supports`/`@container`/`@layer`/`@layer-order` were silently dropped before ever reaching the (already-correct) CSS5 cascade engine.** The real rendering pipeline (`page-renderer.ts`) extracted page styles through `css-parser.ts`'s legacy `CssRule[]` facade, whose flat shape has no field for "this rule is conditional on X" — `convertRule()` unconditionally `return []`s any CSS5 rule that isn't a plain `style` or `keyframes` rule. Every conditional at-rule was silently discarded, so `@layer override` never actually overrode `@layer base`, media queries never gated, etc. Fixed by adding `extractCss5RulesFromDocument()`, which returns CSS5's own unflattened rule shape (media/supports/container/layer nesting intact), and rewiring `page-renderer.ts` to use it end-to-end instead of round-tripping through the lossy legacy shape.
2. **`grid-template-areas` only recognized double-quoted row strings.** `parseGridTemplateAreas()`'s regex was `/"[^"]*"/g` — CSS allows single or double quotes for strings, and single quotes are the natural choice inside an HTML `style="..."` attribute (which itself uses double quotes). A single-quoted `grid-template-areas` value parsed to an empty area map, silently falling back to plain auto-placement for every item in the grid.
3. **Area-based grid placement never actually ran for `grid-area`-only items, even with a correct area map.** `layoutGridContainer()` gated area-based placement on `!rawGridColumn && !rawGridRow` — but `cascade.ts`'s `ALL_PROPERTIES` fallback fills every element's `grid-column`/`grid-row` with the CSS-spec initial value `'auto'` regardless of whether the author set them, and `'auto'` is a truthy string. So the guard was `false` for every element that set `grid-area` alone (the normal case), and it silently fell back to auto-placement instead — the visible symptom being named-area items rendering in the wrong cells with the wrong colors whenever a row held more than one area.
4. **`:is()`/`:not()`/`:where()`/`:has()` with a comma-separated argument list matched the wrong elements.** The selector-parsing path used by every real `<style>` tag (`parseStylesheetRobust` → `tokenizeSelector`/`buildCompoundFromTokens`) captured a pseudo-class function's entire argument as one raw-text token, then tokenized and built it as a **single** selector — the comma's trailing whitespace got tokenized as a plain descendant combinator, so `:is(.a, .b)` silently became "matches `.b` that is a descendant of `.a`" instead of "matches `.a` OR `.b`". Fixed by splitting the argument on top-level commas (via the already-existing `splitSelectorList()` helper, reused rather than reimplemented) before building each alternative.
5. **`:is()`/`:not()`/`:has()` specificity could be silently understated.** `computeCompoundSpecificity()` folded the pseudo-class's "most specific argument" contribution into the *same* running `id`/`a`/`b` totals as the rest of the compound via `Math.max`, instead of adding it on top. A compound like `:is(.a,.b).active` could have its `:is()` contribution clamped away by the `.active` class already sitting in the running total, understating the selector's true specificity and letting a less-specific rule win the cascade.
6. **Logical margin/padding/inset properties were unimplemented — silent no-ops.** `margin-inline-start`, `padding-block`, `inset-inline-end`, etc. (including the two-value shorthand forms `margin-inline`/`padding-block`/`inset-block`) were never translated to the physical `margin-left`/`padding-top`/`left` properties that layout actually reads, so they had no effect on any element that used them.

## Notes
- Two of the original nine failures were **test-authoring artifacts, not engine bugs**: two `calc()`/`min()` "just outside the box" checks and one `aspect-ratio` "just outside the box" check sampled a pixel only 1–5px past a computed box edge, which is sensitive to the canvas's own coordinate-scaling rounding. Confirmed via a standalone repro (`HtmlParser` → `DomTree` → `CssParser` → cascade → `LayoutEngine`, printing the actual computed box) that the underlying width/height math was exactly correct in all three cases (e.g. `aspect-ratio: 2/1` with `width:100px` computed `height:50px` exactly). Fixed by widening the "outside" sample points to a comfortable margin instead of touching any engine code.
- Root cause #3's fix (treating `'auto'` as "unset" for the area-placement guard) only affects `grid-column`/`grid-row`; it does not change their existing, correct auto-placement behavior when an item genuinely has no `grid-area`/`grid-column`/`grid-row` at all.
- Root cause #6 deliberately does not handle vertical writing-modes (`vertical-rl`/`vertical-lr`) — block-axis logical properties map straight to `top`/`bottom` regardless of `writing-mode`, since `horizontal-tb` covers the overwhelming majority of real pages. `direction: rtl` **is** handled for the inline axis. Flagged in a `ponytail:`-style comment at the mapping table in `cascade.ts` rather than silently assumed.
- The e2e sweep test (`tests/e2e/css-feature-sweep.spec.ts`) was written as a throwaway scratch file first (`_css-sweep.spec.ts`) to find real bugs fast, then promoted to a permanent regression test once it proved its worth — same pattern as this session's earlier `evalJSLazy` work on the JS engine.
- Each bug was root-caused with a standalone reproduction script (real `HtmlParser`/`DomTree`/`CssParser`/cascade/`LayoutEngine` pipeline, or direct calls to the parsing functions in isolation) run via `tsx`, never fixed from a hunch — several initial hypotheses (e.g. a suspected shared-Map mutation bug for the grid-area swap) were disproved this way before the real cause (`'auto'`'s truthiness) was found.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css-parser.ts` | Added `extractCss5RulesFromDocument()`, returning CSS5's native unflattened `Css5Rule[]` instead of the lossy legacy `CssRule[]` |
| `src/browser/engine/page-renderer.ts` | Both render entry points, `recalcStylesIncremental()`, and `buildCss5Stylesheet()` now consume `extractCss5RulesFromDocument()` directly; `buildCss5Stylesheet()` shrank from ~50 lines of re-parsing to a 1-line wrap |
| `src/browser/rendering/formatting/grid-context.ts` | `parseGridTemplateAreas()`'s regex now matches `'...'` as well as `"..."` quoted rows |
| `src/browser/rendering/layout-engine.ts` | `layoutGridContainer()` now treats a computed `grid-column`/`grid-row` of `'auto'` as "not set" so `grid-area`-only items still get area-based placement |
| `src/browser/rendering/css5/parser.ts` | `buildCompoundFromTokens()` splits `:is()`/`:not()`/`:where()`/`:has()` arguments on top-level commas via `splitSelectorList()` before building each alternative selector; `computeCompoundSpecificity()` now adds the pseudo-class's most-specific-argument contribution instead of clamping it via `Math.max` against the compound's own running total |
| `src/browser/rendering/css5/cascade.ts` | Added `resolveLogicalProperties()` (inline/block logical margin, padding, and inset properties, including two-value shorthands, mapped to physical properties based on `direction`), called from `computeComputedStyles()` |
| `tests/page-renderer.test.ts` | Updated 4 assertions/mocks from the retired `extractStylesFromDocument` call to `extractCss5RulesFromDocument` (mock rule reshaped to CSS5's `Css5Rule` type) |

## Files Created
- `tests/e2e/css-feature-sweep.spec.ts` — 8 HTTP-served fixtures, 24 pixel-based checks (custom properties, `calc`/`clamp`/`min`, `grid-template-areas`, `:has()`/`:is()`/`:where()`, CSS nesting, cascade layers, logical properties, `aspect-ratio`)
- `doc/2026-09-14-css-engine-real-world-gaps.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9248 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 3/3 spec files passed
                                                                     (electron-smoke, fidelity-audit,
                                                                     css-feature-sweep — 24/24 checks)
```

## Verification Steps
1. Built `tests/e2e/css-feature-sweep.spec.ts` against a real local `http.createServer()` (the `data:text/html,...` URL scheme does not render in this engine — confirmed `NO_CANVAS` on every check before switching), navigating the real Electron app via `.address-input` and sampling `.content-area canvas` pixels through `getImageData()`, scaled by `canvas.width/canvas.clientWidth`.
2. For each of the 9 initial failures, wrote a standalone Node repro (via `tsx`) exercising the real pipeline in isolation — either the parsing functions directly (`parseGridTemplateAreas`, `CssParser.parseStylesheetRobust`) or the full `HtmlParser → DomTree → CssParser → computeComputedStyles → LayoutEngine` chain — to pin down exactly where correct data got lost or misinterpreted, rather than patching based on a guess.
3. Rebuilt the web bundle (`npm run build:web`) and reran the e2e sweep after each fix to confirm the specific check flipped from FAIL to PASS before moving to the next bug.
4. Ran the full unit suite and full Electron e2e suite (smoke + fidelity-audit + the new sweep) after all fixes — all green, including the 4 `page-renderer.test.ts` assertions that needed updating for the `extractCss5RulesFromDocument` rename (itself part of root cause #1's fix).
