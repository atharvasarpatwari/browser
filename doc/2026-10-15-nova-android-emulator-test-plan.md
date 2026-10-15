# Nova Android — Emulator Test Plan

**Date:** 2026-10-15
**Session:** "Generate a vm and can you test it. Plan it". This plan covers getting an Android emulator running on this PC and testing Nova 1.4 on it, especially everything fixed in today's v1.1–v1.4 rounds that has only been build- and unit-tested so far.
**Status:** In Progress. Approved (AEHD driver, full scope, reusable script); test tooling written; waiting on the user to install the AEHD driver (admin step)

---

## Where things stand (checked this session)

| Item | Finding |
|------|---------|
| CPU | Intel Core i3-10110U. `VirtualizationFirmwareEnabled: True` (VT-x on in BIOS), SLAT: True |
| Hypervisor | `HypervisorPresent: False`. Hyper-V/WHPX are off, so nothing conflicts with the emulator driver |
| Memory / disk | 11.8 GB RAM, 99.9 GB free on C: |
| Emulator | v37.1.11 installed; AVD `NovaEmu` = android-34 `google_apis` x86_64 (no Play Store, so `adb root` works), 1536 MB RAM, data 6 GB |
| Why it failed earlier | `x86_64 emulation currently requires hardware acceleration!` / `emulator -accel-check` → *Android Emulator hypervisor driver is not installed* |
| Fix available | SDK package `extras;google;Android_Emulator_Hypervisor_Driver` v2.2.0 (Google's SDK repo) |

The VM itself (AVD `NovaEmu`) already exists. The only thing missing is the hypervisor driver.

## Step 1 — Enable acceleration (one-time; the admin step is the user's)

**Option A (recommended): Android Emulator hypervisor driver (AEHD)**
1. *(Claude, with your OK to download)* `sdkmanager "extras;google;Android_Emulator_Hypervisor_Driver"`, a small download from Google's SDK repository.
2. *(You, as administrator)* run `%LOCALAPPDATA%\Android\Sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat` from an **elevated** terminal. Claude can't do this: installing a kernel driver is a system-level change.
3. *(Claude)* `emulator -accel-check` should report AEHD as usable.

Trade-off: AEHD only works while Hyper-V is off. If you later enable WSL2, Docker Desktop, or Hyper-V, switch to Option B.

**Option B: Windows Hypervisor Platform (WHPX)**
*(You)* Windows Features → tick **Windows Hypervisor Platform** (and **Virtual Machine Platform**) → reboot. Coexists with WSL2/Docker, but on some Intel laptops it's slower than AEHD.

## Step 2 — Boot the VM (Claude)
- Raise `NovaEmu` RAM from 1536 to 2048 MB. The emulator already auto-raised it to 2560 MB at the last attempt, so this only makes that explicit.
- Boot headless (`-no-window -no-audio -no-snapshot-save -gpu swiftshader_indirect`), wait for `sys.boot_completed=1`. Expect 2–5 min on a dual-core i3.
- `adb root` (google_apis image), which is needed to kill the WebView renderer for the crash test.

## Step 3 — Tests

### 3a. Existing smoke test (unchanged script)
Rebuild the debug APK (the current one predates v1.1–v1.4), then `npm run android:smoke-test -- --adb <sdk>\platform-tools\adb.exe`. That's 8 checks: install, cold launch, boot markers, foreground, `window.novaNative`, snapshot shape, `createTab()` round-trip.

### 3b. Regression checks for today's fixes
These go in a new `android/scripts/emulator-feature-test.mjs`, reusing the smoke test's hand-rolled CDP client (exported from `device-smoke-test.mjs` rather than duplicated). A local Node test server runs on the host, reachable from the emulator at `10.0.2.2`.

| # | Fix (version) | How it's tested | Pass condition |
|---|---|---|---|
| 1 | External links (1.1) | `am start -a VIEW -d http://10.0.2.2:<port>/page` with Nova **closed** (cold), then again while **open** (warm, `onNewIntent`) | the engine snapshot (CDP `getState()`) has a tab with that URL, both times |
| 2 | `javascript:` link rejected (1.1) | `am start -a VIEW -d javascript:alert(1) -n com.nova.browser/.MainActivity` | no new tab; app still running |
| 3 | Release not debuggable (1.1) | install `Nova-release.apk`, look for its `webview_devtools_remote_<pid>` socket | no devtools socket for release; present for debug |
| 4 | Renderer crash recovery (1.2) | as root, `kill -9` the `sandboxed_process` renderer | app PID unchanged; logcat has `Renderer gone`; `window.novaNative` is back within 30 s |
| 5 | Geolocation (1.1) | `adb emu geo fix`; trigger `navigator.geolocation.getCurrentPosition` in the host WebView via CDP; tap **Allow** via `uiautomator dump` + `input tap` | permission dialog appears; position returned matches the fix |
| 6 | Camera + mic (1.1) | `getUserMedia({video, audio})` via CDP; allow camera, **deny** mic | a single dialog asks for both; stream has a video track and no audio track |
| 7 | Duplicate downloads (1.3) | `novaNative.download()` the same `Content-Disposition: attachment; filename=report.bin` twice | `Downloads/report.bin` + `report (1).bin`, both the correct size and hash |
| 8 | Redirected download (1.3) | download `/redirect` → 302 → `/file.bin` | the saved file is the payload, not the 302 body |
| 9 | Dropped download (1.3) | start a slow (throttled) attachment fetch, then `cmd connectivity airplane-mode enable` | app PID unchanged; item ends FAILED |
| 10 | Parallel fetches (1.4) | page with 16 subresources, each delayed 1 s by the server | all finish in ~2–4 s (it was ~16 s+ when serialized) |
| 11 | Charset (1.4) | server sends `text/html; charset=Shift_JIS` bytes; `fetch().text()` via CDP | string equals the expected Japanese text |
| 12 | Binary bodies (1.4) | `fetch('/blob.wasm').arrayBuffer()` | SHA-256 matches the served bytes |
| 13 | Launch theme (1.0 round 2) | `cmd uimode night yes/no`, cold start, `screencap` within ~300 ms, sample a pixel | ≈ `#10111A` in night, ≈ `#F6F6F2` in day |

Cross-protocol (http→https) download redirects need TLS on the test server, so #8 covers same-protocol only, unless you're OK with using a public https URL.

### 3c. Remaining manual-checklist items
These are from `doc/2026-09-06-android-manual-test-checklist.md`: context menu, bookmarks/history, incognito. Driven via `uiautomator`, with screenshots attached for review. **File upload is expected to fail.** That's the known engine gap; it's queued as a separate task and won't be "fixed" here.

## Step 4 — Report and fixes
- Results table (pass/fail plus evidence) in `doc/2026-10-15-nova-android-emulator-test-results.md`, indexed in `doc/README.md` and `doc/analytics.html`.
- Any failure gets a root-cause fix, a rebuild, and a re-run, and goes in the same doc.
- Emulator is shut down at the end (`adb emu kill`).

## Not in scope
- Play Store / real release signing.
- Performance profiling beyond check #10.
- iOS.

---

## Prepared so far (2026-10-15)

| File | Purpose |
|------|---------|
| `android/scripts/cdp-client.mjs` | **new**: the smoke test's hand-rolled CDP/WebSocket client, moved into a shared module. Adds `awaitPromise`/`timeoutMs`, matches replies by `id` (skips events), and sends and receives 64-bit-length frames |
| `android/scripts/device-smoke-test.mjs` | now imports `cdpEvaluate` from `cdp-client.mjs`; behaviour unchanged |
| `android/scripts/emulator-feature-test.mjs` | **new**: checks #1–#13 plus UI checks U1–U4 (`--ui`). Local test server via `adb reverse`; results and screenshots go to `android/build/emulator-test/` (gitignored) |
| `package.json` | `"android:feature-test": "node android/scripts/emulator-feature-test.mjs"` |

SDK package downloaded: `extras;google;Android_Emulator_Hypervisor_Driver` v2.2 (`aehd.Sys`, `silent_install.bat`). The debug APK has been rebuilt with v1.1–v1.4 (`gradlew assembleDebug`, BUILD SUCCESSFUL, 15.9 MB).

Verification so far (no device yet):
```
node --check android/scripts/{cdp-client,device-smoke-test,emulator-feature-test}.mjs   -> OK
node android/scripts/device-smoke-test.mjs --help                                       -> prints usage (import refactor OK)
cdp-client vs headless Chromium (Playwright, --remote-debugging-port):
  { sync: 3, prom: { ok: '日本語' }, bigLen: 200000, threw: 'Page threw: TypeError: Cannot read properties of null (readi' }
emulator -accel-check -> "Android Emulator hypervisor driver is not installed on this machine" (user step pending)
```
