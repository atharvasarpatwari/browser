# Same-Origin Policy Implementation Plan

**Date:** 2026-07-26
**Status:** Approved
**Scope:** 8 phases — full SOP enforcement across all browser pipelines

---

## Background

Nova has well-designed standalone SOP modules (`CrossOriginGuard`, `CorsEngine`, `OriginIsolator`) but none are wired into the actual JS/navigation/storage pipelines. Cross-origin `fetch()`, `XMLHttpRequest`, DOM access, and storage access all succeed without any enforcement. This plan wires everything together.

## Architecture Decision: Unified OriginService

Rather than having `CorsEngine.parseOrigin()`, `CrossOriginGuard.isSameOrigin()`, and `OriginIsolator` each do their own origin comparison, we create a single `OriginService` that:
- Parses origins per WHATWG URL Standard
- Handles opaque origins (`"null"` for `data:`, `about:blank`, sandboxed iframes)
- Provides `isSameOrigin()`, `isSameSite()`, `originOf()`
- Used by all security modules

## Phases

### Phase 1: OriginService (new file)
**File:** `src/browser/security/origin-service.ts`
- `parseOrigin(url: string): string` — WHATWG URL Standard, opaque `"null"` for non-network schemes
- `isSameOrigin(a: string, b: string): boolean` — scheme + host + port comparison
- `isSameSite(a: string, b: string): boolean` — eTLD+1 comparison for SameSite cookies
- `getEffectiveOrigin(url: string, referrer?: string): string` — handles `about:blank` inheritance
- `isOpaqueOrigin(origin: string): boolean`

### Phase 2: Wire fetch() to CorsEngine
**File:** `src/browser/js/fetch-api.ts`
- Parse `mode` from init (`cors` | `no-cors` | `same-origin` | `navigate`)
- Parse `credentials` from init (`omit` | `same-origin` | `include`)
- Inject `Origin` header for cross-origin requests
- Call `CorsEngine.checkRequest()` before network request
- Call `CorsEngine.checkResponse()` after network response
- Create `OpaqueResponse` when `no-cors` mode or CORS check fails
- Set `Response.type = "opaque"` for opaque responses

### Phase 3: Wire XHR to CorsEngine
**File:** `src/browser/js/xhr.ts`
- Add `withCredentials` support — pass to `fetch()` credentials option
- Add restricted header blocking in `setRequestHeader()` (host, content-length, etc.)
- Route requests through CorsEngine before `globalThis.fetch()`
- Validate CORS response headers
- Handle opaque responses (set `responseType = ""` behavior, hide response body)

### Phase 4: Navigation SOP Guard
**File:** `src/browser/navigation/navigation-controller.ts`
- Create `SopNavigationGuard` implementing `INavigationGuard`
- `canNavigate()`: compare current page origin to target URL origin
- Cross-origin navigations allowed (just trigger context switch), but logged
- Wire `OriginIsolator.checkNavigation()` into the guard for context isolation decisions
- Register guard in the guard chain after CSP guard

### Phase 5: DOM Access SOP
**File:** `src/browser/js/dom-bindings.ts` (iframe wrappers)
- Intercept `iframe.contentWindow` access
- Call `CrossOriginGuard.checkAccess({type: 'dom-read'})` before returning
- Block cross-origin DOM access (return `null` or throw SecurityError)
- Handle `sandbox` attribute — stripped `allow-same-origin` = opaque origin

### Phase 6: Storage SOP
**Files:** `src/browser/storage/local-storage.ts`, `session-storage.ts`
- Add `origin` parameter to storage constructors
- In `getItem()`, `setItem()`, `removeItem()`, `clear()`, `key()`, `length` getter:
  - Accept calling origin parameter
  - Call `CrossOriginGuard.checkAccess({type: 'storage-read'/'storage-write'})`
  - Throw `SecurityError` on cross-origin access
- This is a defense-in-depth check (storage is already per-origin internally)

### Phase 7: CORP Enforcement
**File:** `src/browser/netwroking/resource-loader.ts`
- Read `crossOriginResourcePolicy` from parsed security headers
- For cross-origin loads: block if CORP header is `same-origin` or `same-site` and origin doesn't match
- Default to `cross-origin` (allow) when no CORP header present
- Log violations but don't throw (resource just fails to load)

### Phase 8: Opaque Origin
**Files:** `src/browser/navigation/url-parser.ts`, `src/browser/security/origin-service.ts`
- `data:` URLs → opaque origin `"null"`
- `about:blank` → inherits referrer's origin (or `"null"` if no referrer)
- `about:srcdoc` → inherits parent's origin
- Sandboxed iframes without `allow-same-origin` → opaque origin `"null"`
- `blob:` URLs → origin of the creating context

## Test Plan
- **Phase 1:** 20 tests — origin parsing, same-origin, same-site, opaque, inheritance
- **Phase 2:** 15 tests — fetch mode/credentials, CORS headers, opaque response
- **Phase 3:** 15 tests — XHR withCredentials, restricted headers, CORS enforcement
- **Phase 4:** 10 tests — navigation guard, cross-origin navigation, context switch
- **Phase 5:** 10 tests — iframe DOM access, sandboxed iframe, opaque origin DOM
- **Phase 6:** 10 tests — storage cross-origin throws, same-origin succeeds
- **Phase 7:** 8 tests — CORP same-origin/cross-origin enforcement
- **Phase 8:** 12 tests — opaque origin for data:, about:blank, blob:, sandboxed

**Total: ~100 new tests**

## Files Modified/Created

| File | Change |
|------|--------|
| `src/browser/security/origin-service.ts` | **NEW** — unified origin comparison |
| `src/browser/js/fetch-api.ts` | CorsEngine integration, mode/credentials |
| `src/browser/js/xhr.ts` | CorsEngine integration, withCredentials |
| `src/browser/navigation/navigation-controller.ts` | SopNavigationGuard in guard chain |
| `src/browser/js/dom-bindings.ts` | iframe DOM access interception |
| `src/browser/storage/local-storage.ts` | Origin parameter + SOP check |
| `src/browser/storage/session-storage.ts` | Origin parameter + SOP check |
| `src/browser/netwroking/resource-loader.ts` | CORP enforcement |
| `src/browser/navigation/url-parser.ts` | Opaque origin for data:/about:/blob: |
