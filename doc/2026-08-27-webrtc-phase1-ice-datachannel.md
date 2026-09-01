# WebRTC Phase 1 — Real ICE/STUN + Data Channel, Wired into the JS VM

**Date:** 2026-08-27
**Session:** Implement Phase 1 of `doc/webrtc-implementation-plan.md` — real UDP-based ICE/STUN and a working (Nova-to-Nova) `RTCDataChannel`, exposing `RTCPeerConnection` to page JavaScript for the first time
**Status:** Completed (source changes). **Subsequently verified 2026-08-27 in `2026-08-27-webrtc-phase1-verification.md` — 3 issues found & fixed, full suite green.**

---

## Summary

`window.RTCPeerConnection` did not exist before this session — `TODO.md` and `docs/browser-building-gap-analysis.md` both correctly called WebRTC a fully open gap. A previously-added `src/browser/media/webrtc.ts` (2026-07-29) was a fully simulated `RTCPeerConnection` that always reported success regardless of real connectivity, and was never wired into `createGlobalEnv()`. This session implemented a real (if intentionally scoped-down) replacement: real STUN over real UDP for ICE candidate gathering and connectivity checks between two peers, and a real — but Nova-specific, not yet browser-interoperable — reliable data channel on top, exposed to page scripts as `RTCPeerConnection`/`RTCSessionDescription`/`RTCIceCandidate`/`RTCDataChannel`. See `doc/webrtc-implementation-plan.md` for the full phase breakdown and exactly what's deferred (DTLS, real SCTP, TURN, audio/video) and why.

## Root Causes

Not a bug fix — new subsystem. See "Architecture Decisions" instead.

## Architecture Decisions

- **Real UDP via `loadNodeBuiltin('node:dgram')`** — following the exact precedent `src/browser/networking/quic-transport.ts` already established (same lazy-load bridge, safe under `contextIsolation`). This resolved the biggest open question going in: whether UDP was available in this codebase at all. It is.
- **Honest SDP.** The data channel's SDP media line reads `m=application <port> NOVA/DATACHANNEL`, not the real `UDP/DTLS/SCTP` — deliberately, so nothing downstream (or a future session) mistakes Phase 1's output for spec-compliant, browser-interoperable SDP.
- **JS registration follows `websocket-api.ts` exactly** — `createObject(null)`/`callable: true`/`nativeFn` constructor pattern, `EventLoop.enqueueMicrotask` for event dispatch, direct property-stashing for per-instance state (`__pcXxx`/`__dcXxx`, mirroring `__wsXxx`) rather than the external-WeakMap pattern `fetch-api.ts` uses — `RTCPeerConnection` is a long-lived stateful connection object much closer in spirit to `WebSocket` than to `fetch()`'s one-shot `Request`/`Response`.
- **Async methods use `createWiredPromise`/`fulfillPromise`/`rejectPromise`** from `promise.ts` — the same primitives `fetch-api.ts`'s `createFetchFn` uses for a native method that returns a promise settled later by async native code.
- **Single data channel per connection.** Real WebRTC multiplexes many channels over one SCTP association; without real SCTP (Phase 2), there's no multiplexing layer to build multiple channels on top of, so `createDataChannel()` throws on a second call rather than pretending to support it.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/stun-client.ts` | RFC 5389 STUN Binding Request/Response encode/decode over real UDP |
| `src/browser/networking/ice-agent.ts` | Host + server-reflexive candidate gathering, STUN-based connectivity checks, SDP `a=candidate` line format/parse |
| `src/browser/js/rtc-api.ts` | `RTCPeerConnection`/`RTCSessionDescription`/`RTCIceCandidate`/`RTCDataChannel`, JS-VM-exposed; internal `ReliableChannel` framing for the data channel |
| `tests/stun-client.test.ts` | STUN encode/decode round-trips + a real loopback UDP exchange |
| `tests/ice-agent.test.ts` | Real candidate gathering + real loopback connectivity checks + data delivery |
| `tests/rtc-api.test.ts` | Full JS API surface + one end-to-end two-peer offer/answer/ICE/data-channel integration test, all real loopback UDP |
| `doc/webrtc-implementation-plan.md` | Phase 1–4 design doc |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/index.ts` | Imported `rtc-api.ts`'s exports; wired `RTCPeerConnection`/`RTCSessionDescription`/`RTCIceCandidate` into `createGlobalEnv()` right after the `WebSocket` wiring; re-exported the three factory functions alongside `createWebSocketClass` |
| `TODO.md` | Updated the "Modern Web Platform" item to reflect WebRTC Phase 1 in progress, linking the design doc |
| `doc/README.md` | Indexed this document and `webrtc-implementation-plan.md` |

## Test Results

**Not run this session.** File-bridge access only (list/read/write via the desktop bridge), no shell/npm/vitest access to the connected machine. Every file was written against the actual, directly-read contents of `websocket-api.ts`, `fetch-api.ts`, `promise.ts`, `index.ts`, and `quic-transport.ts` (not paraphrased from docs) specifically to minimize the chance of a syntax or convention mismatch, but **none of the following has been confirmed**:

- `npx tsc --noEmit` passes with the new files and the `index.ts` edits
- `npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts` actually pass — the STUN/ICE tests use real loopback UDP sockets and real timers, which behave differently in a CI sandbox than they might have been reasoned about here
- The custom JS engine's `Promise.prototype.then`/`.catch` semantics (used heavily in `tests/rtc-api.test.ts`'s nested-callback integration test) support everything the test script assumes

**Verification steps for whoever picks this up:**
```bash
npx tsc --noEmit
npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts
```
If the `rtc-api.test.ts` integration test times out or hangs, the most likely culprits, in order: (1) the custom JS engine's Promise chaining doesn't behave the way the nested `.then()` pyramid in the test assumes — try a simpler single-level `.then()` test first to isolate; (2) `node:dgram` isn't reachable via `loadNodeBuiltin` in the vitest environment the way it is in `quic-transport.ts`'s own tests — check whether `quic-transport.ts`'s existing tests (if any) pass first, as a baseline; (3) a real timing issue in the ICE connectivity check's retry loop under CI scheduling pressure — try increasing the `pump()` helper's wait budget in the test before assuming a logic bug.
