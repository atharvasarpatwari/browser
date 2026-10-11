# Native DNS/TLS/HTTP Wiring — Scoped Per-Subsystem, Blocked on a Missing Toolchain

**Date:** 2026-09-20
**Session:** Continuation of "what to do next" planning from yesterday. Picked TODO.md item #5 ("wire native DNS/TLS/HTTP... leaving it half-wired is worse than either committed state") after a plan-mode research pass (an Explore agent over both networking stacks, a Plan agent that read the actual Rust source and checked this machine's toolchain) found the gap was real but not a small lift, and the user confirmed scoping it to Windows directly with toolchain installation as an explicit first step.
**Status:** Partially completed — code-level fixes landed; the actual native build is blocked on a missing/broken Rust toolchain, confirmed two ways.

---

## Summary
Nova has two fully separate networking stacks: the real, production one (`RawSocketHttpClient`/`TlsHandler`, using Node's own `net`/`tls` proxied through `electron/socket-owner.cjs`), and an orphaned one (`native/nova-net` in Rust, wrapped by `native/nova-bindings` via napi-rs, loaded by `src/native/index.ts`) that's never been referenced by either `src/browser/networking/**` or `main.ts`. Planning research found this isn't a uniform gap: DNS (`nova-net/src/dns.rs`, real `hickory-resolver` usage) is solid and ready to wire; HTTP (`http.rs`) is HTTPS-only with no chunked/gzip/binary-body support (errors on any non-UTF-8 body); TLS (`tls.rs`) has hardcoded stub fields (`protocol_version`, `cipher_suite`) and never populates `peer_certificates` — wiring either of the latter two in today would be a functional regression, not an upgrade, at the one real call site (`TlsHandler.buildCertificateChainReal()`) that needs a real cert chain.

Fixed what could be fixed without a native build: a real bug in `src/native/index.ts` where a feature-gated build (e.g. DNS-only) would report "native available" and then throw on the first `httpFetch`/`tlsConnect` call instead of falling back; added the missing `native:dist:win-x64` npm script; documented the per-subsystem decision in a new `native/README.md` and in `TODO.md` so a future session doesn't have to re-derive today's findings. Then hit the actual blocker the research had already flagged as likely: this machine has no working Rust-to-native-Windows-binary toolchain, confirmed empirically for both the MSVC and GNU paths, not just inferred from missing files.

## Root Causes
Not a single bug — a real, useful finding plus a real, small bug fixed along the way:

1. **`src/native/index.ts` treated the native module as all-or-nothing.** `if (native) return native.httpFetch(request);` only checked that *some* native module loaded, not that this specific function is exported by it. `native:build:win-x64` (and any narrower Cargo `--features` build) genuinely omits `tlsConnect`/`httpFetch`/etc. when built without the `tls`/`http` features — so a successful, intentional DNS-only build would still take the "native available" branch on an HTTP call and throw `TypeError: ... is not a function`, instead of degrading to the JS fallback the way a partial build should. Fixed with a `nativeFn()` helper that checks `typeof native[name] === 'function'` per call, logging when a loaded-but-partial module falls back for a specific function so this is observable rather than silent.
2. **No toolchain exists on this machine to compile the native module at all**, confirmed two independent ways rather than assumed from absence: (a) the MSVC path (`x86_64-pc-windows-msvc`, what `native:build:win-x64` targets) has no `cl.exe`/`link.exe` (Visual Studio Build Tools were never actually installed — the on-disk VS2019 folder is an empty installer shell) and no NASM (`rustls`' `ring` crypto backend needs an assembler to link, even for a DNS-only build); (b) tried the GNU path directly (`cargo test --workspace` against this machine's active default `rustup` toolchain, `x86_64-pc-windows-gnu`) and it failed with `dlltool could not create import library ... Invalid bfd target` — the installed `C:\MinGW\bin\` turns out to be a classic mingw.org 32-bit-era distribution, not mingw-w64, and genuinely cannot target x86_64. This rules out "maybe the existing MinGW already works as a fallback" as a real option, which the earlier planning pass had flagged as unverified.

## Notes
- This session deliberately did **not** attempt to install Visual Studio Build Tools or NASM itself — that's a large, GUI/installer-driven system change that may need admin elevation, and the approved plan explicitly scoped it as something the user runs, not something to do unattended (matching this session's earlier precedent with the Android emulator's HAXM/WHPX requirement).
- Deliberately did not touch `electron/socket-owner.cjs`'s IPC surface (the plan's Phase 2/3) — that work depends on having a real, built `.node` file to test against, and building one first (rather than wiring blind and hoping) is the whole point of staging this per the "half-wired is worse" principle the backlog item itself names.
- Deliberately did not touch `native/nova-net/src/http.rs` or `tls.rs` — those are real, separate Rust functional gaps (plaintext-HTTP support, chunked/gzip/binary-body handling, real TLS info extraction) that need their own dedicated effort once DNS is proven, not something to bundle into this pass.
- `.github/workflows/native-build.yml` already builds+tests `linux-x64` with `dns,tls,http` in CI — Windows and everything else stays commented out for now, which is the honest state until the toolchain gap here is resolved and a real win-x64 build is proven locally.

## Files Modified
| File | Change |
|------|--------|
| `src/native/index.ts` | Added `nativeFn()` helper checking per-function existence on the loaded native module (not just "module loaded"); added `[nova-native]` log lines at the load-decision point and when a partial build falls back for a specific function |
| `package.json` | Added `native:dist:win-x64` script, mirroring the existing `native:dist:linux-x64` pattern (build → copy the compiled `.dll` to `native/dist/win32-x64-x64/nova_bindings.node`, the path `src/native/index.ts`'s loader expects for `win32`/`x64`) |
| `TODO.md` | Item #5 re-scoped: per-subsystem status (DNS ready, HTTP/TLS explicitly experimental with reasons), the bug fix, and the confirmed two-way toolchain blocker with exact install/verify steps |

## Files Created
- `native/README.md` — per-subsystem status table and the native-DNS wiring plan, so the next session (or the same one, post-toolchain-install) doesn't re-derive today's research
- `doc/2026-09-20-native-networking-dns-wiring-scoped-and-blocked.md` — this document

## Test Results
```
npx tsc --noEmit -p .                    → 0 errors (repo-wide)
npx vitest run tests/native/native-bindings.test.ts → 15/15 passed (unchanged; still only exercises the JS-fallback branch, no .node file exists)
npx vitest run (full suite)              → 225 files / 9277 tests passed (0 regressions)
cargo test --workspace (GNU toolchain)   → confirmed FAILS (dlltool "Invalid bfd target") — expected, documents the real blocker, not a regression to fix here
```

## Verification Steps
1. Ran the approved plan's Step 0 verification check first (`where cl.exe`, `where nasm`, `rustup show`) to confirm the toolchain gap the planning research found was still accurate before writing any code against it — it was.
2. Read `src/native/index.ts` in full, confirmed the all-or-nothing bug by tracing each exported function's `if (native) { ... }` branch, and fixed it with a per-function `nativeFn()` check plus logging.
3. Ran `npx tsc --noEmit -p .` (0 errors) and `npx vitest run tests/native/native-bindings.test.ts` (15/15, unaffected since no `.node` file exists to exercise the new logic's native branch yet — confirmed the fallback branch still works identically).
4. Checked `native:dist:linux-x64`'s exact shape and `getPlatformDir()`'s output for `win32`/`x64` (`win32-x64-x64`) before adding the mirrored `native:dist:win-x64` script.
5. Tried `cargo test --workspace --manifest-path native/Cargo.toml` directly (no `--target` override, so against this machine's active default GNU toolchain) specifically to check whether the existing MinGW install could serve as a stopgap — it failed with a distinct, informative error (`dlltool ... Invalid bfd target`), confirming it can't, and documented that finding precisely rather than leaving it as an assumption.
6. Wrote `native/README.md` and updated `TODO.md` with the full, real findings (both toolchain failures, the per-subsystem HTTP/TLS gaps, the fixed bug) so a future session has an accurate starting point.
7. Ran the full test suite for regressions (225 files / 9277 tests, 0 regressions) — this session's only production-code change was the `src/native/index.ts` fix, everything else was scripts/docs.
