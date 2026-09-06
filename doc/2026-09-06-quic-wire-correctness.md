# QUIC Dgram Wire Correctness

**Date:** 2026-09-06
**Session:** Fix the QUIC wire-format build/parse mismatch in `quic-transport.ts` (three documented bugs from the socket-proxy Phase 5 session, plus a fourth found by the new seam tests), then close two blast-radius gaps the Phase 5 Buffer→Uint8Array conversion left behind in `rtc-api.ts` and `tests/dgram-proxy.test.ts`.
**Status:** Completed

---

## Summary

QuicConnection's encode and decode paths disagreed on the byte layout, so a packet the class built could not be parsed by its own decode path. The wire format was re-centered on a shared seam (`byte-codecs.ts` varint/PN codecs + new `quic-wire.ts` header build/parse) that is now the single source of truth, and `tests/quic-wire.test.ts` gates build↔parse round trips — including a real-dgram self-to-self 20KB echo in `tests/quic-transport.test.ts`. The Phase 5 `Buffer`→`Uint8Array` sweep had missed two consumers of the dgram `message` event (which now delivers plain `Uint8Array`): `rtc-api.ts`'s `ReliableChannel` and three assertions in `tests/dgram-proxy.test.ts`. Both were fixed, restoring RTC data-channel exchange and the dgram proxy wire tests, and bringing `tsc --noEmit` to 0 errors repo-wide.

## Root Causes

### 1. Type-tag mismatch — every long-header packet decoded as "Initial"
**File:** `src/browser/networking/quic-transport.ts` (fixed by `src/browser/networking/quic-wire.ts`)
**Problem:** `buildPacket` wrote the packet type into bits 0–1 (`packetType >> 4 & 0x03`) while `handleLongHeader` read bits 4–5 (`data[0] & 0x30`) and compared against `QuicPacketType.X >> 4`. For every long-header packet, `data[0] & 0x30` came out `0x00` = Initial, so a server's Handshake-type response never transitioned the client out of `WaitingForInitial` — the `Handshaking` gate in `handleLongHeader` required a prior Initial.
**Fix:** New `QuicLongHeaderType` enum in `quic-wire.ts` (Initial `0x00`, ZeroRtt `0x10`, Handshake `0x20`, OneRtt `0x30`); `buildLongHeaderPacket` emits `0xC0 | (type & 0x30)` and `parseLongHeaderPacket` decodes `data[0] & 0x30`. OneRtt revalued `0x40 → 0x30` (previously colliding with Initial under the mask). `QuicPacketType` re-exported as an alias for backward-compatible imports. Server-driven decode tests now send Initial first (→ Handshaking) then HandshakeDone (→ Established).

### 2. Payload-start layout mismatch — no working self-to-self round trip
**File:** `src/browser/networking/quic-transport.ts` (deleted `findPayloadStart`; parse now via `quic-wire.ts`)
**Problem:** `findPayloadStart` expected a token-varint + 2-byte length + fixed 1-byte packet number; `buildPacket` emitted no token prefix, a 2-byte length **only** on Initial, and 1/2/4-byte PNs. Parsing a real packet walked the wrong offsets and landed in the wrong place.
**Fix:** `parseLongHeaderPacket` consumes exactly what the builder emits: Initial `[length:2]` (value written, never read — pinned byte-for-byte by the encode-side tests), other types no length field, then `[type | pnLen-1][pn]` with `pnLen = (pnTypeByte & 0x03) + 1`.

### 3. `decodeVarInt` 8-byte branch signedness (found by the new seam tests)
**File:** `src/browser/networking/byte-codecs.ts`
**Problem:** `lo = (data[4] << 24) | ...` went negative for `lo ≥ 2³¹`, so any 8-byte varint whose low 32 bits had the high bit set decoded `2³²` short. The plan's "bug A" was the historical `encodeVarInt` 4-byte `value | 0x80000000` negative-int32 concern; the seam tests surfaced this separate decode-side signedness bug at the same class of bug.
**Fix:** `>>> 0` added. `tests/quic-wire.test.ts` pins regressions for `[0x180000000, 0x1ffffffff, 0x100000000 + 0xffffffff, 0xffffffffff]`.

