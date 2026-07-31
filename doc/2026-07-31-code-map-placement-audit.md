# Code Map & Placement Audit

**Date:** 2026-07-31
**Session:** Mapped the full codebase architecture and fixed two broken-placement imports.
**Status:** Completed

---

## Summary
Produced a complete architecture map of the 410-file TypeScript codebase and audited layer placement. Fixed two placement bugs (broken import paths) found by the audit; 223 tests pass.

## Code Map

### Layer Map

| Layer | Path | Files | Role |
|-------|------|-------|------|
| app | `src/app/` | 4 | Entry point (`main.ts`), DI container, app shell, process-model config |
| platform | `src/platform/` | 7 | `shared/` (input-manager, window-controls, runtime-adapter, platform-events) + `desktop/` (window-manager, menu-integration) |
| process | `src/process/` | 2 | `renderer-entry-sandboxed.ts` (live), `renderer-entry.ts` (legacy/broken) |
| ui | `src/ui/` | 20 | pages (browser-window, settings, downloads), layouts (desktop/mobile), components (toolbar, tab-strip, address-bar, status-bar, bookmark-bar, context-menu, content-renderer, navigation-bridge, bookmarks-history) |
| browser | `src/browser/` | 348 | Core engine: rendering (98, incl. html5/css5/gpu/compositing/canvas/formatting), media (61), security (30), js (27), netwroking (26), navigation-controls (15), engine (13), auth (11), storage (11), devtools (9), extensions (9), omnibox (7), settings (7), tabs (4), navigation (3), accessibility (2), bookmarks (2), downloads (2), image (2) |
| common | `src/common/` | 14 | Only `ipc/` has content. `constants/`, `events/`, `types/`, `utils/` are **empty** |
| native | `src/native/` | 4 | Rust binding wrappers — **zero importers (dead)** |
| benchmark | `src/benchmark/` | 11 | Harness + suites; imports browser internals directly (tooling-only) |

### Entry Point Flow
`ApplicationBootstrap` (src/app/main.ts) → clear mutation-observer registrations → DI registrations (navigation, engine, tabs, process, networking, security, rendering, storage, settings, platform services) → `startPlatformServices()` (WindowManager → windows, InputManager, WindowControls) → mount UI → `AppShell` (topmost owner) → per-tab `BrowserEngine` → `Router.dispatch` → `PageLoader.load` → `PageRenderer.render` → `pageLoadComplete`.

### GPU Wiring (verified correct)
`process-model.ts` `enableGpuAcceleration` → `main.ts` PaintEngine registration (`hardwareAcceleration`) → `rendering/paint-engine.ts` → `rendering/gpu/gpu-rasterizer.ts` (WebGPU, software fallback). Direction app→browser→gpu only; gpu/ imports only its own types + rasterizer.

### InputManager / WindowControls (verified correct)
Consumed only via DI in main.ts:126-129; no browser-layer code touches them. No layer leakage.

## Placement Issues Fixed

### 1. cors.ts broken networking import
**File:** `src/browser/security/cors.ts:59`
**Problem:** Imported `'../networking/request-manager'` but the directory is misspelled `netwroking/` — type import resolved to nothing (silent, type-only).
**Fix:**
```ts
import type { IRequestManager, HttpResponseSpec } from '../netwroking/request-manager';
```

### 2. task-manager.ts import from empty common/types
**File:** `src/browser/engine/task-manager.ts:8`
**Problem:** Imported `IDisposable, ISharedService` from `'../../common/types'` — an empty directory. Matches no module; both symbols live in app-layer files.
**Fix:**
```ts
import type { IDisposable } from '../../app/dependency-container';
import type { ISharedService } from '../../app/app-shell';
```

## Remaining Placement Issues (not fixed — structural)
| Issue | Location | Impact |
|-------|----------|--------|
| Runtime circular dep | `src/platform/desktop/window-manager.ts:3` imports `BrowserWindow` value from `../../app/app-shell` (app also imports WindowManager) | app↔platform cycle |
| Misspelled dir | `src/browser/netwroking/` (should be `networking/`) | ~5 importers, naming only |
| Legacy entry | `src/process/renderer-entry.ts` imports `../browser/dom`, `../browser/layout`, `../browser/html-parser`, `../browser/paint` — none exist | dead code (live: renderer-entry-sandboxed.ts) |
| Dead cross-process proxies | `src/common/ipc/cross-process-page-loader.ts` + `cross-process-page-renderer.ts` import `../browser/navigation/page-*` (doesn't exist) | zero importers, dead |
| Dead media/ + web-apis/ | `src/browser/media/` (61 files) duplicates live `src/browser/js/` implementations; `src/browser/web-apis/web-apis-permissions.ts` (mojibake header) | zero importers |
| Dead native/ | `src/native/` (4 files) | zero importers |
| Empty dirs | `src/common/{constants,events,types,utils}` | task-manager fix relocated its import |
| 192 type-only app imports | `import type { IDisposable } from '../../app/dependency-container'` across all layers | intentional convention; candidate for promotion to common/types |
| common→browser type inversion | `src/common/ipc/capability-gate.ts:27` imports `PrivilegeLevel, ApiSurface` from `browser/security/privilege-levels` | layering smell, type-only |

## Files Modified
| File | Change |
|------|--------|
| `src/browser/security/cors.ts` | networking → netwroking import path |
| `src/browser/engine/task-manager.ts` | IDisposable/ISharedService import from common/types → app/dependency-container + app/app-shell |

## Test Results
```
Test Files  4 passed (4)
     Tests  223 passed (223)

tests/cors.test.ts                80 passed
tests/task-manager.test.ts        29 passed
tests/security.test.ts            69 passed
tests/third-party-security.test.ts 45 passed
```

## Verification Steps
1. Confirmed `IRequestManager` + `HttpResponseSpec` exported from `src/browser/netwroking/request-manager.ts:1009,1013`.
2. Confirmed `IDisposable`/`ISharedService` exported from `app/dependency-container` / `app/app-shell`.
3. Ran cors + task-manager + security + third-party-security suites — 223/223 pass.
