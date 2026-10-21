# Nova Android 1.24 — Wikipedia Search Works End to End (Paint Order, Flex Basis, Floats, Hit Testing)

**Date:** 2026-10-20
**Session:** "keep improving the nova app…", round 13 (continued after the tablet was unlocked: "its unlocked now").
**Status:** Completed. Verified on the OPD2305 tablet.

---

## Summary
The device test of 1.23 confirmed that typing and Enter-to-submit work. It also found seven more general engine bugs between "the search form works" and "you can search Wikipedia and read the results":

1. The Search button's label was hidden under its own background.
2. Tapping the button followed an invisible "Log in" link, and after that fix it hit the footer instead.
3. Floats never reached `clear`.
4. `overflow: hidden` never reached its longhands.
5. Flex items with an `auto` basis were 0px wide, so the results ran 23,000px tall.
6. A block-level `<select>` listed its options as text.

All fixed. On the tablet, typing "web browser" and tapping **Search** (or pressing Enter) now shows Wikipedia's results page with every result's title, snippet and size/date line.

## Root Causes

### 1. A positioned button painted its own label underneath it
**File:** `src/browser/rendering/formatting/stacking.ts`

**Problem:** A `position: relative` box with `z-index: auto` sat on the parent's layer 5. Its non-positioned descendants were spread across the parent's layers 2–4, which paint *before* layer 5. So Wikipedia's blue `<button style="position:relative">` drew its background over its own "Search" label.

**Fix:** CSS 2.1 Appendix E step 8: such a box paints "as if it created a new stacking context". It becomes a **pseudo context**: a child context with `zIndex: 0` and `pseudo: true`, placed in DOM order with the other z=0 contexts.
- Its own commands come from the paint callback at render time, not the externally synced `bgCommands`. That sync is skipped for cached elements by `paintIncremental`.
- Child contexts with a non-zero z-index are hoisted to the real parent context, so a `z-index: 5` dropdown still stacks above later siblings.

```ts
} else if (isPositionedElement(childStyle)) {
  const pseudo = createContext(childEl, false, options);
  pseudo.pseudo = true; pseudo.zIndex = 0;
  const hoisted = pseudo.children.filter((c) => c.zIndex !== 0);
  pseudo.children.splice(0, pseudo.children.length, ...pseudo.children.filter((c) => c.zIndex === 0));
  ctx.children.push(pseudo, ...hoisted);
}
// render: commands.push(...(ctx.pseudo ? paintElement(ctx.element) : ctx.bgCommands));
```

### 2. Taps hit invisible things
**Files:** `src/browser/rendering/layout-engine.ts`, `src/browser/rendering/clip.ts` (new)

**Problem:** `getElementAtPoint` returned the last box laid out under the point, whatever it was. Minerva's closed user menu (`visibility: hidden`) is laid out over the page, so tapping **Search** opened `Special:UserLogin`. On the device I only went back; nothing was entered on that page.

**Fix:** `isHitTestable()` skips:
- `visibility: hidden` and `collapse`;
- `pointer-events: none`;
- points outside `clipFromAncestors(el)`, the same clip the painter uses.

The clip helpers moved from `paint-engine.ts` into `clip.ts` so layout can use them without a circular import.

### 3. Floats never reached later siblings, so `clear` saw nothing
**Files:** `src/browser/rendering/layout-engine.ts`, `formatting/float-context.ts`

**Problem:** Every `layoutBlockChildren` call started a fresh `FloatContext`. So a float inside a nested block was invisible to that block's later siblings. In Wikipedia's markup, `.mw-search-visualclear { clear: both }` didn't clear the floated search box. The form collapsed, the footer was laid out over the button, and taps on the lower part of the button went to the footer.

**Fix:**
- Only a block formatting context root (`establishesBfc()`, CSS 2.2 §9.4.1) starts empty. That covers the root, `flow-root`, `inline-block`, table cells and captions, flex/grid containers and their items, floats, absolute/fixed boxes, and `overflow` other than `visible`/`clip`.
- Any other block starts with its parent context's floats. When it finishes, it hands its own floats back (`takeFloatsFrom`); floats are kept in page coordinates, so they carry over unchanged.
- A BFC root grows to contain its floats (§10.6.7). That makes the `overflow:hidden` clearfix work.

### 4. `overflow: hidden` never reached `overflow-x`/`overflow-y`
**File:** `src/browser/rendering/css5/cascade.ts`

**Problem:** `expandShorthands` had no `overflow` case, so the longhands kept their initial `visible`. Everything that reads `overflow-x ?? overflow` saw `visible`. That included 1.23's clip scoping, BFC detection and hit testing.

**Fix:** Expand `overflow: <x> [<y>]` into both longhands, and keep the shorthand.

### 5. A flex item with an `auto` basis was 0px wide
**File:** `src/browser/rendering/layout-engine.ts`

