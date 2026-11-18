# Nova for Windows, Phase 1 (Indexing): On by Default, and Existing History and Bookmarks Indexed

**Date:** 2026-11-18
**Session:** "yes, turn on indexing and backfill history and bookmarks" (phase 1 of the Windows plan; front end in `doc/2026-11-18-nova-windows-phase-1-search-front-end.md`)
**Status:** Completed. Verified in the real Electron app (Playwright). One unrelated Electron test (right-click on selected text) fails and is filed as a separate task.

---

## Summary
On the Windows app (and the web build) Nova Search now indexes the pages you visit without an opt-in, says so once on the home page with a one-click "Turn off", and adds the pages already in your history and bookmarks in the background. The Android app is unchanged (indexing stays opt-in there, and no backfill runs).

## What changed
### Default on, desktop only
- `archiveEnabledByDefault()` (`src/ui/components/search-subsystem.ts`): true unless `window.NovaStateBridge` exists (the Android shell, which hosts this same UI). Used as the setting's fallback in the subsystem, the results page and the Settings page (`defaultValue`), so an explicit choice always wins.
- Home page notice (`browser-window.ts` `refreshIndexNotice`, `NewTabPage.setNotice`): "Nova Search now indexes the pages you visit, your history and your bookmarks…" with **Got it** (sets `archiveNoticeSeen`) and **Turn off**. Not shown in private windows, inside the Android shell, or once dismissed.

### Backfill (`src/browser/search/archive-backfill.ts`, new)
- Candidates: up to 2,000 history entries (newest first), then bookmarks; each address once.
- Fetches through the engine's own loader (`PageLoader` over the resource loader, wired by `main.ts` → `BrowserWindowPage.setDocumentLoader` → `SearchHost.fetchDocument`), parses with the engine's HTML parser, extracts with the same `extractIndexableDocument` as a visit (password pages and `noindex` are refused), indexes with the history visit time.
- Politeness: one page at a time, 1.5 s between pages, 15 s timeout, 300 fetches per session, starts 20 s after the archive is restored. Stops when indexing is not allowed (setting off, private window), after 5 consecutive network failures ("offline", retried next launch), or at the session limit.
- Never fetched: pages already indexed; pages it could not index before (skip list in localStorage, 5,000 entries); addresses that act when opened or carry a secret (sign-out, unsubscribe, delete, confirm, verify, reset, token, OAuth callback, cart, checkout, payment, download, …) and URLs with credentials. A re-fetch is a GET with the user's cookies, so these are skipped on purpose.
- Desktop only: inside the Android shell every fetch shares the bridge's small queue with the page being viewed (`fetchDocument` is not provided there).
- Results page: a progress line under the result count ("Adding your history and bookmarks to the index: 12 of 140") with Pause / Resume; turning indexing on from the page or the switch starts the backfill.

## Root Causes (found while verifying in the Electron app)
### 1. The results page showed nothing when opened before the archive finished restoring
**File:** `src/ui/pages/search-page.ts`
**Problem:** results were computed once when the page opened; archive changes only updated the status line. Right after start-up (and while the backfill adds pages) a search showed "0 results" until searched again. Found by the existing restart test, which failed after the restart.
**Fix:** on an archive change that alters its size, the archive part of the search runs again (bookmarks and history are kept).
```ts
if (this.query && this.deps.archive.stats().documents !== this.searchedDocuments) { this.searchArchivePart(); this.render(); }
```

### 2. With indexing on, visited pages lost their removable history row in the address bar
**File:** `src/browser/omnibox/omnibox.ts` (`merge`, canonical de-duplication)
**Problem:** a page that is both visited and indexed produced a history row and an archive row; the archive row scores higher, so the history row (with its ✕ "remove from history") was dropped. Found by the Electron test "dropdown rows copy their link and remove history entries".
**Fix:** when the two rows are the same page, the history row takes the archive row's place.

### 3. `pageOmnibox` was never disposed (from the front-end round)
**File:** `src/ui/components/search-subsystem.ts` — `dispose()` now disposes `pageOmnibox` and the backfill.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/components/search-subsystem.ts` | `archiveEnabledByDefault`; backfill instance (`fetchDocument`, `backfillSkipStore` deps); disposal (#3) |
| `src/ui/pages/search-page.ts` | desktop default; backfill progress line + Pause/Resume; start on turn-on; results follow the archive (#1) |
| `src/ui/pages/search-integration.ts` | `fetchDocument` host port; backfill starts 20 s after the archive loads; results page gets the backfill |
| `src/ui/pages/browser-window.ts` | `setDocumentLoader`; `fetchDocument` (desktop only); home page notice |
| `src/ui/pages/new-tab-page.ts` | `setNotice` |
| `src/ui/pages/settings-page.ts` | `archiveEnabled` default and wording |
| `src/app/main.ts` | passes a `PageLoader` to the window |
| `src/browser/omnibox/omnibox.ts` | history row wins over the archive row for the same page (#2) |
| `tests/search-page.test.ts`, `tests/search-integration.test.ts`, `tests/search-subsystem.test.ts` | new default (desktop on, Android off, explicit off); results follow the archive; home page notice |
| `tests/omnibox-async.test.ts` | history row replaces the archive row |
| `tests/e2e/search-electron.spec.ts` | default-on scenario; backfill scenario; the restart test now also checks the page was not re-fetched |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/search/archive-backfill.ts` | the backfill |
| `tests/archive-backfill-218.test.ts` | risky-URL filter, order and visit times, skip list, title fallback, session limit, offline stop, disabled stop, pause/resume, listeners |
| `doc/2026-11-18-nova-windows-phase-1-indexing-default-backfill.md` | this change log |

## Test Results
```
npx tsc --noEmit -p .                    -> exit 0
npx vitest run tests/archive-backfill-218.test.ts -> 10 passed
npx vitest run                           -> Test Files 354 passed (354); Tests 11537 passed (11537)

npm run build:web, then npx playwright test --config=playwright-electron.config.cjs (real Electron app):
  electron-smoke, fidelity-audit, keep-alive                                  -> passed
  search-electron.spec.ts, 13 tests (incl. the 2 new ones)                    -> 13 passed
  "typing a very familiar site looks its address up ahead of time" (DNS)      -> passed (looks up public example hosts)
  "text on a rendered page can be selected, copied, and searched from the right-click menu" -> FAILED
```

## Not fixed (recorded)
- **Right-click on selected page text** (Electron test above): the selection is made and copied, but the right-click shows the page menu instead of Copy / Search / Ask Nova AI. Not caused by this round: it still fails with indexing off by default, with the old 40% restyle threshold, and with the old static start screen (each reverted alone and re-run). Filed as a separate task.
- **Dev build:** the plain-browser build (`npm run dev`) cannot fetch other sites (browser CORS: "Failed to fetch"), so the backfill only works in the Electron app; checked there.
- **Settings page switch:** turning indexing on from Settings (not from Nova Search) starts the backfill at the next launch.
- **Bookmarks' "Visited" time** is when the backfill indexed them (a bookmark has no visit time of its own).
- No new installer was built.
