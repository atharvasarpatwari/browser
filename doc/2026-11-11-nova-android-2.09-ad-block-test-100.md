# Nova Android 2.09: The Ad-Block Test Scores 100%: Ad Scripts by Name and Generic Ad Boxes

**Date:** 2026-11-11
**Session:** "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Tested on the OnePlus Pad Go (OPD2305, Android 14, screen on and unlocked).

---

## Summary
2.08 scored 97% (126 of 130) on the public ad-block test (adblock.turtlecute.org) in compatibility mode. The 4 failing checks were not hosts: two ad scripts served by the test site itself and two ad-named boxes. Both kinds are now covered by generic rules.

| OnePlus Pad Go, compatibility mode | 2.06 | 2.07 (lists only) | 2.08 | 2.09 |
|---|---|---|---|---|
| Test score | 8% | 0% | 97% (126/130) | **100% (130/130)** |

## Root Causes

### 1. Ad scripts served from a site's own host were never blocked
**File:** `android/app/src/main/java/com/nova/browser/AdHosts.kt` (`classify`, `BLOCK_SCRIPT`)
**Problem:** the test's "Ad Scripts Loading" checks failed: `/js/widget/ads.js` and `/js/pagead.js` loaded and ran.
**Root cause:** `classify` matched only listed hosts (and a few host+path entries). A script named like an ad script on any other host passed.
**Fix:** a request whose path ends in `/ads.js` or `/pagead.js` is an ad, on any host (the filter lists' generic rules). The page-side script uses the same rule.

```kotlin
path.endsWith("/ads.js") || path.endsWith("/pagead.js") -> Kind.AD
```

### 2. Boxes with generic ad class names were not hidden
**File:** `android/app/src/main/java/com/nova/browser/AdHosts.kt` (`HIDING_CSS`)
**Problem:** the test's static and dynamic cosmetic checks failed: a box with classes such as `adsbox`, `textads`, `banner_ads` kept its height.
**Root cause:** the hiding rules named site-specific slots (Reddit, YouTube, search engines) and Google ad containers only.
**Fix:** `.adsbox, .textads, .banner_ads, .banner-ads, .ad-unit, .ad-zone, .ad-space, .afs_ads, .adbox` added.

## Not changed (recorded)
- **Compatibility mode only.** The engine's blockers were not changed this round; the test page still cannot run in Nova's engine.
- **realme tablet:** not connected, not tested.
- **False positives:** the two rules are name-based. A site whose own, non-ad script is called `ads.js`, or that styles real content with `.ad-unit`, would lose it. Reddit and YouTube were checked; nothing else.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/AdHosts.kt` | ad scripts by name (#1); generic ad-box classes (#2) |
| `android/app/src/test/java/com/nova/browser/CompatAndSuggestionsTest.kt` | `ads.js` / `pagead.js` blocked; `uploads.js`, `roads.js` not |
| `android/scripts/check-block-script.mjs` | the same cases for the page-side script |
| `android/app/build.gradle` | 2.08 (109) → 2.09 (110) |

## Test Results
```
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
node android/scripts/check-block-script.mjs tests/fixtures/ad-block-test-hosts.txt → ok: 132 blocked fetches rejected, 7 allowed passed
apksigner verify Nova-2.09.apk → verified; versionCode 110, versionName 2.09
No TypeScript changed: vitest and tsc not re-run (2.08: 340 files, 11471 passed).

OnePlus Pad Go (OPD2305, Android 14), screen on and unlocked:
  2.08 adblock.turtlecute.org → 97%; 126 of 130 blocked; shield 126
       (doc/img/2026-11-11-nova-2.08-ad-block-test-97-oneplus-pad.png)
  2.09 adblock.turtlecute.org → 100%; Total 130, 130 blocked; shield 128
       (doc/img/2026-11-11-nova-2.09-ad-block-test-100-oneplus-pad.png)
       logcat: 51 "Blocked ad request" (incl. adblock.turtlecute.org/js/widget/ads.js and /js/pagead.js) + 77 tracker;
               "[nova-ad] hid 1 ad slot(s) on adblock.turtlecute.org"
  2.09 www.reddit.com → feed loaded; 1 ad + 1 tracker request blocked; "hid 2 ad slot(s)"; no crash
  2.08 m.youtube.com → home page loaded; 2 ad requests blocked (not re-run on 2.09)
```
