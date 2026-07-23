# Browser Building Gap Analysis

**Date:** 2026-07-18
**Session:** Comprehensive audit against browser-building best practices
**Status:** Completed

---

## Summary

Audit of Nova browser (207 source files, 91 test files, 4,053+ passing tests) against the 9 phases of building a real browser. Nova has sophisticated internal architecture with virtual DOM, CSS engine, layout engine, paint pipeline, JS engine, networking layer, and security systems — but the critical gap is that **most subsystems operate in isolation with stub connections between them**. No real OS window, no real TCP/TLS networking to the internet, and no data persistence.

---

## Phase Audit

### Phase 1: Project Setup & Window Management
**Status: STUB**

| Component | Exists | Functional |
|-----------|--------|-----------|
| OS window wrapper | `app-shell.ts:113` — `BrowserWindow` class | No — `console.log()` stubs only |
| Window manager | `platform/desktop/window-manager.ts` | Calls stub `BrowserWindow` |
| Menu bar | `ui/components/menu-bar/` | Yes — desktop menu integration |
| Electron integration | `runtime-adapter.ts` — detects Electron | Type stubs only, no real dependency |

**Gap:** No real window creation. The `BrowserWindow.open()` method just logs and toggles a boolean.

### Phase 2: Networking & HTTP
**Status: SUBSTANTIAL but potentially stubbed**

| Component | Exists | Location |
|-----------|--------|----------|
| DNS resolver | Yes | `netwroking/dns-resolver.ts` |
| TCP connection | Yes | `netwroking/connection-pool.ts` |
| TLS handler | Yes | `netwroking/tls-handler.ts` |
| HTTP protocol | Yes | `netwroking/http-protocol.ts` |
| Request manager | Yes | `netwroking/request-manager.ts` |
| Response parser | Yes | `netwroking/response-parser.ts` |
| Cache manager | Yes | `netwroking/cache-manager.ts` |
| Cookie jar | Yes | `netwroking/cookie-jar.ts` |
| Firewall | Yes | `netwroking/firewall.ts` |

**Note:** Directory is misspelled as `netwroking/` (missing 'k'). 21 files exist. The `BrowserEngine` uses a `NullPageLoader` stub that returns empty 200 responses — unclear if the networking layer is wired to the engine.

### Phase 3: HTML/CSS Parsing
**Status: FUNCTIONAL**

| Component | Status |
|-----------|--------|
| HTML5 parser | 46+ tests passing |
| CSS5 parser | 86+ tests passing |
| DOM tree builder | Yes |
| Shadow DOM | 48+ tests passing |
| MutationObserver | 33+ tests passing |
| Encoding support | 106+ tests passing |
| Error recovery | 117+ tests passing |

### Phase 4: Layout Engine
**Status: FUNCTIONAL**

| Component | Status |
|-----------|--------|
| Block/inline layout | Yes |
| Flexbox | 37+ tests passing |
| Grid | 50+ tests passing |
| Positioning | 37+ tests passing |
| Stacking contexts | 26+ tests passing |
| Formatting contexts | 67+ tests passing |

### Phase 5: Rendering Pipeline
**Status: VIRTUAL ONLY**

| Component | Status |
|-----------|--------|
| Paint command generation | `paint-engine.ts` — produces `PaintCommand[]` |
| Damage tracking | Yes — incremental painting |
| Rasterizer (CPU) | `rasterizer.ts` — 56+ tests |
| Rasterizer (GPU) | `gpu-rasterizer.ts` — 68+ tests |
| **Real DOM rendering** | **MISSING** — no `document.createElement` or canvas |
| **Content display** | `content-renderer.ts` — renders to real DOM via `document.body.appendChild()` |

**Gap:** The paint engine produces abstract `PaintCommand[]` → `ImageData` pixel buffers. The `ContentRenderer` bridges this to real DOM by creating `<img>` elements from `ImageData`. This works but is not how real browsers render.

### Phase 6: JavaScript Engine
**Status: FUNCTIONAL (custom)**

| Component | Status |
|-----------|--------|
| Tree-walking interpreter | Yes |
| Bytecode VM | 141 tests (9 failures — pre-existing) |
| DOM bindings | Yes |
| Event loop | Yes |
| Script execution | 20+ tests passing |
| Site isolation | 142+ tests passing |
| CSP enforcement | 179+ tests passing |

