# Nova Android 1.47: DOMContentLoaded and load Fire; document.dispatchEvent Works

**Date:** 2026-10-30
**Session:** "install again and do all the tests". 1.46 was installed and tested on the phone. The colour-button test led to the page-load events.
**Status:** Completed (1.47 built and signed; the install waits until the user's phone call ends)

---

## Summary
On the phone, httpforever's colour button did nothing, for two reasons:
- **No load events.** Nova never fired `DOMContentLoaded` or `load`, so every script that sets up its UI in those events (a very common pattern) attached no handlers.
- **`document.dispatchEvent` was broken.** It threw for any event, because its capture walk wrapped the document node as if it were an element.

1.47 fires both events after the page's scripts, and fixes the dispatch.

## Device test (Realme RMX5264, Android 16, night mode) — 1.46
| Test | Result |
|------|--------|
| Install 1.46 | ✅ Success (versionCode 47) |
| httpforever.com | ✅ As in 1.45: card text, brand name, kickers; frame 773 ms |
| Reload (toolbar button) | ✅ Reloads; no CSP block (the 1.46 RC-1 fix) |
| Tap the colour button (page at rest) | ❌ Nothing changes; the hero stays green → RC-1, RC-2 |
| Wikipedia / example.com re-check | Not run: an incoming call (`mCallState` 1, then 2), so the phone was left alone |

## Root Causes

### RC-1: DOMContentLoaded and load were never fired
**File:** `src/browser/engine/page-renderer.ts` (script execution)
**Problem:**
- Nova ran the blocking, defer and async scripts, then stopped.
- `document.readyState` is always `'complete'`, but scripts that call `document.addEventListener('DOMContentLoaded', init)` or `window.addEventListener('load', …)` never got the event.
- httpforever registers its theme/colour click handlers that way.

**Fix:** After the scripts, in the same page environment:
```js
document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
window.dispatchEvent(new Event('load'));
if (typeof window.onload === 'function') window.onload(new Event('load'));
```
ponytail: `load` fires straight after `DOMContentLoaded`, not after the images finish.

### RC-2: document.dispatchEvent threw on the document node
**File:** `src/browser/js/dom-bindings.ts`
**Problem:**
- The capture-phase walk went from `<body>` up through `<html>` to the **document node** and wrapped each one with `wrapElement`.
- The document has no `tagName`, so this failed with "Cannot read properties of undefined (reading 'toLowerCase')".
- Every `document.dispatchEvent(...)` threw.

**Fix:** The walk stops at the first non-element.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | DOMContentLoaded, load and `window.onload` after the page's scripts |
| `src/browser/js/dom-bindings.ts` | `document.dispatchEvent` capture walk over elements only |
| `android/app/build.gradle` | 1.47 (48) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/page-events-147.test.ts` | 3 tests: DOMContentLoaded → load → onload, in order; `document.dispatchEvent` works; httpforever's colour button turns the page red (`data-color`, hero gradient `#d13438`) |
| `Nova-1.47.apk` | Signed build |

## Still open
- The on-device re-check of 1.46/1.47: the colour button, Wikipedia's figure and tables, and example.com dark text.
- Table columns are equal-width; grid auto rows don't stretch (the icon isn't centred vertically); `clamp()` in sizes.

## Test Results
```
npx tsc --noEmit                              -> clean
npx vitest run tests/page-events-147.test.ts  -> 3 passed (3)
npx vitest run                                -> Test Files 300 passed (300), Tests 10726 passed (10726)  (one assertion corrected: onload logs itself)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.47.apk                -> Verifies; versionCode 48, versionName 1.47
adb install -r Nova-1.46.apk                  -> Success
```
