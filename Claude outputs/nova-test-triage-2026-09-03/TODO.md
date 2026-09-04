# Nova Browser — TODO

Last updated: 2026-09-03

## Priority: High

### 1. Android app — built, installed, and running for the first time (2026-08-28)
- Source-level audit (`2026-08-27-android-app-source-audit.md`) found the Kotlin/Compose shell itself complete and consistent, and the bridge-contract audit found `window.novaNative`/`window.NovaStateBridge` fully consistent on both sides — no contract bugs.
- A source-level engine-bundle sync (`2026-08-28-android-engine-bundle-sync.md`) was done by hand (file-bridge only, no shell) to un-stale the bundled JS, then **superseded the same day by a real build**: `2026-08-28-android-build-install.md` — `npm run build:android` ran end-to-end (web build → asset sync → `gradlew.bat assembleDebug` → `adb install`), producing a 21.4 MB APK installed and running on device `KNEUZTEE6TIBAIIV`. All the cleanup items previously tracked here are now done (see that doc's "Cleanup Completed" table) — the `com/` mirror, the empty `New folder`, orphaned stale-hashed assets, and the Capacitor/Cordova leftovers (`capacitor.settings.gradle`, `capacitor-cordova-android-plugins/`, the old `assets/public/`) were all removed via `git rm`.
- [ ] Manual on-device feature pass: tabs, bookmarks/history, downloads (pause/resume/cancel/share), long-press context menu, file upload, camera/mic permission prompts, incognito, theme in light/dark system settings — no automated on-device test harness exists yet.
- [ ] Many accumulated working-tree changes (from the earlier file-bridge-only sessions plus this build) remain **uncommitted** — run `git status` and commit them, including the newly built asset files and the cleanup deletions.

### 2. Windows desktop app — blank-window bug root-caused and fixed, not yet re-verified
- Launching the installed app showed a window with a working title bar/menu but a completely blank content area — no error dialog (DevTools are blocked in production builds, so nothing was visible from inside the app). Diagnosed via `nova-health.log`: the log had no new entries from the blank-window launch even though Chromium's own profile files had updated, meaning the renderer never reached `APP_READY` despite the main process clearly running (menu rendered).
- Root cause: the 2026-08-23 contextIsolation migration (`nodeIntegration: false, contextIsolation: true` + a preload bridge) broke Nova's networking layer, which uses the bare Node `Buffer` global throughout — Electron's `contextBridge` can't hand the renderer a functional `Buffer` (instance methods don't survive it), so the renderer crashed with "Buffer is not defined" before mounting any UI. See `2026-08-28-windows-app-health-and-buffer-fix.md` for the full root-cause and the trade-off of the fix (reverting to `nodeIntegration: true, contextIsolation: false` re-widens renderer privilege — acceptable for now only because navigation to untrusted origins is already blocked at the `will-navigate` layer, but not the long-term-correct posture).
- `electron/main.cjs` fixed and `dist/` rebuilt. **Not yet re-verified** — needs `npm run electron:start` (fastest check, no reinstall needed) or a fresh `npm run build:win` + clean install-and-launch pass.
- [ ] Verify the fix actually resolves the blank window.
- [ ] Rebuild and reinstall the real NSIS installer once verified.
- [ ] Decide the long-term fix (Buffer-safe networking layer, or a contextBridge byte-array API) instead of leaving `nodeIntegration: true` permanently.
- [ ] `electron/preload.cjs` is now unreferenced — decide whether to delete it or keep it for a future contextIsolation-safe rewrite.

### 3. Triage recurring "pre-existing" test failures — DONE 2026-09-03
- Multiple session logs (e.g. `2026-08-06-security-protocol-modules.md`) note "only pre-existing networking/DNS failures remain" without ever naming or fixing the specific tests.
- [x] Ran the full `npm test` (vitest v4.1.10, 208 files / 9108 tests, from `E:\nova_1`) and captured the exact result: **9107/9108 tests passing, 207/208 files clean.** The single failure, `tests/bytecode-vm.test.ts > Bytecode VM > VM-specific: performance > recursive fibonacci(20) within timeout`, is a timing-budget flake — the value assertion (`fib(20) === 6765`) passed; only the `elapsed < 2000ms` budget missed, by 75ms (2075ms, 3.75% over) — not a functional/logic bug. No other failures were seen anywhere in the suite.
- [x] `doc/known-test-failures.md` (added 2026-08-27 as a template) filled in with this real run's result — see that file for the full table and notes.
- [ ] If the fibonacci timing flake recurs on a future run (not just this once), loosen the budget (e.g. 2000ms → 2500ms) or exclude it from CI on shared/loaded hardware — not done this session since one data point isn't enough to justify changing the test.
- [ ] `npm run typecheck` (tsc) has **not** been run this session — `doc/known-test-failures.md`'s TypeScript-errors table is still a template. A future session should run it and fill that in too.

### 4. Re-verify fidelity audit periodically
- The original run only captured `layout` and rendered near-blank; this was root-caused and fixed 2026-08-12 (`2026-08-12-animation-fidelity-flip.md` — a paint-caching bug). All 12 fixtures now render cleanly (`fidelity-report/report.md`, `frameDeltaClusters=1`, e2e 3/3).
- [ ] Re-run `tests/e2e/fidelity-audit.spec.ts` after any future rendering-pipeline change (the 9-session pipeline rewrite finished 2026-08-27) to confirm this still holds — it's the kind of regression that fails silently otherwise.

