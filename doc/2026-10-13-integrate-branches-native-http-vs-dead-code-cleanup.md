# Integrate Branches — Native HTTP Client vs. Dead-Code Cleanup Merge Conflict

**Date:** 2026-10-13
**Session:** Merged `claude/wire-native-http-client` and `claude/compliance-checklist-browser-08545b` into `claude/integrate-codes-browser-6e8566` (on top of `origin/main`). `claude/url-rendering-option-c24f32` was also checked but had no commits beyond `origin/main` — nothing to integrate.
**Status:** Completed

---

## Summary

Merged two branches that were edited concurrently and went stale with respect to each other: `claude/wire-native-http-client` wired the native Rust HTTP client (`native/nova-net/src/http.rs`, `native/nova-bindings/src/http.rs`) into the browser as a live `IHttpClient`, while `claude/compliance-checklist-browser-08545b`'s dead-code-cleanup commit deleted those same two files the same day, having correctly identified them as unused *before* the other branch wired them in. Resolved the conflict by keeping the files live and restoring their Cargo feature plumbing; kept every other deletion from the cleanup branch (mini-browser-android, dead UI subsystems, `src/native/http-client.ts`, etc.) since those are unrelated and still genuinely dead. `claude/url-rendering-option-c24f32` had zero commits beyond `origin/main` and needed no action.

## Root Causes (merge conflict)

### 1. Concurrent branches made opposite true-at-the-time calls about the same code
**Files:** `native/nova-net/src/http.rs`, `native/nova-bindings/src/http.rs`, `native/nova-net/Cargo.toml`, `native/nova-bindings/Cargo.toml`, `native/nova-net/src/lib.rs`, `native/nova-bindings/src/lib.rs`, `native/Cargo.lock`, `package.json`, `.github/workflows/native-build.yml`
**Problem:** `claude/compliance-checklist-browser-08545b`'s 2026-10-12 cleanup commit (`9f965ba`) deleted `http.rs` in both crates as "unused end-to-end," removing the `http` Cargo feature, the `#[cfg(feature = "http")] pub mod http;` lines, the `http` crate lockfile entry, and the `http` flag from `package.json`'s `native:build:*` scripts and `.github/workflows/native-build.yml`. That was correct when written. `claude/wire-native-http-client`'s 2026-10-11 commit (`615314e`) made the same code live by adding `src/browser/networking/native-http-client.ts` and wiring it into `src/app/main.ts`'s `IResourceLoader` factory — so by the time of this merge, deleting `http.rs` would have deleted code a different branch had just put into active use.
**Fix:** Kept `http.rs` in both crates at the `wire-native-http-client` version (chunked-transfer decoding + binary-safe `Buffer` body). Restored the `http` feature (`http = ["tls"]` in `nova-net`, `http = ["nova-net/http"]` in `nova-bindings`), the `pub mod http;` gate in both `lib.rs` files, the `http = "1"` dependency and its lockfile entry, and `http` in every `--features` list in `package.json` and `.github/workflows/native-build.yml` (including the three commented-out/disabled CI jobs, for consistency with the enabled ones). Left every other deletion from the cleanup commit untouched — `src/native/http-client.ts` (the separate, genuinely-unused `NovaHttpClient` wrapper — confirmed via `git grep` that nothing outside its own test imports it), `mini-browser-android/`, the dead UI subsystems, etc.

```toml
# native/nova-net/Cargo.toml — restored
[features]
default = ["dns"]
dns = []
tls = ["rustls", "webpki-roots"]
http = ["tls"]
...
# HTTP
http = "1"
```

```rust
// native/nova-net/src/lib.rs and native/nova-bindings/src/lib.rs — restored
#[cfg(feature = "http")]
pub mod http;
```

### 2. `doc/README.md` and `doc/analytics.html` conflicts were just parallel additions
**Files:** `doc/README.md`, `doc/analytics.html`
**Problem:** Both branches added rows to the same change-log table and the same `DOCS` array / KPI stat block, so the same lines conflicted even though the underlying content didn't actually contradict.
**Fix:** Kept all four new entries (ordered by date) from both branches in both files, and recomputed the aggregate KPI numbers (`kpiDocs`, `kpiTests`, `kpiRootCauses`, `kpiFiles`, `statDocs`, `statDays`) as the base count plus both branches' additions. Replaced the stale `statTests` ("Total Suite Tests") figure with a freshly measured number from an actual `npx vitest run` rather than carrying forward either branch's guess.

## Files Modified
| File | Change |
|------|--------|
| `native/nova-net/src/http.rs` | Kept at wire-native-http-client version (resolved deletion conflict) |
| `native/nova-bindings/src/http.rs` | Kept at wire-native-http-client version (resolved deletion conflict) |
| `native/nova-net/Cargo.toml` | Restored `http` feature + `http` dependency |
| `native/nova-bindings/Cargo.toml` | Restored `http` feature |
| `native/nova-net/src/lib.rs` | Restored `#[cfg(feature = "http")] pub mod http;` |
| `native/nova-bindings/src/lib.rs` | Restored `#[cfg(feature = "http")] pub mod http;` |
| `native/Cargo.lock` | Restored `http` crate lockfile entry |
| `package.json` | Restored `http` in all `native:build:*` `--features` lists |
| `.github/workflows/native-build.yml` | Restored `http` in all `--features` lists (enabled + disabled jobs) |
| `doc/README.md` | Merged both branches' change-log rows into one chronological table |
| `doc/analytics.html` | Merged both branches' `DOCS` entries; recomputed KPI/stat numbers from measured test run |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-10-13-integrate-branches-native-http-vs-dead-code-cleanup.md` | This change log |

## Test Results
```
npx tsc --noEmit
  0 errors

npx vitest run
  Test Files  206 passed (206)
  Tests       8667 passed (8667)
  Duration    136.26s

cargo check -p nova-net --features dns,tls,http --manifest-path native/Cargo.toml
  fails: pre-existing ring/gcc toolchain issue on this Windows machine
  ("sorry, unimplemented: 64-bit mode not compiled in" building ring's
  curve25519.c), gated behind the `tls` feature — same limitation already
  documented in the 2026-10-11 and 2026-10-12 sessions, confirmed unrelated
  to this merge by re-running with --features dns only (no tls/http), which
  compiles clean.

cargo check -p nova-net --features dns --manifest-path native/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 35.11s
```
