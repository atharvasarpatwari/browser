# Page Scroll State in the Paint Engine (tall bitmap, cropped)

**Date:** 2026-10-07
**Session:** First of three scrolling steps (engine → input + scrollbar → scroll-to-match)
**Status:** Completed (engine only; nothing scrolls on screen until the next step adds input)

---

## Summary

Pages were laid out at 1920 px wide but only the top 1080 rows were ever painted, so anything below the fold was lost. The paint engine now knows the document's height and a scroll offset, and returns the viewport-sized frame at that offset.

## Design decision (and what the plan got wrong)

The plan was to wrap the commands in `translate(0, -scrollY)` and repaint per scroll tick. The software rasteriser has **no `translate` support** (it stores translate fields but no command handler uses them, and shadows, filters, masks and text all draw in absolute pixels), so a translate would have been silently ignored. The unit test written for it caught this. Instead:

- A page taller than the viewport is rasterised **whole** once into a tall bitmap (`rasterHeight` = document height, at most `MAX_PAGE_HEIGHT` = 16,384 rows ≈ 126 MB at 1920 wide), cached until `paint()`/`paintIncremental()`/`resize()`/`updateConfig()` marks it stale.
- `rasterize()` returns a copy of the viewport-high window at the scroll offset: a scroll tick costs a memcpy, not a repaint.
- A page that fits the viewport takes the old path unchanged.
- `setScroll(y)` clamps to `[0, rasterHeight − viewport]`, rounds, ignores NaN/Infinity; `getScroll()` returns `{ y, max, viewportHeight, documentHeight }`; a repaint of a shorter page re-clamps.

## Also

- `NavigationFetcher` remembers each history entry's scroll offset when a navigation starts and restores it (or 0) when the next page is ready, so Back/Forward return to the same place and new pages start at the top. (Kept in the fetcher; the history entries' unused `scrollY` fields are untouched.)

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/paint-engine.ts` | `PageScroll`, `setScroll`/`getScroll`, document height, tall raster + crop, `MAX_PAGE_HEIGHT` |
| `src/ui/components/navigation-fetcher.ts` | scroll memory per history entry |
| `tests/page-renderer.test.ts`, `tests/security-runtime-enforcement.test.ts`, `tests/builtin-pages-engine.test.ts`, `tests/search-integration.test.ts` | paint-engine test doubles gain the new methods |

## Files Created

| File | Purpose |
|------|---------|
| `tests/page-scroll-engine.test.ts` | 9 tests: height/max, clamping, fits-viewport path, pixels at the right offset (red bar below the fold), exactness, render-once cache (mutation-checked), copy semantics, re-clamp, page-height cap |
| `tests/navigation-fetcher-scroll.test.ts` | 4 tests: new page at top, Back/Forward restore, repaint leaves scroll, built-in pages ignored |
| `doc/2026-10-07-page-scroll-engine.md` | this change log |

## Test Results

```
$ npx tsc --noEmit    → 0 errors
$ npx vitest run      → 261 files; 10,350 of 10,353 pass (the 3 known DnsResolver environmental timeouts)
```

## Not done (deliberately)

- **`position: fixed` / sticky stay in the page** (they scroll away with it): without a translate they cannot be pinned cheaply; a second composited pass would be needed.
- **`window.scrollY` / `scrollTo` / `scrollBy` / `innerHeight` and `scroll` events** for page scripts: the JS interpreter's `window` has no viewport properties at all, so this needs its own plumbing.
- Content below 16,384 px cannot be scrolled to; horizontal scroll; `overflow: auto` inner scrollers.
