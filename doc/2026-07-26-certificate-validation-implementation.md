# Certificate Validation Implementation

**Date:** 2026-07-26
**Session:** Certificate validation audit remediation
**Status:** Completed

---

## Summary

Implemented real certificate validation by integrating the existing TlsHandler into the RawSocketHttpClient network pipeline, fixing the SHA-256 fingerprint computation, adding a system trust store loader, and generating security interstitial pages for certificate failures.

## Root Causes

### 1. SHA-256 fingerprint was a mock hash

**File:** `src/browser/netwroking/tls-handler.ts:621`
**Problem:** `sha256Hex()` was a simple char-code-based hash, not real SHA-256.
**Fix:** Switched to `require('node:crypto').createHash('sha256')` with a fallback for non-Node environments.

### 2. TLS connections disabled certificate verification

**File:** `src/browser/netwroking/raw-socket-http-client.ts:161`
**Problem:** `rejectUnauthorized: false` was hardcoded with no post-handshake validation.
**Fix:** Added `secureConnect` event handler that calls `TlsHandler.negotiate()` to validate the certificate after the TLS handshake completes. `rejectUnauthorized: false` is kept so we can inspect the peer certificate before deciding.

### 3. TlsHandler was not wired into the network pipeline

**File:** `src/app/main.ts:386-398`
**Problem:** RawSocketHttpClient was created without a TlsHandler, so certificate validation was never invoked.
**Fix:** Registered `TlsHandler` as a DI singleton with `useRealTls: true` and `verifyCertificates: true`, then passed it to RawSocketHttpClient.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/netwroking/tls-handler.ts` | Fixed `sha256Hex()` to use real `node:crypto`; added `loadRootCaStore()`, `verifyChain()`, `generateInterstitial()` static methods |
| `src/browser/netwroking/raw-socket-http-client.ts` | Added `ITlsHandler` import and constructor option; added `secureConnect` handler with TlsHandler.negotiate() validation; loads system trust store on construction |
| `src/app/main.ts` | Added TlsHandler import and `Tokens.TlsHandler`; registered TlsHandler singleton; passed TlsHandler to RawSocketHttpClient |
| `tests/tls-handler.test.ts` | Added 16 new tests: loadRootCaStore (2), verifyChain (6), generateInterstitial (3), sha256Hex (1), RawSocketHttpClient+TlsHandler integration (4) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-07-26-certificate-validation-implementation.md` | This change log |

## Test Results

```
Test Files  136 passed | 1 failed (138)
     Tests  6242 passed | 3 failed (6301)

tls-handler.test.ts:           34 tests passed
certificate-validator.test.ts: 19 tests passed
```

Pre-existing DNS timeout failures in networking-integration.test.ts are unrelated.

## Verification

1. Ran `npx vitest run` — 6242 pass, 0 regressions
2. `loadRootCaStore()` returns 100+ PEM entries from Node.js system trust store
3. `sha256Hex()` now produces real 64-char hex SHA-256 digests
4. `verifyChain()` correctly rejects expired, not-yet-valid, weak-key, and hostname-mismatch certs
5. `generateInterstitial()` produces valid HTML for all certificate error types
6. RawSocketHttpClient constructor accepts optional `tlsHandler` and loads system CAs