**Problem:** With `flex-basis: auto` and `width: auto`, `item.flexBasis` stayed 0, and nothing grows it unless `flex-grow > 0`. Each search result's text column was 0px wide, one word per line, and the 20 results ran about 23,000px down the page.

**Fix:** CSS Flexbox §9.2.3.E: the base size is the max-content size. `measureContentWidth()` lays the item's content out in a scratch box and rolls it back. The rollback lives in a shared `measureLayout()` that resets:
- `elementPositions`;
- `pendingInlineBlocks`;
- `positionedQueue` (new: the 1.23 inline-block shrink-to-fit forgot it, so absolute descendants were queued twice);
- text runs.

`flex: 1` (basis 0%) is unaffected; only `auto`/`none`/`initial` bases are measured.

### 6. A block-level `<select>` listed every option as page text
**Problem:** Only the inline-block path skipped a control's children. Wikipedia's `.cdx-select` made it block-level, so "20 items50 items100 items…" appeared as page text.

**Fix:** `layoutNode` skips child layout for `skipsChildLayout()` elements, and the intrinsic height applies.

### 7. Literal backspace bytes in my own regex edit
A Python edit wrote `\b` as byte 0x08 into the `autoBasis` regex. I caught it on review, rewrote it as `\b`, and scanned all `src/**/*.ts` and `tests/*.ts` for control bytes (none left).

## Files Modified
| File | Change |
|------|--------|
| `android/app/build.gradle` | versionCode 25, versionName 1.24 |
| `src/browser/rendering/formatting/stacking.ts` | Pseudo stacking contexts for positioned z-index:auto boxes; hoisting of z-indexed descendants |
| `src/browser/rendering/formatting/float-context.ts` | `takeFloatsFrom()` |
| `src/browser/rendering/layout-engine.ts` | `establishesBfc`, float sharing, BFC float containment; `measureContentWidth`/`measureLayout`; flex auto basis; `isHitTestable`; control children skipped in block layout |
| `src/browser/rendering/css5/cascade.ts` | `overflow` shorthand expansion |
| `src/browser/rendering/paint-engine.ts` | Clip helpers imported from `clip.ts` |
| `tests/wikipedia-render.test.ts` | 7 more tests (14 total) |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/clip.ts` | `ClipBox`, `EMPTY_CLIP`, `overflowClipRect`, `clipFromAncestors` (shared by paint and hit testing) |
| `tests/fixtures/wikipedia-results-2026/` | The results page for "web browser", its stylesheet (`style1.css`, 468 KB, as served) and `style2.css` |

## Test Results
```
npx tsc --noEmit                      → exit 0
npx vitest run                        → Test Files 278 passed (278) · Tests 10557 passed (10557)
                                         (10550 after 1.23; +7: hit testing, paint order ×2, floats/BFC,
                                          flex auto basis, block-level select, results page)
./gradlew :app:testDebugUnitTest      → exit 0
apksigner verify Nova-1.24.apk        → verified (main-*.js bundle checked inside the APK)
```

## Verification (OPD2305 tablet, Android 14, `versionName=1.24`)
| Step | Result |
|------|--------|
| Open `en.wikipedia.org/wiki/Special:Search` | Heading, 802px search field, blue **Search** button *with its label*, footer links in a row |
| Tap the field | A real text box with a cursor opens over it; the keyboard shows a search key |
| `input text "web browser"` | Shown in the field |
| Enter | GET `/w/index.php?search=web+browser&title=Special%3ASearch&profile=default&fulltext=1`: all four fields, including the three hidden inputs |
| Tap **Search** (1.24 before fix 2) | Opened `Special:UserLogin`. Went back with Nova's back button; nothing typed there |
| Tap **Search** (final build) | GET `…search=Web+browser…` |
| Results page (allow ~15 s; see below) | "Search results", "1 – 20 of 15,324", the query kept in the box, "Web browser", "Chromium (web browser)", "Brave (web browser)" with snippets (matches in bold) and size/date lines |

## Known Remaining
- **Slow:** the results page takes ~15 s on the tablet. The 468 KB stylesheet is parsed and cascaded on the main thread. This needs a profile and a plan (cascade rule indexing) before changing anything.
- The sister-project sidebar ("Texts from Wikibooks", Wiktionary) stacks its boxes on one spot. These are orphan table cells, or absolute boxes at a shared static position.
- The block-level `<select>` now shows as a short empty box: its chosen option isn't painted at that size.
- The footer's Wikimedia/MediaWiki logos stopped showing once `overflow` really clips: `footer img` has no layout box.
- The button still overhangs the footer by ~25px. A tap there goes to the footer, because hit testing doesn't yet follow paint order (positioned boxes above in-flow ones).
- From 1.23: the user menu is placed ~400px up; the inline `className` script has no effect; POST forms are Round B.
