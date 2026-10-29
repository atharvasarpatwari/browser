# Nova Android 1.42: Attribute-Value Selectors Matched Nothing

**Date:** 2026-10-30
**Session:** "installed, do the testing". On-device test of 1.41, which found that httpforever.com lost its card text in dark mode; the root cause was a CSS bug affecting every site.
**Status:** Completed (1.42 installed; the phone locked before the re-check)

---

## Summary
Every attribute selector with a value (`[type="text"]`, `a[href^="https"]`, `html[data-theme="dark"]`, `[lang|=en]`) silently matched nothing. The stylesheet wrapper re-serialized it with a doubled `=`. On a phone in night mode, httpforever.com's dark theme therefore half-applied: its text went light, but its cards stayed white, so the text vanished.

## Device test (Realme RMX5264, Android 16, night mode on)
| Build | Test | Result |
|-------|------|--------|
| 1.41 | `adb install -r` | ✅ Success, versionName 1.41 |
| 1.41 | httpforever.com | ✅ Loads (https → http fallback), frame 777 ms; ✅ switcher top-right; ❌ **cards empty**: white text on white cards → RC-1 |
| 1.41 | White slanted streaks in the top ~12 CSS px of the hero | ❌ Seen again on a fresh load, so not a scroll artifact. Not in the engine's raster (checked at DPR 1 and 1.7 in light and dark), not from `putImageData` (whole frame), not a shell progress bar. Still open. |
| 1.42 | `adb install -r` | ✅ Success, versionName 1.42; the phone then slept and locked, so the re-check is pending |

## Root Causes

### RC-1: `[attr="v"]` was written back as `[attr=="v"]`
**File:** `src/browser/rendering/css-parser.ts` (selector serializer)
**Problem:**
- The css5 parser stores the operator with its `=` (`'='`, `'^='`, `'~='` …).
- The wrapper that turns parsed rules into selector strings appended `="value"` after the operator, producing `html[data-theme=="dark"]`.
- Re-parsing that string gives a compound that never matches. Every rule with an attribute value was dropped; `[attr]` alone still worked.

In httpforever's case:
- the script set `data-theme="dark"` (night mode);
- `html[data-theme="dark"] { --ink; --card }` never applied, so the cards stayed `#fff`;
- the 1.38 dark default text (CanvasText → white) then reached the paragraphs, giving white on white.

**Fix:** The value is written once, quoted and escaped, and the case-insensitive flag is kept:
```ts
const val = `"${(attr.value ?? '').replace(/[\\"]/g, '\\$&')}"`;
result += `[${attr.name}${attr.operator}${val}${attr.caseInsensitive ? ' i' : ''}]`;
```

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css-parser.ts` | Attribute selector serialization (no doubled `=`, escaped value, `i` flag) |
| `tests/static-position-140.test.ts` | +2 tests: `[attr="v"]`, `[attr\|=v]`, `[attr^="v"]`, `[attr~=v i]` and escaped quotes all match; httpforever in dark mode has dark cards (`#191d1a`) and light body text (`#e9efea`) |
| `android/app/build.gradle` | 1.42 (43) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `Nova-1.42.apk` | Signed build (installed) |

## Still open
- The white streaks at the top of httpforever's hero on the phone (see the device test).
- Pending re-check on the phone: dark cards on httpforever, the switcher staying pinned while scrolling, and "exist?" on one line.

## Test Results
```
npx tsc --noEmit                                      -> clean
npx vitest run tests/static-position-140.test.ts      -> 7 passed (7)
npx vitest run                                        -> Test Files 296 passed (296), Tests 10697 passed (10697)
gradlew :app:testDebugUnitTest :app:assembleRelease   -> BUILD OK
apksigner verify Nova-1.42.apk                        -> Verifies; versionCode 43, versionName 1.42
adb install -r Nova-1.42.apk                          -> Success; versionName 1.42
```
