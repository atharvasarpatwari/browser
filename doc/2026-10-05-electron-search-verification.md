# Electron Verification of the Search Subsystem — E2E Harness, Archive Flush on Close, IP-Host Keywords

**Date:** 2026-10-05
**Session:** First of four follow-ups (Electron verification → page right-click menu → speculative DNS warm-up → fuzzy search + archive scale), all picked by the user after the search subsystem was pushed (`20a7e03`)
**Status:** Completed — 8 Electron end-to-end tests pass, two defects found and fixed

---

## Summary

Plan §6.4 ("Platform Verification: packaged Electron launch & omnibox interaction") had never been run: everything so far was verified in happy-dom and in the Vite dev pane. This session drives the **real Electron app** with Playwright against a local web site and checks the whole subsystem there — the omnibox, `nova://search`, find-in-page, engine auto-discovery, dropdown row actions and the personal archive, including **restarting the app on the same profile**.

It found two real problems, both fixed (a page indexed in the last 5 s before closing the app was lost; the repository's own Electron smoke spec could never pass) and one wart (IP-address engines got the keyword `!127`).

## What the end-to-end tests prove (all in the real shell)

| Test (`tests/e2e/search-electron.spec.ts`) | What it proves in Electron |
|---|---|
| the omnibox classifies what is typed and offers rows for it | typing shows the right badge (`search`, `!w` "Search Wikipedia", `calc`), the search and instant-answer rows, and everything clears on Escape |
| plain text lands on Nova search | the window renders the built-in `nova://search` page (heading, query in the box, address `nova://search?q=…`) |
| a local page is painted by the engine and can be searched with Ctrl+F | page fetched by the engine over a real TCP socket owned by the main process (`open-tcp`), painted to a canvas; Ctrl+F opens the find bar, counts matches, paints the highlight overlay; a no-match query clears the count |
| a page that advertises a search engine offers it; the keyword works and survives a restart | the chip appears with **no request** to the descriptor; clicking fetches it cross-origin from the renderer (`webSecurity: false` path); `!keyword query` navigates at once; after relaunching with the same profile the engine is still there (settings in the profile) and listed under Settings → Search Engines |
| dropdown rows copy their link and remove history entries | ⧉ writes the URL to the **real OS clipboard** (read back through the main process); the dropdown stays open and the input keeps focus; ✕ removes the history row |
| the personal archive indexes visited pages and still finds them after a restart, even if the app is closed right away | opt-in setting, background indexing, `nova://search` finds the page, **IndexedDB persistence across relaunch** |

Plus the repaired `tests/e2e/electron-smoke.spec.ts` (boot + paint a local page); the existing `keep-alive.spec.ts` still passes.

Run: `npm run build:web` (the main process loads `dist/index.html`), then `npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts`. The helper (`tests/e2e/helpers/electron-app.ts`) gives every test a throw-away profile (`--user-data-dir`), keeps `nova-health.log` out of the tree (`NOVA_HEALTH_LOG=0`), and serves a tiny site from `http://127.0.0.1:<port>` — an IP literal, because this machine's resolver times out on `localhost`.

## Root Causes

### 1. A page indexed in the last 5 seconds was lost when the app was closed
**Files:** `src/ui/pages/search-integration.ts` (the archive: `src/browser/search/search-archive.ts`)
**Problem:** the archive saves itself 5 s after its last change (debounce). `SearchIntegration.dispose()` flushes it, but closing the window never reaches `dispose()` (the page is simply torn down). Found by a probe spec that closed the app 0.6 s after the page became searchable and relaunched: **0 results** after the restart.
**Fix:** save as soon as the page is hidden or unloaded:
```ts
// SearchIntegration.install()
this.flushOnHide = (e) => {
  if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
  void this.subsystem?.archive.flush();
};
window.addEventListener('pagehide', this.flushOnHide);
document.addEventListener('visibilitychange', this.flushOnHide);
```
(removed again in `dispose()`). Same probe after the fix: **1 result**. The committed e2e test now closes the app immediately and still expects the page; a vitest regression covers the wiring (`pagehide`, hidden vs visible `visibilitychange`, nothing after `dispose`) and fails without either half.

### 2. The repository's Electron smoke test could not pass
**File:** `tests/e2e/electron-smoke.spec.ts`
**Problem:** it waited for `.address-bar` and typed into `.address-input`, neither of which exists in the current chrome (the address bar is `.nova-addressbar-input`), and it browsed `https://example.com` (network-dependent; blank in some environments). Run before the change: `element(s) not found` for `.address-bar` after 5 s.
**Fix:** rewritten on top of the shared helper — boots with a throw-away profile, opens a local page through the address bar, expects the painted canvas. Passes.

## Improvement

An engine on an IP address got the keyword of its first octet (`!127`; every self-hosted engine on a home network would have been `!192`, `!1922`, …). `deriveKeyword` now falls back to the engine's name for IPv4/IPv6 literals (`Test Site` → `!test`); named hosts still win (`search.brave.com` → `brav`). Unit test + asserted in the e2e.

## Observations (not fixed here)

- **Engine-painted text overlaps in real Electron pages** (glyphs drawn on top of each other — visible in the failure screenshots, e.g. `<h1>Results for pasta</h1>`). It is the painter/text-measure path, not search; spun off as a separate task.
- No Android device is attached (`adb devices` is empty), so the on-device smoke test (`npm run android:smoke-test`) was not run; `tests/android-native-bridge.test.ts` (which covers `searchTemplate` / `homeUrl`) stays green in the full suite.
- `test-results/.last-run.json` is tracked in git although `test-results/` is ignored; Playwright rewrites it on every run, so it is deliberately not committed here.
- The packaged installer (`build:win`) was not rebuilt; the verified shell is `electron .` loading the freshly built `dist/` (same main process, preload and socket owner as the packaged app).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/search-integration.ts` | save the archive on `pagehide` / `visibilitychange → hidden` (removed on dispose) |
| `src/browser/omnibox/opensearch-discovery.ts` | `deriveKeyword`: IP-literal hosts derive the keyword from the engine name |
| `tests/search-integration.test.ts` | +1 regression (archive saved when the page is hidden/unloaded) |
| `tests/opensearch-discovery.test.ts` | +1 (keywords for IP-address engines) |
| `tests/e2e/electron-smoke.spec.ts` | rewritten on the shared helper (stale selectors, local page) |

## Files Created

| File | Purpose |
|------|---------|
| `tests/e2e/helpers/electron-app.ts` | launch/close Nova with a temp profile, a local test site (article, engine page + descriptor + results, link/image page), omnibox helpers |
| `tests/e2e/search-electron.spec.ts` | the 6 end-to-end tests above |
| `doc/2026-10-05-electron-search-verification.md` | this change log |

## Test Results

```
$ npx tsc --noEmit                                  (includes tests/e2e/*)
(no output, exit 0 — 0 errors)

$ npx vitest run tests/search-integration.test.ts   → Tests  121 passed (121)
$ npx vitest run tests/opensearch-discovery.test.ts → Tests   23 passed (23)

$ npm run build:web
$ npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts tests/e2e/electron-smoke.spec.ts tests/e2e/keep-alive.spec.ts
  ok 1 electron-smoke › Nova Browser launches in Electron and renders content (2.7s)
  ok 2 keep-alive › Nova Browser stays open and responsive via the health probe (9.8s)
  ok 3 search-electron › the omnibox classifies what is typed and offers rows for it (3.0s)
  ok 4 search-electron › plain text lands on Nova search; the search page is rendered by the window (3.0s)
  ok 5 search-electron › a local page is painted by the engine and can be searched with Ctrl+F (3.5s)
  ok 6 search-electron › a page that advertises a search engine offers it; the added keyword works and survives a restart (9.5s)
  ok 7 search-electron › dropdown rows copy their link and remove history entries (3.5s)
  ok 8 search-electron › the personal archive indexes visited pages and still finds them after a restart, even if the app is closed right away (6.7s)
  8 passed (43.5s)

$ npx vitest run            (full suite)
 Test Files  1 failed | 249 passed (250)
      Tests  3 failed | 10146 passed (10149)
   Duration  227.93s
```

The vitest suite grew from 10,147 to 10,149 tests (+2: the archive flush wiring, IP-address keywords) and the Playwright suite from 2 specs (1 of them broken) to 8 passing. The 3 vitest failures are the same known environmental ones — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (the real resolver's `localhost` lookup times out after 5 s on this machine) — unrelated to this change. The Playwright specs are excluded from vitest (`tests/e2e/**`).

## Verification

- **Real Electron, repeatedly:** `electron .` (Electron 41) launched ~25 times across the session; the specs above pass together in ~45 s.
- **Before/after of the archive fix** with the same probe (close 0.6 s after the page became searchable): 0 → 1 result after relaunch.
- **Mutation checks** of the new vitest regression: removing the `pagehide` listener fails it; removing the hidden-only guard fails it.
- The old smoke spec was run first and failed on `.address-bar`, confirming it was already broken.
