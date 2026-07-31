# Electron Launch Plan — Nova Browser as a Public Windows Desktop App

**Date:** 2026-07-31
**Session:** Plan for shipping Nova Browser to the public as a Windows desktop app.
**Status:** Completed (approved — implementation follows)

---

## Goal
Ship an unsigned Windows installer to the public via GitHub Releases, built automatically by CI. The installed app has a real OS window, working page navigation, and local persistence.

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Shell | **Electron** | Matches gap analysis (`docs/browser-building-gap-analysis.md:169`); DOM/canvas rendering works unchanged; Node runtime available for future native bindings |
| Networking (MVP) | Chromium `fetch` + `webSecurity: false` | Engine already uses host `fetch` in browser context (`src/app/main.ts:401`); Nova's own security layer enforces SOP internally. Hardened later via main-process `net.fetch` |
| Window | Electron `BrowserWindow` | Replaces the simulated `WindowManager` at the OS level; in-app `WindowManager` remains the internal window model |
| Persistence | `localStorage` (auto-persisted to `userData` under `file://`) | No storage code changes for MVP |
| Native Rust bindings | **Out of v1** | `native/dist/win32-x64/nova_bindings.node` not yet built for Windows; JS fallbacks exist |
| Packaging | electron-builder + NSIS, assisted installer | Industry standard; `release/Nova Browser Setup 1.0.0.exe` |
| CI | GitHub Actions `release.yml`, tag-triggered | Public distribution channel; build on `windows-latest`, attach installer to Release |

## Key Facts Confirmed
- `dist/index.html` uses absolute asset paths (`/assets/main-*.js`) → breaks under `file://`; **requires `base: './'`** in `vite.config.ts`.
- Node v20.19.1, npm 10.8.2 — compatible with Electron + electron-builder.
- No `electron`/`electron-builder` installed yet.
- Playwright (`@playwright/test`) already a devDependency → use `_electron.launch` for the smoke test.
- Logo assets `logo-image.png` / `logo-symbol.png` exist for the app icon.

## Implementation Steps

### 1. Dependencies
```
npm i -D electron electron-builder concurrently wait-on
```
Add `release/` to `.gitignore`.

### 2. Vite base
Add `base: './'` to `vite.config.ts` so built assets resolve under `file://`.

### 3. Electron main process — `electron/main.cjs`
- `BrowserWindow` 1280×800, title "Nova Browser"
- `webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false }` (MVP tradeoff)
- Load `process.env.VITE_DEV_SERVER_URL` in dev, else `loadFile('dist/index.html')`
- Standard lifecycle (`window-all-closed`, `activate`), minimal application menu

### 4. npm scripts (`package.json`)
- `"main": "electron/main.cjs"`
- `electron:dev` — concurrently vite + wait-on + electron (dev URL)
- `build:win` — `vite build && electron-builder --win`
- `pack:win` — `vite build && electron-builder --win --dir` (fast unpacked test)

### 5. `electron-builder.yml`
- `appId: com.nova.browser`, `productName: "Nova Browser"`, version from package.json
- `files`: `electron/**`, `dist/index.html`, `dist/assets/**`
- `win.target: nsis`, `nsis: { oneClick: false, allowToChangeInstallationDirectory: true }`
- `win.icon: build/icon.png`, `directories.output: release`

### 6. App icon
`build/icon.png` at 256×256 derived from `logo-image.png` (electron-builder converts to ICO at ≥256px).

### 7. Smoke test — `tests/e2e/electron-smoke.spec.ts`
Playwright `_electron.launch({ args: ['.'] })`:
- Window opens, title "Nova Browser"
- `#browser-app` mounts, address bar present
- Navigate to `https://example.com`, content area updates

### 8. Verification checklist
1. `npm run build:web` → relative `./assets/...` paths in `dist/index.html`
2. `npm run pack:win` → launch `release/win-unpacked/Nova Browser.exe`
3. Navigate to example.com in the app
4. `npm run build:win` → `release/Nova Browser Setup 1.0.0.exe`
5. Install on clean Windows; relaunch; state persists
6. Full vitest suite + electron smoke test green

### 9. CI — `.github/workflows/release.yml` (core)
`windows-latest` job: `npm ci` → `npm run build:win` → upload `release/*.exe` to GitHub Release, triggered on tag push (`v1.0.0`).

### 10. Release
Tag `v1.0.0` → CI builds + attaches installer → share the GitHub Release URL.

## Deliverable
Publicly downloadable `Nova Browser Setup 1.0.0.exe` (~150 MB, unsigned — SmartScreen warns until signing added).

## Post-MVP Hardening (not in this launch)
- Main-process `net.fetch` routing (drop `webSecurity: false`)
- `contextIsolation: true` + strict preload bridge
- Code signing (paid cert) to remove SmartScreen warnings
- Auto-update via electron-updater + GitHub Releases
- Real multi-window (wire `WindowManager` to OS windows)
- Default `http(s)` protocol handler registration
- Package native `nova-bindings` (win-x64) with `asarUnpack`
