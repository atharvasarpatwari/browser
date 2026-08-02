# Static Build Keep-Alive & Renderer Health Probe

**Date:** 2026-08-02
**Session:** Added a main-process watchdog to the Electron shell so the browser runs from the static build, stays open, and self-recovers from renderer crashes — with a runtime health probe + health log.
**Status:** Completed

---

## Summary
The Electron shell (`electron/main.cjs`) previously had zero crash handling: a renderer crash or closed window silently quit the app. Added a 5-second watchdog that pings the renderer via a new `window.__novaHealthProbe`, recreates a destroyed window (keep-alive), reloads a crashed/unresponsive renderer, and appends timestamped `ALIVE`/`UNRESPONSIVE`/`RECREATED`/`RELOADED` entries to `nova-health.log`. A new Playwright e2e spec proves the app stays open and the probe reports `{ ok, running, mounted, uptimeMs }` across multiple watchdog ticks.

## Root Causes (if bug fix)
### 1. App quit silently on renderer crash / window close
**File:** `electron/main.cjs`
**Problem:** No `render-process-gone`/`unresponsive` handlers, and `window-all-closed` unconditionally called `app.quit()` (win32). A crash or closed window meant the browser "wasn't staying open."
**Fix:** Added crash-resilience events (reload on `render-process-gone`, escalation reload after 15s `unresponsive`, log `did-fail-load`) and changed `window-all-closed` to recreate the window unless the app is explicitly quitting (`quitting` guard set in `before-quit`). The watchdog also recreates on the next tick if a race slips past.

### 2. No way to observe renderer liveness from the main process
**File:** `src/app/main.ts`
**Problem:** The main process had nothing to ping; liveness was only observable by a human watching the window.
**Fix:** Added `installRendererHealthProbe()` at the entry point which sets `globalThis.__novaHealthProbe` to return `{ ok, running, mounted, uptimeMs, title, readyState }`. Also added a public `ApplicationBootstrap.isRunning()` accessor. The watchdog executes this probe through `webContents.executeJavaScript` with a 2s timeout.

## Files Modified
| File | Change |
|------|--------|
| `electron/main.cjs` | Watchdog (5s interval), crash-resilience handlers, keep-alive window recreation, `quitting` guard, `nova-health.log` writer, `NOVA_HEALTH_LOG=0` opt-out |
| `src/app/main.ts` | `installRendererHealthProbe()` at entry point; public `isRunning()` accessor |

## Files Created
| File | Purpose |
|------|---------|
| `tests/e2e/keep-alive.spec.ts` | Proves app stays open + probe reports `ok/running/mounted` with growing `uptimeMs` over 8s |
| `nova-health.log` | Runtime watchdog log (generated at runtime; gitignored target) |

## Test Results
```
> npx tsc --noEmit
20 lines — only the 10 pre-existing src/browser/js errors (interpreter, values, vm, web-apis, websocket-api). No new errors.

> npm run test:electron
  ✓ 1 tests\e2e\electron-smoke.spec.ts › Nova Browser launches in Electron and renders content (10.2s)
  ✓ 2 tests\e2e\keep-alive.spec.ts › Nova Browser stays open and responsive via the health probe (9.8s)
  2 passed (21.7s)

> npx vitest run tests/protocol-handler.test.ts tests/gateway-protocols.test.ts tests/page-renderer.test.ts
  3 files / 147 tests passed

> npx eslint src/app/main.ts tests/e2e/keep-alive.spec.ts
  0 errors, 4 warnings (pre-existing: unused LifecycleManager imports, 2 no-explicit-any)
```

### Live static-build run (manual launch)
```
[2026-08-02T02:06:03.957Z] APP_READY
[2026-08-02T02:06:08.970Z] ALIVE probe={"ok":true,"running":true,"mounted":true,"uptimeMs":4587,...}
... (ALIVE every ~5s)
[2026-08-02T02:06:58.615Z] APP_READY
[2026-08-02T02:06:59.189Z] WINDOW_CLOSED
[2026-08-02T02:06:59.191Z] WINDOW_ALL_CLOSED recreate
[2026-08-02T02:07:03.623Z] ALIVE probe={"ok":true,...,"uptimeMs":3792,...}
[2026-08-02T02:07:05.154Z] APP_QUIT
```

### Keep-alive close test (`keep-alive-check.cjs`)
```
WINDOW_1_OPEN 1
AFTER_CLOSE_WINDOW_COUNT 1
KEEP_ALIVE_OK
```
After `BrowserWindow.close()`, the watchdog recreated the window and resumed `ALIVE` pings.

## Verification Steps
1. `npx tsc --noEmit` — no new errors.
2. `npm run test:electron` — smoke + new keep-alive spec pass.
3. Launched static build (`electron .`), confirmed 4 electron processes alive and `nova-health.log` showing repeated `ALIVE` pings with growing `uptimeMs`.
4. Programmatically closed the window via `app.evaluate(BrowserWindow...close())` → window recreated, count back to 1, `ALIVE` resumed.
