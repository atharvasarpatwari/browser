# Nova Android 1.14 — Device-Found Black Page, Script Raw Text, Block Widths

**Date:** 2026-10-18
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 4 (continued). 1.13 was installed on the user's Realme RMX5264. Opening example.com on the phone showed a **black page**. Tracing it led to that regression and five older bugs, all fixed here.
**Status:** Completed (1.14 install to the phone pending the user's unlock + approval of Realme's install check)

---

## Summary
- **The black page:** today's example.com sets `html{background:light-dark(#eee,#222)}`. The `background` shorthand was split on commas inside parentheses, giving `background-color: "#222)"`. 1.13 started using the root background for the canvas, and the rasterizer draws any colour it can't parse as black.
- **Fixes in the same chain:**
  - shorthands are split only outside parentheses;
  - `light-dark()` resolves to its light value;
  - `hsl()`/`hsla()` are parsed;
  - the canvas only takes a colour the rasterizer understands.
- **Found on the way:**
  - The HTML tokenizer never entered `<script>`/`<style>`/`<title>`/`<textarea>` raw-text states. An inline script containing `a<b` swallowed **the rest of the page**.
  - Inline `style=""` shorthands were never expanded.
  - Block layout had no `max-width`/`min-width` and no `margin: auto` centring, and a `width: auto` box ignored its own margins.
  - `navigator.languages` was missing.
  - Interpreter errors now name the property (`(reading 'lang')`).
- **Version:** Nova **1.14** (versionCode 15).

## Root Causes
### 1. Black screen: `light-dark()` split into `"#222)"` (regression in 1.13)
**Files:** `css5/cascade.ts`, `css5/computed-value-resolver.ts`, `rasterizer.ts`, `paint-engine.ts`
**Problem:** `expandBackgroundShorthand` tokenised with `split(/[\s,]+/)`, so `light-dark(#eee,#222)` became `light-dark(#eee` and `#222)`. The last fragment became `background-color`. 1.13's canvas propagation passed `"#222)"` to the rasterizer, and `parseColor` returns `BLACK` for anything it doesn't know.
Found on the device in logcat, then reproduced with the real page saved as `tests/fixtures/example-com-2026/`:
```
canvas: setFillStyle "#222)"   htmlBg: background-color "#222)"
```
**Fix:**
- `splitTopLevel()` splits on whitespace and commas outside parentheses. It's used for `background`, and `splitTokenList` (margin, padding, border, border-radius, border-color) now uses it too. The same bug turned `border: 1px solid rgb(1, 2, 3)`'s width into `"3)"`, and `linear-gradient(to right, …)` into fragments.
- `resolveLightDark()` replaces `light-dark(a, b)` with `a` for every property. `ponytail:` there's no dark page scheme yet.
- `parseColor` handles `hsl()`/`hsla()` (comma and space syntax, `deg`, `/ alpha`); before, they were drawn black.
- `propagatedCanvasBackground` only uses colours that pass `isParsableColor`, and otherwise falls back to white. No unknown colour format can black out the screen again.

### 2. `<script>` contents tokenized as markup (pre-existing)
**File:** `src/browser/rendering/html5-tokenizer.ts`
**Problem:** `emitTag()` called `setupRawTextMode(tag)`, which sets `SCRIPT_DATA`, `RAWTEXT` or `RCDATA`, and then ran `this.state = S.DATA`, undoing it. None of the raw-text states had ever run:
- `if (a<b) x();` opened a tag named `b)` that consumed the rest of the document;
- HTML inside a JS string became real elements;
- `<title>a<b>c</title>` and `textarea` contents were parsed as markup.

`<style>` only looked right because CSS rarely contains `<`.
**Fix:** reset to `DATA` first, then call `setupRawTextMode`.

### 3. Inline `style=""` shorthands never expanded (pre-existing)
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** stylesheet declarations go through `expandShorthands`, but inline declarations were written to the computed map as they were. So `style="margin: 0 auto; padding: 8px; border: …; background: …"` set only the shorthand keys, which layout and paint mostly don't read.
**Fix:** `expandShorthands(inlineDecls…)`, keeping the important/normal ordering.

### 4. Block widths: no max/min-width, no auto margins, margins ignored by `width: auto` (pre-existing)
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:**
- `width: auto` gave `borderWidthBox = availableWidth`, ignoring margins, so `margin: 0 20px` overflowed by 20px;
- `max-width`/`min-width` were never read;
- `margin: auto` resolved to 0.

So the most common container, `max-width: 600px; margin: 0 auto`, rendered full width and flush left.
**Fix (CSS 2.2 §10.3.3, §10.4):**
- auto margins count as 0 while the width is worked out;
- `width: auto` fills the available width minus the fixed margins;
- `max-width`, then `min-width`, are applied, box-sizing aware;
- auto margins share the free space: both auto centres the box, left-only pushes it right.

