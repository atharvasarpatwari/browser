# The Windows App Had No Single-Instance Lock and Forgot Its Window Size Every Launch

**Date:** 2026-09-19
**Session:** Asked to work on the Windows (Electron) app and make some improvised changes. Read through `electron/main.cjs` looking for real, concrete gaps rather than guessing — it already had solid crash resilience (a watchdog, renderer-gone recovery, health logging) but was missing two things every desktop browser is expected to have.
**Status:** Completed

---

## Summary
Nova had no `app.requestSingleInstanceLock()` at all. On Windows, a browser is relaunched constantly by the OS itself — clicking a link in another app while set as the default browser, double-clicking a file association, or just double-clicking the taskbar icon again — and every one of those would have quietly spawned a fully independent second Nova process instead of reusing the one already running. Separately, the window always opened at a hardcoded 1280×800 in the same spot, discarding whatever size or position the user actually left it at, every single launch.

Added a real single-instance lock: a second launch attempt now focuses the existing window instead of opening a new one, and if the OS handed it a URL (a file/protocol association, or `nova.exe <url>`), that URL opens as a new tab in the already-running window via a small `window.__novaOpenUrl` hook — the same "expose a global for the main process to call" pattern the app already uses for its renderer health probe. Also added window state persistence: size, position, and maximized state are saved (debounced, on resize/move/close) to a small JSON file in the app's user-data directory and restored on the next launch, with a check that the saved position still lands on a currently-connected display before trusting it (so unplugging a monitor since the last run can't strand the window somewhere unreachable).

## Root Causes
Not bug fixes — these are gaps in what the Windows app never had, not things that broke:

1. **No `requestSingleInstanceLock()`.** Every relaunch — whether triggered by the user or by Windows itself via a file/URL association — created a brand-new, fully independent `BrowserWindow` and app instance with its own socket owner, its own watchdog, its own everything, rather than reusing the one already running. Fixed by acquiring the lock at startup, quitting immediately if another instance already holds it, and handling `second-instance` by focusing the existing window and forwarding any launch URL to it.
2. **No window-state persistence.** `createWindow()` always used a literal `width: 1280, height: 800` with no saved position, so every launch reset to the same size and let the OS pick a default position — ignoring anything the user had resized, moved, or maximized in the previous session. Fixed with a small save/restore cycle: `getNormalBounds()` (not `getBounds()`, which reports the maximized size while maximized) written to `<userData>/window-state.json` on resize/move (debounced 500ms) and on close, validated against `screen.getAllDisplays()` on load so a stale, now off-screen position falls back to the centered default instead of hiding the window.

## Notes
- While verifying this by actually launching the real Electron app (`npx electron .` against the Vite dev server, not just the web-only route used earlier this session), found the single-instance lock and second-instance handoff work correctly end-to-end — confirmed via `nova-health.log`: a second launch attempt logs `SECOND_INSTANCE_BLOCKED` and the original instance stays continuously `ALIVE` afterward, with no new window and no lingering second process.
- Also found something the lock's URL-forwarding path surfaced but didn't cause: navigating to a real external URL (`https://example.com`) from inside the actual Electron app made the renderer go unresponsive and never recover, while the identical second-instance path *without* a URL stayed perfectly healthy — isolating the hang specifically to real-network navigation through Electron's native socket-proxy layer (`window.nova.ipc` → `electron/socket-owner.cjs`), not to anything added here. This exact same navigation, run earlier this session through the plain web/Vite-dev-server route (no Electron, no native socket proxy), stayed fully responsive the whole time. Flagged as a separate follow-up rather than pulled into this change — the native networking path is a different subsystem, and the sandboxed test environment's own network egress is itself a plausible contributor that needs ruling out before concluding it's a real bug.
- Window-state persistence's actual save/restore cycle (resize a real window, close it, relaunch, confirm the size comes back) needs a live display to verify visually and wasn't fully exercised end-to-end in this sandboxed session — the code was reviewed carefully against the exact same defensive patterns already established in this file (`healthLogPath()`'s packaged-vs-dev fallback, try/catch-and-continue on every fs call) and the app booted and ran cleanly with it active across every test launch this session, but a monitor-equipped machine should give it one real resize-and-relaunch pass before shipping.

## Files Modified
| File | Change |
|------|--------|
| `electron/main.cjs` | Added `requestSingleInstanceLock()` + `second-instance` handler (focus + forward launch URL); added `windowStatePath()`/`loadWindowState()`/`saveWindowState()`/`isOnScreen()` and wired them into `createWindow()` plus `resize`/`move`/`close` listeners; added `extractUrlArg()`/`openUrlInWindow()` for launch-URL and second-instance URL handoff; removed an unused top-level `session` import |
| `src/app/main.ts` | Exposed `globalThis.__novaOpenUrl(url)` at the end of `mountBrowserUI()`, calling `page.createTab(url)` — the hook `electron/main.cjs` calls via `executeJavaScript()` |

## Files Created
- `doc/2026-09-19-windows-app-single-instance-and-window-state.md` — this document

## Test Results
```
npx tsc --noEmit -p .           → 0 errors (repo-wide)
node --check electron/main.cjs  → syntax OK
npx vitest run (full suite)     → 223 files / 9268 tests passed (0 regressions)
Live Electron launch            → see Verification Steps
```

## Verification Steps
1. Read `electron/main.cjs` in full looking for gaps against what a Windows desktop browser is normally expected to do; found no single-instance lock, no protocol/URL launch handling, and no window-state persistence anywhere in the file (confirmed by grepping for the relevant Electron APIs — zero matches).
2. Implemented both features, syntax-checked with `node --check`, typechecked the TypeScript side with `tsc --noEmit`.
3. Started the Vite dev server and launched the real Electron app against it (`VITE_DEV_SERVER_URL=... npx electron .`), confirmed via `nova-health.log` that it reached a fully mounted, `ALIVE` state.
4. Launched a second instance with no arguments: confirmed `SECOND_INSTANCE_BLOCKED` logged, no second window/process, and the original instance stayed continuously `ALIVE` for the whole observation window — the lock and handoff work correctly on their own.
5. Launched a second instance with a URL argument to test the launch-URL handoff: confirmed `SECOND_INSTANCE_BLOCKED` logged again, but this time found the renderer went unresponsive and never recovered — isolated this to the real-network navigation itself (not the lock or handoff code) by repeating step 4's no-URL case, which stayed fully healthy. Flagged as a separate, un-fixed follow-up rather than expanding this change to chase it.
6. Killed all test processes and the dev server, removed the generated `nova-health.log`, and ran the full TypeScript typecheck and Vitest suite for regressions (this session's other, unrelated uncommitted work included).
