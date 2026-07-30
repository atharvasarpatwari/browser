# Compositing Enhancements — Bug Fixes

**Date:** 2026-07-29
**Session:** Fix 16 failing tests in compositing-enhancements test suite
**Status:** Completed

---

## Summary
Fixed 16 failing tests in the compositing enhancements test suite. Root causes spanned 3 modules: regex `lastIndex` semantics in `transform-parser.ts`, matrix multiplication order (CSS left-to-right vs math right-to-left), animation boundary semantics, and a missing `translate3D` export. All 49 compositing-enhancements tests now pass.

---

## Root Causes

### 1. Regex `g` flag `lastIndex` reset
**File:** `src/browser/rendering/compositing/transform-parser.ts:319`
**Problem:** `TRANSFORM_FN_RE` has the `g` flag. After `exec()` exhausts all matches in the input string, `lastIndex` resets to 0. The check `if (!match && TRANSFORM_FN_RE.lastIndex === 0)` then returned `null` for every valid transform string, treating successful parses as "no match."
**Fix:** Replaced the `lastIndex` check with a simple `found` boolean flag, set to `true` inside the while loop body.

### 2. Missing `translate3D` export
**File:** `src/browser/rendering/compositing/transform-parser.ts:116`
**Problem:** `translate3D()` was defined as a module-private function but imported by `scroll-compositor.ts`.
**Fix:** Added `export` keyword to `translate3D`.

### 3. Matrix multiplication order reversed
**File:** `src/browser/rendering/compositing/transform-parser.ts:316`
**Problem:** CSS `transform: translate(10px,20px) scale(2) rotate(45deg)` applies functions left-to-right. The accumulation loop used `result = multiply4x4(result, m)`, which gives `T × S × R` — equivalent to applying R first. The correct accumulation is `result = multiply4x4(m, result)`, producing `R × S × T` (CSS semantics).
**Fix:** Changed `multiply4x4(result, m)` to `multiply4x4(m, result)`.

### 4. Animation compute boundary condition
**File:** `src/browser/rendering/compositing/animation-engine.ts:151`
**Problem:** The condition `effectiveTime >= totalDuration + this.endDelay` matched the exact end time, returning `{}` for `fill: 'none'`. At `effectiveTime === totalDuration`, the animation should return the final keyframe.
**Fix:** Changed `>=` to `>` for the post-duration check, and added an early return of `sampleKeyframe(1)` when `effectiveTime >= totalDuration`.

### 5. Unhandled promise rejection from `cancel()`
**File:** `src/browser/rendering/compositing/animation-engine.ts:336`
**Problem:** `cancel()` rejects the `finished` DOM promise per spec, but tests that cancel animations without awaiting `finished` trigger unhandled rejection warnings.
**Fix:** Added `.catch(() => {})` on the `_finishedPromise` in the constructor to suppress unhandled rejections from expected cancellations.

---

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/compositing/transform-parser.ts` | Fixed regex `lastIndex` bug, added `export` to `translate3D`, fixed matrix multiplication order |
| `src/browser/rendering/compositing/animation-engine.ts` | Fixed animation boundary condition, suppressed unhandled rejection on cancel |
| `doc/README.md` | Added this entry to change log index |

## Files Created
| File | Purpose |
|------|---------|
| (none) | |

## Test Results
```
 Test Files  1 passed (1)
      Tests  49 passed (49) — compositing-enhancements.test.ts

All compositing tests:
 Test Files  7 passed (7)
      Tests  124 passed (124)
```

## Verification Steps
1. Ran `npx vitest run tests/compositing/compositing-enhancements.test.ts` — 49/49 pass
2. Ran `npx vitest run tests/compositing/` — all 7 files / 124 tests pass
3. Ran `npx vitest run tests/compositing/compositing-enhancements.test.ts tests/js-language.test.ts` — 132/132 pass
4. Wrote and ran minimal `debug-parse.ts` to confirm regex issue