`box.marginLeft` records the used value.

### 5. `navigator.languages` missing (pre-existing)
**File:** `src/browser/js/index.ts`
**Problem:** example.com's `s.js` (and many sites) picks a translation with `navigator.languages.some(…)`, which threw on `undefined`.
**Fix:** `['en-US', 'en']`, next to the existing `navigator.language`.

### 6. Interpreter errors didn't say what was missing
**File:** `src/browser/js/interpreter.ts`
**Problem:** the logcat showed only `Cannot read properties of undefined`.
**Fix:** it now says `… (reading 'lang')`, like V8 and Nova's own `vm.ts`. That message is what showed that `element.querySelectorAll` doesn't exist (see Not fixed).

## Not fixed (next round)
Nova's element bindings (`wrapElement` in `js/dom-bindings.ts`) are missing:
- `querySelector`/`querySelectorAll`; only `document.*` has them, and `[...undefined]` yields `[undefined]`, a separate interpreter bug;
- `insertAdjacentHTML`, which is a silent no-op;
- `append`, `prepend`, `remove`, `closest`;
- an `innerHTML` setter;
- reflected properties such as `lang` and `dir`.

example.com's `s.js` uses several of these, so it still stops early. The English paragraph renders, but the translations and the "Learn more" link aren't added. That's the next round, with a plan first since it's a sizeable bindings change.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/html5-tokenizer.ts` | raw-text state no longer reset after it's set |
| `src/browser/rendering/css5/cascade.ts` | `splitTopLevel` (and `splitTokenList` on it); inline shorthands expanded; `conic-` gradients recognised |
| `src/browser/rendering/css5/computed-value-resolver.ts` | `resolveLightDark` |
| `src/browser/rendering/rasterizer.ts` | `hsl()`/`hsla()` in `parseColor`; `isParsableColor` |
| `src/browser/rendering/paint-engine.ts` | canvas colour must be parsable |
| `src/browser/rendering/layout-engine.ts` | auto margins, max/min-width, `width: auto` minus margins |
| `src/browser/js/index.ts` | `navigator.languages` |
| `src/browser/js/interpreter.ts` | `(reading '<name>')` in both member-access errors |
| `tests/example-domain-render.test.ts` | 11 tests: real 2026 example.com canvas, shorthand functional values, hsl ×1 (3 asserts), inline shorthands, block widths ×5 |
| `tests/html-tree-whitespace.test.ts` | 3 raw-text tests |
| `tests/css5-computed-styles-pipeline.test.ts` | the `var()`+`calc()` test now expects `15px`; it used to "contain calc" only because of bug 1's split |
| `android/app/build.gradle` | 1.13 (14) → 1.14 (15) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/example-com-2026/index.html`, `s.js` | example.com as served on 2026-10-18 (the page that went black) |
| `doc/2026-10-18-nova-android-1.14-device-found-black-page-script-rawtext.md` | This change log |

## Test Results
Every new test was confirmed to fail first. The raw-text tests were checked by reverting only the tokenizer: 3 failed, then passed with it restored. The real-page canvas, shorthand and hsl tests failed before their fixes. The block-width and inline-shorthand tests were written with their fixes.
```
npx tsc --noEmit                                    -> exit 0
npx vitest run                                      -> 269 files, 10477 passed (10477)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.14.apk                      -> verified (1,519,352 B)
```

## Verification Steps
1. **On the phone with 1.13:**
   - Nova opened through `am start`, with every input guarded so taps only reach Nova when it's focused and unlocked.
   - Typed `example.com`: the page area was black (screenshot), while the bar showed the load had finished.
   - logcat showed `fetch#2 … /s.js` and `[ScriptEngine] Error executing blocking script: Cannot read properties of undefined`.
2. **Locally:** saved the live page and script as fixtures, then reproduced through `PageRenderer` and a probe file. The probe showed `"#222)"` and the script error; step-by-step `runJS` probes found the missing APIs. Probe files were deleted afterwards.
3. While probing, found that inline `<script>` text was being parsed as markup. Traced it to the `emitTag` state reset.
4. Fixed, tested and built 1.14. The install has started on the phone and waits for the user to unlock and approve.

## What's new in Nova 1.14 (user-facing)
- No more black screen on modern sites that use automatic light/dark page colours.
- Pages with inline scripts no longer lose everything after the script.
- Centred, width-limited layouts (`max-width` + `margin: auto`) now show centred and at the right width.
- Inline-styled spacing, borders and backgrounds now apply.
- Colours written as `hsl(…)` show correctly instead of black.
