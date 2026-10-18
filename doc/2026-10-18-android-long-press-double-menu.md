# Android Long-Press: One Menu, Not Two (+ today's to-do sweep)

**Date:** 2026-10-18
**Session:** "perform the to-do list in `doc/analytics.html` … solve the issues daily from today, get the problem fixed." Worked the four `2026-10-18-*` items seeded by the nightly task into `doc/analytics-todos.js`.
**Status:** Completed for everything that does not need the phone, an emulator hypervisor or a signing key. Of the 11 items on the board: 3 fixed (long-press double menu, PNG decode on `main`, swipe-to-close), 1 confirmed already fixed, 1 triaged with findings, 6 blocked on hardware or on your decision.

---

## Summary

The one item on today's list that named an actual unfixed bug — *"does long-press open both the DOM context menu and the native sheet?"* (`doc/2026-10-17-nova-android-ui-features.md`, *Found, not fixed*) — is fixed at the root, in two places, both regression-tested. The fidelity-audit item (r4) was re-run and **passes**: the PNG decode fix (`3930751`) does repair the images fixture. The two on-device verification items could not be run: no phone is connected.

## Root Causes

### 1. The desktop DOM page menu was attached on Android too
**File:** `src/ui/pages/browser-window.ts`
**Problem:** The attach site is literally commented *"desktop only — Android has its own long-press menu"*, but `PageContextMenuController.attach()` ran unconditionally. On Android the native Compose sheet is the context menu (`android-native-bridge.ts` → `NovaStateBridge.onContextMenuRequested`), so both were live on the same long-press. Nothing but event ordering kept the DOM menu off the screen: the bridge's `document`-level **capture** listener calls `preventDefault()` and the controller bails on `e.defaultPrevented`. That holds only while the bridge wins the race, and not at all on the dwell-timer path, which never sees a `contextmenu` event to prevent.
**Fix:** attach only when the engine is driving its own chrome:
```ts
// Android drives its own native long-press sheet (android-native-bridge.ts); attaching here too would open both.
if (!this.config.hideChromeUI) this.pageContextMenu.attach();
```
`hideChromeUI` is already the "native Android shell is present" flag (`main.ts` sets it from `isNativeHostPresent()`), so no new platform detection was added.

### 2. A long press could ask the native host for the sheet twice
**File:** `src/app/android-native-bridge.ts`
**Problem:** The bridge has two paths to a menu, because Chrome for Android only fires `contextmenu` on some content: the DOM event, and a 550 ms pointer-dwell fallback. The event path cancels the dwell timer, but not the other way round — once the dwell had already pushed `onContextMenuRequested`, a `contextmenu` arriving afterwards for the *same* press pushed it a second time (sheet opening twice / reopening after dismissal).
**Fix:** a per-press flag rather than a timing window, so it cannot mis-fire across gestures:
```ts
let dwellOpenedMenu = false;          // cleared on every pointerdown, set when the dwell fires
…
const onContextMenuEvent = (e: Event): void => {
  e.preventDefault();
  if (dwellOpenedMenu) return;        // one press, one menu
  …
};
```

## The other three to-do items

| # | Item | Outcome |
|---|------|---------|
| r1 | Phone: re-check pull-to-refresh + drive find-in-page | **Blocked** — `adb devices` lists no device. Both were built and unit-tested on 10-17; only the on-device pass is outstanding. |
| r2 | Phone: long-press opening both menus — fix if so | **Fixed in code** (above), two regression tests. The on-device confirmation still wants a phone. |
| r3 | Phone: same file twice → `name (1).pdf`, and an http→https redirect download | **Blocked** — same reason. The logic is covered by `DownloadFilenameTest` (1) and `DownloadRedirectTest` (3, real loopback socket, 301→302→200); all 4 re-run green today. |
| r4 | Re-run fidelity audit `AUDIT_FIXTURE=images` after PNG fix `3930751` | **Confirmed fixed** — the fixture passes; the checker quadrants (`#380000`, `#002800`, `#000038`, `#383000`) are all present in the cluster histogram. It failed on exactly this check on 10-17. |

