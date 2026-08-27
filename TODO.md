# Nova Browser — TODO

Last updated: 2026-08-27

## Priority: High

### 1. Triage recurring "pre-existing" test failures
- Multiple session logs (e.g. `2026-08-06-security-protocol-modules.md`) note "only pre-existing networking/DNS failures remain" without ever naming or fixing the specific tests.
- [ ] Run `npm test`, capture the exact failing test names, and either fix them or document explicitly why they're accepted long-term.
- [ ] See `doc/known-test-failures.md` (added 2026-08-27) — currently a tracking template only; needs a live `npm test` run to fill in, which this session couldn't do (file-bridge access only, no shell).

### 2. Re-verify fidelity audit periodically
- The original run only captured `layout` and rendered near-blank; this was root-caused and fixed 2026-08-12 (`2026-08-12-animation-fidelity-flip.md` — a paint-caching bug). All 12 fixtures now render cleanly (`fidelity-report/report.md`, `frameDeltaClusters=1`, e2e 3/3).
- [ ] Re-run `tests/e2e/fidelity-audit.spec.ts` after any future rendering-pipeline change (the 9-session pipeline rewrite finished 2026-08-27) to confirm this still holds — it's the kind of regression that fails silently otherwise.

## Priority: Medium

### 3. Native Rust Wiring (Phase 3, parallel track)
- `nova-net` (DNS/TLS/HTTP) + `nova-bindings` (napi-rs) build locally; cross-platform CI matrix mostly commented out in `native-build.yml`.
- [ ] Wire native DNS/TLS/HTTP into the JS `RawSocketHttpClient` layer with a JS fallback — or explicitly document this path as experimental/optional and keep the TS networking stack primary. Leaving it half-wired is worse than either committed state.
- [ ] Activate the commented win/arm64 build jobs in `native-build.yml`.

### 4. Multi-Process / crash isolation (Phase 2, parked)
- Activate the `child_process.fork()` transport in `ProcessManager`; per-tab/domain process models; OS-level crash isolation.
- [ ] See `doc/crash-isolation-scoping.md` (added 2026-08-27) for a minimal-first scoping pass — the underlying process-model design (`process-model-design-report.md`, 2026-07-21) and a "Crash recovery / isolation" module already exist; this may be closer to *activating* dormant infrastructure than building new isolation from scratch. Confirm that before scoping a bigger effort.

## Priority: Low

### 5. Product Shipping (Phase 4)
- [x] Auto-update wiring — `electron-updater` added as a dependency, a guarded `setupAutoUpdater()` added to `electron/main.cjs` (skips cleanly in dev / unpackaged builds, never blocks startup), `publish` block added to `electron-builder.yml` pointing at the existing GitHub Releases flow. **Untested** — needs a real tagged release to confirm the update check actually finds and offers it.
- [x] Multi-platform release CI — `release.yml` previously built Windows only; extended 2026-08-27 to a Windows/macOS/Linux matrix (`build:mac` / `build:linux` scripts added to `package.json`), with `CSC_IDENTITY_AUTO_DISCOVERY: false` so the unsigned mac build doesn't fail looking for a local identity. **Untested** — needs an actual tag push to confirm all three legs succeed; the resulting installers will be unsigned (see `INSTALL.md`).
- [x] Android release-signing scaffolding — `signingConfigs` added to `android/app/build.gradle`, reading from a gitignored `android/keystore.properties` (template: `android/keystore.properties.example`); falls back to the previous unsigned behavior when that file is absent. See `doc/android-release-signing.md`. **No real keystore has been generated or verified yet** — and Play Store distribution needs Play App Signing enrollment beyond this repo.
- [ ] DevTools protocol exposure (remote debugging) — still open.
- [ ] WASM build fallback (`native:build:wasm`) — still open.
- [ ] Code-signing certificates (Windows EV cert, Apple Developer ID) — still open; without them, every install today triggers an OS "unknown publisher" warning. Worth doing before pointing anyone besides yourself at the installers.

### 6. Modern Web Platform (Phase 5)
- Service Workers/PWA, WebRTC, WASM execution, CSS containment/subgrid/scroll-snap, JIT tiering. Still fully open — none of these have a design doc yet. Large scope individually; tackle one at a time with a dedicated design doc (see `jit-compilation-plan.md` / `fetch-api-xhr-plan.md` for the format that's worked well here before) rather than starting to code blind.

## Done (reference)

- [x] CI gate `ci.yml` — typecheck + lint + full vitest (3-OS matrix) + Vite build verification + Electron e2e, on push/PR to `main`. Confirmed present and current as of 2026-08-27 (`2026-08-09-repo-hygiene-ci-gate.md`, expanded `2026-08-20-tier3-testing-ci.md`) — this file previously (incorrectly) listed CI gating as still open; it wasn't.
- [x] Repo hygiene — `native/target/` untracked + gitignored, temp/debug files removed, stale TODO fixed (`2026-08-09-repo-hygiene-ci-gate.md`)
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
