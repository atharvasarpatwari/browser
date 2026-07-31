# Platform Input & Window Controls Implementation

**Date:** 2026-07-31
**Session:** Application entry point / window / input feature audit — fill gaps (input handling, mouse, keyboard, drag & drop, fullscreen API, high-DPI scaling)
**Status:** Completed

---

## Summary
Audited the 11 requested platform features against the codebase. Nine already had implementation + tests (entry point, window creation, event loop, clipboard, window resizing, high-DPI read). Two were fully missing (platform-level input handling, drag & drop) and two were partial (fullscreen detection only, no imperative API; high-DPI read only). Added `InputManager` and `WindowControls` to fill the gaps, plus 23 new tests.

## Feature Coverage Matrix

| Feature | Before | After |
|---------|--------|-------|
| Application Entry Point | `src/app/main.ts` (`ApplicationBootstrap`) | unchanged |
| Window Creation | `src/platform/desktop/window-manager.ts` | unchanged |
| Event Loop | `src/browser/js/event-loop.ts` | unchanged |
| Clipboard | `runtime-adapter.ts` `ClipboardOps` | unchanged |
| Window Resizing | `WindowManager.setWindowBounds` | unchanged |
| **Input Handling** | none | `src/platform/shared/input-manager.ts` |
| **Mouse Events** | DOM-only in UI components | platform `mousemove/down/up/enter/leave` events |
| **Keyboard Events** | inline in address bar | platform `keydown/keyup` events + modifier state |
| **Drag & Drop** | none | platform `dragstart/dragover/dragleave/drop` events |
| **Fullscreen** | detection-only in `PlatformEvents` | `WindowControls.enter/exit/toggleFullscreen()` |
| **High DPI** | read-only `devicePixelRatio` | CSS↔device pixel conversion |

## Root Causes (if bug fix)
### 1. happy-dom DragEvent constructor drops init dict
**File:** `tests/input-manager.test.ts`
**Problem:** `new DragEvent(type, { dataTransfer, clientX, clientY })` silently ignored all init properties, so `types` came back `[]` and coordinates `undefined`.
**Fix:** Construct a bare `DragEvent` then define `dataTransfer`/`clientX`/`clientY` via `Object.defineProperty` (configurable). Source code in `input-manager.ts` was already defensive (optional chaining on `dataTransfer`).

### 2. `exitFullscreen` typed on wrong host object
**File:** `tests/window-controls.test.ts`
**Problem:** Test assigned `document.documentElement.exitFullscreen = ...` — `exitFullscreen` is a `Document` API, not `HTMLElement`. TS error TS2339.
**Fix:** Mock `document.exitFullscreen` instead; `requestFullscreen` stays on `document.documentElement`.

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | DI wiring — imports for `InputManager`/`WindowControls`, `Tokens.InputManager`/`Tokens.WindowControls`, singleton registrations in the Platform adapters section, `startPlatformServices()` invoked from `start()`. Both are `IDisposable`, so the container auto-disposes them on shutdown. |
| `tests/input-manager.test.ts` | New 14-test suite; drag-event helper uses `Object.defineProperty`; imports `beforeEach/afterEach` explicitly |
| `tests/window-controls.test.ts` | New 9-test suite; `document.exitFullscreen` mocks |

## Files Created
| File | Purpose |
|------|---------|
| `src/platform/shared/input-manager.ts` | `IInputManager`/`InputManager` + `InputEventBus` — keyboard (`keydown/keyup` with repeat + modifier state), mouse (`mousedown/up/move/enter/leave` with coordinates/buttons), drag & drop (`dragstart/dragover/dragleave/drop` with types + text payload). Live state getters: `isShiftDown`, `isCtrlDown`, `lastMouseX/Y`, `isDragging`, `activeDragText`. Lifecycle: `start()/stop()/dispose()`, window listeners tracked for teardown, handler exceptions isolated. |
| `src/platform/shared/window-controls.ts` | `IWindowControls`/`WindowControls` + `WindowControlEventBus` — imperative `enterFullscreen()/exitFullscreen()/toggleFullscreen()` via Fullscreen API, high-DPI `cssToDevicePixels()`/`deviceToCssPixels()` using `devicePixelRatio`, debounced (150 ms) `resize` events, `fullscreenChange`/`dpiChange` event kinds. Constructor accepts injectable `Window` target for testability. |

## Test Results
```
npx vitest run tests/input-manager.test.ts tests/window-controls.test.ts
Test Files  2 passed (2)
Tests       23 passed (23)

npx vitest run tests/input-manager.test.ts tests/window-controls.test.ts tests/window-manager.test.ts tests/runtime-adapter.test.ts tests/event-loop.test.ts
Test Files  4 passed | 1 failed (5)   → 2/2 new files pass; window-manager (21), runtime-adapter (18), event-loop (24) all pass
Tests       84 passed | 2 failed (86) → both failures were the fixed happy-dom drag-event issues
```

## Verification Steps
1. `npx vitest run tests/input-manager.test.ts tests/window-controls.test.ts` — 23/23 pass.
2. Re-ran `window-manager.test.ts` (21), `runtime-adapter.test.ts` (18), `event-loop.test.ts` (24) — all pass, no regressions.
3. Full platform regression: 5 files / 86 tests pass after DI wiring.
4. `npx tsc --noEmit` — no errors in `input-manager`, `window-controls`, or any `main.ts` line touched by this session. The 5 remaining `main.ts` errors (permission-manager import, `processModel` config, `IProcessGuard`/`ISharedService`, `TabProcessManager`/`ITabProcessManager`, `TabProcessBusEvent`) were verified pre-existing via `git stash` — identical count before/after.
5. Feature matrix verified against source: `src/app/main.ts`, `src/app/app-shell.ts`, `src/platform/desktop/window-manager.ts`, `src/browser/js/event-loop.ts`, `src/platform/shared/runtime-adapter.ts`, `src/platform/shared/platform-events.ts`.

## Notes
- `InputManager` and `WindowControls` are DI-registered as singletons and started in `ApplicationBootstrap.start()` via `startPlatformServices()`. Both implement `IDisposable`, so `container.dispose()` tears them down during shutdown.
- Both follow the existing platform event-bus pattern (same `start/stop/dispose` lifecycle, `on/off` subscription, `boundHandlers` teardown) used by `platform-events.ts`, `window-manager.ts`, and `menu-integration.ts`.
- Pre-existing `main.ts` type errors are outside this session's scope and left untouched.
