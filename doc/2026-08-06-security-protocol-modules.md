# New Security Enforcement Protocol Modules

**Date:** 2026-08-06
**Session:** 7 new security enforcement modules — DNS Rebinding Protection, HSTS Preload, Certificate Transparency, Subresource Integrity, Private Network Access, Cross-Origin Policies (COOP/COEP/CORP), Referrer Policy
**Status:** Completed

---

## Summary

Added 7 new security enforcement modules under `src/browser/media/`, following the `IDisposable` + `onEvent` pattern established by the 11 security modules from 2026-07-29. Each is self-contained (no new runtime dependencies) and exported from the media barrel. 79 new tests in `tests/security-protocols.test.ts`.

## Architecture Decisions

| # | Module | Threat addressed | Key surfaces |
|---|--------|------------------|--------------|
| 1 | `DnsRebindingProtectionService` | DNS rebinding — attacker hostname resolving to private/loopback IPs | `classifyIp` (IPv4/IPv6), `checkResolvedHost(host, ip)`, modes `block/warn/disabled`, per-host allowlist, IP-literal exemption (direct `http://192.168.x.x/` navigation stays allowed) |
| 2 | `HstsPreloadService` | First-visit HTTPS downgrade on well-known hosts | 41-entry built-in preload list (41 includeSubDomains flags), `checkUrl()` upgrades `http:`→`https:`, runtime add/remove, global enable toggle |
| 3 | `CertificateTransparencyService` | Certs lacking Signed Certificate Timestamps | `validateSct` (log id, signature, clock-skew, 120-day max age), `countValidScts` (distinct log ids), `checkCertificates` → `pass/warn/fail` against `requiredScts` (default 2), enforcement toggle |
| 4 | `SubresourceIntegrityService` | Tampered script/style content | `parseIntegrity`, `verify(integrity, content)`, SHA-256/384/512 digests (lazy `node:crypto` with pure-TS FIPS 180-4 BigInt fallback), `bytesToBase64` export, enforce toggle |
| 5 | `PrivateNetworkAccessService` | Public pages reaching private/local networks | Address-space model `public/private/local/reserved`, precedence-gated requests, modes `disabled/warn/block/block-unless-secure` (secure context alone insufficient — target must also be granted), reserved-target hard block |
| 6 | `CrossOriginPoliciesService` | Cross-origin window/subresource leaks | COOP parse + opener-severance decision, COEP `require-corp`/`credentialless` subresource checks, CORP same-origin/same-site enforcement, cross-origin isolation status |
| 7 | `ReferrerPolicyService` | Referrer leakage / information disclosure | All 8 spec policy values, HTTPS→HTTP downgrade stripping, origin truncation, cross-origin stripping, last-value-wins header parsing, referrer/truncated counters |

Modules 2, 4, 5, 7 were placed in `media/` per the established security-wrapper convention; they do not depend on the JS runtime bindings.

## Root Causes (bug fixes during development)

### 1. IPv6 `::` marker expansion mis-shifted
**File:** `dns-rebinding-protection.ts`, `private-network-access.ts`
**Problem:** `expandIpv6` inserted zeros *before* the `::` marker using the pre-shift `emptyIndex`, leaving a stray `''` group (e.g. `::1` → `['0','0','0','0','0','0','','1']`), so every compressed address classified as `reserved`.
**Fix:** recompute the marker after trimming edge empties and *replace* it with the zero run:
```ts
const marker = groups.indexOf('');
if (marker < 0) return null;
const missing = 8 - (groups.length - 1);
if (missing < 1) return null;
groups.splice(marker, 1, ...new Array(missing).fill('0'));
```

### 2. IPv6 prefix checks compared against 8-bit constants
**File:** `dns-rebinding-protection.ts`, `private-network-access.ts`
**Problem:** first 16-bit group `0xfe80` was compared with `first === 0xfe` and ULA with `first === 0xfd`, so `fe80::1` → `public` and `fd12::1` → `public`.
**Fix:** prefix-match the full group — link-local is `fe80::/10` → `(first & 0xffc0) === 0xfe80`; unique-local is `fc00::/7` → `(first & 0xfe00) === 0xfc00`. Loopback reordered: `::1` checked before the all-zero reserved case.

### 3. PNA `block-unless-secure` let secure contexts through unconditionally
**File:** `private-network-access.ts`
**Problem:** `checkRequest` granted more-local targets whenever `isSecure` was true, so public→private was *allowed* by default with no opt-in — the opposite of the intended default-deny.
**Fix:** require both a secure context **and** an explicit grant: `allowed = mode === 'block-unless-secure' && isSecure && granted`.

### 4. `isSameSite` parameter shadowed the module function
**File:** `cross-origin-policies.ts`
**Problem:** `checkCorp(..., isSameSite = false)` shadowed the module-level `isSameSite()` helper; `isSameSite(reqOrigin, resOrigin)` threw `is not a function`.
**Fix:** removed the shadowing parameter; `checkCorp` now computes same-site via the helper. `checkSubresource` keeps its `_isSameSite` argument (underscore-prefixed per lint convention).

### 5. `IntegrityVerificationResult` not assignable to `Record<string, unknown>`
**File:** `subresource-integrity.ts`
**Problem:** event `data` typed as `Record<string, unknown>` rejects interfaces without an index signature.
**Fix:** emit `data: { ...result }`.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/dns-rebinding-protection.ts` | DNS rebinding defense — IP classification (IPv4/IPv6) + host-resolution gate |
| `src/browser/media/hsts-preload.ts` | Built-in HSTS preload list + `http:`→`https:` upgrade |
| `src/browser/media/certificate-transparency.ts` | SCT validation, distinct-log counting, CT policy decisions |
| `src/browser/media/subresource-integrity.ts` | SRI parser/verifier + pure-TS SHA-256/384/512 fallback |
| `src/browser/media/private-network-access.ts` | Address-space isolation for public↔private requests |
| `src/browser/media/cross-origin-policies.ts` | COOP/COEP/CORP parsing + enforcement + isolation status |
| `src/browser/media/referrer-policy.ts` | Referrer-Policy enforcement with downgrade/origin stripping |
| `tests/security-protocols.test.ts` | 79 tests across all 7 modules |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Added 7 class exports + type exports for the new modules |

## Test Results

```
 Test Files  1 passed (1)   ← tests/security-protocols.test.ts
      Tests  79 passed (79)

 Test Files  2 passed (2)   ← + tests/security.test.ts (69) — 148 total security tests
      Tests  148 passed (148)
```

Full suite run: **185 passed / 1 failed** test files, **8560 passed / 3 failed** tests. The only failures are pre-existing and confirmed identical on a clean tree (`git stash` + re-run): `tests/networking-integration.test.ts` "DnsResolver — real system resolution" (3 tests, live-network dependent) and one worker fork/heap-OOM in a memory stress file. `npx tsc --noEmit` is clean.

## Verification Steps

1. `npx vitest run tests/security-protocols.test.ts` — 79/79 pass
2. `npx vitest run tests/security.test.ts` — 69/69 pass (no regressions to the 11 existing security modules)
3. `npx tsc --noEmit` — 0 errors
4. `npx eslint <7 new files> <test file>` — only the pre-existing `no-empty`/`no-var-requires` patterns shared with all 11 existing security modules (`catch { }` in `onEvent` emit dispatch, lazy `require('node:crypto')`) remain
5. Full suite — only pre-existing networking/DNS + heap-OOM failures (verified on `git stash` baseline)
