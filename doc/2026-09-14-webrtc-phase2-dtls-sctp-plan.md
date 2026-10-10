# WebRTC Phase 2 — Real DTLS 1.2 + SCTP + DCEP (Browser Interop)

**Date:** 2026-09-14
**Session:** Design gate for the flagship WebRTC interop gap (roadmap **A1**) — make `RTCDataChannel` interoperate with real browsers instead of only Nova↔Nova
**Status:** Planned — no code yet. Write this doc, then implement in the 4 sub-phases below.

---

## Summary

Today two Nova instances can exchange data-channel messages over a real UDP path
(ICE/STUN from Phase 1, verified 2026-08-27), but the bytes between them are
**unencrypted** and framed by a **Nova-specific stop-and-wait protocol** (`ReliableChannel`
in `src/browser/js/rtc-api.ts`; the SDP honestly declares `m=application <port> NOVA/DATACHANNEL`).
That is why Nova cannot open a data channel with Chrome, Firefox, or Safari.

This plan replaces the Nova-specific channel with the real WebRTC data-channel stack:
**DTLS 1.2** (RFC 6347) for the encrypted, authenticated record layer, **SCTP** (RFC 4960)
for the reliable multiplexed stream transport, and **DCEP** (RFC 8832) for in-band channel
setup. When complete, a page running in Nova can open an `RTCDataChannel` against a page
running in a real browser (and vice versa), on the open internet.

Scope is deliberately first-interop, not first-perfection: exactly one spec-compliant
cipher/cert shape, no SRTP/media, no TURN/trickle (that stays WebRTC Phase 3).

## What exists (verified today)

| Piece | State |
|-------|-------|
| `IceAgent` (`src/browser/networking/ice-agent.ts`) | Real host + srflx candidates, real connectivity checks; delivers `Uint8Array` datagrams via `IceDataHandler` (line 106). **No changes needed.** |
| `stun-client.ts` | RFC 5389 over the dgram proxy. No changes. |
| `rtc-api.ts` (`src/browser/js/rtc-api.ts`) | `RTCPeerConnection`/`RTCSessionDescription`/`RTCIceCandidate`/`RTCDataChannel` in the JS VM; `ReliableChannel` replaces SCTP; one channel only; `m=NOVA/DATACHANNEL` SDP. **Rewritten in 2.3.** |
| UDP path | Dgram proxied through the main-process socket owner (`IDgramHandle`), fully `Uint8Array`. DTLS/​SCTP sit *above* `IceAgent`, so **no new proxy surface is required.** |
| Crypto (`src/browser/security/crypto-utils.ts`) | Web Crypto is available in the renderer (contextIsolation-safe) and in Node 20 vitest. `subtle` supports ECDSA P-256, ECDH P-256, AES-GCM, HMAC, SHA-256 — **everything DTLS 1.2 needs.** No node:crypto dependency. |
| Existing DTLS/SCTP/DCEP code | **None anywhere in `src/`** (grep-verified). This is green-field. |
| Real-browser harness | Playwright (Chromium + `playwright-electron.config.cjs`) already in the repo — the flagship interop gate runs on it. |

## Architecture

New `dtls` seam (single authority for the wire, same pattern that fixed QUIC):

```
Page JS  ──  RTCPeerConnection (rtc-api.ts, reworked)
               │  SCTPTransport  (new: src/browser/networking/sctp-transport.ts)
               │    streams 0..65534, DATA/SACK, CRC32c
               └  DTLSChannel   (new: src/browser/networking/dtls/)
                    record layer (AES-128-GCM) + DTLS 1.2 handshake
               └  IceAgent (unchanged) — real UDP via the dgram proxy
```

### New files

