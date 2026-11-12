# Nova Android 2.11: The Ad-Block Test Scores 100% in Nova's Own Engine: Ad Scripts Blocked by File Name

**Date:** 2026-11-12
**Session:** "tablet is unlocked, continue testing" / "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Tested on the OnePlus Pad Go (OPD2305, Android 14, screen on and unlocked).

---

## Summary
The final 2.10 build was measured on the tablet first: the public ad-block test (adblock.turtlecute.org) scored 98% in Nova's own engine (it was 2% before 2.10's two promise fixes). The missing 2% was the two ad scripts the test site serves itself. The engine now blocks those by file name, as compatibility mode has since 2.09.

| OnePlus Pad Go, Nova's engine (compatibility mode off) | 2.09 | 2.10 | 2.11 |
|---|---|---|---|
| Test score | test does not run | 98% | **100%** |
| Shield count | – | 126 | 128 |

## Root Causes

### 1. The engine never blocked an ad script served from a site's own host
**File:** `src/browser/security/ad-blocker.ts` (`AdBlocker.shouldBlock`)
**Problem:** in the engine, `/js/widget/ads.js` and `/js/pagead.js` were fetched and run (2.10 log: `fetch#11`, `fetch#12`), so the test's two "Ad Scripts Loading" checks failed.
**Root cause:** `shouldBlock` matched host patterns only. The file-name rule added in 2.09 lives in `AdHosts.classify` (Kotlin), which only compatibility mode uses.
**Fix:** the same rule in the engine's blocker. It sits in `shouldBlock`, so it follows the blocker's on/off switch and every request path (scripts, fetch, XHR) gets it.

```ts
if (this._enabledCategories.has('banner') && /[/](ads|pagead)[.]js([?#]|$)/i.test(url)) {
  const rule: AdFilterRule = { pattern: '/ads.js', category: 'banner', description: 'Ad script by file name' };
  return { blocked: true, match: { rule, matchedPattern: 'ad-script-name', url } };
}
```

## Not changed (recorded)
- **The page's layout in the engine** is still wrong: the gauge's liquid shape is not clipped to its circle, and the box under it (the re-test buttons) is drawn empty. The score label is correct.
- **False positives:** the rule is name-based, as in 2.09. A site whose own non-ad script is called `ads.js` loses it.
- **On the OnePlus Pad**, `adblock.turtlecute.org` is still set to compatibility mode **off**.
- **realme tablet:** not connected, not tested.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/ad-blocker.ts` | ad scripts by file name (#1) |
| `android/app/build.gradle` | 2.10 (111) → 2.11 (112) |
| `doc/2026-11-11-nova-android-2.10-script-engine-fixes.md` | the tablet result of the final 2.10 build (98%) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/ad-script-name-211.test.ts` | `ads.js` / `pagead.js` blocked on any host; `uploads.js`, `roads.js`, `ads.json` not; nothing when the blocker is off. Fails with the source change reverted |
| `doc/img/2026-11-12-nova-2.10-ad-block-test-98-engine-oneplus-pad.png` | 2.10 result |
| `doc/img/2026-11-12-nova-2.11-ad-block-test-100-engine-oneplus-pad.png` | 2.11 result |

## Test Results
```
npx vitest run tests/ad-script-name-211.test.ts tests/ad-blocking-network-192.test.ts → 8 passed
  with src/ reverted (git apply -R): ad-script-name-211 → 1 failed
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 342 passed (342); Tests 11480 passed (11480)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.11.apk     → verified; versionCode 112, versionName 2.11

OnePlus Pad Go (OPD2305, Android 14), awake, Nova in front, audio MODE_NORMAL; adblock.turtlecute.org in the engine:
  2.10 final build → 98%; shield 126; no "Uncaught error" lines
       (doc/img/2026-11-12-nova-2.10-ad-block-test-98-engine-oneplus-pad.png)
  2.11 → install "Success"; 100%; shield 128
       (doc/img/2026-11-12-nova-2.11-ad-block-test-100-engine-oneplus-pad.png)
       logcat: "Failed to fetch external script: …/js/widget/ads.js Blocked by the ad blocker" and the same for /js/pagead.js;
               no "Uncaught error" lines
```
