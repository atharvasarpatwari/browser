# Socket-Proxy Phase 4: tls-handler over the proxy wire

**Date:** 2026-09-05
**Session:** tls-handler rework onto the socket-proxy wire + cert-chain serialization cycle fix
**Status:** Completed

---

## Summary
Phase 4 of the socket-proxy implementation (`doc/socket-proxy-design.md`): `tls-handler.ts` now performs real-TLS certificate negotiation through the proxy wire (probe socket via `openTcp { tls: true }` instead of direct `tls.connect`), the root-CA store loads via `loadNodeBuiltin`, `raw-socket-http-client.ts`'s trust store does the same, and the owner flattens the self-referential `issuerCertificate` graph into a cycle-free `chain` array so the serializer can encode it. Committed as `8dc7d67`.

## Root Causes

### 1. Certificate chain serialization stack overflow
**File:** `src/browser/networking/socket-owner.ts`
**Problem:** `getPeerCertificate(true)` on a self-signed cert returns an object whose `issuerCertificate === self`. The owner-side encoder flattened the graph with a `seen` Set, but then set `leaf.chain = chain` while `chain[0]` *was the same leaf object* — reintroducing a self-cycle (`leaf → chain → leaf → chain → …`). The JSONSerializer's preprocess recursed until `Maximum call stack size exceeded`, which surfaced at `Channel._handleResponse` (channel.ts:524) as the response error. Test symptom: `fetches HTTPS with TLS upgrade + peer certificate validation` and `requests the peer certificate over the wire` failed in `tests/socket-proxy.test.ts`.
**Fix:** The chain encoder now returns the chain array of fresh, distinct wire objects (each with `chain: []`); the RPC response is built from a *spread copy* of the leaf so the leaf's `chain` array never contains the leaf itself:
```ts
const chain = encodeCertificateChain(raw);                 // fresh objects, no self refs
const certificate = chain.length > 0 ? { ...chain[0], chain } : null;
return { certificate };
```
Now no object in the payload references the payload root. Verified with a scratch in-process owner/renderer pair: wire subject `{"CN":"localhost"}`, `chain` length 1, `JSON.parse(JSON.stringify(wire))` succeeds with zero unhandled errors.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/socket-owner.ts` | `getPeerCertificate` now runs `encodeCertificateChain(raw)` → chain array, returns `{ ...chain[0], chain }`; `encodeCertificateChain` emits flat, distinct wire objects (no `leaf.chain = chain` self-cycle) |
| `src/browser/networking/tls-handler.ts` | `buildCertificateChainReal(hostname, port)` opens a probe via `getSocketProxy().openTcp({ host, port, tls: true })`, awaits `onceSocketEvent(handle, 'secureConnect')` (plain await — the event carries no payload and the old `if (!connected)` guard wrongly bailed), reads `handle.getPeerCertificate()`, flattens `wire.chain ?? [wire]` into `CertificateInfo[]` via the new `DhcCertificateLike` interface; `loadRootCaStore` now loads via `loadNodeBuiltin('node:tls').rootCertificates` instead of a direct `require` |
| `src/browser/networking/raw-socket-http-client.ts` | Constructor trust store switched from eslint-suppressed `require('node:tls')` to `loadNodeBuiltin<typeof import('node:tls')>('node:tls')` |

## Files Created
| File | Purpose |
|------|--------|
| — | none (scratch test `tests/_scratch-peer-cert.test.ts` created for diagnosis, then deleted) |

## Test Results
```
npx vitest run tests/socket-proxy.test.ts            → 8 passed (8)
npx vitest run tests/tls-handler.test.ts             → 34 passed (34)
npx vitest run tests/{tls-handler, socket-proxy, raw-socket-http-client,
  networking-socks, socks-connection, networking-http-proxy,
  networking-integration, networking-features}.test.ts → 7 files / 149 passed (149)
npx tsc --noEmit                                     → 0 errors
npx eslint src/browser/networking/<phase-4 files>    → 0 errors, 3 warnings
```
The 3 eslint warnings (`DEFAULT_HSTS_MAX_AGE` :234, `hostname` :486, `trustedCAs` :661 in `tls-handler.ts`) are **pre-existing** — verified unchanged against `f5b6de5` via `git diff` (lines untouched by Phase 4). Left as-is; can be triaged in the Phase 6 cleanup.

## Verification Steps
1. Reproduced the failure alone: `npx vitest run tests/socket-proxy.test.ts` → 2 failed (both TLS peer-cert tests), with `Maximum call stack size exceeded` escaping through `Channel._handleResponse`.
2. Wrote `tests/_scratch-peer-cert.test.ts` to drive the real owner/renderer pair over an in-process channel against a self-signed TLS server — confirmed the wire payload carried a self-reference and the response error propagated as an unhandled rejection.
3. Fixed the encoder (distinct wire objects, spread leaf), re-ran scratch → subject/chain serialize cleanly, no unhandled errors. Deleted the scratch test.
4. Full Phase 4 slice green (149/149), tsc clean, eslint clean (minus pre-existing warnings).
5. Committed only Phase 4 files (`socket-owner.ts`, `tls-handler.ts`, `raw-socket-http-client.ts`) as `8dc7d67`. Analytics docs (`doc/README.md`, `doc/analytics.html`, `doc/2026-09-04-analytics-dashboard-update.md`) and the stray `new/` folder intentionally left unstaged.
```
[main 8dc7d67] feat(networking): tls-handler over the socket-proxy wire
 3 files changed, 173 insertions(+), 98 deletions(-)
```