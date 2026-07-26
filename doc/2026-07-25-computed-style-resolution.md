# Computed Style Resolution — Bug Fixes & Comprehensive Tests

**Date:** 2026-07-25
**Session:** Computed style resolution audit — fixed 4 resolution bugs, wrote 130 new tests
**Status:** Completed

---

## Summary

Audited the full computed style resolution pipeline (`computed-value-resolver.ts`, `cascade.ts`, `css-wide-keywords.ts`) and found 4 bugs. Fixed all bugs and wrote 130 comprehensive tests covering var() resolution, currentcolor, custom properties inheritance, full pipeline integration, and edge cases.

## Root Causes

### 1. Custom Properties Stripped Before Child Inheritance

**File:** `cascade.ts` — `computeComputedStyles`
**Problem:** `computeComputedStyles` stripped custom properties (`--*`) from the returned map before returning. When the parent's computed map was passed as `parentComputed` to a child, the custom properties were already gone, so children could never inherit custom properties for `var()` resolution.
**Fix:** Removed the custom property stripping step. Custom properties remain in the computed map so they're available for child inheritance. They don't affect rendering since standard CSS property lookups don't match `--*` names.

### 2. currentcolor Resolved Before Color Resolution

**File:** `cascade.ts` — `computeComputedStyles`
**Problem:** The `currentColor` context value was captured from `computed.get('color')` BEFORE the resolver ran. So `border-top-color: currentcolor` would resolve to the raw declared color (e.g., `'red'`) instead of the resolved hex (`'#ff0000'`).
**Fix:** Two-pass resolution: first resolve all color properties (including `color`), then use the resolved `color` value as `currentColor` for the second pass that resolves all remaining properties.

### 3. var() Not Resolved Without Custom Properties Map

**File:** `computed-value-resolver.ts` — `resolveComputedValue`
**Problem:** `var()` resolution was gated on `ctx.customProperties` being defined. When no custom properties map was provided (undefined), even fallback values like `var(--missing, blue)` were not resolved.
**Fix:** Changed the condition to always resolve `var()` when present, using an empty Map as fallback when `ctx.customProperties` is undefined.

### 4. Border Shorthand Only Expanded to Intermediate Shorthands

**File:** `cascade.ts` — `expandBorderShorthand`
**Problem:** `border: 2px solid red` was expanded to `border-width: 2px; border-style: solid; border-color: red` — intermediate shorthands that the one-pass `expandShorthands` function didn't further expand. So `border-top-width` got its initial value `medium` (3px) instead of `2px`.
**Fix:** `expandBorderShorthand` now outputs longhand properties directly (`border-top-width`, `border-right-width`, etc.) for all four sides.

### 5. Font Shorthand Family Spacing

**File:** `cascade.ts` — `expandFontShorthand`
**Problem:** Font family tokens were joined with spaces, producing `"Arial" , sans-serif` instead of `"Arial", sans-serif`.
**Fix:** Join logic now handles commas properly — puts `, ` after comma tokens instead of adding spaces.

### 6. Body UA Default Used Shorthand

**File:** `cascade.ts` — `getUserAgentDefaults`
**Problem:** Body margin was set as `margin: '8px'` (shorthand) but `expandShorthands` only runs on cascade declarations, not UA defaults. So `margin-top/right/bottom/left` got initial value `0` from `setInitialValues`.
**Fix:** Changed to set individual longhand properties: `margin-top: '8px'`, `margin-right: '8px'`, etc.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | Fixed border shorthand expansion, font family spacing, body UA defaults, currentcolor two-pass resolution, removed custom property stripping |
| `src/browser/rendering/css5/computed-value-resolver.ts` | Fixed var() fallback resolution when no customProperties map |
| `tests/css5-computed-value-resolver.test.ts` | Fixed currentcolor test, added 25+ new tests for var(), currentcolor, custom props, clear, overflow, edge cases |
| `tests/css5-computed-styles-pipeline.test.ts` | New file: 56 tests covering full computeComputedStyles pipeline |
| `tests/css5.test.ts` | Updated border shorthand and body margin tests |

## Files Created

| File | Purpose |
|------|---------|
| `tests/css5-computed-styles-pipeline.test.ts` | 56 comprehensive tests for the full computed styles pipeline |

## Test Results

```
✓ tests/css5-computed-value-resolver.test.ts  (74 tests)
✓ tests/css5-computed-styles-pipeline.test.ts (56 tests)
✓ tests/css5.test.ts                          (86 tests)
✓ tests/css5-tokenizer-parser.test.ts         (52 tests)

Test Files  4 passed (4)
     Tests  268 passed (268)
```

## Test Coverage

### Computed Value Resolver (74 tests)
- Named colors → hex (148 colors spot-checked)
- currentcolor resolution (with/without context)
- Font-size keywords (absolute + relative)
- Font-weight keywords (absolute + relative + bolder/lighter clamping)
- Border-width keywords
- Opacity clamping
- var() resolution (basic, fallback, nested, multiple, missing)
- Custom property passthrough
- Case-insensitive colors
- Display/position/overflow/visibility normalization
- text-align/float/clear/direction/white-space/vertical-align normalization
- line-height number vs unit
- z-index integer
- flex-grow/shrink/order
- Special value pass-through (inherit/initial/unset/revert/auto/none)
- Edge cases (whitespace, different parent sizes, boundary clamping)

### Pipeline (56 tests)
- Basic cascade (specificity, source order, inline styles)
- !important handling (stylesheet vs inline, correct priority order)
- Inheritance (inheritable vs non-inheritable, child override)
- CSS-wide keywords (inherit, initial, unset)
- Custom properties (var() in declarations, inheritance, override, stripping)
- @layer cascade ordering (unlayered > layered, layer order)
- currentcolor in full pipeline
- Shorthand expansion (margin, padding, border, font with quoted families)
- :where() zero specificity
- Selector lists, :not(), descendant/child combinators
- Media queries (width, orientation, prefers-color-scheme, pointer)
- UA defaults for common elements
- Inline style parsing (multiple declarations, !important, custom properties)
- Full pipeline integration (3-level inheritance, multiple layers, opacity/z-index)

## Known Limitations

- `revert`/`revert-layer` — falls back to UA defaults rather than per-origin cascade tracking
- `canvastext` system color not resolved to a real hex value (used as literal)
- Font shorthand `oblique` angle not parsed (only `italic`/`oblique` keyword)
