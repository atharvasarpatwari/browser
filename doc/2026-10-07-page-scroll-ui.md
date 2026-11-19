# Scrolling Rendered Pages: Wheel, Keys, Scrollbar, and Scroll-Aware Overlays

**Date:** 2026-10-07
**Session:** Second of three scrolling steps (engine → input + scrollbar → scroll-to-match)
**Status:** Completed — verified in the real Electron app (three clipboard-dependent e2e tests could not be re-run this time, see Test Results)

---

## Summary

Long pages now scroll. Over a rendered page:

| Input | Result |
|---|---|
| mouse wheel / trackpad | scrolls (pixels, lines or pages; Ctrl+wheel is left alone), coalesced to one scroll per frame |
| PageUp / PageDown / Space / Shift+Space / Home / End / ↑ ↓ | scroll (not with Ctrl/Alt/Meta, and not while focus is in a text field, button or link) |
| scrollbar on the right edge | thumb sized and placed by how much of the page is in view; drag it; click the track to page up/down |
| Back / Forward | return to where the page was left (step 1) |

Built-in `nova://` pages (real DOM) keep native scrolling; a page that fits shows no scrollbar.

## Design

- **`PageScrollController`** (`src/ui/components/page-scroll/page-scroll-controller.ts`): every route ends in one clamped `scrollBy`, which asks the window to `scrollPageTo(y)`: `paintEngine.setScroll(y)` then `notifyPageRepainted()`, so `NavigationFetcher` re-rasterises (a crop of the cached tall bitmap, step 1) and everything listening for repaints refreshes. Wheel and arrow distances are screen pixels converted to page pixels through the bitmap's scale.
- **Scroll-aware coordinates.** The page is taller than its bitmap, so find highlights, selections and hit-tests are in *page* coordinates and the bitmap shows them from `scrollY` down. `computeViewTransform(box, frame, scrollY)` carries the offset; `mapRect` subtracts it and `pointToFrame` adds it, so one change covers find highlights (and their scrollbar ticks, now scaled to the whole page), the selection overlay and drag mapping, and the right-click hit-test. `SearchHost.scroll()` and the controllers' `scrollY` dependencies feed it from the paint engine.
- Find highlights are redrawn on every repaint (they no longer wait for the throttled re-search).

## Root Causes

### 1. The scrollbar went missing after Back
**File:** `page-scroll-controller.ts`
**Problem:** showing another page replaces the content area's children, taking the scrollbar element with them, but the controller kept the reference and updated a detached element. Found by the real-app e2e (Back to a long page showed no scrollbar).
**Fix:** `ensureBar()` recreates the bar when it is no longer in the document; regression test.

## Measurements (real app)

Wheel event to the next frame on a 3,200 px page: median 17.3 ms, p90 19.0, max 21.0 — one display frame; the crop-and-copy itself is negligible. (Layout is still done once per page; the tall bitmap is rasterised once per content change.)

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/find-bar/find-overlay.ts` | `scrollY` in the view transform, `ScrollView`, scroll-aware tick marks |
| `src/ui/components/page-selection/page-selection-controller.ts`, `context-menu/page-context-menu.ts` | `scrollY` dependency |
| `src/ui/pages/search-integration.ts` | host `scroll()`, highlights redraw on repaint |
| `src/ui/pages/browser-window.ts` | creates the controller (desktop), `scrollPageTo`, scrollbar refresh, `scrollY` for the menu |
| `tests/find-bar.test.ts`, `page-selection-controller.test.ts`, `page-context-menu.test.ts` | transform shape; +1 scroll-aware test each |
| `tests/e2e/helpers/electron-app.ts`, `tests/e2e/search-electron.spec.ts` | `/tall` page; +1 end-to-end test |

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/components/page-scroll/page-scroll-controller.ts` | wheel, keys, scrollbar |
| `tests/page-scroll-controller.test.ts` | 25 (wheel conversions/coalescing/ends, keys and when they are ignored, scrollbar placement/drag/track/re-creation, scrolled view transform) |
| `doc/2026-10-07-page-scroll-ui.md` | this change log |

## Test Results

```
$ npx tsc --noEmit   → 0 errors
$ npx vitest run     → 262 files; 10,378 of 10,381 pass (the 3 known DnsResolver environmental timeouts)
$ npx playwright test … search-electron (all but the clipboard tests), smoke, keep-alive → all pass, incl.
  "a long page scrolls with the wheel, the keys and the scrollbar; clicks land on what is shown; Back restores the place"
```

Three e2e tests read the OS clipboard (`dropdown rows copy their link…`, `text on a rendered page can be selected…`, `right-clicking a rendered page…`). They failed in this run because the Windows clipboard was unusable on this machine at the time (a plain PowerShell `Set-Clipboard`/`Get-Clipboard` also failed; Electron's own `writeText` reported success but the main process read an empty string). They passed in earlier runs and none of their code paths changed except the coordinate mapping, which has its own unit tests; re-run them when the clipboard is healthy.

## Not done

- Scroll-to-match for Ctrl+F and drag auto-scroll (next step).
- `position: fixed`/sticky stay in the page; `window.scrollY`/`scrollTo` for page scripts; horizontal scroll; `overflow: auto` inner scrollers (the wheel scrolls the page even over them).
