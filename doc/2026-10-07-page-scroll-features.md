# Scroll-to-Match for Ctrl+F and Auto-Scroll While Drag-Selecting

**Date:** 2026-10-07
**Session:** Last of three scrolling steps (engine → input + scrollbar → scroll-to-match)
**Status:** Completed — verified in the real Electron app

---

## Summary

Two features that needed a scrolling page:

- **Ctrl+F jumps to the match.** Typing a new query, or pressing Enter / Shift+Enter / ▲ ▼, scrolls the active match into view (centred, unless it is already inside the viewport with a tenth of the viewport as margin).
- **Drag-selecting scrolls the page.** Holding the button within 28 px of the top or bottom edge of the content area scrolls the page (faster the further into, or past, the edge) and keeps extending the selection into the new rows; moving back or releasing stops it.

## Design

- `FindBarView` now passes the event kind (`search` / `navigated` / `cleared`) to its `onChange` hook. `SearchIntegration.revealActiveMatch` scrolls only for a *step* (`navigated`) or a *search for a different query than last time*. The re-search that follows every repaint and every scroll is also a `search`, but names the same query, so it never pulls the page back to the match after the user scrolled away (the real-app test fails if every search reveals: the page was yanked back).
- `scrollToReveal(rect, view)` (`find-overlay.ts`) is the pure decision; the window's `scrollPageTo` does the scrolling. `SearchHost` gains `scrollTo`.
- `PageSelectionController` gets an optional `scrollBy` dependency, a 30 ms timer that runs only while the pointer is at an edge, and remembers the pointer so each tick re-resolves the text under it against the newly scrolled page.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/find-bar/find-bar.view.ts` | `onChange(result, kind)` |
| `src/ui/components/find-bar/find-overlay.ts` | `scrollToReveal`, `ScrollView.viewportHeight` |
| `src/ui/pages/search-integration.ts` | reveal rule, `scrollTo` on the host, `scrollBy` for selection |
| `src/ui/pages/browser-window.ts` | host `scrollTo` |
| `src/ui/components/page-selection/page-selection-controller.ts` | edge auto-scroll |
| `tests/page-scroll-controller.test.ts` (+3), `tests/page-selection-controller.test.ts` (+4) | reveal decision; auto-scroll (down/up/speed/stop/no scrollBy) |
| `tests/e2e/search-electron.spec.ts` | +1 end-to-end test (find reveal incl. "not undone by the re-search" and Enter stepping back; drag at the bottom edge) |
| `doc/2026-10-07-page-scroll-features.md` | this change log |

## Test Results

```
$ npx tsc --noEmit   → 0 errors
$ npx vitest run     → 262 files; 10,384 of 10,387 pass (the 3 known DnsResolver environmental timeouts)
$ npm run build:web; npx playwright test … "Ctrl+F scrolls to a match below the fold, and a drag held at the bottom edge…"  → passed
```

Mutation check in the real app: revealing on every re-search (instead of only for a new query) fails the e2e (`Expected: 0, Received: 67.26`).

The three clipboard-reading e2e tests noted in the previous change log could still not be re-run: the Windows clipboard was held by another application throughout this session's later runs (no Electron process of ours was alive; PowerShell's own `Set-Clipboard` failed).

## Not done

- Scroll-to-match scrolls only vertically (no horizontal scroll exists); a match inside an `overflow: auto` box is not scrolled to.
- Auto-scroll is vertical only and uses the content area's edges, not the page's.
