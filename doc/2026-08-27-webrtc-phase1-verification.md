# WebRTC Phase 1 — Verification Run & Fixes

**Date:** 2026-08-27
**Session:** Verified `doc/2026-08-27-webrtc-phase1-ice-datachannel.md` (previously **not run** — file-bridge access only), fixed the 3 issues that surfaced under a real shell, and confirmed the whole suite green.
**Status:** Completed

---

## Summary

The WebRTC Phase 1 package (`stun-client.ts`, `ice-agent.ts`, `rtc-api.ts` + 3 tests) had never been run — every claim was unverified. This session ran the exact commands the changelog specified, found 3 discrete problems (1 typecheck error, 1 test-assertion bug, 1 real event-ordering bug in the remote data-channel path), fixed all three, and re-ran to a fully green baseline.

## Root Causes

### 1. Typecheck error — `dgram.AddressInfo` doesn't exist as a namespace member
**File:** `tests/stun-client.test.ts:83` (also used the pattern at line 1 area)
**Problem:** `(server.address() as dgram.AddressInfo)` failed `tsc --noEmit` with `TS2694: Namespace 'node:dgram' has no exported member 'AddressInfo'`. `@types/node` imports `AddressInfo` from `node:net` but does not re-export it under the `dgram` namespace.
**Fix:** Use the repo's established convention — `tests/dev-proxy-http-client.test.ts` imports it as `import type { AddressInfo } from 'node:net'`. Applied the same import and cast.

### 2. Test assertion bug — `Array.prototype.join` renders `null` as empty string
**File:** `tests/rtc-api.test.ts:66`
**Problem:** The test built `[signalingState, iceGatheringState, iceConnectionState, localDescription, remoteDescription].join('|')` and expected `'stable|new|new|null|null'`. Source correctly returns `null` for the two descriptions (`rtc-api.ts:706-707`), but JS `join()` coerces `null`/`undefined` to an **empty string**, not `"null"`. Actual output was `'stable|new|new||'`.
**Fix:** Corrected the expectation to `'stable|new|new||'`. Source was already correct.

### 3. Real ordering bug — remote data channel never appeared `open` on the receiving peer
**File:** `src/browser/js/rtc-api.ts:498-508` (`maybeStartConnectivityChecks`, remote branch)
**Problem:** In an offer/answer exchange, only the offering peer (A) — which calls `createDataChannel()` locally and attaches `onopen` synchronously — saw its channel open. The receiving peer (B) got `datachannel` then a channel that never fired `open` (`openedB` stayed `false`). Two stacked causes:
  1. The original code called `bundle.markOpen(reliable)` **before** queuing the `datachannel` event, so `open` fired before B's `ondatachannel` handler could attach `onopen`.
  2. The first attempted fix (dispatch `datachannel` synchronously before `markOpen`) failed with `No JS interpreter registered — cannot call non-native function` at `emitHandlerEvent` — page handlers can only be invoked from inside a microtask (interpreter context), which is why the original used `enqueueMicrotask`.
**Fix:** Keep `datachannel` dispatched via `enqueueMicrotask`, and call `markOpen(reliable)` from **inside that same microtask after** the dispatch. `markOpen` enqueues the `open` event as a subsequent microtask, so the `ondatachannel` handler has already attached `onopen` by the time `open` fires.
```ts
eventLoop.enqueueMicrotask(() => {
  emitHandlerEvent(pc, pc.__pcHandlers, 'datachannel', createEventObject('datachannel', { channel: bundle.jsObject }));
  bundle.markOpen(reliable);
});
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/rtc-api.ts` | Remote data-channel path: moved `markOpen` to run after the `datachannel` microtask dispatch (fix #3) |
| `tests/rtc-api.test.ts` | Fixed initial-state assertion to `'stable|new|new||'` (fix #2) |
| `tests/stun-client.test.ts` | Imported `AddressInfo` from `node:net` instead of `dgram` (fix #1) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-08-27-webrtc-phase1-verification.md` | This change log |

No source files were newly created this session (all WebRTC Phase 1 files already existed in the repo).

## Test Results

```
$ npx tsc --noEmit          → EXIT 0
$ npx eslint src/browser/js/rtc-api.ts tests/rtc-api.test.ts tests/stun-client.test.ts → EXIT 0
$ npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts
  Test Files  3 passed (3)
  Tests       23 passed (23)      (8 STUN + 8 ICE + 7 rtc-api, incl. real loopback UDP end-to-end)
$ npx vitest run              → full suite
  Test Files  208 passed (208)
  Tests       9105 passed (9105)
  Duration    146.81s
```

## Verification Steps

1. `npx tsc --noEmit` — clean (fix #1).
2. `npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts` — 23/23, including the two-peer offer/answer/ICE/data-channel send/receive integration test over real loopback UDP (fixes #2, #3).
3. `npx vitest run` (full 208-file suite) — 9105/9105 green, no regressions from the `rtc-api.ts` change.
4. `npx eslint` on the 3 touched files — clean.
