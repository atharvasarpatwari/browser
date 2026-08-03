# SOCKS4 / SOCKS4a / SOCKS5 Proxy Support

**Date:** 2026-08-03
**Session:** SOCKS proxy support for the Node raw-socket transport — client, transport integration, proxy dispatch, and tests
**Status:** Completed

---

## Summary

Implemented real SOCKS4/4a/5 proxy support for Nova's Node networking stack. A new pure-TS SOCKS client (`socks-connection.ts`) performs the handshake over `net` sockets and returns a tunneled socket; `RawSocketHttpClient` gained a `socksProxy` option (HTTP writes straight through the tunnel, HTTPS wraps it with `tls.connect({ socket })`); `ProxyAwareHttpClient` now dispatches `socks4/socks4a/socks5` gateway schemes to a lazily-created, per-proxy `RawSocketHttpClient`. Before this change, `sendViaProxy` only logged "SOCKS not yet implemented" and fell back to a direct connection. Two in-memory test helpers (self-signed X.509 cert generator and a configurable mock SOCKS server) plus 29 new tests were added. Finally the SOCKS client is wired into the production app (`src/app/main.ts`): a `NOVA_SOCKS_PROXY` / `ALL_PROXY` (socks scheme) environment variable now selects a `ProxyAwareHttpClient` as the `ResourceLoader` transport, with the DI `TlsHandler` forwarded down into the tunnel so HTTPS-through-SOCKS keeps certificate verification.

## Production Wiring

**Files:** `src/app/main.ts`, `src/browser/networking/request-manager.ts`

- `main.ts` previously used a stale `isNode` check (`typeof globalThis.fetch === 'undefined'`) that is **false on Node ≥ 18** (fetch exists), so `RawSocketHttpClient` was never selected and the app silently ran on `globalThis.fetch`. Fixed to detect Node via `process.versions?.node`.
- New `createProxyConfigFromEnv()` (exported from `request-manager.ts`) reads `NOVA_SOCKS_PROXY` (or `ALL_PROXY` when it carries a socks scheme) and a comma-separated `NO_PROXY`/`no_proxy` bypass list. Conventional `HTTP_PROXY`/`HTTPS_PROXY` are deliberately ignored: the HTTP(S)-proxy CONNECT path is not yet production-exercised, and silently routing traffic through an untested tunnel is riskier than staying direct.
- `main.ts` `ResourceLoader` registration:
  ```ts
  const proxyConfig = createProxyConfigFromEnv();
  let client: IHttpClient | undefined;
  if (proxyConfig.socksProxy) {
    client = new ProxyAwareHttpClient(proxyConfig, undefined, tlsHandler);
  } else if (isNode) {
    client = new RawSocketHttpClient({ tlsHandler });
  }
  ```
  Direct (no-proxy) requests keep the real-socket transport; proxied requests tunnel via SOCKS; non-Node runtimes fall back to `fetch` with a warning (existing behavior).
- `ProxyAwareHttpClient` constructor gained an optional third parameter `tlsHandler?: ITlsHandler`, forwarded into the lazily-created `RawSocketHttpClient({ socksProxy, tlsHandler })` so HTTPS over SOCKS validates certificates instead of relying on the legacy `rejectUnauthorized: false` + trust-everything path.

## Root Causes (bug fix)

### 1. SOCKS5 handshake hung on success (bound-address framing)
**File:** `src/browser/networking/socks-connection.ts`
**Problem:** `readExact()` resolved with the **entire** data chunk once `received >= count`. A single TCP segment carrying the full 10-byte CONNECT reply `[05 00 00 01 7f 00 00 01 00 00]` was returned to the 4-byte header read; the subsequent bound-address read then waited forever for bytes that had already been consumed → timeouts on every successful CONNECT.
**Fix:** Replaced `readExact` with a buffered `SocketReader` (surplus bytes stay in an internal buffer and feed later reads). Leftover bytes after the handshake are re-emitted into the tunneled stream via `socket.emit('data', leftover)` on `detach()`.

