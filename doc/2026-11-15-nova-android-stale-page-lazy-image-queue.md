# Nova Android: The Stale-Page Bug Was a Left Page's Lazy Images Blocking the Next Page's Fetch

**Date:** 2026-11-15
**Session:** "fix the stale page bug" (after the 1.96 20-site re-run, `doc/2026-11-08-nova-android-1.96-search-ad-blocking-google-search-parallel-scripts.md`)
**Status:** Completed. Reproduced and verified on the OnePlus Pad Go (Nova 2.16 with the temporary logging, then the fix).

---

## Summary
After a page such as BBC loaded, the next address (GitHub, CNN, NYTimes, Yahoo, Bing, DuckDuckGo, Apple, Microsoft, Netflix) showed the BBC page. The engine had started the new navigation but never got its document. BBC's page had hundreds of lazy images, and each one was a request through the same fetch queue. That queue ran about six at a time, each taking several seconds. The new page's document fetch joined the back of the queue behind all of them and waited for minutes. The renderer's lazy loader was never stopped when the page was left.

## Reproduction (temporary logging, `[ZZNAV]`, removed before the commit)
Debug build, Pad, sequence: open `https://www.bbc.com/`, wait 25 s, type `github.com` in the address bar, Enter.

| Time | Marker |
|---|---|
| 15:03:22.174 | BBC committed, route, middleware, fetch start |
| 15:03:22.622 | BBC fetch done, status 200 (0.45 s) |
| 15:03:22.623 | BBC render start |
| 15:03:31.853 | BBC render done (9.2 s) |
| 15:03:55.789 | `committed https://github.com/ prevSession=ready` |
| 15:03:55.868 | GitHub fetch start |
| (none) | GitHub fetch done: never, within 20+ s |

The bridge log over the same period shows `nova-bridge fetch#93`–`#116`: all `static.files.bbci.co.uk/.../grey-placeholder.png`, requested in batches of six, each resolved after roughly 5–8 s. A per-element log (the lazy loader's image start) showed about 70 distinct BBC images, each requested once; the batches were the old page's lazy images, not a loop.

## Root Causes

### 1. The lazy loader outlived the page it belonged to
**File:** `src/browser/engine/page-renderer.ts` (`render`, step 7; `stopPageScripts`)
**Problem:** the lazy-image observer was a local variable of `render()`. `stopPageScripts()` (called when a navigation commits) stopped timers and scripts, but not the observer. Images the old page had not yet loaded kept entering the fetch queue.
**Root cause:** no reference to the loader was kept, so nothing could stop it.
**Fix:** the loader is kept on the renderer (`this.lazyLoader`), disposed at the start of the next render, and disposed in `stopPageScripts()`, which runs when a navigation commits.

```ts
this.lazyLoader?.dispose();
const lazyLoader = new LazyLoader();
this.lazyLoader = lazyLoader;

stopPageScripts(): void {
  this.lazyLoader?.dispose();
  this.lazyLoader = null;
  // ...
}
```

### 2. Left-page loads still queued ahead of the next page (not changed)
The queued images that were already submitted when the page was left still run; only new ones are stopped. The fix stops the source. Cancelling already-queued loads, and giving a navigating document fetch priority over subresources, would be the next step if this recurs on another page.

## Not changed (recorded)
- **GitHub renders as a shell:** after the fix, GitHub's page loads but shows mostly empty boxes. The stale BBC page is gone; the empty GitHub layout is a separate rendering question, not this bug.
- **Other 9 sites:** not re-run after this fix. The 20-site list still needs the re-run for CNN, NYTimes, Yahoo, Bing, DuckDuckGo, Apple, Microsoft and Netflix, plus Stack Overflow (blank white page on the earlier run; not investigated).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | lazy loader kept on the renderer and disposed on navigation (#1) |
| `android/app/build.gradle` | not changed in this session (the debug build used the current version code) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/stale-lazy-loads-217.test.ts` | after `stopPageScripts()`, the page's lazy loader is disposed and the reference cleared; fails with the page-renderer change reverted |
| `doc/2026-11-15-nova-android-stale-page-lazy-image-queue.md` | this change log |

## Test Results
```
npx vitest run tests/stale-lazy-loads-217.test.ts          -> 1 passed; with page-renderer.ts reverted (git apply -R): 1 failed
npx tsc --noEmit -p .                                       -> clean
npx vitest run                                              -> Test Files 350 passed (350); Tests 11504 passed (11504)

OnePlus Pad Go (OPD2305), debug build with the fix (temporary ZZNAV logging removed afterwards):
  BBC then GitHub (typed in the address bar): GitHub committed, fetch start, fetch done status=200, render start/done
  before the fix: GitHub fetch start, no fetch done in 20+ s; screen kept the BBC page
```
