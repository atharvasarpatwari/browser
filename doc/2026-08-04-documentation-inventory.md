# Documentation Inventory — All Documents by Topic

**Date:** 2026-08-04
**Session:** Complete catalog of every documentation file in the repository, grouped by topic with counts.
**Status:** Completed

---

## Summary

A complete, human-readable reference catalog of all 184 documentation files in the repository, organized into 21 topics with per-topic counts. Includes the session change logs in `doc/`, the architecture documents in `docs/`, and the standalone docs at the repository root.

## Grand Totals

| Location | Files |
|----------|------:|
| `doc/` — markdown session docs | 170 |
| `doc/` — `.docx` guide | 1 |
| `doc/` — `analytics.html` dashboard | 1 |
| `docs/` — architecture docs | 7 |
| Repository root — docs | 5 |
| **Grand total** | **184** |

Topic breakdown of the 169 session documents (excluding `doc/README.md`):

| # | Topic | Count |
|---|-------|------:|
| 1 | JS Engine | 24 |
| 2 | Layout / Rendering | 23 |
| 3 | Browser Features | 17 |
| 4 | CSS / Cascade / Style | 15 |
| 5 | IPC / Process | 13 |
| 6 | Web APIs | 12 |
| 7 | Networking | 11 |
| 8 | GPU Acceleration | 8 |
| 9 | Android / Mobile | 8 |
| 10 | Security | 6 |
| 11 | Testing / Typecheck | 5 |
| 12 | Performance | 5 |
| 13 | Browser Architecture | 5 |
| 14 | Electron / Desktop | 4 |
| 15 | Inventory / Reports | 4 |
| 16 | DevTools | 2 |
| 17 | Storage | 2 |
| 18 | HTML Parser | 2 |
| 19 | Native Build | 1 |
| 20 | Accessibility | 1 |
| 21 | Networking / Security | 1 |
| | **Total** | **169** |

---

## 1. JS Engine — 24 docs

| File | Description |
|------|-------------|
| [2026-07-18-javascript-engine.md](2026-07-18-javascript-engine.md) | Complete JS interpreter — lexer, Pratt parser, tree-walker, DOM bindings, event loop |
| [2026-07-18-script-execution-fixes.md](2026-07-18-script-execution-fixes.md) | 7 failing script-execution integration tests fixed |
| [2026-07-19-spec-adherence-audit.md](2026-07-19-spec-adherence-audit.md) | WHATWG/W3C spec adherence audit — 32 gaps, 4 phases |
| [2026-07-19-spec-adherence-phase1.md](2026-07-19-spec-adherence-phase1.md) | Phase 1 spec fixes — capture phase, CSS specificity, regex lexing |
| [2026-07-19-spec-adherence-phase1-complete.md](2026-07-19-spec-adherence-phase1-complete.md) | Phase 1 complete — querySelector, JS event propagation, HTML parser fix |
| [2026-07-19-promise-microtask-fixes.md](2026-07-19-promise-microtask-fixes.md) | Promise chain + Promise.all() bug fixes |
| [2026-07-20-js-engine-critical-gaps.md](2026-07-20-js-engine-critical-gaps.md) | Optional chaining, nullish coalescing, labeled statements, eval, async/await, generators |
| [2026-07-22-garbage-collection.md](2026-07-22-garbage-collection.md) | Two-generation mark-and-sweep GC, root scanning, weak refs |
| [2026-07-22-jit-wasm-codegen.md](2026-07-22-jit-wasm-codegen.md) | JIT Phase 2 — WASM binary encoder, tier manager |
| [2026-07-22-vm-closure-upvalue-fixes.md](2026-07-22-vm-closure-upvalue-fixes.md) | VM closure & upvalue support completed |
| [2026-07-23-web-workers.md](2026-07-23-web-workers.md) | Web Workers — isolated background JS execution |
| [2026-07-25-event-loop-task-queues.md](2026-07-25-event-loop-task-queues.md) | queueMicrotask, microtask-before-macrotask ordering, Promise state inspection |
| [2026-07-26-js-builtins-global-env.md](2026-07-26-js-builtins-global-env.md) | JS built-ins global env wiring — Array, Object, Promise, Symbol, Date, etc. |
| [2026-07-26-phase2-spec-adherence.md](2026-07-26-phase2-spec-adherence.md) | Phase 2 — Symbol typeof, Map/Set identity keys, classList, strict mode, WebSocket binary |
| [2026-07-26-spec-adherence-phase3.md](2026-07-26-spec-adherence-phase3.md) | Phase 3 — TDZ enforcement, ASI, super member access, bytecode VM TDZ fix |
| [2026-07-26-strict-mode-detection.md](2026-07-26-strict-mode-detection.md) | `'use strict'` detection, `this` binding, `with` rejection |
| [2026-07-26-typed-arrays-test-fixes.md](2026-07-26-typed-arrays-test-fixes.md) | 4 root causes in typed arrays fixed — 88/88 tests pass |
| [2026-07-26-worker-constructor-global-env-promise-worker.md](2026-07-26-worker-constructor-global-env-promise-worker.md) | Worker constructor wired into global env, Promise in worker scope |
| [2026-07-29-js-engine-modules.md](2026-07-29-js-engine-modules.md) | Bytecode, Interpreter, GC, JIT Compiler modules |
| [2026-07-29-js-language-test-fixes.md](2026-07-29-js-language-test-fixes.md) | 13 failing js-language tests fixed |
| [2026-07-31-js-engine-feature-check.md](2026-07-31-js-engine-feature-check.md) | Verified JS engine feature files, 325 passing tests |
| [2026-08-01-js-runtime-web-api-fixes.md](2026-08-01-js-runtime-web-api-fixes.md) | Runtime semantics for Fetch, WebSocket, extended Web APIs |
| [jit-compilation-plan.md](jit-compilation-plan.md) | Plan — two-tier JIT (bytecode VM + WASM JIT compiler) |
| [promise-microtask-plan.md](promise-microtask-plan.md) | Plan — promise/microtask engine work |

