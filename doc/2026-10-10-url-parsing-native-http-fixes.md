# URL Parsing Review & Native HTTP/DNS Fixes

**Date:** 2026-10-10
**Session:** Reviewed TS and native Rust URL parsing, fixed scheme/port handling, a response-body parsing bug, a DNS resolver timeout, and an unvalidated HTTP method
**Status:** Completed

---

## Summary

Checked `src/browser/navigation/url-parser.ts` (already fully implemented, 100/100 tests passing, no changes needed) and the native Rust networking side (`native/nova-net/src/http.rs`), which only did minimal `http::Uri` parsing with no scheme awareness. Fixed four issues found while digging into native networking and running the full test suite: a missing http/https scheme branch, a pre-existing rustls API-rename compile break, an off-by-one response body offset bug, a DNS resolver timeout caused by a hung IPv6 query blocking a fast IPv4 answer, and an unvalidated HTTP method string.

## Root Causes

### 1. `fetch()` had no scheme-aware port/TLS branching
**File:** `native/nova-net/src/http.rs`
**Problem:** `url.port_u16().unwrap_or(443)` defaulted every URL to port 443 and the function always performed a TLS handshake, regardless of the URL's actual scheme (`http:` vs `https:`). A plain `http://` URL with no explicit port would get the wrong default port and an unwanted TLS handshake.
**Fix:** Read `url.scheme_str()`, branch on `http`/`https` (default ports 80/443 respectively), reject any other scheme as `HttpError::InvalidUrl`, and only build the TLS config/handshake when the scheme is `https`. Factored the write/read loop into `send_and_receive<S: Read + Write>` so both the TLS stream and the plain `TcpStream` share it.

### 2. Pre-existing compile break: renamed rustls type
**Files:** `native/nova-net/src/http.rs`, `native/nova-net/src/tls.rs`
**Problem:** Both files referenced `rustls::pki_types::InvalidServerErrorName`, which doesn't exist in the pinned `rustls-pki-types` version — the type is `InvalidDnsNameError`. This blocked every native build on this machine (confirmed pre-existing by reverting the http/tls scheme fix and reproducing the same error).
**Fix:** Renamed both usages to `InvalidDnsNameError`.

### 3. `parse_http_response` body offset was wrong by construction
**File:** `native/nova-net/src/http.rs`
**Problem:** The function summed `line.len() + 1` per header line to locate the body, assuming `\n`-only line terminators — but responses use `\r\n` (2 bytes), and the status line's own length was never added to the running offset at all. Both counting errors together sliced the body out of alignment (confirmed via `test_parse_http_response` / `test_parse_http_response_no_body` failing).
**Fix:** Replaced the offset arithmetic with a direct search for the `\r\n\r\n` separator (falling back to `\n\n`), splitting head from body directly instead of reconstructing an offset.

### 4. DNS resolver: hung IPv6 query blocked a fast IPv4 answer
**File:** `src/browser/networking/dns-resolver.ts`
**Problem:** `defaultSystemResolver` ran `dns.resolve4()` and `dns.resolve6()` via `Promise.allSettled`, which waits for both to settle even though each is individually `.catch()`-guarded to never reject. Measured directly: `resolve4('localhost')` returned in 4ms, but `resolve6('localhost')` hung ~28s before `ETIMEOUT` (no reachable IPv6 resolver). `Promise.allSettled` blocked on the slower query regardless, exceeding the resolver's own 5000ms deadline and throwing `DnsTimeoutError` even though a correct answer was available almost instantly.
**Fix:** Added `withFallback()`, racing each query against a 2000ms cap that resolves to `[]` on timeout, so one hung query can no longer stall the other's result.

### 5. `fetch()` never validated the HTTP method string
**File:** `native/nova-net/src/http.rs`
**Problem:** A method string containing spaces (e.g. `"NOT A METHOD"`) was sent verbatim into the request line, producing a malformed `NOT A METHOD / HTTP/1.1` line. The remote server still answered with an ordinary HTTP 400, which `fetch()` parsed and returned as `Ok(...)` — confirmed by a direct probe against `https://example.com`.
**Fix:** Validate the method against `http::Method::from_bytes` (the `http` crate is already a dependency) before building the request, returning the new `HttpError::InvalidMethod` variant for invalid tokens.

## Files Modified
| File | Change |
|------|--------|
| `native/nova-net/src/http.rs` | Scheme-aware port/TLS branching, `send_and_receive` helper, fixed `parse_http_response` body offset, method validation, new `HttpError::InvalidMethod` variant, 2 new unit tests |
| `native/nova-net/src/tls.rs` | Renamed `InvalidServerErrorName` → `InvalidDnsNameError` |
| `src/browser/networking/dns-resolver.ts` | Added `withFallback()` + `SYSTEM_QUERY_TIMEOUT_MS` to bound `resolve4`/`resolve6` independently |

## Files Created
| File | Purpose |
|------|--------|

## Test Results
```
cargo test -p nova-net --features http  (PATH prefixed with /c/mingw64/bin — see
  2026-07-27-native-build-backbone.md for why; LIBNODE_PATH unrelated and only
  needed for the nova-bindings crate, which has no tests of its own and is not
  linkable on this Windows/MinGW setup — pre-existing, out of scope)
  → lib: 11 passed; 0 failed
  → integration: 11 passed; 0 failed

npx vitest run
  → 217 files passed, 9201 tests passed, 0 failed
```

## Verification Steps Taken
- Confirmed the rustls compile break was pre-existing by stashing the http.rs edit and reproducing the identical error on the unmodified file.
- Probed `dns.promises.resolve4/resolve6/lookup('localhost')` directly to measure the ~28s `resolve6` `ETIMEOUT` versus the 4ms `resolve4` success, confirming the `Promise.allSettled` root cause before patching.
- Probed `fetch_simple("https://example.com", "NOT A METHOD", ...)` directly (temporary test, removed after use) and confirmed it returned `Ok(status=400)`, confirming the missing-validation root cause before patching.
- Re-ran full native (`cargo test -p nova-net --features http`) and full TS (`npx vitest run`) suites after each fix to confirm no regressions.
