# Nova Start Page — New New-Tab-Page Design, Wired to Real Bookmarks/History

**Date:** 2026-09-14
**Session:** Implemented a shared Claude-canvas artifact ("Nova Start Page" — a glassmorphic bookmarks-rail/quick-links-carousel/search/insights/stats design) as the browser's real `about:newtab`/`nova://newtab` page, replacing the previous `NewTabPage` implementation while keeping its public interface unchanged so `browser-window.ts`'s wiring needed only two new lines.
**Status:** Completed

---

## Summary
Rewrote `src/ui/pages/new-tab-page.ts` end-to-end to match the given design (blob-gradient background, glass panels, big live clock, a bookmarks rail, a paginated quick-links grid with add/remove, a search pill, a rotating insight carousel, and a live stats strip), sourcing every tile from the browser's real `BookmarkEntry`/`HistoryEntry` data instead of the artifact's own demo/localStorage-backed state. Along the way, found and fixed a real, pre-existing bug in the page's own event system that the new add/remove flow immediately exposed: event handlers were never actually filtered by event kind, so adding a tile silently navigated the tab away too.

## Root Causes
1. **`on()`/`emit()` never filtered by event kind — every handler received every event.** `on(type, handler)` pushed `handler` onto one flat array without recording `type` at all, and `emit(event)` broadcast to that entire array regardless of `event.kind`. This bug **predates this session** (the previous implementation had the identical flat-array pattern) but was latent: the old page's `'tileAction'` events for `openInNewTab`/`remove` happen to carry a `url` field too, so they were *already* silently triggering the `'navigate'` handler (`if (event.url) this.navigate(event.url)`) on top of their own intended effect — plausibly why "open in new tab" also seemed to navigate the current tab underneath it. It became impossible to ignore once this session added an `'add'` tileAction (create a bookmark from the new "Add tile" popover): submitting the form correctly emitted `{kind:'tileAction', action:'add', url}`, but because `emit()` didn't check `kind`, the `'navigate'` handler *also* fired and immediately navigated the new-tab page away to the URL the user had just tried to bookmark. Root-caused by tracing a live repro end-to-end (adding `console.log`/stack traces through the emit → handler → `navigate()` call chain) rather than guessing, since the symptom ("submitting a form navigates the page") gave no indication the bug was in event *dispatch* rather than in the form or the bookmark-creation code. Fixed by keying `handlers` on event kind (`Map<NewTabPageEventType, Set<Handler>>`), so `emit()` only ever invokes handlers registered for that specific kind.
2. **`<input type="url">` rejected the exact input the surrounding code was written to handle.** The add-tile popover's URL field used `type="url"`, whose native browser validation requires a value with an explicit scheme — so typing a bare domain like `example.org` (which the submit handler's own normalization logic, `if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url`, exists specifically to accept) was rejected by the browser *before* that handler ever ran, showing a native "Please enter a URL" bubble instead of submitting. Fixed by using `type="text"` (with `inputmode="url"` for on-screen-keyboard hinting) and leaving validation to the existing normalization code, which already handled bare domains correctly.

## Notes
- The artifact's own quick-links/bookmarks-rail data and "Customize tiles" add/remove flow were backed by `localStorage` and demo placeholder tiles (`Inbox`, `Calendar`, `Drive`, …). Ported the *design*, not that data model: both the rail and the grid now render the user's real bookmarks (`setBookmarks()`), the grid also blends in a few real frequently-visited pages (`setHistoryEntries()`) as read-only tiles (no remove button, since clearing one wouldn't erase history), and "Add tile" creates a real bookmark via `IBookmarkService.addBookmark()` — removing a tile removes that real bookmark. This required adding a third `tileAction` action (`'add'`, carrying `title` alongside the existing `url`) to the event contract, and two new lines in `browser-window.ts` to handle it (plus refreshing the displayed data after add/remove, which the pre-existing `'remove'` handling never did either).
- The artifact's own insight-carousel copy is self-referential (an in-page `CONFIG` object, `localStorage`) and would have been actively wrong once ported into a real TypeScript class with real bookmark storage. Rewrote the three slides to describe *this* implementation accurately (quick links are real bookmarks; pagination is still genuinely computed from tile count; a few tiles come from real history) rather than copying text that no longer matched what the code does.
- Kept the artifact's Google-Fonts loading and `prefers-color-scheme`/`[data-theme]`-driven light/dark support as given, verified both visually via a real Electron launch (see Verification Steps) rather than assuming the CSS was correct from a read-through.
- All class names were prefixed with `ntp-` (e.g. `.shell` → `.ntp-shell`) before injecting the artifact's CSS globally via `document.head`, since this component's styles are not scoped to a shadow root and the app has no existing occurrence of the artifact's generic class names (`.chip`, `.tile`, `.panel`, …) today — prefixing avoids ever colliding with something added later.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/new-tab-page.ts` | Full rewrite: new glassmorphic visual design (bookmarks rail, paginated quick-links grid, search pill, insight carousel, live stats), backed by real bookmarks/history instead of demo data; fixed the event-kind filtering bug in `on()`/`emit()`; fixed the `type="url"` validation bug on the add-tile popover; removed now-unused `ENGINE_LABELS`/`DEFAULT_QUICK_LINKS` exports (no engine-switcher UI in the new design) |
| `src/ui/pages/browser-window.ts` | Added an `'add'` tileAction case (creates a real bookmark via `bookmarkService.addBookmark()`) and refreshed the displayed bookmark/history data after both `'add'` and `'remove'` (the latter never refreshed before) |

## Files Created
- `tests/new-tab-page.test.ts` — 8 unit tests: event-kind filtering (the core regression), `off()` unsubscription, search-as-URL vs. search-as-query routing, real-bookmark rendering in both the rail and the grid, tile-click navigation, tile-remove emitting the right event (not a navigate), and mount/unmount lifecycle
- `doc/2026-09-14-nova-start-page.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 223 files / 9256 tests passed (9248 baseline + 8 new)
npx playwright test --config=playwright-electron.config.cjs       → 2/2 spec files passed (electron-smoke, fidelity-audit)
```

## Verification Steps
1. Read the existing `INewTabPage` interface and its one real caller (`browser-window.ts`'s `renderNewTabPage()`/`loadNewTabData()`) before writing any code, to design the rewrite as a drop-in replacement rather than requiring call-site changes.
2. Verified real bookmark-store/history-store method signatures (`IBookmarkService.addBookmark`, `getBookmarkByUrl`, `removeBookmark`, `getChildren`; `HistoryEntry` shape) against their actual source before wiring the new "Add tile"/remove/rail features to them.
3. Launched the real Electron app via Playwright (matching this project's established e2e pattern) and navigated to `about:newtab` — not `npm run dev`'s plain-browser preview, which turned out to render a *different*, unrelated placeholder page for blank tabs and never reaches this component at all.
4. Interactively drove the real app end-to-end: opened the add-tile popover, typed a bare domain, submitted, confirmed a real bookmark appeared in both the rail and the grid with correct pagination, toggled Customize mode, removed the tile, and ran a search query — checking after each step that the address bar had (or, for add/remove, had *not*) navigated.
5. It was exactly step 4 that caught both real bugs above: the `type="url"` validation bubble on the first attempt, and the unwanted navigation on add once validation was fixed — neither was visible from reading the code alone.
6. Re-ran the same interactive flow with the OS color scheme forced to dark to confirm the artifact's light/dark CSS variables render correctly in both themes.
7. Ran the full unit suite and the existing Electron e2e suite (smoke + fidelity-audit) after all fixes — all green.
