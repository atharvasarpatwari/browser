# Nova Android 1.99–2.0: Per-Tab Counts of Blocked Ads and Trackers; Tracker Blocking Everywhere; Page-Inserted Scripts and `on…` Handlers Work

**Date:** 2026-11-08
**Session:** "i want to know how many ads have been blocked in the specific tab keep a count of it and also block the trackers and keep a count of them too"
**Status:** Completed.
- 1.99 and 2.0 were verified on the realme tablet (RMX5264).
- 2.01 adds Cloudflare Web Analytics to the tracker lists and was verified on the OnePlus Pad Go (OPD2305).

---

## Summary
Every tab now keeps a count of the ads and the trackers blocked in it.
- A shield with the total sits in the address bar. Tapping it, or the menu's "Blocked here: N ads · M trackers", shows the breakdown.
- Trackers are now blocked everywhere: in Nova's engine (page `fetch`/XHR too), and in compatibility mode, which gained a tracker list of its own.

On the tablet, a YouTube tab showed **6** in the shield and **Ads: 4, Trackers: 2** in the breakdown, matching the device log exactly.

programiz.com, an engine page whose ads are injected by script, showed no count. That traced to two engine gaps, fixed in 2.0:
- scripts a page inserts were never loaded (#3);
- `on…` event-handler properties never fired (#4).

## Root Causes / Changes

### 1. No per-tab counts, and trackers unchecked on page requests
**Files:** `src/browser/security/ad-blocker.ts`, `src/ui/pages/browser-window.ts`, `src/app/main.ts`
**Problem:**
- Nothing counted blocked requests per tab.
- The tracker list was checked only for sub-resources the ResourceLoader fetched, so a page's own `fetch`/XHR beacons to analytics went out.

**Change:**
- `installNetworkAdBlocking(..., { trackers, onBlocked })` checks the ad rules, then the tracker list, for every request the engine sends. Each stop is reported as `ad` or `tracker`, and tracker-list rules in the `ad` category count as ads.
- `BrowserWindowPage.recordBlocked(kind)` counts against the active tab.
- The chrome-state snapshot carries `blocked: { ads, trackers }` per tab. Bursts are pushed once per 250 ms, and closed tabs are pruned.
- Ad-list stops are counted from the wrapper. Tracker-list stops, wherever they happen (wrapper or ResourceLoader), are counted from the tracker blocker's `requestBlocked` events, so nothing is counted twice.
- The ResourceLoader keeps its own tracker check, because desktop may use a raw-socket client that doesn't go through `fetch`.

### 2. Compatibility mode: tracker list, counts and display
**Files:** `android/.../AdHosts.kt`, `CompatWebView.kt`, `BrowserViewModel.kt`, `model/Tab.kt`, `ui/BrowserScreen.kt`, `ui/components/BottomChrome.kt`
**Change:**
- `AdHosts.classify(url)` returns `AD`, `TRACKER` or null.
  - The ad list is the earlier one.
  - The new tracker list covers analytics (Google Analytics and Tag Manager, Segment, Mixpanel, Amplitude, Heap), session recording (Hotjar, Clarity, FullStory, Mouseflow, Crazy Egg), measurement (comScore, Chartbeat, Moat, DoubleVerify, IAS), social pixels (Facebook, TikTok, X, LinkedIn, Reddit), mobile attribution, and YouTube's `ptracking`/`stats/atr`.
  - `gtag/js?id=AW-` (Google Ads) is an ad; `?id=G-` (Analytics) is a tracker.
- The compatibility WebView answers both kinds with an empty response and counts each for its tab (`recordCompatBlocked`, posted to the main thread).
- `Tab` carries the engine counts. `blockedFor(tabId)` adds the compatibility-mode counts.
- `BottomChrome` shows a green shield with the total (999+ above 999). Tapping it opens the "Blocked in this tab" dialog (ads, trackers, what each means). The menu has a "Blocked here" line.

### 3. Scripts a page inserted were never loaded
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** programiz.com loads its ad scripts with `injectPgScript(...)` (`document.createElement('script')`). The engine never requested them, so there was nothing to block or count. Lazy-loaded widgets and analytics on many sites were missing the same way.
**Root cause:** only the parsed document's `<script>` elements ran. Nothing watched for scripts added later.
**Change:**
- `runInsertedScripts()` runs after the load events and after each event-loop pump that changed the DOM.
- Each new `<script>` runs once:
  - inline ones directly;
  - external ones through the same security/CSP checks and the network blockers.
- `load` or `error` fires on the element, as loaders expect.
- JSON, template and module types are skipped.
- `stopPageScripts` clears the context.

### 4. `on…` event-handler properties never fired
**File:** `src/browser/js/dom-bindings.ts` (`invokeDomListeners`)
**Problem:** in the #3 test, `script.onload = fn` never ran.
**Root cause:** the DOM dispatcher called only `addEventListener` listeners. `el.onclick`, `img.onerror`, `script.onload` and every other handler property were ignored.
**Change:**
- In the target and bubble phases, the current node's `on<type>` handler runs after its listeners.
- A `false` return prevents the default.
- Window events use a separate dispatcher, so `window.onload` (called explicitly after `load`) doesn't run twice.

### 5. Protocol-relative script addresses
**File:** `src/browser/engine/page-renderer.ts` (`resolveUrl`)
**Problem:** `//pagead2.googlesyndication.com/...` was returned unchanged, which is not an address `fetch` can use.
**Change:** it now resolves against the page, taking its scheme.

### 6. A tracker the lists missed (2.01)
**Files:** `src/browser/security/tracker-blocker.ts`, `android/.../AdHosts.kt`
**Problem:** on 2.0, programiz.com counted 2 ads and 0 trackers, but the request log showed `static.cloudflareinsights.com` (Cloudflare Web Analytics' beacon) going out.
**Change:** `cloudflareinsights.com` was added to both tracker lists, engine and compatibility mode. On 2.01 the beacon no longer appears in the request log and counts as a tracker.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/ad-blocker.ts` | trackers and `onBlocked` in the network wrapper; `BlockedKind` (#1) |
| `src/ui/pages/browser-window.ts` | per-tab `blocked` counts; `recordBlocked`; batched pushes (#1) |
| `src/app/main.ts` | wires trackers and counting (#1) |
| `src/browser/engine/page-renderer.ts` | inserted scripts (#3); protocol-relative URLs (#5) |
| `src/browser/js/dom-bindings.ts` | `on<type>` handlers (#4) |
| `android/.../AdHosts.kt` | `classify`, tracker list (#2) |
| `android/.../ui/components/CompatWebView.kt` | blocks and counts ads and trackers (#2) |
| `android/.../BrowserViewModel.kt` | snapshot counts; compatibility counts; `blockedFor` (#2) |
| `android/.../model/Tab.kt` | `adsBlocked`, `trackersBlocked`; `BlockedCounts` (#2) |
| `android/.../ui/components/BottomChrome.kt` | shield badge (#2) |
| `android/.../ui/BrowserScreen.kt` | breakdown dialog; menu line (#2) |
| `tests/ad-blocking-network-192.test.ts` | ad vs tracker reporting test |
| `tests/android-native-bridge.test.ts` | per-tab counting test |
| `tests/page-scripts-stop-192.test.ts` | inserted scripts, onload and `//` test |
| `android/.../CompatAndSuggestionsTest.kt` | tracker classification test |
| `src/browser/security/tracker-blocker.ts` | Cloudflare Web Analytics rule (#6) |
| `android/app/build.gradle` | 1.98 (99) → 2.01 (102) |

## Test Results
```
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (14 warnings)
npx vitest run                     → Test Files 337 passed (337); Tests 11457 passed (11457)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0 (1.99 and 2.0)
apksigner verify Nova-1.99.apk / Nova-2.0.apk → verified (2.0 = versionCode 101)
realme RMX5264, 1.99:
  YouTube (Gangnam Style) in a new tab → shield "6"; dialog "Ads: 4, Trackers: 2"; log: 4 "Blocked ad", 2 "Blocked tracker"
    (doc/img/2026-11-08-nova-1.99-shield-count-youtube.png, doc/img/2026-11-08-nova-1.99-blocked-breakdown.png)
  programiz.com in a new tab → no shield (ad scripts injected by script, never requested → #3, #4 in 2.0)
2.0 install: realme's install check timed out twice, then was approved
realme RMX5264, 2.0: programiz.com → shield "2"; dialog "Ads: 2, Trackers: 0"; cloudflareinsights still fetched → #6
npx vitest run (2.01)              → 11457 passed; 1 failed = DnsResolver "localhost" (2 s timeout under full-suite load;
                                     passed 2/2 alone; uses the computer's real DNS, unrelated)
OnePlus Pad Go (OPD2305), 2.01 (1.96 → 2.01, no install prompt):
  programiz.com → shield "2"; dialog "Ads: 1, Trackers: 1" (the beacon blocked; absent from the request log)
    (doc/img/2026-11-09-nova-2.01-programiz-breakdown.png)
  YouTube (See You Again) in a new tab → shield "5" = log 3 ads + 2 trackers; video plays, no ad
    (doc/img/2026-11-09-nova-2.01-youtube-tab-count.png)
```