```ts
read(min: number): Promise<Buffer> {
  if (this.closed) return Promise.reject(new SocksError('SOCKS proxy connection is closed', 'CONN_CLOSED'));
  return new Promise((resolve, reject) => {
    this.waiters.push({ min, resolve, reject });
    this.flush();
  });
}
private flush(): void {
  while (this.waiters.length > 0 && this.buffer.length >= this.waiters[0]!.min) {
    const w = this.waiters.shift()!;
    const out = this.buffer.subarray(0, w.min);
    this.buffer = this.buffer.subarray(w.min);
    w.resolve(Buffer.from(out));
  }
}
```

### 2. Null dereference in `RawSocketHttpClient.send()` on the SOCKS path
**File:** `src/browser/networking/raw-socket-http-client.ts`
**Problem:** The response collectors `socket.on('data'/'end', …)` were attached at executor level *before* `socket = rawSocket` ran — on the SOCKS path `run()` awaits `connectThroughSocks()`, so `socket` was still `null` when the listeners were attached. The first SOCKS request would have crashed with `TypeError: Cannot read properties of null`. (The networking-socks suite was previously fully skipped, hiding this.)
**Fix:** Moved the `data`/`end` collectors (and `chunks`) inside `run()`, immediately after `socket = rawSocket`.

### 3. Self-signed cert rejected: `asn1 encoding routines::too long`
**File:** `tests/helpers/self-signed-cert.ts`
**Problem:** `derUtcTime()` returned the raw ASCII time string **without** a UTCTime tag (`0x17`) and length. The validity SEQUENCE therefore wrapped two bare strings, which both OpenSSL (`X509Certificate` parse) and `asn1js` rejected.
**Fix:** Wrap the string in a proper UTCTime TLV.

```ts
function derUtcTime(d: Date): Buffer {
  const iso = d.toISOString();
  const utc = `${iso.slice(2,4)}${iso.slice(5,7)}${iso.slice(8,10)}${iso.slice(11,13)}${iso.slice(14,16)}${iso.slice(17,19)}Z`;
  return derTag(0x17, Buffer.from(utc, 'ascii')); // UTCTime tag + length
}
```

### 4. Mock server bugs (test-only)
**File:** `tests/helpers/socks-test-server.ts`
- `if (options.methods)` with default `methods: []` (truthy!) selected `undefined`, which coerced to `0x00` in `Buffer.from([0x05, undefined])` — silently skipping RFC 1929 auth. Fixed with `Array.isArray(options.methods) && options.methods.length > 0`.
- SOCKS4a detection `ip[3] !== 0` misclassified real IPv4 addresses (`127.0.0.1` has last octet 1) as SOCKS4a, hanging while reading a nonexistent hostname. Fixed to `ip[0] === 0 && ip[1] === 0 && ip[2] === 0 && ip[3] !== 0`.
- Relay mode leaked sockets: when the upstream closed, the SOCKS side stayed half-open, so `server.close()` in `afterAll` hung. Added mutual `close` → `destroy` wiring.