## 2. Layout / Rendering — 23 docs

| File | Description |
|------|-------------|
| [2026-07-18-layout-engine-rewrite.md](2026-07-18-layout-engine-rewrite.md) | Layout engine rewrite — box model, box-sizing, named font sizes, resolveLength |
| [2026-07-18-formatting-contexts.md](2026-07-18-formatting-contexts.md) | Block, inline, flex, list-item formatting contexts |
| [2026-07-18-flexbox-layout.md](2026-07-18-flexbox-layout.md) | Full CSS Flexbox layout — 37 tests |
| [2026-07-18-line-breaking-text-measure-floats.md](2026-07-18-line-breaking-text-measure-floats.md) | UAX #14 line breaking, text measurement, float exclusion zones |
| [2026-07-18-reflow-repaint-minimization.md](2026-07-18-reflow-repaint-minimization.md) | Damage tracking, coalesced frames, incremental layout/paint |
| [2026-07-18-software-rasterizer.md](2026-07-18-software-rasterizer.md) | Software rasterizer — color parser, bitmap font, alpha compositing |
| [2026-07-18-stacking-contexts-paint-order.md](2026-07-18-stacking-contexts-paint-order.md) | CSS 2.2 Appendix E stacking contexts, 7-layer paint order |
| [2026-07-18-text-rendering.md](2026-07-18-text-rendering.md) | Paint engine renders text via InlineLevelBox → TextRun |
| [2026-07-18-lazy-loading.md](2026-07-18-lazy-loading.md) | IntersectionObserver, LazyLoader, synthetic image rendering, drawImage |
| [2026-07-18-ui-cleanup-and-formatting-tests.md](2026-07-18-ui-cleanup-and-formatting-tests.md) | Tab-strip listener leak fixed, 67 formatting context tests |
| [2026-07-19-page-loader-renderer-plan.md](2026-07-19-page-loader-renderer-plan.md) | Plan — PageLoader & PageRenderer extraction |
| [2026-07-19-page-loader-renderer.md](2026-07-19-page-loader-renderer.md) | PageLoader & PageRenderer standalone classes |
| [2026-07-24-compositing-layers.md](2026-07-24-compositing-layers.md) | Compositing layers — promotion, damage tracking, tiling, alpha blending |
| [2026-07-25-canvas-2d-api.md](2026-07-25-canvas-2d-api.md) | Canvas 2D API with software rasterizer, 9 bugs fixed |
| [2026-07-29-compositing-enhancements.md](2026-07-29-compositing-enhancements.md) | 16 compositing test failures fixed |
| [2026-07-29-layout-enhanced-table-parser-fix.md](2026-07-29-layout-enhanced-table-parser-fix.md) | HTML5 parser table auto-insertion fixed |
| [2026-07-29-rendering-enhanced-test-fixes.md](2026-07-29-rendering-enhanced-test-fixes.md) | 18 render/paint enhanced test fixes |
| [2026-07-30-layout-features.md](2026-07-30-layout-features.md) | Margin collapsing, sticky, anonymous blocks, overflow clip, aspect-ratio |
| [2026-07-30-rendering-features.md](2026-07-30-rendering-features.md) | Clip rect stack, overflow clip, per-side borders, dashed/dotted, background, mask |
| [2026-07-31-layout-box-model-debug.md](2026-07-31-layout-box-model-debug.md) | Border-width resolution fix when border-style omitted |
| [2026-08-01-protocols-and-rendering-inventory.md](2026-08-01-protocols-and-rendering-inventory.md) | Reference inventory of all protocols & rendering tools |
| [2026-08-02-nova-engine-android-rendering-fix.md](2026-08-02-nova-engine-android-rendering-fix.md) | vw/vh resolution + GPU rasterizer fallback fix for Android |
| [compositing-layers-plan.md](compositing-layers-plan.md) | Plan — full compositing layer system |

