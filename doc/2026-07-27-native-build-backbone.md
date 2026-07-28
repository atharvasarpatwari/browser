# Native Build Backbone — Cargo/Rust + napi-rs

**Date:** 2026-07-27
**Session:** Native build backbone — Cargo workspace, DNS/TLS/HTTP crates, napi-rs bindings, CI build matrix
**Status:** Completed

---

## Summary

Established a Cargo/Rust build backbone for performance-critical native subsystems, with napi-rs bindings for Node.js interop and a TypeScript loader with fallback implementations. Feature-gated TLS/HTTP modules to allow compilation on Windows without MSVC build tools. Added GitHub Actions CI build matrix targeting Linux x86-64 first.

## Architecture

```
native/
├── Cargo.toml                    # Workspace root
├── nova-net/                     # Pure-Rust networking crate
│   ├── Cargo.toml
│   ├── src/
│   │   ├── lib.rs               # Module exports (feature-gated)
│   │   ├── dns.rs               # hickory-resolver async DNS
│   │   ├── tls.rs               # rustls TLS (feature: tls)
│   │   └── http.rs              # Manual HTTP/1.1 over TLS (feature: http)
│   └── tests/
│       └── integration.rs       # 11 integration tests (feature-gated)
├── nova-bindings/               # napi-rs Node.js bindings
│   ├── Cargo.toml               # cdylib output, feature mirrors
│   ├── build.rs                 # napi_build::setup()
│   └── src/
│       ├── lib.rs               # Feature-gated module exports
│       ├── dns.rs               # #[napi] resolve_dns(), resolve_dns_ips()
│       ├── tls.rs               # #[napi] tls_connect(), tls_create_config()
│       └── http.rs              # #[napi] http_fetch(), http_get(), http_post()
├── stubs/                       # libnode.dll stub for compilation
│   └── libnode.dll
└── target/                      # Build artifacts

src/native/
├── index.ts                     # TypeScript native module loader
├── types.ts                     # Type definitions matching N-API bindings
├── dns-resolver.ts              # NovaDnsResolver with LRU cache
└── http-client.ts               # NovaHttpClient with default headers
```

## Key Decisions

### Feature gating (TLS/HTTP)
TLS and HTTP modules require C compilation (ring/aws-lc-rs crypto backends). On systems without MSVC/MinGW, these fail. Solution: feature-gated modules with `default = ["dns"]`. DNS module is pure Rust and always compiles.

**Cargo features:**
- `dns` (default) — hickory-resolver async DNS
- `tls` — rustls + webpki-roots
- `http` — TLS + manual HTTP/1.1

**napi-bindings features mirror nova-net:**
- `dns` → `nova-net/dns`
- `tls` → `nova-net/tls`
- `http` → `nova-net/http`

### TypeScript loader pattern
`src/native/index.ts` uses Node.js `createRequire()` to load `.node` binaries. Falls back to pure-TS implementations using Node.js built-in modules (`dns`, `https`) when native module is unavailable. This allows the TypeScript layer to work in all environments while native crates provide performance when available.

### Toolchain setup
- **Rust toolchain:** `stable-x86_64-pc-windows-gnu` (rustc 1.97.1)
- **MinGW:** niXman/MinGW-Builds 14.2.0 (C:\mingw64) — required because old MinGW 6.3.0 at C:\MinGW lacks 64-bit dlltool
- **CMake:** 4.4.0 installed for future TLS builds (aws-lc-rs)
- **libnode.dll stub:** Created for napi-build to pass build script check on GNU target

### dns.rs fixes
1. Added `hickory-proto` as explicit dependency (was implicitly available but not importable)
2. Fixed `NameServerConfig::new()` — takes `SocketAddr`, not `IpAddr`
3. Fixed `as_name()` → `as_aname()` (API change in hickory-resolver 0.24)

## Build Commands

```bash
# DNS-only build (no C deps)
cargo check -p nova-net --no-default-features --features dns

# Full workspace check (default features = dns only)
cargo check --workspace

# Run Rust tests
cargo test -p nova-net --no-default-features --features dns

# Run TypeScript tests
npx vitest run tests/native/native-bindings.test.ts
```

## Compilation Caching (sccache)

