# Electron Launch Implementation

**Date:** 2026-07-31
**Session:** Electron shell, NSIS packaging, CI release workflow, and bootstrap bug fixes
**Status:** Completed

---

## Summary

Shipped Nova Browser as an unsigned public Windows desktop app: an Electron shell loading the Vite-built UI, an NSIS installer via electron-builder, and a tag-triggered GitHub Actions release workflow. Fixed the pre-existing bootstrap and navigation-routing bugs that broke the app under real Electron, and diagnosed a workspace-level file-lock issue that blocked in-place packaging.

## Root Causes

### 1. `npm run pack:win` failed with `EPERM`/`EBUSY` on `release\win-unpacked.tmp`
**File:** `E:\nova_1\release\` (environment issue, not source)
**Problem:** electron-builder's extraction into `win-unpacked.tmp` and its rename to `win-unpacked` failed with `EPERM: operation not permitted, rename` and `EBUSY: resource busy or locked, unlink default_app.asar`. A leftover `.tmp` from a crashed run could not be deleted (`Access denied`), and builds to any directory inside `E:\nova_1` failed while builds to `%TEMP%` succeeded.
**Fix:** The lockholder was identified with the Windows Restart Manager API (`rstrtmgr.dll` → `RmStartSession`/`RmRegisterResources`/`RmGetList`): **VS Code's extension host** (`Code.exe --type=utility --utility-sub-type=node.mojom.NodeService`, PID 7232) held a handle on `default_app.asar` for ~20 hours, and VS Code's recursive watcher re-locked newly extracted directories inside the workspace. A window reload did not drop it, so the extension host was killed (`Stop-Process`), which freed the stale `.tmp`. `E:\nova_1\.vscode\settings.json` now excludes `**/release/**`, `**/dist/**`, `**/node_modules/**` from VS Code's file watcher so future packaging is not re-locked.

### 2. Bootstrap crashes under real Electron
**Files:** `src/browser/engine/process-guard.ts`, `src/app/main.ts`, `src/ui/pages/browser-window.ts`
**Problem:** `IProcessGuard` had no `initialize`/`shutdown` implementations, `ConfigLoader.load()` dropped defaults instead of spreading `DEFAULT_CONFIG`, and `mount()` in `browser-window.ts` had a broken structure (hoisting, tab-persistence ordering, `tabClosed` switch case).
**Fix:** Added `initialize()`/`shutdown()` on `IProcessGuard`; `ConfigLoader.load()` spreads `DEFAULT_CONFIG`; `mount()` re-hoisted `areas`, moved tab-persistence to top level, fixed the `tabClosed` case, and made `createTab()` conditional.

### 3. Navigation routing never reached the DI-delivered engine
**File:** `src/ui/pages/browser-window.ts`, `src/ui/components/navigation-bridge.ts`
**Problem:** `mount()` built the `NavigationBridge`/`NavigationFetcher` with a **local** `NavigationController`, while the DI-delivered controller (wired to engine, history, CSP) was handed over later via `setNavigationController`, which only stored it — so typed URLs never reached the real engine.
**Fix:** `syncNavigationPipeline()` (replaces `tryCreateNavigationFetcher`) disposes the stale pipeline and rebuilds `NavigationBridge` + `NavigationFetcher` around the DI controller; the fallback local controller is cached in `localController`. `NavigationBridge` now stores handlers as fields and `dispose()` unsubscribes all events.

### 4. Stale UI after bridge-driven navigation
**File:** `src/ui/pages/browser-window.ts`
**Problem:** Bridge-driven navigations bypass `tabManager` events, so tab strip and address bar stayed stale.
**Fix:** `syncAll()` also pushes `addressBarView.update(...)`; the pipeline subscribes bridge `urlNavigated` → `syncAll()` via `onBridgeUrlNavigated`.

### 5. Tracker blocker blocked every URL
**File:** `src/browser/security/tracker-blocker.ts`
**Problem:** `hostname + path.includes(ruleDomain)` evaluated as string concat + boolean → always truthy, so **every** URL matched `facebook.com/tr` (category "tracker") and main pages were blocked.
**Fix:** Re-parenthesized into `const urlWithPath = hostname + path;` with `===`/`.includes` checks. Verified example.com/github.com pass; google-analytics.com + facebook.com/tr still blocked.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/process-guard.ts` | Added `initialize()`/`shutdown()` to `IProcessGuard` |
| `src/app/main.ts` | `ConfigLoader.load()` spreads `DEFAULT_CONFIG` |
| `src/ui/pages/browser-window.ts` | Fixed `mount()`; `syncNavigationPipeline()` rebuilds bridge/fetcher around DI controller; `syncAll()` updates address bar; `onBridgeUrlNavigated` subscription |
| `src/ui/components/navigation-bridge.ts` | Handler fields (`toolbarHandler`, `addressBarHandler`, `navHandler`, `tabManagerHandler`); full unsubscribe in `dispose()` |
| `src/browser/security/tracker-blocker.ts` | Fixed operator-precedence bug in `matchRule` path-rule branch |
| `vite.config.ts` | `base: './'` so the packaged app resolves assets from file:// |
| `electron-builder.yml` | NSIS target, `release/` output, artifact name `"${productName} Setup ${version}.${ext}"` |
| `package.json` | Scripts: `electron:dev`, `electron:start`, `pack:win`, `build:win`, `test:electron` |
| `.vscode/settings.json` | Exclude `release/`, `dist/`, `node_modules/` from VS Code watcher/search (fixes packaging file locks) |

## Files Created
| File | Purpose |
|------|---------|
| `electron/main.cjs` | Electron main process — loads built `dist/index.html`, creates `BrowserWindow` |
| `build/icon.png` | 256×256 app icon for the installer |
| `tests/e2e/electron-smoke.spec.ts` | Playwright `_electron` smoke test (launches app, asserts window) |
| `playwright-electron.config.cjs` | Playwright config for the Electron smoke test |
| `.github/workflows/release.yml` | Tag-triggered (`v*`) release — windows-latest, `npm ci` + `npm run build:win`, uploads `release/*.exe`, `*.blockmap`, `latest.yml` to GitHub Release via `softprops/action-gh-release@v2` |

## Test Results
```
tests/e2e/electron-smoke.spec.ts: passed (4-6s)   — app launches, window created
tsc --noEmit: delta clean (only pre-existing browser-window.ts:1034 setService on IBookmarkBar)
7 targeted vitest suites: 292 passed
  incl. navigation-bridge (25), ad-blocker (171), tracker-blocker (shape-tested)
Debug run: real 200 https://example.com/, canvas render, tab text example.com, address https://example.com/

npm run pack:win  -> release/win-unpacked/Nova Browser.exe (223MB)   OK
npm run build:win -> release/Nova Browser Setup 1.0.0.exe (97.7MB)   OK
Launch: packaged app runs with main + GPU + network + renderer processes, window title "Nova Browser"
```

## Verification Steps
1. `npm run pack:win` succeeded in-place after clearing the VS Code-held lock.
2. `npm run build:win` produced the NSIS installer in `release/`.
3. Launched `release/win-unpacked/Nova Browser.exe` — 4 processes spawned, window rendered, no early exit.
4. Release workflow written but not yet executed (requires a `v*` tag push to GitHub).

## Notes / Tradeoffs (per approved plan)
- MVP is unsigned: `webSecurity: false`, `nodeIntegration: true`, `contextIsolation: false` — hardening deferred to a post-MVP session.
- Native Rust bindings are not shipped in v1; the Electron shell hosts the DOM/canvas UI unchanged.
- `dist/` and `release/` remain gitignored; CI regenerates both.
