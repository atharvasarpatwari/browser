# Media Query Parser & Evaluator Audit

**Date:** 2026-07-25
**Session:** CSS5 media query bugfixes
**Status:** Completed

---

## Summary

Fixed 4 bugs in the media query system: broken media type evaluation, broken `not` modifier, boolean features incorrectly parsed, and `only` modifier not handled. Added 41 new media query tests. All 309 CSS tests pass.

## Root Causes

### 1. Media type not properly evaluated

**File:** `src/browser/rendering/css5/cascade.ts:167`
**Problem:** `evaluateMediaQuery` used `featureMatch` as the overall match result. When no features were present (bare `@media screen`), `featureMatch` started as `false`, so `@media screen` returned `false` even though Nova renders in screen context.
**Fix:** Introduced `evaluateMediaType()` that correctly returns `true` for `screen` and `all`, `false` for `print`. The query result is now `typeMatch && featureMatch`:

```typescript
function evaluateMediaType(mediaType: string): boolean {
  switch (mediaType) {
    case 'all': return true;
    case 'screen': return true;
    case 'print': return false;
    default: return true;
  }
}
```

### 2. `not` modifier broken

**File:** `src/browser/rendering/css5/cascade.ts:183-184`
**Problem:** The `not` modifier was applied to `featureMatch` only, not the full result including media type. `@media not screen` returned `true` (wrong) and `@media not print` returned `false` (wrong).
**Fix:** `not` now inverts the full `typeMatch && featureMatch` result:

```typescript
const result = typeMatch && featureMatch;
if (query.modifier === 'not') return !result;
return result;
```

### 3. Boolean features get value `'true'` instead of `''`

**File:** `src/browser/rendering/css5/parser.ts:1669`
**Problem:** `parseMediaFeature('(hover)')` produced `{ name: 'hover', value: 'true' }`. The evaluator's empty-value check `!feature.value || feature.value === ''` never triggered, so `(hover)` fell through to the switch and failed because `'true' !== 'hover'`.
**Fix:** Changed boolean feature value from `'true'` to `''`:

```typescript
// Before
return { name: inner.trim(), value: 'true', range: null };
// After
return { name: inner.trim(), value: '', range: null };
```

### 4. `only` modifier ignored (minor)

**File:** `src/browser/rendering/css5/cascade.ts:183`
**Problem:** `only` modifier was parsed but never handled in evaluation.
**Fix:** `only` is a no-op (backward compat) — existing code already falls through to `return result` for non-`not` modifiers, so this was a documentation fix only.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts:167-194` | Rewrote `evaluateMediaQuery`, added `evaluateMediaType` |
| `src/browser/rendering/css5/parser.ts:1669` | Boolean feature value changed from `'true'` to `''` |
| `tests/css5-computed-styles-pipeline.test.ts:377-530` | Expanded from 5 to 41 media query tests |

## Test Results

```
✓ tests/css5-computed-styles-pipeline.test.ts  97 tests (was 56)
✓ tests/css5-tokenizer-parser.test.ts          52 tests
✓ tests/css5.test.ts                           86 tests
✓ tests/css5-computed-value-resolver.test.ts   74 tests
Total CSS: 309 tests — all pass
```

## Verification

1. `@media screen { div { color: red; } }` — now correctly matches (was false)
2. `@media not print { div { color: red; } }` — now correctly matches (was false)
3. `@media not screen { div { color: red; } }` — now correctly rejects (was true)
4. `@media (hover) { div { color: red; } }` — now correctly matches (was false)
5. `@media (pointer: coarse) { div { color: red; } }` — correctly rejects (assumes fine pointer)
6. Comma-separated queries OR correctly
7. Nested @media AND correctly
8. `@media print` correctly rejected
