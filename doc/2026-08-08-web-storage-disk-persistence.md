# Web Storage Disk Persistence + Electron Host Injection

**Date:** 2026-08-08
**Session:** Phase 1 — page web storage (localStorage/IndexedDB) persisted to disk; Electron host injects the storage dir into the renderer
**Status:** Completed

---

## Summary

Made page web storage (localStorage **and** IndexedDB) survive restarts: added a `DiskIndexedDBBackend` (per-origin JSON files) for IndexedDB, threaded a `storageDir` through `runJS`/`createGlobalEnv`/`bindStorageAPIs` into `PageRenderer`, and had the Electron host inject the storage directory into the renderer. Also resolved the preload root cause (see below).

## Root Causes

### 1. Electron preload never executed in the real app
**File:** `electron/main.cjs`, `electron/preload.cjs` (created then deleted)
**Problem:** `__NOVA_STORAGE_DIR` stayed undefined in the launched window even though the `preload` path existed, `node --check` passed, and no `preload-error` fired. A minimal repro app with identical `webPreferences` flags *did* run the preload.

**Fix:** Binary-search debugging narrowed it to the preload *body*. Test showed `require('electron')`/`require('path')` work in the preload, but `app.getPath('userData')` **throws**:
```
PRE=set            ← global set on line 1 of try block
PRE_DIR=UNDEFINED  ← path.join(app.getPath('userData'), 'x') threw (caught)
```
**Root cause:** `app` is a **main-process-only** module. The preload runs in the *renderer* process where `require('electron').app` is `undefined`, so `app.getPath` throws. The original try/catch swallowed it silently — preload ran, but set nothing.

**Fix:** Removed the preload entirely. `main.cjs` now injects the dir via `webPreferences.additionalArguments`:
```js
additionalArguments: [`--nova-storage-dir=${path.join(app.getPath('userData'), 'web-storage')}`],
```
`main.ts` reads it defensively from the renderer's `process.argv` (available because `nodeIntegration: true`), falling back to `undefined` (in-memory) on web/Android hosts where `process` is absent.

### 2. IndexedDB only existed in memory
**File:** `src/browser/storage/indexed-db.ts`
**Problem:** IndexedDB was backed solely by `InMemoryIndexedDBBackend` — every restart lost all object stores.
**Fix:** Added `DiskIndexedDBBackend implements IIndexedDBBackend`, mirroring the existing `DiskStorageBackend` (localStorage) pattern. Per-origin JSON files `<base>/indexeddb-<sanitized-origin>-<sanitized-name>.json`, Node-only via lazy `require('node:fs')`, silent no-op fallback in browser/Android, never throws. `sanitize()` maps origin/name to safe filenames.

### 3. Storage dir never reached the page-storage layer
**File:** `src/browser/js/index.ts`, `src/browser/js/web-storage-bindings.ts`, `src/browser/engine/page-renderer.ts`, `src/app/main.ts`
**Problem:** `bindStorageAPIs` was always called without a disk path → in-memory backends only.
**Fix:** `RunJSOptions` gained `storageDir`; `runJS` forwards it to `createGlobalEnv` (new 10th positional param) → `bindStorageAPIs({ ..., diskPath: storageDir })`. `bindStorageAPIs` falls back to `new DiskIndexedDBBackend(diskPath)` when no explicit backend. `PageRendererDependencies` gained optional `storageDir`, passed to all 3 `runJS` call sites (blocking/defer/async). `main.ts` resolves the dir from `--nova-storage-dir=` in argv (string check, else `undefined`).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/storage/indexed-db.ts` | `DiskIndexedDBBackend` added after `InMemoryIndexedDBBackend` |
| `src/browser/js/web-storage-bindings.ts` | Import/export `DiskIndexedDBBackend`; `diskPath` fallback in `bindStorageAPIs` |
| `src/browser/js/index.ts` | `RunJSOptions.storageDir`; forwarded through `runJS` → `createGlobalEnv` (10th param) → `bindStorageAPIs` |
| `src/browser/engine/page-renderer.ts` | Optional `storageDir` dep; passed to all 3 `runJS` calls |
| `src/app/main.ts` | Resolves `webStorageDir` from `--nova-storage-dir=` argv flag (replaces `__NOVA_STORAGE_DIR` global read) |
| `electron/main.cjs` | `additionalArguments: ['--nova-storage-dir=...']`; removed TEMP debug listeners + TEMP `data:` `loadURL`, restored `loadFile(dist/index.html)`; removed `sandbox:false`/`preload` |

## Files Created
| File | Purpose |
|------|--------|
| `electron/preload.cjs` | Created then **deleted** after root cause found (main-only `app` unusable in renderer) |
| `tests/indexed-db-disk-backend.test.ts` | 7 backend tests: persist/load, origin isolation, missing→null, list, delete, fresh-instance restart, JSON file on disk |

## Test Results
```
targeted: bindings 9/9 · indexed-db-disk 7/7 · page-renderer/js-builtins/integration/local-storage/storage 245/245
typecheck: tsc --noEmit clean (globalThis argv access typed via local const cast, no TS7017)
full suite: 190 files / 8693/8693 pass (baseline 8684 + 9 new)
e2e:       npx playwright test --config=playwright-electron.config.cjs → 2 passed
verify:    node verify-storage.tmp.cjs (then deleted) → ARGV_DIR=C:\Users\athar\AppData\Roaming\Nova Browser\web-storage
```

## Verification Steps
1. `npm run typecheck` — clean.
2. `npm test` — 8693/8693, exit 0.
3. `npm run build:web` — bundled, then Playwright `_electron.launch({ args: ['.'] })`:
   - Health probe OK (`ok:true, running:true, mounted:true`).
   - `process.argv` in the renderer contains `--nova-storage-dir=C:\Users\athar\AppData\Roaming\Nova Browser\web-storage` — matches `main.ts` parsing.
4. Electron e2e — `electron-smoke` (7.4s) + `keep-alive` (15.0s) both pass.
5. Temp artifacts removed: `verify-storage.tmp.cjs`, `.tmp-electron-test/`, `electron/preload.cjs`.

## Notes
- Chrome-style single storage dir for both localStorage and IndexedDB.
- Existing callers of `createGlobalEnv` without `storageDir` (all pre-existing tests) keep the in-memory default.
- Disk backends are Node-only (lazy `require('node:fs')`); web/Android hosts silently stay in-memory (Android WebView/WebKit host storage is out of the engine's control by design).
