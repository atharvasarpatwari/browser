# CSS @container Queries & Nesting Implementation

**Date:** 2026-07-30
**Session:** CSS container queries and nesting support
**Status:** Completed

---

## Summary

Implemented two missing CSS features: `@container` queries (container query evaluation with size features) and CSS nesting (rule nesting with `&` selector flattening).

## Root Causes

### 1. Missing @container rule type and evaluation
**File:** `src/browser/rendering/css5/types.ts`, `parser.ts`, `cascade.ts`, `property-definitions.ts`
**Problem:** `@container` was not defined as a rule type, not parsed, not evaluated in cascade. Container query units (`cqw`/`cqh`) were recognized in `calc()` but had no associated rule infrastructure.
**Fix:**
- Added `CssContainerRule` interface to types.ts and included it in the `CssRule` union
- Added `container-type`, `container-name`, and `container` shorthand to property definitions
- Added `@container` parsing in both token-level (`consumeContainerRule`) and text-level parsers
- Added `evaluateContainerQuery()` function supporting size features with `and`/`or`/`not` operators
- Added `@container` handling in `collectStyleRules` cascade collector

### 2. Missing CSS nesting support
**File:** `src/browser/rendering/css5/parser.ts`
**Problem:** CSS nesting (rules inside other rules, `&` nesting selector) was not supported. The parser treated nested selectors as malformed declarations.
**Fix:**
- Added `flattenCSSNesting()` pre-processor that desugars nested rules into flat CSS before parsing
- Added `splitNestedBlock()` to separate declarations from nested rule blocks within a `{}` body
- Added `resolveNestingSelector()` to handle `&` replacement and implicit descendant combinator
- Added recursive flattening for deeply nested rules
- Integrated the pre-processor into `parseStylesheetRobust()`

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/types.ts` | Added `CssContainerRule` interface, added to `CssRule` union |
| `src/browser/rendering/css5/property-definitions.ts` | Added `container-type`, `container-name`, `container` properties and shorthand mapping |
| `src/browser/rendering/css5/parser.ts` | Added `@container` parsing (token + text level); added `flattenCSSNesting()`, `splitNestedBlock()`, `resolveNestingSelector()` for CSS nesting |
| `src/browser/rendering/css5/cascade.ts` | Added `evaluateContainerQuery()`, `splitOnKeyword()`; added `@container` case in `collectStyleRules` |
| `src/browser/rendering/css5/index.ts` | Added `CssContainerRule` to exports |
| `src/browser/rendering/css5/math-functions.ts` | Unchanged — container units (`cqw`/`cqh`) already supported |

## Files Created

| File | Purpose |
|------|---------|
| `tests/css5-container-nesting.test.ts` | 33 tests covering @container parsing, property definitions, cascade evaluation; CSS nesting basic, deep nesting, `&` selector, media/supports nesting, pseudo-classes |

## Test Results

```
✓ tests/css5.test.ts (117 tests)
✓ tests/css5-container-nesting.test.ts (33 tests)
✓ tests/css5-computed-styles-pipeline.test.ts (119 tests)
✓ tests/css5-computed-value-resolver.test.ts (74 tests)
✓ tests/css5-css-wide-keywords.test.ts (24 tests)
✓ tests/css5-property-definitions.test.ts (44 tests)
✓ tests/css5-stylesheet.test.ts (15 tests)
✓ tests/css5-tokenizer-parser.test.ts (44 tests)
✓ tests/css5-used-style.test.ts (31 tests)
✓ tests/css-math-functions.test.ts (42 tests)
✓ tests/style-invalidation.test.ts (7 tests)
✓ tests/wpt/css-spec.test.ts (93 tests)
✓ tests/wpt/css-specificity-cascade.test.ts (30 tests)

Total CSS tests: 456 passed
```

## Verification Steps

1. All existing CSS5 tests pass (no regressions)
2. 33 new tests for container queries and CSS nesting all pass
3. TypeScript typecheck passes (`tsc --noEmit`)
