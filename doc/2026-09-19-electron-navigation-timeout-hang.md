# Electron Navigation Hang — Missing Fetch Timeout + Broken Client Detection

**Date:** 2026-09-19
**Session:** Investigate a renderer-unresponsive hang reported when navigating to an external URL from inside the real Electron app. Landed into this branch on 2026-09-20 from a separate background session (`unruffled-gates-1eab45`) that had finished and verified this fix independently.
**Status:** Completed (root cause fixed; original hang did not reproduce in this sandbox — see below)

---

## Summary

A prior session reported that navigating to `https://example.com` from the address bar in the real
packaged/dev Electron app made the main-process health watchdog log repeated
`UNRESPONSIVE reason=timeout` and never recover, while the identical navigation in a plain browser
tab pointed at the same Vite dev server was fine. The hypothesis to check was that Electron routes
navigation through the native socket-proxy layer (`window.nova.ipc` → `electron/socket-owner.cjs`)
and that path has no connect timeout.

Traced the full resource-loading pipeline and reproduced the exact repro steps in a live Electron
instance (`VITE_DEV_SERVER_URL=... npx electron .`, driven via Playwright's `_electron` launcher,
navigating `.nova-addressbar-input` to `https://example.com` and pressing Enter, watching
`nova-health.log`). The hang did **not** reproduce here — this sandbox's outbound networking is not
blackholed (a raw Node `tls.connect` to `example.com:443` completed in ~500ms, and the full app
navigated and painted content in ~1s with continuous `ALIVE` watchdog probes for 30+s afterward).

The investigation nonetheless surfaced a real, confirmed bug that would explain exactly this
symptom in an environment where outbound connections do hang: the Electron-vs-web HTTP client
selection is broken, so the one client implementation with a working timeout is never actually
used, and the one that IS used has no timeout at all.

## Root Causes

### 1. `ResourceLoader`'s Electron detection checks the wrong global
**File:** `src/app/main.ts` (`Tokens.ResourceLoader` factory)
**Problem:** The DI wiring picked `RawSocketHttpClient` (raw TCP/TLS via the socket-proxy, which
*does* enforce `request.timeoutMs` via its own `setTimeout`) only when
`typeof process !== 'undefined'`. In a bridged Electron renderer
(`contextIsolation: true, nodeIntegration: false`), `process` is deliberately never exposed as a
bare global — `electron/preload.cjs` exposes it only as `window.nova.process`, specifically so that
`typeof process === 'undefined'` holds for `process-guard.ts`'s browser branch. Confirmed live via
`page.evaluate()` in the running app: `typeof process === "undefined"`, `window.nova.ipc` present.
Net effect: `isNode` was **always false** in real Electron, `client` stayed `undefined`, and
`ResourceLoader` silently defaulted to plain `FetchHttpClient()` — the exact same code path used in
a plain browser tab. `RawSocketHttpClient` (and its working timeout) was dead code for ordinary page
loads in Electron, contrary to the file's own stated design intent ("bypasses `globalThis.fetch()`
entirely, giving the browser engine full control over the network stack").
**Fix:** Also treat a present `window.nova.ipc` bridge as sufficient to select the raw-socket path,
matching the detection pattern already used correctly elsewhere (`node-builtins.ts`'s
`loadNodeBuiltin`, `socket-proxy.ts`'s `getNovaIpcBridge`).

### 2. `ResourceLoader.loadResource` computed a timeout but never enforced one
**File:** `src/browser/networking/resource-loader.ts`
**Problem:** `specBase.timeoutMs` (default 15s) was built into every `HttpRequestSpec` handed to
`IHttpClient.send()`, but the `signal` passed alongside it was just
`options?.signal ?? new AbortController().signal` — a throwaway controller nobody ever calls
`.abort()` on. Enforcement was entirely delegated to each `IHttpClient` implementation reading
`request.timeoutMs` itself. `RawSocketHttpClient` does; `FetchHttpClient` (the client actually in
use, per bug #1) does not — it hands `signal` straight to `fetch()` and never looks at
`request.timeoutMs` at all. A slow/unreachable host would hang the whole load with no
application-level bound, dependent entirely on Chromium's own internal TCP connect timeout.
**Fix:** `loadResource` now owns a single `AbortController` tied to a `setTimeout(timeoutMs)`
(chained to any caller-supplied `options.signal`), so every `IHttpClient` implementation gets a
real, bounded timeout regardless of whether it cooperates with `request.timeoutMs` on its own. This
is harmless, defense-in-depth duplication for clients (like `RawSocketHttpClient`) that already
enforce it themselves, and is the actual fix for the ones that don't. On firing, the result now
carries a clear `Request to "<url>" timed out after <ms>ms.` error instead of hanging forever.

## Not the cause (ruled out)

- **Main-thread blocking:** No synchronous/blocking IPC exists in the socket-proxy chain
  (`ipcRenderer.invoke` throughout, no `sendSync`, no `Atomics.wait`, no synchronous XHR). A hung
  connection was always the less-severe "one async operation pending forever" case, not a frozen JS
  main thread — confirmed both by code inspection and by the watchdog's `executeJavaScript` probes
  staying responsive in every reproduction attempt.
- **`electron/socket-owner.cjs`'s missing `net.connect`/`tls.connect` timeout:** real, and still
  worth noting (no `socket.setTimeout()` anywhere in `openTcp`), but not reachable from normal page
  loads given bug #1, and even when reached, was already masked by `RawSocketHttpClient`'s own
  client-side timer. Left as-is — fixing bug #1 makes this path reachable again, and its existing
  client-side timer already bounds it from the renderer side.
- **`DevProxyHttpClient`:** dead code, never instantiated anywhere in the DI graph. Not involved.

## Note on landing into this branch

This branch (`claude/ponytail-folder-browser-8b310d`) had independently split `resource-loader.ts`'s
original `loadResource()` into a thin `loadResource()` wrapper (added earlier the same day for
DevTools Network-tab timing) plus a `loadResourceCore()` doing the real work. The timeout fix above
landed inside `loadResourceCore()`, in the section this branch's own DevTools-timing wrapper never
touches — no functional overlap between the two.

## Verification

- Reproduced navigation via a live Electron instance (Playwright `_electron.launch`), confirmed
  `typeof process === "undefined"` / `window.nova.ipc` present in the real renderer, confirmed the
  navigation completes and the watchdog stays `ALIVE` throughout in this environment.
- Added `tests/resource-loader.test.ts` → "ResourceLoader — Timeout enforcement": a mock
  `IHttpClient` that hangs forever except for honoring its `AbortSignal` (mirroring real `fetch()`
  behavior) now fails fast with `timed out after 50ms` under fake timers.
- `npx tsc --noEmit -p .`: 0 errors.
- `npx vitest run tests/resource-loader.test.ts`: 18/18 passed on this branch (no regressions).