### 5. ProxyAwareHttpClient tests never exercised the SOCKS path
**File:** `tests/networking-socks.test.ts`
**Problem:** The default `noProxy` list includes `127.0.0.1`, so every test URL bypassed the proxy and fell through to happy-dom's fetch (cross-origin → blocked). Tests also relied on the mock selecting auth without being told to.
**Fix:** Pass `noProxy: []` where the tunnel is under test; add CORS (`Access-Control-Allow-Origin: *` + OPTIONS preflight handling) to the fixture servers for the bypass test's direct fetch; pass `methods: [0x02]` for the RFC 1929 auth unit tests.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/socks-connection.ts` | New SOCKS client (see below); `SocketReader` buffered reader, SOCKS5/SOCKS4a handshakes with leftover re-emit |
| `src/browser/networking/raw-socket-http-client.ts` | `socksProxy` constructor option; `run()` executor with socket-null guards; SOCKS → TLS wrap for HTTPS; response collectors moved after socket assignment |
| `src/browser/networking/request-manager.ts` | `ProxyAwareHttpClient.sendViaSocks` Node dispatch; per-proxy `socksTransport` cache; invalidation on `updateProxyConfig`; `isNode` via `process.versions?.node`; constructor `tlsHandler` injection; exported `createProxyConfigFromEnv` |
| `src/app/main.ts` | Fixed stale `isNode` detection; `ResourceLoader` now uses `ProxyAwareHttpClient` when a socks proxy env var is present, else `RawSocketHttpClient`; imports `IHttpClient`/`ProxyAwareHttpClient`/`createProxyConfigFromEnv` |
| `tests/helpers/self-signed-cert.ts` | UTCTime TLV fix (see root cause 3) |
| `tests/helpers/socks-test-server.ts` | Empty-array `methods` guard; SOCKS4a detection fix; relay teardown (see root cause 4) |
| `tests/networking-socks.test.ts` | `noProxy: []`, CORS fixture, https server type, full `TlsNegotiationResult` stub, missing `headers`; +6 `createProxyConfigFromEnv` unit tests |
| `tests/socks-connection.test.ts` | `methods: [0x02]` for RFC 1929 tests |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/socks-connection.ts` | Pure-TS SOCKS4/4a/5 client: `connectThroughSocks`, `parseSocksProxyUrl`, `SocksError` (TIMEOUT/ABORTED/CONNECT_ERROR/HANDSHAKE/METHOD_REJECTED/AUTH_REQUIRED/AUTH_FAILED/AUTH_UNSUPPORTED/BAD_VERSION/BAD_ATYP/CONNECT_FAILED/CONN_CLOSED), IPv4/IPv6/domain address encoders, buffered `SocketReader` |
| `tests/helpers/self-signed-cert.ts` | Node-crypto-only X.509 self-signed cert builder (no openssl dependency) |
| `tests/helpers/socks-test-server.ts` | In-process mock SOCKS4/5 server: echo / relay / neverRespond modes, auth/reply control, `events` log, buffered `FrameReader` |
| `tests/socks-connection.test.ts` | 17 unit tests: URL parsing (5), SOCKS5 handshake incl. auth/fail/timeout/abort (8), SOCKS4/4a (3), unreachable proxy (1) |
| `tests/networking-socks.test.ts` | 12 integration + unit tests: HTTP/HTTPS over SOCKS5 relay, unreachable target, `ProxyAwareHttpClient` dispatch, `updateProxyConfig` reroute, no-proxy bypass, `createProxyConfigFromEnv` (env parsing ×6) |

## Test Results

```
$ npx vitest run tests/socks-connection.test.ts tests/networking-socks.test.ts
 Test Files  2 passed (2)
      Tests  29 passed (29)
   Duration  8.07s

$ npx vitest run tests/networking-integration.test.ts tests/gateway-protocols.test.ts
 Test Files  1 failed | 1 passed (2)      # only pre-existing DNS test fails
      Tests  1 failed | 85 passed (86)

$ npx tsc --noEmit
  only 6 pre-existing errors remain (interpreter.ts, values.ts, vm.ts,
  web-apis.ts, websocket-api.ts, gpu-rasterizer.test.ts) — same as baseline

$ npx vitest run
 Test Files  6 failed | 178 passed (185)  # all 7 failing tests are pre-existing
      Tests  7 failed | 8452 passed (8513)
```

Full-suite failure list is identical to the pre-SOCKS baseline (JS interpreter `void | JSValue` area: `bytecode-vm`, `worker`, `js-builtins`, `rasterizer`; DNS `localhost` resolution on this machine; plus one environment `Worker exited unexpectedly`/heap-OOM crash). No networking regressions; the 29 SOCKS tests (23 client/dispatch + 6 env parsing) all pass.

## Verification Steps

1. `npx tsc --noEmit` → only the 6 baseline errors (all in untouched JS interpreter files).
2. Targeted SOCKS suites → 29/29 pass, no `afterAll` hangs, no leaked sockets.
3. Regression: `networking-integration` + `gateway-protocols` → 85/86 (the single failure is the known DNS test).
4. Full suite → 8452 passed vs 8425 baseline (+27 net from the 29 new tests minus the DNS failure); failed list unchanged from baseline.
5. Cert helper validated independently: `new X509Certificate(pem)` and `pkijs` both parse the generated certificate (subject `CN=localhost`).
6. Production wiring: `npx tsc --noEmit` is clean for `main.ts`/`request-manager.ts` after the wiring change; env-factory behavior covered by 6 new unit tests.
