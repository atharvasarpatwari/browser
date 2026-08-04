# HTTP(S) Proxy CONNECT Tunneling

**Date:** 2026-08-04
**Session:** Real CONNECT tunneling for HTTP(S) proxies — transport, dispatch, env wiring, and tests
**Status:** Completed

---

## Summary

Added real HTTP CONNECT tunneling for HTTP(S) proxies. A new `http-proxy-connect.ts` module performs the `CONNECT host:port HTTP/1.1` handshake over a raw `net` socket and returns a tunneled socket; `RawSocketHttpClient` gained an `httpProxy` option (HTTP writes through the tunnel, HTTPS wraps it with `tls.connect({ socket })`); `ProxyAwareHttpClient.sendViaHttpProxy` now dispatches to a per-proxy CONNECT transport instead of the previous fetch-based absolute-URI rewrite (kept only as a non-Node fallback); `createProxyConfigFromEnv` now enables conventional `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` variables; `main.ts` selects the proxy transport when any of them is set. The SOCKS handshake's buffered reader was extracted into a shared `socket-reader.ts` (with a new `readUntil` used by the CONNECT handshake). 24 new tests pass.

## Root Causes

### 1. `http://` proxy URLs were never classified as proxies
**File:** `src/browser/networking/request-manager.ts`
**Problem:** `ProxyAwareHttpClient.send()` fed the raw proxy URL straight to `gatewayManager.resolve()`, but the gateway registry keys proxies by the custom schemes `http-proxy:` / `https-proxy:` / `socks4:` / `socks5:`. A conventional `http://proxy:8080` URL resolves to `null`, so `httpProxy` / `httpsProxy` config silently fell through to a direct connection — only `socks5://`-style URLs ever worked.
**Fix:** Normalize standard proxy URLs onto the registry schemes before resolving:
```ts
function normalizeProxyUrlForGateway(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (u.protocol === 'http:') return `http-proxy:${proxyUrl.slice('http:'.length)}`;
    if (u.protocol === 'https:') return `https-proxy:${proxyUrl.slice('https:'.length)}`;
  } catch { /* fall through */ }
  return proxyUrl;
}
```
This stays localized to `ProxyAwareHttpClient` — the global gateway registry is untouched, so `resolve('http://site')` still returns null elsewhere.

### 2. `sendViaHttpProxy` was a URL-rewrite, not a tunnel
**File:** `src/browser/networking/request-manager.ts`
**Problem:** The old implementation sent an absolute-URI request to the proxy via `FetchHttpClient` (`GET http://host/ HTTP/1.1`, Host rewritten). HTTPS targets cannot be tunneled this way (no CONNECT), and even for HTTP the proxy had to support absolute-form requests.
**Fix:** In Node, `sendViaHttpProxy` now lazily creates a per-proxy `RawSocketHttpClient({ httpProxy })` (cached, invalidated on `updateProxyConfig`) that performs a real CONNECT tunnel. The old fetch behavior is preserved as `sendViaHttpProxyLegacy` for non-Node runtimes.

### 3. `SocketReader` was locked inside the SOCKS module
**File:** `src/browser/networking/socks-connection.ts` → `src/browser/networking/socket-reader.ts`
**Problem:** The buffered `SocketReader` was a private class inside `socks-connection.ts` and only supported fixed-length reads. The CONNECT handshake needs a delimiter-terminated read (until `\r\n\r\n`).
**Fix:** Extracted `SocketReader` into `socket-reader.ts` with a `read(min)` + `readUntil(delimiter)` FIFO queue and an injectable "closed" error factory so each protocol (SOCKS / HTTP CONNECT) raises its own error type. SOCKS and CONNECT handshakes now share one reader.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/request-manager.ts` | `normalizeProxyUrlForGateway`; `sendViaHttpProxy` → CONNECT transport (legacy fetch fallback retained); per-proxy `httpConnectTransport` cache + invalidation; `createProxyConfigFromEnv` now reads `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` |
| `src/browser/networking/raw-socket-http-client.ts` | `httpProxy` constructor option; CONNECT tunnel in `run()`; TLS wrap + immediate-write conditions cover both SOCKS and HTTP proxy |
| `src/browser/networking/socks-connection.ts` | Uses shared `SocketReader` from `socket-reader.ts` (class removed from this file) |
| `src/app/main.ts` | Proxy transport selected when `httpProxy`/`httpsProxy`/`socksProxy` present |
| `doc/README.md` | Index row for this change log |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/socket-reader.ts` | Shared buffered socket reader (`read`/`readUntil`/`detach`) with injectable closed-error factory |
| `src/browser/networking/http-proxy-connect.ts` | `parseHttpProxyUrl` (http/https, default ports, `Proxy-Authorization` Basic from URL creds), `connectThroughHttpProxy` (CONNECT handshake, TLS-to-proxy for `https://` URLs), `HttpProxyError` |
| `tests/helpers/http-proxy-test-server.ts` | In-process mock HTTP proxy: relay / idle / `neverRespond` / `rawReply` / `replyStatus`, `events` log |
| `tests/networking-http-proxy.test.ts` | 24 tests: `parseHttpProxyUrl` (5), `connectThroughHttpProxy` (5), `RawSocketHttpClient` over HTTP proxy (4), `ProxyAwareHttpClient` dispatch (4), `createProxyConfigFromEnv` HTTP env vars (6) |

## Test Results

```
$ npx vitest run tests/networking-http-proxy.test.ts tests/networking-socks.test.ts tests/socks-connection.test.ts
 Test Files  3 passed (3)
      Tests  53 passed (53)
   Duration  8.49s

$ npx tsc --noEmit
  only 6 pre-existing errors remain (interpreter.ts, values.ts, vm.ts,
  web-apis.ts, websocket-api.ts, gpu-rasterizer.test.ts) — same as baseline

$ npx vitest run tests/networking-integration.test.ts tests/gateway-protocols.test.ts
 Test Files  1 failed | 1 passed (2)      # only pre-existing DNS test fails
      Tests  1 failed | 85 passed (86)

$ npx vitest run
 Test Files  5 failed | 180 passed (185→186)  # all failing tests are pre-existing
      Tests  6 failed | 8478 passed (8537)
```

Full-suite failure list is unchanged from baseline (JS interpreter `void | JSValue`: `bytecode-vm` ×2, `worker`, `js-builtins`, `rasterizer`; DNS `localhost` resolution; download-manager sort-order). No networking regressions; all 53 proxy tests (29 SOCKS + 24 HTTP CONNECT) pass.

## Verification Steps

1. `npx tsc --noEmit` → only the 6 baseline errors (all in untouched JS interpreter files).
2. Proxy suites → 53/53 pass, no `afterAll` hangs, no leaked sockets.
3. Regression: `networking-integration` + `gateway-protocols` → 85/86 (known DNS test).
4. Full suite → 8478 passed vs 8425 pre-SOCKS baseline; failed list unchanged from baseline.
5. `SocketReader` extraction verified: all 17 pre-existing SOCKS unit tests still pass unchanged.

## Known Limitations

- HTTPS (TLS-to-proxy) `https://` proxy URLs connect with `rejectUnauthorized: false` — the `tlsHandler` validates the *target* certificate, not the proxy's.
- No `Proxy-Authorization` challenge flow: only credentials embedded in the proxy URL are sent.
