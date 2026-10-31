# Nova Android 1.55–1.61: Continuous Tablet Testing (Clip-path, Restyle, Inline SVG, Grid Items, Details)

**Date:** 2026-10-31
**Session:** "install again and do all the tests" / "do the continuous testing" — install each build on the OPPO tablet, test, fix what the tablet shows, rebuild, reinstall
**Status:** Completed

---

## Summary

Seven builds (1.55 → 1.61) installed on the OPPO tablet (OPD2305, Android 14, CSS width 1070 at DPR 2.25), each tested against three pages served over `adb reverse` from `tests/fixtures/device-pages/` (now committed, so the scratchpad wipes can't take them again): the feature check page, `tap2.html` (httpforever's switcher structure) and a copy of httpforever.com. Thirteen root causes fixed, found one after another by the tablet: out-of-flow boxes used the border box, clip-path painted white streaks, ellipsis failed on a space, clicks never reached `document`, click handlers' style changes never repainted, the fixed theme switcher jumped left, inline SVG drawn only once at load, grid items lost their text and painted under their container, `<circle/>` swallowed the next SVG shape, and `<details>` had no marker and couldn't be opened.

## Tablet results (1.61)

| Page | Check | Result |
|------|-------|--------|
| httpforever | colour button turns the hero red | ✅ (broken until 1.57) |
| httpforever | theme button: auto ◐ → light ☀ → dark ☾ → auto, switcher stays top right | ✅ (jumped left in 1.57; icons blank until 1.61) |
| httpforever | brand mark | ✅ open padlock (was a white pill) |
| httpforever | wave clip-path, no streaks | ✅ (1.55) |
| tap2 | red button turns header red; body and document listeners see the click | ✅ |
| tap2 | "T" label in the grid button | ✅ (never drawn before 1.60) |
| features | lists, roman counters, breadcrumbs, `:is`, sup/sub, br, pre, hidden, gap, clamp, centred grid, table | ✅ |
| features | ellipsis "This sentence is far too…" | ✅ (1.55) |
| features | `<details>`: ▸ marker, tap opens (▾ + body), tap closes | ✅ (1.58) |
| features | classList toggle panel, document click counter | ✅ (1.57) |
| features | 10 JS checks (DOMContentLoaded, Intl, toLocaleString, `new ns.C()`, getter, at/findLast, replaceAll, match groups, load) | ✅ 10/10 PASS |

## Root Causes

### 1. Out-of-flow boxes positioned against the border box (1.55)
**File:** `src/browser/rendering/positioning.ts`
**Problem:** `resolveOutOfFlow` measured `top/left/right/bottom` from the containing block's border edge; CSS 2.2 §10.1 uses the padding edge, so absolutely positioned children of bordered boxes sat one border-width off.
**Fix:**
```ts
cbX = containingBlockBox.x + containingBlockBox.borderLeft;
cbWidth = containingBlockBox.width - containingBlockBox.borderLeft - containingBlockBox.borderRight;
```

### 2. clip-path painted white streaks and ignored percentage radii (1.55)
**Files:** `rasterizer.ts`, `clip-mask.ts`, `paint-engine.ts`, `compositing/layer-compositor.ts`
**Problem:** `applyClipShapeToPixels` walked the clip region with the wrong row stride and cleared pixels to white, striping httpforever's wave; `circle(50%)` / `ellipse(60% 40%)` radii were read as px.
**Fix:** a `beginClipShape` command snapshots the region before the clipped element paints; `applyClipShape` restores every pixel outside the shape (`isInsideClip` at pixel centres). Percentage radii resolve against the box (circle: `sqrt((w²+h²)/2)`), positions accept negatives and px.

### 3. text-overflow: ellipsis lost when a space crossed the edge (1.55)
**File:** `paint-engine.ts`
**Problem:** each run decided its own ellipsis; when the run crossing the edge was a space, no run took the "…" and the text was just cut.
**Fix:** `ellipsizeRuns(runs, edge)` pre-pass per line: the nearest run that can hold "…" gets it and later runs are dropped.

