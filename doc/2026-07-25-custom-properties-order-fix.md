# CSS Custom Properties (var()) Audit & Fixes

**Date:** 2026-07-25
**Session:** CSS variable order-of-operations fix + CSS-wide keyword fix
**Status:** Completed

---

## Summary

Fixed 2 architectural bugs in the CSS custom properties implementation: var() substitution was happening AFTER shorthand expansion (breaking `margin: var(--x)` with multi-token values), and CSS-wide keywords (`inherit`/`initial`/`unset`) in custom property values were being incorrectly resolved. Added 22 new tests. All 331 CSS tests pass.

## Root Causes

### 1. Order of operations: var() after shorthand expansion

**File:** `src/browser/rendering/css5/cascade.ts:1141-1148` (old)
**Problem:** `expandShorthands()` ran before `resolveVarReferences()`. When a shorthand like `margin: var(--x)` was expanded, the literal string `"var(--x)"` was split on whitespace, producing a single token. After var() resolution, all sides got the full resolved value (e.g., `"10px 20px"`), which is not a valid box value.
**Fix:** Build custom properties map early (from parent + local `--*` declarations + inline `--*`), resolve var() in ALL declarations BEFORE shorthand expansion:

```typescript
// 3. Build custom properties map early (parent + local --* declarations + inline --*)
const earlyCustomProps = new Map<string, string>();
if (parentComputed) {
  for (const [prop, val] of parentComputed) {
    if (prop.startsWith('--')) earlyCustomProps.set(prop, val);
  }
}
for (const e of cascade) {
  if (e.property.startsWith('--')) earlyCustomProps.set(e.property, e.value);
}
// Also include inline style --* declarations
const styleAttr = element.attributes.get('style');
const inlineDecls = styleAttr ? parseInlineDeclarations(styleAttr) : [];
for (const d of inlineDecls) {
  if (d.property.startsWith('--')) earlyCustomProps.set(d.property, d.value);
}

// 4. Resolve var() in all declarations BEFORE shorthand expansion
const resolvedDeclarations = cascade.map((e) => ({
  property: e.property,
  value: e.property.startsWith('--') ? e.value : resolveVarReferences(e.value, earlyCustomProps),
  important: e.important,
}));

// 5. Expand shorthands (var() already resolved)
const longhand = expandShorthands(resolvedDeclarations);
```

### 2. CSS-wide keywords corrupting custom property values

**File:** `src/browser/rendering/css5/css-wide-keywords.ts:173-182`
**Problem:** `processCSSWideKeywords()` iterated over ALL properties in the computed map. Custom properties with values like `inherit`, `initial`, or `unset` were incorrectly resolved. For example, `--color: inherit` would become `--color: initial` because `getInitialValue("--color")` returns `"initial"` (custom properties aren't in the property registry).
**Fix:** Skip `--*` properties in `processCSSWideKeywords()`:

```typescript
for (const [prop, value] of computed) {
  // Custom properties (--*) store raw token values — skip them.
  if (prop.startsWith('--')) continue;
  if (isCSSWideKeywordValue(value)) {
    computed.set(prop, resolveCSSWideKeyword(prop, value, context));
  }
}
```

### 3. Inline custom properties not available for early var() resolution

**File:** `src/browser/rendering/css5/cascade.ts:1163-1191` (old)
**Problem:** Inline style custom properties (e.g., `style="--x: green"`) were only parsed after shorthand expansion. When resolving `var(--x)` in cascade declarations, the inline custom property wasn't in the map yet.
**Fix:** Parse inline declarations early and extract `--*` properties into `earlyCustomProps` before var() resolution. Reuse the already-parsed `inlineDecls` in the inline style application section.

### 4. Exported resolveVarReferences

**File:** `src/browser/rendering/css5/computed-value-resolver.ts:506`
**Problem:** `resolveVarReferences` was not exported, preventing use in cascade.ts for early resolution.
**Fix:** Added `export` keyword.

## New Pipeline Order (Before → After)

```
BEFORE:
1. Sort cascade
2. Expand shorthands        ← var() NOT yet resolved
3. Build computed map
4. Apply UA defaults
5. Apply declarations
6. Apply inline styles
7. processCSSWideKeywords   ← corrupts --* with keyword values
8. Inherit from parent
9. Set initial values
10. Collect custom properties
11. resolveAllComputedValues  ← var() resolved here (too late)

AFTER:
1. Sort cascade
2. Build earlyCustomProps    ← parent + cascade --* + inline --*
3. Resolve var() in declarations
4. Expand shorthands         ← var() already resolved
5. Build computed map
6. Apply UA defaults
7. Apply declarations
8. Apply inline styles (var() resolved)
9. processCSSWideKeywords    ← skips --* properties
10. Inherit from parent
11. Set initial values
12. Collect custom properties
13. resolveAllComputedValues  ← var() already resolved, just color/font/etc.
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | Reordered pipeline: var() before shorthands, early custom props, inline custom props, skip `--*` in CSS-wide keywords comment |
| `src/browser/rendering/css5/css-wide-keywords.ts:177` | Skip `--*` properties in `processCSSWideKeywords` |
| `src/browser/rendering/css5/computed-value-resolver.ts:506` | Exported `resolveVarReferences` |
| `tests/css5-computed-styles-pipeline.test.ts:180-400` | Expanded from 5 to 27 custom property tests |

## Known Limitations (Documented)

1. **Cycle detection via depth limit**: Circular references like `--x: var(--y); --y: var(--x)` hit `maxDepth=10` and leave partially-resolved `var()` tokens. The CSS spec requires "guaranteed-invalid" value detection, which needs token-level resolution. Our string-based approach can't distinguish circular references from legitimate deep nesting.

2. **CSS-wide keywords in var() fallback**: `var(--x, initial)` substitutes the literal string `"initial"`, which is then treated as the CSS-wide keyword by `processCSSWideKeywords`. Real browsers resolve var() at token level during parsing to avoid this. This is a fundamental limitation of string-level var() resolution.

3. **calc() inside shorthand**: `splitTokenList()` splits on whitespace, which breaks `calc()` expressions in shorthands. This is a pre-existing bug unrelated to var().

## Test Results

```
✓ tests/css5-computed-styles-pipeline.test.ts  119 tests (was 97)
✓ tests/css5-computed-value-resolver.test.ts    74 tests
✓ tests/css5-tokenizer-parser.test.ts           52 tests
✓ tests/css5.test.ts                            86 tests
Total CSS: 331 tests — all pass
```

## Verification

1. `margin: var(--gap)` where `--gap: 10px` → all 4 sides = `10px` (was broken)
2. `margin: var(--a) var(--b)` → correctly expands to 2-value box model
3. `--color: inherit` → stored as literal `"inherit"`, not corrupted to `"initial"`
4. `--x: initial` → stored as literal `"initial"`
5. Inline `--x: green` + `color: var(--x)` → resolves to `#008000`
6. Three-level inheritance: grandparent → parent → child all see `--x: 10px`
7. `var()` inside `@media` blocks works correctly
8. `var()` with `calc()` resolves var() first, leaving `calc()` for layout
