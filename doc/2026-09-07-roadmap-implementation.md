# Roadmap Implementation — Dead-WebRTC Removal, Engines, Typecheck, Remote Debugging

**Date:** 2026-09-07
**Session:** Implement the near-term slice of the strategic roadmap (Track A quick win + Track B hygiene)
**Status:** Completed

---

## Summary
Delivered four roadmap items: deleted the obsolete simulated `RTCPeerConnection` (A2), added an explicit Node engine floor to `package.json` (B2), populated the TypeScript-errors table in `doc/known-test-failures.md` (B7), and added opt-in DevTools protocol exposure to the Electron host (A3). Full suite green, tsc + lint clean, CDP endpoint verified against a real launch.

## Changes

### A2 — Remove dead `src/browser/media/webrtc.ts` (committed `74288db`)
**File:** `src/browser/media/webrtc.ts` (deleted), `src/browser/media/index.ts`, `tests/web-apis.test.ts`
**Problem:** The old `media/webrtc.ts` was a fully simulated `RTCPeerConnection` (transitions straight to `iceConnectionState='connected'`) that was never wired into the JS VM — `window.RTCPeerConnection` comes from `src/browser/js/rtc-api.ts` (`createGlobalEnv`). It was dead weight whose only importer was a stale test block in `tests/web-apis.test.ts` asserting the *simulation's* impossible behavior (e.g. `addIceCandidate()` → instantly `connected`, `iceGatheringState` → `complete`).
**Fix:**
```ts
// media/index.ts — removed these re-exports
export { RTCPeerConnection } from './webrtc';
export type { IRTCPeerConnection, RTCSignalingState, … } from './webrtc';
```
Deleted `webrtc.ts`, its barrel re-exports, and the obsolete `describe('RTCPeerConnection', …)` block (10 tests). Real coverage remains in `tests/rtc-api.test.ts` (real loopback-UDP offer/answer/ICE/data-channel round trip).

### B2 — Explicit Node engines floor
**File:** `package.json`
**Problem:** TODO claimed the repo's `engines` expected `>=22`, but no `engines` field existed at all — a future dependency bump could silently require a newer node than the v20.19.1 dev machine.
**Fix:**
```json
"engines": { "node": ">=20.19.0" }
```
(the real toolchain floor — Vite 8 needs `^20.19.0 || >=22.12.0`). Verified: `v20.19.1 satisfies >=20.19.0 → true`.

### B7 — Typecheck table populated
**File:** `doc/known-test-failures.md`
`npx tsc --noEmit` run 2026-09-07 → **0 errors** repo-wide; replaced the template row.

### A3 — DevTools protocol exposure (remote debugging)
**File:** `electron/main.cjs`
**Problem:** Packaged/production app had no way to attach external DevTools; only dev mode got `openDevTools()`.
**Fix:**
```js
const REMOTE_DEBUG_PORT = process.env.NOVA_REMOTE_DEBUGGING_PORT
if (REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', REMOTE_DEBUG_PORT)
}
```
plus a health-log entry `REMOTE_DEBUGGING_ENABLED port=<n>`. Opt-in via `NOVA_REMOTE_DEBUGGING_PORT` env var — OFF by default (an open CDP port lets any local process inspect/control the renderer, so it must never be on implicitly).

## Files Modified
| File | Change |
|------|--------|
| `package.json` | Added `engines: { node: ">=20.19.0" }` |
| `electron/main.cjs` | Opt-in `--remote-debugging-port` via `NOVA_REMOTE_DEBUGGING_PORT` + health-log entry |
| `doc/known-test-failures.md` | TypeScript-errors table filled (0 errors) |
| `doc/README.md` | Rows for this session + roadmap |
| `TODO.md` | WebRTC dead-weight item done; engines item done; typecheck item done; DevTools item done |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-07-strategic-roadmap.md` | The approved strategic roadmap (Track A web-platform / Track B ship-ready / Track C architecture) |

## Test Results
```
npx tsc --noEmit            → 0 errors (repo-wide)
npx eslint tests/web-apis.test.ts src/browser/media/index.ts  → clean
npx vitest run tests/web-apis.test.ts tests/rtc-api.test.ts tests/ice-agent.test.ts tests/stun-client.test.ts
                            → 4 files / 103 tests passed
npm test                    → 216/216 files, 9178/9178 tests passed
npm run build:web           → built in 5.24s
node --check electron/main.cjs → syntax OK
```

## Verification steps taken
1. `tsc --noEmit` clean before and after the deletion.
2. Grep confirmed the sole importer of `media/webrtc` was the stale test block.
3. Launched Electron with `NOVA_REMOTE_DEBUGGING_PORT=9229` against the built `dist/`:
   - `GET http://127.0.0.1:9229/json/list` → 1 page target, `title: Nova Browser`, `url: file:///…/dist/index.html`, valid `webSocketDebuggerUrl`.
   - `nova-health.log` contains `REMOTE_DEBUGGING_ENABLED port=9229` before `APP_READY`.
   - All Electron processes terminated afterwards (no leftovers).

## Deferred (needs dedicated sessions — see `doc/2026-09-07-strategic-roadmap.md`)
- WebRTC Phase 2 (real DTLS+SCTP interop) — multi-week, own design doc first.
- Service Workers/PWA, WASM execution, TURN/trickle-ICE, CSS containment/subgrid.
- Auto-update live release test, macOS/Linux CI legs, code-signing, Android release keystore.