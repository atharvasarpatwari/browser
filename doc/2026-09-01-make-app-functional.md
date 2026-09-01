# Make App Functional — Dynamic Repaint Wiring & Verification

**Date:** 2026-09-01
**Session:** End-to-end functionality pass: dynamic repaint wiring fix, full regression, Windows desktop + installer verification, repo hygiene.
**Status:** Completed

---

## Summary

Nova Browser's rendering pipeline was architecturally complete (HTML → DOM → CSS → Layout → Paint → Rasterize → Canvas) but dynamic post-load updates never reached the screen because the `PageRenderer.onFrameRendered` callback was never wired. This session fixed that single-point gap, then verified the full stack end-to-end: 9108 unit tests pass, `electron:dev` boots green, and the packaged Windows app + NSIS installer both run with continuous green watchdog probes. All accumulated uncommitted working-tree changes from the 08-27/08-28 sessions were committed.

## Root Causes

### 1. Dynamic repaints silently dropped
**File:** `src/app/main.ts` (`mountBrowserUI`, PageRenderer construction ~line 809)
**Problem:** When `PageRenderer` was constructed, the `onFrameRendered` dependency was omitted. Inside the render pipeline, `ReflowRepaintController` invokes `this.deps.onFrameRendered?.()` on each incremental frame (animations, async image decodes, JS-triggered DOM mutations). Since the callback was `undefined`, the frames produced new paint commands and pixel data in the paint engine but **never pushed them to the `<canvas>`**. Only the initial `pageLoadReady` render displayed; everything dynamic after first paint was invisible.
**Fix:** Wired the callback to the engine's repaint notifier:

```ts
const pageRenderer = new PageRenderer({
  // ...existing deps...
  securityLayer,
  onFrameRendered: () => engine.notifyPageRepainted(),
});
```

`engine.notifyPageRepainted()` emits a `pageRepainted` event, which the `NavigationFetcher` (UI) listens for to call `paintEngine.rasterize()` → `contentRenderer.renderFromImageData()`, i.e. repainting the canvas.

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Added `onFrameRendered: () => engine.notifyPageRepainted()` to the `PageRenderer` constructor |
| `.gitignore` | Ignore `nova-android-engine-sync-full.zip` (manual Android bundle sync artifact) |

## Files Committed (accumulated 08-27/08-28 working tree)

| File | Purpose |
|------|---------|
| `electron/main.cjs` | Windows blank-window fix (nodeIntegration:true/contextIsolation:false + packaged health-log path) |
| `src/browser/js/index.ts`, `rtc-api.ts` | WebRTC Phase 1 integration |
| `src/browser/networking/ice-agent.ts`, `stun-client.ts` | WebRTC ICE/STUN clients |
| `tests/{ice-agent,rtc-api,stun-client}.test.ts` | WebRTC Phase 1 tests |
| `android/**` | Native Android app + built asset bundles (removed obsolete Capacitor/com/ mirror) |
| `doc/2026-08-27*`, `doc/2026-08-28*`, `doc/webrtc-implementation-plan.md` | Prior session change logs |
| `package-lock.json`, `TODO.md`, `doc/README.md` | Dependency/docs updates |

## Test Results

```
npm run typecheck
  → PASS (0 errors)

npm run test  (full suite)
  Test Files  208 passed (208)
       Tests  9108 passed (9108)
     Duration 159.68s
```

## Verification Steps

1. **`npm run typecheck`** — clean, no regressions from the wiring change.
2. **`npm run electron:dev`** — Electron launched against the Vite dev server; the watchdog health probe reported continuously:
   ```
   {"ok":true,"running":true,"mounted":true,"title":"Nova Browser","readyState":"complete"}
   ```
3. **`npm run build:win`** — Vite production build (5.38s) + electron-builder NSIS packaging succeeded:
   - `release\win-unpacked\Nova Browser.exe` (packaged, signed)
   - `release\Nova Browser Setup 1.0.0.exe` (installer)
4. **Packaged app runtime** — launched `win-unpacked\Nova Browser.exe`; health log (userData, `%APPDATA%\Nova Browser\nova-health.log`) showed every 5s probe green (`ok:true, running:true, mounted:true`) for the entire run — no blank window, no UNRESPONSIVE, no RENDERER_GONE. **This closes the long-pending Windows desktop blank-window verification.**
5. **Commit** — `049a63c` (68 files; 3352 insertions, 4124 deletions).

## Notes / Follow-ups

- The `onFrameRendered` fix is a one-line wiring addition; it carries no new security surface.
- Long-term security posture (`contextIsolation:true`) still requires rewriting the networking layer to avoid bare Node `Buffer` (documented in `2026-08-28-windows-app-health-and-buffer-fix.md`). The current `nodeIntegration:true` config remains the functional MVP default.
- Manual on-device Android feature pass and a populated `known-test-failures.md` remain open follow-ups.