**Worth flagging:** `3930751` (and everything else in this branch) is **not on `main`** — `git merge-base --is-ancestor 3930751 main` is false. On `main`, PNG images in the Electron app still silently fall back to the placeholder checkerboard.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | page context menu attached on desktop only |
| `src/app/android-native-bridge.ts` | `dwellOpenedMenu` — the `contextmenu` event after a dwell no longer re-requests the sheet |
| `tests/android-native-bridge.test.ts` | dwell-then-`contextmenu` pushes one request, a fresh press pushes again |

## Files Created
| File | Purpose |
|------|---------|
| `tests/page-context-menu-platform.test.ts` | desktop mount → right-click opens `.nova-context-menu`; `hideChromeUI` mount → it does not |
| `doc/2026-10-18-android-long-press-double-menu.md` | This changelog |

## Test Results
```
npx tsc --noEmit                                   -> clean (exit 0)

npx vitest run tests/android-native-bridge.test.ts -> 1 file, 50 passed
npx vitest run tests/page-context-menu-platform.test.ts -> 1 file, 1 passed

negative check (both fixes temporarily reverted, then restored):
  2 failed | 49 passed  -- each new test fails without its fix

npx vitest run (full suite)                        -> 267 files / 10423 tests passed, exit 0 (was 266 / 10421 on 10-17: +1 file, +2 tests)

npm run build:web                                  -> built in 6.43s
AUDIT_FIXTURE=images npx playwright test --config=playwright-electron.config.cjs tests/e2e/fidelity-audit.spec.ts
  [fidelity] images: rendered load=1237ms 1920x1080 nonWhite=0.005 clusters=6
    top=#383838x285856 #000000x3624 #002800x1688 #380000x1687 #000038x1687 #383000x1687
  1 passed (19.9s)      <- was the one failing spec on 2026-10-17

cd android && gradlew.bat --no-daemon :app:testDebugUnitTest -> BUILD SUCCESSFUL
  DownloadFilenameTest 1, DownloadRedirectTest 3, ExternalLinkTest 1, FetchBodyEncodingTest 2,
  NovaCookieHandlerTest 5, SettingsTest 3, UrlInputResolverTest 18, WebPermissionTest 3
  = 36 tests, 0 failures, 0 errors

adb devices -> "List of devices attached" (empty) — r1 and r3 cannot be driven
```

## Applied to the main checkout (E:
ova_1)

Asked for after the first pass ("updated the files in the local system").

| Change | In `E:
ova_1`? |
|--------|------------------|
| Root cause 2 — `dwellOpenedMenu` in `src/app/android-native-bridge.ts` | **Applied**, with its regression test in `tests/android-native-bridge.test.ts` |
| Root cause 1 — page-menu attach guard in `src/ui/pages/browser-window.ts` | **Not applicable** — `main` has no `PageContextMenuController`; it arrives with `claude/ecstatic-fermi-f08bd5`, and the guard is in that branch |
| `tests/page-context-menu-platform.test.ts` | Not copied — it mounts the controller that `main` does not have |
| `doc/2026-10-18-…md`, `doc/README.md`, `doc/analytics.html` DOCS entry | Applied |

```
E:
ova_1> npx vitest run tests/android-native-bridge.test.ts -> 1 file, 38 passed
E:
ova_1> npx tsc --noEmit -> 22 pre-existing errors, all in the untracked src/browser/service-worker/
                                (someone else's in-progress work); none in the files touched here
```

## Second pass — the other seven to-dos on the board

