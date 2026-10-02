# Bookmarks/History/Downloads Panels Had a Hardcoded Light Theme, and a Touch-Invisible Remove Button

**Date:** 2026-09-16
**Session:** Follow-up to fixing "a new tab's content never rendered" — asked to make the (now-reachable) web UI "more functional." Exhaustively tested the real Nova Start Page on-device first (tile navigation, search, add-tile, remove-tile/customize, swipe carousels — all confirmed working correctly), then checked the other internal pages reachable from the same menu and found a real, visible bug in two of them.
**Status:** Completed

---

## Summary
`nova://bookmarks` and `nova://history` rendered with a jarring white header (title + search box) sitting directly above the rest of the app's actual dark theme — a hardcoded `background:#fff` and matching light-theme hex colors (`#202124`, `#e8eaed`, `#9aa0a6`, `#5f6368`, `#dfe1e5`, `#f1f3f4`, `#f8f9fa`) left over from before the app's real dark-glass theme existed, never updated when everything else (toolbar, tab strip, address bar, the new-tab page) was. Separately, and more seriously: the Bookmarks page's per-row remove button was `opacity:0` by default, revealed only via `mouseenter`/`mouseleave` — a touchscreen has no hover state at all, so that button was completely invisible and undiscoverable on Android; there was no way to remove a bookmark from that page on a phone. `nova://downloads` had a narrower version of the same theme issue (a handful of individual light-toned elements — a white "Clear all" button, light-grey borders and progress-bar track — rather than the whole page). Fixed all three to use the same CSS custom properties the rest of the app already uses, and made the remove button always visible (dimmed, full opacity on hover/focus) instead of hover-only.

## Root Causes

1. **Two internal pages were never migrated off an early hardcoded light theme.** `renderHistoryPanel()` and `renderBookmarksPanel()` in `browser-window.ts` set `background:#fff` directly on their sticky header and used a matching light palette throughout, while every other piece of chrome in the app (built or updated later) uses the app's real CSS custom properties (`var(--bg-body)`, `var(--text-primary)`, etc. — see `styles.css`), which resolve to the actual obsidian dark theme. These two panels were simply never brought forward when that theme was established, so they stuck out as a visibly different, older-looking part of the app — most obviously as a plain white bar at the top of an otherwise dark page. Replaced every hardcoded hex color in both with the equivalent design-token variable (with the original hex kept as the `var()` fallback, so nothing breaks if the token is ever missing).
2. **A remove button that only appears on mouse hover doesn't exist at all on a touchscreen.** The Bookmarks page's per-row `×` button was built with `opacity:0` and `mouseenter`/`mouseleave` handlers as its *only* way to become visible — correct enough on desktop, where hovering a row is how you'd discover it, but Android has no hover state to trigger at all, so the button was present in the DOM (and technically tappable, if you knew its exact pixel position) but completely invisible and undiscoverable. Changed it to a fixed `opacity:.55` by default (dimmed but clearly visible) that brightens to full opacity and gets a background highlight on hover — the same visual language as everything else in the app that already does this correctly (e.g. the new-tab page's own remove buttons), just applied consistently here too.

## Notes
- Found by testing systematically rather than guessing: every interactive feature on the actual Nova Start Page (`new-tab-page.ts`) — tile-tap navigation, search submission, the add-tile popover, remove-tile/customize mode, and swipe gestures on both carousels — was verified working correctly on the real device first. That page turned out to be comprehensively and correctly built already; the actual gaps were one level over, in the older sibling pages reachable from the same menu.
- `nova://settings` was checked too and found already correctly theme-aware (its two remaining literal `#fff` uses are a toggle-switch knob and white text on a colored button — both correct regardless of theme, not theme bugs).
- The Downloads page's own action buttons (pause/resume/cancel/remove, `opacity:0.6` by default) have the same hover-reveal pattern as the bookmarks fix above, but are far less broken by comparison — 0.6 opacity is already visibly present, just not at full brightness, so it wasn't treated as broken and left as-is rather than open-ended polishing beyond what was actually reported.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `renderHistoryPanel()` and `renderBookmarksPanel()`: replaced every hardcoded light-theme hex color with the app's real CSS custom properties; Bookmarks' remove button changed from hover-only (`opacity:0`) to always-visible (`opacity:.55`, full on hover) |
| `src/ui/pages/downloads-page.ts` | Replaced the container background/text color and several individual light-toned elements (clear-all button, empty state, group headers, row borders, meta text, progress bar) with the same design tokens |

## Files Created
- `doc/2026-09-16-bookmarks-history-panel-theme-and-touch-fix.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                → 0 errors (repo-wide)
npx vitest run (full suite)                                          → 223 files / 9256 tests passed (0 regressions)
Real device (Realme RMX5264)                                         → see Verification Steps
```

## Verification Steps
1. Systematically tested every interactive element of the real Nova Start Page on-device: tapped a real bookmark/history tile and confirmed it navigated and rendered the actual page; typed and submitted a search query and confirmed it reached the real search engine; opened the Add Tile popover, filled it in, and confirmed the new tile appeared in both the rail and the grid as a real, persistent bookmark; entered Customize mode and confirmed only removable (bookmark) tiles show a remove button, then removed one and confirmed it disappeared; swiped the insight carousel and confirmed it advances independent of the 7-second auto-advance timer (an initial false-negative test turned out to be an imprecise swipe coordinate, not a real bug — repeated with a coordinate solidly inside the card and confirmed it works).
2. Opened `nova://bookmarks` and `nova://history` from the main menu and found the white-header bug directly.
3. Traced both to their hardcoded-hex-color source in `browser-window.ts`, and found the Bookmarks remove button's hover-only visibility while reading the surrounding code.
4. Fixed both panels and `downloads-page.ts`'s narrower version of the same issue; ran the full `npx vitest run` (0 regressions).
5. Rebuilt the web bundle, copied it into the Android app, reinstalled, and — after carefully re-confirming Nova Browser was actually the focused app at each step (the device had briefly switched to other foreground apps during testing) — re-opened both pages and confirmed the dark theme now renders consistently throughout, matching the rest of the app.
6. Deleted all scratch verification screenshots before finishing.
