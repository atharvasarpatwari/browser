# Android Feature Test Run on the Tablet — Audio-Capture Fix, Harness Repairs (emulator still blocked)

**Date:** 2026-10-21
**Session:** "Run Android emulator test plan after AEHD install" → the driver is still not installed, so the plan from `doc/2026-10-15-nova-android-emulator-test-plan.md` was run against the attached **OnePlus OPD2305 tablet, Android 14** (`IZ9HSSBUYHG6G6AU`) instead.
**Status:** Completed — 18 passed, 0 failed, 2 skipped (both emulator/root-only), plus the smoke test green.

---

## Summary

The emulator is still blocked: `emulator -accel-check` reports *"Android Emulator hypervisor driver is not installed"*, no `aehd`/`gvm` service exists, and installing a kernel driver needs an elevated shell. Everything else in the plan was run on real hardware.

Doing that turned up **one real app bug** (`getUserMedia({audio:true})` could never work — a missing manifest permission) and **four harness defects** that would have produced false results on any device. All are fixed; the suite now ends 18/0/2.

## Root Causes

### 1. Microphone capture was impossible: `MODIFY_AUDIO_SETTINGS` not declared
**File:** `android/app/src/main/AndroidManifest.xml`
**Problem:** `getUserMedia({audio:true})` always rejected with `NotReadableError: Could not start audio source`, even with `RECORD_AUDIO` granted at the OS level (`granted=true`, appop `foreground`, mic not muted) and with camera capture working in the same call. Device logcat gave it away:

```
W cr_media: Requires MODIFY_AUDIO_SETTINGS and RECORD_AUDIO. No audio device will be available for recording
E chromium: [ERROR:media/audio/android/audio_manager_android.cc:890] Unable to select communication device!
```

Chromium's `AudioManagerAndroid` checks for **both** permissions before it will open any input device. Nova declared only `RECORD_AUDIO`.

**Fix:** declare it (a normal, install-time permission — no new prompt for users):

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
```

After the rebuild, check #6 returns `tracks: ["audio","video"]`.

### 2. applicationIdSuffix broke `am start -n <pkg>/.MainActivity`
**Files:** `android/scripts/emulator-feature-test.mjs`, `android/scripts/device-smoke-test.mjs`
**Problem:** the debug build now installs as `com.nova.browser.debug`, but the launcher class keeps its own package (`com.nova.browser.MainActivity`). `-n com.nova.browser.debug/.MainActivity` expands to `...debug.MainActivity`, which does not exist — the first run aborted with *"engine never came up"*.
**Fix:** ask the device instead of assuming: `cmd package resolve-activity --brief -c android.intent.category.LAUNCHER <pkg>`.

### 3. `pm clear` is refused on this OEM build, and the harness ignored it
**File:** `android/scripts/emulator-feature-test.mjs`
**Problem:** `pm clear com.nova.browser.debug` fails on ColorOS with `SecurityException: PID ... does not have permission android.permission.CLEAR_APP_USER_DATA`. The harness threw the output away, so cookies, downloads and granted permissions survived between runs. That alone produced four false failures on the second run: #15 saw `sid=normal; vis=1; hid=2` left from the previous run, #7 found `report (1..3).bin`, #8 hashed a stale `redirected.bin`, and #6 never saw a permission dialog because the grant was still there.
**Fix:** reset by reinstalling (`rm -rf <downloads dir>`, `adb uninstall`, `adb install`), which no OEM policy can refuse, plus a warning if `CAMERA` is still granted afterwards.

### 4. UI checks U2–U4 were written against the pre-1.9 top bar
**File:** `android/scripts/emulator-feature-test.mjs`
**Problem:** they looked for icon buttons with content descriptions `Bookmark`, `Incognito`, `Downloads`. The 1.9 redesign deleted `AddressBar.kt` / `TabsBar.kt` and moved all three into the bottom bar's overflow menu, so the checks reported "no Bookmark button" — a harness failure that reads like an app failure.
**Fix:** a `menuItem(label)` helper that opens the overflow menu and taps `Add bookmark` / `Bookmarks` / `New incognito tab` / `Downloads`. U3 returns to a normal session through the tab switcher's **Tabs** section; U4 dismisses the "Allow notifications?" dialog that a first download raises.

### 5. U4 was really testing download persistence
**File:** `android/scripts/emulator-feature-test.mjs`
**Problem:** U4 looked for `report.bin` from check #7, but #9 and #13 restart the app in between, and the downloads list is in-memory only (see *Found, not fixed*), so the sheet was legitimately empty.
**Fix:** U4 downloads its own `sheet.bin` immediately before opening the sheet.

## Harness improvements (beyond the fixes)

| Change | Why |
|--------|-----|
| `android/app/build.gradle`: debug gets `applicationIdSuffix '.debug'` and `versionNameSuffix '-debug'` | the suite does `install -r` plus a data wipe; without a separate id every device run would replace and clear the build the user actually uses (1.25 here). Both now sit side by side |
| `--package <id>` on both scripts | so they can drive `com.nova.browser.debug` |
| Check #3 works without a signed release APK | if none is present it probes the installed base package instead of installing anything: `debug socket=true, release socket=false` |

## Results — final run

`node android/scripts/emulator-feature-test.mjs --serial IZ9HSSBUYHG6G6AU --package com.nova.browser.debug --ui`

| # | Check | Result |
|---|-------|--------|
| 1 | link from another app (cold + warm) | PASS — cold and warm tab, same process |
| 2 | `javascript:` link ignored | PASS — tabs 3 → 3 |
| 3 | release build has no devtools socket | PASS — debug socket=true, release (installed 1.25) socket=false |
| 4 | renderer kill recovery | SKIP — needs `adb root` |
| 5 | geolocation | SKIP — needs `adb emu geo fix` |
| 6 | camera + mic | PASS — camera-allow/mic-deny → `NotAllowedError`; then allow → `["audio","video"]` |
| 7 | duplicate downloads numbered | PASS — `report.bin` + `report (1).bin`, hashes match |
| 8 | redirected download | PASS — 49152 B, hash match |
| 9 | dropped download | PASS — same pid, no FATAL, no bogus "completed" |
| 10 | parallel fetches | PASS — 16 × 1 s in 2076 ms |
| 11 | charset decoding | PASS — Shift_JIS → 日本語, ISO-8859-1 → café |
| 12 | binary bodies | PASS — sha256 match |
| 13 | launch theme | PASS — `#10111a` night, `#f6f6f2` day |
| 14 | PATCH + FormData/binary bodies | PASS |
| 15 | cookies incl. incognito isolation | PASS — `sid=normal` survives restart, incognito sees only `sid=private` |
| 16 | NovaCookies hides HttpOnly | PASS — script sees `sid; vis`, server gets `sid; vis; hid; fromjs` |
| U1 | long-press context menu | PASS — screenshot |
| U2 | bookmark then Bookmarks sheet | PASS — screenshot |
| U3 | incognito on/off | PASS — on=true off=true |
| U4 | downloads sheet | PASS — `sheet.bin` listed |

