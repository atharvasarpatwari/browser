# Nova Browser — TODO

Last updated: 2026-08-09

## Priority: High

### 1. CI Gating (Phase 0)
- `.github/workflows/release.yml` (tag → installer) and `native-build.yml` (Rust) exist, but no gate runs the full TS suite on push/PR
- [ ] `ci.yml` — `npm run typecheck` + `npm test` (full vitest) + Electron e2e on push/PR to `main`

### 2. Fidelity Audit Drive
- `tests/e2e/fidelity-audit.spec.ts` defines 11 crafted fixtures; the first run only captured `layout`, which rendered near-blank (`nonWhiteRatio: 0.0008`, empty `contentText`)
- [ ] Run all 11 fixtures, triage rendering fidelity gaps (flex/grid/float, images, overflow, forms, fonts, animation, media, iframe, anchors, script)
- [ ] Fix root causes found; re-run until each fixture shows real content clusters

## Priority: Medium

### 3. Native Rust Wiring (Phase 3, parallel track)
- `nova-net` (DNS/TLS/HTTP) + `nova-bindings` (napi-rs) build locally; cross-platform CI matrix mostly commented out
- [ ] Wire native DNS/TLS/HTTP into the JS `RawSocketHttpClient` layer with JS fallback
- [ ] Activate the commented win/arm64 build jobs in `native-build.yml`

### 4. Multi-Process (Phase 2, parked)
- Activate `child_process.fork()` transport in `ProcessManager`; per-tab/domain process models; OS-level crash isolation

## Priority: Low

### 5. Product Shipping (Phase 4)
- Electron packaging polish, auto-update, DevTools protocol; Android Play-ready; multi-platform release CI
- WASM build fallback (`native:build:wasm`)

### 6. Modern Web Platform (Phase 5)
- Service Workers/PWA, WebRTC, WASM execution, CSS containment/subgrid/scroll-snap, JIT tiering

## Done (reference)

- [x] Repo hygiene — `native/target/` untracked + gitignored, temp/debug files removed, stale TODO fixed (`2026-08-09-repo-hygiene-ci-gate.md`)
- [x] CI gate `ci.yml` added — typecheck + full vitest + Electron e2e on push/PR (Phase 0, `2026-08-09-repo-hygiene-ci-gate.md`)
- [x] Web storage disk persistence — localStorage + IndexedDB backends write per-origin JSON under `userData/web-storage`; storage dir injected by the Electron host via `additionalArguments` (`--nova-storage-dir=`) and read from renderer `process.argv` (9 tests, `2026-08-08-web-storage-disk-persistence.md`)
- [x] Page storage plumbing — `storageDir` threaded through `runJS`/`createGlobalEnv`/`bindStorageAPIs`/`PageRenderer` (`2026-08-08-web-storage-disk-persistence.md`)
- [x] Persistent password store — `PersistentPasswordStore`, only store left in-memory (Phase 1 session, `2026-08-08-phase1-persistence-plugins-deferred.md`)
- [x] Text measurement — pluggable `FontMetricsProvider` (interface + heuristic/canvas adapters + registry) (old #9, `2026-08-08-phase1-persistence-plugins-deferred.md`)
- [x] Navigation controller — deferred commit via `completeNavigation`/`setDeferredCompletion` (old #11, `2026-08-08-phase1-persistence-plugins-deferred.md`)
- [x] BrowserEngine → PageLoader/PageRenderer wiring (old #1, wired in `src/app/main.ts`)
- [x] IPC Channel Direction config (old #2, already config-driven)
- [x] Real image decoding — PNG/JPEG/WebP into paint `drawImage` (old #3)
- [x] JS Engine microtask queue (old #4)
- [x] Electron / Native Window Integration (old #5, Electron shell shipped)
- [x] SOCKS proxy support — native SOCKS4/4a/5 (old #7, `2026-08-03-socks-proxy-support.md`)
- [x] WebSocket binary data handling — Blob read + close-code validation (old #8, `2026-07-26-websocket-binary-data-handling.md`)
- [x] Sticky position font size — resolved from computed style, not hard-coded 16 (old #4, `2026-08-01-gap-implementations.md`)
- [x] Stacking context `will-change` trigger (old #5, `2026-08-01-gap-implementations.md`)
- [x] PageLoader + PageRenderer extraction and controller wiring (36 tests)
- [x] History API + Location bindings — window.history, window.location, popstate/hashchange (65 tests)
- [x] Resource prioritization — PriorityQueue, BandwidthEstimator, ResourcePrioritizer, cache (69 tests)
- [x] Bookmarks/History UI module — Vitest test conversion (48 tests)
- [x] Settings integration — SettingsStore, SettingsService, BrowserWindowPage routing (39 tests)
- [x] DevTools — Console, Network Monitor, DOM Inspector, facade (99 tests)
- [x] IPC system — 6 modules, 64 tests
- [x] IP protocol + adapter + tab-process adapter + firewall (203 tests)
- [x] Crash recovery / isolation — 6 modules, 88 tests
- [x] Profiling / benchmarking toolkit — 51 benchmarks
- [x] Memory management audit — 37 tests
- [x] Full application bootstrap wiring — 76 test files, 3053 tests
