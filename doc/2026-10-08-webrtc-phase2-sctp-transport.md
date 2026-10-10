# WebRTC Phase 2.2 — SCTP Transport

**Date:** 2026-10-08
**Session:** Implementation of roadmap A1 sub-phase 2.2 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`), continuing the 2.1 DTLS seam session the same day.
**Status:** Completed (2.2 only — `rtc-api.ts` rework (2.3) and the real-browser interop gate (2.4) are not started)

---

## Summary

Implemented `src/browser/networking/sctp-transport.ts`: an SCTP (RFC 4960)
association with the four-way handshake (INIT/INIT-ACK/COOKIE-ECHO/COOKIE-ACK),
DATA-chunk fragmentation/reassembly for both ordered and unordered delivery,
cumulative + gap-ack SACKs, and timeout-based retransmission, checksummed with a
pure-TS CRC32c (Castagnoli) table distinct from the plain CRC32 already used
elsewhere in this repo (`canvas-context.ts`). Currently standalone — it talks
directly to a raw UDP socket in its tests; phase 2.3 reparents it onto the DTLS
record layer from 2.1 instead of UDP directly, per the plan's architecture
(`SCTPTransport` sits above `DTLSChannel`, which sits above `IceAgent`).

## Architecture notes

- **One DATA chunk per UDP datagram (no bundling).** Simpler and still correct;
  real stacks bundle multiple chunks per packet to cut overhead. ponytail-marked
  as the upgrade trigger if 2.4 throughput measurements show it matters.
- **Reliability is RTO-timeout-only — no fast retransmit (3-dup-SACK rule), no
  congestion window.** A fixed 300ms RTO re-sends any still-unacked chunk; SACK
  processing (cumulative ack + gap-ack-block ranges) removes acked chunks from
  the retransmit set as soon as they're confirmed, gapped or not. The loss-
  injection test (`tests/sctp-transport.test.ts`) proves this recovers a dropped
  DATA datagram correctly, just slower than real fast-retransmit would. This is
  the plan's own explicitly-sanctioned simplification ("basic TSN window/RTX
  with a conservative cwnd is enough for correct interop").
- **COOKIE_ECHO's state cookie is an unauthenticated random blob** (byte-equality
  check only, no HMAC) — SCTP's cookie mechanism exists to defend against SYN-
  flood/resource-exhaustion from spoofed INITs before a real handshake; moot here
  since in actual use SCTP runs *inside* an already-authenticated DTLS channel
  (2.1), so the spoofing threat model doesn't apply at this layer.
- **Reassembly:** fragments for one message share a TSN run (`B` flag on the
  first, `E` flag on the last, contiguous TSNs in between) and a single SSN;
  `tryReassemble` walks the per-stream fragment map for complete contiguous runs,
  then either delivers immediately (unordered) or buffers by SSN and flushes in
  order per stream (`flushOrdered`) — verified against out-of-order UDP arrival
  in the second test, not just out-of-order TSNs within one message.
- **Checksum field byte order:** written/read little-endian. RFC 4960 §6.8 calls
  for "network byte order" but real-world SCTP stacks (e.g. common historical
  kernel/usrsctp behavior) store this field in host/little-endian order in
  practice; since nothing outside this module parses the checksum field yet
  (2.4's real-browser gate is the first point an external SCTP stack is
  involved), this is a documented choice to revisit if 2.4 shows a mismatch
  against Chrome's usrsctp.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/sctp-transport.ts` | `SctpAssociation`: handshake state machine, DATA fragmentation/reassembly, SACK generation/processing, CRC32c. |
| `tests/sctp-transport.test.ts` | CRC32c standard test vector; association handshake + 20KB multi-fragment echo over real loopback UDP; ordered-delivery-under-reordering test; loss-injection/retransmit-recovery test. |

## Test Results

```
npx tsc --noEmit                                  -> 0 errors
npx vitest run tests/sctp-transport.test.ts
  Test Files  1 passed (1)
  Tests       4 passed (4)
```

Full repo suite:
```
npx vitest run
  Test Files  1 failed | 220 passed (221)
  Tests       3 failed | 9222 passed (9225)
```
Same 3 pre-existing `DnsResolver` localhost-timeout flakes as the 2.1 session
earlier today (see `doc/2026-10-08-webrtc-phase2-dtls-seam.md`) — unrelated to
this change (one new, self-contained module, no shared-code edits). No
regressions.

## Out of scope (per the plan, unchanged)

2.3 (`rtc-api.ts` rework: real SDP, DCEP wiring `SctpAssociation` to
`RTCDataChannel`, reparenting onto DTLS instead of raw UDP, deleting
`ReliableChannel`) and 2.4 (Playwright real-browser interop gate) are not
started.
