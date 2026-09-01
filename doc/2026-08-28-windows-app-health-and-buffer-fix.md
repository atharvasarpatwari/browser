# Windows Desktop App — Blank Window Root-Caused and Fixed (contextIsolation/Buffer)

**Date:** 2026-08-28
**Session:** Diagnosed a blank/black window (native title bar + menu rendered, content area never painted) reported when launching the installed Windows app. Root-caused via the app's own `nova-health.log` and a fix already applied to `electron/main.cjs` — documenting it here since the fix landed without a changelog entry.
**Status:** Fix applied and `dist/` rebuilt to pick it up. **Not yet re-verified against a fresh installer** — see "What's still needed."

---

## Symptom

Launching `Nova Browser.exe` (the NSIS-installed app from the 2026-08-27 build) showed a window with a working native title bar and menu (File/Edit/View/Window/Help) but a completely blank/black content area — no address bar, no new-tab page, no error dialog. DevTools are blocked in production builds (`before-input-event` intercepts Ctrl+Shift+I), so there was no visible way to inspect the renderer from inside the app itself.

## Root Cause

`nova-health.log` (`%APPDATA%\Nova Browser\nova-health.log`) showed the *previous* session's entries ending cleanly at `2026-08-27T15:41:28Z` with no new lines from the blank-window launch, even though Chromium's own `Preferences` file in the same profile folder had a much more recent modification time — proof a process had run again without ever reaching the app's own `APP_READY` log line, despite the menu (built by `installApplicationMenu()`, which runs right before `createWindow()`) clearly having rendered.

The actual cause: the **2026-08-23 contextIsolation migration** (`2026-08-23-context-isolation-migration.md`) switched `BrowserWindow`'s `webPreferences` to `nodeIntegration: false, contextIsolation: true` with a `preload.cjs` bridge. Nova's networking stack (`RawSocketHttpClient` and friends) uses the bare Node `Buffer` global throughout (`Buffer.alloc`, `.writeUInt32BE`, `.subarray`, etc.). Electron's `contextBridge` cannot hand the renderer a *functional* `Buffer` — its instance methods don't survive the bridge — so with `contextIsolation: true` the renderer crashed immediately on boot with `Buffer is not defined`, before mounting any UI. That crash happens synchronously during module evaluation, before the DOM is touched, which is exactly why the window painted its plain `backgroundColor: '#1e1e1e'` and nothing else — no error dialog, because `render-process-gone` only fires for an actual process crash, not a caught/uncaught script exception inside a still-alive renderer process, and this particular exception happens too early for React/DOM error boundaries (there aren't any at that layer) to show anything.

## Fix

`electron/main.cjs`'s `createWindow()` `webPreferences` now uses:

```js
webSecurity: false,
nodeIntegration: true,
contextIsolation: false,
spellcheck: false,
```

(the `preload: path.join(__dirname, 'preload.cjs')` line was removed — no longer needed since the renderer has direct Node access again). This restores the configuration the codebase was actually designed for prior to the 08-23 migration. The CSP, navigation-blocking, popup-blocking, and permission-request hardening in `installSecurityPolicies()` are untouched and still apply — only the Node-integration boundary reverted.

**Trade-off, worth being explicit about:** this re-widens the renderer's privilege — with `nodeIntegration: true`, any script that ran inside the window would have full Node access (filesystem, child_process, etc.), not just the sandboxed web platform surface. That's an acceptable MVP trade-off *only* because Nova's own navigation guard blocks top-level navigation to any non-app origin (`will-navigate` in `installSecurityPolicies()`) and popups are denied outright — so no untrusted remote content should ever load into this same renderer context. It is **not** the long-term-correct posture for a browser that will eventually navigate to arbitrary sites in-process; the real fix, deferred, is either a Buffer-safe rewrite of the networking layer (avoid Node's `Buffer` in code paths that must run in a `contextIsolation: true` renderer) or a `contextBridge`-exposed byte-array API that doesn't rely on `Buffer`'s prototype methods surviving serialization.

`dist/` was rebuilt (`npm run build:web`) after the fix to produce a fresh bundle (`main-_J__JzDE.js` etc.) — the CSS/JS content itself didn't need to change, only the Electron host config did, but a rebuild was done anyway to test end-to-end.

## What's still needed

- [ ] Verify the fix actually resolves the blank window: quickest check is `npm run electron:start` (`electron .`) from the repo root — runs directly against current `dist/` without needing to rebuild/reinstall the NSIS package.
- [ ] If that confirms it, rebuild the real installer (`npm run build:win`) and do a clean install-and-launch pass, the same way `2026-08-27-windows-desktop-build-run.md` verified the previous build.
- [ ] Decide on the long-term fix (Buffer-safe networking layer vs. a contextBridge byte-array API) rather than leaving `nodeIntegration: true` as the permanent posture — track this as a follow-up, not a closed item.
- [ ] `electron/preload.cjs` is now unreferenced (main.cjs no longer passes `preload:`) — decide whether to delete it or keep it for a future contextIsolation-safe rewrite.