### 4. Clicks never reached `document` listeners (1.56)
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** element `dispatchEvent` stopped at the root element; `document.addEventListener('click', …)` (delegation, analytics, menus closing on outside click) never fired, and `{ capture, once }` options were ignored for documents.
**Fix:** the path now captures at the document first and bubbles to it last; `listenerOptions()` shared by element and document `addEventListener`; once-listeners cleaned up on the document too.

### 5. A restyled element was laid out but not repainted (1.56)
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** `recalcStylesIncremental` recomputed styles but only marked layout dirty when display changed; a colour change from a click handler kept the old paint commands.
**Fix:** compare the new computed style with the previous one; on any change mark the element (and ancestors) layout-dirty and paint-dirty.

### 6. setAttribute / classList never marked style dirty (1.57) — the click-restyle root cause
**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** found with a temporary on-device log ("recalc dirty=0"): `setAttribute`/`removeAttribute` (so `el.style.x = …`, `classList`, `data-*` theme switches) changed the attribute but left `_dirtyStyle` false, so no restyle ran. Tests had passed falsely because every element starts style-dirty until the first frame.
**Fix:** `markStyleDirtyFrom(element)` on a changed value: the element's subtree and its later siblings' subtrees (for `+`/`~` selectors). Tests now run a frame before clicking.

### 7. The fixed `right:` switcher jumped to the left when its icon changed (1.58)
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** a `display:none` subtree keeps the layout boxes of its last layout. After the theme click hid the auto icon, shrink-to-fit `contentExtent` still counted its stale box at the right edge, so the fixed `right: .9rem` switcher measured 530 px wide and its buttons landed top left.
**Fix:**
```ts
if (node !== el && node.computedStyle?.get('display') === 'none') return 0;
```

### 8. Inline SVG rasterized only once, at load (1.59)
**Files:** `src/browser/rendering/inline-svg.ts`, `page-renderer.ts`
**Problem:** `renderInlineSvgs` ran once after load, for svgs laid out then. Icons hidden at load (the sun/moon of a theme toggle), inserted by scripts, resized or recoloured by `currentColor` were never drawn.
**Fix:** it also runs after every reflow frame (one pass in flight), redrawing only svgs whose `size + colour` key changed; a frame is requested when any was drawn.

