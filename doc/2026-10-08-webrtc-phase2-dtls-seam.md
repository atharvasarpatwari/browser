# WebRTC Phase 2.1 — DTLS 1.2 Seam

**Date:** 2026-10-08
**Session:** Implementation of roadmap A1 sub-phase 2.1 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`)
**Status:** Completed (2.1 only — SCTP/DCEP/rtc-api rework and the real-browser interop gate are 2.2–2.4, not started)

---

## Summary

Implemented the DTLS 1.2 seam the Phase 2 plan scoped as step 2.1: a pure-TS ASN.1
DER encoder/parser + self-signed ECDSA P-256 X.509 certificate builder, the TLS 1.2
key-schedule primitives (PRF, master secret, GCM key block, Finished `verify_data`),
the AES-128-GCM record layer, and a full DTLS 1.2 client/server handshake state
machine with mutual certificate exchange (the WebRTC/RFC 8827 fingerprint-trust
model — no CA). No existing file was modified beyond adding one shared byte-codec
helper; this is new, unwired code (`rtc-api.ts` still uses `ReliableChannel` — that
rewrite is 2.3).

All crypto primitives (SHA-256, HMAC, AES-GCM, ECDH, ECDSA) go through Web Crypto
(`crypto.subtle`) — no hand-rolled cipher math, matching the plan's "no node:crypto,
Web Crypto only" constraint and this repo's existing `contextIsolation`-safe pattern.

## Root Cause (bug found during TDD, not a fix for an existing bug)

### 1. OID comparison compared raw content bytes against a full TLV
**File:** `src/browser/networking/dtls/x509-der.ts`
**Problem:** `extractSpkiEcPoint`'s `oidBytesEqual` compared an OID node's *content*
bytes (no tag/length) against `derOid(dotted)`, which returns the *full encoded TLV*
(tag + length + content). The lengths never matched, so every self-signed cert's own
SPKI public key failed to parse back out — `extractSpkiEcPoint` always threw, which
would have broken `CertificateVerify`/`ServerKeyExchange` signature checking before a
single handshake could complete. Caught immediately by `tests/dtls-x509.test.ts`
("generates a cert whose embedded SPKI EC point matches the exported public key") and
by the handshake test hanging/throwing on the very first signature check.
**Fix:**
```ts
function oidBytesEqual(oidContent: Uint8Array, dotted: string): boolean {
  const expected = parseDerNode(derOid(dotted), 0).content; // strip tag+length
  if (oidContent.length !== expected.length) return false;
  for (let i = 0; i < oidContent.length; i++) if (oidContent[i] !== expected[i]) return false;
  return true;
}
```

## Architecture notes

- **Transcript exclusion rule (RFC 6347 §4.2.6):** the stateless-cookie round (first
  cookie-less `ClientHello` + `HelloVerifyRequest`) is excluded from the handshake
  transcript hash that `Finished`/`CertificateVerify` sign over. Implemented via a
  `transcriptActive` flag that flips true only once a `ClientHello` carrying a
  non-empty cookie is sent (client) or received (server) — symmetric on both sides
  so the two peers' transcripts agree byte-for-byte.
- **Single-hash ECDSA signing via `subtle.sign({hash:'SHA-256'}, ...)`:** both
  `ServerKeyExchange` and `CertificateVerify` sign the *raw preimage* (never
  pre-hashed) and let Web Crypto do the one required SHA-256 internally — this
  matches how real TLS stacks (and Chrome/BoringSSL) compute these signatures, so
  the same approach should hold up in the 2.4 real-browser interop gate.
- **GCM AAD = the 13-byte record header** (content-type/version/epoch/seq/length,
  with `length` set to the *plaintext* length for AAD, ciphertext+tag length on the
  wire) — exactly the plan's "AAD = the 13-byte record header" note.
- **ponytail-marked simplifications** (see `dtls-handshake.ts` header comment): no
  handshake-message fragmentation/reassembly and no retransmission timers — both
  assume a reliable, ordered transport. Fine for this gate's in-memory duplex and
  loopback-UDP tests; must be revisited for 2.4 (real browsers over a lossy/
  reordering-capable path) and tracked as the upgrade trigger.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/networking/dtls/x509-der.ts` | ASN.1 DER primitive encoders + generic parser, ECDSA raw<->DER signature conversion, self-signed ECDSA P-256 X.509 cert builder, SPKI EC-point extraction, SHA-256 fingerprint. |
