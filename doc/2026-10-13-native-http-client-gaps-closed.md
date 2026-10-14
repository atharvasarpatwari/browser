# Native HTTP Client Gaps Closed (Redirects, Chunked Encoding, Connection Reuse) + DNS/TLS Placeholders

**Date:** 2026-10-13
**Session:** Closed the gaps flagged (but deliberately left open) in `doc/2026-10-10-url-parsing-native-http-fixes.md`'s addendum: the native Rust HTTP client had no redirect following, no chunked transfer-encoding, and no connection reuse; DNS queried A records only with a hardcoded TTL; TLS reported placeholder protocol/cipher strings.
**Status:** Completed

---

## Summary

`native/nova-net` is still not wired into the live browser (confirmed again: nothing under `src/` imports `src/native/index.ts`'s wrappers), but the gaps the previous session explicitly deferred are now closed so the module isn't a liability if/when it's wired in later. Five root causes fixed across `http.rs`, `dns.rs`, and `tls.rs`. Also fixed an unrelated `.gitignore` gap discovered while building: it only ignored `native/target/`, but the actual Cargo build output goes to the repo-root `target/` per `native/.cargo/config.toml`'s `target-dir = "../target"`.

## Root Causes

### 1. `fetch()` never followed redirects
**File:** `native/nova-net/src/http.rs`
**Problem:** A 301/302/303/307/308 response was simply returned to the caller as-is; nothing resolved the `Location` header or re-sent the request. The live TypeScript stack (`redirect-handler.ts`) already does this.
**Fix:** `fetch()` now loops up to `MAX_REDIRECTS` (10, matching `redirect-handler.ts`'s `maxHops` default) resolving `Location` against the current URL (absolute, absolute-path, and relative-path forms) via `resolve_redirect_url`. 301/302/303 rewrite non-safe methods to GET and drop the body (standard browser behavior); 307/308 preserve method and body.

### 2. No chunked transfer-encoding support, and response reads were read-to-EOF only
**File:** `native/nova-net/src/http.rs`
**Problem:** `send_and_receive` called `read_to_string` until EOF, which only works when the server closes the connection after every response — it can't decode `Transfer-Encoding: chunked` and is incompatible with any form of connection reuse.
**Fix:** Added a small `BufStream` that reads HTTP/1.1 framing properly: headers up to `\r\n\r\n`, then body via `Content-Length`, chunked decoding (`read_chunked_body`), or EOF fallback for close-delimited responses.

### 3. No connection reuse
**File:** `native/nova-net/src/http.rs`
**Problem:** Every request sent `Connection: close` and opened a fresh TCP/TLS connection, even for repeated requests to the same host.
**Fix:** Added a process-wide connection pool (`OnceLock<Mutex<HashMap<(host, port, is_tls), Vec<Box<dyn ConnStream>>>>>`, capped at 4 idle connections per key). Requests now send `Connection: keep-alive`; a response is only returned to the pool when its framing was unambiguous (`Content-Length` or chunked, not close-delimited) and it wasn't a `Connection: close` response. If a pooled connection turns out to have been idle-closed by the peer (the standard failure mode for naive pools), `fetch_once` retries once on a fresh connection instead of surfacing a spurious error.
- Follow-up (same day): added idle-timeout eviction to the pool (`POOL_IDLE_TIMEOUT` = 20s — most servers' keep-alive window is 5-60s) — `take_pooled` discards anything older than that instead of handing out a connection the peer likely already closed.
- Follow-up (same day): `resolve_redirect_url` now implements full RFC 3986 §5.3/§5.2.4 reference resolution — protocol-relative (`//host/...`), bare-query (`?x=1`), and `.`/`..` dot-segment collapsing, via a new `remove_dot_segments` + `merge_paths`.

### 4. DNS resolved A records only, with TTL hardcoded to 0
**File:** `native/nova-net/src/dns.rs`
**Problem:** `resolve_with_options` only ever queried `RecordType::A`, so no IPv6 destination could ever be returned, and every `DnsRecord.ttl` was hardcoded to `0` regardless of the real DNS answer's TTL.
**Fix:** Queries A and AAAA concurrently via `tokio::join!` (one record type failing isn't an error on its own; both failing is), and reads the real TTL from each record via `hickory_resolver::lookup::Lookup::record_iter()` / `Record::ttl()` instead of the old `lookup.iter()` (RData-only, no TTL access).

### 5. TLS reported placeholder protocol/cipher strings
**File:** `native/nova-net/src/tls.rs`
**Problem:** `connect_tls` built a `TlsInfo` with `protocol_version: "TLSv1.2+"` and `cipher_suite: "unknown"` unconditionally — `ClientConnection::new()` doesn't perform the handshake, so these were never going to reflect what was actually negotiated.
**Fix:** Drives the handshake to completion with `conn.complete_io(&mut tcp)` before reading `conn.protocol_version()` / `conn.negotiated_cipher_suite()`, so `TlsInfo` now reports the real negotiated values (falling back to `"unknown"` only if genuinely `None`).

## Files Modified
| File | Change |
|------|--------|
| `native/nova-net/src/http.rs` | Redirect loop in `fetch()`, `resolve_redirect_url`, `BufStream` (framing-aware header/body reads, chunked decode), connection pool (`ConnStream` trait + `OnceLock<Mutex<...>>`), `fetch_once` (pooled-connection retry-once-on-stale), new `HttpError::TooManyRedirects` variant; removed the old `send_and_receive`/`parse_http_response` in favor of the above |
| `native/nova-net/src/dns.rs` | `resolve_with_options` now queries A + AAAA concurrently and reads real TTLs via `record_iter()`/`Record::ttl()` instead of hardcoding `ttl: 0` |
| `native/nova-net/src/tls.rs` | `connect_tls` drives the handshake via `complete_io` before reporting `protocol_version`/`cipher_suite`, replacing the hardcoded placeholder strings |
| `.gitignore` | Fixed `native/target/` → `/target/` to match where Cargo actually writes build output (`native/.cargo/config.toml`'s `target-dir = "../target"`) |

## Files Created
| File | Purpose |
|------|--------|

## Test Results
```
cargo check -p nova-net --features http  (PATH prefixed with /c/mingw64/bin, run from native/)
  → Finished, 0 errors, 0 warnings

cargo test -p nova-net --features http  (first pass, before the two follow-up fixes below)
  → lib: 16 passed; 0 failed
  → integration: 11 passed; 0 failed

cargo test -p nova-net --features http  (after adding pool idle-timeout eviction + full RFC 3986
  redirect resolution)
  → lib: 20 passed; 0 failed  (4 more new: remove_dot_segments, resolve_redirect_url_dot_segments,
    resolve_redirect_url_bare_query, resolve_redirect_url_protocol_relative)
  → integration: 11 passed; 0 failed (unchanged — all still exercise only the public fetch_simple API)
```

## Verification Steps Taken
- Compiled clean (`cargo check -p nova-net --features http`) before running tests.
- Ran the full `nova-net` test suite (lib + integration + doc-tests): 27/27 passed, 0 failed.
- `test_http_parse_response` (an existing integration test) makes a real request to `https://example.com` through the new redirect/chunked/pooling code path and still passes, confirming the rewrite didn't break a live round trip.
- Confirmed the `.gitignore` gap directly: `git status` showed an untracked `target/` at the worktree root after the build, which `native/target/` doesn't match; fixed and re-checked `git status` shows it gone.
