# The Windows App Couldn't Be Packaged at All — `electron` Was a Range, Not a Version

**Date:** 2026-09-19
**Session:** Asked to test and repair the Windows app until it opens. Dev mode (`electron .` against the Vite dev server) already opened cleanly, so went straight for the harder, more real-world bar: build the actual packaged `.exe` an end user would run, and launch that.
**Status:** Completed

---

## Summary
`npm run build:win` (`vite build && electron-builder --win`) never got past the packaging step: electron-builder refused to run at all, with `Cannot compute electron version from installed node modules — version ("^41.7.1") is not fixed in project`. `package.json`'s `electron` devDependency was declared as a semver range (`^41.7.1`) instead of an exact version — electron-builder needs to know precisely which Electron release to download and bundle into the app, and a range doesn't resolve to one without `node_modules` present locally to read the actual installed version back out of (which this worktree's `node_modules` doesn't have — dependencies resolve via Node's own upward directory walk to the main checkout instead). Pinned the dependency to the exact installed version (`41.7.1`, confirmed via `require('electron/package.json').version`), matching electron-builder's own documented requirement and the standard convention every real Electron project template follows for exactly this reason.

With that fixed, the full pipeline ran clean: `vite build` → `electron-builder --win --dir` → a real `Nova Browser.exe` (223 MB, fully packaged with Chromium, V8, and all native modules) → launched directly, no dev server, no `VITE_DEV_SERVER_URL` — and reached a fully mounted, responsive state confirmed via the app's own health log (`ALIVE, mounted:true, readyState:complete`), with all four of its normal Electron processes (main, renderer, GPU, utility) still running stably afterward.

## Root Causes

1. **`electron` was pinned as a range, and electron-builder cannot work with one.** A semver range like `^41.7.1` is exactly the right way to declare most dependencies (get patch/minor updates automatically), but Electron packaging is the one place that breaks: electron-builder has to download a specific, exact Electron binary distribution to embed in the app, and a range gives it nothing to resolve without a populated `node_modules` to fall back on. This wasn't just a warning — the build (`npm run build:win`/`pack:win`) failed immediately, before doing any work at all, meaning the Windows app could not be packaged into anything runnable straight from a clean checkout. Fixed by pinning the exact version already in use.

## Notes
- Verified genuinely end-to-end rather than trusting the build log alone: after the packaged `.exe` launched, confirmed via `nova-health.log` (written to the app's own `userData` directory when running unpackaged-path code, i.e. the real production code path, not the dev shortcut) that it reached `mounted:true` and stayed continuously alive, and separately confirmed via `tasklist` that all of its child processes were still running (not crashed/zombied) several seconds later.
- One log line during the packaged run is expected, not a bug: `AUTO_UPDATE_UNAVAILABLE error=Cannot find module 'electron-updater'` — `electron-updater` isn't a project dependency yet, and `setupAutoUpdater()` already has an explicit try/catch specifically for this case (see its own comment: "may not be installed yet in every checkout... never let this block app startup"). It logged and the app kept running exactly as designed.
- Did not build or test the full NSIS installer (`electron-builder --win` without `--dir`) — that step mainly exercises installer-specific concerns (registry entries, Start Menu shortcuts, uninstaller) layered on top of the exact same packaged output already verified working here, and takes meaningfully longer to produce. The `--dir` build answers the actual question ("does the packaged app open") completely on its own.
- Deleted the `release/`, `dist/`, and generated `nova-health.log` build artifacts from this verification pass afterward — `release/` was already gitignored, so nothing needed cleaning up there for git's sake, but a 223 MB scratch build has no reason to stick around on disk.

## Files Modified
| File | Change |
|------|--------|
| `package.json` | `electron` devDependency pinned from `^41.7.1` to the exact `41.7.1` already installed — required for electron-builder to resolve which binary to package |

## Files Created
- `doc/2026-09-19-windows-packaged-build-electron-version-pin.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                    → 0 errors (repo-wide, unaffected by this change)
node --check electron/main.cjs                           → syntax OK
npm run dev + npx electron .  (dev mode)                 → opened, reached ALIVE/mounted within ~20s
npm run build:web + electron-builder --win --dir (packaged) → built and launched successfully after the fix
```

## Verification Steps
1. Launched the app in dev mode first (`npm run dev` + `VITE_DEV_SERVER_URL=... npx electron .`) and confirmed via `nova-health.log` it reaches a continuously `ALIVE` state — this path already worked before today's session started.
2. Went for the harder, real-world bar: ran `npx vite build` (succeeded, 307 modules) then `npx electron-builder --win --dir`, which failed immediately with the version-range error before doing any packaging work.
3. Confirmed the actual installed Electron version (`41.7.1`) and pinned `package.json`'s `electron` field to it exactly.
4. Reran `electron-builder --win --dir` — it completed successfully this time, producing `release/win-unpacked/Nova Browser.exe`.
5. Launched the packaged `.exe` directly (no dev server, no env vars) and confirmed via its `nova-health.log` (in the real `userData` directory, not the project root used in dev) that it reached `mounted:true, readyState:complete` and stayed alive.
6. Confirmed via `tasklist` several seconds later that all of its Electron sub-processes (main/renderer/GPU/utility) were still running, not crashed.
7. Cleaned up the packaged build output, health logs, and killed the test process.
