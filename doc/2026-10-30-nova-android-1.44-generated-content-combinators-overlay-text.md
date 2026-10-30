# Nova Android 1.44: ::before/::after Content, CSS Combinators Restored, Card Text Back

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", the fifth round of the day. The user picked "::before/::after content" from the plan. The phone came online mid-round ("device is online now"), so 1.43 was tested on the device, and a diagnostic build pinned down why the card text was missing.
**Status:** Completed (on-device check of 1.44 pending: install not confirmed)

---

## Summary
- **Generated content.** CSS generated content (`::before`/`::after`, and the legacy `:before`/`:after`) is rendered for the first time: separators, bullets, quotes, labels, and decorative boxes.
- **Card text (from the phone test).** On the phone, httpforever's card text had been missing since 1.41. It was not a colour problem: the 1.41 fixed-box overlay picked up the cards' opaque backgrounds through stacking contexts, and painted them over the text on every frame after the first.
- **Combinators.** While testing generated content, it turned out that every `>`, `+` and `~` combinator written with spaces matched as a descendant combinator, on every site.

## Device test (Realme RMX5264, Android 16, night mode)
| Build | Test | Result |
|-------|------|--------|
| 1.43 | `adb install -r` over 1.42 | ✅ Success |
| 1.43 | httpforever.com | ✅ Dark cards (the 1.42 selector fix); ✅ the theme icon is drawn (inline SVG); ✅ the brand mark is drawn (small); ❌ **the cards have no text at all**: the card area is one flat colour (`25,29,26`) → RC-1 |
| 1.43 + diagnostic | A temporary `[diag]` log right after the first paint | The first raster **does** contain the text: the pixel at "train," = `233,239,234` (the ink colour), 132 runs. So a later frame loses it. |
| 1.44 | `adb install -r` | ❌ The install prompt was dismissed (adb: "failed to install", no reason). Not retried, since another attempt puts a new prompt in front of the user. The re-check is pending. |

## Root Causes

### RC-1: Stacking-context backgrounds leaked into the fixed overlay
**Files:** `src/browser/rendering/formatting/stacking.ts`, `src/browser/rendering/paint-engine.ts`
**Problem:**
- 1.41 split each frame into the page bitmap plus an overlay of `position: fixed` boxes, filtering elements in the `renderStackingContext` paint callback.
- A stacking context's own background comes from `ctx.bgCommands`, which is emitted without the callback.
- httpforever reveals its cards with `animation: rise` (opacity 0 → 1). While animating, each card is a stacking context, so its opaque background went into the **fixed overlay**, which is blended over every scrolled frame, covering the text.
- The first frame was rasterized before the animator ran, so it was fine. Every reflow frame after it lost the text.

Reproduced locally by running reflow frames with a mocked clock: card ink went 16,025 → 0, while a fresh rasterizer on the same commands still drew it.

**Fix:** `renderStackingContext(ctx, paint, include?)` applies the same `include` filter to Layer 0 (`bgCommands`). The page/fixed split passes it.

### RC-2: `a + b`, `ul > li` and `a ~ b` matched as descendant selectors
**File:** `src/browser/rendering/css5/parser.ts` `tokenizeSelector`
**Problem:**
- The stylesheet wrapper re-parses selectors through `buildSelectorFromTokens`.
- Its tokenizer skipped whitespace *before* a combinator, but the whitespace *after* it became a descendant-combinator token that replaced it: `ul > li` → `ul li`.
- Every child, adjacent-sibling and general-sibling rule written with spaces (the usual style) therefore matched far too much.

**Fix:** Whitespace becomes a descendant combinator only between two compounds, never right after another combinator or at the start.

### RC-3: Generated content was never rendered
**Files:** `src/browser/rendering/css5/cascade.ts`, `css5/selector.ts`, `css5/parser.ts`, `generated-content.ts` (new), `dom-tree.ts`, `layout-engine.ts`, `paint-engine.ts`, `formatting/stacking.ts`, `render-tree.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** Since 1.37, pseudo-element rules were correctly kept off the element, but no box was ever generated, so the content was missing.
**Fix:**
- **Cascade:** `computePseudoElementStyles(el, 'before' | 'after', …)` uses only rules whose rightmost compound names that pseudo-element (`matchesSelectorListForPseudo`). It inherits from the host, ignores the host's inline style, and returns null without a `content` value.
- **Parser:** the legacy single-colon `:before`, `:after`, `:first-line` and `:first-letter` are pseudo-elements.
- **Box:** `makePseudoElement()` builds a `::before`/`::after` element whose text comes from `content`: strings with CSS escapes (`"\203A"`), `attr()`, `open-quote`/`close-quote`. `counter()` and `url()` give nothing yet. It is inline by default.
- **Not in the DOM:** the box hangs off the host as `pseudoBefore`/`pseudoAfter`, outside `children`, so scripts (`childNodes`, `textContent`), queries and selectors never see it. Layout, paint, the stacking tree and the render tree walk `boxChildren(el)` (before + children + after).
- **When:** generated in both the first style pass and the incremental restyle.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/formatting/stacking.ts` | `include` filter for `bgCommands`; `boxChildren` |
| `src/browser/rendering/paint-engine.ts` | Passes `include` for the page/fixed split; `boxChildren` in collect/clear |
| `src/browser/rendering/css5/parser.ts` | Combinator tokenizing; legacy single-colon pseudo-elements |
| `src/browser/rendering/css5/selector.ts` | `selectorPseudoElement`, `matchesSelectorListForPseudo` |
| `src/browser/rendering/css5/cascade.ts` | `computePseudoElementStyles`; `pseudo` mode in `computeCascade` / `computeComputedStyles` |
| `src/browser/rendering/dom-tree.ts` | `pseudoBefore`/`pseudoAfter`; `boxChildren()` |
| `src/browser/rendering/layout-engine.ts` | `boxChildren` in all child walks |
| `src/browser/rendering/render-tree.ts` | `boxChildren` |
| `src/browser/engine/page-renderer.ts` | `applyPseudoElements` in both style passes |
| `android/app/build.gradle` | 1.44 (45) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/generated-content.ts` | `contentText`, `makePseudoElement` |
| `tests/generated-content-144.test.ts` | 9 tests: content values (escapes, attr, quotes, counter, none/invalid); bullets, breadcrumb `›`, link labels, `p:after`; not DOM children (textContent, childNodes); no content → no box, legacy colon, host unstyled; decorative positioned box; inheritance; httpforever text survives the reveal animation and the fixed overlay holds only the switcher; `>` `+` `~` keep their meaning |
| `Nova-1.44.apk` | Signed build |

## Still open
- httpforever's "HTTP Forever" brand name text (NBSP inside `inline-flex`) is still missing, and the brand mark draws small.
- The theme icon sits in the button's corner, not centred (`display: grid; place-items: center` on a button).
- The white streaks at the top of the hero.
- `counter()` / `url()` in `content`, and `::marker` / `::first-line` / `::first-letter` styling.

## Test Results
```
npx tsc --noEmit                                  -> clean
npx vitest run tests/generated-content-144.test.ts -> 9 passed (9) (incl. the combinator test)
npx vitest run                                    -> Test Files 298 passed (298), Tests 10711 passed (10711)  (before the combinator test was added)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.44.apk                    -> Verifies; versionCode 45, versionName 1.44
adb install -r Nova-1.43.apk / diagnostic build   -> Success
adb install -r Nova-1.44.apk                      -> failed (prompt dismissed); phone still on 1.43
```