| File | Purpose |
|------|---------|
| `src/browser/networking/dtls/dtls-crypto.ts` | Web-Crypto TLS 1.2 PRF (`P_hash` over HMAC-SHA256), `master_secret` + `key_expansion` derivation, Finished `verify_data`. |
| `src/browser/networking/dtls/x509-der.ts` | Minimal ASN.1 DER encoder (SEQUENCE/INTEGER/OID/OCTET STRING…) + builder for a self-signed ECDSA P-256 cert whose subject is the SHA-256 fingerprint; parse of the peer cert for fingerprint comparison. Pure TS — no node:crypto. |
| `src/browser/networking/dtls/dtls-record.ts` | DTLS record header (content-type, `0xFEFF`, epoch:2, seq:6, length) + AES-128-GCM encrypt/decrypt. `nonce = fixed_iv(4) ‖ epoch ‖ seq_dtls`, AAD = the 13-byte record header. |
| `src/browser/networking/dtls/dtls-handshake.ts` | Client + server handshake state machines: HelloVerifyRequest cookie loop, ClientHello/ServerHello, Certificate(+Verify), ECDHE params + signature, ServerHelloDone, ChangeCipherSpec, Finished. |
| `src/browser/networking/sctp-transport.ts` | SCTP association (INIT/INIT-ACK/COOKIE-ECHO/COOKIE-ACK), DATA/SACK reliability, TSN window, gap-ACK retransmit, RTO timer, CRC32c (Castagnoli) checksums. Application PPIDs 50/51/52/53. |
| `src/browser/networking/dcep.ts` | RFC 8832 `DATA_CHANNEL_OPEN`/`DATA_CHANNEL_ACK` on stream 0; maps negotiated streams to `RTCDataChannel` objects. |

### Modified

| File | Change |
|------|--------|
| `src/browser/js/rtc-api.ts` | Replace `ReliableChannel` with `SCTPTransport`; emit real SDP (`m=application <port> UDP/DTLS/SCTP webrtc-datachannel`, `a=fingerprint:sha-256`, `a=setup:`, `a=sctp-port:5000`, `a=max-message-size`); drop the single-channel cap; `createDataChannel()` returns per-stream channels via DCEP. |
| `src/browser/js/index.ts` | No change expected (`rtc-api.ts` already wired into `createGlobalEnv`). |
| `src/browser/networking/ice-agent.ts` | No change expected (only used as the UDP transport in `rtc-api.ts`). |

## Wire details worth pinning early (seam-test these)

- **Single cipher suite:** `TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256` (0xC02B) — the universally
  supported WebRTC default (Chrome/Firefox/Safari all accept ECDSA P-256 + AES-128-GCM). No
  cipher-suite negotiation beyond advertising this one suite.
- **Certificates:** self-signed ECDSA P-256, `CN = <sha-256 fingerprint hex>`, `ecdsa-with-SHA256`.
  Both peers exchange certs (WebRTC norm); **no CA validation** — trust = SDP `a=fingerprint`
  match against the presented cert (RFC 8122/RFC 8827 model), plus verifying the peer's
  `CertificateVerify` signature over the handshake transcript.
- **DTLS version:** 1.2 (`0xFEFF`) only. Do not advertise DTLS 1.3 (RFC 9147) — keep the
  handshake surface minimal this cycle.
