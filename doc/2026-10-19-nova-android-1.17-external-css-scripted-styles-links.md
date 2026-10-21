# Nova Android 1.17 — External Stylesheets Loaded, Script-Added Styles, Link Colour & Underlines

**Date:** 2026-10-19
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 7. This round follows the "Known ceilings" in the 1.16 log. Probing example.com's translations, which ignored `p+p { font-size: .875em; opacity: .6 }`, led to a much bigger gap: **`<link rel=stylesheet>` sheets were never fetched.**
**Status:** Completed (the 1.17 install to the phone is queued and waits for the user to unlock and approve)

---

## Summary
- **External CSS:** `<link rel=stylesheet>` sheets are now fetched and applied. Before, they were recorded as placeholders that nothing loaded, so most real sites, which keep their CSS in files, rendered unstyled on Android.
- **Script-added styles:** `<style>` elements that scripts add or edit now apply.
- **Links:** they're painted link-blue (`#0000ee`) instead of black, and underlined. `text-decoration` (underline, line-through) is now painted at all.
- **Opacity:** checked, and it already worked for text through `setGlobalAlpha`. A regression test was added.
- **Version:** Nova **1.17** (versionCode 18).

## Root Causes
### 1. External stylesheets never loaded
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** `CssParser.extractStylesFromDocument` records each `<link rel=stylesheet>` as a `{ selector: '__external__', sourceUrl: href }` placeholder. `buildCss5Stylesheet` and the legacy cascade both `continue` past it, and no code fetched the URL.
**Fix:** `loadExternalStylesheets(rules, baseUrl, signal)` runs before the first style pass:
- for each placeholder, resolves `href` against the page;
- checks `securityLayer.checkSubresource(page, url, 'style')`;
- fetches through `resourceLoader.loadStylesheet` (cached and cookie-aware, like other subresources);
- parses with the sheet URL and splices the rules in at the link's position, marked `source: 'external'`.

All sheets load in parallel and block rendering, as in browsers. A sheet that fails to load is logged and skipped.
`ponytail:` `@import`, the link's `media` attribute and CSP `style-src` aren't applied yet.

### 2. Styles added by scripts ignored
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** after page scripts ran, the renderer re-applied the rules extracted from the *pre-script* HTML. example.com's `s.js` inserts `<style>svg{…}p+p{font-size:.875em;opacity:.6}</style>`, which was never seen.
**Fix:** `rulesFromDomStyles()` re-reads every `<style>` element in the live DOM after scripts and keeps the external-sheet rules ahead of them. `_lastRules` is updated, so later incremental restyles use them too.

### 3. Links drawn black
**File:** `src/browser/rendering/css5/computed-value-resolver.ts`
**Problem:** the UA sets `a { color: -webkit-link }`. Nothing resolved that keyword, and the rasterizer's `parseColor` draws anything unknown as black.
**Fix:** `-webkit-link`/`linktext` → `#0000ee`, `visitedtext`/`-webkit-visited-link` → `#551a8b`.

### 4. `text-decoration` never painted
**Files:** `layout-engine.ts`, `paint-engine.ts`, `dom-tree.ts`
**Problem:** the painter had no decoration drawing, so links had no underline.
**Fix:**
- `textDecorationFor(owner, block)` walks from a run's owner up to its block, because decorations propagate to descendants' text (CSS Text Decoration §2). It reads `text-decoration-line`, or the shorthand, and `text-decoration-color`, falling back to the decorating element's colour.
- `TextRun.decoration` carries the result.
- The painter draws a `fillRect` under the baseline (underline) or through the x-height (line-through), `max(1, fontSize/16)` px thick, across the run's width. Whitespace runs are skipped.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `loadExternalStylesheets`; `rulesFromDomStyles` after scripts |
| `src/browser/rendering/css5/computed-value-resolver.ts` | link colour keywords |
| `src/browser/rendering/layout-engine.ts` | `textDecorationFor`; runs carry `decoration` |
| `src/browser/rendering/paint-engine.ts` | underline / line-through rects |
| `src/browser/rendering/dom-tree.ts` | `TextRun.decoration` |
| `tests/example-domain-render.test.ts` | `renderAtPhoneWidth(page, script, sheets)`; 6 tests: script-added `<style>`, link blue, underline geometry (plain text not underlined), opacity, external sheet fetched and applied, cascade order with a later `<style>` surviving scripts |
| `android/app/build.gradle` | 1.16 (17) → 1.17 (18) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-19-nova-android-1.17-external-css-scripted-styles-links.md` | This change log |

## Test Results
Checked against the old code by reverting files:
- **Link colour and underline:** reverting the 5 source files made the script-style, link-blue and underline tests fail (3).
- **Stylesheets:** reverting only `page-renderer.ts` made the script-style test and both external-sheet tests fail (3).
- **Opacity:** that test passes on both versions; it guards existing behaviour.

```
npx tsc --noEmit        -> exit 0
npx vitest run          -> 271 files, 10500 passed (10500)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.17.apk -> verified (1,523,448 B)
```

## Verification Steps
1. Probed the 2026 example.com after its script ran. Every `<p>` had `font-size: 16px; opacity: 1` (the script's `<style>` was ignored), and `a` had `color: -webkit-link`. There were no decoration commands among the paint commands.
2. While tracing where stylesheets come from, found that `__external__` placeholders are only ever skipped.
3. Wrote the tests, confirmed the failures listed above, fixed, then re-ran the file, the full suite and tsc.
4. Built 1.17. The install to the phone is queued (phone locked).

## Known ceilings
- `@import` in sheets, `<link media=…>`, and CSP `style-src` for sheets.
- Text is still rastered at CSS-pixel resolution, so it's soft on high-density screens. Rendering at `devicePixelRatio` means scaling about 25 rasterizer ops and the display path, and it rasters about 6× the pixels in software at 2.5×. It needs its own plan and a speed check before going ahead.

## What's new in Nova 1.17 (user-facing)
- Sites now load their style sheets: real layouts, colours and fonts instead of plain unstyled text on most sites.
- Styles that sites add with JavaScript now apply.
- Links are blue and underlined, as they should be.
