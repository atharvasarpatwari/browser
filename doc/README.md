# Nova Browser — Documentation Index

## Change Logs

| Date | File | Summary |
|------|------|---------|
| 2026-07-18 | [application-bootstrap-wiring.md](2026-07-18-application-bootstrap-wiring.md) | Application bootstrap wiring — 11 DI tokens, Firewall integration (networking-setup.ts), TabProcessManager startup wiring, external script fetching pipeline (blocking/defer/async). 14 new tests. |
| 2026-07-19 | [settings-integration.md](2026-07-19-settings-integration.md) | Settings persistence — SettingsStore (Map + localStorage), SettingsService (DI + change broadcasting), SettingsPage wired into BrowserWindowPage, 39 new tests. |
| 2026-07-19 | [devtools.md](2026-07-19-devtools.md) | Developer Tools — Console (logging, formatting, duplicate collapsing), Network Monitor (timing phases, firewall decisions, HAR export), DOM Inspector (CSS selector-lite, tree walking), DevTools facade. 99 tests. |
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

## Conventions

- All documentation lives in `doc/`
- Filename format: `YYYY-MM-DD-<short-description>.md`
- Every session that modifies source code MUST produce a change log in `doc/`
- Plans and RFCs use descriptive names
- `AGENTS.md` at project root enforces mandatory doc generation per session
