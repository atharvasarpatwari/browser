# Electron Navigation Hang — Fetch Timeout, Transport Detection, Wildcard-Cert Matcher

**Date:** 2026-10-21
**Session:** Investigate a renderer-unresponsive report on external-URL navigation in the real Electron app; fix what the investigation proved; re-verify live after the worktree holding the first attempt was deleted
**Status:** Completed (the original hang did not reproduce here; five real defects found and fixed)

---

## Summary

A prior session reported `UNRESPONSIVE reason=timeout` from the health watchdog after navigating to
`https://example.com` in the real Electron app. The hypothesis was that Electron routes navigation
through the native socket proxy (`window.nova.ipc` → `electron/socket-owner.cjs`) and that path has
no connect timeout.

The hang does not reproduce in this sandbox (outbound networking works; see Verification). The
investigation did prove the hypothesis wrong in an important way and surfaced real defects:
Electron never used the socket proxy at all; the transport it did use enforced no timeout; and once
the socket path is switched on, a latent TLS wildcard-matching bug breaks wildcard-cert hosts.

## Root Causes

### 1. `ResourceLoader` never enforced a timeout
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** `loadResource` put `timeoutMs` (default 15s) into the `HttpRequestSpec` but passed
`options?.signal ?? new AbortController().signal` — a controller nobody aborts. Enforcement was left
to each `IHttpClient`; `RawSocketHttpClient` has its own timer, `FetchHttpClient` never reads
`request.timeoutMs`, so a blackholed host waited on Chromium's internal connect timeout.
**Fix:** `loadResource` owns an `AbortController` + `setTimeout(timeoutMs)` chained to the caller's
signal. On expiry the result carries `Request to "<url>" timed out after <ms>ms.`. The timer and the
caller-signal listener are removed in `finally` (a shared navigation signal would otherwise
accumulate one listener per subresource).

### 2. Electron's socket-proxy transport was never selected
**File:** `src/app/main.ts` (`Tokens.ResourceLoader` factory)
**Problem:** The factory chose `RawSocketHttpClient` only when `typeof process !== 'undefined'`. A
`contextIsolation: true` renderer never exposes a bare `process` (`electron/preload.cjs` exposes it
only as `window.nova.process`). Confirmed live: `typeof process === "undefined"`,
`typeof nova.ipc === "object"`. So Electron always fell back to `FetchHttpClient`.
**Fix:** also select the raw-socket client when `globalThis.nova?.ipc` is present.
**Behaviour change to be aware of:** this moves every Electron page load from Chromium `fetch()` to
the engine's own HTTP/1.1-over-socket stack. Measured in the live app: `http://github.com/`
(301 → HTTPS) 34.8s on the fetch path (`redirect: 'manual'` yields an opaque response the loader
cannot follow) vs 1.6s on the raw path; `example.com`, `news.ycombinator.com`, `github.com` all load.

### 3. TLS wildcard matcher was inverted (exposed by #2)
**File:** `src/browser/networking/tls-handler.ts` (`hostnameMatches`)
**Problem:** the check `hostname.slice(0, -suffix.length).indexOf('.') !== -1` required the wildcard's
label to *contain* a dot. `*.githubassets.com` therefore rejected `github.githubassets.com`
(`[hostname-mismatch]`, scripts blocked) and wrongly accepted `a.b.githubassets.com`.
**Fix:**
```ts
const label = hostname.slice(0, -suffix.length);
return hostname.endsWith(suffix) && label.length > 0 && !label.includes('.');
```

### 4. `releaseSlot()` ran twice on CORS/CORP rejections
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** five early `return`s inside the `try` called `releaseSlot()` and then the `finally` called
it again, driving `activeCount` negative and silently raising the concurrency cap after any rejection.
**Fix:** removed the five inline calls; `finally` is the single release point. Regression test fails
(2 in flight vs expected 1) when the double release is reintroduced.

