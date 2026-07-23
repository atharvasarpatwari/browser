# Real Networking Stack — TCP/TLS/DNS

**Date:** 2026-07-23
**Session:** Real TCP/TLS networking implementation
**Status:** Completed

---

## Summary

Replaced stub/simulated networking with real TCP/TLS socket transport, real DNS resolution via Node.js `dns` module with DNS-over-HTTPS fallback, and opt-in real TLS certificate chain retrieval. Created `RawSocketHttpClient` as an `IHttpClient` implementation using actual TCP sockets via `net.connect()` and `tls.connect()`. Added 15 integration tests with a local HTTP test server.

## Root Causes

### 1. DNS resolver returned hostname instead of IP addresses
**File:** `src/browser/netwroking/dns-resolver.ts`
**Problem:** `defaultSystemResolver()` just returned `[hostname]` — no actual DNS lookup, so any code expecting real IP addresses got hostnames.
**Fix:** Replaced with real DNS resolution: tries `dns.promises.resolve4()`/`resolve6()` in Node.js, falls back to DNS-over-HTTPS (Cloudflare `cloudflare-dns.com/dns-query`) in browser environments, and falls back to hostname if both fail.

### 2. TLS handler created fake certificate chains
**File:** `src/browser/netwroking/tls-handler.ts`
**Problem:** `buildCertificateChain()` created synthetic `CertificateInfo[]` with deterministic fake hashes. `defaultEvaluator()` always returned `Valid`. No real TLS handshake was ever performed.
**Fix:** Added `buildCertificateChainReal()` that performs a real `tls.connect()` handshake to extract the actual peer certificate and full CA chain. Added `useRealTls` config flag (default `false`) to opt in to real TLS — avoiding hangs in tests or environments without network access. Falls back to simulated chain when real TLS is disabled or fails.

### 3. No raw socket HTTP client existed
**File:** (new) `src/browser/netwroking/raw-socket-http-client.ts`
**Problem:** The only `IHttpClient` was `FetchHttpClient` which delegates to `globalThis.fetch()`. No way to use raw TCP/TLS sockets directly.
**Fix:** Created `RawSocketHttpClient` implementing `IHttpClient` using `net.connect()` for HTTP and `tls.connect()` for HTTPS. Handles HTTP/1.1 request/response framing, chunked transfer encoding decode, Content-Length parsing, timeout management, and AbortSignal support.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/netwroking/dns-resolver.ts` | Replaced `defaultSystemResolver()` stub with real DNS via `dns.promises` + DNS-over-HTTPS fallback |
| `src/browser/netwroking/tls-handler.ts` | Added `useRealTls` config flag, `buildCertificateChainReal()` for real TLS handshake, real `defaultEvaluator()` |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/netwroking/raw-socket-http-client.ts` | `RawSocketHttpClient` — IHttpClient via real TCP/TLS sockets (HTTP/1.1, chunked encoding, timeouts, abort) |
| `tests/networking-integration.test.ts` | 15 integration tests: RawSocketHttpClient (7), DNS real resolution (4), TLS handler (2), end-to-end page loading (2) |

## Architecture

```
BrowserEngine.setPageLoader(PageLoader(ResourceLoader(FetchHttpClient(globalThis.fetch))))
                                                               OR
                                            PageLoader(ResourceLoader(RawSocketHttpClient(net/tls)))
```

The existing `FetchHttpClient` → `globalThis.fetch()` path works for browser/Electron targets.
The new `RawSocketHttpClient` → `net.connect()`/`tls.connect()` path works for Node.js targets and gives full control over the network stack.

## Test Results

```
tests/networking-integration.test.ts  15 tests  ✓ passed
tests/dns-resolver.test.ts            12 tests  ✓ passed
tests/tls-handler.test.ts             18 tests  ✓ passed
tests/networking-setup.test.ts        15 tests  ✓ passed
tests/ip-protocol.test.ts             77 tests  ✓ passed
tests/ip-protocol-firewall.test.ts    97 tests  ✓ passed
tests/gateway-protocols.test.ts       49 tests  ✓ passed
Total: 349/349 passed, 0 failures
```

## Verification Steps

1. `npx vitest run tests/networking-integration.test.ts` — 15/15 pass
2. `npx vitest run tests/dns-resolver.test.ts tests/tls-handler.test.ts tests/networking-setup.test.ts` — 45/45 pass (existing tests unaffected)
3. `npx vitest run tests/ip-protocol.test.ts tests/ip-protocol-firewall.test.ts tests/gateway-protocols.test.ts` — 223/223 pass
4. Combined run of all 7 networking test files: 349/349 pass
