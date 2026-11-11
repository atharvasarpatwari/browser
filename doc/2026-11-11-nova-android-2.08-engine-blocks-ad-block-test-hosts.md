# Nova Android 2.08: Nova's Own Engine Blocks the Ad-Block Test's Hosts Too

**Date:** 2026-11-11
**Session:** "keep improving the nova app and update analytics.html and try to get me the ad blocker working"
**Status:** Completed offline. **Not run on a tablet** (adb listed no devices), so neither 2.07's page-side fix nor this build has a device result yet.

---

## Summary
2.07 brought the compatibility-mode blocker (the system WebView) up to the public ad-block test's host list. Most pages are shown by Nova's own engine, which has separate lists. Measured against the same 126 hosts:

| Engine blockers (`AdBlocker` + `TrackerBlocker`) | Hosts blocked |
|---|---|
| 2.07 | 41 of 126 |
| 2.08 | **126 of 126** |

In the engine a blocked request already fails properly: `installNetworkAdBlocking` rejects the fetch, so there is no counterpart to 2.07's "blocked but looks successful" problem.

## Root Cause

### 1. The engine's lists lacked the same hosts the compatibility-mode lists had lacked
**File:** `src/browser/security/tracker-blocker.ts` (`DEFAULT_RULES`)
**Problem:** 85 of the test's 126 hosts were fetched normally by pages shown in Nova's engine.
**Root cause:** the two blockers keep separate lists (Kotlin `AdHosts` for the WebView, TypeScript rules for the engine). 2.07 added the missing hosts to the Kotlin side only. The engine's rules covered the big web ad networks and analytics services, not the ad and telemetry servers of platforms and phone makers (Yandex, TikTok, Yahoo, Apple, Samsung, Xiaomi, OPPO, realme, Huawei) or error/session reporting (Bugsnag, LuckyOrange, Freshmarketer).
**Fix:** 25 ad hosts (category `ad`) and 46 telemetry hosts (category `analytics`) added to `DEFAULT_RULES`, the same entries as `AdHosts.kt`. They count as ads and trackers in the per-tab shield. Entries are specific subdomains, so the sites themselves still load; the new test checks both directions.

## Not changed (recorded)
- **The two lists are still separate** and kept in step by hand (a comment in each points at the other). Generating one from the other is the upgrade if they drift.
- **`sentry.io`** was already blocked by an older engine rule; left as it was.
- **The test page itself** still cannot run in Nova's engine ("expression is not a constructor"), so the engine figure comes from the unit test, not from the page's score.
- **Device results outstanding:** the test score in compatibility mode with 2.07's document-start script.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/tracker-blocker.ts` | 71 rules from the ad-block test's host list (#1) |
| `android/app/build.gradle` | 2.07 (108) → 2.08 (109) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/ad-block-test-hosts-207.test.ts` | every test host is blocked by the engine; 13 ordinary sites are not |
| `tests/fixtures/ad-block-test-hosts.txt` | the test's 126 hosts |

## Test Results
```
Probe before the change: engine blockers missed 85 of 126 test hosts; after: 0
npx vitest run tests/ad-block-test-hosts-207.test.ts → 2 passed
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 340 passed (340); Tests 11471 passed (11471)
npx vite build; node android/scripts/copy-web.mjs → built, assets copied
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
node android/scripts/check-block-script.mjs tests/fixtures/ad-block-test-hosts.txt → ok: 130 blocked fetches rejected, 6 allowed passed
apksigner verify Nova-2.08.apk     → verified; versionCode 109, versionName 2.08
Device: none connected (adb listed no devices); not installed or run on a tablet.
```