The dashboard list holds 11 items, not 4 (two earlier nightly runs plus today's). Worked the rest:

### Fixed: PNG decode in Electron, on `main` this time
**Files:** `src/platform/shared/node-builtin-shims/{buffer,stream,zlib}.cts` in `E:\nova_1`
`3930751` only ever existed on `claude/search-subsystem` and the branches that merged it, so every `<img>` in the Electron app on `main` still fell back to the placeholder checkerboard. All three shim files in `E:\nova_1` were byte-identical to that commit's parent (CRLF aside), so the fix ported cleanly — same diffstat as the original (99 insertions, 14 deletions).
```
E:\nova_1> npm run build:web && AUDIT_FIXTURE=images npx playwright test --config=playwright-electron.config.cjs tests/e2e/fidelity-audit.spec.ts
  [fidelity] images: rendered load=1883ms 1920x1080 nonWhite=0.0051 clusters=6
    top=#383838x285718 #000000x3762 #002800x1688 #380000x1687 #000038x1687 #383000x1687
  1 passed (24.5s)
```

### Added: swipe-to-close in the Android tab switcher
**File:** `android/.../ui/components/TabSwitcher.kt` (branch `claude/ecstatic-fermi-f08bd5`)
Left open on 2026-10-17 ("swipe-to-close skipped, add if wanted"). Material3 1.2.1 — the version compose-bom 2024.06.00 resolves — already ships `SwipeToDismissBox`, so this is that component plus a background, not a hand-rolled drag gesture: swipe a card either way and `confirmValueChange` calls `onClose(tab.id)`; the ✕ button stays for tapping. `SwipeToCloseBackground` shows the close icon on the side the finger came from.
```
gradlew :app:assembleDebug :app:testDebugUnitTest -> BUILD SUCCESSFUL in 1m 48s, 0 warnings
gradlew :app:assembleRelease                      -> BUILD SUCCESSFUL in 5m 13s
  R8 mapping: 523 SwipeToDismiss lines, 146 SwipeToCloseBackground lines
```
The project has no Compose UI-test harness (JVM unit tests only), so the gesture itself is unverified until it runs on a device or emulator.

### Triage of `main`'s uncommitted changes — two load-bearing files are not in git
`git status` on `main` lists 19 modified files and 28 untracked paths. The finding that matters:

- **`src/browser/networking/crypto-utils.ts` is untracked, and `main`'s own committed code imports it** — `engine/telemetry.ts`, `engine/auto-updater.ts`, `networking/tls-handler.ts` and `research/research-service.ts` all do (checked against `HEAD:`, not the working copy).
- **`src/browser/networking/{socket-owner,preload}.cjs` are untracked, and committed `electron/main.cjs` references them.**
- Neither was removed by the dead-code sweep `ac6c172`; they were never added. **A fresh clone of `main` is missing them**, so it cannot typecheck or package.

The rest of the untracked `src/` work (`search/`, `find/`, `dashboard/`, `webrtc/`, `service-worker/`, `extensions/`, `manifest.ts`, `opensearch-parser.ts`, `webgpu-context.ts`, `dns-preconnect.ts`, `privacy-gate.ts`, `tab-group-manager.ts`) exists in **no branch at all** — it is the 2026-10-02/03 search-engine and security/WebGPU sessions, alive only in this working tree. `src/browser/service-worker/` accounts for all 22 current `tsc --noEmit` errors; most of the others are imported by nothing.

Four stray scratch files, all from 2026-10-03, none referenced anywhere:

| File | Size | What it is |
|------|------|-----------|
| `tsc-errors.txt` | 0 B | empty |
| `tsc-output.txt` | 1.2 KB | UTF-16 `tsc` dump, webgpu-context parse errors |
| `router-read.txt` | 43 KB | a copy of `src/browser/navigation/router.ts` |
| `_new-session-doc.md` | 729 B | draft of the search-subsystem doc |

Nothing was deleted and nothing was committed on `main` — both need your say-so.

### Still blocked
| Item | Why |
|------|-----|
| Emulator test plan after AEHD install | `sc query aehd` → the service does not exist. The `NovaEmu` AVD is there; the hypervisor driver is not, and installing one is an elevated change to your machine. |
| Sign the R8 release APK, smoke-test it | No `android/keystore.properties` and no `.jks`, so `assembleRelease` yields `app-release-unsigned.apk` (1,510,972 B). The signing identity is yours to create; `android:smoke-test` needs the phone regardless. |
| The three on-device checks (×2 listed twice) | `adb devices` still empty. |

## Verification steps taken
1. Read the four `2026-10-18-*` entries in `doc/analytics-todos.js` and the three docs they cite.
2. Traced both long-press paths (`wireContextMenuDetection`, `PageContextMenuController.onContextMenu`) before editing, to find why the double menu was possible at all.
3. Wrote both regression tests, ran them green, then reverted each fix to confirm the test fails without it, and restored.
4. Rebuilt the web bundle and re-ran the previously failing Electron fidelity spec.
5. Checked `adb devices` before, not after, planning the device items.
