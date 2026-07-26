# Same-Origin Policy Implementation

**Date:** 2026-07-26
**Session:** Same-Origin Policy — full 8-phase implementation
**Status:** Completed

---

## Summary
Implemented the WHATWG Same-Origin Policy across 8 phases: unified origin comparison service, fetch() and XMLHttpRequest CORS wiring, navigation guard, DOM access SOP, storage SOP defense-in-depth, CORP enforcement, and opaque origin handling. 63 new tests, 0 regressions.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/fetch-api.ts` | Added mode/credentials parsing, CorsEngine.checkRequest/checkResponse, opaque responses, Origin header injection |
| `src/browser/js/xhr.ts` | Added withCredentials support, restricted header blocking, CorsEngine integration, opaque response handling, `createXMLHttpRequestClass()` accepts corsEngine+pageOrigin |
| `src/browser/navigation/navigation-controller.ts` | Added `SopNavigationGuard` class — INavigationGuard implementation, cross-origin event emission, on/off subscription |
| `src/browser/js/dom-bindings.ts` | Added iframe contentWindow/contentDocument SOP in wrapElement() |
| `src/browser/js/web-storage-bindings.ts` | Added defense-in-depth SOP checks via callerOrigin/storageOrigin in wrapStorage() |
| `src/browser/netwroking/resource-loader.ts` | Added CORP enforcement — cross-origin-resource-policy header check (same-origin/same-site/cross-origin) |
| `src/browser/js/index.ts` | Updated createGlobalEnv() to pass pageOrigin to storage bindings |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/security/origin-service.ts` | Unified origin parsing — parseOrigin(), isSameOrigin(), isSameSite(), isOpaqueOrigin(), getEffectiveOrigin() using WHATWG URL Standard |
| `tests/same-origin-policy.test.ts` | 63 tests covering all 8 phases |

## Architecture

### Phase 1 — OriginService
Single source of truth for all origin comparisons. Replaces ad-hoc string comparisons in CorsEngine/CrossOriginGuard. Handles opaque origins (data:, blob:, about:) via `"null"` string per WHATWG URL Standard. Default port normalization (80→http, 443→https). Sandbox flag support.

### Phase 2 — fetch() CORS Wiring
- Parses `mode` (cors/no-cors/same-origin/navigate) and `credentials` (omit/same-origin/include) from RequestInit
- Injects `Origin` header for cross-origin requests
- Calls `CorsEngine.checkRequest()` for preflight and `CorsEngine.checkResponse()` for post-flight validation
- Creates opaque responses (`type: 'opaque'`, empty headers/body) for no-cors mode or CORS failures
- `same-origin` mode blocks cross-origin outright before any network request

### Phase 3 — XMLHttpRequest CORS Wiring
- `withCredentials` support with CORS credential handling
- Restricted header blocking (Host, Content-Length, etc.)
- CorsEngine pre-request and post-response checks
- Opaque response handling (hides responseText/body)
- `createXMLHttpRequestClass()` factory accepts `corsEngine` and `pageOrigin`

### Phase 4 — Navigation Guard
- `SopNavigationGuard` implements `INavigationGuard` interface
- Logs cross-origin navigations and emits `CrossOriginNavigationEvent`
- Per WHATWG spec, cross-origin navigations are allowed (context isolation handles security)
- `on()`/`off()` subscription API, `getEvents()` history tracking

### Phase 5 — DOM Access SOP
- Iframe `contentWindow` getter returns placeholder with origin info for cross-origin
- Iframe `contentDocument` getter returns null for cross-origin
- Reads `data-origin` and `src` attributes to determine iframe origin

### Phase 6 — Storage SOP Defense-in-Depth
- `wrapStorage()` accepts optional `callerOrigin` + `storageOrigin`
- `checkOrigin()` throws `DOMException('SecurityError')` on mismatch
- Wired into both localStorage and sessionStorage bindings
- Note: Storage backends are already per-origin internally; this is an additional guard layer

### Phase 7 — CORP Enforcement
- Reads `cross-origin-resource-policy` header after CORS check
- Blocks `same-origin` CORP when request is cross-origin
- Blocks `same-site` CORP when request is cross-site
- `cross-origin` CORP explicitly allows all

### Phase 8 — Opaque Origins
- `data:` URLs → `"null"` (WHATWG URL Standard)
- `about:blank` → referrer inheritance
- `blob:` URLs → creating context (simplified to `"null"` in OriginService; browser layer handles inheritance)
- Sandboxed iframes without `allow-same-origin` → opaque origin

## Pre-existing Modules (Now Wired)
| Module | Status |
|--------|--------|
| `CorsEngine` (src/browser/security/cors.ts) | Pre-existing Fetch Standard CORS engine — now wired into fetch() and XHR |
| `CrossOriginGuard` (src/browser/security/cross-origin-guard.ts) | Pre-existing SOP decision API — now used by storage SOP checks |
| `OriginIsolator` (src/browser/security/origin-isolator.ts) | Pre-existing per-origin context isolation — referenced by SopNavigationGuard |

## Test Results
```
63 same-origin-policy tests — all pass
6389 total tests pass, 3 failed (pre-existing DNS timeouts), 142 test files
```

## Verification Steps
1. Ran all 63 SOP tests — 63 pass, 0 fail
2. Ran full test suite — 6389 pass, 3 fail (pre-existing), 142 files, 0 regressions
3. Verified CORS mode parsing (cors/no-cors/same-origin/navigate)
4. Verified credentials parsing (omit/same-origin/include)
5. Verified opaque response creation (type, empty headers/body)
6. Verified CORP enforcement logic (same-origin/same-site/cross-origin)
7. Verified storage SOP throws SecurityError on origin mismatch
8. Verified iframe contentDocument returns null for cross-origin
9. Verified SopNavigationGuard emits events and tracks history
10. Verified opaque origins (data:, about:, blob: → "null")