## 3. Browser Features — 17 docs

| File | Description |
|------|-------------|
| [2026-07-19-navigation-bridge.md](2026-07-19-navigation-bridge.md) | NavigationBridge orchestration — re-entrancy guard, blocked-protocol detection |
| [2026-07-19-bookmarks-history-ui.md](2026-07-19-bookmarks-history-ui.md) | Bookmarks/History UI module tests |
| [2026-07-19-settings-integration.md](2026-07-19-settings-integration.md) | Settings persistence — SettingsStore, SettingsService, wiring |
| [2026-07-21-customizable-browser-name.md](2026-07-21-customizable-browser-name.md) | Customizable browser name service |
| [2026-07-21-ui-backend-wiring.md](2026-07-21-ui-backend-wiring.md) | UI backend wiring — engine, search, downloads, bookmarks, history |
| [2026-07-22-tab-management-overhaul.md](2026-07-22-tab-management-overhaul.md) | TabSession↔TabContext bridge, session persistence |
| [2026-07-22-tab-persistence.md](2026-07-22-tab-persistence.md) | Tab persistence — storage abstraction, auto-save |
| [2026-07-22-navigation-bridge-test-suite.md](2026-07-22-navigation-bridge-test-suite.md) | NavigationBridge 25-test suite |
| [2026-07-22-tab-context-tests.md](2026-07-22-tab-context-tests.md) | TabContext & TabContextManager 25-test suite |
| [2026-07-28-browser-engine-features.md](2026-07-28-browser-engine-features.md) | Task Manager, Auto Update, Telemetry, PDF Viewer, Crash Reporter, Download Manager |
| [2026-07-28-settings-features.md](2026-07-28-settings-features.md) | Themes, Profiles, Sync, Incognito, Guest, Session Restore, Startup Pages |
| [2026-07-29-navigation-controls.md](2026-07-29-navigation-controls.md) | MultiTabs, TabGroupManager, TabSearch, navigation services, ReaderMode, Zoom, Find |
| [2026-07-29-omnibox-system.md](2026-07-29-omnibox-system.md) | Omnibox + 4 suggestion providers, SearchEngineManager, `!keyword` bangs |
| [2026-07-31-navigation-feature-check.md](2026-07-31-navigation-feature-check.md) | Verified navigation control feature files |
| [2026-07-31-platform-input-window-controls.md](2026-07-31-platform-input-window-controls.md) | InputManager (keyboard/mouse/drag-drop) + WindowControls |
| [2026-08-02-redirect-url-address-bar.md](2026-08-02-redirect-url-address-bar.md) | Address bar commits final post-redirect URL |
| [tab-management-overhaul-plan.md](tab-management-overhaul-plan.md) | Plan — tab management overhaul |

