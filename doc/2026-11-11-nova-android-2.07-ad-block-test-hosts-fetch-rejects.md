# Nova Android 2.07: The Ad Blocker Covers the Public Test's Hosts, and a Blocked Fetch Now Fails in the Page

**Date:** 2026-11-11
**Session:** "keep improving the nova app and update analytics.html and try to get me the ad blocker working"
**Status:** Built and checked offline. **The final build has not been run on a tablet** (none was connected on 2026-11-11), so the tablet score with fix #2 is unknown. Later the same day the test was run on the Android emulator with 2.08 (same Android code): **97%, 126 of 130 blocked** (see the 2.08 change log).

---

## Summary
The ad blocker was measured with a public ad-block test (adblock.turtlecute.org, a fork of the archived d3ward test) in compatibility mode on the OnePlus Pad Go. It asks ~130 ad and tracker hosts for a page with `fetch` and counts a host as blocked only when the fetch **rejects**.

| Build | Requests Nova intercepted | Test score |
|---|---|---|
| 2.06 | 42 of 126 hosts | 8% (11 of 130; those hosts failed on their own) |
| 2.07 with the host lists only (#1), tablet | **126 of 126** (49 ads, 77 trackers; shield shows 126) | 0%: every intercepted fetch still resolved (#2) |
| 2.07 final (#1 + #2) | same | **not measured on a device**; offline, all 130 of the test's fetches reject |

## Root Causes

### 1. Most of the test's hosts were not on Nova's lists
**File:** `android/app/src/main/java/com/nova/browser/AdHosts.kt`
**Problem:** 84 of the test's 126 hosts loaded normally in compatibility mode.
**Root cause:** the lists held the big web ad networks only. Missing: ad and telemetry servers of platforms and phone makers (Yandex, TikTok, Yahoo, Apple, Samsung, Xiaomi, OPPO, realme, Huawei), and error/session reporting services (Bugsnag, Sentry, LuckyOrange, Freshmarketer).
**Fix:** about 25 ad hosts and 45 tracker hosts added. Entries are specific subdomains (`ads.pinterest.com`, `metrics.icloud.com`), so the sites themselves still load; a unit test checks both directions.

### 2. A blocked request still looked successful to the page
**Files:** `AdHosts.kt` (`BLOCK_SCRIPT`), `ui/components/CompatWebView.kt`
**Problem:** with every host intercepted, the test scored 0%: each `fetch` resolved.
**Root cause:** the WebView hands the page whatever `shouldInterceptRequest` returns as a response. Three answers were tried on the tablet and the page's `fetch` resolved with each:
- an empty 200 with a type (the 2.0 behaviour);
- a null body;
- no type and a body that throws when read (the test sends `HEAD`, so the body is never read).

The interception API has no "fail this request" answer.
**Fix:** a script runs before the page's own scripts in every frame (`WebViewCompat.addDocumentStartJavaScript`; on a WebView without that feature it runs from `onPageStarted`). It wraps `fetch`: a request to a listed host is still sent, so the native side blocks and counts it, and its result is turned into the rejection a network failure gives.

```js
window.fetch = function (i) {
  var u = i && i.url ? i.url : String(i);
  var r = f.apply(this, arguments);
  return bad(u) ? r.then(function () { throw new TypeError('Failed to fetch'); }) : r;
};
```

`bad()` uses the same matching rule as `AdHosts.classify` and the same lists.

## Not changed (recorded)
- **XHR, `sendBeacon`, images and script tags** to blocked hosts are blocked at the network level as before, but a page still sees them complete (empty). Only `fetch` reports failure. Add them if a site misbehaves because of it.
- **Nova's own engine** cannot run the test page ("expression is not a constructor"), so the test was run in compatibility mode. The engine's blockers were not changed, and the new hosts were not mirrored into `tracker-blocker.ts`.
- **On the OnePlus Pad**, `adblock.turtlecute.org` and `d3ward.github.io` were switched to compatibility mode from the menu for this test and are still set that way.
- Still open from earlier rounds: missing spaces in headings on the realme tablet; CNN's content placeholders.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/AdHosts.kt` | ad and tracker hosts from the test (#1); `BLOCK_SCRIPT` (#2) |
| `android/app/src/main/java/com/nova/browser/ui/components/CompatWebView.kt` | document-start script, `onPageStarted` fallback; `blockedResponse()` (#2) |
| `android/app/src/test/java/com/nova/browser/CompatAndSuggestionsTest.kt` | `adBlockTestHostsAreCovered`; writes the script for the Node check |
| `android/app/build.gradle` | 2.06 (107) → 2.07 (108) |

## Files Created
| File | Purpose |
|------|--------|
| `android/scripts/check-block-script.mjs` | runs `BLOCK_SCRIPT` in Node: listed hosts reject, ordinary ones pass, every request is still made |

## Test Results
```
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0, no output
node android/scripts/check-block-script.mjs %TEMP%\abt\hosts.txt → ok: 130 blocked fetches rejected, 6 allowed passed
apksigner verify Nova-2.07.apk → verified; versionCode 108, versionName 2.07
No TypeScript changed: vitest and tsc not re-run (last full run, 2.06: 339 files, 11469 passed).

OnePlus Pad Go (OPD2305, Android 14), 2026-11-10, adblock.turtlecute.org in compatibility mode:
  2.06                         → 8% (11 blocked, 119 not); log: 42 requests intercepted
  2.07, host lists only (#1)   → log: 49 ad + 77 tracker requests intercepted; shield badge 126;
                                 test 0% (0 blocked, 130 not) with each of the three answers in #2
  2.07 final (with #2)         → NOT RUN: adb listed no devices on 2026-11-11
```
