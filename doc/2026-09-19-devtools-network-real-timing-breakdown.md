# DevTools Network Tab Got a Real DNS/Connect/TLS/Wait/Download Breakdown

**Date:** 2026-09-19
**Session:** Asked how DNS/TCP/TLS/HTTP actually work in a browser (following a separate conversation covering the same ground, which ended with a demo using `PerformanceResourceTiming` since a plain webpage can't run raw DNS/socket calls), then asked to make sure that understanding actually landed in this codebase. Went looking for the real implementation opportunity rather than just restating the explanation.
**Status:** Completed

---

## Summary
Nova's DevTools Network tab (the one actually shown when a user presses Ctrl+Shift+J) already logs every resource load — status, kind, URL, duration — but had no timing breakdown at all. Went looking for where that data could come from and found two things: a fully-built, well-designed `NetworkMonitor` class (`src/browser/networking/devtools.ts`) with exactly the right DNS/Connect/TLS-style marks and a HAR exporter — but it's part of an entirely separate DevTools architecture that's never wired into the running app (flagged separately, see Notes); and the real, wired network log had a single, well-established choke point (`ResourceLoader.loadResource()`) that already existed specifically for DevTools instrumentation.

Since Nova's real resource loading goes through plain `fetch()` (not a custom native socket stack) even inside Electron, the correct real source for DNS/Connect/TLS timing is the same one any web page would use: the browser's own Resource Timing API (`performance.getEntriesByType('resource')`) — the exact mechanism the source conversation's own demo was built on. Wired it into the existing, real Network tab: every logged request now carries a `timing` object, and clicking its row expands a small proportional bar plus labeled durations for DNS, Connect, TLS, Wait (TTFB), and Download — the same view a real browser's own DevTools "Timing" sub-tab shows.

## Root Causes
Not a bug fix — a real gap filled with real data, not a mock:

1. **The wired Network tab had a duration total but no phase breakdown, and nothing was capturing one.** `ResourceLoader.loadResource()` already had a single instrumentation point (`onLoad`, added for the original Network tab) but never asked the platform for the DNS/Connect/TLS split it makes available on every fetch. Added `computeResourceTiming(url)`, which looks up the matching `PerformanceResourceTiming` entry and derives `dnsMs`/`connectMs`/`tlsMs`/`ttfbMs`/`downloadMs`/`totalMs` from it, attached only when timing is real (never invented for cross-origin responses that don't send `Timing-Allow-Origin` — those fields come back `null`, exactly like a real browser's own DevTools would show).
2. **The Resource Timing buffer fills up and goes silent, and nothing here ever raised it.** Found this verifying the feature live: an unbundled Vite dev session alone racks up 250+ resource loads (every individual `.ts` module is its own fetch), which is exactly Chromium's default Resource Timing buffer cap — once full, the browser stops recording *any* new entries, silently, with no error. My own test navigation's timing came back completely missing until this was fixed. Raised the buffer once, lazily, via `performance.setResourceTimingBufferSize()` on first use — a real, if easy to miss, gotcha that would eventually bite any long-lived tab even in a packaged build, not just this dev environment.

## Notes
- While tracing where this data could come from, found the codebase actually has a second, much richer, but completely unwired DevTools architecture (`src/browser/networking/devtools.ts`'s `NetworkMonitor`, plus six more panel classes under `src/browser/devtools/` composed by `devtools-facade.ts` — Performance, Memory, Sources, Storage, Security, Accessibility — all fully tested, none of it ever constructed by `main.ts`). Flagged as a separate follow-up rather than pulled in here: reconciling two parallel DevTools implementations is a much bigger question (which one should win, or do they serve different purposes) than adding a timing column to the one that's actually running.
- Verified live, not just unit-tested: opened the real running app, navigated to a same-origin fixture, opened DevTools, and confirmed via direct DOM inspection that a real timing sub-row appears (hidden by default), shows the exact real numbers from that request (down to sub-millisecond precision), and toggles open/closed on click — and hit the Resource Timing buffer gotcha myself in the process, which is exactly why it's fixed here rather than just noted.
- Deliberately did not touch the row-eviction logic's *shape* beyond making it correct for the new two-DOM-node-per-entry case (a network entry can now be a row plus a hidden timing sub-row) — `MAX_NETWORK_ROWS` still counts logical entries, not DOM nodes, so eviction now removes both nodes of an evicted pair instead of leaving an orphaned sub-row behind for the next entry to mistakenly land next to.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Added `ResourceLoadTiming` type and `computeResourceTiming()`; `loadResource()` attaches `timing` to non-cache-hit results; raises the Resource Timing buffer size once, lazily |
| `src/ui/components/devtools-panel/devtools-panel.ts` | `DevToolsNetworkEntry` gained an optional `timing` field; `addNetworkEntry()` makes a row clickable when timing is present and appends a hidden `buildTimingRow()` sub-row (proportional bar + labeled phase durations) toggled on click; row-eviction now removes a timing sub-row alongside its entry |
| `tests/resource-loader.test.ts` | Added a `Network timing (DevTools)` suite: real breakdown from a mocked Resource Timing entry, no timing when no entry matches, no timing on a cache hit |

## Files Created
- `tests/devtools-panel-network-timing.test.ts` — new file: no sub-row without timing, a hidden sub-row with the right content when timing is present, click-to-toggle, and all-null timing treated as no timing
- `doc/2026-09-19-devtools-network-real-timing-breakdown.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                       → 0 errors (repo-wide)
npx vitest run tests/resource-loader.test.ts
  tests/devtools-panel-network-timing.test.ts                               → 21/21 passed (7 new)
npx vitest run (full suite)                                                  → 224 files / 9275 tests passed (0 regressions)
```

## Verification Steps
1. Read the real, wired DevTools Network tab (`devtools-panel.ts`, fed via `browser-engine.ts`'s `networkEntry` event from `ResourceLoader.setOnLoad`) and confirmed it has no timing breakdown — only status/kind/URL/duration.
2. Found `src/browser/networking/devtools.ts`'s `NetworkMonitor` already has the right shape for exactly this (DNS/Connect/TLS marks, a timing-breakdown computer, HAR export) but confirmed via grep that nothing in `main.ts` ever constructs or wires it — a separate, unwired architecture, not usable here without a much bigger reconciliation (flagged as a follow-up).
3. Confirmed `ResourceLoader`'s real HTTP transport is `FetchHttpClient` (plain `fetch()`, `redirect: 'manual'` so the fetched URL matches the Resource Timing entry's name exactly) — meaning the Resource Timing API, not a custom native socket layer, is the correct and only real source for this data.
4. Added `computeResourceTiming()` and wired it into `loadResource()`'s existing `onLoad` choke point; added the clickable timing sub-row to `devtools-panel.ts`.
5. Added unit tests (mocking `performance.getEntriesByType`) confirming the breakdown, the no-match case, and the cache-hit case; added a DOM-level test file for the panel's click-to-expand row.
6. Started a real dev server for this worktree specifically (confirmed by checking a source-level class name against the live DOM — a shared port on the machine turned out to be serving a different worktree's build), opened the actual running app, navigated to a same-origin test page, opened DevTools with Ctrl+Shift+J, and clicked into the Network tab.
7. Found the timing row wasn't appearing at all — traced it to the Resource Timing buffer already being full (250 entries, Chromium's default cap) purely from the dev server's own hundreds of unbundled module loads, before my own test navigation ever got a chance to be recorded. Added the one-time buffer-size raise, reloaded, and confirmed via direct DOM inspection: a real sub-row (`dnsMs: 0.4, connectMs: 2.7, tlsMs: null, ttfbMs: 2.5, downloadMs: 0.9, totalMs: 8.4`) appeared hidden, showed the exact right text, and toggled open on clicking its entry row.
8. Cleaned up the test fixture, the extra dev server, and reran the full suite for regressions.