## 4. CSS / Cascade / Style — 15 docs

| File | Description |
|------|-------------|
| [2026-07-18-css5-full-rewrite.md](2026-07-18-css5-full-rewrite.md) | CSS5 tokenizer, parser, selector engine, cascade engine, shorthand expansion |
| [2026-07-18-css-grid-layout.md](2026-07-18-css-grid-layout.md) | CSS Grid layout — 50 tests |
| [2026-07-18-css-positioning.md](2026-07-18-css-positioning.md) | CSS positioning — static/relative/absolute/fixed/sticky, z-index |
| [2026-07-24-cascade-inheritance-resolution.md](2026-07-24-cascade-inheritance-resolution.md) | CSS-wide keywords, computed values, property registry |
| [2026-07-24-css-tokenizer-parser-bugfixes.md](2026-07-24-css-tokenizer-parser-bugfixes.md) | 16 CSS5 tokenizer/parser bugs fixed |
| [2026-07-25-cascade-features.md](2026-07-25-cascade-features.md) | @layer ordering, var(), currentcolor, :where(), 20+ media queries |
| [2026-07-25-computed-style-resolution.md](2026-07-25-computed-style-resolution.md) | 4 computed-style bugs fixed, 130 new tests |
| [2026-07-25-custom-properties-order-fix.md](2026-07-25-custom-properties-order-fix.md) | Custom property order-of-operations audit |
| [2026-07-25-media-query-audit.md](2026-07-25-media-query-audit.md) | 4 media query bugs fixed, 41 tests |
| [2026-07-26-css-math-functions.md](2026-07-26-css-math-functions.md) | calc(), clamp(), min(), max() evaluator |
| [2026-07-26-five-next-steps-canvas-css-engine.md](2026-07-26-five-next-steps-canvas-css-engine.md) | Canvas DOM bindings, @supports, @import media, revert, range syntax |
| [2026-07-30-css-animations-web-animations-api.md](2026-07-30-css-animations-web-animations-api.md) | CSS Animations + Web Animations API |
| [2026-07-30-css-container-nesting.md](2026-07-30-css-container-nesting.md) | @container queries + CSS nesting |
| [2026-07-30-css-style-pipeline.md](2026-07-30-css-style-pipeline.md) | StyleSheet, buildUsedStyle, _dirtyStyle invalidation, box-model fixes |
| [2026-07-30-tokenizer-edge-case-tests.md](2026-07-30-tokenizer-edge-case-tests.md) | 11 tokenizer edge case tests, 2 bugs fixed |

## 5. IPC / Process — 13 docs

| File | Description |
|------|-------------|
| [2026-07-18-ipc-design.md](2026-07-18-ipc-design.md) | IPC system — message protocol, serializer, transport, channel, service-proxy |
| [2026-07-18-ip-protocol.md](2026-07-18-ip-protocol.md) | IPv4/IPv6, CIDR, PNA, DNS, Happy Eyeballs, ConnectionPool |
| [2026-07-18-crash-recovery-isolation.md](2026-07-18-crash-recovery-isolation.md) | Per-tab TabContext, ScriptGuard, ErrorBoundary, ProcessGuard, CrashReporter |
| [2026-07-19-site-isolation-plan.md](2026-07-19-site-isolation-plan.md) | Plan — site isolation modules |
| [2026-07-19-site-isolation.md](2026-07-19-site-isolation.md) | Site isolation — 142 tests across 5 modules |
| [2026-07-19-crash-recovery-isolation-tests.md](2026-07-19-crash-recovery-isolation-tests.md) | 105 crash-recovery/site-isolation integration tests |
| [2026-07-23-process-separation.md](2026-07-23-process-separation.md) | Renderer/browser process separation, process models, cross-process proxies |
| [2026-07-26-ipc-infrastructure-fixes.md](2026-07-26-ipc-infrastructure-fixes.md) | Channel direction, duplicate handlers, transport accumulation |
| [2026-07-26-ipc-overhaul.md](2026-07-26-ipc-overhaul.md) | Queue-based streaming, topic messaging, ProcessManager heartbeat |
| [2026-07-26-same-origin-policy.md](2026-07-26-same-origin-policy.md) | Full 8-phase SOP — OriginService, CORS wiring, navigation guard, CORP |
| [2026-07-26-sandboxing-process-isolation.md](2026-07-26-sandboxing-process-isolation.md) | 6-phase capability-based sandboxing |
| [process-model-design-report.md](process-model-design-report.md) | Design report — single vs multi-process, recommended 3-phase path |
| [same-origin-policy-plan.md](same-origin-policy-plan.md) | Plan — same-origin policy implementation |

