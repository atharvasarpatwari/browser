# Changelog

All notable changes to Nova Browser are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); dates reflect the session a
change landed in, per the dated logs under `doc/`. There is no tagged release
yet, so everything so far lives under **Unreleased**.

## [Unreleased]

### Added
- **Rendering engine, from scratch**: HTML5 spec-compliant tokenizer and
  modular tree-builder (per-insertion-mode handlers, adoption agency
  algorithm, foster parenting), CSS5 tokenizer/parser/cascade/selector
  engine, a full layout pipeline (block, inline, flexbox, grid, floats,
  positioning, tables), a software rasterizer (text shaping, images,
  borders, gradients, shadows, blend modes), and a compositor (layers,
  scrolling, damage tracking, GPU path).
- **A genuinely custom JavaScript engine**: lexer → parser → AST-walking
  interpreter, plus a separate bytecode compiler, VM, and tiered JIT
  manager, with its own mark-and-sweep garbage collector (two-generation,
  root scanning, weak refs, finalization) — not a V8 wrapper.
- **Web platform APIs**: Fetch/XHR, WebSocket, Web Workers, Canvas 2D,
  WebGL/WebGL2, Web Crypto (`crypto.subtle`, delegating to Node's real
  `webcrypto`), Custom Elements (`customElements`, extendable
  `HTMLElement`), Cache API (`caches`), Notifications, Geolocation,
  IndexedDB, localStorage/sessionStorage, WebRTC (ICE/STUN over real UDP,
  Phase 1 — data channel is a Nova-specific reliable framing protocol, not
  yet SCTP/DTLS-interoperable).
- **Networking stack**: HTTP/1.1 (keep-alive, chunked encoding), HTTP/2
  (HPACK), HTTP/3 over a real QUIC transport, TLS, DNS resolution, cookies,
  a real size-based eviction cache, SOCKS4/4a/5 and HTTP CONNECT proxy
  support for raw sockets.
- **contextIsolation-safe architecture**: a main-process socket-owner
  behind an RPC proxy, so the renderer never holds a live `net`/`tls`/`dgram`
  socket directly — the whole networking stack is driven through the
  preload bridge instead.
- **Security subsystem**: CSP (parser, evaluator, policy store, reporter,
  per-directive enforcers), CORS, Same-Origin Policy, certificate
  validation, mixed-content blocking, permission prompts, resource quota
  management, crash isolation and recovery (per-tab error boundaries with
  retry/fallback strategies).
- **Browser UI shell**: tabs (pinned/muted/audible/loading), address bar,
  bookmarks, history, downloads (pause/resume/cancel, Range-based resume),
  settings, incognito mode, DevTools panels (performance, memory, security,
  accessibility, sources, storage).
- **Android app**: a native Kotlin/Compose UI hosting the same JS engine in
  a WebView via a native fetch/state bridge — not a second implementation
  of the rendering engine.
- **Desktop packaging**: Electron shell with NSIS/DMG/AppImage/deb/rpm
  targets, auto-update, crash reporting, opt-in telemetry, an on-device
  Android smoke-test harness, and a CI gate (typecheck + full vitest + e2e)
  on every push/PR.
- `LICENSE` (MIT) and a centralized `src/common/logger.ts` used across the
  error-handling core instead of scattered `console.*` calls.

### Fixed
This list only covers root-cause fixes with enough of a paper trail to
summarize honestly; the full count (460+ at last count) is tracked per-session
in `doc/*.md` and totaled in `doc/analytics.html`.
- **HTML5 parsing**: the "any other end tag" fallback was missing entirely —
  `<span>` and ~40 other ordinary elements never closed. `resetInsertionMode`
  had no cases for a `td`/`th`/`tr` current node, breaking nested tables;
  the "clear the stack back to a table body context" step was also missing.
  Table elements never got their implicit `display: table*` UA defaults, so
  table layout was dead code for virtually every real `<table>`.
- **Layout**: a wrapped inline element's height, once grown by its own
  recursive child layout, never propagated back to its line box — the
  single root cause behind story rows silently overlapping on real
  table-based pages. `layoutAnonymousBlock` never passed its `startX`,
  mispositioning inline content horizontally. CSS `pt` units were silently
  dropped by the line-height special case, inflating computed line-height
  by ~12x on any page using point-based CSS.
- **Paint**: `border-style: none` (the CSS default) was still being
  painted because the border code only checked `width > 0`, not style —
  every element on every page got a phantom "medium" border.
- **JavaScript engine**: `resolvePromise()`'s pending-promise-adoption
  branch never registered its reaction with the reaction-tracking map,
  silently discarding the resolution of any code that returns a still-
  pending promise from inside a `.then()` callback — a very common async
  pattern. Class bodies had no getter/setter support at all (neither
  `static` nor instance) — `static get observedAttributes()`, the standard
  way every custom element declares itself, couldn't even parse.
- **Tokenizer**: character references decoded inside an attribute value
  were always appended to the page's text content instead of the
  attribute, leaking stray `&`-derived text next to elements with
  `&amp;`-bearing attributes. Numeric character references terminated by
  `;` never returned the tokenizer to its caller state, corrupting or
  eating the very next character.
- **Android**: `html`/`body` CSS height (`%` or viewport units) resolved to
  `0` inside the Compose `AndroidView`-hosted WebView even though
  `window.innerHeight` reported the real size correctly, making every page
  — including the app's own home page — render as a blank screen despite
  painting real pixels underneath. Fixed by pinning the root element's
  height to `window.innerHeight` in pixels, kept in sync on resize.
- Image decode under `contextIsolation` (pngjs), a WebGPU submit/destroy
  ordering bug, and a QUIC wire-format bug where the packet-type bits
  written by the builder and read by the parser didn't agree, so every
  long-header packet decoded as "Initial" and handshakes never completed.

### Changed
- Deleted the dead `.nova-*` CSS and unified the desktop UI onto one theme
  system instead of two parallel ones.
- Removed the simulated `RTCPeerConnection` shim in favor of the real
  ICE/STUN-backed implementation.
- Renamed and restructured the networking module to break an import cycle
  and remove dead code.
