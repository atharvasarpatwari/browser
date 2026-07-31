# Structural Cleanup: Rename, Cycle-Break, Dead-Code Audit, Type Inversion

**Date:** 2026-07-31
**Session:** Resolve the structural placement issues found in the code-map audit.
**Status:** Completed

---

## Summary
Fixed four structural issues from the placement audit: renamed the misspelled `netwroking/` directory to `networking/`, broke the app↔platform circular import by moving `BrowserWindow` into the platform layer, deleted verified-stale cross-process proxy scaffolding, and moved shared privilege types into `common/types/` to remove the common→browser type inversion.

## Changes

### 1. `netwroking/` → `networking/` rename
**Problem:** Directory `src/browser/netwroking/` was misspelled; `security/cors.ts` imported `'../networking/request-manager'` (silently broken type import).
**Fix:** `git mv` the directory (26 files) and bulk-replaced `netwroking` → `networking` in all 45 referencing files (src headers/imports + tests), UTF-8 preserved.

### 2. app↔platform circular import broken
**File:** `src/platform/desktop/window-manager.ts:3` imported the runtime value `BrowserWindow` from `'../../app/app-shell'` while `main.ts` (app) imports `WindowManager` from platform — a runtime cycle.
**Fix:** Moved `IWindow` + `BrowserWindow` into the platform layer:
- **Created** `src/platform/desktop/browser-window.ts` (class moved verbatim, self-contained — no app imports)
- `window-manager.ts` now imports from `./browser-window`
- `app-shell.ts` imports from `../platform/desktop/browser-window` (correct downward direction) and re-exports `BrowserWindow`/`IWindow` for backward compatibility

Result: platform→app imports are now type-only (`IDisposable`), no runtime cycle.

### 3. Dead-code audit — findings corrected, stale scaffolding deleted
**Problem:** Audit claimed `media/`, `web-apis/`, `native/`, `renderer-entry.ts`, and cross-process proxies were dead. **Verification disproved 4 of 5:**
- `src/browser/media/` — **46 importers** (tests + `rendering/compositing/animation-engine.ts`) → kept
- `src/browser/web-apis/` — imported by `tests/web-apis-permissions.test.ts` → kept
- `src/native/` — imported by `tests/native/native-bindings.test.ts` → kept
- `src/process/renderer-entry.ts` — referenced by `process-model.ts` `rendererEntryPath` (runtime config) → kept (its broken internal imports are pre-existing, tracked)
- **Deleted** the two cross-process proxies — they implement invented interfaces (real `IPageLoader`/`IPageRenderer` live in `browser-engine.ts` with different signatures) and misuse the real `IChannel.request(payload, timeoutMs)` API as `request(topic, payload)`. 8 type errors, no src importers.

Deleted:
| File | Reason |
|------|--------|
| `src/common/ipc/cross-process-page-loader.ts` | Stale proxy, invented interface, broken channel API usage |
| `src/common/ipc/cross-process-page-renderer.ts` | Same |
| `tests/ipc/cross-process-proxies.test.ts` | Tested only the stale contract with mocked channels |
| Cross-process subscribe tests in `tests/ipc-advanced.test.ts` | Integration tests for the deleted proxy |

### 4. common→browser type inversion fixed
**File:** `src/common/ipc/capability-gate.ts:27` imported `PrivilegeLevel`, `ApiSurface` from `browser/security/privilege-levels` (upward dependency from common).
**Fix:** Extracted the two types into **`src/common/types/privilege.ts`** (populating the previously-empty `common/types/` dir):
- `privilege-levels.ts` imports them and re-exports `export type { PrivilegeLevel, ApiSurface } from '../../common/types/privilege'` — all ~20 existing importers unaffected
- `capability-gate.ts` now imports from `../types/privilege`
- Verified: **zero** `src/common/**` imports reference `../browser` anymore

## Files Created
| File | Purpose |
|------|---------|
| `src/platform/desktop/browser-window.ts` | `IWindow` + `BrowserWindow` (platform-owned) |
| `src/common/types/privilege.ts` | Shared `PrivilegeLevel` + `ApiSurface` types |

## Files Deleted
| File | Purpose |
|------|---------|
| `src/common/ipc/cross-process-page-loader.ts` | Stale proxy |
| `src/common/ipc/cross-process-page-renderer.ts` | Stale proxy |
| `tests/ipc/cross-process-proxies.test.ts` | Proxy tests |
| `src/browser/netwroking/*` (26 files) | Renamed to `src/browser/networking/*` |

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/*` (26 files) | Header `netwroking` → `networking` |
| 5 src importers (main.ts, devtools-facade.ts, page-loader.ts, page-renderer.ts, router.ts, lazy-loader.ts) | `netwroking` → `networking` |
| 36 test files | `netwroking` → `networking` import paths |
| `src/platform/desktop/window-manager.ts` | Imports `BrowserWindow`/`IWindow` from `./browser-window` |
| `src/app/app-shell.ts` | Removed local `IWindow`/`BrowserWindow`, imports + re-exports from platform |
| `src/browser/security/privilege-levels.ts` | Types imported from `common/types/privilege`, re-exported |
| `src/common/ipc/capability-gate.ts` | Imports types from `../types/privilege` |
| `src/browser/engine/task-manager.ts` | (from prior audit session) `IDisposable`/`ISharedService` import fixed |
| `tests/ipc-advanced.test.ts` | Removed stale proxy tests |

## Test Results
```
Test Files  21 passed (21)
     Tests  956 passed (956)

Key suites: networking-features, resource-loader, firewall, cors, redirect-handler,
http-protocol, ip-protocol, cache-control, devtools, window-manager, input-manager,
window-controls, capability-gate, ipc, ipc-advanced, child-process-transport,
security, site-isolation, sandbox, preload, process-isolator, process-model
```

## Verification Steps
1. Grep: zero `netwroking` references remain; zero `src/common/**` → `../browser` imports remain; zero `CrossProcessPage*` references remain.
2. `tsc --noEmit`: no errors in any file touched this session; removed ~10 pre-existing errors (cors.ts, task-manager.ts import, 8 in deleted proxies). Remaining 865 errors are a pre-existing baseline in untouched code (verified `privilege-levels.ts:246` and `renderer-entry-sandboxed.ts:141` candidates are in unmodified code).
3. 956 tests pass across 21 affected suites.
