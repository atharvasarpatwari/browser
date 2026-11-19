# Nova Android 1.53: Flex/Grid `gap`, `:is()`/`:not()` Selector Lists, `@supports` Values

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". A probe of 17 everyday layout features found 3 broken.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
These worked:
- `margin: auto` centring, `max-width`, `aspect-ratio`, `min-width`;
- flex `space-between`/wrap/`order`/`flex: 1`/`align-items`;
- `:nth-child`, `@media`;
- inline-block rows, percentage widths, `box-sizing`.

Broken and fixed:
| Feature | Before | After |
|---------|--------|-------|
| `gap: 10px` on flex | Items touching | Spaced; `gap: <row> <column>` sets both |
| `:is(.a, .b)`, `:not(.x, .y)`, `:where(…)` | Read as `.a .b` (descendant): matched almost nothing | Each listed selector matches |
| `@supports (display: nonsense)` | True: any value passed | False; keyword properties are checked against what Nova supports |

## Root Causes

### RC-1: `gap` was never expanded
**File:** `src/browser/rendering/css5/cascade.ts` `expandShorthands`
**Problem:** Flex and grid read `column-gap` / `row-gap` and fall back to `gap`, but the longhands always exist with their initial value `normal` (0), so the fallback never applied.
**Fix:** `gap` / `grid-gap: <row> [<column>]` expands to `row-gap` and `column-gap`.

### RC-2: Selector lists inside `:is()`/`:not()`/`:where()`/`:has()` lost their commas
**File:** `src/browser/rendering/css5/parser.ts` (`buildSelectorFromTokens`, the parser `parseStylesheetRobust` uses)
**Problem:** The pseudo-class argument was tokenized as one selector, so `.a, .b` became a single compound sequence with the comma ignored: `.a .b`.
**Fix:** `splitTopLevelCommas()` splits the argument at commas outside `()`, `[]` and strings, and parses each part. `:matches()` is accepted as an alias.
ponytail: a relative `:has(> img)` still loses its leading combinator.

### RC-3: `@supports` accepted any value
**File:** `css5/cascade.ts` `evaluateSupportsDeclaration`
**Problem:** Only the property name was checked.
**Fix:** `SUPPORTED_KEYWORDS` validates keyword properties: `display` (only the values Nova lays out, so `contents` is false), `position`, `float`, `clear`, `visibility`, `box-sizing`, the flex keywords, `white-space`, `text-transform` and `overflow`. Other properties still pass when known.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | `gap` expansion; `SUPPORTED_KEYWORDS` for @supports |
| `src/browser/rendering/css5/parser.ts` | `splitTopLevelCommas`; selector lists in functional pseudo-classes |
| `android/app/build.gradle` | 1.53 (54) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/css-gaps-153.test.ts` | 3 tests: flex gap and two-value gap; `:is`/`:not`/`:where` lists; `@supports` truth table |
| `Nova-1.53.apk` | Signed build |

## Test Results
```
npx tsc --noEmit                            -> clean
npx vitest run tests/css-gaps-153.test.ts   -> 3 passed (3)
npx vitest run                              -> Test Files 304 passed | 1 failed (305), Tests 10751 passed | 1 failed (10752)
                                               the failure is the search-performance timing gate (flaky under load)
npx vitest run tests/search-performance.test.ts -> 16 passed (16)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.53.apk              -> Verifies; versionCode 54, versionName 1.53
```