## 6. Web APIs — 12 docs

| File | Description |
|------|-------------|
| [2026-07-19-history-api-location-bindings.md](2026-07-19-history-api-location-bindings.md) | window.history + window.location bindings, popstate/hashchange |
| [2026-07-26-dom-token-list.md](2026-07-26-dom-token-list.md) | DOMTokenList API |
| [2026-07-26-getElementsByClassName.md](2026-07-26-getElementsByClassName.md) | getElementsByClassName DomTree BFS method |
| [2026-07-26-composed-flag-event-dispatch.md](2026-07-26-composed-flag-event-dispatch.md) | Composed flag event dispatch across shadow DOM |
| [2026-07-26-web-apis-permissions.md](2026-07-26-web-apis-permissions.md) | Geolocation, Notifications, Clipboard, Vibration permission gating |
| [2026-07-27-web-api-support.md](2026-07-27-web-api-support.md) | 23+ Web API families — crypto, BroadcastChannel, WebAssembly, WebGPU, WebXR, etc. |
| [2026-07-29-runtime-modules.md](2026-07-29-runtime-modules.md) | Call Stack, Task Queue, Microtasks, rAF, rIC |
| [2026-07-29-web-apis-modules.md](2026-07-29-web-apis-modules.md) | 14 Web API modules — Fetch, XHR, Clipboard, WebSocket, WebRTC, Push, etc. |
| [2026-07-29-graphics-modules.md](2026-07-29-graphics-modules.md) | Canvas 2D, SVG, WebGL, WebGL2, WebGPU, OffscreenCanvas |
| [2026-07-29-media-modules.md](2026-07-29-media-modules.md) | Audio, Video, MSE, EME, WebAudio, WebCodecs |
| [2026-07-30-range-selection-api.md](2026-07-30-range-selection-api.md) | Full Range and Selection API |
| [2026-07-30-document-write.md](2026-07-30-document-write.md) | document.write() and document.open() implementation |

## 7. Networking — 11 docs

| File | Description |
|------|-------------|
| [2026-07-19-fetch-api-implementation.md](2026-07-19-fetch-api-implementation.md) | Headers, Response, Request, AbortController, fetch() |
| [2026-07-23-real-networking.md](2026-07-23-real-networking.md) | RawSocketHttpClient via net/tls, real DNS, TLS cert retrieval |
| [2026-07-23-websocket-api.md](2026-07-23-websocket-api.md) | WebSocket API with platform factory, CSP enforcement |
| [2026-07-23-xhr-implementation.md](2026-07-23-xhr-implementation.md) | XMLHttpRequest — open/send/abort, event lifecycle |
| [2026-07-23-cors-security.md](2026-07-23-cors-security.md) | CorsEngine — preflight cache, simple request detection |
| [2026-07-23-persistent-storage-networking.md](2026-07-23-persistent-storage-networking.md) | Wired RawSocketHttpClient + CacheManager |
| [2026-07-26-websocket-binary-data-handling.md](2026-07-26-websocket-binary-data-handling.md) | Binary send/receive, close code validation |
| [2026-07-30-networking-gap-fixes.md](2026-07-30-networking-gap-fixes.md) | Content-Encoding, multipart encoding, boundary splitting fixes |
| [2026-08-03-socks-proxy-support.md](2026-08-03-socks-proxy-support.md) | SOCKS4/4a/5 support, ProxyAwareHttpClient |
| [2026-08-04-http-connect-proxy.md](2026-08-04-http-connect-proxy.md) | HTTP(S) proxy CONNECT tunneling |
| [fetch-api-xhr-plan.md](fetch-api-xhr-plan.md) | Plan — Fetch API and XMLHttpRequest |

