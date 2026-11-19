# Nova Android 1.45: Inline Flex Items Keep Their Text, `place-items` Expanded

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", then "install" and "install again and do all the tests". These fixes follow the open items from the 1.43 phone screenshots (httpforever's blank brand name and its off-centre theme icon).
**Status:** Completed (built and signed; 1.44 is on the phone, the 1.45 install failed because the phone disconnected)

---

## Summary
- **Flex items:** any inline element that is a flex item (`<div style="display:flex"><span>Hello</span></div>`, the "HTTP Forever" brand name in an `inline-flex`) painted **no text**. Items moved by `align-items` also left their content behind.
- **`place-*` shorthands:** `place-items`, `place-content` and `place-self` were never expanded, so `place-items: center` did nothing.

## Device log
| Build | Step | Result |
|-------|------|--------|
| 1.44 | `adb install -r` (twice) | ❌ "failed to install" with no reason: the phone was locked, and the prompt was dismissed or timed out |
| 1.44 | Installed by the user | ✅ versionCode 45 on the phone |
| 1.45 | `adb install -r` | ❌ The phone disconnected (`adb devices` empty); the re-check of 1.44/1.45 is pending |

## Root Causes

### RC-1: The flex reposition step rebuilt each item's box without its text runs
**File:** `src/browser/rendering/layout-engine.ts` (`layoutFlexContainer`, final positioning)
**Problem:**
- After the flex algorithm, every item's `LayoutBox` was replaced by a new object that listed the geometry fields but not `textRuns`.
- An inline item keeps its own text as runs on its box, so its text vanished.
- The box also moved (cross-axis alignment) without moving the content that `layoutNode` had already placed inside it.

**Fix:**
```ts
this.translateContent(item.element, finalX - box.x, finalY - box.y);
const newBox: LayoutBox = { ...box, x: finalX, y: finalY, height: item.hasDefiniteCrossSize ? box.height : item.crossSize };
```

### RC-2: `place-items` / `place-content` / `place-self` not expanded
**File:** `src/browser/rendering/css5/cascade.ts` `expandShorthands`
**Problem:** Layout reads `align-items`/`justify-items` (and the content/self pairs), but the shorthands stayed as they were.
**Fix:** `place-X: <align> [<justify>]` expands to `align-X` and `justify-X`; one value sets both.

## Still open
- **Vertical centring in a grid:** a grid with a definite height and auto rows doesn't stretch the rows (`align-content: normal`), so the theme icon is centred horizontally but still at the top of its button.
- httpforever's brand mark lays out at 12 px instead of `clamp(2.2rem, 6vw, 3rem)`: `clamp()` in a replaced element's CSS size.
- The white streaks at the top of the hero.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | Flex items keep their box fields (text runs) and their content moves with them |
| `src/browser/rendering/css5/cascade.ts` | `place-items` / `place-content` / `place-self` expansion |
| `android/app/build.gradle` | 1.45 (46) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/flex-items-145.test.ts` | 4 tests: a span in flex/inline-flex paints its text (with NBSP and an SVG sibling); a centred item carries its content; the `place-*` expansions; a grid item centred horizontally |
| `Nova-1.45.apk` | Signed build |

## Test Results
```
npx tsc --noEmit                              -> clean
npx vitest run tests/flex-items-145.test.ts   -> 4 passed (4)
npx vitest run                                -> Test Files 299 passed (299), Tests 10716 passed (10716)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.45.apk                -> Verifies; versionCode 46, versionName 1.45
adb install -r Nova-1.45.apk                  -> failed: device disconnected
```
