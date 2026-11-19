# Nova Android 1.12 — Paint Fidelity: Head-in-Body, Phantom Borders, Clipped Text

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 3. This round takes on the "painter artefacts" from the 1.9 device run ("Found, not fixed"): an outline drawn round most block boxes, first letters clipped at the left edge, and the `<h1>` missing on example.com.
**Status:** Completed (no phone attached; reproduced and verified in the built-in browser with the app's own rasterizer)

---

## Summary
- **How it was reproduced:** example.com was rendered at phone width (412 px) in the built-in browser through the same `PageRenderer` → `PaintEngine.rasterize()` path the app draws with. That made it possible to look at the pixels and the paint commands without a device.
- **What was found:** seven bugs across four layers (parser, UA stylesheet, cascade, layout). The worst was in the HTML parser: an ordinary newline after `<html>` put the whole `<head>` inside `<body>`, so every typical page painted its `<title>` and `<style>` text as content.
- **Result:** all seven are fixed and example.com now renders cleanly.
- **Version:** Nova **1.12** (versionCode 13).

## Root Causes
### 1. A newline after `<html>` moved `<head>` into `<body>` (HTML parser)
**File:** `src/browser/rendering/html5/modes/before-html.ts`
**Problem:** in "before html", the `<html>` start tag inserted the element, switched to "before head", and then **re-processed the same `<html>` token**. "Before head" treated it as "any other start tag": it opened an implied `<head>` that copied `<html>`'s attributes, such as `lang`, and switched to "in head". The next whitespace token ended the head (see 2), so the real `<head>` and its children landed in `<body>`. Without whitespace the tree happened to come out right, which is why minified pages looked fine.
```
<html>\n<head><title>T</title>…   →   html(head(), body(head(title), …))
```
**Fix:** per §13.2.6.2, switch the mode without reprocessing (one line deleted).

### 2. Whitespace in "in head" / "after head" fell through to "anything else"
**File:** `src/browser/rendering/html5/modes/head.ts`
**Problem:** "in head" had no `text` case, so an indented `<title>` popped the head. In "after head", the whitespace check was `break`, which fell through to "insert `<body>`". A second `</head>` popped the current node (`<html>`).
**Fix:**
- Whitespace is inserted as text in both modes (§13.2.6.4/6).
- After the head, only `</body>`, `</html>` and `</br>` act as "anything else"; other end tags are ignored.
- In `before-head.ts`, the implied `<head>` gets no attributes, a stray `<html>` uses the in-body rules, and end tags other than `head`/`body`/`html`/`br` are ignored.

### 3. Non-rendered elements had no `display: none` (UA stylesheet)
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** `head`, `title`, `style`, `script`, `meta`, `link`, `template`, `noscript` and the other elements from HTML §15.3.1 computed to `display: inline`. Anything that reached the body, through 1 or 2 or through a page's own markup, had its text painted.
**Fix:** `NON_RENDERED_ELEMENTS` set to `display: none` in `getUserAgentDefaults`.

### 4. A 3px `currentColor` frame round every box
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** `border-*-width` kept its initial value `medium` (3px) even with `border-style: none`. `used-style.ts` already zeroed it, but the painter and parts of layout read the raw computed map. That produced the black outlines on blocks, and the blue frame round links (`currentColor`).
**Fix:** at the end of `computeComputedStyles`, set `border-*-width: 0px` when that side's style is `none`/`hidden` (CSS Backgrounds §3.3). Every consumer now sees the same value.

### 5. Text drawn at x=0, clipping first letters
**Files:** `src/browser/rendering/formatting/inline-context.ts`, `layout-engine.ts`
**Problem:** `InlineFormattingContext` takes `startY`, so line y values are absolute, but it had no x origin, so line x values were relative to 0. `populateTextRuns` copied them as page coordinates. Every line of text therefore started at the page's left edge, not at its box's content edge.
**Fix:** an `originX` option, added in `addBox` and `pushTextSegment`. Both layout call sites pass `contentX`.
`ponytail:` an inline element's own children (`layoutInlineElement` → `layoutInlineChildren`) still start at the parent's `contentX` rather than at the element's x on its line. This is exact for line-start inlines; mid-line links can still be offset.

### 6. Inline boxes as tall as their distance from the top of the page
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `layoutInlineElement` did `box.height = max(lineHeight, layoutInlineChildren(…))`, but `layoutInlineChildren` returns the bottom **y**, not a height. The "More information…" link on example.com was 291 px tall (y 267 + 24).
**Fix:** `childBottom - contentY`.

### 7. Source indentation shown as wide gaps mid-sentence
**File:** `src/browser/rendering/formatting/inline-context.ts`
**Problem:** `addTextRun` never collapsed whitespace, so `"this\n    domain"` drew a five-space gap.
**Fix:** collapse runs of `[ \t\n\r\f]` to one space (`white-space: normal`). The new `preservesWhitespace()` helper in layout-engine passes `true` for `pre`/`pre-wrap`/`pre-line`/`break-spaces`. Collapsing runs after the existing whitespace-only check, so blank text nodes between blocks are still dropped, as before.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/html5/modes/before-html.ts` | no reprocess of `<html>` |
| `src/browser/rendering/html5/modes/before-head.ts` | attribute-less implied head; `<html>` → in-body rules; stray end tags ignored |
| `src/browser/rendering/html5/modes/head.ts` | whitespace inserted in in-head/after-head; after-head end tags per spec |
| `src/browser/rendering/css5/cascade.ts` | `NON_RENDERED_ELEMENTS` → `display: none`; border width 0 when style none/hidden |
| `src/browser/rendering/formatting/inline-context.ts` | `originX`; whitespace collapsing with `preserveWhitespace` |
| `src/browser/rendering/layout-engine.ts` | pass `originX: contentX`; inline height fix; `preservesWhitespace()` |
| `android/app/build.gradle` | 1.11 (12) → 1.12 (13) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/example-domain.html` | example.com-style page (a centred card with a `max-width: 700px` media query) used for the reproduction |
| `tests/html-tree-whitespace.test.ts` | 16 tests: 5 tree shapes, `<html>` attributes, stray `</head>`, 9 UA `display: none` |
| `tests/example-domain-render.test.ts` | 5 end-to-end paint tests at 412 px: no head text, text inside its box, no phantom borders, line-sized link, collapsed spaces |
| `doc/2026-10-18-nova-android-1.12-paint-fidelity.md` | This change log |

## Test Results
The render tests were confirmed to fail without the fixes: the source diff was saved, reverted, the tests run, and the diff re-applied.
```
without fixes: tests/example-domain-render.test.ts -> 5 failed (5)
               tests/html-tree-whitespace.test.ts  -> 14 failed | 2 passed (16)
with fixes:    both files                          -> 21 passed (21)
npx tsc --noEmit                                   -> exit 0
npx vitest run                                     -> 269 files, 10456 passed (10456)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.12.apk                     -> verified (1,519,352 B)
```

## Verification Steps
1. Started `nova-dev` (Vite) and imported the engine modules in the built-in browser. Rendered `example-domain.html?raw` with `setViewport(412, 800, 1)` and put `paintEngine.rasterize()` on a canvas. The raw import avoids Vite injecting its client script into a served `.html`.
2. **Before the fixes:** `<title>`/CSS text was painted, there were black frames on blocks, text sat at x=0 and a 291 px-tall blue link frame was drawn.
3. Located each cause from the DOM tree, the computed styles, `layoutBox`/`textRuns` and the paint commands. A mode-by-mode token trace (`open:html 0→3`) pinned down the parser bug.
4. **After the fixes:** a clean card and a 32 px text inset, matching `padding: 2em`. The only gap left between words is a single space.
5. **Not done:** no on-device check (`adb devices` was empty). The pixel path is the same code the app runs.

## Known ceilings
- Mid-line inline elements: their children start at the parent's content edge (the `ponytail` in Root Cause 5).
- `text-align` isn't implemented in the inline formatting context, so centred and right-aligned text draws left-aligned.
- The canvas below `<body>` stays white. The body background isn't propagated to the viewport (CSS Backgrounds §2.11.2).
- The UA default `box-sizing: border-box` differs from the spec's `content-box`. It's long-standing and was left as is.

## What's new in Nova 1.12 (user-facing)
- Pages no longer show their hidden page title and style code as text.
- No more black or blue boxes drawn round paragraphs and links.
- Text lines up inside its box instead of being cut off at the left edge.
- Indented source text no longer leaves wide gaps between words.
