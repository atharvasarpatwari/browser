# Nova Browser — Documentation Index

## Plans & Reports

| Date | File | Summary |
|------|------|---------|
| 2026-07-21 | [process-model-design-report.md](process-model-design-report.md) | Process model design report — single-process vs multi-process tradeoffs, readiness assessment, infrastructure inventory, recommended 3-phase path forward. |
| 2026-07-21 | [jit-compilation-plan.md](jit-compilation-plan.md) | Two-tier JIT compilation — stack-based bytecode VM replacing tree-walking interpreter, plus WASM JIT compiler (V8 TurboFan native code). ~3,500 new lines across 6 new files. |
| 2026-07-19 | [gpu-acceleration-plan.md](gpu-acceleration-plan.md) | GPU acceleration using WebGPU (Dawn bindings) for rasterizer + compositing. Target 60+ FPS at full HD. 10 files to create, 5 files to modify. |
| 2026-07-19 | [fetch-api-xhr-plan.md](fetch-api-xhr-plan.md) | Implementation plan for Fetch API (`fetch()`, `Headers`, `Response`, `Request`, `AbortController`) and `XMLHttpRequest` in the JS engine. 6 files to create/modify, ~1,265 lines. |
| 2026-07-18 | [../docs/browser-building-gap-analysis.md](../docs/browser-building-gap-analysis.md) | Comprehensive gap analysis against 9 phases of browser building — 207 source files, 91 test files, critical gaps: no OS window, no real networking, no persistence. Recommended path: Electron integration. |
| 2026-07-18 | [../docs/ui-broken-items-fixes.md](../docs/ui-broken-items-fixes.md) | 8 broken UI items fixed — NavigationFetcher boot order, toolbar sync, tab title updates, duplicate DI services, shared NavigationController, settings persistence, mobile layout activation. |
| 2026-07-22 | [2026-07-22-vite-dev-server.md](2026-07-22-vite-dev-server.md) | Vite dev server setup — `npm run dev` serves full browser chrome UI at localhost:5173. Fixed Buffer.byteLength in IPC transport, lazy-imported Node-only image decoders, aliased electron for Vite resolution. |

## Change Logs

