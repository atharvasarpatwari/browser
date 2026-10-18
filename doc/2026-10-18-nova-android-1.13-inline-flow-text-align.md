# Nova Android 1.13 — Inline Flow, text-align and Canvas Background

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 4. This round fixes three of the "Known ceilings" listed in the 1.12 change log. The phone was reconnected this round, and 1.12 was installed on it once the user approved Realme's install check.
**Status:** Completed, then **superseded by 1.14**. 1.13 was installed on the phone and showed a black page on example.com: Root Cause 3's canvas propagation used a mis-split `light-dark()` colour. Fixed in `2026-10-18-nova-android-1.14-device-found-black-page-script-rawtext.md`.

---

## Summary
- **Inline elements:** links, `<b>`, `<em>` and `<span>` used to be full-width blocks. Every one took a line of its own, and its text was drawn over the first word of the paragraph. They now flow inside their sentence.
- **`text-align`:** `center`, `right` and `end` now work. They were ignored, so all text was drawn left-aligned.
- **Canvas background:** a short page now fills the rest of the screen with its own background, using the root's colour or else the body's, instead of white.
- **Version:** Nova **1.13** (versionCode 14).

## Root Causes
### 1. Every inline element was an atomic full-width box
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** in `layoutInlineElement`, an inline element's box was `availableWidth` wide and went into the parent's IFC as one atomic box. Its own text was laid out in a separate IFC starting at the parent's left edge. The probe below lays out `<p>Read <a>more</a> here and <b>bold</b> too.</p>` and shows the result: three lines, with "more" and "bold" drawn on top of "Read".
```
["Read",8,37] ["here",8,85] ["and",31,85] ["too",8,133] ["more",8,37] ["bold",8,37]
```
**Fix:** the new `flowInlineElement` lets a non-replaced inline element's text join the parent's line boxes. `addTextRun` takes an `owner`, stamped on each segment as `InlineLevelBox.owner`. Nested inline, inline-block, block-in-inline and positioned children use the same rules as in the parent loop.
`populateTextRuns` then:
- gives each run to its owner's `textRuns`, so the owner paints it in its own colour and weight, and after its own background;
- sizes each owner and its inline ancestors to the bounding box of their fragments, so a link's tap target is the link.

Replaced elements (`img`, `video`…) and empty inlines keep the atomic path. This also removes the 1.12 `ponytail` about mid-line inlines.
`ponytail:` an inline's own padding, margin and border don't take up room on the line yet.

### 2. `text-align` was not implemented
**File:** `src/browser/rendering/formatting/inline-context.ts`
**Problem:** `finalize()` only positioned lines vertically.
**Fix:** `finalize(textAlign)` shifts each line by its free space: half of it for `center`, all of it for `right`/`end`. Trailing whitespace hangs and doesn't count. Both layout call sites pass the block's computed `text-align`, which is inherited.
`ponytail:` `justify` and RTL `start`/`end` are treated as left-to-right `start`.

### 3. The canvas was always white
**File:** `src/browser/rendering/paint-engine.ts`
**Problem:** `compositeFrame()` and the background layer filled the canvas with `config.backgroundColor` (`#ffffff`). Below a short page with `body { background: #f0f0f2 }`, the screen was white.
**Fix:** `propagatedCanvasBackground(document)` follows CSS Backgrounds §2.11.2: the root element's background, else `<body>`'s. It uses the same `background` shorthand fallback as box painting and skips images and gradients. The result is computed in `paint()`/`paintIncremental()` and used for the canvas fill.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | `flowInlineElement`; `populateTextRuns` groups runs by owner and sizes owner boxes; `finalize(text-align)` at both call sites |
| `src/browser/rendering/formatting/inline-context.ts` | `owner` on text segments; `finalize(textAlign)` + `alignmentShift` |
| `src/browser/rendering/formatting/types.ts` | `InlineLevelBox.owner` |
| `src/browser/rendering/paint-engine.ts` | `propagatedCanvasBackground`, `isTransparent`; canvas fill uses it |
| `tests/example-domain-render.test.ts` | 9 tests: text-align ×4, canvas background ×3, inline flow ×2; `renderAtPhoneWidth(page)` takes a page |
| `android/app/build.gradle` | 1.12 (13) → 1.13 (14) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-18-nova-android-1.13-inline-flow-text-align.md` | This change log |

## Test Results
The 1.12 sources were checked out with the new tests in place: 7 of the new tests fail on them. The 2 left-alignment and white-default tests pass either way, as they should.
```
on 1.12 sources: tests/example-domain-render.test.ts -> 7 failed | 7 passed (14)
with the fixes:  tests/example-domain-render.test.ts -> 14 passed (14)
npx tsc --noEmit                                     -> exit 0
npx vitest run                                       -> 269 files, 10465 passed (10465)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.13.apk                       -> verified (1,519,352 B)
```

## Verification Steps
1. Probed the inline bug with a throwaway vitest file that printed the `fillText` commands (output above), then deleted it.
2. Wrote the tests and confirmed the failures listed above. Implemented, then re-ran the test file, the full suite and tsc.
3. Rendered a sample page through `PageRenderer` → `rasterize()` at 412 px in the built-in browser. The page had a centred header, links and `<b>`/`<em>` mid-sentence, a right-aligned note and a short body with a background. All rendered as intended.
4. **Phone (Realme RMX5264):**
   - The install of 1.12 waited on Realme's `InstallGuideActivity` security check. I left that for the user; once they approved it, 1.12 was confirmed installed and Nova was in the foreground.
   - The 1.13 install was started and waits on the same prompt.
   - The on-device feature checks (pull-to-refresh, reload, find, long-press) are still to do.

## Known ceilings
- Inline padding, margin and border aren't added to the line (`ponytail` in `flowInlineElement`).
- `justify` and RTL alignment are treated as `start`.
- Text decoration (link underlines) isn't painted.

## What's new in Nova 1.13 (user-facing)
- Links and bold or italic words stay inside their sentence instead of jumping onto their own line.
- Centred headings and right-aligned text show up where the page puts them.
- Short pages fill the whole screen with their own background colour.