Both CI and local dev use [sccache](https://github.com/mozilla/sccache) to cache compiler output across builds.

### CI (GitHub Actions)
- `Mozilla-Actions/sccache-action@v0.0.7` installs sccache + configures GHA cache backend
- `SCCACHE_GHA_ENABLED=true` + `RUSTC_WRAPPER=sccache` set globally in workflow env
- sccache stats printed after each job for observability
- Cache persists across workflow runs (10 GiB GHA cache)

### Local Development
```bash
# Install sccache (one-time)
winget install Mozilla.sccache        # Windows
cargo install sccache                 # All platforms (needs MSVC on Windows)
brew install sccache                  # macOS

# Enable for native builds
export RUSTC_WRAPPER=sccache          # Linux/macOS
set RUSTC_WRAPPER=sccache             # Windows CMD
$env:RUSTC_WRAPPER = "sccache"        # Windows PowerShell

# Or uncomment [env] RUSTC_WRAPPER in native/.cargo/config.toml
```

### Cargo Profile Optimizations (`native/.cargo/config.toml`)
| Profile | incremental | lto | codegen-units | opt-level |
|---------|------------|-----|---------------|-----------|
| dev | true | off | default | 0 (deps: 2) |
| release | false | thin | 1 | 3 |

Release uses `codegen-units=1` + LTO for maximum inlining and smallest binaries.

## Test Results

```
Rust tests (nova-net, DNS-only):
  test result: ok. 7 passed; 0 failed; 0 ignored

TypeScript tests (native-bindings):
  Test Files  1 passed (1)
  Tests       15 passed (15)

Full test suite:
  Test Files  150 passed (151)
  Tests       6751 passed (6805)
  Errors      2 (pre-existing: CORS + sandbox OOM)
```

## Files Modified

| File | Change |
|------|--------|
| `native/Cargo.toml` | Workspace manifest — no changes this session |
| `native/nova-net/Cargo.toml` | Added `hickory-proto` dep, feature flags, dev-deps, test config |
| `native/nova-net/src/lib.rs` | Feature-gated `tls` and `http` modules |
| `native/nova-net/src/dns.rs` | Added `SocketAddr` import, fixed `NameServerConfig::new`, fixed `as_aname`, removed unused const |
| `native/nova-net/tests/integration.rs` | Feature-gated TLS/HTTP tests, added `serde_json` dev-dep |
| `native/nova-bindings/Cargo.toml` | Added feature flags, `default-features = false`, `[package.metadata.napi]` targets |
| `native/nova-bindings/src/lib.rs` | Feature-gated `tls` and `http` modules, removed unused import |
| `package.json` | Added platform-specific build scripts, `native:dist:*`, `native:dist`, `build:android:full` |

## Files Created

| File | Purpose |
|------|---------|
| `native/stubs/libnode.dll` | Minimal stub for napi-build build script on GNU target |
| `.github/workflows/native-build.yml` | CI build matrix — sccache, Linux x86-64 active, other platforms commented |
| `native/.cargo/config.toml` | Cargo build config — incremental dev, LTO release, sccache opt-in |

## Build Matrix (CI/CD)

GitHub Actions workflow at `.github/workflows/native-build.yml`.

### Active: Linux x86-64
- **Runner:** `ubuntu-latest`
- **Target:** `x86_64-unknown-linux-gnu`
- **Features:** `dns,tls,http` (full — cmake + libssl available)
- **Output:** `native/dist/linux-x64-x64/nova_bindings.node`
- **Binary:** `.so` renamed to `.node`

### Commented/Ready: Other Platforms

| Platform | Target | Runner | Features | Status |
|----------|--------|--------|----------|--------|
| Linux x86-64 | `x86_64-unknown-linux-gnu` | `ubuntu-latest` | `dns,tls,http` | Active |
| Linux ARM64 | `aarch64-unknown-linux-gnu` | `ubuntu-latest` | `dns,tls,http` | Commented |
| macOS x86-64 | `x86_64-apple-darwin` | `macos-13` | `dns,tls,http` | Commented |
| macOS ARM64 | `aarch64-apple-darwin` | `macos-latest` | `dns,tls,http` | Commented |
| Windows x86-64 | `x86_64-pc-windows-msvc` | `windows-latest` | `dns` | Commented |

### Workflow Structure
1. **test** — Runs `cargo test` on matrix platforms (currently Linux x86-64 with all features)
2. **build-linux-x64** — Builds release binary, uploads artifact
3. **build-* (commented)** — Ready to uncomment for other platforms
4. **bundle (commented)** — Collects all artifacts into release bundle on tags

### Output Path Convention
```
native/dist/{platform}-{arch}-{arch}/nova_bindings.node
  ├── linux-x64-x64/     ← .so renamed to .node
  ├── linux-arm64-arm64/
  ├── darwin-x64-x64/    ← .dylib renamed to .node
  ├── darwin-arm64-arm64/
  └── win32-x64-x64/     ← .dll renamed to .node
```

The TypeScript loader (`src/native/index.ts`) maps `process.platform + process.arch` to these paths automatically.

### npm Scripts (Multi-Platform)
```bash
npm run native:build:linux-x64    # cargo build --target x86_64-unknown-linux-gnu
npm run native:build:linux-arm64  # cargo build --target aarch64-unknown-linux-gnu
npm run native:build:darwin-x64   # cargo build --target x86_64-apple-darwin
npm run native:build:darwin-arm64 # cargo build --target aarch64-apple-darwin
npm run native:build:win-x64      # cargo build --target x86_64-pc-windows-msvc
npm run native:dist:linux-x64     # build + copy to native/dist/
npm run native:dist               # default = linux-x64
```

## Future Work

1. **Uncomment other platform builds** in CI when ready (Linux ARM64, macOS x64/arm64, Windows x64)
2. **Release bundle** — uncomment `bundle` job to auto-collect all platform artifacts on git tags
3. **TLS/HTTP compilation on Windows:** Install proper MSVC Build Tools or switch to `aws-lc-rs` crypto backend (uses cmake)
4. **WASM target:** `wasm-pack build` for browser-native networking
5. **Android target:** `cargo-ndk` cross-compilation
6. **GPU subsystem:** `wgpu` crate for WebGPU compute/rasterization
7. **Parser acceleration:** HTML/CSS parsers in Rust via napi bindings
