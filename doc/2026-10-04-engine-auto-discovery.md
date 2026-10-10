# Search-Engine Auto-Discovery — One-Click Add-as-Search-Engine Offer

**Date:** 2026-10-04
**Session:** Second of three search-subsystem follow-ups (omnibox polish → engine auto-discovery → performance gates)
**Status:** Completed — covered by tests and verified in the running app (see Verification)

---

## Summary

§3.2.1 of the search-engine plan: when a page advertises an OpenSearch engine the user does not have, the address bar offers to add it. The parser (`opensearch-discovery.ts`) and `SearchEngineManager.addEngine` already existed; nothing connected them.

- A page whose `<head>` has `<link rel="search" type="application/opensearchdescription+xml" …>` shows a chip **`＋ Add <title or host>`** in the address bar's action area (next to reload). **No network request happens until the user clicks it.**
- Clicking downloads the descriptor (credential-less, no referrer, 8 s timeout), converts its `{searchTerms}` template to the engine list's `%s` form, picks a free `!keyword` and adds the engine through the window — which persists it, refreshes Settings → Search Engines, and makes the keyword a `!bang` at once. The chip reports **`Adding…` → `Added · !cook`** (or `Couldn't add` / `Already added`) and disappears after 2.5 s.
- Each site is offered **once per session**; nothing is offered in a private window, on non-web pages, or for a site the user already has an engine for.

## Design

- **Detection is free.** `SearchIntegration.onPageDocumentReady(url, doc)` (already called for every engine-rendered page, for the archive) now also calls `findOpenSearchLinks`. Only the first advertised descriptor is offered. "Already has an engine" compares the page's host (minus `www.`) with the host of every http(s) engine template — so `google.com` pages are not offered when `www.google.com` is an engine.
- **Template conversion.** `expandSearchTemplate(searchUrl, { searchTerms: MARK })` with `MARK = 'NOVAQUERYMARK'` (survives `encodeURIComponent`), then `MARK → %s`. Required extras take their OpenSearch defaults (`{count}` → `10`, `{language}` → `*`), optional ones (`{startPage?}`) become empty. The descriptor's `Image` and suggestion URL are ignored (the manager renders `icon` as text; remote suggestions stay on the user's chosen provider).
- **Keyword choice.** `DiscoveredEngine.keyword` (first four letters of the host's most distinctive label), then `kw2`, `kw3`… — skipping every existing engine keyword *and every built-in bang* (`subsystem.bangs.has`), so an offered engine can never shadow `!yt`, `!g`, etc.
- **Lifecycle.** The chip belongs to the page: a new `SearchIntegration.onPageLeaving()` retires it (and tears down find-in-page). The window calls it when a navigation starts (`onBridgeNavState`) and when a tab is activated. It is deliberately **not** part of `onContentReplaced()`: the engine calls `onDocumentReady` *before* it emits `pageLoadReady`, so clearing there would wipe the offer the moment it was shown. A token (`offerToken`) makes a slow download unable to touch a newer page's chip; the engine is still added if the user already clicked and then moved on.
- **One validation, two callers.** The Settings "Add engine" form's checks (name collision by slug, `%s` present, keyword unique) moved into `BrowserWindowPage.validateNewEngine()`, now also used by the host's `addEngine` — so a discovered engine obeys exactly the rules of a hand-typed one, and `addEngine` returning false is what produces "Already added".
- **Transport.** `fetchTextWithGlobalFetch` (next to the parser) mirrors `fetchJsonWithGlobalFetch`: `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'`, throws on HTTP errors. `SearchHost.fetchText?` lets other hosts inject their own transport (like `fetchJson`). In a plain browser a cross-origin descriptor needs CORS, otherwise the chip says "Couldn't add"; in Electron (`webSecurity: false`) and same-origin it just works.
- **Safety.** Descriptor text is only ever shown through `textContent` (chip label, Settings rows — tested with a `<img onerror>` ShortName); only http(s) templates survive the parser; the descriptor never changes the default engine.

## Root Causes

