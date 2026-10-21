# Nova Android 1.23 — Form Controls (Round A) and Ten Engine Bugs Found on Wikipedia

**Date:** 2026-10-20
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 13. Implements Round A of [2026-10-19-nova-form-controls-plan.md](2026-10-19-nova-form-controls-plan.md) (approved: "Round A: paint + type + GET submit").
**Status:** Completed (device check of the last build pending, see Verification)

---

## Summary
Web page form controls now render, can be typed into, ticked and picked, and GET forms submit. Testing that against a real form (Wikipedia's Special:Search) turned up ten engine bugs that broke far more than forms:

- **Tokenizer:** character references in attribute values leaked into page text.
- **Tree builder:** `</span>`, `</label>` and similar end tags closed nothing, and `</form>` left later forms impossible.
- **Selector parser:** every selector of three or more parts lost everything after its second part.
- **Painter:** one `overflow:hidden` box clipped everything painted after it. Also `opacity:0` counted as fully opaque, and `visibility:hidden` was still painted.
- **Layout:** `display:table-cell` content was never laid out.

## Part 1 — Form controls (Round A)

### 1. Controls were invisible, zero-size boxes
**Files:** `src/browser/rendering/form-controls.ts` (new), `css5/cascade.ts`, `layout-engine.ts`, `paint-engine.ts`

**Problem:** An `<input>` had no UA style and no intrinsic size, and nothing painted its value.

**Fix:**
- `controlUaDefaults(tag, type)` is merged into `getUserAgentDefaults(tagName, inputType)`. Controls get `inline-block`, a 1px `#767676` border, a white background (`#efefef` for buttons) and 13.333px text; `type=hidden` gets `display:none`.
- `controlIntrinsicSize()` gives the default sizes:
  - text inputs are `size` (default 20) × 0.55em;
  - textareas are `cols` × `rows`;
  - checkboxes and radios are 11×11;
  - a select is as wide as its longest option + 20px;
  - an `<input>` button is as wide as its label.
- `paintControlContent()` draws:
  - the value, clipped to the box, or the placeholder in `#757575`;
  - password dots;
  - the checkbox tick and the radio dot;
  - the select's chosen option plus `▾`;
  - an input button's label, centred.

### 2. Nothing could be typed, ticked or submitted
**File:** `src/ui/pages/browser-window.ts`

**Problem:** The page is a bitmap; taps followed links only.

**Fix:** `activateAt()` now finds the control under the tap and acts on it:
- **Text fields and selects:** `openFieldEditor()` lays a real `<input>`/`<textarea>`/`<select>` exactly over the painted control, placed with `mapRect` in view coordinates. The platform keyboard, cursor, paste and autocorrect all work. Each `input` event writes the value back (`setControlValue`), repaints, and fires the page's `input` event. Enter submits, Escape reverts, and blur closes the editor and fires `change`.
- **Checkboxes and radios:** `toggleControl()` (radio groups included), then `input` and `change` events.
- **Submit buttons:** `submitForm()`:
  - fires `submit`, and honours `preventDefault()`;
  - checks `required`, opening the editor on the first missing field;
  - for GET, navigates to `action?` + `URLSearchParams(formDataEntries(form, submitter))`;
  - for POST, logs `[Forms] POST submission is not supported yet` (Round B).

### 3. Scripts couldn't read what was typed
**File:** `src/browser/js/dom-bindings.ts`

**Fix:** `value` and `checked` getters and setters (a setter marks paint dirty), and the `form` getter. `DomElement` gains `formValue` and `formChecked`. `PageRenderer.dispatchPageEvent` also invalidates the element's paint.

### 4. `</button>` closed nothing
**File:** `src/browser/rendering/html5/modes/body.ts`

**Problem:** `button`, `dl` and `pre` were missing from the end-tag block group, so everything after a `<button>` nested inside it.

**Fix:** Added them (§13.2.6.4.7).

### 5. Inline-block content drawn at the page's top-left
**File:** `src/browser/rendering/layout-engine.ts`

**Problem:** `layoutInlineBlockElement` laid out the children at the page origin and never moved them. It also added the box to the line before knowing its size.

**Fix:**
- Content is laid out at a local origin. After the line places the box, `placeInlineBlocks()` translates the subtree's boxes and text runs to it.
- Shrink-to-fit is two-pass: measure with `text-align` off, then lay out again at the measured width.

## Part 2 — Real-page bugs (Wikipedia Special:Search)

Before: the page rendered as `&&&` on the tablet. After the first fix it showed only the grey header bar.

### 6. Character references in attribute values became page text
**File:** `src/browser/rendering/html5-tokenizer.ts`

**Problem:** Every character-reference state appended to the text buffer. So in `href="/w/load.php?lang=en&amp;modules=…"` the URL lost its `&`, and a stray `&` text token followed the tag. In `<head>`, that text closed the head and opened `<body>`. Each later head element then reopened a body: the page had three `<body>` elements, and its content was in the third.

**Fix:** "Flush code points consumed as a character reference" (§13.2.5.72):
```ts
private refOut(s: string): void {
  if (this.inAttrValueRef()) this.attrValue += s;
  else this.charBuf += s;
}
```
Fixed alongside it:
- A named reference without `;` swallowed the next character; it is now reconsumed.
- The historical rule: inside an attribute, `&copy=2` and `&notit` stay literal.
- `resolveNamedRef` was folded into `handleNamedCharRef`.

### 7. Every `&#NNN;` also produced a `�`
**Problem:** On `;`, the decimal and hex reference states flushed the character but never returned to the previous state. The next character then flushed code 0, giving U+FFFD.

**Fix:** `this.state = this.charRefReturnState;` after the flush.

### 8. Three smaller tokenizer bugs
- **Stray attribute:** every tag carried an attribute named `""` (`commitAttr` ran even with no name).
- **Duplicate attributes:** a duplicate overwrote the first instead of being dropped.
- **Unquoted values:** an unquoted value starting with `&` took the `&` literally (it wasn't reconsumed).

### 9. `</span>`, `</label>`, `</em>`… closed nothing
**File:** `src/browser/rendering/html5/modes/body.ts`

**Problem:** `inBodyEndTag` had no "any other end tag" step; it ended in a bare `parseError`. So every end tag not listed explicitly was ignored, and each later sibling nested inside the element. Wikipedia's search field ended up inside an empty `<label>`. Tests only passed because the extra nesting rarely changed their assertions.

**Fix:** The §13.2.6.4.7 loop:
```ts
for (let i = ctx.openElements.length - 1; i >= 0; i--) {
  const node = ctx.openElements.elementAt(i);
  if (node.tagName === tag) {
    ctx.generateImpliedEndTags(tag);
    if (ctx.currentNode() !== node) ctx.parseError(token);
    while (ctx.openElements.length > i) ctx.popCurrentNode();
    return;
  }
  if (SPECIAL_ELEMENTS.has(node.tagName)) break;
}
```

### 10. `</form>` left the form pointer set, so later forms were dropped
**Problem:** `</form>` was handled like `</div>`, so the form element pointer stayed set. Every later `<form>` start tag was then ignored: Wikipedia's search `<form>` (after the header's search form) didn't exist.

**Fix:** A dedicated `case 'form'`:
- outside a template, it clears the pointer and removes the node from the stack;
- inside a template, it pops to the form.

### 11. Selectors of three or more parts dropped everything after the second
**File:** `src/browser/rendering/css5/parser.ts`

**Problem:** `consumeSelector()` read a compound, one combinator and one more compound, then returned. So `.a .b .c` parsed as `.a .b`, and so did every longer selector. That's massive over-matching: `.client-nojs .mw-footer .indicator {display:none}` hid Wikipedia's whole footer. `document.querySelector` used the same parser.

**Fix:** Loop, left-associatively: `left = { type: 'complex', left, combinator, right }`. A comma ends the selector.

### 12. One `overflow:hidden` box clipped everything painted after it
**Files:** `src/browser/rendering/paint-engine.ts`, `formatting/stacking.ts`

**Problem:** The overflow `clip` was pushed into the element's own commands and never restored. The rasterizer intersects clips cumulatively, so after Minerva's 1×48px `overflow:hidden` toggle every later draw was clipped away. That is why the tablet showed only the header bar. The same leak applied to:
- `setBorderRadius`, which rounded later boxes too;
- `setBlendMode`;
- borders, which were clipped by the element's own overflow.

**Fix:**
- Each element's commands are wrapped in `save … restore`, behind a clip from `clipFromAncestors(el)`. That clip combines:
  - the overflow padding box of each ancestor in the containing-block chain (absolute boxes escape non-positioned ancestors; fixed boxes escape all but transformed ones; html/body overflow belongs to the viewport);
  - `clip: rect(…)` on absolutely positioned boxes, the element's own included.
- The element's own overflow clips only its content (image, control and text), not its borders.
- A clip with no area means the element paints nothing, so the `clip: rect(1px,1px,1px,1px)` screen-reader pattern is hidden.

### 13. `visibility:hidden` was painted; `opacity:0` meant opaque
**Problem:**
- `visibility` was never checked.
- `parseFloat(opacity) || 1` turns `0` into `1`. Minerva's closed-menu mask (`opacity:0; visibility:hidden; background: rgba(0,0,0,.8)`, fixed, full screen) was painted over the page.

**Fix:**
- An element with `visibility: hidden` or `collapse` paints nothing itself; its descendants still paint if they're visible.
- `cssOpacity()` is clamped to [0, 1] and handles percentages.
- An `opacity:0` stacking group renders nothing.

### 14. `display:table-cell` content was never laid out
**File:** `src/browser/rendering/layout-engine.ts`

**Problem:** `classifyDisplay` maps every `table-*` display to `'table'`, so `layoutNode` sent a cell back through `layoutTableContainer`. That found no rows in it, so the cell's content was never laid out. Wikipedia's search field is an inline-block inside a `display:table-cell` div.

**Fix:** Cells and captions get `layoutBlockChildren`. Real tables and rows still use table layout.

> ponytail: consecutive orphan cells stack instead of sharing an anonymous row.

### 15. Shrink-to-fit squeezed a nowrap button to its border
**Problem:** The width was `min(available, content)`. In a `width:1%` (8px) cell, the button was 8px wide.

**Fix:** CSS 2.2 §10.3.9 gives `min(max(min-content, available), preferred)`. Content laid out at the available width already overflows to its min-content width, so the measured extent is the answer: `innerWidth = contentExtent(el) - childX`.

## Files Modified
| File | Change |
|------|--------|
| `android/app/build.gradle` | versionCode 24, versionName 1.23 |
| `src/browser/rendering/html5-tokenizer.ts` | Char refs into attribute values; numeric return state; reconsume; historical rule; no `""` attribute; first duplicate wins; unquoted `&` |
| `src/browser/rendering/html5/modes/body.ts` | "Any other end tag"; `</form>` clears the form pointer; `</button>`, `</dl>`, `</pre>` |
| `src/browser/rendering/css5/parser.ts` | `consumeSelector` loops over all compounds |
| `src/browser/rendering/paint-engine.ts` | Per-element save/restore with an ancestor clip; own overflow clips content only; `clip: rect()`; visibility; control content |
| `src/browser/rendering/formatting/stacking.ts` | `cssOpacity()`; `opacity:0` groups paint nothing |
| `src/browser/rendering/layout-engine.ts` | Inline-block rewrite (local origin, `placeInlineBlocks`, two-pass shrink-to-fit, min-content); table-cell content as a block; control intrinsic sizes |
| `src/browser/rendering/css5/cascade.ts` | Form-control UA defaults by tag and type |
| `src/browser/rendering/dom-tree.ts` | `formValue`, `formChecked` |
| `src/browser/js/dom-bindings.ts` | `value`/`checked`/`form` on controls |
| `src/browser/engine/page-renderer.ts` | `dispatchPageEvent` invalidates paint |
| `src/ui/pages/browser-window.ts` | Field editor overlay, checkbox/radio toggling, `submitForm` (GET) |
| `doc/2026-10-19-nova-form-controls-plan.md` | Status: Round A completed |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/rendering/form-controls.ts` | Control kinds, values, UA styles, intrinsic sizes, painting, form data, validation |
| `tests/form-controls.test.ts` | 10 tests: form data, required, kinds, painting, `</button>`, inline-block placement, typing/Enter submit, checkbox, `preventDefault`, script `value` |
| `tests/html-tokenizer-char-refs.test.ts` | 5 tests: char refs in attributes and text, the legacy rule, no empty or duplicate attributes, Wikipedia keeps one `<body>` |
| `tests/wikipedia-render.test.ts` | 7 tests: end tags, a second `<form>`, three-part selectors, overflow clip scoping, sr-only/visibility/opacity, table-cell and button width, the Wikipedia page with its own CSS |
| `tests/fixtures/wikipedia-search-2026/` | `index.html` plus its two stylesheets (`style1.css`, `style2.css`) as served on 2026-10-20 |

## Test Results
```
npx tsc --noEmit                      → exit 0
npx vitest run                        → Test Files 278 passed (278) · Tests 10550 passed (10550)
                                         (was 276 / 10538 at the end of 1.22; +22 new tests here)
./gradlew :app:testDebugUnitTest      → exit 0 (36 Kotlin tests)
apksigner verify Nova-1.23.apk        → verified (1,527,544 B, contains main-Cpawm7SN.js)
```

## Verification
- **Local render (PageRenderer, 1000px wide):** Wikipedia's Special:Search with its real stylesheets went through three stages:

  | Stage | Painted text |
  |-------|--------------|
  | Before | `&&&` |
  | After fix 6 | only the heading "Search" |
  | Now | heading "Search"; the search field (802×60); the "Search" button (57px); the footer links in one row ("Privacy policy · Contact Wikipedia · Legal & safety contacts · Code of Conduct · Developers · Statistics · Cookie statement · Terms of Use · Desktop view") |

  The "User menu" and "Create account" screen-reader labels are no longer drawn at 0,0.
- **Tablet (OPD2305, Android 14):**
  - The first 1.23 build installed with "Success", and the page showed `&&&`.
  - After the tokenizer fix the page showed only the header bar (diagnosed above as fix 12).
  - The final build installed with "Success", but the tablet went to sleep (locked, notification shade focused). Per the standing rule I didn't wake or unlock it, so on-device typing and submitting is still to do.

## Known Remaining
- Minerva's user menu is placed ~400px above its parent: an absolute/relative offset bug.
- The inline script's `document.documentElement.className = …` has no effect; the page stays `client-nojs`.
- Orphan table cells stack (no anonymous table row).
- POST forms, `form.submit()`/`reset()` and a select option sheet are Round B.
