# Nova Browser — TODO

Last updated: 2026-07-19

## Priority: High

### 1. BrowserEngine → PageLoader / PageRenderer Wiring
- **File:** `src/browser/engine/browser-engine.ts`
- `BrowserEngine` has `setPageLoader()` / `setPageRenderer()` plugin points but `main.ts` still uses `NullPageLoader` and `NullPageRenderer` stubs
- The full page-load pipeline (network fetch → HTML parse → CSS parse → layout → paint) is not wired end-to-end through `BrowserEngine`
- [x] PageLoader extracted — wraps `IResourceLoader.loadResource()`, 14 tests
- [x] PageRenderer extracted — parses HTML→CSS→layout→paint→JS, 22 tests
- [x] PageRenderer controller wiring — inline `<script>` blocks get `window.history`/`window.location`
- [ ] Wire PageLoader + PageRenderer into BrowserEngine plugin points

### 2. IPC Channel Direction Configuration
- **File:** `src/common/ipc/channel.ts:179`
- Direction is hard-coded as `'main-to-renderer'`; needs config-driven bidirectional routing
- [ ] Add direction metadata to channel definitions
- [ ] Update `ChannelManager` to route based on config, not hard-coded string

### 3. Real Image Decoding Integration
- Image data is stored as synthetic `ImageData` (colored rectangles) on `DomElement`
- [ ] Replace with actual JPEG/PNG/WEBP decoding via platform adapter
- [ ] Wire decoded bitmap into paint engine's `drawImage`

## Priority: Medium

### 4. Sticky Position Font Size Resolution
- **File:** `src/browser/rendering/positioning.ts:361`
- `fontSize` is hard-coded to `16`; should read from element's computed style
- [ ] Resolve font size from `element.computedStyle.fontSize` in sticky offset calculation

### 5. Stacking Context — `transform`, `filter`, `will-change` Triggers
- Currently only `position + z-index` and `opacity < 1` create stacking contexts
- [ ] Add `transform: none` (any non-none value) → new stacking context
- [ ] Add `filter: none` (any non-none value) → new stacking context
- [ ] Add `will-change: transform|filter|opacity` → new stacking context

### 6. JS Engine — Promise Microtask Queue
- **File:** `src/browser/engine/js-engine/` (event loop)
- Event loop has macrotask queue (setTimeout/setInterval) but microtask scheduling is a future feature
- [ ] Implement microtask queue for Promise `.then`/`catch`/`finally` callbacks
- [ ] Drain microtask queue after each macrotask completes

### 7. SOCKS Proxy Support
- **File:** `src/browser/netwroking/request-manager.ts:418-421`
- `ProxyAwareHttpClient` falls back to direct connection with a warning when SOCKS is configured
- [ ] Implement native SOCKS4/SOCKS5 proxy connect

## Priority: Low

### 8. WebSocket Binary Data Handling
- **File:** `src/browser/netwroking/request-manager.ts:210`
- Binary data is stored as `'[binary data]'` placeholder
- [ ] Read Blob asynchronously via `event.data.text()` or `event.data.arrayBuffer()`

### 9. Text Measurement — Pluggable Font Metrics
- **File:** `src/browser/rendering/formatting/text-measure.ts:146`
- Currently uses character-width heuristic when canvas is unavailable
- [ ] Design pluggable `FontMetricsProvider` interface
- [ ] Implement canvas-based measurement adapter

### 10. Electron / Native Window Integration
- **File:** `src/app/app-shell.ts` (4 TODOs)
- `BrowserWindow.open()`, `close()`, `focus()`, `setTitle()` are stubs
- [ ] Implement when Electron platform adapter is built (not applicable for pure-JS engine scope)

### 11. Navigation Controller — Deferred Commit
- **File:** `src/browser/navigation/navigation-controller.ts:605-608`
- `NavigationState.Complete` is set immediately; designed for deferred completion after document load
- [ ] Wire `BrowserEngine` commit callback for true deferred navigation completion

## Done (reference)

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