## Files Modified

| File | Change |
|------|--------|
| `android/app/src/main/AndroidManifest.xml` | declare `MODIFY_AUDIO_SETTINGS` (root cause 1) |
| `android/app/build.gradle` | debug `applicationIdSuffix '.debug'` and `versionNameSuffix '-debug'` |
| `android/scripts/emulator-feature-test.mjs` | `--package`; launcher activity resolved from the device; reinstall-based reset; menu-driven U2–U4; U4 downloads its own file; check #3 works against an installed release build |
| `android/scripts/device-smoke-test.mjs` | `--package`; launcher activity resolved from the device |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-21-android-feature-test-on-device.md` | This change log |

## Test Results

```
gradlew assembleDebug                     -> BUILD SUCCESSFUL (com.nova.browser.debug, 1.9-debug, 15.3 MB)
emulator-feature-test (tablet, --ui)      -> 18 passed, 0 failed, 2 skipped
device-smoke-test (tablet, --package ...) -> all checks passed (install, cold start 2109 ms, boot
                                             markers, foreground, novaNative, snapshot, createTab)
node --check on all three android/scripts -> OK
```

Device state restored afterwards: `cmd uimode night auto`. The debug build is left installed as `com.nova.browser.debug`; the release 1.25 was never touched.

## Found, not fixed

- **Downloads do not survive a restart.** `BrowserViewModel.downloads` is a `mutableStateListOf` fed by `NativeDownloader`, and nothing persists it; `NativeDownloader.kt` keeps no record of finished files. After any app restart the Downloads sheet reads "No downloads yet" while the files are still in `Android/data/<pkg>/files/Downloads`. The fix would be persisting the list (SharedPreferences or Room) and reconciling it with the directory on startup.
- **Emulator-only checks are still outstanding:** #4 (renderer kill, needs `adb root`) and #5 (geolocation, needs `adb emu geo fix`). They need the AEHD driver installed from an elevated terminal: `%LOCALAPPDATA%\Android\Sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat`.
- The plan's step 3c file-upload item remains the known engine gap; not attempted here.
