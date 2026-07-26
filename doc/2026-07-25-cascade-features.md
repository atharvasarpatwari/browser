# CSS Cascade & Inheritance — Feature Additions

**Date:** 2026-07-25
**Session:** Cascade engine improvements — layer support, custom properties, inline !important, currentcolor, media queries, :where()
**Status:** Completed

---

## Summary

Extended the CSS cascade engine with `@layer` cascade ordering, `var()` / custom properties support, proper inline `!important` semantics, `currentcolor` resolution, expanded media query features, and `:where()` zero-specificity behavior.

## Changes

### 1. `@layer` Cascade Support

**Files:** `cascade.ts`, `types.ts`

Added `CssLayerRule` and `CssLayerOrderRule` AST node types. `collectStyleRules` now tracks layer context (`layerOrder`, `currentLayer`, `layerMap`). `computeCascade` accepts layer metadata and uses it for sorting:
- Unlayered styles (index -1) beat all layered styles (index >= 0)
- Within layers, higher index (declared later) beats lower index
- Within the same layer, standard specificity + source order applies

### 2. Inline `!important` Prioritization

**File:** `cascade.ts` — `computeComputedStyles`

Fixed inline style application to follow CSS spec priority:
1. Inline non-important overrides stylesheet non-important
2. Stylesheet `!important` overrides inline non-important
3. Inline `!important` overrides everything

Previously, inline styles always won regardless of importance.

### 3. `var()` / Custom Properties

**Files:** `computed-value-resolver.ts`, `cascade.ts`

Added full `var()` substitution support:
- `var(--my-color, red)` resolves `--my-color` from collected custom properties
- Fallback values (second argument) used when custom property is undefined
- Recursive resolution for nested `var()` references
- Custom properties (`--*`) inherited from parent
- Custom properties stripped from final computed map

### 4. `currentcolor` Resolution

**File:** `computed-value-resolver.ts`

Added `currentColor` to `ResolutionContext`. `currentcolor` keyword now resolves to the element's computed `color` value instead of being passed through literally.

### 5. `:where()` Zero Specificity

**Files:** `parser.ts`, `selector.ts`, `types.ts`, `parser.ts` (specificity)

- Added `where` type to `CssPseudoClassSelector` union
- Parser emits `{ type: 'where', selectors }` for `:where()` (not `is`)
- Selector matching treats `:where()` like `:is()` — matches any selector in the list
- Specificity calculation gives `:where()` zero contribution (per spec)

### 6. Font Shorthand — Quoted Family Names

**File:** `cascade.ts` — `expandFontShorthand`

Rewrote tokenization to respect quoted strings and slashes. `"Arial", sans-serif` now correctly becomes the `font-family` value instead of being split on spaces.

### 7. Media Query Features

**File:** `cascade.ts` — `evaluateMediaFeature`

Expanded from width/height-only to full coverage:
- `orientation` (portrait/landscape)
- `aspect-ratio` (min/max/exact)
- `resolution` (dpi/dppx with unit conversion)
- `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion`
- `pointer`, `hover`, `any-pointer`, `any-hover`
- `forced-colors`, `inverted-colors`, `dynamic-range`
- `display-mode`, `update-frequency`, `overflow-block`, `overflow-inline`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/types.ts` | Added `CssLayerRule`, `CssLayerOrderRule`, `where` type |
| `src/browser/rendering/css5/cascade.ts` | Layer support in collectStyleRules/computeCascade/computeComputedStyles, inline !important fix, font shorthand fix, media query expansion, custom property collection |
| `src/browser/rendering/css5/computed-value-resolver.ts` | `var()` resolution, `currentColor` context, custom properties support |
| `src/browser/rendering/css5/parser.ts` | `:where()` emits `where` type (3 locations), specificity zero for `where` |
| `src/browser/rendering/css5/selector.ts` | `:where()` matches like `:is()` |

## Test Results

All 138 CSS tests pass (52 tokenizer/parser + 86 CSS5).

## Known Limitations

- `revert-layer` — falls back to UA defaults rather than per-layer cascade tracking (requires per-property per-origin cascade entries)
- `revert` — falls back to UA defaults (partial spec compliance for multi-origin cascading)
- Media query features with no screen context return safe defaults (e.g., `prefers-color-scheme: light` is always true)
