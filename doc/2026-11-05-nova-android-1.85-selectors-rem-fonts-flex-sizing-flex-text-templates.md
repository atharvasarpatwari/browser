# Nova Android 1.85: Wikipedia and MDN Headers — :not() in :is(), rem Font Sizes, Flex Min/Max, Text in Flex, Templates and Shadow DOM

**Date:** 2026-11-05
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected at the end of the round, so it is not installed)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 332 files, 11409 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

The work then took the three defects found on the tablet in 1.84's live check of Wikipedia. Each was reproduced on the saved article and traced:
- blue rings around the page-tool icons (#1, #2);
- the wordmark under the search box (#3–#5);
- citation markers drawn as dots (#6).

Fixing them made more of the saved pages render, which exposed four more root causes on MDN and IANA (#7–#10).

**Saved real pages, old vs new, offline:**
- **Identical:** example.com, Google, httpbin, httpforever.
- **Changed, each image checked:**
  - **Hacker News:** its `pt` font sizes were never converted, so the old render shows tiny text.
  - **IANA:** the "← Instructions and Guides" breadcrumb pill appears, and "Last revised" is legible.
  - **Wikipedia ×3:** citation markers [1]–[4] show, the focus rings are gone, the select shows "20 items", and the search placeholder is readable.
  - **MDN:** the header row shows "Web › HTML", Theme and English (US), and its stray template markup is gone.

## Root Causes

### 1. `:not()` inside `:is()`/`:where()` matched the wrong elements
**File:** `src/browser/rendering/css5/parser.ts` (`consumeUntilClosingParen`)
**Problem:** `a:where(:not([role='button'])):focus-visible` drew a 2px blue focus ring around every `role="button"` link (Wikipedia's language, bookmark and edit icons). `a:is(:not([role=button]))` selected the buttons and not the plain links.
**Root cause:** the argument reader counted `(` tokens but not function tokens such as `not(`, which open a parenthesis too. The argument ended at the inner `)` (`:not(.q`), and the outer `)` leaked into the rest of the selector.
**Fix:** function tokens raise the depth.

### 2. Pseudo-class arguments lost their punctuation when rebuilt
**File:** `css5/parser.ts` (new `tokenSource`)
**Problem:** even with #1 fixed, `:where(:not(.q))` came back as `:not` with no argument followed by `.q`.
**Root cause:** the argument was rebuilt from raw token values, which drop their punctuation. `not(` is stored as `not`, `#id` as `id`, and a string loses its quotes.
**Fix:** `tokenSource()` writes each token back as CSS: function `name(`, `#hash`, `@keyword`, quoted strings, `url("…")`.

### 3. The flex algorithm ignored min-width / max-width
**File:** `src/browser/rendering/formatting/flex-context.ts` (`resolveLineMainSizes`), `layout-engine.ts` (item construction)
**Problem:** Wikipedia's logo box (`min-width: 10.0625em`) and the search form were both placed at x=265, overlapping. The next item started where the unclamped size ended, while `layoutNode` clamped the box itself afterwards. An item holding a 140px float was squeezed to 70.
**Root cause:**
- Flexible lengths were resolved without min/max sizes, and shrinking took the same amount from every item.
- CSS Flexbox §9.7 clamps to min/max, freezes the items that hit a limit and redistributes; shrinking is weighted by flex-shrink × basis.
- `min-width: auto` is the item's min-content width (§4.5).

**Fix:**
- The §9.7 loop, with inflexible items sized at their clamped basis.
- Items carry `minMainSize`/`maxMainSize`.
- The automatic minimum is measured only if the line shrinks, and only for items that don't scroll.

### 4. Flex items mixed content-box and border-box widths
**File:** `layout-engine.ts` (`layoutFlexContainer`)
**Problem:** `width: 100px; padding: 5px; border: 5px` came out 100 wide, not 120. A content-sized item with padding lost the padding from its basis.
**Root cause:**
- The basis came from a content width.
- The item was laid out with the main size as its available width, and the next item placed after it as a border box.
- Columns subtracted the frame when writing the size; rows didn't.

**Fix:** row bases and min/max are border-box: padding and border are added for `content-box` and measured sizes. The written `width` subtracts them again for `content-box` items.

### 5. Shrink-to-fit inline boxes: centring measured, min/max ignored, % widths cyclic
**File:** `layout-engine.ts` (`layoutFlexContainer`, `layoutInlineBlockElement`, `layoutNode`)
**Problem:** Wikipedia's menu button (`inline-flex; justify-content: center`, a 20px icon) was 114px wide. MDN's `min-width: 44px` buttons were 20px. MDN's sidebar toggle (`button { width: 100% }`) measured 1016px and squeezed the breadcrumbs to one letter per line.
**Root cause:**
- **Centring:** while measuring, items were centred in the whole available width, and the extent included that offset. Text already turned `text-align` off while measuring; flex had no equivalent.
- **Min/max:** inline-blocks had no width clamp.
- **Percentages:** a percentage width resolved against the measuring width, although it depends on the size being measured. CSS Sizing §5.2.1 treats such a cyclic percentage as auto there.

**Fix:**
- Items pack at the start while measuring.
- min/max-width clamp inline-blocks.
- `cyclicPercentage()` treats % widths as auto during measurement in `layoutNode`, the inline-block path and flex bases.

### 6. rem (and pt, vw…) font sizes were never computed
**File:** `src/browser/rendering/css5/computed-value-resolver.ts`
**Problem:** Wikipedia's citation markers (`.content .mw-ref { font-size: .75em }` in a `1rem` paragraph) were 0.75px. Hacker News' `10pt` text and IANA's `0.85rem` breadcrumb were tiny or unreadable, and the search placeholder was a 1px "…".
**Root cause:**
- Only keywords, `%` and `em` font sizes became px.
- `1rem` stayed a string, so a child's `0.75em` read it with `parseFloat` as 1 and became 0.75px.

**Fix:** `rem`, `ex`, `ch`, `pt`, `pc`, `in`, `cm`, `mm`, `q`, `vw`, `vh`, `vmin` and `vmax` font sizes compute to px.

### 7. Text directly inside a flex or grid container was dropped
**File:** `src/browser/rendering/dom-tree.ts` (`boxChildren`, `wrapTextRuns`)
**Problem:** `<div style="display:flex">Hello world</div>` painted nothing and was 0px tall. The same happened to pill buttons and IANA's breadcrumb link (`display: inline-flex`).
**Root cause:** flex and grid layout took element children only. Each run of text in a flex or grid container is an anonymous item (CSS Flexbox §4, Grid §6).
**Fix:** `boxChildren()` wraps each non-whitespace text run of a flex or grid container in a cached anonymous block. The block inherits the container's style, and layout and paint both see it.

### 8. A flex-container item was measured as a block
**File:** `layout-engine.ts` (flex basis)
**Problem:** MDN's breadcrumbs (`ol { display: flex }` > `li`) measured as the widest `li` (22px), not the sum (39px).
**Root cause:** the content-size basis called `measureContentWidth` without its `flex` flag, so the items were stacked.
**Fix:** the flag is passed for `flex` / `inline-flex` items.

### 9. A trailing right margin was left out of a measured width
**File:** `layout-engine.ts` (`contentExtent`)
**Problem:** MDN's breadcrumb chevron (`margin-inline: .25rem`) measured 4px short. The list shrank its first item, and "Web" broke between letters (`overflow-wrap: break-word`).
**Root cause:** the extent stopped at a box's border edge.
**Fix:** a non-auto right margin counts.

### 10. Template content was rendered; declarative shadow DOM was not
**Files:** `src/browser/rendering/html5/modes/template.ts`, `html5/modes/head.ts`, `dom-tree.ts` (`boxChildren`)
**Problem:**
- Every `<template>`'s content showed on the page (`<template><i>T</i></template>` rendered "T").
- MDN's web components showed their light-DOM labels ("Toggle sidebar") beside their shadow markup.

**Root cause:**
- In "in template" mode, every start tag and text token first popped the template (`popCurrentNodeUntil('template')`), so the content became its following siblings. §13.2.6.4.18 only switches the template insertion mode.
- `</template>` popped only when the template was the current node.
- Declarative shadow roots (`<template shadowrootmode>`) were not rendered as the host's shadow tree with slots.

**Fix:**
- The "in template" mode follows the spec.
- `</template>` pops until the template.
- `boxChildren()` renders a host's shadow template content. Each `<slot>` shows the host children assigned to it (by `slot` name) or its fallback content.
- `ponytail:` shadow styles still apply document-wide; there's no `:host` or style scoping.

## Not changed (recorded)
- **Mask-image icons offline:** the MDN breadcrumb chevron and the Wikipedia footer icons need the network (1.84 loads them on the device).
- **Automatic minimum with `overflow-wrap`:** the min-content measurement honours `overflow-wrap: break-word`, which the spec excludes from min-content.
- **From earlier rounds:** the `lh` unit, and multi-layer CSS url() images.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/parser.ts` | function tokens in pseudo arguments (#1); `tokenSource` (#2) |
| `src/browser/rendering/formatting/flex-context.ts` | §9.7 flexible lengths with min/max and weighted shrink (#3) |
| `src/browser/rendering/layout-engine.ts` | item min/max and automatic minimum (#3); border-box units (#4); measuring: start packing, inline-block min/max, cyclic % (#5); flex basis measured as flex (#8); trailing margin (#9) |
| `src/browser/rendering/css5/computed-value-resolver.ts` | rem/pt/vw… font sizes to px (#6) |
| `src/browser/rendering/dom-tree.ts` | anonymous flex/grid text items (#7); declarative shadow DOM and slots (#10) |
| `src/browser/rendering/html5/modes/template.ts` | "in template" mode per spec (#10) |
| `src/browser/rendering/html5/modes/head.ts` | `</template>` pops until the template (#10) |
| `android/app/build.gradle` | 1.84 (85) → 1.85 (86) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/wikipedia-mdn-header-185.test.ts` | 15 tests: :not() in :is()/:where() (querySelectorAll and cascade); rem/pt/vw font sizes; flex min-width, min-content, border-box, max-width, nested flex, trailing margin; inline-flex centring, inline-block min-width, cyclic %; text in flex/grid; template content, unclosed template, declarative shadow DOM with slots |

## Test Results
```
Start of round: npx vitest run → 332 files, 11409 passed; tsc exit 0; eslint 0 errors; gradle unit tests exit 0
Saved Wikipedia @1070: language button outline 2px #36c; .branding-box and form both at x=265; sup.mw-ref font-size 0.75px (p = "1rem")
Selector probe: a:is(:not([role=button])) → [b] (button) before, [p] after; a:where(:not(.q)) → [] before, [p,b] after
Flex probe (before → after): min-width item next at 3 → 160; float-holder 70 → 140; padded 100px item 100 → 120; 44px button next at 20 → 46
Text-in-flex probe: <div style="display:flex">Hello world</div> → 0px, no text before; 20px, text painted after
Template parse probe: <template><i>T</i></template> → <i> sibling of template before; child after
npx vitest run tests/wikipedia-mdn-header-185.test.ts → 15 passed
npx vitest run (without the new file) → Test Files 332 passed (332); Tests 11409 passed (11409)
npx vitest run                     → Test Files 333 passed (333); Tests 11424 passed (11424)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings); one prefer-const error from this round fixed first
Saved pages old vs new, offline (10 pages × 412/1070):
  identical: example.com ×2, google ×2, httpbin ×2, httpforever ×2
  changed (each image checked): hn 89288/77262 px, iana 46034/41300, mdn 330881/136427,
  wikipedia-article 24134/13136, wikipedia-results 16244/86277, wikipedia-search 18928/7804
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.85.apk     → verified; versionCode 86, versionName 1.85
adb devices                        → none (not installed)
```
