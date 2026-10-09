# WebRTC Phase 2.3 — rtc-api Rework (Real SDP, DCEP, Multi-Channel)

**Date:** 2026-10-08
**Session:** Implementation of roadmap A1 sub-phase 2.3 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`), continuing the 2.1 (DTLS seam) and 2.2 (SCTP transport) sessions earlier today.
**Status:** Completed (2.3 only — the real-browser Playwright interop gate (2.4) is not started)

---

## Summary

Rewrote `src/browser/js/rtc-api.ts` to replace the Phase 1 `ReliableChannel`
(unencrypted, Nova-specific stop-and-wait, one channel per connection) with the
real stack built in 2.1/2.2: `RTCPeerConnection` now runs a real DTLS 1.2
handshake over the ICE-selected UDP pair, then a real SCTP association over the
DTLS record layer, and negotiates each `RTCDataChannel` in-band via DCEP
(RFC 8832) instead of a one-off `a=label:` SDP hack. The single-data-channel
cap is gone — any number of channels now multiplex over independent SCTP
streams. SDP now declares the real media line (`UDP/DTLS/SCTP
webrtc-datachannel`), a DTLS fingerprint (`a=fingerprint:sha-256 ...`), a
`setup` role, and SCTP parameters — and `setRemoteDescription` now checks the
peer's presented DTLS certificate against that fingerprint, failing the
connection (`iceConnectionState = 'failed'`) on a mismatch instead of silently
trusting whatever showed up.

Two Nova instances in the same process now negotiate and exchange data-channel
messages end to end over the real DTLS+SCTP+DCEP stack — not yet tested
against a real browser (that's 2.4).

## Root Causes (found via TDD, both genuine races, not pre-existing bugs)

### 1. `IceAgent.onData` could lose the peer's first packet
**File:** `src/browser/networking/ice-agent.ts`
**Problem:** Each side only registers its real DTLS data handler once its own
`checkConnectivity()` resolves — but the two sides' connectivity checks run
independently and can finish at very different real times. The *other* side's
`DtlsEndpoint` can start sending its ClientHello immediately once connectivity
succeeds on its end, which can be well before this side has even finished its
own check. DTLS 1.2 here has no retransmission (an explicit 2.1
simplification), so a first packet dropped in that window stalled the
handshake forever — reproduced directly: in `tests/rtc-api.test.ts`'s
two-peer test, `ice-agent.ts`'s `handleMessage` received the 91-byte
ClientHello while `this.dataHandler` was still `null`, silently discarding it.
**Fix:** `IceAgent` now buffers any non-STUN datagram that arrives while no
data handler is installed (`preHandlerBuffer`), and flushes it in order the
moment `onData()` installs a real one:
```ts
onData(handler: IceDataHandler | null): void {
  this.dataHandler = handler;
  if (handler && this.preHandlerBuffer.length > 0) {
    const buffered = this.preHandlerBuffer.splice(0);
    for (const msg of buffered) handler(msg);
  }
}
```
and in `handleMessage`, a datagram that isn't STUN and has no handler yet is
buffered instead of dropped:
```ts
if (this.dataHandler) this.dataHandler(msg);
else this.preHandlerBuffer.push(msg);
```
Fixed at the `IceAgent` layer (the shared function every caller routes
through), not with a per-caller workaround in `rtc-api.ts` — the first attempt
at a fix lived in `rtc-api.ts` itself (buffering inside
`maybeStartConnectivityChecks`) but didn't actually close the gap: that
function only registers anything once *both* local and remote descriptions
are set, which for the offerer is strictly after the answerer has already run
its entire flow and could already be sending DTLS bytes. Moving the fix into
`IceAgent` (buffer unconditionally whenever no handler exists, from the moment
the socket exists) closes the real gap regardless of which side calls
`onData()` first.

## Architecture notes

- **DTLS role / SCTP role / stream-id parity are all derived from the same
  offerer/answerer split:** offerer = DTLS server + SCTP server (odd stream
  ids starting at 1), answerer = DTLS client + SCTP client (even stream ids
  starting at 0) — the RFC 8832 §6-recommended parity to avoid local/remote
  stream-id collisions without any extra coordination. SDP reflects this with
  `a=setup:actpass` (offer) / `a=setup:active` (answer) — real, not aspirational.
- **DCEP OPEN/ACK, not SDP, carries channel labels now.** A locally created
  channel (`createDataChannel`) is queued (`__pcPendingLocalChannels`) until
  the SCTP association exists, then gets a stream id and sends
  `DATA_CHANNEL_OPEN` (RFC 8832 §5.1); it only becomes `open` once the peer's
  `DATA_CHANNEL_ACK` arrives. A remotely-opened channel fires `'datachannel'`
  and becomes `open` immediately upon receiving `OPEN` (after sending its own
  `ACK`) — same ordering trick as Phase 1 (`'datachannel'` dispatched in a
  microtask before `markOpen()`, so the page's `ondatachannel` handler can
  attach `onopen` before `'open'` fires).
- **Fingerprint verification is real, not cosmetic:** `setRemoteDescription`
  parses `a=fingerprint:sha-256`, and once the DTLS handshake resolves, its
  `peerFingerprintSha256` is compared against that value — a mismatch fails
  the connection instead of silently proceeding. Exercised implicitly by every
  successful-connection test (self-consistent since both sides are Nova); a
  dedicated mismatch test would need a way to tamper with the SDP in flight,
  not attempted this session.
- **No RFC 6525 stream reset.** `RTCDataChannel.close()` is local bookkeeping
  only — the SCTP stream itself is never formally torn down. Documented
  limitation, consistent with 2.2's own scope (DATA/SACK only, no stream
  management extensions).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/rtc-api.ts` | Full rework: deleted `ReliableChannel`; added real SDP (fingerprint/setup/sctp-port/max-message-size), DCEP open/ack, multi-channel via SCTP streams, DTLS+SCTP construction on connectivity success, fingerprint verification. |