### 9. Grid items lost their text and their children stayed at the grid origin (1.60)
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `layoutGridContainer` lays each item out at the grid's content origin, then replaced the item's box with one at its track position — rebuilt field by field without `textRuns`, and without moving its descendants. Every text in a `<span>`/`<a>` grid item vanished (tap2's "T") and nested content stayed at the origin.
**Fix:**
```ts
this.translateContent(item.element, newX - box.x, newY - box.y);
const newBox: LayoutBox = { ...box, x: newX, y: newY };
```

### 10. Block-level flex/grid containers painted after their own children (1.60)
**File:** `src/browser/rendering/formatting/stacking.ts`
**Problem:** only `display: block` went to Appendix E level 2; a `display:grid` button was a level-4 "inline", so its blockified children (the `display:block` theme icon) painted in level 2 — before the button's background, which covered them. Found by logging the fixed layer's command order on the tablet.
**Fix:** flex, grid and (non-inline) table boxes are level 2 too. ponytail: inline-block isn't painted atomically yet.

### 11. `<circle/>` inside `<svg>` swallowed the next shape (1.61)
**File:** `src/browser/rendering/html5/tree-builder.ts`
**Problem:** `processToken` turned every self-closing tag into a plain start tag, so `<circle/><path/>` nested the path inside the circle and the SVG renderer dropped it: the sun lost its rays, the auto icon its half disc, httpforever's padlock was a white pill.
**Fix:** a self-closing start tag inside `<svg>`/`<math>` (or one itself) is popped right after insertion (§13.2.6.5); HTML still ignores the flag.

### 12. `<summary>` had no marker; inside list markers were painted in the margin (1.58)
**Files:** `css5/cascade.ts`, `generated-content.ts`, `page-renderer.ts`, `paint-engine.ts`
**Problem:** summaries were plain blocks; `list-style-position: inside` was painted like outside.
**Fix:** a details' summary is `display:list-item; list-style: disclosure-closed|open inside`; `insideMarker()` builds an inside marker as a ::before-style inline box (inherited font/colour) when the item has no ::before of its own, and the outside painter skips inside items.

### 13. Tapping a summary didn't open its details (1.58)
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** no activation behaviour for `<summary>`.
**Fix:** `toggleDetails()` after an uncancelled click (taps and `el.click()`): the details' first summary toggles `open` through `domTree.setAttribute`/`removeAttribute` (so #6 restyles it). Clicks on a link/button/control inside the summary don't toggle. ponytail: no `toggle` event yet.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/positioning.ts` | padding-box containing block (#1) |
| `src/browser/rendering/rasterizer.ts` | beginClipShape snapshot / restore outside shape (#2) |
| `src/browser/rendering/clip-mask.ts` | % radii, negative/px positions (#2) |
| `src/browser/rendering/paint-engine.ts` | beginClipShape emit, ellipsizeRuns (#2, #3); inside markers skipped (#12) |
| `src/browser/rendering/compositing/layer-compositor.ts` | translate beginClipShape (#2) |
| `src/browser/js/dom-bindings.ts` | document event path, listener options (#4); toggleDetails (#13) |
| `src/browser/engine/page-renderer.ts` | restyle marks paint dirty (#5); post-frame svg pass (#8); inside marker box (#12) |
| `src/browser/rendering/dom-tree.ts` | markStyleDirtyFrom on attribute change (#6) |
| `src/browser/rendering/layout-engine.ts` | contentExtent skips display:none (#7); grid item content translated (#9) |
| `src/browser/rendering/inline-svg.ts` | raster key, redraw on change (#8) |
| `src/browser/rendering/formatting/stacking.ts` | flex/grid/table at level 2 (#10) |
| `src/browser/rendering/html5/tree-builder.ts` | self-closing foreign elements popped (#11) |
| `src/browser/rendering/css5/cascade.ts` | summary list-item + disclosure marker (#12) |
| `src/browser/rendering/generated-content.ts` | `insideMarker()` (#12) |
| `tests/positioning.test.ts` | 6 expectations → padding-box values |
| `tests/render-paint-enhanced.test.ts` | applyClipShape test uses beginClipShape |
| `tests/page-events-147.test.ts` | a frame before the colour click |
| `tests/html-basics-151.test.ts` | closed/open details now include ▸ / ▾ |
| `android/app/build.gradle` | versionCode 62, versionName 1.61 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/clip-path-padding-box-155.test.ts` | padding box, httpforever wave, ellipse clip, ellipsis with a space (5 tests) |
| `tests/events-restyle-156.test.ts` | document bubble/capture/once, click restyle (static + relative), classList descendant/sibling (4 tests) |
| `tests/switcher-details-158.test.ts` | fixed switcher after icon swap, summary marker + toggle, list-style none / link inside, inside bullets, svg redraw after load, grid paint order, grid item text column, `<circle/>` siblings (8 tests) |
| `tests/fixtures/device-pages/features.html` | on-device feature check page (lists, generated content, text, layout, interaction, 10 JS checks) |
| `tests/fixtures/device-pages/tap2.html` | httpforever switcher structure: fixed flex of grid buttons, restyle on click, body/document listeners |
| `tests/fixtures/device-pages/hf/` | httpforever copy (`index.html`, `css/style.css`, `js/theme.js`) served at the paths it links |

## Verification

- Device: `adb reverse tcp:8765 tcp:8765` + `python -I -m http.server 8765 --bind 127.0.0.1` from `tests/fixtures/device-pages/`; pages opened in Nova with an intent, taps only while Nova was in front (focus guard) and no call active; screenshots cropped/enlarged with pngjs to read 16 px icons.
- The svg and paint-order causes (#8, #10) didn't reproduce in Node; temporary `diag4`/`diag5` console logs in a throwaway build read the composite order and overlay pixels on the tablet, then were removed (0 `diag` strings in source and bundle).
- New tests confirmed failing without their fix (#6 4 failures, #10 1 failure, grid text missing before #9, `<circle/>` nested before #11).

## Test Results

```
npx tsc --noEmit                      → clean
npx vitest run tests/switcher-details-158.test.ts → 8 passed
npx vitest run                        → Test Files 309 passed (309); Tests 10775 passed (10775)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.61.apk        → verified; aapt: versionCode 62, versionName 1.61
adb install -r Nova-1.61.apk          → Success (OPPO OPD2305)
```
