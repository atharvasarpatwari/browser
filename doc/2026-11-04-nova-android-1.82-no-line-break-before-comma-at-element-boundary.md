# Nova Android 1.82: No Line Break Before a Comma at an Inline Element Boundary

**Date:** 2026-11-04
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html"
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
The round started with every check green:

| Check | Result |
|---|---|
| Vitest | 329 files, 11384 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

The work then took the defect recorded open in 1.81. On the Wikipedia article, a line started with a comma: "As of 2026 / , the most used browsers". The cause was one root cause in the inline formatting context, and it is fixed.

Saved real pages, old vs new code, 7 pages × 412/1070px (text runs and box geometry):
- 12 of 14 renders are identical.
- **Wikipedia article @1070:** "2026" now moves to the next line with its comma (the intended fix).
- **httpforever @412:** `http://` and `httpforever.com` sit in separate elements. They no longer split at the element boundary, which matches Nova's in-run rule of no break between `/` and a letter. The page is one line shorter.

## Root Causes

### 1. A text run starting at an inline element boundary could always start a new line
**File:** `src/browser/rendering/formatting/inline-context.ts` (`addTextRun`)
**Problem:** in `The most <span>As of 2026</span>, the most used browsers`, at certain widths the comma began the next line. The span's last word stayed on the line above.
**Root cause:**
- Break opportunities (UAX #14) are computed inside one text run only.
- When the first segment of a new run didn't fit, `addTextRun` took the "no break point" branch and started a new line, whatever character it began with.
- The pair across the run boundary (the span's "2026" and the parent's ",") was never checked. UAX #14 LB13 has no break before a comma (class IS), so the comma can't start a line.

**Fix:** new `carryNoBreakTail()`, used when a run's first segment doesn't fit.
- If the line ends in text and there is no break opportunity between its last character and the run's first, the trailing word boxes after the line's last space move to the new line, and the run continues after them.
- With no space to break at (a one-word line, or an atomic box before the word), the line overflows instead, as a real browser does.
- `ponytail:` the check covers a run boundary right after text. Text after an atomic inline still breaks as before.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/formatting/inline-context.ts` | `carryNoBreakTail()`: no break across a run boundary where UAX #14 forbids it (#1) |
| `android/app/build.gradle` | 1.81 (82) → 1.82 (83) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/line-break-element-boundary-182.test.ts` | 3 tests: the Wikipedia markup at widths 60–200 never starts a line with punctuation and "2026," moves together; a one-word line overflows rather than orphaning the comma; a break after a space at an element boundary is still allowed |

## Not changed (recorded)
- **MDN (live, from 1.80):** stray boxes after the navigation items, grey bars over the article, and the heading clipped at the left. This needs a saved MDN fixture to reproduce.

## Test Results
```
Start of round: npx vitest run → 329 files, 11384 passed; tsc exit 0; eslint 0 errors (1005 warnings); gradle unit tests exit 0
Probe (bisect): spanOnly / spanEmpty / spanSup / spanLink / full → all broke before "," at w=90,92
Debug: carry hook saw last box "2026" (boxes are per word) → walk back to the last space box
After fix: all five shapes → ok
npx vitest run tests/line-break-element-boundary-182.test.ts → 3 passed
npx vitest run                     → Test Files 330 passed (330); Tests 11387 passed (11387)
npx tsc --noEmit -p .              → clean
npx eslint src/ tests/             → 0 errors (1005 warnings)
Saved pages old vs new (7 × 412/1070) → wikipedia-article@1070 (intended), httpforever@412 (consistent with in-run rule); 12 identical
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.82.apk     → verified; versionCode 83, versionName 1.82
adb devices                        → none (not installed)
```
