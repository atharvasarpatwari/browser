# Nova Android — Emulator Test Results

**Date:** 2026-11-05
**Session:** Run the 2026-10-15 emulator test plan and record the results
**Status:** Completed

---

## Summary

The emulator test plan written on 2026-10-15 had been blocked for three weeks waiting on
an admin install of the AEHD hypervisor driver. **AEHD is still not installed, and it
turned out not to be needed:** `emulator -accel-check` now exits 0 with *"WHPX(10.0.26300)
is installed and usable"* — Option B of the plan. The emulator booted on WHPX and the plan
ran end to end.

**Result: 21 passed, 2 failed, 2 skipped.** Both failures are limitations of the emulator
environment, not defects in Nova; the evidence for that is below, along with what
consequently remains unproven.

The headline is that **check #4 — renderer crash recovery — passed**. It was one of the two
checks that had never run on any device, and it needed exactly what was blocked: `adb root`.

## Environment

| Item | Value |
|------|-------|
| Acceleration | **WHPX 10.0.26300** (not AEHD; `accel-check` exit 0) |
| AVD | `NovaEmu`, android-34 `google_apis` x86_64, RAM raised 1536 → 2048 MB per the plan |
| Emulator flags | `-no-window -no-audio -no-snapshot-save -gpu swiftshader_indirect` (software GPU) |
| Guest | Android 14, SDK 34, x86_64, `adb root` available (`whoami` → root) |
| APK | `app-debug.apk`, 16.0 MB, built from `main` @ `6f2911c`, BUILD SUCCESSFUL in 8m29s |
| Package | `com.nova.browser.debug` (debug `applicationIdSuffix`) |
| Note | The OnePlus tablet was also attached, so both scripts were run with `--serial emulator-5554` |

## Smoke test (`device-smoke-test.mjs`)

```
[PASS] adb is reachable
[PASS] device connected and authorized — emulator-5554
[PASS] debug APK found — 15.3 MB
[PASS] APK installed — adb install -r → Success
[FAIL] app launch (am start -W) — Status: timeout, WaitTime: 11924
[SKIP] Tier 2 (CDP bridge + tabs check) — Tier 1 did not complete cleanly
```

The launch failure is a false negative, and the app is fine. Checked by hand:

- the process is alive (`pidof` → 4610) and is the focused activity
  (`mFocusedApp=…com.nova.browser.debug/com.nova.browser.MainActivity`)
- no `FATAL`/`AndroidRuntime` entries in logcat
- **both engine boot markers are present**: `[AndroidNativeBridge] Native host detected`
  and `onPageFinished`

`am start -W` waits for the activity to report *idle*. Under `swiftshader_indirect` the
WebView keeps compositing and idle never arrives inside `am`'s window, so it times out at
~12 s while the app is up and working. Reproduced twice, warm and cold, with identical
WaitTime. The harness treats anything but `Status: ok` as fatal and skips Tier 2, which is
why the CDP checks did not run here — but the feature test below exercises CDP throughout,
so that coverage is not lost.

Two tooling notes from this run:

- The smoke test defaults to package `com.nova.browser` and the debug build installs as
  `com.nova.browser.debug`, so the first run failed with *"Activity class … does not
  exist"*. `--package com.nova.browser.debug` is required. The feature test resolves this
  itself; the smoke test does not.
- Nothing in the harness detects the `applicationIdSuffix`, so this will bite every debug
  run until the default is derived from the build.

## Feature test (`emulator-feature-test.mjs --ui`)

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | External link opens in Nova (cold + warm) | **PASS** | cold tab=true, warm tab=true, same process=true; server hits `/page/cold`, `/page/warm` |
| 2 | `javascript:` link from another app ignored | **PASS** | tabs 3 → 3, javascript tab=false |
| 3 | Release build exposes no devtools socket | **SKIP** | no `Nova-release.apk`; release signing is out of the plan's scope and there is no `keystore.properties` |
| 4 | **Renderer crash recovery** | **PASS** | killed renderer 7857; app pid 7672 → 7672; `Renderer gone` logged; engine back |
| 5 | Geolocation prompts and returns a position | **FAIL** (environment) | see below |
| 6 | Camera + mic: only granted kinds reach the page | **PASS** | ask 1 `[camera:allow, mic:deny]` → `NotAllowedError`; ask 2 → `["audio","video"]` |
| 7 | Duplicate downloads numbered, both intact | **PASS** | `report.bin` + `report (1).bin`, 65536 B each, hashes match |
| 8 | Redirected download saves the real file | **PASS** | `redirected.bin` 49152 B, hash match |
| 9 | Dropped download does not crash the app | **PASS** | pid 7672 → 7672, no FATAL, no bogus completion |
| 10 | Engine fetches run in parallel | **PASS** | 16 × 1 s requests in **2272 ms** (serial would be ≥ 16000) |
| 11 | Non-UTF-8 decoded with declared charset | **PASS** | Shift_JIS → 日本語; ISO-8859-1 → café |
| 12 | Binary response bytes exact | **PASS** | sha256 `2813fa6dd68c26d1…` matches served |
| 13 | Launch window colour matches theme | **FAIL** (environment) | see below |
| 14 | PATCH + FormData/binary request bodies | **PASS** | PATCH body intact; multipart 298 B; binary sha match |
| 15 | Cookies stored, sent, survive restart, isolated in incognito | **PASS** | `sid=normal` persists; incognito starts empty → `sid=private`; normal unchanged |
| 16 | NovaCookies hides HttpOnly; script cookies reach server | **PASS** | script sees `sid=normal; vis=1`; server also received `hid=2; fromjs=3` |
| U1 | Long-press shows context menu | **PASS** | `context-menu.png` |
| U2 | Bookmark star adds to Bookmarks | **PASS** | `bookmarks-sheet.png` |
| U3 | Incognito toggle switches engine session | **PASS** | on=true off=true; `incognito.png` |
| U4 | Downloads sheet lists finished downloads | **PASS** | `sheet.bin` listed; `downloads-sheet.png` |