No defects were found in this session; the one design trap is recorded above (document-ready precedes `pageLoadReady`, so the offer must not be cleared in `onContentReplaced`) and is pinned by tests. While tightening the tests, one **vacuous assertion** turned up: "still adds the engine if the user moves on, without bringing the chip back" only looked at the chip after the 2.5 s auto-hide, so it passed even with the stale-download guard removed. It now checks right after the download finishes, and fails without the guard (mutation-checked).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/omnibox/opensearch-discovery.ts` | `fetchTextWithGlobalFetch` (descriptor transport) |
| `src/ui/components/address-bar/address-bar.view.ts` | `AddressBarOffer` type; `setOffer()` (chip in `.nova-addressbar-actions`, updated in place, `mousedown` kept off the input); `actionsElement`/`offerElement` lifecycle |
| `src/ui/pages/search-integration.ts` | `SearchHost.addEngine` / `fetchText?`; `offerEngine`, `acceptOffer`, `addDiscoveredEngine`, `freeKeyword`, `retireOffer`; `onPageLeaving()`; `toPercentS`; dispose cancels a running download |
| `src/ui/pages/browser-window.ts` | `validateNewEngine()` shared by the Settings form and the host's `addEngine`; `onPageLeaving()` on navigation start and tab activation (replaces `onContentReplaced()` in `onBridgeNavState`) |
| `styles.css` | `.nova-addressbar-offer` chip (idle / busy / done / failed) |
| `tests/search-integration.test.ts` | +37 (fake host: offering, lifecycle, accepting, failures, in-flight downloads; real window: one-click add → Settings row + persisted + `!bang`, "already added", navigation/tab-switch/private window, markup in names); fake host gained `addEngine`, `fetchText`, `incognito`, descriptors |
| `tests/address-bar-omnibox.test.ts` | +8 (chip element, in-place updates, handler/disabled state, mousedown, markup, removal, detach) |
| `tests/opensearch-discovery.test.ts` | +3 (`fetchTextWithGlobalFetch`: request options, HTTP error, network error) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-04-engine-auto-discovery.md` | this change log |

## Test Results

```
$ npx tsc --noEmit
(no output, exit 0 — 0 errors)

$ npx vitest run tests/search-integration.test.ts tests/address-bar-omnibox.test.ts tests/opensearch-discovery.test.ts tests/omnibox-controller.test.ts tests/search-subsystem.test.ts tests/omnibox.test.ts
 Test Files  6 passed (6)
      Tests  330 passed (330)

$ npx vitest run            (full suite)
 Test Files  1 failed | 247 passed (248)
      Tests  3 failed | 10130 passed (10133)
   Duration  163.90s
```

The suite grew from 10,085 to 10,133 tests (+48: integration 37, address-bar view 8, descriptor transport 3). The 3 failures are the same known environmental ones as before — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (the real resolver's `localhost` lookup times out after 5 s on this machine) — unrelated to this change.

## Verification

- **Mutation checks** (revert, see the new tests fail, restore): clearing the offer in `onContentReplaced` → fails the "survives the content-replaced notice" test; dropping the `tabActivated` hook → fails the tab-switch test; dropping the once-per-site memory → fails "offers each site once"; dropping the private-window check → fails 2 tests; dropping the known-host check → fails 3; skipping the built-in-bang keyword check → fails the `yt2` test; skipping the `%s` conversion → fails 3 accept tests; removing the stale-download guards → fails the 2 in-flight tests.
- **Live, in the running app** (Vite dev server, app in an iframe in the Browser pane): a temporary same-origin page advertising a descriptor was loaded through the address bar (the engine rendered it to a canvas); the chip `＋ Add ZZ Cooking` appeared with no request made; a **real mouse click** on it (events: `mousedown` + `click` on the chip) went `Adding…` → `Added · !loca` → gone after ~2.5 s; `localStorage` held the new engine (`http://localhost:5199/zz-os.html?q=%s`, keyword `loca`, 14 engines); Settings → Search Engines listed the row; typing `!loca cats` showed the `!loca` badge with the tooltip "Search ZZ Cooking" (item 1) and Enter went to `…/zz-os.html?q=cats`; reloading the page offered nothing. Temporary pages and the saved settings were removed afterwards.
