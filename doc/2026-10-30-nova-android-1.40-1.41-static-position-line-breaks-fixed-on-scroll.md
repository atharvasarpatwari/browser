# Nova Android 1.40–1.41: Static Position, Shrink-to-Fit Blocks, Punctuation Line Breaks, Fixed Boxes Stay on Screen

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", the second round of the day. The phone came online mid-round ("device is online now"), so 1.40 was tested on the device and 1.41 fixes what that test found.
**Status:** Completed

---

## Summary
- **1.40:** absolutely and fixed positioned boxes with no inset on an axis stay at their **static position** (they were centred in their containing block). Shrink-to-fit now measures auto-width blocks by their content.
- **1.41**, from the device test of 1.40:
  - punctuation no longer wraps onto a line of its own ("exist" / "?");
  - `position: fixed` boxes stay on screen while the page scrolls, both drawn and tappable (they scrolled away with the page).

## Device test (Realme RMX5264, Android 16)
| Build | Test | Result |
|-------|------|--------|
| 1.40 | `adb install -r` over 1.38 | ✅ Success, versionName 1.40 |
| 1.40 | httpforever.com (https fails → http fallback) | ✅ Loads; frame 828 ms; ✅ theme switcher top-right (the 1.39 fix) |
| 1.40 | Same page, text | ❌ "Why does this site exist" with "?" alone on the next line; "…login screen" with "." alone → RC-3 |
| 1.40 | Same page after scrolling | ❌ The fixed switcher scrolled away with the content → RC-4 |
| 1.40 | Slanted white streaks at the top of the hero in one screenshot | Not reproducible: not in the engine's raster of the page, and gone in the next screenshot. Probably caught mid-scroll. |
| 1.41 | `adb install -r` | _see Test Results_ |

## Root Causes

### RC-1: No static position; vertical centring that left the children behind
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:**
- The positioned queue didn't record where an element sat in flow.
- `resolveOutOfFlow` centred boxes whose insets were all auto.
- After the height was known, `layoutSinglePositioned` re-centred the box vertically by changing `box.y` only, so its already laid-out children stayed behind.
- A dropdown with only `top: 100%` therefore landed mid-page.

**Fix:**
- Each `positionedQueue` entry carries `staticX`/`staticY`, the flow cursor where the element was skipped. All seven push sites set them.
- An axis with no insets takes the static position before the children are laid out:
  ```ts
  if (!isInsetSet(style, 'left') && !isInsetSet(style, 'right')) box.x = staticX + marginLeft;
  if (!isInsetSet(style, 'top') && !isInsetSet(style, 'bottom')) box.y = staticY + marginTop;
  ```
- The post-height vertical re-centring is deleted.
- Shrink-to-fit applies to every auto width except the stretched case (both `left` and `right` set).

### RC-2: Auto-width blocks measured as the full width
**File:** `layout-engine.ts` `contentExtent`
**Problem:** The measured extent used every descendant box's right edge. An auto-width block fills whatever it is given, so `<ul><li>One</li></ul>` measured as the full width. This affected positioned boxes, inline-blocks and flex bases.
**Fix:** A block-level box (`block`, `list-item`, `flex`, `grid`, `table`, `flow-root`) with auto width counts as its content's extent plus its right padding and border.

### RC-3: Line breaks allowed before "?", ".", "!", ")", "%" and "'s"
**File:** `src/browser/rendering/formatting/line-break.ts`
**Problem:** `findBreakOpportunities` added a break after any letter followed by a non-letter, and after every `)`, `!` or `?`. "exist?" became the segments `exist` and `?`, and the `?` wrapped alone. The same happened to "screen.", "it's" and "3.5%".
**Fix:**
- The breaker is rewritten as pair rules over adjacent classes (`canBreakBetween`), a simplified UAX #14:
  - mandatory breaks after BK/LF and lone CR, so CRLF breaks once (LB4–LB5);
  - no break before spaces (LB7) and never before closing punctuation, even after a space (LB13);
  - a break after spaces, except after `( ` (LB18, LB14);
  - no break before quotes, postfixes or hyphens, and none after an opening bracket, quote or prefix (LB16–LB21);
  - a break after a hyphen or dash, except before a digit (LB21, LB25);
  - no break between letter or digit and `(` (LB30);
  - a break around ideographs (LB31); letters and digits stay one word.
