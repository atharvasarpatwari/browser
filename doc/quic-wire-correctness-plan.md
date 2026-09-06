# QUIC Dgram Wire Correctness — Plan

**Date:** 2026-09-06
**Session:** Fix the three protocol-level wire-format bugs in `quic-transport.ts` documented (and deliberately left unfixed) by the socket-proxy Phase 5 session
**Status:** Completed — see `doc/2026-09-06-quic-wire-correctness.md` for the change log

---

## Summary

`src/browser/networking/quic-transport.ts` encodes and decodes its own QUIC-shaped
wire format, but the encode and decode paths disagree on the byte layout, so a
packet this class BUILDS cannot be parsed by this class's OWN decode path — there
is no working self-to-self round trip. This plan fixes the wire format so
build↔parse round-trip, and gates it with tests that use exactly the shipped code
path (no hand-copied byte layouts in fixtures). Extract-the-seam approach chosen
(see `socket-proxy-design.md` amendment 2026-09-06 for the bugs in their original
context).

## The three bugs

| # | Bug | Location (today) | Fix |
|---|-----|------------------|-----|
| A | `encodeVarInt` 4-byte branch computes `value \| 0x80000000` — a negative int32. `Buffer.writeUInt32BE` would have thrown RangeError for ~16KB+ writes; the post-conversion `byte-codecs.writeUInt32BE` (`>>>`-based) already writes correct bytes, but nothing exercises it | `quic-transport.ts:494` | Regression test only (behavior already correct); shared codec + boundary tests |
| B | Type-tag mismatch: build writes type into bits 0–1 (`packetType >> 4 & 0x03`), parse reads bits 4–5 (`data[0] & 0x30`) and compares against `QuicPacketType.X >> 4` — doubly wrong, every long-header packet parses as "Initial" | `quic-transport.ts:284,296,365-372` | Build `0xC0 \| (type & 0x30)`; parse dispatch on `data[0] & 0x30` directly; revalue OneRtt 0x40 → 0x30 (was colliding with Initial under the mask) |
| C | `findPayloadStart` expects token-varint + 2-byte length + fixed 1-byte PN; build emits no token prefix, a length field **only** on Initial, and 1/2/4-byte PNs | `quic-transport.ts:391-421` | Shared parse of the layout build actually emits: Initial `[length:2][pnType][pn]`, others `[pnType][pn]`, PN length from `(pnType & 0x03)+1` |

## Wire layout (both directions, enforced by the seam)

Long header: `[0xC0 | (type & 0x30)] [dcidLen][dcid] [scidLen][scid] [length:2 (Initial only)] [type | pnLen-1][pn] payload`

Type-field values (`QuicLongHeaderType`): Initial `0x00`, ZeroRtt `0x10`, Handshake `0x20`, OneRtt `0x30`.

Initial `length` value kept exactly as today (pinned by `tests/quic-transport.test.ts`):
`2 + 1 + dcid.length + scid.length + pnBytes.length + payload.length` (value is written but never read back by the parser).

## Files

| File | Change |
|------|--------|
| `src/browser/networking/byte-codecs.ts` | Add pure `encodeVarInt` / `decodeVarInt` / `encodePacketNumber` / `decodePacketNumber` (Uint8Array-only, mirrors existing codec style) |
| `src/browser/networking/quic-wire.ts` (new) | `QuicLongHeaderType` enum + `buildLongHeaderPacket` + `parseLongHeaderPacket` — the single source of truth for the header layout |
| `src/browser/networking/quic-transport.ts` | Consume the seam; **retire** `VersionNegotiation`/`Retry` enum entries and their build branches; revalue `OneRtt` to `0x30`; re-export `QuicPacketType = QuicLongHeaderType` for existing test imports; delete private varint/PN/findPayloadStart; rewrite header comment |
| `tests/quic-wire.test.ts` (new) | Varint boundaries (16384, 2³⁰−1, 2³⁰, 2⁴⁸+, 2⁶²−1-safe-range) + PN widths (1/2/4) round-trip; build→parse→identical payload for all four types; PN increments; malformed/truncated input → null |
| `tests/quic-transport.test.ts` | Replace hand-rolled `wrapAsQuicPayload` with the shared `buildLongHeaderPacket`; add real-dgram 16KB+ `sendStreamData` echo round-trip; refresh stale bug-documentation header |
| `tests/networking-features.test.ts` | No change expected (pins only varint length selection in an inline copy) — must stay green |

## Execution order & gates

1. **A** — codecs + seam + `tests/quic-wire.test.ts` green (`npx vitest run tests/quic-wire.test.ts`).
2. **B** — rewire `quic-transport.ts`; `npx tsc --noEmit` 0 errors.
3. **C** — rework transport tests; slice green (`tests/quic-transport.test.ts`, `tests/quic-wire.test.ts`, `tests/networking-features.test.ts`); lint green.
4. **D** — full `npm test` (baseline 9161/9164, 3 pre-existing DNS timeouts in `networking-integration.test.ts`), changelog `doc/2026-09-06-quic-wire-correctness.md` + `doc/README.md` row + `doc/socket-proxy-design.md` amendment update.
5. Commit per phase, style `fix(networking): ...`.

## Explicitly out of scope (documented, deferred)

- RFC 9000 conformance (real server handshake, AEAD/TLS, connection migration, PN truncation/decoding window).
- WebRTC Phases 2–4 (DTLS+SCTP browser interop, TURN/trickle-ICE, audio/video).
- Server-accept role for `QuicConnection`.
- Varint decode precision beyond `Number.MAX_SAFE_INTEGER` (2⁵³−1) — decode recomposes `hi * 2³² + lo`; QUIC VarInts up to 2⁶²−1 are not exactly representable in JS numbers. Standard limits documented, not changed.