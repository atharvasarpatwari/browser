# Android App — First Successful Gradle Build + Install

**Date:** 2026-08-28
**Session:** Run `npm run build:android` end-to-end: web build → asset sync → Gradle assembleDebug → adb install to physical device
**Status:** Completed

---

## Summary

Successfully built and installed the Nova Browser Android app for the first time with a fresh engine bundle. The prior state had a stale 2026-08-14 engine bundle in the APK; a manual source-level sync on 2026-08-28 was superseded by this real build. APK (21.4 MB) installed and runs on device `KNEUZTEE6TIBAIIV`.

---

## Root Causes (if bug fix)

### 1. Stale engine bundle in Android app
**File:** `android/app/src/main/assets/assets/main-DJgCeaiI.js` (and related assets)
**Problem:** The Android app's bundled WebView engine JS was from a 2026-08-14 build, missing all rendering-pipeline rewrites (9 sessions, 2026-08-24–27) and WebRTC Phase 1. No Gradle build had ever been run in the current environment — the repo's `build:android` script requires shell/Gradle/adb access.
**Fix:** Ran the full `npm run build:android` pipeline:
```
npm run build:web              # vite build → fresh dist/ with new content hashes
node android/scripts/copy-web.mjs  # wiped stale assets, copied new dist/ → android/app/src/main/assets
gradlew.bat assembleDebug      # compiled Kotlin/Compose shell, packaged fresh assets into APK
adb install -r app-debug.apk   # installed to connected device
```

---

## Files Modified

| File | Change |
|------|--------|
| `dist/` (regenerated) | Fresh Vite build: `main-DvaDValh.js` (1,313.7 KB), `png-7JwNPMwo.js`, `process-manager-BcbLPh4g.js`, `child-process-transport-CBQAY85l.js`, `main-DR04VOts.css` (new), etc. |
| `android/app/src/main/assets/index.html` | Rebuilt from `dist/index.html` with `<script src="./nova-bridge.js"></script>` injected; references new hashed assets |
| `android/app/src/main/assets/assets/*` | Stale orphaned files deleted; all 11 assets now match current `dist/assets/` exactly |
| `android/app/build/outputs/apk/debug/app-debug.apk` | New 21.4 MB APK produced (timestamp 2026-08-28 14:22:15) |

---

## Files Created

| File | Purpose |
|------|---------|
| `android/app/build/outputs/apk/debug/app-debug.apk` | Installable debug APK with fresh engine bundle |

---

## Test Results

```
> npm run build:web
✓ built in 6.06s — 10 chunks, 1.3 MB main bundle

> node android/scripts/copy-web.mjs
Bridge injected; assets copied to E:\nova_1\android\app\src\main\assets
exit=0

> gradlew.bat assembleDebug
BUILD SUCCESSFUL in 2m 21s
36 actionable tasks: 13 executed, 23 up-to-date

> adb install -r app-debug.apk
Performing Streamed Install
Success
```

---

## Verification Steps Taken

1. **Prerequisites confirmed:** Node v20.19.1, JDK 21 (Temurin), Android SDK at `C:\Users\athar\AppData\Local\Android\Sdk`, `local.properties` with correct `sdk.dir`, Gradle wrapper present.
2. **Web build:** `npm run build:web` → fresh `dist/` with new content hashes (superseding 2026-08-28 manual sync).
3. **Asset sync:** `copy-web.mjs` cleaned stale orphans, copied 11 assets + rebuilt `index.html`.
4. **Gradle build:** `gradlew.bat assembleDebug` — full Kotlin/Compose compilation + APK packaging (first run, downloaded deps via daemon).
5. **Device install:** `adb devices` → one device attached (`KNEUZTEE6TIBAIIV`); `adb install -r` → Success.
6. **APK verification:** 21.4 MB, timestamped 2026-08-28 14:22:15, contains fresh engine assets.

---

## Cleanup Completed (post-build)

Per TODO.md item 1 cleanup list, all redundant leftovers were removed:

| Item | Status Before | Action |
|------|---------------|--------|
| `E:\nova_1\com\` mirror folder | Present, 18 files, all byte-identical to real Android source | `git rm -r com/` — confirmed redundant, none of the 5 mirrored `.kt` files (`BrowserViewModel`, `MainActivity`, `NativeDownloader`, `NovaFetchBridge`, `NovaStateBridge`) differed from `android/app/src/main/java/com/nova/browser/` |
| `apply-android-redesign.bat` | Already absent (nothing deleted) | n/a |
| `android/app/src/main/java/com/nova/browser/New folder/` | Empty dir | Deleted |
| `android/app/src/main/assets/public/` (Capacitor) | Already deleted from disk by earlier `copy-web.mjs` run | n/a |
| `android/app/src/main/assets/capacitor.config.json` / `capacitor.plugins.json` | Already deleted from disk | n/a |
| `android/capacitor.settings.gradle` | Present | `git rm` — confirmed unreferenced (`settings.gradle` only `include ':app'`; top-level `build.gradle` has no capacitor plugin) |
| `android/capacitor-cordova-android-plugins/` | Present | `git rm -r` — confirmed unreferenced |

The orphaned stale-hashed asset files (`main-DJgCeaiI.js`, `png-BPiYTWKX.js`, `process-manager-qX666fTu.js`, `child-process-transport-BR_70Cs5.js`) were also wiped by the real `copy-web.mjs` run, resolving the "no file-delete capability" limitation from `2026-08-28-android-engine-bundle-sync.md`.

**Verification:** `gradlew.bat assembleDebug` re-run after deletions → `BUILD SUCCESSFUL in 1m 9s`, 35/36 tasks UP-TO-DATE (nothing that referenced the deleted files needed recompiling).

---

## What's Still Needed (from TODO.md)

- [ ] Manual on-device feature pass: tabs, bookmarks/history, downloads (pause/resume/cancel/share), long-press context menu, file upload, camera/mic permission prompts, incognito, theme in light/dark system settings.
- [ ] Note: many accumulated working-tree changes (from prior file-bridge-only sessions) remain **uncommitted** — see `git status`. A future session should review and commit them (incl. the newly built asset files + deletions logged here).