- `segmentText` splits trailing spaces into their own segment, so a line can still drop them where it wraps.

### RC-4: Fixed boxes were part of the scrolled page bitmap
**Files:** `src/browser/rendering/paint-engine.ts`, `layout-engine.ts`, `src/ui/pages/browser-window.ts`
**Problem:** A tall page is rasterized once, and scrolling only crops a viewport window out of the bitmap. Fixed boxes were painted into that bitmap, so they scrolled away. Taps used page coordinates, so they missed fixed boxes after a scroll.
**Fix:**
- Paint: `fixedElements` is every element in a fixed box. `compositeFrame('page' | 'fixed')` splits the paint between the page bitmap and a viewport-sized transparent `fixedOverlay`. Fixed boxes are laid out in viewport coordinates already, so no command translation is needed. Each scrolled crop gets the overlay blended on top with `blendOver`, a straight-alpha source-over. Short pages and pages without fixed boxes are unchanged.
- Hit testing: `getElementAtPoint(x, y, scrollY)` tests boxes inside a fixed box at `y - scrollY`. Taps and long-press pass the current scroll.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | `staticX`/`staticY` on positioned entries; static position; shrink-to-fit unless stretched; removed vertical re-centring; `contentExtent` measures auto-width blocks by content; `FILLS_LINE`; `getElementAtPoint(…, scrollY)` with `inFixedBox` |
| `src/browser/rendering/formatting/line-break.ts` | Pair-rule break opportunities (`canBreakBetween`, `NEVER_AFTER_SPACE`, `NO_BREAK_BEFORE`); trailing spaces as their own segment |
| `src/browser/rendering/paint-engine.ts` | `fixedElements`, `fixedOverlay`, `compositeFrame(part)`, `blendOver`, `isInFixedBox` |
| `src/ui/pages/browser-window.ts` | Tap and long-press hit tests pass the scroll |
| `tests/line-break.test.ts` | "hello!" has no break before "!"; CRLF breaks once; a run of spaces breaks once |
| `tests/example-domain-render.test.ts` | "too." is one word |
| `android/app/build.gradle` | 1.40 (41), then 1.41 (42) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/static-position-140.test.ts` | 5 tests: dropdown with `top: 100%` under its parent and shrink-to-fit; no insets → static position with children; `left` only → static y; segmentation keeps punctuation with words (and CJK still breaks); a fixed bar drawn and hit-tested at its viewport position after scrolling 1000 px |
| `Nova-1.40.apk`, `Nova-1.41.apk` | Signed builds |

## Still open
- The httpforever inline SVG logo, the white `.hero__wave` strip, the blurry Wikipedia wordmark and mask-image icons.
- CJK closing punctuation (、 。) is classified as ideographic, so a break before it is still allowed.
- The static position inside inline content uses the line's start, not the exact pen position.
- async generators / for-await, the drop-shadow filter, and generator `return()` with `finally`.

## Test Results
```
npx tsc --noEmit -> clean
npx vitest run tests/static-position-140.test.ts tests/line-break.test.ts tests/text-raster.test.ts -> 31 passed (31)
npx vitest run (positioning suites, 6 files) -> 102 passed (102)
npx vitest run (1.40) -> 10692 passed, 1 failed: search-performance timing gate during a concurrent Gradle build (16/16 alone)
npx vitest run (1.41) -> Test Files 1 failed | 295 passed (296), Tests 1 failed | 10694 passed (10695):
                         example-domain-render expected "too" + "." (intended change; updated, 37/37 pass)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK (1.40 and 1.41)
apksigner verify Nova-1.40.apk / Nova-1.41.apk -> Verifies; versionCode 41 / 42
adb install -r Nova-1.40.apk -> Success; versionName 1.40
```
