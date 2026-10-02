# Packaged Windows Build Verified — But electron-updater Was Silently Dead in Every Platform's Installer

**Date:** 2026-09-24
**Session:** Asked to improve the Windows app; picked "verify a fresh build/install works" over guessing at a specific bug. Built a real installer, silent-installed it, and launched it to check.
**Status:** Completed (1 root cause fixed)

---

## Summary

`npm run build:win` → silent install → launch worked cleanly: the window mounted, the health-log watchdog stayed green (`ok:true, running:true, mounted:true`) for the whole session, no blank window, no crash. But the health log showed `AUTO_UPDATE_UNAVAILABLE error=Cannot find module 'electron-updater'` — the auto-update feature TODO.md already flagged as "still untested against a real update" turned out to be worse than untested: it couldn't even load the module in a packaged build, on **any** platform, not just Windows.

## Root Cause

**File:** `electron-builder.yml`
**Problem:** The `files` list ended with `"!node_modules/**"`, unconditionally excluding all of `node_modules` from every packaged app (`asar: true` bundles whatever `files` includes). `electron-updater` is a real npm dependency (correctly listed under `dependencies`, not `devDependencies`) that `electron/main.cjs` `require()`s directly at runtime — with no copy of `node_modules` inside `app.asar`, that `require()` always throws `Cannot find module 'electron-updater'`, silently caught by `setupAutoUpdater()`'s own guard and logged as `AUTO_UPDATE_UNAVAILABLE` rather than crashing the app. This affects `win`/`mac`/`linux` targets equally — it's a `files` list entry, not something platform-specific.
**Fix:** Removed the `"!node_modules/**"` exclusion. Confirmed the other real npm dependencies (`pngjs`, `jpeg-js`, `webgpu`, `@stacksjs/ts-webp`) aren't affected by this same gap: they're only ever referenced from renderer-side code that Vite bundles directly into `dist/assets/**` (confirmed via grep — their code is present in the built bundle), and `preload.cjs`'s own `require()` bridge only allows Node builtins (`fs`/`path`/`crypto`/`zlib`/`dns`/`os`/`tls`), never reaching these packages at runtime either. `electron-updater` was the only real casualty, since it's the only npm package the main process itself needs to `require()` directly.

## Notes

- Verified this wasn't a fluke by rebuilding and reinstalling: the pre-fix installer was 97.8 MB and threw the missing-module error every launch; the post-fix installer is 120.9 MB (node_modules now genuinely present) and the health log shows the auto-updater actually running — `AUTO_UPDATE_CHECKING` → `AUTO_UPDATE_ERROR error=No published versions on GitHub`, the correct, expected outcome for a repo with no published releases yet, not a bug.
- Confirmed the fix doesn't regress the "packaged app boots and stays stable" baseline this session was asked to check: 54+ seconds of continuous `ALIVE` probes after a completely fresh install, zero `RENDERER_GONE`/crash entries.
- Didn't attempt to verify the mac/linux legs (no such hosts available locally) — TODO.md already tracks those as untested for other reasons; this fix applies to their `files` config identically, so they'd have hit the same `Cannot find module` failure for `electron-updater` whenever they're eventually built and tested.
- This is exactly the kind of gap `npm run build:win`'s own health-log watchdog is designed to catch (and did) — a packaging config error, not something `vitest`/`tsc` could ever see, since it only manifests once real `node_modules` resolution happens inside a packaged `app.asar`.

## Files Modified

| File | Change |
|------|--------|
| `electron-builder.yml` | Removed the `"!node_modules/**"` exclusion from `files`, letting electron-builder's normal dependency-tree-based packaging include `electron-updater` (and any other real runtime npm dependency) in the built app |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-09-24-electron-builder-node-modules-exclusion-broke-auto-updater.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .                     → 0 errors (no src/ changes)
npm run build:win (before fix)            → installer builds clean, 97.8 MB; packaged app boots and
                                              stays stable, but AUTO_UPDATE_UNAVAILABLE error=Cannot
                                              find module 'electron-updater'
npm run build:win (after fix)             → installer builds clean, 120.9 MB; packaged app boots and
                                              stays stable (54+ s continuous ALIVE, zero crashes);
                                              AUTO_UPDATE_CHECKING → AUTO_UPDATE_ERROR error=No
                                              published versions on GitHub (correct, expected — no
                                              releases exist yet)
```

## Verification Steps

1. Ran `npm run build:win`, confirmed a real NSIS installer was produced.
2. Silent-installed it (`Nova Browser Setup 1.0.0.exe /S`) to `%LOCALAPPDATA%\Programs\Nova Browser`, launched the real installed `.exe` (not dev mode), and watched the packaged app's own health log (`%APPDATA%\Nova Browser\nova-health.log` — confirmed this resolves correctly via `app.getPath('userData')`, matching an earlier session's fix for the same file inside `app.asar`).
3. Found `AUTO_UPDATE_UNAVAILABLE error=Cannot find module 'electron-updater'` in the log despite the app itself mounting and running fine.
4. Traced the require chain: `electron/main.cjs`'s `setupAutoUpdater()` calls `require('electron-updater')` directly; `electron-updater` is correctly a production `dependencies` entry in `package.json` (ruled out the common "it's in devDependencies" mistake).
5. Checked `electron-builder.yml`'s packaging config and found the `files` list's `"!node_modules/**"` entry, which blanket-excludes what `require('electron-updater')` needs at runtime.
6. Before assuming this was the ONLY casualty, checked the other real npm `dependencies` (`pngjs`, `jpeg-js`, `webgpu`, `@stacksjs/ts-webp`) for any other main/preload-process `require()` reaching them — none found; confirmed their code is present in the Vite-bundled renderer output instead, and `preload.cjs`'s own `require()` allowlist only covers Node builtins.
7. Removed the exclusion, rebuilt, reinstalled fresh (killing the previous instance first), and confirmed via the health log that `electron-updater` now loads and genuinely runs its update check, resolving to the correct "no published releases" outcome rather than a missing-module error.
8. Re-confirmed app stability post-fix (54+ seconds of continuous healthy `ALIVE` probes, zero crash entries) to make sure the fix didn't regress anything the session was actually asked to verify.