### 5. The watchdog reloaded an app that was still booting
**File:** `electron/main.cjs` (`runWatchdog`)
**Problem:** every missed probe called `mainWindow.reload()`, including probes that arrive while the
page is still bootstrapping. `did-finish-load` has already fired by then, so an `isLoading()` guard
does not help. On a slow machine the cold boot (observed 9–33s here) outlasts the 5s watchdog cadence,
so each reload restarts the boot. This is the most plausible mechanism for "UNRESPONSIVE repeatedly and
never recovers" on a slow or constrained host.
**Reproduction:** delaying every dev-server request by 250ms in the main process. Baseline: 3 completed
loads and 2 `UNRESPONSIVE` within 15s (two spurious reloads).
**Fix:** a page that has not yet answered a probe since its last main-frame navigation is treated as
*starting* for up to `STARTUP_GRACE_MS` (60s); misses are logged as `STARTING … (no reload)`. After the
first `ALIVE`, or after the grace window, behaviour is unchanged.
**Result:** same simulation: 1 load, `STARTING=1`, `ALIVE` by t+10s, 0 `UNRESPONSIVE`. A genuinely hung
renderer (25s busy loop) is still flagged (`UNRESPONSIVE=5`) and reloaded.

## Ruled out / not changed

- **Main-thread blocking.** The socket-proxy chain is fully async (`ipcRenderer.invoke`, no
  `sendSync`/`Atomics.wait`/sync XHR). A CPU profile of the fetch-path `http://github.com` load showed a
  94ms max event-loop gap. The `UNRESPONSIVE` lines seen in this session's logs all fall in the
  renderer's cold-start page load (up to ~30s on this machine), not in navigations.
- **`electron/socket-owner.cjs` has no connect timeout.** True, but unreachable before #2 and bounded
  from the renderer after it: on the tarpit test the owner's socket count went 1 → 0 at exactly 15s.
  Left unchanged.
- **`DevProxyHttpClient`** is never instantiated (dead code).

## Observations left for follow-up (not changed)

- A single missed probe after the page has been `ALIVE` still triggers a reload (2s probe timeout), so
  a renderer that is merely busy for >2s on a heavy page loses its state. Not changed; needs a
  consecutive-miss threshold decision.
- Navigating to a private/reserved IP (`blockPrivateNetworksByDefault`, `main.ts` Firewall wiring)
  silently does nothing — no error, no loading state.
- `tests/e2e/electron-smoke.spec.ts` uses stale selectors (`.address-input`); the live class is
  `.nova-addressbar-input`. With `VITE_DEV_SERVER_URL` set, `app.firstWindow()` can also return the
  detached DevTools window.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Own abort/timeout; single `releaseSlot` point; listener cleanup |
| `src/app/main.ts` | Select raw-socket client when `window.nova.ipc` is present |
| `src/browser/networking/tls-handler.ts` | RFC 6125 single-label wildcard match |
| `electron/main.cjs` | Startup grace so the watchdog does not reload a booting page |
| `tests/resource-loader.test.ts` | Timeout, caller-abort and slot-accounting tests |
| `tests/tls-handler.test.ts` | Wildcard matching tests |
| `doc/README.md`, `doc/analytics.html` | Index/registry entries |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-21-electron-navigation-timeout-hang.md` | This change log |

## Verification

Live, in the real Electron app (Playwright `_electron`, Vite dev server, `nova-health.log`):

- `https://example.com` loads over the socket proxy (no Chromium-level request to the host).
- Tarpit server on `127.0.0.1:9999` (accepts, never replies): UI shows `Loading…`, recovers at t+15s,
  main-process socket count 1 → 0, no `UNRESPONSIVE` during the navigation.
- `github.com` (HTTPS and HTTP→HTTPS redirect) and `news.ycombinator.com` load; after #3 the
  `hostname-mismatch` script errors are gone.

## Test Results

```
npx vitest run tests/resource-loader.test.ts tests/tls-handler.test.ts
 Test Files  2 passed (2)
      Tests  56 passed (56)

npx vitest run            (full suite)
 Test Files  267 passed (267)
      Tests  10430 passed (10430)

npx tsc --noEmit -p .     exit 2, 19 errors — all in src/browser/service-worker/ (untracked, another
                          session's in-progress work; missing 'idb', DOM lib types). 0 errors in any
                          file touched here.
```

Mutation check: re-adding the removed `releaseSlot()` in the CORS-blocked branch makes
`releases a slot exactly once when CORS rejects a request` fail (`expected 2 to be 1`).

`electron/main.cjs` is the Electron main process and is not covered by vitest; the watchdog change is
verified by the live simulation described under root cause 5.
