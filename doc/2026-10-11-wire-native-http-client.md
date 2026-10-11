# Wire the Native Rust HTTP Client Into the Browser

**Date:** 2026-10-11
**Session:** Fixed the two real gaps in the native Rust HTTP client that would have broken real traffic, fixed a Windows build-script gap, then wired it in as the preferred `IHttpClient` behind `isNativeAvailable()`
**Status:** Completed

---

## Summary

`native/nova-net` + `native/nova-bindings` (the Rust HTTP client, N-API-wrapped for Node) had sat completely unused since it was built — confirmed by grep: zero files in `src/` imported `src/native/index.ts`. Investigation found the integration was simpler than expected: `RequestManager` (`src/browser/networking/request-manager.ts`) already owns redirect-following, retry, and protocol-safety checks itself, calling whichever `IHttpClient` is injected once per hop — so a native-backed client doesn't need to implement any of that, just answer one exchange.

That left exactly two real gaps that would have broken real traffic if wired in untouched (no chunked-transfer decode, binary-unsafe body), plus one independently-found Windows build-script gap. Fixed all three, added a new `NativeHttpClient` adapter, and wired it into `src/app/main.ts`'s `IResourceLoader` factory as the preferred transport whenever the native module is available and no proxy is configured — mirroring how `src/native/index.ts` already treats native DNS/TLS. Nothing changes on a checkout where `npm run native:build` hasn't been run, since `isNativeAvailable()` stays false; confirmed directly on this machine.

## Root Causes

### 1. Chunked transfer-encoding was never decoded
**File:** `native/nova-net/src/http.rs`
**Problem:** `parse_http_response` returned the raw body bytes as-is regardless of `Transfer-Encoding`, so a chunked response's hex-size/CRLF framing stayed mixed into the body instead of being stripped.
**Fix:** Added `decode_chunked_body()` — decodes the chunk framing (`<hex-size>[;ext]\r\n<data>\r\n`, repeat until a `0`-size chunk) into one flat `Vec<u8>`. `parse_http_response` now checks the parsed headers for `transfer-encoding: chunked` and routes through it.

### 2. Response body was read as a lossy UTF-8 `String`
**File:** `native/nova-net/src/http.rs`
**Problem:** `send_and_receive` used `read_to_string`, which fails outright on non-UTF-8 bytes — any binary response (image, font, media) would error, not just corrupt.
**Fix:** Changed `send_and_receive` to `read_to_end` (returns `Vec<u8>`), and `parse_http_response`/`HttpResponse.body` to operate on raw bytes throughout. Headers are still parsed as UTF-8 (a real protocol violation if they aren't); the body is never forced through a text encoding.

### 3. `nova-bindings`'s N-API boundary still exposed the body as a string
**File:** `native/nova-bindings/src/http.rs`
**Problem:** `NapiHttpResponse.body: Option<String>` would have re-introduced the same lossy-UTF-8 problem one layer up, even after fixing `nova-net`.
**Fix:** Changed to `Option<napi::bindgen_prelude::Buffer>` (maps directly to a Node `Buffer`, a `Uint8Array` subclass — no base64 round-trip).

### 4. Windows native build silently compiled out `http`/`tls`
**File:** `package.json`
**Problem:** `native:build:win-x64` (and the generic `native:build`/`native:build:dev`) passed `--features dns` only, while the linux/darwin scripts correctly passed `dns,tls,http`. Since `nova-bindings/src/lib.rs` gates the `http` module behind `#[cfg(feature = "http")]`, a Windows build would produce a `.node` binary with `httpFetch` entirely absent — and `src/native/index.ts`'s `httpFetch()` calls `native.httpFetch(request)` with no existence check, so this wasn't a graceful fallback, it was a `TypeError` crash.
**Fix:** Added `,tls,http` to all three scripts.

### 5. (Pre-existing, unblocking) `TlsConfig`/`TlsVersion` missing `Serialize`
**File:** `native/nova-net/src/tls.rs`
**Problem:** Same root cause already fixed on a different branch (`claude/ponytail-folder-browser-8b310d`, PR #1) — `TlsConfig` only derived `Debug, Clone`, missing `Serialize`, which `nova-bindings/src/tls.rs`'s `tls_create_config()` needs. This branch forked from `main` before that fix landed, so it had to be reapplied here to get `cargo check -p nova-bindings` compiling at all.
**Fix:** Added `Serialize, Deserialize` to both `TlsConfig` and `TlsVersion`.

## Files Modified
| File | Change |
|------|--------|
| `native/nova-net/src/http.rs` | Dechunk + binary-safe body, module doc-comment updated to reflect wired status |
| `native/nova-net/src/tls.rs` | Pre-existing `Serialize` derive fix (see Root Cause 5) |
| `native/nova-bindings/src/http.rs` | `NapiHttpResponse.body` → `Option<Buffer>`, module doc-comment updated |
| `package.json` | `native:build`, `native:build:dev`, `native:build:win-x64` now include `tls,http` |
| `src/native/types.ts` | `HttpResponse.body` → `Uint8Array \| null` |
| `src/native/index.ts` | `fallbackHttpFetch` collects `Buffer` chunks instead of string-concatenating |
| `src/app/main.ts` | `IResourceLoader` factory prefers `NativeHttpClient` when `isNativeAvailable()` |

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/networking/native-http-client.ts` | `IHttpClient` adapter over the native Rust client — one exchange in, one `HttpResponseSpec` out; redirects/retry stay with `RequestManager` |
| `tests/native-http-client.test.ts` | End-to-end smoke test (plain/chunked/binary bodies, abort handling) against a real `http.createServer` |

## Test Results
```
cargo test -p nova-net --features http
  lib: 13 passed; 0 failed (incl. 2 new: chunked decode, binary body)
  integration: 11 passed; 0 failed

cargo check -p nova-bindings --features dns,tls,http
  Finished cleanly (Buffer-typed NapiHttpResponse.body compiles)

npx tsc --noEmit
  0 errors

npx vitest run
  218 files passed, 9205 tests passed, 0 failed (incl. 4 new in native-http-client.test.ts)
```

## Verification Steps Taken
- Ran `nova-net`'s Rust unit tests directly, including two new ones: a `Transfer-Encoding: chunked` fixture decoding to the expected flat bytes, and a non-UTF-8 (PNG-signature) body surviving intact through `parse_http_response`.
- `cargo check -p nova-bindings --features dns,tls,http` (not `cargo build` — linking `nova-bindings` on this Windows/MinGW machine hits a pre-existing, unrelated limitation: the checked-in `native/stubs/libnode.dll` is a placeholder, not a real import library, documented in earlier sessions) to confirm the `Buffer`-typed N-API boundary type-checks correctly.
- Confirmed `isNativeAvailable()` is `false` on this checkout (no compiled `.node` binary present) and that `src/app/main.ts`'s wiring therefore still falls back to `RawSocketHttpClient` exactly as before — zero behavior change until the native module is deliberately built.
- Wrote and ran `tests/native-http-client.test.ts` against a real `http.createServer` with plain, chunked, and binary (PNG) bodies, plus an already-aborted-signal case. Since the native module isn't compiled here, this exercises `httpFetch()`'s Node-based fallback path rather than the real Rust transport — still validates the full TS integration chain (request conversion, header lowercasing, content-type-based binary sniffing, `HttpResponseSpec` assembly) end-to-end. The Rust-specific dechunk/binary-safety logic itself is verified independently by the `nova-net` unit tests above.
- Full `npx vitest run` (218 files / 9205 tests) and `npx tsc --noEmit` (0 errors) confirm no regressions anywhere else in the codebase.
