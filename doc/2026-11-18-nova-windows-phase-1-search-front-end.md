# Nova for Windows, Phase 1 (Front End): A Search-Engine Home Page and Results Page on Nova's Own Engine

**Date:** 2026-11-18
**Session:** "this implementation for the windows application (.exe) … make sure that it looks like a real search engine" (plan: phase 1 of `C:\Users\athar\.claude\plans\replicated-tickling-ember.md`; phase 0 in `doc/2026-11-14-nova-windows-phase-0-clean-build-single-instance.md`)
**Status:** In Progress. The front end is done and verified in the app (Vite dev server). Phase 1's indexing items (default-on archive, first-run notice, backfill of history and bookmarks, "Add to Nova index") are not done yet. No new .exe was built.

---

## Summary
The home page and the `nova://search` results page now look and behave like a search engine: the Nova logo, a pill search box with as-you-type suggestions, result cards with highlighted snippets, tabs, a result count with timing, 10 results per page, an instant-answer card, and a small "Search elsewhere" row. Results come only from Nova's own index (visited pages, bookmarks, history). Three bugs found while checking it in the app are fixed.

## What changed
### Results page (`src/ui/pages/search-page.ts`, rewritten)
- Top bar: logo (inline SVG, `nova-logo.ts`) and a pill search box with suggestions (`SuggestionsDropdown`).
- Tabs **All** / **Bookmarks & history**; "About N results (0.00 seconds) · M pages in your Nova index".
- One ranked list (`nova-results.ts` `mergeResults`): up to 3 matching bookmarks, then archive pages by relevance, then history entries the archive does not hold. Bookmarks and history are asynchronous and merge in when they arrive; a late answer for an older query is dropped.
- 10 results per page with Previous / numbered pages / Next (`paginate`). The archive query now fetches up to 100 hits (was 20).
- Instant answer card; archive-off / nothing-indexed notice with "Turn on personal archive"; an empty-result message.
- "Search elsewhere": the user's first three engines plus Ask Nova AI. Nothing is sent to those engines unless clicked.
- Search settings moved into a collapsed `<details>` at the bottom (same toggles as before).
- All colours come from `search-theme.ts` (dark default, light via `data-theme` or `prefers-color-scheme`).

### Home page (`src/ui/pages/new-tab-page.ts`, restyled; features kept)
- Nova logo, greeting ("Good morning · …"), a pill search box with suggestions; engine picker, quick links, recently visited, bookmarks, context menu and clock are unchanged in behaviour.
- Removed: the animated particle background and gradient, and the third-party favicon lookups (each tile requested `https://www.google.com/s2/favicons?domain=<host>`, sending every visited host to Google). Tiles use the letter avatar that was already the fallback.
- Keyboard: tiles are focusable and open with Enter.

## Root Causes (bugs found while checking it in the app)
### 1. The real home page was never shown at launch
**File:** `src/ui/pages/browser-window.ts`
**Problem:** at startup the window called `contentRenderer.renderNewTab()`, a static picture of a search box (a `div` with placeholder text, not an input). The real `NewTabPage` mounted only on `about:newtab` / `nova://newtab`.
**Fix:** startup calls `this.renderNewTabPage()`.

### 2. "Loading ..." covered the home page
**File:** `src/ui/components/navigation-fetcher.ts`
**Problem:** every `navigationStarted` drew the loading spinner, including the first tab's `about:blank`. Built-in pages are never fetched, so nothing replaced it.
**Fix:**
```ts
if (!/^(about|nova):/i.test(e.request.url)) this.contentRenderer.renderLoading(e.request.url);
```

### 3. Typing on the home page opened the address bar's list
**File:** `src/ui/components/search-subsystem.ts`
**Problem:** the page boxes used the address bar's `Omnibox`, whose `resultsChanged` events the address bar controller renders; a page keystroke also bumped the shared request counter and could cancel an address-bar request.
**Fix:** a second instance with the same providers, `pageOmnibox`, for the page search boxes.

### 4. The suggestions list drew under the quick-link tiles
**File:** `src/ui/pages/new-tab-page.ts`
**Problem:** each fade-in section has its own stacking context (animated `transform`/`opacity`), so the later tiles section painted over the list.
**Fix:** `z-index:20` on the search box's section.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/search-page.ts` | rewritten as a search-engine results page (above) |
| `src/ui/pages/new-tab-page.ts` | restyled on the shared theme; logo, greeting, suggestions; favicon lookups and particles removed; #4 |
| `src/ui/pages/search-integration.ts` | results page gets bookmarks + history (`saved`) and suggestions; `suggest()` for the home page |
| `src/ui/components/search-subsystem.ts` | `pageOmnibox` (#3) |
| `src/ui/pages/browser-window.ts` | real home page at launch (#1); home page suggestion source |
| `src/ui/components/navigation-fetcher.ts` | no spinner for built-in pages (#2) |
| `tests/search-page.test.ts` | updated for the new layout; new: pagination, merge + tab, stale saved answer, suggestions |
| `tests/search-integration.test.ts` | start screen is the real home page (a working search box) |
| `tests/search-subsystem.test.ts` | `pageOmnibox` rows do not open the address-bar list |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/search/nova-results.ts` | archive search (timed), merge of archive + bookmarks + history, pagination |
| `src/ui/components/suggestions-dropdown.ts` | the suggestions list for page search boxes |
| `src/ui/components/nova-logo.ts` | the Nova wordmark as inline SVG |
| `src/ui/pages/search-theme.ts` | shared stylesheet (colour variables, dark/light) |
| `tests/nova-results-217.test.ts` | merge order, de-duplication, tabs, pagination |
| `doc/2026-11-18-nova-windows-phase-1-search-front-end.md` | this change log |

## Test Results
```
npx tsc --noEmit -p .                 -> exit 0
npx vitest run tests/search-page.test.ts tests/search-integration.test.ts tests/nova-results-217.test.ts -> 172 passed
npx vitest run tests/search-subsystem.test.ts -> 31 passed
npx vitest run                        -> Test Files 353 passed (353); Tests 11520 passed (11520)
```

## Verification (the app, Vite dev server in the browser pane, 1024x768)
- Launch: the home page shows (logo, greeting, search box, quick links); before fixes #1/#2 it showed "Loading ...".
- Typed `2+2` on the home page: the list shows "4 · Copy", "Research … with Nova AI", "2+2 Search Nova"; the address bar's list stays closed (#3); the list is above the tiles (#4).
- Enter: `nova://search?q=2%2B2` shows the logo bar, tabs, the instant answer card, "About 0 results (0.00 seconds) · 0 pages in your Nova index", the archive-off notice, the empty message, and "Search elsewhere: DuckDuckGo, Google, Bing, Ask Nova AI".
- Not checked in the app: results with indexed pages (the dev archive is empty; covered by unit tests), the light theme, the Electron build.

## Not done (phase 1, next)
- Archive indexing on by default on desktop, with a first-run notice; `ArchiveBackfill` for existing history and bookmarks; "Add to Nova index" in the page menu.
- Images and Answers tabs, "Did you mean".
- A new Setup .exe (phase 3 packaging; the last build is 2.16.0 from phase 0).
- The suggestion rows' special actions (bangs, browser commands) act only from the address bar; on the page boxes a row with a URL opens it and the rest search their text.
