# Nova Android 1.97–1.98: YouTube Ad Blocking Tested by Playing Videos; Video Ads Detected on Mobile YouTube; Ad-Blocker Logging

**Date:** 2026-11-08
**Session:** "make the ad blocker work and test on the youtube by playing a video in it … make sure all the ad are been removed"
**Status:** Completed. Tested on the realme tablet (RMX5264, Android 16) by playing 6 YouTube videos.

---

## Summary
Six popular music videos were played in Nova (compatibility mode) on the tablet. Five started straight on their own opening, with no ad. On one (*Shape of You*, first run) a short ad reached the player and was gone within about 4 s; by 17 s the video was playing.

That run showed the 1.96 skip code waited for a marker mobile YouTube doesn't always set (#1). 1.98 detects video ads by any visible ad marker (#1) and logs what the ad blocker blocks, hides and skips (#2). On 1.98 the second and third test runs (5 and 4 videos) blocked 1 and 19 ad requests, and no ad appeared on any video.

## Root Causes

### 1. A mobile YouTube video ad was only "skipped", never jumped past
**File:** `android/.../AdHosts.kt` (`HIDING_SCRIPT`)
**Problem:** during *Shape of You* on 1.97, the log showed "pressed Skip on a video ad" 14 times over 4 s, and the ad was never jumped to its end.
**Root cause:**
- The 1.96 script found the ad video through `.ad-showing video`, but m.youtube.com didn't put `.ad-showing` on the player.
- Only the Skip button was pressed, and it does nothing until YouTube's countdown ends (about 5 s).

**Fix:**
- Any of the player's ad markers (`.ad-showing`, `.ad-interrupting`, `.ytp-ad-player-overlay`, `.ytp-ad-text`, `.ytp-ad-preview-container`, `.ytp-ad-skip-button-container`, `.ytp-skip-ad`, `.ytm-ad-overlay`) now means an ad is playing.
- The player's video is muted and jumped to its end, or played at 16x while its length is unknown, and Skip is pressed.
- A marker counts only if it is on screen (`getClientRects().length`), so a leftover hidden one can't skip the real video.
- Each ad is logged once.

### 2. The ad blocker gave no evidence of what it did
**Files:** `android/.../ui/components/CompatWebView.kt`, `AdHosts.kt`
**Problem:** there was no way to tell from the device whether an ad had been blocked or had simply not been served.
**Fix:**
- Each intercepted request is logged as `NovaCompat: Blocked ad request: <host><path>`.
- The page script reports through `console.log("[nova-ad] …")`: how many ad slots it hid, and each video ad it removed. `onConsoleMessage` copies those lines to logcat.

## YouTube test (realme RMX5264, Nova in compatibility mode)
| Run | Videos | Result |
|-----|--------|--------|
| 1.97, run 1 | Despacito | Video from the first frame; no ad. 5 ad requests blocked (ptracking, pagead conversion, `static.doubleclick.net/instream/ad_status.js`, `googleads.g.doubleclick.net/pagead/id` ×2). |
| 1.97, run 2 | Shape of You; YouTube home | An ad reached the player: Skip pressed for 4 s, then the video played. 13 requests blocked. No sponsored cards in the feed or on the home page. |
| 1.98, run 3 | Despacito (others missed: the tablet turned to landscape and the taps hit the old address bar position) | No ad. 1 request blocked. |
| 1.98, run 4 | Shape of You, Gangnam Style, See You Again, Uptown Funk | Every video on its own opening at 5 s; no ad. 19 requests blocked: `googleads.g.doubleclick.net/pagead/id` ×8, `static.doubleclick.net/instream/ad_status.js` ×4, `m.youtube.com/ptracking` ×4, `youtube.com/pagead/viewthroughconversion` ×3. |

Screenshots:
- `doc/img/2026-11-08-nova-1.98-youtube-despacito-no-ad.png`
- `doc/img/2026-11-08-nova-1.98-youtube-gangnam-no-ad.png`

## Not changed (recorded)
- **The 1.98 jump has not yet run against a live ad:** no ad reached the player in run 4, so its effect on a playing ad is still to be confirmed.
- **Not every ad is guaranteed blocked:** YouTube changes its ad delivery and markup, and new formats need new markers.
- **Second device:** the user connected another device, but adb never listed it (likely an unaccepted USB-debugging prompt), so it was not tested.

## Files Modified
| File | Change |
|------|--------|
| `android/.../AdHosts.kt` | video-ad detection by visible ad markers; mute, jump and 16x; report lines (#1, #2) |
| `android/.../ui/components/CompatWebView.kt` | logs blocked requests; copies `[nova-ad]` console lines to logcat (#2) |
| `android/app/build.gradle` | 1.96 (97) → 1.98 (99) |

## Test Results
```
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0 (1.97 and 1.98)
apksigner verify Nova-1.97.apk / Nova-1.98.apk → verified; 1.98 = versionCode 99
1.98 install: first attempt INSTALL_FAILED_VERIFICATION_FAILURE (realme's check not approved in time); retried → Success
Device runs: table above (logcat NovaCompat, screenshots at 5/13/23 s per video)
```