## 8. GPU Acceleration — 8 docs

| File | Description |
|------|-------------|
| [2026-07-20-gpu-acceleration-phase1.md](2026-07-20-gpu-acceleration-phase1.md) | WebGPU infrastructure — device manager, buffer pool, shaders, compute ops |
| [2026-07-20-gpu-acceleration-phase2.md](2026-07-20-gpu-acceleration-phase2.md) | drawImage/fillText compute shaders, double-buffered readback |
| [2026-07-20-gpu-acceleration-phase3.md](2026-07-20-gpu-acceleration-phase3.md) | Async rasterize with GPU readback, resize support |
| [2026-07-20-image-decoding.md](2026-07-20-image-decoding.md) | PNG & JPEG decoding, ImageDecoder, lazy loader |
| [2026-07-31-gpu-acceleration-enabled.md](2026-07-31-gpu-acceleration-enabled.md) | GPU enabled in all 3 process models |
| [2026-08-02-mail-redirect-gpu-fallback.md](2026-08-02-mail-redirect-gpu-fallback.md) | Redirect following + GPU dispatch overflow software fallback |
| [2026-08-02-webgpu-submit-destroy-fix.md](2026-08-02-webgpu-submit-destroy-fix.md) | WebGPU submit/destroy validation fixes |
| [gpu-acceleration-plan.md](gpu-acceleration-plan.md) | Plan — WebGPU rasterization & compositing |

## 9. Android / Mobile — 8 docs

| File | Description |
|------|-------------|
| [2026-07-22-android-apk-setup.md](2026-07-22-android-apk-setup.md) | Capacitor Android setup session |
| [2026-07-31-android-apk-build-config.md](2026-07-31-android-apk-build-config.md) | APK build/install helper scripts, Gradle workflow |
| [2026-08-01-android-mobile-build-verification.md](2026-08-01-android-mobile-build-verification.md) | Web app packaged into Capacitor APK verified |
| [2026-08-01-android-icon-and-standalone-refresh.md](2026-08-01-android-icon-and-standalone-refresh.md) | Launcher icon refresh, standalone report refresh |
| [2026-08-01-mobile-android-integration-summary.md](2026-08-01-mobile-android-integration-summary.md) | Android packaging/icon/build summary |
| [2026-08-02-miniweb-android-build.md](2026-08-02-miniweb-android-build.md) | Made mini-browser-android buildable |
| [2026-08-02-nova-android-native-browser.md](2026-08-02-nova-android-native-browser.md) | Native Kotlin/Compose browser conversion |
| [android-apk-build-guide.md](android-apk-build-guide.md) | APK build guide — JDK 17+, Android Studio |

## 10. Security — 6 docs

| File | Description |
|------|-------------|
| [2026-07-19-content-security-policy.md](2026-07-19-content-security-policy.md) | CSP engine — 8 modules, 179 tests |
| [2026-07-23-csp-evaluator-tests.md](2026-07-23-csp-evaluator-tests.md) | CSP Evaluator — 127 dedicated tests |
| [2026-07-27-xss-injection-mitigations.md](2026-07-27-xss-injection-mitigations.md) | CSP eval/timer, setAttribute sanitization, CSS injection defense |
| [2026-07-29-credential-system.md](2026-07-29-credential-system.md) | CredentialStore, EncryptionService, AutofillService, PasskeyManager |
| [2026-07-29-security-modules.md](2026-07-29-security-modules.md) | 11 modules — SOP, CORS, CSP, Sandbox, HTTPS, XSS, CSRF, etc. |
| [xss-mitigations-plan.md](xss-mitigations-plan.md) | Plan — XSS/injection mitigations |

## 11. Testing / Typecheck — 5 docs

| File | Description |
|------|-------------|
| [2026-07-23-test-suite-expansion.md](2026-07-23-test-suite-expansion.md) | 274 new tests across 9 files |
| [2026-07-23-wpt-spec-compliance.md](2026-07-23-wpt-spec-compliance.md) | WPT & spec compliance — 501 tests |
| [2026-07-29-extension-test-fixes.md](2026-07-29-extension-test-fixes.md) | 8 extension test failures fixed |
| [2026-08-01-src-typecheck-cleanup.md](2026-08-01-src-typecheck-cleanup.md) | Fixed all src/ TypeScript errors |
| [2026-08-01-tests-typecheck-cleanup.md](2026-08-01-tests-typecheck-cleanup.md) | Fixed all tests/ TypeScript errors (0 repo-wide) |

