# Native Rust Networking (`nova-net` / `nova-bindings`) — Status

This directory builds a napi-rs native addon (`nova_bindings.node`) wrapping
`nova-net`'s Rust DNS/TLS/HTTP implementations, loaded by `src/native/index.ts`.
It is **not currently used by the real browsing/networking path**
(`src/browser/networking/**`, `main.ts`) — that path uses
`RawSocketHttpClient`/`TlsHandler` over Node's own `net`/`tls`, proxied to the
Electron main process via `electron/socket-owner.cjs`. Wiring native
networking in is TODO.md item #5, in progress per-subsystem rather than
all-or-nothing, since the three subsystems are not equally ready.

## Per-subsystem status (2026-09-20)

| Subsystem | Rust implementation | Wired to production? | Notes |
|---|---|---|---|
| DNS | Real (`hickory-resolver`), solid | Not yet — planned next | Lowest risk, cleanest shape match to its JS exports. See "Native DNS wiring" below for the plan. |
| HTTP | Real but incomplete | **No — do not wire** | `nova-net/src/http.rs` is HTTPS-only (no plaintext-`http://` branch — always negotiates TLS), doesn't decode `Transfer-Encoding: chunked`, does no gzip/br/deflate decompression, and reads the response via `read_to_string`, which **errors on any non-UTF-8 (binary or compressed) body**. Most real-world responses would fail through this path as written. |
| TLS | Stub beyond "connected" | **No — do not wire** | `nova-net/src/tls.rs`'s `connect_tls()` hardcodes `protocol_version`/`cipher_suite` as placeholder strings and always returns an empty `peer_certificates`; the napi wrapper (`nova-bindings/src/tls.rs`) doesn't even forward a cert-chain field. `TlsHandler.buildCertificateChainReal()` (`src/browser/networking/tls-handler.ts`) needs a real chain — wiring this in today would be a functional regression, not an upgrade. |

**Do not attempt to wire HTTP or TLS into the real request path until the
gaps above are fixed in `native/nova-net/src/http.rs` / `tls.rs`.** That's
real Rust work (byte-based bodies, chunked/gzip decode, a plaintext-HTTP
branch, real cert/cipher extraction off the live `rustls::ClientConnection`)
— see TODO.md #5 for the fuller writeup.

## Native DNS wiring (in progress)

Plan: main process only (`electron/socket-owner.cjs`), since napi addons are
native Node addons and can only `require()` in a Node context — the renderer
runs `contextIsolation: true`/`nodeIntegration: false` and has none. A new
`nova:net` IPC request kind resolves via native DNS with a Node `dns`-module
fallback on any failure, feature-flagged behind `NOVA_NATIVE_DNS=1`, used as
a pre-resolution step in `openTcp()` before the existing `net.connect()`/
`tls.connect()` call — `RawSocketHttpClient`/`TlsHandler` stay untouched.

**Status:** `src/native/index.ts`'s per-function fallback bug is fixed (see
below) and a `native:dist:win-x64` build script exists, but the actual
native module has never been built or tested on this machine — **this
machine's Rust toolchain cannot currently compile it, confirmed two ways**:

1. MSVC target (`x86_64-pc-windows-msvc`, what `native:build:win-x64` uses):
   no `cl.exe`/`link.exe` anywhere (Visual Studio Build Tools not installed —
   the on-disk VS2019 folder is an empty installer shell), and no NASM on
   `PATH` (`rustls`' `ring` crypto backend needs an assembler to link, even
   for a DNS-only feature set).
2. GNU target (`x86_64-pc-windows-gnu`, this machine's active default
   `rustup` toolchain): tried directly (`cargo test --workspace --manifest-path
   native/Cargo.toml`, no `--target` override) — fails with `dlltool could
   not create import library ... Invalid bfd target` from
   `C:\MinGW\bin\dlltool.exe`. That's a classic mingw.org-style 32-bit-era
   MinGW install, not mingw-w64 — it can't target `x86_64`. **Don't assume
   this existing MinGW install is a usable fallback; it isn't, verified.**

Either install real MSVC Build Tools + NASM, or replace this MinGW install
with an actual mingw-w64 (x86_64) distribution — see TODO.md #5 for the
verification command to run after either. The `electron/socket-owner.cjs`
IPC wiring (Phase 2/3 of the plan) hasn't started; it's blocked on
confirming a real `.node` build first, per the same "half-wired is worse
than either committed state" principle this whole effort is trying to
satisfy.

## Fixed this session: partial-build crash risk

`src/native/index.ts` used to check only "did the module load at all"
(`if (native) return native.httpFetch(...)`) before calling a specific
function on it. A build compiled with a narrower Cargo feature set (e.g.
`--features dns` only, which is what `native:build:win-x64` uses) still
loads successfully but doesn't export `tlsConnect`/`httpFetch`/etc. — so the
old code would throw `TypeError: ... is not a function` from inside what
looked like the "native available" branch, instead of falling back. Fixed by
checking `typeof native[fnName] === 'function'` per call (see `nativeFn()`
in that file) — a partial build now degrades to the JS fallback one
function at a time, and logs when it does (`[nova-native] loaded, but X is
not exported...`) so this is observable, not silent.
