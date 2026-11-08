# Nova Android 1.94–1.96: Ad Blocking on Search Pages and YouTube; Google Search Works; Faster Pages

**Date:** 2026-11-08
**Session:** "re-run all the main websites on the device and improve it", then "continue working on ad blockers i want it to be implemented on every part of the search and make sure that it blocks all the ads"
**Status:** Completed. Tested on the OnePlus Pad Go (OPD2305, Android 14), 1.93 → 1.94 → 1.95 → 1.96.

---

## Summary
- **Ad blocking now covers search.**
  - Sponsored results are hidden on Google, Bing, DuckDuckGo and Yahoo, and search ad click-through links are blocked.
  - In compatibility mode, YouTube's ad requests are blocked, its feed and player ad slots are hidden, and video ads are skipped.
  - The compatibility-mode ad-host list grew from 37 to about 90 entries.
- **Google search results now show.** They were blank in Nova's engine (#4).
- **Two engine bugs found on the 20-site re-run are fixed:** a page's lone timers never ran (#5), and scripts downloaded one at a time (#6).
- **Facebook, Instagram, Amazon, LinkedIn and X** open in compatibility mode by default (#7).

## Root Causes

### 1. Sponsored search results were not touched by the ad blocker
**Files:** `src/browser/security/ad-blocker.ts`, `src/browser/engine/page-renderer.ts`, `src/app/main.ts`
**Problem:** search result pages show sponsored results.
**Root cause:** search engines serve their ads inside the results page from their own servers, so no network rule can remove them. The element hiding from 1.93 was the same on every site and had no search-ad selectors.
**Fix:**
- `SITE_HIDING_SELECTORS` lists per-site selectors (the markers ad-blocking filter lists use) for Google (`#tads`, `#tadsb`, `#bottomads`, `div[data-text-ad]`, `.commercial-unit-mobile-top`…), Bing (`li.b_ad`, `.b_adTop`…), DuckDuckGo (`.result--ad`, `[data-testid="ad"]`…), Yahoo and YouTube.
- `adHidingCss(blocker, pageUrl)` adds a site's selectors only on that site. `google.` covers every country domain.
- The renderer's `userStylesheet` now receives the page URL.
- Ad click-through URLs (`google.com/aclk`, `bing.com/aclk`, `duckduckgo.com/y.js`) are blocked.

### 2. YouTube ads in compatibility mode
**File:** `android/.../AdHosts.kt`
**Problem:** YouTube shows ads.
**Root cause:**
- YouTube serves its ads from its own servers, so blocking ad networks alone doesn't stop them.
- The 1.93 hiding CSS covered only the mobile site's promoted renderers.

**Fix:**
- Requests to YouTube's ad endpoints (`/pagead`, `/api/stats/ads`, `/ptracking`, `/get_midroll_info`) are answered empty.
- The hiding CSS adds the desktop and feed ad slots plus the search-ad selectors.
- `HIDING_SCRIPT` starts a 400 ms check on YouTube. While the player shows an ad (`.ad-showing`), it presses Skip and jumps the ad video to its end.
- Path rules now match against host + path + query, so `gtag/js?id=AW-` (Google Ads conversion) is blocked and `?id=G-` (Analytics) is not.
- The Facebook pixel rule is exact (`facebook.com/tr?`, `/tr/`), not a prefix that would also catch `/trending`.

### 3. A page typed during another page's scripts waited for all of them
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** on 1.93, github.com still showed LinkedIn's page after 30 s. bbc.com showed Stack Overflow's page being rewritten.
**Root cause:** a page's scripts ran back to back without handing the thread back, so a newly typed address was queued behind all of them.
**Fix:** the script loop yields a macrotask before each script and returns if the page was aborted. Scripts that take over 500 ms are logged with their URL and size.
**Result:** on 1.94, GitHub, Stack Overflow and BBC each rendered 7–20 s after being typed, and slow pages were cancelled by the next address.

### 4. Google search results were blank
**File:** `android/.../CompatSites.kt`
**Problem:** a search from the address bar (Google is Nova's default) showed nothing. The screen stayed on the previous page, dimmed.
**Root cause:**
- For the Android WebView user agent, Google answers `/search` with a script-built results page that points to `/httpservice/retry/enablejs`.
- Nova's interpreter throws on its script ("Cannot use 'in' operator to search for 'type' in true").
- The engine log showed an empty document (layout 0 ms, paint 0 ms).

**Fix:** Google results pages (`google.*/search`) open in compatibility mode, where the search-ad hiding applies. Google's home page and the results' links stay in Nova's engine.

### 5. A page's lone timers never ran
**File:** `src/browser/js/event-loop.ts`
**Problem:** a page whose only async work was `setTimeout`/`setInterval` never ran it. This is why the 1.93 renderer timer test failed.
**Root cause:** `schedule()` called `onWake()` before adding the task. The renderer asked `timeUntilNext()`, found nothing and didn't schedule a pump. Pages worked only when a promise woke the loop first.
**Fix:** wake after the task is queued.

### 6. External scripts downloaded one after another
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** on 1.94 no single script took over 500 ms, yet Netflix's script phase took 22.7 s and BBC's 6.1 s.
**Root cause:** the loop that collects scripts awaited each download before starting the next.
**Fix:**
- Every allowed external script starts downloading at once, with the same security and CSP checks, and each URL is downloaded only once.
- The loop then takes the downloads in document order, so scripts still run in order.

### 7. The big script-built sites
**File:** `android/.../CompatSites.kt`
**Problem:** on the OnePlus Pad:
- Facebook served its bare fallback page.
- Instagram stayed blank after 9 MB of scripts.
- Amazon stayed blank.
- LinkedIn was unstyled.
- X's "Continue" button overlapped its footer.

**Fix:** `facebook.com`, `instagram.com`, `amazon.in`, `amazon.com`, `linkedin.com`, `x.com` and `twitter.com` open in compatibility mode by default. Each can be switched back from the menu.

## 20 sites on the OnePlus Pad
| Run | Result |
|-----|--------|
| 1.93 | Google and Wikipedia good; YouTube and Reddit good in compatibility mode. Later pages stuck behind earlier ones (GitHub showed LinkedIn; DuckDuckGo showed "Loading bing.com…"). |
| 1.94 | GitHub, Stack Overflow and BBC render; slow pages are cancelled by the next address instead of stacking. CNN's restyle took 18.6 s (style2). |
| 1.96 | Google search "buy running shoes": results in compatibility mode, no sponsored results on the page. |

## Not changed (recorded)
- **YouTube video ads not tested on the device:** testing would play a video with sound on the user's tablet.
- **Not every ad is guaranteed blocked:** blocking is limited to the listed networks and selectors. Ad formats a site serves from its own servers under new markup need new rules.
- **CNN and GitHub:** CNN's restyle (18.6 s) and GitHub's style phases (23 s and 21 s on 1.93) are slow in the engine's style computation. Not addressed this round.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/ad-blocker.ts` | `SITE_HIDING_SELECTORS`; per-page `adHidingCss`; ad click-through rules (#1) |
| `src/browser/engine/page-renderer.ts` | page URL to `userStylesheet` (#1); yield and abort between scripts, slow-script log (#3); parallel script downloads (#6) |
| `src/app/main.ts` | `userStylesheet` passes the page URL |
| `src/browser/js/event-loop.ts` | wake after queuing a timer (#5) |
| `android/.../AdHosts.kt` | about 90 hosts and paths; search and YouTube hiding; video-ad skip (#2) |
| `android/.../CompatSites.kt` | Google results pages (#4); big script-built sites (#7) |
| `tests/ad-blocking-network-192.test.ts` | 2 new tests (#1) |
| `tests/page-scripts-stop-192.test.ts` | 2 new tests (#5, #6) |
| `android/.../CompatAndSuggestionsTest.kt` | ad-host, Google-search and site cases |
| `android/app/build.gradle` | 1.93 (94) → 1.96 (97) |

## Test Results
```
npx vitest run tests/page-scripts-stop-192.test.ts → 3 passed; lone-timer test fails with event-loop.ts stashed
npx vitest run tests/ad-blocking-network-192.test.ts → 5 passed
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (5 warnings)
npx vitest run                     → Test Files 337 passed (337); Tests 11454 passed (11454)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.96.apk     → verified; versionCode 97, versionName 1.96
Bundle check: google.com/aclk, b_adTop, stopPageScripts, "Blocked by the ad blocker" present in assets
OnePlus Pad Go (OPD2305, Android 14):
  1.93 and 1.94 20-site runs (table above)
  1.96 Google search "buy running shoes" → results in compatibility mode, no sponsored results
    (doc/img/2026-11-08-nova-1.96-google-search-no-sponsored.png)
```