## 12. Performance — 5 docs

| File | Description |
|------|-------------|
| [2026-07-18-profiling-benchmarking-toolkit.md](2026-07-18-profiling-benchmarking-toolkit.md) | 51 benchmarks, markdown reports, leak detection |
| [2026-07-18-memory-management.md](2026-07-18-memory-management.md) | Memory leak audit and fixes — 37 tests |
| [2026-07-18-resource-prioritization.md](2026-07-18-resource-prioritization.md) | PriorityQueue, BandwidthEstimator, ResourcePrioritizer, cache wiring |
| [2026-07-18-resource-prioritization-plan.md](2026-07-18-resource-prioritization-plan.md) | Plan — priority-aware resource loading |
| [benchmark-2026-07-18.md](benchmark-2026-07-18.md) | Benchmark run report |

## 13. Browser Architecture — 5 docs

| File | Description |
|------|-------------|
| [2026-07-18-application-bootstrap-wiring.md](2026-07-18-application-bootstrap-wiring.md) | 11 DI tokens, Firewall integration, TabProcessManager startup |
| [2026-07-18-module-integration-sweep.md](2026-07-18-module-integration-sweep.md) | Integration gap fixes, ReflowRepaintController, dead code removal |
| [2026-07-22-vite-dev-server.md](2026-07-22-vite-dev-server.md) | `npm run dev` serves full browser chrome at localhost:5173 |
| [2026-07-31-code-map-placement-audit.md](2026-07-31-code-map-placement-audit.md) | Full 410-file architecture map + placement audit |
| [2026-07-31-structural-cleanup.md](2026-07-31-structural-cleanup.md) | `netwroking/`→`networking/`, circular import breaks, 956 tests |

## 14. Electron / Desktop — 4 docs

| File | Description |
|------|-------------|
| [2026-07-31-electron-launch-plan.md](2026-07-31-electron-launch-plan.md) | Plan — ship Nova as Windows desktop app |
| [2026-07-31-electron-launch-implementation.md](2026-07-31-electron-launch-implementation.md) | Electron shell shipped, NSIS installer built |
| [2026-08-01-electron-ui-mount-fix.md](2026-08-01-electron-ui-mount-fix.md) | Fixed blank Electron window — Vite externalized Node builtins |
| [2026-08-02-static-build-keepalive.md](2026-08-02-static-build-keepalive.md) | Electron shell watchdog, self-recovery |

## 15. Inventory / Reports — 4 docs

| File | Description |
|------|-------------|
| [2026-07-19-analytics-dashboard.md](2026-07-19-analytics-dashboard.md) | Interactive documentation analytics dashboard |
| [2026-07-30-analysis-report-monitor.md](2026-07-30-analysis-report-monitor.md) | Git-powered analysis report dashboard |
| [2026-07-31-analysis-report-standalone.md](2026-07-31-analysis-report-standalone.md) | Self-contained standalone report HTML |
| [2026-08-01-gap-implementations.md](2026-08-01-gap-implementations.md) | 4 inventory gaps implemented (reflow, will-change, sticky font, WebP) |

## 16. DevTools — 2 docs

| File | Description |
|------|-------------|
| [2026-07-19-devtools.md](2026-07-19-devtools.md) | Console, Network Monitor, DOM Inspector, DevTools facade |
| [2026-07-29-devtools-9-panels.md](2026-07-29-devtools-9-panels.md) | Performance, Memory, Sources, Storage, Security, Accessibility panels |

## 17. Storage — 2 docs

| File | Description |
|------|-------------|
| [2026-07-26-web-storage-implementation.md](2026-07-26-web-storage-implementation.md) | LocalStorage, SessionStorage, IndexedDB — per-origin isolation, quotas |
| [2026-07-29-storage-modules.md](2026-07-29-storage-modules.md) | Cookies, LocalStorage, SessionStorage, IndexedDB, Cache, File System, OPFS |

