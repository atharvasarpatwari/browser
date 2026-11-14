# Nova for Windows, Phase 0: A Clean Windows Build, One Running Instance, Launch Addresses

**Date:** 2026-11-14
**Session:** "this implementation for the windows application (.exe) ... looks like a real search engine" (plan: `C:\Users\athar\.claude\plans\replicated-tickling-ember.md`, Phase 0 of 3)
**Status:** Completed. Phases 1 (Nova's own search engine front end) and 2 (Android parity: compatibility renderer, downloads, blocking) are next.

---

## Summary
The Electron shell and the NSIS configuration already existed. This phase makes them build cleanly again, outside the repository (the old `win-unpacked.tmp` file lock inside `E:\nova_1` no longer matters), and adds what a Windows app needs from the start: one running instance per profile, a Windows app id, and links handed to the app opening in a tab.

## Changes
### 1. One running instance, with a hand-over
**File:** `electron/main.cjs`
A second launch (the shortcut clicked twice, a link opened with Nova as the target) now hands its address to the running window, which is restored and focused, and exits. The lock is per profile directory, so test runs with their own `--user-data-dir` are unaffected; `NOVA_ALLOW_MULTIPLE_INSTANCES=1` turns the lock off.

### 2. A Windows app id
**File:** `electron/main.cjs`
`app.setAppUserModelId('com.nova.browser')` (the builder's `appId`): the taskbar button and notifications are grouped under Nova, not Electron's default.

### 3. Launch addresses open in a tab
**Files:** `electron/main.cjs`, `electron/preload.cjs`, `src/app/desktop-launch.ts`, `src/app/main.ts`
The main process takes the first `http(s)://`, `nova://` or `about:newtab` argument of the command line (anything else, scripts and file paths included, is ignored; dev runs skip the app path) and keeps it for the renderer. The preload exposes `window.nova.app` (`takeLaunchUrl()` once, `onOpenUrl(handler)` for later launches). `installDesktopLaunchUrls` (desktop only, not the Android host) opens each in a new tab with `page.createTab(url)` and re-checks the scheme.

### 4. Version
**File:** `package.json`: 1.0.0 to 2.16.0, the Android versionName, so the installer is named `Nova Browser Setup 2.16.0.exe`.

## Files Modified
| File | Change |
|------|--------|
| `electron/main.cjs` | single-instance lock and hand-over, app user model id, launch address from the command line, IPC handler |
| `electron/preload.cjs` | `window.nova.app` bridge |
| `src/app/main.ts` | desktop only: open launch addresses in tabs |
| `package.json` | version 2.16.0 |

## Files Created
| File | Purpose |
|------|--------|
| `src/app/desktop-launch.ts` | renderer side of the launch addresses (scheme allowlist) |
| `tests/desktop-launch-217.test.ts` | 4 tests: start-up and later addresses open; scripts, file paths and data URLs are ignored; no address opens nothing; unsubscribe and no-bridge cases |

## Test Results
```
npx tsc --noEmit -p .                         -> clean
npx vitest run tests/desktop-launch-217.test.ts -> 4 passed
npx vitest run                                -> Test Files 348 passed (348); Tests 11495 passed (11495)
node --check electron/main.cjs, electron/preload.cjs -> ok
npx vite build                                -> built in 5.09 s
npx electron-builder --win --dir -c.directories.output=C:\Users\athar\AppData\Local\Temp\nova-win -> win-unpacked\Nova Browser.exe (electron 41.7.1)
npx electron-builder --win nsis --prepackaged <win-unpacked> -> Nova Browser Setup 2.16.0.exe, 97,874,497 bytes
  SHA-256 067997281F1D02E3141FE208510506364E23BEF54ABC65A3EEB7A5F538380B20; Authenticode: NotSigned (no certificate; SmartScreen will warn)

Smoke test of the unpacked app, throwaway profile (%TEMP%\nova-smoke-profile), health log:
  SOCKET_OWNER_READY, SECURITY_POLICIES_INSTALLED, APP_READY, ALIVE probe={"ok":true,"running":true,"mounted":true,"title":"Nova Browser","readyState":"complete"} (every 5 s)
  second launch with https://example.com/second -> the second process exited; the first logged SECOND_INSTANCE url=https://example.com/second and stayed alive
  AUTO_UPDATE_UNAVAILABLE (electron-updater is not bundled: unchanged behaviour)
  all test processes stopped afterwards; the temp profile removed
```

## Not done in this phase (recorded)
- That the second launch's address really appears as a tab was not observed in the window (the log shows the hand-over, the unit tests cover the renderer helper); the Electron end-to-end run in Phase 3 will check it.
- The Setup .exe was built but **not installed or run** on this machine.
- No code signing; no `.ico` (electron-builder converted `build/icon.png` without a warning).
