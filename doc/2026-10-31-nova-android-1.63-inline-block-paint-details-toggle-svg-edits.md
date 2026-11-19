# Nova Android 1.63: Inline-block Content Painted Over Its Background, `<details>` Toggle, SVG Redrawn on Script Edits

**Date:** 2026-10-31
**Session:** "keep improving the nova app" — the three open items left after the 1.62 tablet round
**Status:** Completed (device check of the 1.63 section pending: the tablet was locked after install)

---

## Summary

Three gaps left from the tablet rounds closed. A `<button>` (inline-block by default), an inline-block card link or an inline-flex box painted its block-level children *under* its own background, so a button with a `<div>` label showed an empty box. `<details>` now fires `toggle` and has a scriptable `open` property. Inline SVG is redrawn when a script edits its shapes or attributes (charts, progress rings), not only when it is shown, resized or recoloured.

## Root Causes

### 1. An inline-block's block children painted under its background
**File:** `src/browser/rendering/formatting/stacking.ts`
**Problem:** stacking-tree classification put an inline-block itself in level 4 (inline content) but its block children in level 2 (blocks) of the same context, so they painted first and the inline-block's background covered them. CSS 2.2 Appendix E paints an inline-block atomically, as if it formed a stacking context.
**Fix:** inside an inline-block / inline-flex / inline-grid / inline-table, every in-flow descendant goes to level 4 in tree order right after it (positioned descendants still go to the positioned layer, as the spec says):
```ts
if (atomic) ctx.inlineEntries.push(childEl);
else classifyElementIntoLayer(ctx, childEl);
classifyChildrenIntoContext(ctx, childEl, false, options, atomic || ATOMIC_INLINE.has(display));
```
Chosen over a separate sub-context per inline-block because `layer-tree.ts` and `layer-compositor.ts` walk the entry lists directly and would have missed its descendants.

### 2. `<details>` had no `toggle` event and no `open` property
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** a summary tap toggled the attribute silently; `details.open = true` from a script did nothing (no property).
**Fix:** `setDetailsOpen(details, open, domTree)` sets/removes the attribute and dispatches a non-bubbling `toggle`; used by the summary activation and a new `open` getter/setter on `<details>` wrappers. Setting the current value is a no-op. ponytail: dispatched synchronously rather than queued as a task.

### 3. SVG not redrawn after a script edited it
**Files:** `src/browser/rendering/inline-svg.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** the post-frame SVG pass (1.59) keyed rasters on size + colour only, so `circle.setAttribute('r', …)` or an appended `<rect>` kept the old picture.
**Fix:** page-renderer subscribes to `domTree.onMutation`; a change inside an `<svg>` forgets that svg's raster key (`invalidateInlineSvgAt`), and the mutation's reflow frame redraws it once. The subscription is replaced per page and dropped on dispose.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/formatting/stacking.ts` | atomic inline-level boxes (#1) |
| `src/browser/js/dom-bindings.ts` | `setDetailsOpen`, `toggle` event, `details.open` (#2) |
| `src/browser/rendering/inline-svg.ts` | `invalidateInlineSvgAt` (#3) |
| `src/browser/engine/page-renderer.ts` | mutation subscription for svg redraws (#3) |
| `tests/fixtures/device-pages/features.html` | 1.63 section: div-label button, card link, toggle log, script-grown ring |
| `android/app/build.gradle` | versionCode 64, versionName 1.63 |
| `android/app/src/main/assets/` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/inline-block-paint-163.test.ts` | button/div label, inline-block link, inline-flex, nested block background (4); details toggle via tap and via `open` (2); svg redrawn on attribute change and appended shape, not every frame (1) |

## Verification

- The 4 paint-order tests failed before the stacking change (all four labels under their backgrounds); the svg test fails with the mutation hook disabled (`expected 1 to be 2`) and passes with it.
- Device: Nova-1.63 installed on the OPPO tablet (Success, versionCode 64); the tablet then showed its lock screen, which I don't unlock, so the 1.63 section of the feature page is still to be checked there.

## Test Results

```
npx tsc --noEmit                                  → clean
npx vitest run tests/inline-block-paint-163.test.ts → 7 passed
npx vitest run                                    → Test Files 310 passed (310); Tests 10783 passed (10783)
gradlew :app:testDebugUnitTest :app:assembleRelease → BUILD SUCCESSFUL
apksigner verify Nova-1.63.apk                    → verified; aapt: versionCode 64, versionName 1.63
adb install -r Nova-1.63.apk                      → Success (OPPO OPD2305)
```
