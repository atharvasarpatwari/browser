# Content Security Policy (CSP) Engine

**Date:** 2026-07-19
**Session:** CSP engine implementation — 8 modules, 179 tests
**Status:** Completed

---

## Summary

Implemented a complete Content Security Policy engine with parser, evaluator, reporter, policy store, and 4 enforcers (navigation, resource, script, sandbox). Fixed 15 test failures across 6 root causes in the same session.

## Root Causes

### 1. CSP Parser: Port detection blocked by dot check
**File:** `src/browser/security/csp-parser.ts:296`
**Problem:** `!hostPort.includes('.')` prevented port extraction for domain-name sources like `example.com:8080`. The condition assumed only dotless strings could be host:port, but CSP source expressions use the same format for domains.
**Fix:** Removed the `!hostPort.includes('.')` guard — a colon followed by digits is always a port separator in CSP source expressions.
```typescript
// Before:
if (colonIdx > 0 && !hostPort.includes('.') && /^\d+$/.test(hostPort.slice(colonIdx + 1))) {
// After:
if (colonIdx > 0 && /^\d+$/.test(hostPort.slice(colonIdx + 1))) {
```

### 2. CSP Evaluator: Inline scripts fall through to URL matching
**File:** `src/browser/security/csp-evaluator.ts:439-490`
**Problem:** When `isInline: true` and `unsafe-inline` was absent, the evaluator fell through to URL matching. The placeholder URL `'inline-script'` matched `'self'` because `extractOrigin` returned empty string, which `matchKeyword` treated as same-origin.
**Fix:** Added early return `false` for inline scripts after nonce/hash/unsafe-inline checks, and moved nonce/hash checks before the `isInline` early return so they remain reachable.

### 3. CSP Evaluator: `data:` URLs not parseable
**File:** `src/browser/security/csp-evaluator.ts:138-142`
**Problem:** `parseUrlForEval` checked `url.includes('://')` but `data:` and `blob:` URLs use `scheme:` format without `//`. These URLs returned `null`, causing scheme matching to always fail.
**Fix:** Added fallback regex `^[a-zA-Z][a-zA-Z0-9+\-.]*:` to detect scheme-only URLs.

### 4. CSP Navigation Guard: Wrong origin for policy lookup
**File:** `src/browser/security/csp-navigation-guard.ts:100`
**Problem:** `checkNavigation` looked up policy for the TARGET URL's origin instead of the DOCUMENT's origin. A `form-action` policy on `https://example.com` was never found when checking navigation TO `https://other.com`.
**Fix:** Added `documentOrigin` optional field to `CspNavigationRequest`, used as primary lookup key with fallback to target URL origin.

### 5. CSP Script Enforcer: Wrong directive for workers
**File:** `src/browser/security/csp-script-enforcer.ts:141-145`
**Problem:** All script types checked against `'script-src'` directive, including workers. A `worker-src 'self'` policy was invisible because the enforcer only looked at `script-src` (which fell back to empty `default-src`).
**Fix:** Route workers to `'worker-src'` directive; pass actual URL for workers and dynamic imports instead of the `'inline-script'` placeholder.

### 6. CSP Sandbox Enforcer: Empty sandbox treated as unsandboxed
**File:** `src/browser/security/csp-sandbox-enforcer.ts:151`
**Problem:** `applySandboxFlags` returned `UNSANDBOXED` when `sandboxFlags.length === 0`, but per the HTML spec, an empty `sandbox` attribute (no tokens) means fully sandboxed.
**Fix:** Changed condition from `!policy.hasSandbox || policy.sandboxFlags.length === 0` to `!policy.hasSandbox`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/security/csp-parser.ts` | Removed `!hostPort.includes('.')` guard in port detection |
| `src/browser/security/csp-evaluator.ts` | Added inline early-return, data:/blob: URL support, reordered nonce/hash checks |
| `src/browser/security/csp-navigation-guard.ts` | Added `documentOrigin` to request interface, use for policy lookup |
| `src/browser/security/csp-script-enforcer.ts` | Worker-src directive routing, pass URL for workers/dynamic-imports/javascript-uri |
| `src/browser/security/csp-sandbox-enforcer.ts` | Empty sandbox = fully sandboxed |
| `tests/content-security-policy.test.ts` | Added `documentOrigin` to nav guard tests, fixed IP-with-port kind expectation |

## Files Created

| File | Purpose |
|------|--------|
| `src/browser/security/csp-parser.ts` | CSP header parser — keywords, nonce/hash, scheme, host, IP CIDR, combineCspPolicies |
| `src/browser/security/csp-evaluator.ts` | Pure evaluation — source matching, directive fallback to default-src |
| `src/browser/security/csp-reporter.ts` | Violation reports, batch submission, rate limiting |
| `src/browser/security/csp-policy-store.ts` | Per-origin LRU storage with TTL, enforce + report-only |
| `src/browser/security/csp-navigation-guard.ts` | INavigationGuard — form-action, frame-src, frame-ancestors, base-uri, upgrade-insecure-requests |
| `src/browser/security/csp-resource-enforcer.ts` | connect-src, img-src, font-src, style-src, media-src, object-src, worker-src, manifest-src |
| `src/browser/security/csp-script-enforcer.ts` | script-src, eval, nonce, hash, strict-dynamic, javascript: URI, workers, dynamic imports |
| `src/browser/security/csp-sandbox-enforcer.ts` | CSP sandbox tokens → SandboxPermissions, intersection |
| `tests/content-security-policy.test.ts` | 179 tests across all 8 modules |

## Test Results

```
79 test files, 3261 tests — all passing
CSP-specific: 179 tests — all passing
```

## Verification Steps

1. Ran CSP-specific test suite: 179/179 pass
2. Ran full test suite: 3261/3261 pass (0 regressions)
3. Verified all 6 root causes with targeted test cases
4. Confirmed navigation guard uses document origin, not target origin
5. Confirmed empty sandbox returns fully-sandboxed permissions
6. Confirmed `data:` URLs match `data:` scheme source
