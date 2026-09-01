# Android App — Engine Bundle Manually Synced (Source-Level Fix)

**Date:** 2026-08-28
**Session:** Direct continuation of `2026-08-27-android-app-source-audit.md`, after gaining direct file-bridge access to `android/app/src/main/java/com/nova/browser/` (previously depth-limited, worked around via a root-level `com/` mirror). Still **no shell/Gradle/adb access** to the connected machine — everything below was done with file reads/writes only.
**Status:** Source-level fix applied. A real Gradle build + install is still required to produce a working APK — see "What's still needed."

---

## What this does

Reproduces, by hand, exactly what `android/scripts/copy-web.mjs` would do on a `npm run build:android` run — copying the current `dist/` web build into the Android app's bundled assets — without being able to actually run that script (no Node/shell access from this session).

`android/app/src/main/assets/index.html` referenced `./assets/main-DJgCeaiI.js`, a 2026-08-14 build. The current `dist/` build (from the 2026-08-27 Windows-build session) produces `./assets/main-BWMQ7o7L.js` plus a new stylesheet, `main-DR04VOts.css`, that the stale `index.html` didn't link at all. Read `android/scripts/copy-web.mjs` in full to get its exact source/destination paths (`dist` → `android/app/src/main/assets`, plus `android/bridge/nova-bridge.js` → `android/app/src/main/assets/nova-bridge.js`), then compared `dist/assets/` against the Android app's `assets/assets/` file-for-file by hashed filename to isolate exactly which files actually changed content (matching filenames are byte-identical outputs from the same unchanged source — no need to touch those):

| File | Old (stale) | New (current) | Changed? |
|---|---|---|---|
| `main-*.js` | `main-DJgCeaiI.js` (1,263,931 B) | `main-BWMQ7o7L.js` (1,313,423 B) | Yes — the engine itself |
| `main-*.css` | *(not present — index.html had no stylesheet link)* | `main-DR04VOts.css` (45,386 B) | Yes — new |
| `png-*.js` | `png-BPiYTWKX.js` (30,068 B) | `png-DUSHQAN8.js` (30,068 B) | Yes (hash differs; recompiled) |
| `process-manager-*.js` | `process-manager-qX666fTu.js` (18,139 B) | `process-manager-BcgR1y6J.js` (18,163 B) | Yes |
| `child-process-transport-*.js` | `child-process-transport-BR_70Cs5.js` (2,654 B) | `child-process-transport-C7w4KAQm.js` (2,654 B) | Yes (hash differs) |
| `dist-*.js`, `electron-stub-*.js`, `jpeg-js-*.js`, `rolldown-runtime-*.js`, `transport-*.js` | — | — | **No** — identical filename+size in both `dist/` and the old Android assets, meaning that source hasn't changed since the last real sync |

Copied the 5 changed files from `dist/assets/` into `android/app/src/main/assets/assets/` at their new hashed names, and rebuilt `index.html` from the current `dist/index.html` with the `<script src="./nova-bridge.js"></script>` tag re-injected before the module script — the same transform `copy-web.mjs` performs — so it now references `main-BWMQ7o7L.js` and links the new `main-DR04VOts.css`. Confirmed `android/bridge/nova-bridge.js` (the fetch-shim source) and the deployed `android/app/src/main/assets/nova-bridge.js` are byte-identical (same size, same mtime) — that file didn't need re-copying.

## What this does NOT fix

- **No Gradle build ran.** The WebView loads assets *packaged inside the installed APK*, not read live off the filesystem — this sync only updates the source the next build will package. An actual `npm run build:android` (or at minimum `gradlew.bat assembleDebug`) + reinstall is still required before this reaches a real device. That command's own `build:web` step would very likely regenerate fresh content hashes again anyway, superseding this manual sync — the value here is that the repo's Android assets folder is no longer silently two weeks stale in the meantime, and the diff is now small and legible for whoever runs the build next.
- **Orphaned old files were left in place.** `main-DJgCeaiI.js`, `png-BPiYTWKX.js`, `process-manager-qX666fTu.js`, and `child-process-transport-BR_70Cs5.js` are still sitting in `android/app/src/main/assets/assets/` alongside the new files — a real `copy-web.mjs` run does `rmSync(dest, {recursive:true})` before copying, wiping these (and the Capacitor leftovers) first. This session has no file-delete capability at all, so they're dead weight until a shell-capable session or a real build run cleans them up. Harmless to correctness (nothing references them by name anymore), just extra bytes.
- Everything already flagged in `2026-08-27-android-app-source-audit.md`'s "What this session could not do" still applies: build, install, and the full manual on-device feature pass.

## What's still needed

```bash
npm run build:android    # web build + asset sync (supersedes this manual sync) + assembleDebug
npm run android:install  # installDebug to a connected device/emulator
```
Then the manual feature pass from the prior audit doc (tabs, bookmarks/history, downloads, context menu, file upload, permissions, incognito, theme in light/dark).