| `src/browser/networking/dtls/dtls-crypto.ts` | TLS 1.2 PRF (`P_SHA256`) built on HMAC-SHA256, master-secret/GCM-key-block/Finished-verify_data derivation, ECDH P-256 key agreement — all via `crypto.subtle`. |
| `src/browser/networking/dtls/dtls-record.ts` | DTLS record header build/parse, coalesced-record splitting, AES-128-GCM encrypt/decrypt per record. |
| `src/browser/networking/dtls/dtls-handshake.ts` | `DtlsEndpoint` client/server state machines: cookie exchange, ECDHE, mutual Certificate/CertificateVerify, Finished. |
| `tests/dtls-x509.test.ts` | DER primitive round-trips, ECDSA sig conversion, self-signed cert generation/fingerprint/self-verify. |
| `tests/dtls-crypto.test.ts` | RFC 4231 HMAC-SHA256 vectors, PRF determinism/length, master-secret/key-block/Finished derivation. |
| `tests/dtls-handshake.test.ts` | Full mutual-cert DTLS handshake over an in-memory duplex and over real loopback UDP (`node:dgram`); a tampered-certificate negative test. |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/byte-codecs.ts` | Added `toArrayBuffer()` — copies a `Uint8Array` into a plain `ArrayBuffer`, needed at every Web Crypto `BufferSource` boundary (same pattern already used in `credentials/encryption.ts`). |

## Test Results

```
npx tsc --noEmit                                               -> 0 errors
npx vitest run tests/dtls-x509.test.ts tests/dtls-crypto.test.ts tests/dtls-handshake.test.ts
  Test Files  3 passed (3)
  Tests       20 passed (20)
```

Full repo suite:
```
npx vitest run
  Test Files  1 failed | 219 passed (220)
  Tests       3 failed | 9218 passed (9221)
```
The 3 failures are `tests/networking-integration.test.ts`'s `DnsResolver - real
system resolution` cases (`DnsTimeoutError: ... "localhost" timed out after
5000ms`) — the same pre-existing DNS-timeout flake documented repeatedly elsewhere
in `doc/` (e.g. the 2026-09-06 socket-proxy Phase 5 and QUIC-wire sessions both
note "3 pre-existing DNS timeouts"). Unrelated to this change — nothing in this
session touches DNS resolution, and the new `dtls/` code isn't imported by anything
yet. No regressions from the one shared-file change (`byte-codecs.ts`).

## Verification steps taken

1. `npx tsc --noEmit` — 0 errors repo-wide.
2. Ran the new DTLS test files directly — all 20 pass, including both the gate's
   required scenarios: self-to-self handshake over an in-memory duplex, and the same
   over two real `node:dgram` UDP sockets bound to `127.0.0.1`.
3. Hit one real bug via TDD (the OID-comparison bug above), fixed it, re-ran green.
4. Full repo test suite (`npx vitest run`) — 9218/9221 passing, only the 3
   pre-existing DNS-timeout flakes failing (see Test Results above).

## Out of scope (per the plan, unchanged)

2.2 (SCTP transport), 2.3 (`rtc-api.ts` rework — real SDP, DCEP, deleting
`ReliableChannel`), and 2.4 (Playwright real-browser interop gate) are not started.
`rtc-api.ts` and the live `RTCDataChannel` path are untouched — this phase only adds
the new, currently-unwired `dtls/` seam the next sub-phases build on.