### 4. Phase 5 blast-radius gap — RTC data channel got a `Uint8Array` it treated as `Buffer`
**File:** `src/browser/js/rtc-api.ts`
**Problem:** The dgram-handle sweep changed `hub.emit('message', ...)` from `Buffer.from(bytes)` to the raw `bytes` (`Uint8Array`), and `IceAgent.onData` now delivers `Uint8Array`. But `ReliableChannel.handleIncoming` still called Buffer methods (`msg.readUInt8`, `msg.readUInt32BE`, `msg.readUInt16BE`) — it threw on a plain `Uint8Array`, so no data-channel message was ever delivered (`receivedOnB` stayed `''`). The same change broke `tests/dgram-proxy.test.ts`, which decoded with `msg.toString('utf8')` — returning comma-joined byte numbers on a `Uint8Array`.
**Fix:** rtc-api.ts converts at the boundary: `this.ice.onData((msg) => this.handleIncoming(Buffer.from(msg)))`. Three test assertions in `tests/dgram-proxy.test.ts` switched to `decodeUtf8(msg)`. This also removed the pre-existing `rtc-api.ts(151,50)` tsc error.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/byte-codecs.ts` | Added `encodeVarInt`/`decodeVarInt`/`encodePacketNumber`/`decodePacketNumber`; fixed 8-byte decode `>>> 0` |
| `src/browser/networking/quic-transport.ts` | Rewired to consume `quic-wire.ts` + shared codecs; retired `VersionNegotiation`/`Retry`; OneRtt revalued 0x30; deleted private codecs/`findPayloadStart`; re-exported `QuicPacketType = QuicLongHeaderType` |
| `src/browser/js/rtc-api.ts` | `onData` boundary converts `Uint8Array` → `Buffer` for `ReliableChannel` |
| `tests/dgram-proxy.test.ts` | `toString('utf8')` → `decodeUtf8` for received datagrams |
| `doc/README.md` | Added plan row for `quic-wire-correctness-plan.md`; added change-log row (below) |
| `doc/socket-proxy-design.md` | Amendment paragraph updated: the three quic-transport bugs are now fixed, resolving to the seam + changelog |
| `doc/quic-wire-correctness-plan.md` | Status → Completed |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/quic-wire.ts` | `QuicLongHeaderType` enum + `buildLongHeaderPacket`/`parseLongHeaderPacket` — single source of truth for the long-header layout |
| `tests/quic-wire.test.ts` | 15 tests: varint boundaries (incl. 4-byte/8-byte signedness regressions), PN round-trip, header build→parse for all four types, malformed/truncated → null |
| `tests/quic-transport.test.ts` | Headers refreshed; `wrapAsQuicPayload` now routes through `buildLongHeaderPacket` (2-arg); `makeEchoPeer` added; decode-side tests drive the real Initial→HandshakeDone state machine and capture the client's `rinfo` for responses; new 20KB self-to-self echo round-trip test |
| `doc/2026-09-06-quic-wire-correctness.md` | This change log |

## Test Results

```
# Phase A gate (seam)
npx vitest run tests/quic-wire.test.ts        -> 15/15 passed

# Phase C gate (slice)
npx vitest run tests/quic-wire.test.ts tests/quic-transport.test.ts tests/networking-features.test.ts
                                              -> 3 files / 63 tests passed

# Phase D gates
npx tsc --noEmit                              -> 0 errors (repo-wide; the 3 former dgram-proxy.test.ts
                                                  tsc errors and the rtc-api.ts(151,50) error are gone)

npx vitest run tests/rtc-api.test.ts tests/dgram-proxy.test.ts tests/ice-agent.test.ts tests/stun-client.test.ts tests/dgram-handle-buffer-polyfill.test.ts
                                              -> 5 files / 36 tests passed

npm test (npx vitest run)                     -> 215 of 216 files passed; 9185/9188 tests passed;
                                                  3 failures are the pre-existing DNS timeouts in
                                                  networking-integration.test.ts (unchanged baseline category)
```

Baseline comparison: the previous full run reported 9161/9164 (3 DNS timeouts). This session's run is 9185/9188 (same 3 DNS timeouts), with the delta coming from the new `quic-wire.test.ts` (15) plus test-count growth in `quic-transport.test.ts`, and the removal of the RTC/dgram-proxy failures.

## Verification Steps

1. `tests/quic-wire.test.ts` green — varinst boundaries and the 2³² decode regression pinned.
2. `tests/quic-transport.test.ts` green — encode-side exact-byte pins still hold (byte-for-byte layout unchanged for Initial/Handshake/OneRtt/ConnectionClose), plus the new 20KB self-to-self round trip over real dgram.
3. `tests/networking-features.test.ts` green — the inline QUIC copy in `networking-features.test.ts` (which pins varint length selection) unchanged and passing.
4. `tests/rtc-api.test.ts` green — real loopback offer/answer/ICE/data-channel message exchange restored.
5. Full suite: only the 3 documented DNS timeouts fail; every tsc error that used to accompany them is resolved.