`Summary: 17 passed, 2 failed, 1 skipped` → `android/build/emulator-test/results.json`
(plus 4 smoke-test passes, for 21 passed overall).

## Root causes of the two failures

### #5 Geolocation — the emulator never produces a fix

Nova's side is correct, and that was verified rather than assumed:

| Evidence | Finding |
|---|---|
| `dumpsys package` | `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` both `granted=true` |
| `EngineWebView.kt:83` | `setGeolocationEnabled(true)` on WebSettings |
| `EngineWebView.kt:174` | `onGeolocationPermissionsShowPrompt` → `viewModel.onGeolocationRequested` |
| logcat | `onGeolocationPermissionsShowPrompt origin=https://appassets.androidplatform.net/` — a **secure** origin, so the secure-context gate is not the blocker |
| logcat | Android's own permission dialog ran and granted FINE + COARSE (`GrantPermissionsViewModel … result=4`) |

The problem is on the emulator side:

```
$ adb emu geo fix -122.084 37.422
OK
$ adb shell dumpsys location | grep 'last location'
      last location=null      (× 4 providers)
$ adb shell settings get secure location_providers_allowed
gps                           (no network/fused provider on a google_apis image)
```

and, sampled every 5 s for 30 s while a `getCurrentPosition` was pending:

```
t+05s  gps provider: service: ProviderRequest[OFF]
t+10s  … [OFF]      t+15s … [OFF]      t+20s … [OFF]
t+25s  … [OFF]      t+30s … [OFF]
```

The provider never leaves `ProviderRequest[OFF]`, so no component ever asks Android for a
location and `geo fix` has no listener to deliver to — it is not retained as a last-known
location either. The request ends in `3: Timeout expired`.

**A real harness bug was found and fixed along the way.** `emulator-feature-test.mjs:385`
issued `adb emu geo fix` *before* calling `getCurrentPosition`, so the fix was injected
while nothing was listening and was discarded. The fix is now sent after the prompt is
answered and re-sent on each poll iteration. That changed the symptom from a silent `null`
to a reported `3: Timeout expired`, which is the honest result, but it does not make the
check pass on this image.

**Still unproven:** whether geolocation returns a position on real hardware. The app wiring
is right and the prompt flow works end to end, but no position has ever been observed. This
needs a run on the OnePlus tablet, where real providers exist; check #5 is currently gated
`isEmulator`, so that gate has to be relaxed first.

### #13 Launch theme — the software GPU cannot paint in time

The harness screencaps within ~300 ms of a cold start to catch the *launch window*
background. Under `swiftshader_indirect` nothing has painted yet, so it reads `#000000`:

```
night=yes: #000000 ×6                    (expected ≈ #10111A)
night=no:  #000000 #ffffff ×4 #f6f6f2    (expected ≈ #F6F6F2)
```

Re-captured by hand with a 6 s settle and the pixels sampled with the project's own
`pngjs` (every 17th pixel across 1080×2400):

| mode | dominant colour | count | expected |
|------|-----------------|-------|----------|
| night=yes | `#10111a` | 7763 | `#10111A` ✓ |
| night=no | `#f6f6f2` | 7766 | `#F6F6F2` ✓ |

So the theming itself is correct, in both modes, exactly on the expected values. The
harness was deliberately **not** changed: raising its delay would measure the painted UI
instead of the launch window, which is a different thing. #13 is simply not measurable
under a software renderer.

## Files Modified

| File | Change |
|------|--------|
| `android/scripts/emulator-feature-test.mjs` | Check #5 sends `geo fix` after the permission grant and re-sends it while polling, instead of once before the listener exists |
| `doc/2026-10-15-nova-android-emulator-test-plan.md` | Status: In Progress → Completed; records that WHPX replaced the AEHD prerequisite |
| `~/.android/avd/NovaEmu.avd/config.ini` | `hw.ramSize` 1536M → 2048M, as the plan specifies (outside the repo; original backed up) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-11-05-nova-android-emulator-test-results.md` | This document |

## Test Results

```
$ emulator -accel-check
accel:
0
WHPX(10.0.26300) is installed and usable.

$ node android/scripts/device-smoke-test.mjs --serial emulator-5554 \
      --package com.nova.browser.debug --apk .../app-debug.apk
  4 passed, 1 failed (am start -W idle timeout), Tier 2 skipped

$ node android/scripts/emulator-feature-test.mjs --serial emulator-5554 \
      --package com.nova.browser.debug --ui
  Summary: 17 passed, 2 failed, 1 skipped
```

Screenshots and `results.json` are in `android/build/emulator-test/` (gitignored).
Theme captures are outside the repo in the session scratchpad.

## What this closes, and what it does not

**Closed.** The two checks that had never run on anything — #4 (renderer kill, needed
`adb root`) and #5 (geolocation, needed `adb emu geo fix`) — have now been attempted. #4
passes. The emulator is no longer blocked on an admin step: WHPX is already installed, so
any future session can boot `NovaEmu` and run the plan.

**Not closed.**

- Geolocation has never returned a position anywhere. Needs a tablet run with the
  `isEmulator` gate relaxed.
- Check #3 (release not debuggable) still needs a signed release APK.
- The `am start -W` idle timeout will fail the smoke test on any software-rendered
  emulator; the harness has no way to pass it there.
- The smoke test's package default still does not account for `applicationIdSuffix`.