| Date | File | Summary |
|------|------|---------|
| 2026-07-22 | [2026-07-22-tab-management-overhaul.md](2026-07-22-tab-management-overhaul.md) | Tab management overhaul — TabSession↔TabContext bridge, session persistence (auto-save/restore), event emission gaps fixed, 148 new tests. |
| 2026-07-22 | [2026-07-22-tab-persistence.md](2026-07-22-tab-persistence.md) | Tab persistence — storage abstraction (localStorage + MemoryStore), orchestrator with auto-save on TabManager events, debounced title/url, staleness check. 189 lines. |
| 2026-07-22 | [2026-07-22-navigation-bridge-test-suite.md](2026-07-22-navigation-bridge-test-suite.md) | NavigationBridge comprehensive test suite — 25 mock-based tests across construction, navigation, back/forward, tab sync, events, address bar input, dispose. |
| 2026-07-22 | [2026-07-22-tab-context-tests.md](2026-07-22-tab-context-tests.md) | TabContext & TabContextManager tests — 25 tests covering construction, state machine, crash/recovery, snapshots, events, config, manager CRUD, disposal. |
| 2026-07-22 | [2026-07-22-garbage-collection.md](2026-07-22-garbage-collection.md) | Garbage collection — two-generation mark-and-sweep (young/old gen), root scanning (VM stack/frames/env chains), weak refs via FinalizationRegistry, finalization. 62 new tests. |
| 2026-07-22 | [2026-07-22-jit-wasm-codegen.md](2026-07-22-jit-wasm-codegen.md) | JIT compilation Phase 2 — WASM binary encoder (NaN-boxing, 45+ host imports) + tier manager (hot detection, LRU cache, deoptimization). 37 new tests. |
| 2026-07-22 | [2026-07-22-vm-closure-upvalue-fixes.md](2026-07-22-vm-closure-upvalue-fixes.md) | VM closure & upvalue fixes — completed upvalue support: compileUpdate upvalue check, handleCall pass upvalues, compileFunctionExpr outerScopes wiring. 141/141 VM tests pass. |
| 2026-07-21 | [2026-07-21-customizable-browser-name.md](2026-07-21-customizable-browser-name.md) | Customizable browser name — BrowserName service with settings persistence, wired through window title, new tab, search footer, shield tooltips, special pages. 4062 tests pass. |
| 2026-07-21 | [2026-07-21-ui-backend-wiring.md](2026-07-21-ui-backend-wiring.md) | UI backend wiring — engine integration, search->DuckDuckGo pipeline, downloads->DownloadManager, bookmarks/history->backend services. Type fixes. 4062 tests pass. |
| 2026-07-20 | [2026-07-20-js-engine-critical-gaps.md](2026-07-20-js-engine-critical-gaps.md) | JS engine critical gaps — optional chaining (`?.`), nullish coalescing (`??`/`??=`), labeled statements with `break`, `eval()`, async/await, generators (`yield`/`yield*`). Fixed class instantiation regression and labeled break propagation. 24 new tests, 158 total. |
| 2026-07-20 | [2026-07-20-image-decoding.md](2026-07-20-image-decoding.md) | Image decoding — PNG & JPEG support via pngjs/jpeg-js. Binary data network path, ImageDecoder class, lazy loader integration with real fetch→decode pipeline. 20 new tests. |
| 2026-07-20 | [2026-07-20-gpu-acceleration-phase3.md](2026-07-20-gpu-acceleration-phase3.md) | GPU acceleration Phase 3 — async rasterize with real GPU readback, resize support, pre-existing bug fixes. 68 tests pass. |
| 2026-07-20 | [2026-07-20-gpu-acceleration-phase2.md](2026-07-20-gpu-acceleration-phase2.md) | GPU acceleration Phase 2 — drawImage/fillText compute shaders, double-buffered readback, PaintEngine integration, full command support. 61 tests pass. |
| 2026-07-20 | [2026-07-20-gpu-acceleration-phase1.md](2026-07-20-gpu-acceleration-phase1.md) | GPU acceleration Phase 1 — WebGPU infrastructure (device manager, buffer pool, shader modules, compute ops, GPU rasterizer with software fallback). 8 new files, 3 modified, 44 tests. |
| 2026-07-19 | [crash-recovery-isolation-tests.md](2026-07-19-crash-recovery-isolation-tests.md) | Integration tests for crash recovery and site isolation — 105 tests across TabProcessManager, LifecycleManager, ErrorBoundary, ScriptGuard, ProcessGuard, CrashReporter, multi-tab isolation. Full suite: 87 files / 3837 tests. |
| 2026-07-19 | [fetch-api-implementation.md](2026-07-19-fetch-api-implementation.md) | Fetch API implementation — Headers, Response, Request, AbortController, fetch(). EventLoop `_globalCaller` fix for microtask reactions. JSError wrapping for native throws. 36 new tests; 86 files / 3732 tests. |
| 2026-07-19 | [promise-microtask-fixes.md](2026-07-19-promise-microtask-fixes.md) | Promise chain + Promise.all() bug fixes — parser comma-precedence bug (`parseExpression(2)`), missing array `length` update in all/allSettled accumulators. 31/31 promise tests pass. Full suite: 84 files / 3577 tests. |
| 2026-07-19 | [history-api-location-bindings.md](2026-07-19-history-api-location-bindings.md) | History API + Location bindings — window.history (pushState/replaceState/back/forward/go/state/length), window.location (href/hash/search/pathname/origin), popstate/hashchange events, go(delta), state serialization. 65 new tests; 83 files / 3546 tests. |
| 2026-07-19 | [spec-adherence-phase1-complete.md](2026-07-19-spec-adherence-phase1-complete.md) | Phase 1 complete — querySelector wiring, JS event propagation (capture/bubble), HTML parser unknown element fix. 3481 tests all pass. |
| 2026-07-19 | [spec-adherence-phase1.md](2026-07-19-spec-adherence-phase1.md) | Phase 1 spec fixes — capture phase, CSS specificity, regex lexing, template literal interpolation, PermissionManager test fix. 3456 tests all pass. |
| 2026-07-19 | [site-isolation.md](2026-07-19-site-isolation.md) | Site isolation tests — 142 tests across all 5 modules (OriginIsolator, CrossOriginGuard, PermissionManager, ResourceQuotaManager, PrivilegeLevels). Fixed PrivilegeLevels Map iteration bug. Full suite: 82 files / 3437 tests. |
| 2026-07-19 | [spec-adherence-audit.md](2026-07-19-spec-adherence-audit.md) | WHATWG/W3C spec adherence audit — 4 parallel audits (HTML parser ~90%, CSS5 ~55%, JS engine ~55%, DOM/Events/Navigation ~65%). 32 gaps identified, prioritized into 4 phases. 6 critical fixes, 10 high-impact features, 9 completeness items, 7 polish items. |
| 2026-07-19 | [page-loader-renderer.md](2026-07-19-page-loader-renderer.md) | PageLoader & PageRenderer extraction — Standalone classes implementing IPageLoader and IPageRenderer interfaces. 36 new tests; full suite 80 files / 3295 tests. |
| 2026-07-19 | [content-security-policy.md](2026-07-19-content-security-policy.md) | CSP engine — 8 modules (parser, evaluator, reporter, policy-store, navigation-guard, resource-enforcer, script-enforcer, sandbox-enforcer), 179 tests, 6 root cause fixes. Full suite: 79 files / 3261 tests. |
| 2026-07-18 | [application-bootstrap-wiring.md](2026-07-18-application-bootstrap-wiring.md) | Application bootstrap wiring — 11 DI tokens, Firewall integration (networking-setup.ts), TabProcessManager startup wiring, external script fetching pipeline (blocking/defer/async). 14 new tests. |
| 2026-07-19 | [settings-integration.md](2026-07-19-settings-integration.md) | Settings persistence — SettingsStore (Map + localStorage), SettingsService (DI + change broadcasting), SettingsPage wired into BrowserWindowPage, 39 new tests. |
| 2026-07-19 | [devtools.md](2026-07-19-devtools.md) | Developer Tools — Console (logging, formatting, duplicate collapsing), Network Monitor (timing phases, firewall decisions, HAR export), DOM Inspector (CSS selector-lite, tree walking), DevTools facade. 99 tests. |
| 2026-07-19 | [bookmarks-history-ui.md](2026-07-19-bookmarks-history-ui.md) | Bookmarks/History UI module — Vitest test conversion from custom mini-framework. 48 tests across BookmarksService, HistoryService, renderBookmarksPanel, renderHistoryPage, renderBookmarkStarButton, injectStyles. |
| 2026-07-19 | [navigation-bridge.md](2026-07-19-navigation-bridge.md) | NavigationBridge orchestration — re-entrancy guard, blocked-protocol detection, search query detection fix, AddressBar keyboard shortcuts, BrowserWindowPage wiring. 29 tests; full suite 78 files / 3082 tests. |
| 2026-07-18 | [ip-protocol.md](2026-07-18-ip-protocol.md) | IP protocol layer + IP adapter + Tab-Process adapter. ip-protocol.ts (IPv4/IPv6, CIDR, PNA, DNS, Happy Eyeballs, ConnectionPool — 100 tests), ip-adapter.ts (createIPSystemResolver, PNAEnforcingHttpClient — 23 tests), tab-process-adapter.ts (TabContextManager ↔ ProcessManager bridge — 18 tests). |
| 2026-07-18 | [ipc-design.md](2026-07-18-ipc-design.md) | IPC system — message protocol, serializer, transport, channel, service-proxy, process-manager. 6 modules, 64 tests. Fixed 19 test failures (toJSON trap, undefined deletion, _connected, ESM import). |
| 2026-07-18 | [crash-recovery-isolation.md](2026-07-18-crash-recovery-isolation.md) | Crash recovery/isolation — per-tab TabContext, ScriptGuard, ErrorBoundary, ProcessGuard, CrashReporter, LifecycleManager enhancements. 88 tests. |
| 2026-07-18 | [ui-cleanup-and-formatting-tests.md](2026-07-18-ui-cleanup-and-formatting-tests.md) | Fixed tab-strip listener leak, added 67 formatting context tests (margin collapsing, anonymous blocks, inline context, float context, vertical alignment, box model). |
| 2026-07-18 | [resource-prioritization.md](2026-07-18-resource-prioritization.md) | Implemented priority-aware resource loading — PriorityQueue, BandwidthEstimator, ResourcePrioritizer, cache integration. 4 new modules, 69 tests. |
| 2026-07-18 | [profiling-benchmarking-toolkit.md](2026-07-18-profiling-benchmarking-toolkit.md) | Profiling/benchmarking toolkit — 51 benchmarks across HTML/CSS parsing, layout, JS engine, paint/rasterizer, pipeline, memory profiling. Markdown reports, leak detection. |
| 2026-07-18 | [memory-management.md](2026-07-18-memory-management.md) | Memory leak audit and fixes — timer leaks, disposal chains, idIndex cleanup, size caps, stale reference cleanup — 37 new tests. |
| 2026-07-18 | [script-execution-fixes.md](2026-07-18-script-execution-fixes.md) | Fixed 7 failing script-execution integration tests (26 total now pass). Root causes: rawContent→text child conversion, pendingRawText reset, window object, shared globalEnv, JS bindings. |
| 2026-07-18 | [module-integration-sweep.md](2026-07-18-module-integration-sweep.md) | Fixed all integration gaps: wired LazyLoader, created ReflowRepaintController, removed dead code, added 3 missing test files (55 tests), full pipeline integration test, JSDoc, cleanup. |
| 2026-07-18 | [resource-prioritization-plan.md](2026-07-18-resource-prioritization-plan.md) | Design plan for priority-aware resource loading with cache integration. 4 new modules, 5 modified files, 80+ new tests. |
| 2026-07-18 | [html5-tree-builder-modular-architecture.md](2026-07-18-html5-tree-builder-modular-architecture.md) | Modular HTML5 tree builder — 9 core modules, 12 insertion modes, tree builder orchestrator, namespace support. |
| 2026-07-18 | [html5-extended-features.md](2026-07-18-html5-extended-features.md) | Events (44 tests), MutationObserver (33 tests), Shadow DOM (48 tests), encoding detection. |
| 2026-07-18 | [css5-full-rewrite.md](2026-07-18-css5-full-rewrite.md) | CSS5 tokenizer, parser, selector engine, cascade engine, shorthand expansion, @rules — 1741+ tests. |
| 2026-07-18 | [layout-engine-rewrite.md](2026-07-18-layout-engine-rewrite.md) | Layout engine rewrite — box model, CSS box-sizing, named font sizes, resolveLength, border fields. |
| 2026-07-18 | [formatting-contexts.md](2026-07-18-formatting-contexts.md) | Block, inline, flex, list-item formatting contexts, anonymous block generation, classifyDisplay. |
| 2026-07-18 | [flexbox-layout.md](2026-07-18-flexbox-layout.md) | Full CSS Flexbox layout — flex-direction, wrap, justify-content, align-items, grow/shrink/basis, order — 37 tests. |
| 2026-07-18 | [css-grid-layout.md](2026-07-18-css-grid-layout.md) | CSS Grid layout — template tracks, fr units, auto-placement, template areas, span, gap — 50 tests. |
| 2026-07-18 | [css-positioning.md](2026-07-18-css-positioning.md) | CSS positioning — static, relative, absolute, fixed, sticky; containing block resolution, z-index — 37 tests. |
| 2026-07-18 | [line-breaking-text-measure-floats.md](2026-07-18-line-breaking-text-measure-floats.md) | UAX #14 line breaking, text measurement abstraction, CSS float layout with exclusion zones. |
| 2026-07-18 | [text-rendering.md](2026-07-18-text-rendering.md) | Paint engine renders actual text content from InlineLevelBox via TextRun data. |
| 2026-07-18 | [stacking-contexts-paint-order.md](2026-07-18-stacking-contexts-paint-order.md) | CSS 2.2 Appendix E stacking context tree, 7-layer paint order, z-index ordering — 26 tests. |
| 2026-07-18 | [software-rasterizer.md](2026-07-18-software-rasterizer.md) | Software rasterizer — CSS color parser, 8×8 bitmap font, alpha compositing, state stack — 56 tests. |
| 2026-07-18 | [reflow-repaint-minimization.md](2026-07-18-reflow-repaint-minimization.md) | Damage region tracking, coalesced frame scheduling, dirty flags, incremental layout/paint — 22 tests. |
| 2026-07-18 | [lazy-loading.md](2026-07-18-lazy-loading.md) | IntersectionObserver, LazyLoader, synthetic image rendering, drawImage, JS bindings — 45 tests. |
| 2026-07-18 | [javascript-engine.md](2026-07-18-javascript-engine.md) | Complete JS interpreter — lexer, Pratt parser, tree-walker, DOM bindings, event loop — 107 tests. |

## Architecture

| Document | Status | Description |
|----------|--------|-------------|
| [resource-prioritization.md](2026-07-18-resource-prioritization.md) | Completed | PriorityQueue, BandwidthEstimator, ResourcePrioritizer, cache wiring — 69 tests |

## Analytics

| File | Description |
|------|-------------|
| [analytics.html](analytics.html) | Interactive documentation analytics dashboard — glassmorphism dark theme, 10 charts, searchable doc table, spec compliance gauges |

## Project Tracker

| File | Description |
|------|-------------|
| [TODO.md](../TODO.md) | Prioritized backlog — high/medium/low items with file references |

## Conventions

- All documentation lives in `doc/`
- Filename format: `YYYY-MM-DD-<short-description>.md`
- Every session that modifies source code MUST produce a change log in `doc/`
- Plans and RFCs use descriptive names
- `AGENTS.md` at project root enforces mandatory doc generation per session
