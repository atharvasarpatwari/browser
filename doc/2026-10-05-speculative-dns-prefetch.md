# Speculative DNS Warm-up — a `dns-prefetch` Hint to the Browser's Own Resolver

**Date:** 2026-10-05
**Session:** Third of four follow-ups (Electron verification → page right-click menu → speculative DNS warm-up → fuzzy search + archive scale)
**Status:** Completed — verified in the real Electron app against Chromium's net log. The first design (a DNS cache in the Electron main process) was built, found to be off the page-load path, and removed; this log records why.

---

## Summary

Plan §3.6.2, DNS half. While you type, when the top suggestion is a very familiar `https://` site, the window now asks the browser's own resolver to look that site's address up, so the lookup is already done when you press Enter. It is one `<link rel="dns-prefetch" href="https://host">` in the app document (`dnsPrefetchHint`, ~8 lines), driven by the existing `SpeculativeLoader` (score ≥ 90, public named hosts only, https only, once per 5 minutes per host, never in private browsing).

Until now that loader was **inert in the product**: it only runs when the window supplies `warmHost`, and nothing did. The Settings toggle that controls it (Privacy → *Prepare likely destinations*, default on; the Nova Search page already had the same toggle) is now shown, with a description of what it tells your DNS resolver.

Measured in the real app (Electron's net log): a warmed host makes **no resolver lookup while the page loads**; a cold one does. TLS preconnect is not part of this — see "Not done".

## What was built first — and why it was removed

The plan, and the first implementation, put the warm-up in the Electron main process: a `dns-prefetch` request on the `nova:net` socket owner (`electron/socket-owner.cjs`), a 60-second DNS cache whose `lookup` function was handed to `net.connect`, `SocketProxy.dnsPrefetch` in the renderer, a TypeScript twin for the in-process owner. It had 74 tests (cache, owner, proxy, window), was mutation-checked, and in the real shell the RPC filled the cache (`hosts` 0 → 1).

### 1. The page loader never goes through the socket owner
**Files:** `src/app/main.ts:442`, `electron/main.cjs:197-199`
**Problem:** `main.ts` selects `RawSocketHttpClient` (the only client that calls `open-tcp`) only when `process.versions.node` exists *in the renderer*. The window runs with `nodeIntegration: false` and `contextIsolation: true`, so it doesn't, and `ResourceLoader` falls back to `FetchHttpClient` — Chromium's `fetch()` and Chromium's own resolver. The owner's `open-tcp` is reached only by the proxy clients, which connect to the *proxy* host. A cache in the owner could only warm lookups that nothing performs. The end-to-end test written to prove "a name only the cache knows loads" exposed it: with a wrapper on the `nova:net` handler, loading `http://localhost:<port>/quasar` and `http://127.0.0.1:<port>/quasar` hit the test site and produced **zero** `nova:net` requests, and the cache-only name never started loading.
**Fix:** reverted the whole main-process design (`electron/dns-cache.cjs`, the owner/proxy changes, their three test files — several hundred lines of source and tests) and warmed the resolver that is actually used.

### Which mechanism reaches Chromium's resolver

Electron's `netLog` records every resolver request and lookup job with the key it is stored under. One session, real app, four public example hosts:

| Mechanism | What the resolver did | A later `fetch('https://host/')` |
|---|---|---|
| `<link rel="dns-prefetch" href="//www.example.net">` (protocol-relative) | speculative request keyed **`file://www.example.net`** — the href resolves against the app's own `file:` page | new lookup job: wrong key, no benefit |
| `session.defaultSession.resolveHost('www.example.org')` | request keyed `www.example.org:0` | new lookup job: wrong key, no benefit |
| `<link rel="preconnect" href="https://www.wikipedia.org" crossorigin>` | nothing logged | — |
| **`<link rel="dns-prefetch" href="https://www.example.net">`** | speculative request keyed `https://www.example.net` plus one lookup job | **cache hits only — no lookup job** |
| nothing (control) | — | lookup job at load time |

The lookup the hint takes off the load path was 12–38 ms for these four hosts (job start → DNS answer in the log: example.net 13, example.org 12, iana.org 38, wikipedia.org 20 ms) — one run on one machine, so a size, not a distribution. Wall-clock `fetch` times were noise (47–178 ms whether warmed or not), so no end-to-end latency figure is claimed. (An earlier measurement of Node's `dns.lookup` — first call p50 27 ms, repeat p50 8 ms — was of a resolver the page loader does not use.)

## Design

- **`dnsPrefetchHint(host, doc = document)`** (`src/browser/search/speculative-loader.ts`) appends the link to `document.head` and removes it after 10 s (the browser acts on a hint when it is inserted). The href is deliberately an absolute `https://host` URL — the key the page loader's `fetch` uses.
- **`BrowserWindowPage.installSearch()`** passes `warmHost: (host) => dnsPrefetchHint(host)`. `SpeculativeLoader` is unchanged. No IPC, no main-process code, no new setting.
- Applies wherever the app document does the fetching: Electron, the Vite dev server, and the Android WebView (`NovaHttpClient` is not instantiated anywhere, so Android uses the same `fetch` path).
- Privacy: a prefetch is a DNS query for a site the user has not opened yet, which is what the Settings text now says. It is limited by the loader to confident matches (history/bookmarks the user knows well), never runs in private browsing, and is switchable.

## Root Causes (second finding — the test profile was not hermetic)

### 2. Online suggestions leaked out of the e2e tests and re-rendered the dropdown mid-test
**File:** `tests/e2e/helpers/electron-app.ts`
**Problem:** the "dropdown rows copy their link and remove history entries" test began failing intermittently (and took 40 s instead of 10 s). Typing `quasar` made the *real* remote-suggestions provider query the network (online suggestions are on by default), and its results ("quasar games", "quasar fivem"…) arrived at an unpredictable moment, re-rendering the dropdown between `hover()` and `click()`: the new row was not hovered, so the hover-only ✕ button stayed invisible until Playwright's 30 s timeout. The spec's header claimed the network was never reached — it was, and the typed text left the machine.
**Fix:** `launchNova` writes `enableSearchSuggestions: false` into the profile and reloads once, so every e2e profile is hermetic:
```ts
const changed = await page.evaluate(() => {
  const settings = JSON.parse(localStorage.getItem('nova-settings') ?? '{}');
  if (settings.enableSearchSuggestions === false) return false;
  settings.enableSearchSuggestions = false;
  localStorage.setItem('nova-settings', JSON.stringify(settings));
  return true;
});
if (changed) await page.reload();
```
The header comment is corrected. The same test now passes in 7–10 s.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/search/speculative-loader.ts` | `dnsPrefetchHint` (exported); doc comment of `warm` |
| `src/ui/pages/browser-window.ts` | `warmHost` wired to the hint |
| `src/ui/pages/settings-page.ts` | Privacy: *Prepare likely destinations* toggle (`speculativeLoading`), with an honest description |
| `tests/speculative-loader.test.ts` | +4 (`dnsPrefetchHint`: absolute https href, head, removal after the TTL, given document) |
| `tests/search-integration.test.ts` | +5 window-level (hints a confident match as `https://github.com`, once per site, off switch, private window, plain query) |
| `tests/settings-page.test.ts` | +1 (the toggle is listed, default on) |
| `tests/e2e/helpers/electron-app.ts` | hermetic profile (root cause 2); `readResolverEvents` (reads a net log) |
| `tests/e2e/search-electron.spec.ts` | +1 end-to-end test; header comment |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-05-speculative-dns-prefetch.md` | this change log |

## Test Results

```
$ npx tsc --noEmit                                  (includes tests/e2e/*)
(no output, exit 0 — 0 errors)

$ npx vitest run tests/speculative-loader.test.ts tests/search-integration.test.ts tests/settings-page.test.ts tests/search-subsystem.test.ts
 Test Files  4 passed (4)
      Tests  227 passed (227)

$ npm run build:web
$ npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts tests/e2e/electron-smoke.spec.ts tests/e2e/keep-alive.spec.ts
  ok 10 tests (smoke, keep-alive, 8 search incl. "typing a very familiar site looks its address up ahead of time; the later load finds it in the resolver cache")
  10 passed (1.5m)

$ npx vitest run            (full suite)
 Test Files  1 failed | 252 passed (253)
      Tests  3 failed | 10207 passed (10210)
   Duration  382.35s
```

The vitest suite grew from 10,200 to 10,210 (+10) and the Playwright suite from 9 to 10 passing specs. The 3 failures are the same known environmental ones — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (the real resolver's `localhost` lookup times out after 5 s on this machine).

Two things seen while verifying, neither caused by this change:
- Performance gates (`tests/search-performance.test.ts`) failed while a second full vitest run was executing on this 4-core machine with the CPU at 100% (rerun alone in that state: index query p95 19 ms against a 15 ms budget, keystroke p95 32 ms against 16 ms). With the machine quiet they pass — 8/8 on their own and in the full run above. Wall-clock gates are load-sensitive; treat a failure under load as noise and re-run alone.
- `tests/e2e/fidelity-audit.spec.ts` (older, untouched) fails because it waits for `.address-input`, a selector the address bar no longer has (the same stale selector the old smoke spec had), and it launches Electron on the default profile, not a throw-away one. Left alone.

## Verification

- **Real Electron, Chromium net log** (`search-electron.spec.ts › typing a very familiar site…`): seeds one familiar site in history, types `examp` (no Enter), then loads the warmed host and a never-typed control host with `fetch` from the app document. Asserts that the hint produced a *speculative* resolver request for exactly `https://www.example.net` before the load, that nothing else was speculatively resolved, that the control host was looked up **during** its load, and that the warmed host was **not**. (If the machine cannot resolve the example hosts the test asserts only the speculative request and records an annotation.)
- **Mutation checks:** protocol-relative href → the 3 unit/window tests and the e2e fail (e2e: 0 speculative requests for the host); `warmHost` not wired → the 2 window tests fail; hint never removed → the removal test fails.
- **The design finding itself** (page loads bypass `nova:net`) is reproducible with the wrapper described under root cause 1; the net-log table above came from `netLog.startLogging` in the same app.

## Not done

- **TLS preconnect.** A `preconnect` hint did nothing in Electron's network stack (nothing logged), and `Connection: close` / pooling in `RawSocketHttpClient` is irrelevant because the page loader does not use it. `session.preconnect()` was not tried: DNS was the measured, honest win.
- **Dropping the dead raw-socket path.** The socket owner and `RawSocketHttpClient` stay as they are (Phase 5 groundwork); they are simply not on the page-load path today.
