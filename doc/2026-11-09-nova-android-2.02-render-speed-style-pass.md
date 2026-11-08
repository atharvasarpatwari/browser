# Nova Android 2.02: Pages Render Up to 3x Faster: No Second Full Restyle, No Custom-Property Copies, No Placeholder Images

**Date:** 2026-11-09
**Session:** "keep improving the nova app and update analytics.html"
**Status:** Completed. Measured offline on CNN's real page. The tablet timing run could not be done: the OnePlus Pad was asleep and locked.

---

## Summary
Heavy pages are very slow on the tablets: on the OnePlus Pad, CNN on 2.01 had not rendered after more than 6 minutes. The screen may have turned off during that run (see Test Results), so that number is not a clean baseline. A CPU profile of CNN's real page (5.8 MB of HTML, ~5,200 elements, 1,782 custom properties), rendered offline, found five costs. All are fixed.

| CNN render offline (desktop CPU) | Before | After |
|---|---|---|
| Scripts removed | 63.3 s | 19–22 s |
| With its scripts | 47.7 s (scripts change the DOM, so restyles dominate) | 42.6 s |

Two layout and CSS bugs were found on the way:
- after a full layout, generated boxes stayed layout-dirty (#5);
- CSS-wide keywords on custom properties were substituted literally (#6).

## Root Causes

### 1. The first frame after any load restyled the whole page again
**File:** `src/browser/engine/page-renderer.ts` (`applyComputedStyles`)
**Problem:** half of CNN's render (~26 of 63 s) was a second restyle of all 4,097 elements, through the slow per-element path, in the first frame after the page painted (triggered by an image decoding).
**Root cause:** `DomTree.buildFromHtml` creates every node with `_dirtyStyle: true`, and the full style pass never cleared the flag. The first `processFrame` found the whole tree style-dirty.
**Fix:** the full pass clears the style flag over the tree (`clearSubtreeDirty(n, 'style')`). The first frame now restyles 0 elements.

### 2. Every element copied all inherited custom properties three times
**Files:** `src/browser/rendering/css5/cascade.ts`, `src/browser/rendering/dom-tree.ts`
**Problem:** with 1,782 custom properties inherited into every element's style, `computeComputedStyles` spent 10 s of its own time on CNN with scripts. Per-section timing showed two copies of the inherited custom properties (6.4 s + 5.7 s).
**Root cause:** each element:
- copied its parent's custom properties into a map for `var()`;
- added them one by one to its computed style;
- rescanned the whole computed style to collect them again.

`setComputedStyle` then copied the whole map a fourth time, which also defeated any cache keyed on it.

**Fix:**
- `CustomPropScope` holds an element's own custom declarations over its parent's, read through `get` (all `var()` resolution needs), with no copy. `toMap()` flattens once per parent and is shared by its children.
- A per-computed-style cache (`customPropsOf`) replaces the rescans.
- The computed style is seeded from the parent's flattened map (one native copy).
- `setComputedStyle` keeps the map it's given. The style pass builds a fresh map per element and doesn't change it afterwards.

### 3. Every custom property went through value resolution
**File:** `src/browser/rendering/css5/computed-value-resolver.ts`
**Problem:** about 9 million `resolveComputedValue` calls per CNN render returned custom properties unchanged.
**Fix:** `resolveAllComputedValues` skips `--*` properties.

### 4. Every image got a full-size checkerboard drawn in JavaScript
**File:** `src/browser/rendering/lazy-loader.ts`
**Problem:** 1.4 s per CNN render.
- The colored checkerboard was also left on screen for every image that failed: the green and orange checkered bars on LinkedIn.
- Failures fired `load` instead of `error`.

**Root cause:** `loadImage` filled a width×height pixel placeholder before fetching, and kept it on failure.
**Fix:**
- With a resource loader, nothing is drawn until the image decodes.
- A failure clears the image data and emits `error`, like other browsers.
- The placeholder remains only for loader-less use (tests).

### 5. Generated boxes stayed layout-dirty after a full layout
**File:** `src/browser/rendering/layout-engine.ts` (`clearLayoutDirty`)
**Problem:** with #1 fixed, `details-pseudo-js-164` failed: a summary's ▸ was at x=0 after the first frame. This is the 1.64 bug.
**Root cause:**
- The full layout's own flag-clearing walk followed `children`, which never includes `::before`/`::after` boxes. It is the same mistake 1.64 fixed in `clearSubtreeDirty`, missed in this second walk.
- So every generated box stayed layout-dirty after a full layout and was relaid alone at its parent's origin on the next frame.
- #1's needless full restyle had rebuilt those boxes and hidden this.

**Fix:** the walk uses `domTree.clearSubtreeDirty(root, 'layout')`, which includes generated boxes. Standalone layout (no tree) keeps the old walk.

### 6. `--x: initial` was substituted as the word `initial`
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** `--w: initial; width: var(--w, 7px)` gave `width: auto`. Found by this round's test; the bug was pre-existing.
**Fix:**
- A CSS-wide keyword on a custom property now follows CSS Variables §2.2:
  - `initial` makes it invalid, so `var()` takes its fallback;
  - `inherit`, `unset` and `revert` keep the parent's value.
- The computed style still stores the keyword as written (existing tests rely on that).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | clear style flags after the full pass (#1) |
| `src/browser/rendering/css5/cascade.ts` | `CustomPropScope`, `customPropsOf` cache, seeded computed style (#2); CSS-wide keywords on custom properties (#6) |
| `src/browser/rendering/dom-tree.ts` | `setComputedStyle` keeps the map (#2) |
| `src/browser/rendering/css5/computed-value-resolver.ts` | skip custom properties (#3) |
| `src/browser/rendering/lazy-loader.ts` | no placeholder with a loader; failures emit `error` (#4) |
| `src/browser/rendering/layout-engine.ts` | `clearLayoutDirty` includes generated boxes (#5) |
| `android/app/build.gradle` | 2.01 (102) → 2.02 (103) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/render-speed-202.test.ts` | no element left style-dirty (#1); custom-property inheritance, override and `--x: initial` fallback (#2, #6); failed image reports error (#4) |

## Test Results
```
Offline CNN render (tests/zz-perf probe, kept out of the repo; page saved in %TEMP%, 5.8 MB):
  2.01, scripts removed:  63.3 s (incl. ~26 s second restyle of 4,097 elements)
  #1 fixed:               23.8 s
  #3 + per-parent cache:  21.5 s
  #4 fixed:               19.4 s
  #2 overlay, #5, #6:     19-22 s (render() itself 17.1 s; style pass 10.7 s from 12.9 s)
  with CNN's scripts:     47.7 s → 42.6 s (computeComputedStyles self time 10.0 s → 5.4 s)
npx vitest run tests/render-speed-202.test.ts → 3 passed (the custom-property test also found #6)
npx vitest run tests/details-pseudo-js-164.test.ts → failed after #1 (marker at x=0), passed after #5
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors
npx vitest run                     → Test Files 338 passed (338); Tests 11461 passed (11461)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.02.apk     → verified; versionCode 103, versionName 2.02
Bundle check: built after the last source change; contains the new custom-property code
OnePlus Pad Go: 2.02 installed (Success). CNN timing run: no render line in 8 min, screenshot black;
  dumpsys power: mWakefulness=Asleep, keyguard showing → the screen was off (WebView throttled);
  not a valid measurement. The 2.01 "over 6 min" run may have been affected the same way.
```