## 18. HTML Parser — 2 docs

| File | Description |
|------|-------------|
| [2026-07-18-html5-tree-builder-modular-architecture.md](2026-07-18-html5-tree-builder-modular-architecture.md) | Modular tree builder — 9 modules, 12 insertion modes |
| [2026-07-18-html5-extended-features.md](2026-07-18-html5-extended-features.md) | Events, MutationObserver, Shadow DOM, encoding detection |

## 19. Native Build — 1 doc

| File | Description |
|------|-------------|
| [2026-07-27-native-build-backbone.md](2026-07-27-native-build-backbone.md) | Cargo/Rust workspace, nova-net, nova-bindings, CI matrix |

## 20. Accessibility — 1 doc

| File | Description |
|------|-------------|
| [2026-07-29-screen-reader-support.md](2026-07-29-screen-reader-support.md) | Role mapping, accessible name computation, accessibility tree |

## 21. Networking / Security — 1 doc

| File | Description |
|------|-------------|
| [2026-07-26-certificate-validation-implementation.md](2026-07-26-certificate-validation-implementation.md) | Real SHA-256 fingerprints, system trust store, TlsHandler, interstitials |

---

## Other Locations

### `docs/` — Architecture Documents (7)

| File | Description |
|------|-------------|
| [api-contracts.md](../docs/api-contracts.md) | API contracts |
| [architecture.md](../docs/architecture.md) | Architecture overview |
| [browser-building-gap-analysis.md](../docs/browser-building-gap-analysis.md) | Gap analysis against 9 phases of browser building |
| [DEVELOPMENT-PROCESS.md](../docs/DEVELOPMENT-PROCESS.md) | Development process documentation |
| [development-steps.md](../docs/development-steps.md) | Development steps |
| [folder-flow.md](../docs/folder-flow.md) | Folder structure / flow |
| [ui-broken-items-fixes.md](../docs/ui-broken-items-fixes.md) | 8 broken UI items fixed |

### Repository Root — Docs (5)

| File | Description |
|------|-------------|
| [README.md](../README.md) | Project readme |
| [TODO.md](../TODO.md) | Prioritized backlog (high/medium/low) |
| [DEVELOPMENT-PROCESS.md](../DEVELOPMENT-PROCESS.md) | Development process |
| [DEVELOPMENT-PROCESS.docx](../DEVELOPMENT-PROCESS.docx) | Development process (Word format) |
| [Browser architecture flowchart.html](../Browser%20architecture%20flowchart.html) | Architecture flowchart |

### Non-Markdown Assets in `doc/` (2)

| File | Description |
|------|-------------|
| [analytics.html](analytics.html) | Interactive documentation analytics dashboard (10 charts) |
| [Nova-Android-App-Guide.docx](Nova-Android-App-Guide.docx) | Android app guide (Word format) |

---

## Classification Notes

- **Scope:** 184 documents across `doc/`, `docs/`, and the repository root. Log files (`nova-health.log`) and generated reports (e.g. `test-results/`) are excluded.
- **Method:** Files were classified by topic keyword in the filename (e.g. `css-`, `gpu-`, `ipc-`, `android-`). Ambiguous names (e.g. `css-grid-layout`, `protocols-and-rendering-inventory`) were placed by their primary subject.
- **Plans & RFCs** (descriptive filenames) are included in their topic group alongside session change logs, e.g. `jit-compilation-plan.md`, `gpu-acceleration-plan.md`, `same-origin-policy-plan.md`.

## Files Modified

| File | Change |
|------|--------|
| [doc/README.md](README.md) | Indexed this inventory document |

## Files Created

| File | Purpose |
|------|---------|
| [2026-08-04-documentation-inventory.md](2026-08-04-documentation-inventory.md) | This document — complete catalog of all docs by topic |

## Test Results

No source code changed; documentation-only session.

Verification commands:
```
PS> @(Get-ChildItem doc -File -Filter *.md).Count   # 170 (169 session docs + README)
PS> @(Get-ChildItem docs -File).Count               # 7
PS> doc/.docx = 1, doc/.html = 1, root docs = 5     # TOTAL = 184
```
Document topic counts verified to sum to 169.