| `src/browser/networking/ice-agent.ts` | Added `preHandlerBuffer` to `IceAgent` — buffers non-STUN datagrams until `onData()` installs a real handler (root cause #1 above). |
| `src/browser/networking/dtls/dtls-handshake.ts` | Added `sendApplicationData()` and `onApplicationData` to `DtlsEndpoint` so a post-handshake payload (SCTP packets) can flow through the DTLS record layer — needed to reparent SCTP onto DTLS instead of raw UDP. |
| `tests/rtc-api.test.ts` | Ported the Phase 1 "rejects a second createDataChannel" test into a "allows multiple data channels" test (the cap is gone by design); added a new two-data-channel end-to-end test (independent SCTP streams, no cross-talk); bumped real-time pump budgets to account for the added DTLS+SCTP+DCEP round trips. |

## Test Results

```
npx tsc --noEmit                                                     -> 0 errors
npx vitest run tests/dtls-handshake.test.ts tests/dtls-x509.test.ts \
  tests/dtls-crypto.test.ts tests/sctp-transport.test.ts tests/rtc-api.test.ts
  Test Files  5 passed (5)
  Tests       32 passed (32)
npx vitest run tests/ice-agent.test.ts
  Test Files  1 passed (1)
  Tests       9 passed (9)
```

Full repo suite:
```
npx vitest run
  Test Files  1 failed | 220 passed (221)
  Tests       3 failed | 9223 passed (9226)
```
Same 3 pre-existing `DnsResolver` localhost-timeout flakes as the 2.1/2.2
sessions earlier today — unrelated to this change. No regressions.

## Verification steps taken

1. `npx tsc --noEmit` — 0 errors repo-wide.
2. Ran `tests/rtc-api.test.ts` directly — initially 2 failures (both data-channel
   tests timing out on `openedA`/`openedB`), root-caused via targeted debug
   logging in `ice-agent.ts` and `rtc-api.ts` (removed afterward) down to the
   `IceAgent.onData` race above, fixed, re-ran green.
3. Ran the 2.1/2.2 DTLS/SCTP test suites alongside — all still green, confirming
   the `DtlsEndpoint.sendApplicationData`/`onApplicationData` addition didn't
   disturb the existing handshake/record-layer behavior.
4. Ran `tests/ice-agent.test.ts` — still green, confirming the `preHandlerBuffer`
   addition doesn't change any existing STUN/connectivity behavior.
5. Full repo suite (`npx vitest run`) — 9223/9226 passing, only the 3
   pre-existing DNS-timeout flakes failing (see Test Results above).

## Out of scope (per the plan, unchanged)

2.4 (Playwright real-browser interop gate: Nova-in-Electron vs. headless
Chromium, both offerer/answerer roles, string + binary echo, multi-channel) is
not started. Real-browser handshake quirks (exact `HelloVerifyRequest` timing,
Chrome's record fragmentation, cipher-extension presence) are unverified —
the plan's own risk note flags this as the reason 2.4 is a hard gate.
