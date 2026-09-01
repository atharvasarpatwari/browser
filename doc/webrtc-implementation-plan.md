# WebRTC Implementation Plan

**Status:** Phase 1 implemented 2026-08-27 (unverified — no test run this session, see the dated changelog). Phases 2–4 not started.

---

## Summary

Nova had two disconnected pieces of "WebRTC": `docs/browser-building-gap-analysis.md` and `TODO.md` both correctly call it a fully open gap, while `src/browser/media/webrtc.ts` (added 2026-07-29, part of a 14-module "Web API wrapper/simulation" batch) is a fully simulated `RTCPeerConnection` — its `setLocalDescription()`/`addIceCandidate()` transition straight to `iceConnectionState = 'connected'` regardless of any real network activity, and it was never wired into `createGlobalEnv()`, so `window.RTCPeerConnection` didn't exist for page scripts at all. Both things were true at once: no real WebRTC, and a fake class nobody could reach from JavaScript.

This plan replaces "fake and unreachable" with "real but narrower in scope," in phases, so each phase ships something a page script can actually use rather than a bigger pile of simulation.

## Phase 1 — Real ICE/STUN + a Nova-specific data channel (this session)

**What's real:**
- `src/browser/networking/stun-client.ts` — RFC 5389 STUN Binding Request/Response encode/decode over real UDP (`node:dgram`, loaded via the existing `loadNodeBuiltin` bridge that `quic-transport.ts` already established as a precedent).
- `src/browser/networking/ice-agent.ts` — real host candidate gathering (actual local interface addresses via `node:os`), real server-reflexive gathering (a real STUN request to a configured public STUN server, if any), and real connectivity checks (STUN Binding Requests exchanged directly with the remote peer's candidates — genuinely determines whether a UDP path works, not simulated).
- `src/browser/js/rtc-api.ts` — `RTCPeerConnection`, `RTCSessionDescription`, `RTCIceCandidate` wired into `createGlobalEnv()` for the first time, following the exact registration pattern `websocket-api.ts` established (constructor via `createObject(null)`/`callable: true`/`nativeFn`, events via the engine's own `EventLoop.enqueueMicrotask`, promises via `createWiredPromise`/`fulfillPromise`/`rejectPromise` — the same primitives `fetch-api.ts` uses for its async methods).
- `RTCDataChannel` — real message delivery between two connected Nova peers, using a small reliable-delivery scheme (`ReliableChannel` inside `rtc-api.ts`: sequence number + ACK + retransmit-on-timeout) layered directly over the UDP pair ICE selected.

**What's NOT real yet (and why that's an honest, deliberate line, not an oversight):**
- **No DTLS.** Real WebRTC data channels are secured and authenticated by a DTLS handshake before anything else happens. Phase 1's UDP traffic between two Nova peers is unencrypted. This is fine for two Nova instances testing against each other on a trusted LAN; it is not fine for anything resembling production use over the open internet.
- **No real SCTP.** The `ReliableChannel` framing (1-byte type + 4-byte sequence + 2-byte length, stop-and-wait ACK) is a small Nova-specific protocol, not RFC 4960 SCTP. **This is the reason two Nova instances can talk to each other but Nova cannot open a data channel with Chrome, Firefox, Safari, or any real WebRTC implementation today.** The SDP Nova emits says so explicitly — the media line is `m=application <port> NOVA/DATACHANNEL`, not the real `UDP/DTLS/SCTP`, specifically so it's never mistaken for spec-compliant SDP by anything reading it.
- **No TURN relay.** Only host and server-reflexive candidates are gathered. Two peers where at least one is behind a symmetric NAT with no STUN-friendly path will fail to connect. There's no fallback.
- **No STUN authentication (message-integrity).** RFC 5389's optional short-term-credential mechanism isn't implemented — Binding Requests aren't authenticated. Combined with no DTLS, this means Phase 1 has no real security properties; treat it as a connectivity/functionality proof, not something to expose to untrusted peers.
- **One data channel per connection.** `createDataChannel()` throws on a second call. Real WebRTC multiplexes many channels over one SCTP association; Phase 1 doesn't have SCTP's stream multiplexing to build that on top of.
- **No audio/video, no `getUserMedia`, no `MediaStream`, no SRTP.** Entirely out of scope for Phase 1 — see Phase 4 below for why this is the hardest, most-deferred piece.
- **No trickle-ICE restart.** `addIceCandidate()` called after connectivity checks have already completed appends to the remote candidate list but doesn't restart checking against it.

## Phase 2 — Real interoperability: DTLS + real SCTP

The actual hard engineering phase. To interoperate with a real browser's `RTCDataChannel`:
1. A DTLS 1.2 handshake (RFC 6347) — certificate generation/fingerprinting (the SDP needs `a=fingerprint:sha-256 ...`), the handshake state machine, then deriving SRTP/application keys.
2. Real SCTP (RFC 4960) framing over the DTLS-secured channel, including SCTP's own multi-stream multiplexing (this is what makes multiple `createDataChannel()` calls share one transport in a real implementation).
3. The DataChannel Establishment Protocol (RFC 8832) for in-band channel setup (label/protocol/ordered/reliability negotiated over an SCTP control stream, not embedded in SDP the way Phase 1 does it).

This is a multi-week effort even for an experienced implementer and should get its own design doc once picked up — this plan intentionally doesn't pretend to scope it in detail yet.

## Phase 3 — Trickle ICE, TURN, full RFC 8445 state machine

Once Phase 2 makes the data path interoperable, connectivity robustness catches up: TURN relay candidates for symmetric-NAT peers, trickle ICE (candidates sent incrementally as they're discovered rather than batched into the initial offer/answer), and the real candidate-pair priority/nomination state machine (Phase 1's "first candidate that answers wins" is a simplification that works for the LAN/simple-NAT case Phase 1 targets).

## Phase 4 — Audio/video: getUserMedia, MediaStream, SRTP

The largest deferred piece, and arguably out of reach for a pure-TypeScript from-scratch engine without native bindings: real camera/microphone capture needs OS-level media APIs (there's no way to read a webcam from JavaScript alone), then encoding (VP8/H.264/Opus or similar) and SRTP transport. This would likely need native (Rust, alongside the existing `nova-net` core) camera/mic capture and codec bindings — a materially different kind of work than everything else in this plan, and probably deserves its own feasibility assessment before a design doc, not just a design doc.

## Testing

Phase 1 ships tests that exercise real networking, not mocks — this is unlike `tests/websocket.test.ts` (which injects a `MockWebSocket` platform factory) because ICE/STUN's whole value is proving real UDP connectivity, so mocking the UDP layer would test nothing meaningful:
- `tests/stun-client.test.ts` — message encode/decode round-trips, plus a real loopback UDP exchange against an in-process STUN-shaped responder.
- `tests/ice-agent.test.ts` — real host candidate gathering, and two `IceAgent` instances completing a real connectivity check and exchanging application data over loopback.
- `tests/rtc-api.test.ts` — the full JS-visible API surface, plus one end-to-end integration test running two `RTCPeerConnection`s in the same process through offer/answer/ICE/data-channel-open/message-send, all over real loopback UDP.

None of this was run this session (see the dated changelog for why) — this is what to run first when picking this up:
```bash
npx vitest run tests/stun-client.test.ts tests/ice-agent.test.ts tests/rtc-api.test.ts
npx tsc --noEmit
```

## Open question worth resolving early

`src/browser/media/webrtc.ts` (the old fully-simulated class) still exists, untouched by this plan. It's dead weight now that a real, JS-VM-exposed `RTCPeerConnection` exists in `rtc-api.ts` — but it wasn't deleted this session because tracing every internal caller (browser-chrome code, not page scripts) to confirm nothing depends on it needs the kind of exploration a session with shell/grep access on the real repo can do quickly and this one couldn't safely guess at. Whoever picks this up: grep for `from '.*media/webrtc'` (or the barrel `media/index.ts` re-export) across `src/` first, then either delete it or fold anything it's actually used for into the real implementation.
