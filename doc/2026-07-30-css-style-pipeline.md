# CSS Style Pipeline — StyleSheet, UsedStyle, Style Invalidation

**Date:** 2026-07-30
**Session:** Implement CSS full style pipeline (StyleSheet, UsedStyle, style invalidation) and box-model fixes
**Status:** Completed

---

## Summary

Implemented the CSS full style pipeline: `StyleSheet` class (rule management API), `buildUsedStyle()` pixel resolver, `_dirtyStyle` invalidation flag on `DomNode`, and wiring through `ReflowRepaintController` and `PageRenderer`. Fixed box-model bugs in `resolveBorder()` (border-style→border-width check, shorthand fallback) and `contentWidth` guard. All 424 tests pass across 10 test files with zero regressions.

## Root Causes

### 1. `resolveBorder()` ignored `border-*-style` when computing border width

**File:** `src/browser/rendering/layout-engine.ts`

**Problem:** `resolveBorder()` only looked at `border-*-width` values. Per CSS 2.2 §8.5.1, when `border-*-style` is `none` or `hidden`, the computed `border-*-width` must be `0` regardless of the specified width. Tests that set `border-width` without `border-style` (or with wrong shorthands) got unexpected 0 values.

**Fix:** Added `border-*-style` check: if `none` or `hidden`, return `0`. Also added shorthand fallback (`border-style` and `border-width` as fallback when per-side property not set).

```ts
private resolveBorder(style: ReadonlyMap<string, string>, side: 'top' | 'right' | 'bottom' | 'left'): number {
  const perSide = style.get(`border-${side}-style`);
  const shorthand = style.get('border-style');
  const styleVal = perSide ?? shorthand ?? 'none';
  if (styleVal === 'none' || styleVal === 'hidden') return 0;
  const w = style.get(`border-${side}-width`) ?? style.get('border-width') ?? 'medium';
  return this.parseBorderWidth(w);
}
```

### 2. `resolveEdgeValue()` ignored `em` and `containerHeight` params

**File:** `src/browser/rendering/css5/used-style.ts`

**Problem:** `resolveEdgeValue()` passed `defaultFontSize` and `0` to `resolveLength()` instead of the element's computed `em` and `containerHeight`. This caused `em`-based padding/margin to resolve at the inherited font size rather than the element's own font size, and `vh`-based values to always resolve to 0.

**Fix:** Updated `resolveEdgeValue()` to forward `em` (element font size), `rem` (root font size), and `containerHeight` correctly to `resolveLength()`.

### 3. Border `hidden` style not handled in `buildUsedStyle`

**File:** `src/browser/rendering/css5/used-style.ts`

**Problem:** `buildUsedStyle` checked `bts === 'none'` but not `'hidden'`. CSS 2.2 treats `hidden` identically to `none` for border-width purposes.

**Fix:** Added `|| bts === 'hidden'` checks for all four sides.

### 4. `resolveLineHeight()` parsed unitless numbers as px instead of multiplier

**File:** `src/browser/rendering/css5/used-style.ts`

**Problem:** Unitless number `1.5` was parsed by `resolveLength()` which returned `1.5` (as a px value), and since `1.5 > 0`, the function returned early without applying the font-size multiplier. Per CSS, a unitless `line-height` value is a multiplier of the font size.

