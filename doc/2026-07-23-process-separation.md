# Renderer/Browser Process Separation

**Date:** 2026-07-23
**Session:** Process isolation architecture for renderer/browser separation
**Status:** Completed

---

## Summary

Implemented renderer/browser process separation infrastructure, enabling the browser to run renderer processes in isolated child processes using Node.js `child_process.fork()`. The system supports three isolation modes: single-process (default), per-tab, and per-domain. All new code includes comprehensive tests (51 new tests across 3 files).

## Files Created

| File | Purpose |
|------|---------|
| `src/common/ipc/child-process-transport.ts` | IPC transport using `child_process.fork()` IPC channel |
| `src/process/renderer-entry.ts` | Entry point script for renderer child processes |
| `src/common/ipc/cross-process-page-loader.ts` | IPC proxy implementing IPageLoader for cross-process page loading |
| `src/common/ipc/cross-process-page-renderer.ts` | IPC proxy implementing IPageRenderer for cross-process rendering |
| `src/app/config/process-model.ts` | Process model configuration (isolation modes, limits, timeouts) |
| `tests/ipc/child-process-transport.test.ts` | 19 tests for ChildProcessTransport |
| `tests/ipc/cross-process-proxies.test.ts` | 15 tests for cross-process proxies |
| `tests/config/process-model.test.ts` | 17 tests for process model config |

## Files Modified

| File | Change |
|------|--------|
| `src/app/app-shell.ts` | Added `processModel` field to AppConfig, imported ProcessModelConfig |
| `src/common/ipc/process-manager.ts` | Added `createChildProcessManager()` factory function |
| `src/browser/engine/tab-process-adapter.ts` | Added `createChildProcessTabManager()` convenience function |
| `src/app/main.ts` | Updated `wireTabProcessManager()` to select process mode based on config |

## Architecture

### Process Isolation Modes

| Mode | Description | Memory | Security | IPC Overhead |
|------|-------------|--------|----------|--------------|
| `none` | Single process (default) | Low | Low | None |
| `per-tab` | Each tab gets its own renderer process | Medium | High | Medium |
| `per-domain` | Tabs from different domains get separate processes | High | Highest | High |

### How It Works

1. **Config-driven**: `AppConfig.processModel.isolationMode` controls the mode
2. **Factory pattern**: `ProcessManager` uses a `ProcessFactory` to spawn processes
   - `InProcessFactory` → `InProcessTransport` (single-process mode)
   - `ChildProcessFactory` → `ChildProcessTransport.fork()` (multi-process mode)
3. **main.ts selection**: `wireTabProcessManager()` checks `processModel.enableRendererIsolation` and creates the appropriate manager
4. **IPC proxies**: `CrossProcessPageLoader` and `CrossProcessPageRenderer` forward operations to the renderer process via IPC channels
5. **Renderer entry**: `renderer-entry.ts` runs in child processes, receives IPC messages, handles render/layout/paint commands

### Key Components

- **ChildProcessTransport**: Wraps Node.js `child_process.fork()` IPC channel, implements `ITransport`
- **RendererProcess** (in `renderer-entry.ts`): Handles render, layout, paint, DOM update, viewport, and script execution commands
- **CrossProcess proxies**: Transparent proxies that implement existing interfaces (`IPageLoader`, `IPageRenderer`) but forward via IPC

## Test Results

```
51 passed (51)
  tests/ipc/child-process-transport.test.ts: 19 passed
  tests/ipc/cross-process-proxies.test.ts: 15 passed
  tests/config/process-model.test.ts: 17 passed

Full suite: 4754 passed, 3 failed (pre-existing DNS timeouts)
```

## Verification

1. All 51 new tests pass
2. Full suite at 4754 passed (up from 4703)
3. Default mode (`isolationMode: 'none'`) preserves existing behavior
4. `NOVA_PROCESS_ISOLATION` env var can switch modes without code changes
5. AppShell config type updated to include `processModel` field
