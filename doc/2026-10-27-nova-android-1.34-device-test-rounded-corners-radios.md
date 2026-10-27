# Nova Android 1.34 — On-Device Test of 1.33, Rounded Corners Drawn, Radio Groups Repaint

**Date:** 2026-10-27
**Session:** "phone is unlocked, do the testing". On-device test pass of 1.33 on the Realme RMX5264, plus fixes for what it found.
**Status:** Completed (1.34 built and signed; the phone disconnected before it could be installed)

---

## Summary
1.33 was tested on the phone:
- POST forms submit (httpbin received the fields).
- Back/Forward to the result never resubmit.
- `http://neverssl.com` falls back from HTTPS to HTTP.

The test found two bugs, both fixed here:
- After picking a radio button, two still **looked** selected (the data was right).
- **No rounded corner was ever drawn**: radio buttons, rounded buttons, cards and pills all painted as squares.

## Device test (Realme RMX5264, Android 16, Nova 1.33)
| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Install 1.33 over 1.26 | ✅ | `adb install -r` → Success (the user approved the Realme prompt); versionName 1.33 |
| 2 | Start page, phone in dark mode | ✅ | Dark start page renders |
| 3 | Open https://httpbin.org/forms/post | ✅ | `[render] … layout2 4 · paint2 2 ms`; form fields, labels and button shown |
| 4 | Type into "Customer name" | ✅ | Keyboard opens; "NovaTest" appears in the field |
| 5 | Pick Medium, then Small (radios) | ❌ → fixed | Both looked selected and were drawn square (RC-A, RC-B) |
| 6 | Tick Onion, tap "Submit order" | ✅ | Logcat `fetch[4] POST https://httpbin.org/post`. httpbin echoed `form: {custname: "NovaTest", size: "small", topping: "onion", …}` and `Content-Type: application/x-www-form-urlencoded`, `User-Agent … NovaBrowser/1.33` |
| 7 | Back, then Forward to the result | ✅ | Back re-rendered the form (GET). Forward showed `httpbin.org/post` again with **no new fetch** (no resubmission) |
| 8 | `http://neverssl.com/` | ✅ (logs) | `fetch[6] GET https://neverssl.com/` → `[SecurityLayer] https://neverssl.com/ failed; falling back to http://neverssl.com/ (not secure)` → `fetch[7] GET http://neverssl.com/`. The screen locked before the page could be seen. |
| — | Phone locked twice (30 s timeout), then disconnected | — | Nova does not enter the PIN or change system settings; tabs after a restart, dark-mode pages and the Wikipedia logo were not re-checked on the device this round |

## Root Causes

### RC-A — A radio group showed two selected options
**Files:** `src/browser/rendering/form-controls.ts`, `src/ui/pages/browser-window.ts`, `src/browser/engine/browser-engine.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** `toggleControl` correctly unticked the other radios with the same name (httpbin received only `size=small`). The tap handler then redrew only the tapped control (`dispatchPageEvent` → `invalidatePaint(el)`), so the unticked radio kept its old pixels.
**Fix:**
- `toggleControl` returns every control whose state changed.
- The tap handler calls a new `repaintElement(el)` for each (renderer → `invalidatePaint` + `requestReflow`, exposed through the engine).

### RC-B — `border-radius` was never drawn
**Files:** `src/browser/rendering/borders-enhanced.ts`, `src/browser/rendering/paint-engine.ts`, `src/browser/rendering/rasterizer.ts`, `form-controls.ts`
**Problem (three layers):**
1. `parseBorders` read only the `border-radius` shorthand. The cascade expands it into `border-top-left-radius` and the other three longhands, so the radius was always 0.
2. The paint engine sent `setBorderRadius` only for elements that had a border, after their background, and never cleared it.
3. The rasterizer stored the radius in its state, and nothing ever used it.

**Fix:**
- `cornerRadii()` reads the four longhands (px or %, elliptical `a b`).
- The paint engine sends the radius **before** the element's background and clears it after its borders.
- `fillRectRaw` clips to the rounded box with `roundedCoverage()`. Corners are elliptical and anti-aliased across the curve, and radii are scaled down together when they would overlap (CSS Backgrounds §5.5).
- The checked radio's dot is drawn round.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/borders-enhanced.ts` | Radius from the longhands (`cornerRadii`) |
| `src/browser/rendering/paint-engine.ts` | Radius set before the background, cleared after the borders |
| `src/browser/rendering/rasterizer.ts` | Rounded, anti-aliased fills (`roundedCoverage`) |
| `src/browser/rendering/form-controls.ts` | `toggleControl` returns the changed controls; round radio dot |
| `src/ui/pages/browser-window.ts` | Repaints every control a tap changed |
| `src/browser/engine/browser-engine.ts` | `repaintElement` |
| `src/browser/engine/page-renderer.ts` | `repaintElement` |
| `android/app/build.gradle` | versionCode 35, versionName 1.34 |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/rounded-corners-radios.test.ts` | Rasterizer clips to the rounded box (anti-aliased) and stops after the radius is cleared; a rounded div renders with transparent corners; picking a radio returns the radio it unticked |
| `tests/fixtures/httpbin-form-2026/index.html` | httpbin's form (1.4 KB), used for the radio-group test |
| `Nova-1.34.apk` | Signed release build |

## Test Results
```
npx vitest run                                     -> Test Files 291 passed (291), Tests 10662 passed (10662), 296 s
npx vitest run tests/rounded-corners-radios.test.ts -> 3 passed (3)
npx vitest run (17 raster/paint/form/border/image files) -> 381 passed (381)
npx tsc --noEmit                                    -> clean
gradlew :app:assembleRelease + apksigner verify Nova-1.34.apk -> Verifies; versionCode 35, versionName 1.34
```

## Next on the device
Install 1.34 when the phone is reconnected, then check:
- radios and rounded corners;
- the neverssl page itself;
- tabs after a force-stop and relaunch;
- dark mode on example.com;
- the Wikipedia logo.