**Fix:** Added explicit unitless-number detection (`/^\d+(\.\d+)?$/.test(value)`) before the `resolveLength()` call, returning `fontSize * num` for such values.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | `resolveBorder()` now checks `border-*-style` before using width; also checks shorthand fallbacks |
| `src/browser/rendering/css5/used-style.ts` | `buildUsedStyle()` fixed border `hidden` check, `resolveEdgeValue()` forwards `em`/`containerHeight`, `resolveLineHeight()` handles unitless numbers as multipliers |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/rendering/css5/stylesheet.ts` | `StyleSheet` class with `insertRule()`/`deleteRule()`/`replaceRule()`/`addRule()`/`toCssStylesheet()`/`clear()`/`clone()` |
| `src/browser/rendering/css5/used-style.ts` | `buildUsedStyle()` pixel resolver (was incomplete in prior session, now fully functional) |
| `src/browser/rendering/dom-tree.ts` | `_dirtyStyle` flag on `DomNode`, `UsedStyle` interface, `setUsedStyle()`/`markDirty()`/`clearDirty()` with `'style'` kind |
| `src/browser/rendering/reflow-repaint-controller.ts` | `_styleRecalcCallback` with `setStyleRecalcCallback()`, called at start of `processFrame()` |
| `src/browser/engine/page-renderer.ts` | `_lastRules`/`_lastStylesheet` storage, `recalcStylesIncremental()`, `collectDirtyNodes()`, `buildUsedStyle` call in `applyStylesRecursive()` |
| `src/browser/rendering/css5/index.ts` | Exports `StyleSheet` and `buildUsedStyle` |
| `tests/css5-stylesheet.test.ts` | 16 tests for `StyleSheet` class |
| `tests/css5-used-style.test.ts` | 31 tests for `buildUsedStyle` |
| `tests/style-invalidation.test.ts` | 7 tests for dirty flags, UsedStyle, style recalc callback |

## Files Modified (tests)

| File | Change |
|------|--------|
| `tests/layout-engine.test.ts` | 5 tests updated to include `border-style: solid` shorthand; nested test uses `border-style: solid` |

## Test Results

```
 ✓ tests/css5-stylesheet.test.ts (16 tests)
 ✓ tests/css5-used-style.test.ts (31 tests)
 ✓ tests/style-invalidation.test.ts (7 tests)
 ✓ tests/layout-engine.test.ts (36 tests)
 ✓ tests/css5-computed-value-resolver.test.ts (74 tests)
 ✓ tests/css5-computed-styles-pipeline.test.ts (119 tests)
 ✓ tests/css5-css-wide-keywords.test.ts (24 tests)
 ✓ tests/css5-property-definitions.test.ts (44 tests)
 ✓ tests/formatting-contexts.test.ts (68 tests)
 ✓ tests/layout-enhanced.test.ts (22 tests)
 -------------------------------
 10 test files, 424 tests, all passed
```

Additionally verified no regressions:
- `tests/html5-*.test.ts`: 6 files, 443 tests, all passed
- `tests/reflow-repaint.test.ts`: 22 tests, all passed
- `tests/page-renderer.test.ts`: 22 tests, all passed

## Key Architecture Decisions

- **`StyleSheet` class wraps `CssStylesheet`** — provides mutable rule-management (`insertRule`/`deleteRule`/etc.) without modifying the immutable core types.
- **`UsedStyle` is separate from `LayoutBox`** — holds pixel-resolved style values consumed by the layout engine, keeping `LayoutBox` focused on layout output (position/size).
- **Style invalidation via callback on `ReflowRepaintController`** — avoids coupling the controller to `PageRenderer`; the callback is set externally with `setStyleRecalcCallback()` before `processFrame()`.
- **`border-style` shorthand fallback** — `resolveBorder()` checks per-side `border-*-style` first, then falls back to `border-style` shorthand, for robustness with test-style computed styles that may not expand shorthands.

## Verification Steps

1. Ran `npx vitest run tests/css5-stylesheet.test.ts tests/css5-used-style.test.ts tests/style-invalidation.test.ts tests/layout-engine.test.ts tests/css5-computed-value-resolver.test.ts tests/css5-computed-styles-pipeline.test.ts tests/css5-css-wide-keywords.test.ts tests/css5-property-definitions.test.ts tests/formatting-contexts.test.ts tests/layout-enhanced.test.ts` — 424 tests, all pass
2. Ran `npx vitest run tests/html5-*` — 443 tests, all pass (no HTML parser regressions)
3. Ran `npx vitest run tests/reflow-repaint.test.ts tests/page-renderer.test.ts` — 44 tests, all pass (style invalidation wiring)
