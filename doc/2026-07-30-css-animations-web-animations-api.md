# CSS Animations + Web Animations API

**Date:** 2026-07-30
**Session:** Implement CSS Animations and Web Animations API bridge (3 phases)
**Status:** Completed

---

## Summary
Implemented full CSS Animations support (8 longhand properties, shorthand parsing, @keyframes collection) and Web Animations API bridge (animate(), getAnimations(), Animation wrapper with JS bindings).

## Root Causes (if bug fix)

### 1. Test selectors used raw strings instead of CssSelector objects
**File:** `tests/css-animation-integration.test.ts`
**Problem:** The `selectors` field in a style rule expects `CssSelector[]`, but the test used `string[]` (e.g., `['div']`), causing type errors.
**Fix:** Changed to proper `CssSelector` objects with `{ type: 'compound', tagName: 'div', ... }`.

### 2. createAnimation() creates internal timeline not shared with test timeline
**File:** `tests/css-animation-integration.test.ts`
**Problem:** `createAnimation()` without a timeline argument creates a new `AnimationTimeline()` internally, so calling `timeline.tick()` on the test's timeline had no effect.
**Fix:** Used direct `new Animation(effect, timeline)` construction to share the timeline being tested.

### 3. AnimationTimeline.tick() expects absolute timestamps
**File:** `tests/css-animation-integration.test.ts`
**Problem:** Test passed `0` and `2000` as raw timestamps, but `tick()` computes elapsed time as `now - timeline._startTime` where `_startTime = performance.now()`. Passing absolute values smaller than `_startTime` produced negative elapsed times.
**Fix:** Used `performance.now()` for baseline and added duration offset.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/property-definitions.ts` | Added 8 animation longhands + animation shorthand to SHORTHAND_LONGHANDS map |
| `src/browser/rendering/css5/cascade.ts` | Added `expandAnimationShorthand()`, @keyframes collection in `CollectContext`, `collectKeyframes()` export, 8 animation props to ALL_PROPERTIES |
| `src/browser/rendering/compositing/animation-engine.ts` | Made `AnimationTimeline.tick()` public |
| `src/browser/rendering/compositing/compositor-thread.ts` | Wired `tick()` into `processFrame()` before compositing loop |
| `src/browser/rendering/reflow-repaint-controller.ts` | Added `AnimationTimeline` instance, `tick()` call before style recalc, `animationTimeline` getter, dispose of timeline |
| `src/browser/js/dom-bindings.ts` | Added `elementAnimations` registry, `wrapAnimation()`, `parseKeyframesArg()`, `parseAnimationOptions()`, `animate()`/`getAnimations()` on element wrappers |
| `src/browser/js/web-apis.ts` | Updated stubs to delegate to dom-bindings implementations |
| `tests/css-animation-integration.test.ts` | 31 tests covering all 3 phases; fixed 3 test bugs (selector types, timeline sharing, timestamp semantics) |

## Files Created

| File | Purpose |
|------|---------|
| *None* | All changes were additions to existing files |

## Test Results

### Phase 1 (Property Definitions + Shorthand + @keyframes): 19/19 pass
- 8 animation property registration tests
- 1 shorthand registration test
- 5 shorthand expansion tests
- 4 @keyframes collection tests
- 1 computed style presence test

### Phase 2 (Timeline Integration): 3/3 pass
- ReflowRepaintController has AnimationTimeline
- processFrame ticks timeline
- Timeline ticks before layout

### Phase 3 (Engine Bridge + JS Bindings): 9/9 pass
- createAnimation returns correct options
- KeyframeEffect parses keyframes
- Animation attachable to multiple timelines
- Timeline tick advances animation time
- Animation wrapper exposes playState lifecycle
- getComputedProperties for idle/running states
- Multiple concurrent animations

**Full suite:** 31/31 pass (new tests). No regressions — 4 pre-existing test failures unchanged (networking-integration, positioning, flex-layout, rasterizer).
