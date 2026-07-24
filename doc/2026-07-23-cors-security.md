# CORS Security Module

**Date:** 2026-07-23
**Session:** CORS implementation, review, test suite, and ResourceLoader integration
**Status:** Completed

---

## Summary

Implemented the Fetch-spec-compliant CORS (Cross-Origin Resource Sharing) engine for NovaBrowser's security layer. The `CorsEngine` evaluates every outbound sub-resource request before the network fetch (pre-request) and after the response arrives (post-response), enforcing `Access-Control-*` header policies per the WHATWG Fetch Standard. 80 tests written, all passing. Integrated into `ResourceLoader` for transparent CORS enforcement on all loaded resources.

## Architecture

### Relationship to Existing `CrossOriginGuard`

| Module | Layer | Responsibility |
|--------|-------|----------------|
| `CorsEngine` (NEW) | Fetch spec | Sub-resource CORS policy — preflight, simple requests, response header validation, preflight cache |
| `CrossOriginGuard` (existing) | Browser SOP | DOM access, storage, cookies, postMessage, network interception, trusted origins |

They are complementary, not duplicates. `CorsEngine` sits in the networking pipeline; `CrossOriginGuard` sits in the security boundary layer.

### Pipeline Integration

```
ResourceLoader.loadResource(url)
       │
       ▼
  CorsEngine.checkRequest(request)   ← pre-request decision
       │
       ├─ SAME_ORIGIN  → allow, inject Origin header
       ├─ SIMPLE       → allow, inject Origin header
       ├─ PREFLIGHT    → send OPTIONS first, then request
       └─ BLOCKED      → return error immediately
       │
       ▼
  RequestManager.send() → HttpResponseSpec
       │
       ▼
  CorsEngine.checkResponse(request, response)  ← post-response validation
       │
       ├─ ALLOWED   → return body + headers to caller
       └─ DENIED    → return CORS violation error
```

## Root Causes

### 1. CorsEngine not on disk

**File:** `src/browser/security/cors.ts`
**Problem:** The CORS engine code was provided as inline code but had not been written to disk.
**Fix:** Created `src/browser/security/cors.ts` with the full implementation (~430 lines).

### 2. Test assertion for simple headers in preflight

**File:** `tests/cors.test.ts`
**Problem:** Test expected `content-type` to appear in `access-control-request-headers`, but `content-type` is a CORS-safelisted header per the Fetch Standard and is correctly excluded from preflight request headers.
**Fix:** Changed assertion to verify `content-type` is NOT in the preflight request headers; only truly non-simple headers (like `x-custom`) are included.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/neterworking/resource-loader.ts` | Added `ICorsEngine` + `pageOrigin` fields, `setCors()` setter, pre-request CORS check with preflight support, post-response CORS validation |
| `src/browser/security/cors.ts` | **NEW** — Full CORS engine: CorsEngine, CorsMode, CorsCredentials, error classes, preflight cache, simple request detection |

## Files Created

| File | Purpose |
|------|--------|
| `tests/cors.test.ts` | 80 tests covering checkRequest (navigate, same-origin, same-origin mode, no-cors, simple, preflight, cache), checkResponse (navigate, no-cors, ACAO validation, credentials, exposed headers), performPreflight (OPTIONS request, headers, cache, max-age, error handling), error classes, constants, edge cases |

## Test Results

```
✓ tests/cors.test.ts         (80 tests) 142ms
✓ tests/resource-loader.test.ts (10 tests) 22ms
Total: 90 passed
```

## Verification Steps

1. Created `src/browser/security/cors.ts` from provided code
2. Wrote 80 tests covering all public API methods, error paths, edge cases
3. Fixed 1 test assertion (simple headers in preflight)
4. All 80 tests pass
5. Integrated CorsEngine into ResourceLoader (pre-request + post-response checks)
6. Existing 10 resource-loader tests still pass after integration
7. Verified CorsEngine does not overlap with CrossOriginGuard (different layers)

## Key Design Decisions

- **CorsEngine is optional in ResourceLoader** — When not set, no CORS checks are performed. This preserves backward compatibility and allows the engine to be enabled per-page.
- **Preflight cache keyed by `(origin, path)`** — Matches the Fetch Standard. Default TTL 5s, capped at 24h.
- **no-cors mode returns opaque** — Body and headers are withheld from script, matching the Fetch spec's "opaque response" concept.
- **Wildcard + credentials correctly throws** — `Access-Control-Allow-Origin: *` with `credentials: 'include'` is forbidden per Fetch Standard §3.2.4.
- **`CrossOriginGuard` is NOT replaced** — The two modules serve different architectural layers and coexist cleanly.
