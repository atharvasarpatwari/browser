# Search Subsystem UI Wiring — Rich Omnibox, Nova Search Page, Find Bar, Built-in Page Rendering

**Date:** 2026-10-02
**Session:** Search subsystem implementation, part 4 — plan Phase 0 (wiring) and the UI halves of Phases 1–6: the omnibox now drives the address bar, `nova://search` exists, Ctrl/Cmd+F finds text in the page with highlights, loaded pages feed the (opt-in) personal archive, and Nova's own search is the default engine
**Status:** Completed — covered by tests and verified by driving the real app (Vite dev server + browser pane); see "Not done" for what was deliberately left out

---

## Summary

Parts 1–3 built the search logic as self-contained modules; nothing reached the user because the omnibox was never connected to the address bar (the plan's Phase 0 finding). This part connects it all:

- **Address bar** — a rich dropdown (icons, highlighted titles, descriptions, hints, section headers, colour swatches) fed by the `Omnibox` through a new `OmniboxController`: classify the text → route it (`@tabs`/`@history`/`@bookmarks`/`@archive`/`@ai`/`@research` scopes, `!bang` shortcuts) → arrange/rank → show; Enter/Tab/arrow semantics, "default match" (what Enter does) and submit/activate actions (open, search, switch tab, run command, research, copy, fill).
- **`SearchSubsystem`** — one factory per window that builds the provider set on a shared 0–100 score scale (typed search, instant answers, bangs, history, bookmarks, dotted-only URL guesses, open tabs, personal archive, browser commands, remote suggestions) plus the scope-only providers and `ScopeHintsProvider`.
- **`nova://search?q=…`** (`SearchPage`) — archive results with highlighted snippets, "Search the web" chips for 12 engines + "Ask Nova AI", and the archive's opt-in switch, stats and "Clear archive".
- **Find in page** — Ctrl/Cmd+F opens a find bar (Enter/Shift+Enter, F3/Shift+F3, Esc, match-case / whole-word / regex toggles, "3/12" counter) and a pointer-transparent overlay canvas paints match rectangles and scrollbar-style ticks over the page bitmap.
- **Personal archive** — `PageRenderer({ onDocumentReady })` → `BrowserWindowPage.onPageDocumentReady` → `SearchSubsystem.indexPage`; off until the user turns it on (nova://search page or Settings).
- **Default engine** — `defaultSearchEngine` now defaults to `nova` (`nova://search?q=%s`); Settings lists Nova first, the new-tab page's engine menu has it.
- **Built-in page rendering** (three engine/window defects found while verifying in the live app, below).

## Root Causes

### 1. The omnibox was never wired into the UI
**Files:** `src/ui/components/address-bar/address-bar.ts`, `address-bar.view.ts`, new `omnibox-controller.ts`, `search-subsystem.ts`, `search-integration.ts`
**Problem:** the address bar model only held a string list, the view rendered plain `<div>`s and fired `navigate`/`search` straight into `NavigationBridge`; `Omnibox` and all its providers had no consumer.
**Fix:** the model gained `typing`/`resultsChanged` events, `setDraft()` and `setResults()`; the view renders rich rows (`renderResults`, `groupResults`, `fillTextOf`) and exposes `setSubmitInterceptor()`/`setResultHandler()`; `OmniboxController` owns the typing → results and Enter → action flow; `SearchIntegration` attaches it all to a window (`install()`).

### 2. Typed `nova://` addresses never rendered
**File:** `src/ui/pages/browser-window.ts`
**Problem:** only `BrowserWindowPage.navigate()` called `handleContentForUrl()`. Typing in the address bar, back/forward, reload, a new tab or a tab switch all go straight to `NavigationBridge`/`NavigationController`, so built-in pages (`nova://settings`, `about:newtab`, now `nova://search`) only ever rendered when something called `page.navigate()`.
**Fix:** built-in pages are drawn when the navigation *commits*:
```ts
private readonly onNavigationCommitted = (event: NavigationEvent): void => {
  if (event.kind !== 'navigationCommitted') return;
  const parsed = event.entry.parsedUrl;
  if (this.drawnOnCommit(parsed)) this.handleContentForUrl(event.entry.url);
  else if (!parsed.isSpecialPage) this.cleanupContentPanel();   // leaving a built-in page releases its widgets
};
```
`navigate()` no longer re-draws them. `about:blank` is excluded on purpose: it is what every tab starts as, and committing it must not wipe the start screen (only an explicit `navigate('about:blank')` clears the page — same as before).

### 3. The engine painted a blank bitmap over every built-in page
**Files:** `src/ui/components/navigation-fetcher.ts`, `src/browser/engine/browser-engine.ts`, `src/browser/navigation/router.ts`
**Problem:** found live — after the fix above `nova://settings` and `nova://search` showed a white canvas. `BrowserEngine.runPipeline` emits `pageLoadReady` for *every* route, including ones with no document to render (`InternalPage`, `NewTabPage`, `BlankPage`, `Unknown`, …), and `NavigationFetcher` unconditionally did `renderFromImageData(paintEngine.rasterize())`, wiping the window's panel with a blank or stale bitmap. The logged event order for `page.navigate('nova://settings')` is `commit → navigate() continuation → pageLoadReady`, i.e. the engine reports ready *after* the old "draw after `navigate()`" point too (inferred from that order; not separately reproduced on the committed build); in-place `pageRepainted` events from a previous page's animations could overwrite a built-in page the same way. `nova://search?q=…` additionally matched no route at all (`Exact` patterns), so it routed as `Unknown`.
**Fix:** one shared predicate for "does the engine render this route", used by the engine and the fetcher:
```ts
// router.ts
const ENGINE_RENDERED: ReadonlySet<RouteType> = new Set([WebContent, LocalFile, WebSocket, SecureFileTransfer, Usenet, LegacyProtocol, Gateway]);
function isEngineRendered(type: RouteType): boolean { return ENGINE_RENDERED.has(type); }
// navigation-fetcher.ts — pageLoadReady and pageRepainted
if (this.rendersBitmap(e.session)) this.renderFromEngine(e.session, true);
```
and `nova://search`/`nova://research` (with or without a query string) are registered as `InternalPage` routes via `RegExp` patterns (`^nova://search/?(?:[?#].*)?$`).

### 4. Built-in pages were appended under the previous page
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `renderSpecialPage()` only removed the previous *panel*; whatever the content renderer had drawn (a page canvas, the loading spinner, the start screen) stayed in the content area, so a settings panel stacked below a full-height canvas.
**Fix:** `this.contentRenderer?.clear()` before drawing any built-in page.

### 5. The archive indexed empty bodies for pretty-printed pages
**File:** `src/browser/search/content-extractor.ts`
**Problem:** the extractor skipped `<head>` subtrees when collecting body text. Found live: the engine's tree builder turns `<html>\n<head>…</head><body>…</body></html>` (whitespace between `<html>` and `<head>` — the usual pretty-printed layout) into `html(head, body(head(title, h1, p, p)))`, so the whole page sits under a stray `<head>` and every body word was dropped; searching the archive found the page by title only.
**Fix:** `head` is no longer in `NON_BODY_TAGS`. Everything legitimately inside a real `<head>` (title, script, style, noscript, template) is already skipped by tag, so nothing else changes. The tree-builder defect itself is **not** fixed here (it is core engine code, out of scope); it is documented in the "Not done" list and flagged as a follow-up task (`before-html.ts` reprocesses the `<html>` token in "before head", `handleInHead`/`handleAfterHead` mishandle whitespace).

### 6. Emptying the find box left a stale "No results"
**File:** `src/browser/navigation-controls/find-in-page.ts`
**Problem:** `find('')` reset the engine but emitted nothing, so a bar that had shown "No results" kept showing it after the box was cleared.
**Fix:** `find()` emits `cleared` when a previous query or matches existed (`const hadState = this._query !== '' || this.matches.length > 0;`).

### 7. Heterogeneous provider scores crowded out the search row and answers
**Files:** `src/browser/omnibox/score-tiers.ts` (new), `src/ui/components/search-subsystem.ts`
**Problem:** `Omnibox` sorts and slices across providers before any re-ranking, and history frecency scores run to ~780 while the search row is 98, so a handful of history hits could push the "Search …" row and instant answers out of the list entirely.
**Fix:** every general provider is wrapped with `tiered(provider, cap)` — scores are normalised onto one 0–100 scale (raw score kept in `meta.rawScore`) and each provider is capped, so the merge cannot be dominated by one source.

## Design notes

- **Privacy (unchanged guarantees, now reachable):** remote suggestions go through the single zero-leakage guard (setting off, incognito, non-search intents, < 2 chars, sensitive-looking text); the archive is opt-in (default off), http(s)-only, never in incognito, never for pages with password fields or `robots: noindex`; tracking parameters (`utm_*`, `fbclid`, …) are stripped from links opened from the omnibox; speculative warming stays inert until a `warmHost` is injected.
- **Settings keys** (all optional; code applies the defaults):

| Key | Default | Where it appears |
|-----|---------|------------------|
| `defaultSearchEngine` | `nova` | Settings → General, new-tab page menu |
| `enableSearchSuggestions` | `true` | Settings → General |
| `suggestionsEngine` | `duckduckgo` | Settings → General (DuckDuckGo / Google / Bing / Brave) |
| `archiveEnabled` | `false` | Settings → General and the `nova://search` page |
| `stripTrackingParams` | `true` | Settings → Privacy |
| `speculativeLoading` | `true` (inert without `warmHost`) | not shown |

  Existing users keep whatever `defaultSearchEngine` they saved; only unset installs get Nova.
- **Find only applies to rendered pages.** Ctrl/Cmd+F is ignored (the browser default stays) unless the content area holds a page bitmap — so not on built-in pages, the loading screen or error pages. The find UI is torn down whenever the content area is replaced (navigation start, `pageLoadReady`, `pageLoadError`) because the content renderer clears the container; in-place `pageRepainted` events re-run the query at most once per 150 ms (animated pages repaint every frame).
- **Highlights are layout geometry:** the find source reads the same `TextRun` coordinates the paint engine uses for `fillText`, mapped through the canvas's `object-fit: contain` transform; nothing in the page is mutated.
- **`SearchIntegration`** is the one place that knows about both the window and the search stack (host interface: address bar, content area, settings/history/bookmarks, tabs, `open`/`switchTab`/`reload`/`closeActiveTab`). `BrowserWindowPage` implements it in `installSearch()` and forwards engine events; `main.ts` passes `onDocumentReady` and the DOM provider. Omnibox commands the window can't run (new window, incognito window, devtools, print, full screen) are not offered; "Clear browsing data" opens Settings.
- **Engine tables:** the engine id → search-URL map now lives only in `new-tab-page.ts` (`SEARCH_URL_TEMPLATES`, `ENGINE_LABELS`); the window and `SearchIntegration` reuse it.

## Not done (deliberate, with reasons)

- **Remote suggestions need a transport that can read cross-origin responses.** Electron runs with `webSecurity: false`, so `fetch` works there; in a plain browser (Vite dev pane) CORS blocks `duckduckgo.com/ac` and the provider degrades silently to local rows. A different host (Android WebView) must inject `fetchJson`.
- **OpenSearch discovery has no UI yet** (the module and `BangRegistry`'s `extraBangs` hook are ready; it needs an "add this engine" prompt and persistence for user engines).
- **Real speculative preconnect** — `warmHost` is not injected (needs a `dnsPrefetch` op on the socket-proxy wire).
- **Scroll to match / selection search** — the engine rasterises a fixed bitmap and has no text selection, so find can highlight but not scroll, and "search for the selected text" has nothing to read.
- **Tab/history titles for search pages** are the URL host (`search`) because `NavigationController` derives entry titles from the hostname.
- **HTML tree-builder defect** (root cause 5) — flagged as a separate task.
- **Pre-existing, unrelated:** `https://example.com/` paints a blank bitmap in the Vite dev pane both before and after this change (verified against a copy of the committed tree). The 3 real-resolver `DnsResolver` tests can time out when the machine is busy (see Test Results).

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | `PageRenderer({ onDocumentReady })`; `page.setPageDocumentProvider(() => domTree.getDocument())` |
| `src/browser/engine/browser-engine.ts` | Fetch/render condition replaced by the shared `isEngineRendered()` |
| `src/browser/engine/page-renderer.ts` | `onDocumentReady` dependency, called once per load (errors swallowed) |
| `src/browser/navigation-controls/find-in-page.ts` | `cleared` event when an emptied query had state |
| `src/browser/navigation/router.ts` | `isEngineRendered()`; `nova://search` / `nova://research` (+ query) registered as internal pages |
| `src/browser/omnibox/bangs.ts` | `BangSuggestionsProvider` (`!bang` completions and one-click "Search <engine>" rows) |
| `src/browser/omnibox/omnibox.ts` | `OmniboxRoute` — per-query provider subset and rewritten query |
| `src/browser/search/content-extractor.ts` | `<head>` no longer excluded from body text |
| `src/ui/components/address-bar/address-bar.ts` | `typing`/`resultsChanged` events, `setDraft()`, `setResults()` |
| `src/ui/components/address-bar/address-bar.view.ts` | Rich dropdown, grouping, Enter/Tab/arrow semantics, `aria-activedescendant`, submit interceptor / result handler |
| `src/ui/components/navigation-fetcher.ts` | Never paints the engine bitmap for non-engine-rendered routes |
| `src/ui/pages/browser-window.ts` | Search wiring, built-in pages drawn on commit, `nova://search`, `nova://research?q=`, content cleared before built-in pages, Nova default |
| `src/ui/pages/new-tab-page.ts` | Nova engine (template, label, menu, default) |
| `src/ui/pages/settings-page.ts` | Nova option/default; suggestions, suggestions provider, archive and tracking-parameter settings |
| `styles.css` | Rich dropdown and find bar styles |
| `tests/android-native-bridge.test.ts` | Default `searchTemplate` is now `nova://search?q=%s` |
| `tests/bangs.test.ts`, `tests/content-extractor.test.ts`, `tests/find-in-page.test.ts`, `tests/omnibox-async.test.ts`, `tests/page-renderer.test.ts` | New cases for the changes above |

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/components/omnibox-controller.ts` | Typing → classify → route → arrange → show; submit/activate actions |
| `src/ui/components/search-subsystem.ts` | Per-window provider set, archive, remote suggestions, controller attach, `indexPage()` |
| `src/ui/components/highlight.ts` | Shared text-highlight helpers (dropdown rows, search page) |
| `src/ui/components/find-bar/find-bar.view.ts` | Find bar UI over a `FindInPage` engine |
| `src/ui/components/find-bar/find-overlay.ts` | Highlight/tick overlay canvas and the `object-fit: contain` transform |
| `src/ui/pages/search-page.ts` | `nova://search` page |
| `src/ui/pages/search-integration.ts` | Window glue: omnibox, search page, find bar, key handling, archive hook |
| `src/browser/omnibox/scope-hints.ts` | `@scope` discovery rows |
| `src/browser/omnibox/score-tiers.ts` | `tiered()` score normalisation |
| `tests/address-bar-omnibox.test.ts` (26), `omnibox-controller.test.ts` (31), `search-subsystem.test.ts` (30), `search-page.test.ts` (25), `find-bar.test.ts` (22), `scope-hints.test.ts` (4) | Unit/e2e tests through the real address bar |
| `tests/search-integration.test.ts` (55) | `SearchIntegration` against a fake host, and the real `BrowserWindowPage` (omnibox → page, built-in pages on commit/back/forward/tab, engine events, find lifecycle, archive, research, default engine) |
| `tests/builtin-pages-engine.test.ts` (23) | `isEngineRendered`, router entries for `nova://search`/`research`, `NavigationFetcher` never paints over built-in pages |

## Test Results

```
npx tsc --noEmit
(no output — 0 errors)

npx vitest run
 Test Files  246 passed (246)
      Tests  9994 passed (9994)
```
Two earlier full runs, made while a Vite dev server and other test processes were loading the machine, each showed the same 3 failures in `tests/networking-integration.test.ts > DnsResolver - real system resolution` (`DnsTimeoutError: DNS resolution for "localhost" timed out after 5000ms` — a real OS-resolver call with a 5 s budget); the file and `src/browser/networking/` are untouched, and the final run on an idle machine was fully green. Before this part the suite was 238 files / 9763 tests, so this part adds 8 files / 231 tests.

Mutation checks (change reverted afterwards): removing the `navigationCommitted` subscription fails 12 window tests; making `rendersBitmap()` always `true` fails the 8 fetcher tests and the window-level "built-in page survives `pageLoadReady`" test; putting `head` back in `NON_BODY_TAGS` fails the pretty-printed-page extractor test.

## Verification

Run in a Vite dev server (`npx vite --port 5199`) in the browser pane, driving the real app (all removed afterwards, including a temporary test page and a copy of the committed tree used as a baseline):

- Typing `react hooks` shows the rich dropdown; Enter lands on `nova://search?q=react%20hooks`, which renders the search page; typing `nova://settings` renders Settings.
- Dropdown rows: instant answer (`2+2` → `4 {Copy}`), `!w nova` → "Search Wikipedia", `@ai …` → research row, `@tabs ` → tab rows, `open settings` → command row, archive rows with highlighted snippets.
- Commands: `new tab` (real new-tab page, 2 tabs), `open history`, `reload page`, `close tab` (falls back to the other tab and re-renders its built-in page).
- Archive: turning it on from the search page, loading a page, then searching its body text returns it with highlighted terms; the setting and the IndexedDB index persisted across a reload.
- Find: Ctrl+F opened the bar over a rendered page (default prevented, input focused), `fox` reported `1/5` with the overlay canvas present, and ▼ stepped the active highlight through the five matches. (That the bar closes on navigation / `pageLoadReady` is covered by the window tests, not re-checked live.)
- Found and fixed while doing this: the blank-canvas bug (3), the empty-body extractor bug (5), and that the start screen must survive the first `about:blank` commit.