### Phase 7: Security
**Status: FUNCTIONAL**

| Component | Status |
|-----------|--------|
| XSS mitigations | 55+ tests passing |
| Content Security Policy | 179+ tests passing |
| Tracker blocker | Yes — with enable/disable toggle |
| Ad blocker | 171+ tests passing |
| Password manager | 71+ tests passing |
| Certificate validation | Yes |

### Phase 8: Storage & Persistence
**Status: IN-MEMORY ONLY**

| Store | Class | Persistence |
|-------|-------|-------------|
| Cookies | `InMemoryCookieStore` | None — `Map`-based |
| Bookmarks | `InMemoryBookmarkStore` | None — `Map`-based |
| History | `InMemoryHistoryStore` | None — `Map`-based |
| Passwords | `InMemoryPasswordStore` | None — `Map`-based |
| Sessions | `InMemorySessionsStore` | None — `Map`-based |
| Auth tokens | `InMemoryTokenStore` | None — `Map`-based |
| Settings | `SettingsStore` | localStorage (after Fix 7) |

**Gap:** 6 of 7 stores lose all data on reload. Only `SettingsStore` now persists (via localStorage).

### Phase 9: Tab Management
**Status: FUNCTIONAL**

| Component | Status |
|-----------|--------|
| Tab manager | Yes — create, remove, activate, events |
| Tab sessions | `TabSession` with history[], title, url |
| Tab strip UI | 14+ tests passing |
| Tab strip view | DOM rendering of tabs |
| Multi-tab navigation | Shared NavigationController (after Fix 6) |

---

## Critical Gaps (Blocking Functional Browser)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| 1 | **No real OS window** | Can't display as standalone app | High — needs Electron integration |
| 2 | **No real TCP/TLS networking** | Can't fetch real web pages | High — networking layer exists but uses NullPageLoader stub |
| 3 | **No data persistence** | All state lost on reload | Medium — 6 InMemory stores need IndexedDB/file backends |

## Important Gaps (Reducing Functionality)

| # | Gap | Impact | Effort |
|---|-----|--------|--------|
| 4 | **Networking directory misspelled** | `netwroking/` should be `networking/` | Low — rename |
| 5 | **NullPageLoader/NullPageRenderer** | Engine can't load real pages | Medium — wire networking layer to engine |
| 6 | **Paint engine not connected to display** | Virtual paint commands don't reach screen | Low — ContentRenderer already bridges this |
| 7 | **No service worker support** | PWA/offline not supported | High |
| 8 | **No WebRTC** | No real-time communication | Very High |

## Minor Gaps (Polish)

| # | Gap | Impact |
|---|-----|--------|
| 9 | No favicons on tabs | Visual polish |
| 10 | No download progress UI | UX improvement |
| 11 | No print support | Feature gap |
| 12 | No DevTools protocol | Developer experience |

---

## Recommended Path Forward

**Option A: Electron Integration (Recommended)**
- Wrap existing UI in Electron's `BrowserWindow`
- Use Electron's `net` module for real networking
- Use Electron's `session` API for cookies/storage
- Leverages all existing UI/layout/parsing code

**Option B: Continue Pure-JS Engine**
- Wire existing networking layer to `BrowserEngine` (replace `NullPageLoader`)
- Add IndexedDB adapter for storage
- Use `document.body.appendChild()` for display (already done via `ContentRenderer`)
- More work but fully custom

---

## Files Referenced

| Area | Key Files |
|------|-----------|
| Window | `src/app/app-shell.ts:113`, `src/platform/desktop/window-manager.ts` |
| Engine | `src/browser/engine/browser-engine.ts` (569 lines) |
| Networking | `src/browser/netwroking/` (21 files) |
| Rendering | `src/browser/rendering/paint-engine.ts` (547 lines) |
| Storage | `src/browser/storage/` (7 files, 6 InMemory) |
| UI | `src/ui/pages/browser-window.ts` (1038 lines) |
| Bridge | `src/ui/components/navigation-fetcher.ts` (125 lines) |
| Tests | `tests/` (91 files, 4,053+ passing) |