- **Server side must send `HelloVerifyRequest`** with a cookie and echo the cookie from the
  retried `ClientHello`. Chromium behaves like a compliant DTLS client here. Verify both roles
  (Nova as DTLS server receiving Chrome's ClientHello; Nova as DTLS client receiving another
  server's cookie).
- **GCM nonce construction** is the classic loss-resolution point — the seam test must
  round-trip encrypted records whose `epoch/seq` advance between messages, and cross-decode a
  record produced by the other peer role (client vs server key schedule). Do not rely on
  `Object.entries`-style copies (see the fetch-CORS bug class); check key-derivation byte
  equality explicitly against a fixed RFC 5246 test vector.
- **SCTP checksum is CRC32c (Castagnoli)** — distinct polynomial/table from any existing CRC32
  in the codebase (e.g. `canvas-context.ts` uses CRC32). Own pure-TS table.
- **Ports:** SCTP source/dest port 5000 (standard WebRTC SCTP port), verification tags from the
  peer's `INIT`/own init-tag.
- **`max-message-size`:** advertise `a=max-message-size:262144` and implement DATA fragmentation
  to respect it.

## Execution order & gates (per roadmap exec model)

Each step ends with a green gate; commit per step (`feat(webrtc): ...`).

1. **2.1 — DTLS seam** (`x509-der`, `dtls-crypto`, `dtls-record`, `dtls-handshake`).
   Gate: `npx tsc --noEmit` 0 errors; self-to-self handshake over an **in-memory duplex + real
   loopback UDP**; RFC 5246 key-derivation vector test; `npx vitest run tests/dtls-*.test.ts`.
2. **2.2 — SCTP transport** (`sctp-transport.ts`, CRC32c, DATA/SACK, retransmit).
   Gate: association handshake + 20KB multi-fragment echo over loopback UDP (pattern proven by
   the QUIC round trip); loss-injection test proves SACK/retransmit works.
3. **2.3 — rtc-api rework** (real SDP, DCEP, multi-channel; delete `ReliableChannel`).
   Gate: existing `tests/rtc-api.test.ts` ported to the DTLS+SCTP path and green; new
   two-channel test; two Nova peers exchange messages over real UDP exactly as before.
4. **2.4 — Real-browser interop gate.** `tests/rtc-interop.spec.ts` via Playwright:
   - Peer A = Nova's engine inside the packaged Electron app (`_electron`),
   - Peer B = headless Chromium page running plain `RTCPeerConnection`/`RTCDataChannel`,
   - signaling = a tiny localhost HTTP relay both sides poll (no new deps),
   - both directions: Chrome-offerer ↔ Nova-answerer **and** Nova-offerer ↔ Chrome-answerer;
   - assert `open`, ordered message echo (strings + binary ArrayBuffer), and multi-channel.
   Gate: spec green; then **full `npm test`** (baseline ~9,201), fidelity audit re-run, and
   Android on-device smoke test (rendering/interop changed — both are on the roadmap gate list).

## Explicitly out of scope (documented, deferred)

- **DTLS 1.3** (RFC 9147) — future; keep the record-layer generic enough to add a version flag.
- **SRTP / media / `getUserMedia` / `MediaStream`** — WebRTC Phase 4, feasibility-gated.
- **TURN relay, trickle-ICE, RFC 8445 nomination** — WebRTC Phase 3 (unchanged).
- **SCTP multihoming, partial-reliability options beyond unordered/reliable, full congestion
  control.** Basic TSN window/RTX with a conservative cwnd is enough for correct interop on
  real networks; document the simplification.
- **Certificate chains / CA trust.** Fingerprint pinning only; no OCSP/CT.
- **RSA or Ed25519 certificates.** P-256 ECDSA only this cycle (the safest universal WebRTC
  choice); the cert builder is isolated so the algorithm is a one-line future change.

## Risks & unknowns

- **Real-browser handshake quirks** (HelloVerifyRequest timing, Chrome's exact record
  fragmentation, cipher-extension presence) — mitigated by making 2.4 a hard gate, not optional.
- **Web Crypto `subtle` is async** — the handshake must be producer/consumer asynchronous
  anyway; the record layer can stay sync for encrypt (key retained after import) with the
  fixed-nonce derivation precomputed.
- **PRF cost in pure JS** — negligible at handshake scale (a few HMAC loops), not a hotspot.
- **`rtc-api.test.ts` port risk** — its existing assertions assume the Phase-1 offer/answer
  shape; budget the port explicitly in 2.3.

## Open questions to resolve first

1. Confirm exact Chromium flag set needed for headless `RTCPeerConnection` datachannels (none
   known; `--use-fake-ui-for-media-stream` is irrelevant for datachannels, and localhost ICE
   host candidates are allowed by default in tests — verify during 2.4 spike).
2. Whether the Electron-packaged Nova peer can reach the loopback signaling relay while
   `contextIsolation: true` (renderer HTTP fetch is local, so yes — confirm during the spike).
3. Keep the byte-level seam in `dtls/` matching the `quic-wire.ts` precedent (extracted
   codecs + round-trip tests) so build↔parse can never disagree again.