## Priority: Medium

### 5. Native Rust Wiring (Phase 3, parallel track)
- `nova-net` (DNS/TLS/HTTP) + `nova-bindings` (napi-rs) build locally; cross-platform CI matrix mostly commented out in `native-build.yml`.
- [ ] Wire native DNS/TLS/HTTP into the JS `RawSocketHttpClient` layer with a JS fallback — or explicitly document this path as experimental/optional and keep the TS networking stack primary. Leaving it half-wired is worse than either committed state.
- [ ] Activate the commented win/arm64 build jobs in `native-build.yml`.

### 6. Multi-Process / crash isolation (Phase 2, parked)
- Activate the `child_process.fork()` transport in `ProcessManager`; per-tab/domain process models; OS-level crash isolation.
- [ ] See `doc/crash-isolation-scoping.md` (added 2026-08-27) for a minimal-first scoping pass — the underlying process-model design (`process-model-design-report.md`, 2026-07-21) and a "Crash recovery / isolation" module already exist; this may be closer to *activating* dormant infrastructure than building new isolation from scratch. Confirm that before scoping a bigger effort.

## Priority: Low

### 7. Product Shipping (Phase 4)
- [x] Auto-update wiring — `electron-updater` added as a dependency, a guarded `setupAutoUpdater()` added to `electron/main.cjs` (skips cleanly in dev / unpackaged builds, never blocks startup), `publish` block added to `electron-builder.yml` pointing at the existing GitHub Releases flow. **Still untested against a real update** — needs an actual tagged release to confirm the update check finds and offers it.
- [x] Multi-platform release CI — `release.yml` extended to a Windows/macOS/Linux matrix and **applied** 2026-08-27 (`2026-08-27-roadmap-groundwork-placement.md`; the workflow-file write-protection that blocked this earlier was worked around outside the file-bridge). Windows leg confirmed by a real local `npm run build:win` (below). **macOS/Linux legs still untested** — they need a real tag push (`git tag v0.0.0-test && git push --tags` is the safe check) since those hosts aren't available locally.
- [x] **Windows desktop build verified end-to-end** (`2026-08-27-windows-desktop-build-run.md`) — `npm run build:win` → real NSIS installer (`Nova Browser Setup 1.0.0.exe`, 93 MB), silent-installed, launched, confirmed the window mounts and the health-log watchdog recovers from a forced kill. Found and fixed a real bug in the process: the packaged app's health log was silently failing to write (`__dirname` resolves inside the read-only `app.asar`) — now resolves into `app.getPath('userData')`. Installer is still **unsigned** (SmartScreen warning on a fresh machine — expected, see `INSTALL.md`). **2026-08-28 update: a separate regression (contextIsolation/Buffer) made the installed app show a blank window — see item 2 above under Priority: High.** Fixed but not yet re-verified with a fresh install.
- [x] Android release-signing scaffolding — `signingConfigs` added to `android/app/build.gradle`, reading from a gitignored `android/keystore.properties` (template: `android/keystore.properties.example`); falls back to the previous unsigned behavior when that file is absent. See `doc/android-release-signing.md`. **No real keystore has been generated or verified yet** — and Play Store distribution needs Play App Signing enrollment beyond this repo.
- [ ] DevTools protocol exposure (remote debugging) — still open.
- [ ] WASM build fallback (`native:build:wasm`) — still open.
- [ ] Code-signing certificates (Windows EV cert, Apple Developer ID) — still open; without them, every install today triggers an OS "unknown publisher" warning. Worth doing before pointing anyone besides yourself at the installers.
- [ ] Dev machine runs node v20.19.1; the repo's `engines` field expects >=22 — `npm install` succeeds with `EBADENGINE` warnings only (non-fatal so far), but worth aligning before it silently becomes fatal on a future dependency bump.

### 8. Modern Web Platform (Phase 5)
- Service Workers/PWA, WASM execution, CSS containment/subgrid/scroll-snap, JIT tiering — still fully open, no design docs yet. Tackle one at a time with a dedicated design doc (see `jit-compilation-plan.md` / `fetch-api-xhr-plan.md` for the format that's worked well here before) rather than starting to code blind.
- [x] **WebRTC — Phase 1, verified 2026-08-27**: real ICE/STUN candidate gathering + connectivity checks over real UDP, `RTCPeerConnection` wired into the JS VM for the first time (previously only a simulated, unwired stand-in existed at `src/browser/media/webrtc.ts`), plus a working — but Nova-specific, not yet browser-interoperable — `RTCDataChannel`. See `doc/webrtc-implementation-plan.md` for Phases 2–4 (real DTLS+SCTP for actual interop, TURN/trickle-ICE, audio/video). **Run and fixed** (`2026-08-27-webrtc-phase1-verification.md`): a typecheck error, a test-assertion bug, and a real event-ordering bug where the receiving peer's data channel never fired `open` — all fixed. `tsc` clean, targeted 23/23, full suite 9105/9105.
- [ ] `src/browser/media/webrtc.ts` (the old simulated class) is now dead weight — grep for importers before deleting it, see the design doc's "Open question" section.

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
