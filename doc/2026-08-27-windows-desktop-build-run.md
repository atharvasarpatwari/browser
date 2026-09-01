# Windows Desktop Build — Installer & Launch

**Date:** 2026-08-27
**Session:** Build, install, and run Nova Browser as a native Windows application (NSIS installer), verifying the packaged app boots and stays healthy.
**Status:** Completed

---

## Summary

Produced a real Windows installer (`release/Nova Browser Setup 1.0.0.exe`), installed it silently, launched it, and confirmed the packaged app runs with the Nova UI mounted and responding. One source bug surfaced during verification and was fixed: the packaged app silently failed to write its health log.

## Root Causes

### 1. Health log silently lost in packaged builds
**File:** `electron/main.cjs:11` (and `writeHealthLog` at former line 35)
**Problem:** `HEALTH_LOG_PATH` was a module constant set to `path.join(__dirname, '..', 'nova-health.log')`. In a packaged build `__dirname` resolves inside the read-only `resources/app.asar`, so every `fs.appendFileSync` failed. The failure was wrapped in try/catch (by design — "keep running"), so the app ran fine but produced **no** health log, contradicting `INSTALL.md`'s claim that it lands next to the installed app.
**Fix:** Replaced the module constant with a lazy `healthLogPath()` getter that resolves to `app.getPath('userData')/nova-health.log` when `app.isPackaged` is true (falling back to the previous project-relative path otherwise). `app.getPath('userData')` is only valid after `app` is ready, hence the lazy call inside the write helper.
```js
function healthLogPath() {
  if (app.isPackaged) {
    try {
      return path.join(app.getPath('userData'), 'nova-health.log')
    } catch {
      return path.join(__dirname, '..', 'nova-health.log')
    }
  }
  return path.join(__dirname, '..', 'nova-health.log')
}
// writeHealthLog now calls fs.appendFileSync(healthLogPath(), line)
```
**Verification:** Rebuilt the installer, reinstalled, launched — the log now appears at `C:\Users\athar\AppData\Roaming\Nova Browser\nova-health.log` with repeated `ALIVE` probes.

### 2. Stale lockfile blocked `npm ci`
**File:** `package-lock.json`
**Problem:** The lockfile (last modified 2026-08-07) predated the 2026-08-27 addition of `electron-updater`, so `npm ci` failed with `Missing: electron-updater@6.8.9 from lock file` (plus its transitive deps).
**Fix:** Ran `npm install` instead, which added the missing tree to the lockfile and installed the packages (6 added). First run exited 0. Note: showed `EBADENGINE` warnings because the repo targets node >=22 while the machine runs node v20.19.1 — non-fatal for this task.

## Files Modified

| File | Change |
|------|--------|
| `electron/main.cjs` | Health-log path now resolves into `app.getPath('userData')` when packaged (root cause #1) |
| `package-lock.json` | Regenerated to include the `electron-updater` dependency tree (root cause #2) |

## Files Created

| File | Purpose |
|------|---------|
| `release/Nova Browser Setup 1.0.0.exe` | NSIS x64 installer (93 MB) + `.blockmap`, `latest.yml` |
| `release/win-unpacked/` | Unpacked app (for direct run / smoke test) |
| `doc/2026-08-27-windows-desktop-build-run.md` | This change log |

## Test Results

```
$ npm install                     → exit 0 (lockfile regenerated, electron-updater installed)
$ npm run build:web               → 289 modules, built in ~8s, exit 0
$ npm run build:win               → vite build + electron-builder --win, nsis target, exit 0
  artifact: release\Nova Browser Setup 1.0.0.exe (93.24 MB)
$ <installer> /S                  → exit 0; app at C:\Users\athar\AppData\Local\Programs\Nova Browser\
$ Nova Browser.exe                → launches, window titled "Nova Browser", 4 processes, all Responding
```

Health log (packaged instance) after fix:
```
[2026-08-27T15:41:13.780Z] ALIVE probe={"ok":true,"running":true,"mounted":true,"uptimeMs":13707,"title":"Nova Browser","readyState":"complete"}
```
(Also observed the watchdog auto-recover from a forced-kill: `UNRESPONSIVE reason=timeout` → `LOAD_FAILED` → `ALIVE` resumed — crash resilience working in the packaged build.)

## Verification Steps

1. `npm install` to unblock the stale-lockfile install; electron-updater present and lockfile updated.
2. `npm run build:web` — clean renderer bundle.
3. `npm run build:win` — NSIS installer + unpacked app produced.
4. Silent-installed (`/S`) — exit 0; installed exe present.
5. Launched installed app — main window "Nova Browser" + renderer/GPU child processes, all responsive.
6. Confirmed health log now written to `AppData\Roaming\Nova Browser\nova-health.log` with `ALIVE` probes (fix #1).
7. Closed the running instance.

## Known Caveats (unchanged, documented elsewhere)

- Installer is **unsigned** → Windows SmartScreen "Protected your PC" → *More info → Run anyway* (see `INSTALL.md`).
- Auto-update will skip until a real GitHub tag exists (guarded in `main.cjs`).
- Node v20 vs repo-expected >=22 (EBADENGINE warnings only; build/run unaffected).
