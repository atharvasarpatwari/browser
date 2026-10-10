# Security Runtime Enforcement Wiring (CSP / CORS / Secure Context)

**Date:** 2026-09-13
**Session:** Wire three dormant security layers into real enforcement in the Nova Browser
**Status:** Completed

---

## Summary

Turned three "implemented but never activated" security layers into enforced runtime behavior:
(1) CSP headers are now ingested live from page responses by `PageRenderer` and keyed by document
origin, (2) the CORS engine is now attached to the JS engine so `fetch()` actually enforces
`Access-Control-Allow-Origin`, and (3) a secure-context model was introduced that gates powerful
web permissions (geolocation, notifications, clipboard, camera, microphone) on insecure origins.
Along the way a real fetch-CORS integration bug was found and fixed.

## Root Causes

### 1. `CspPolicyStore.storeFromHeaders` had zero callers (CSP dormant)
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** The complete CSP module suite (store, script/resource/navigation enforcers, reporter)
was wired into DI, but nothing ever fed parsed policies into the store. `checkInlineScript` /
`checkFetch` therefore always consulted an empty store and blocked nothing.
**Fix:** `PageRenderer.render()` now ingests `Content-Security-Policy` and
`Content-Security-Policy-Report-Only` headers in a new step 0b (next to the existing
`securityLayer.applyResponseHeaders`), keyed by `parseOrigin(result.url)`; opaque origins are
skipped. `executeAllScripts()` now derives a canonical `const origin = parseOrigin(baseUrl)` once
and passes it as `pageOrigin` while `documentOrigin` stays the full base URL, so store lookups
(`scheme://host[:port]`) and directive checks align.

### 2. CORS engine never reached the JS engine (CORS implemented-but-unattached)
**File:** `src/browser/js/index.ts`, `src/browser/js/fetch-api.ts`, `src/app/main.ts`
**Problem:** `fetch()`/XHR already accepted a `corsEngine` parameter, `ResourceLoader.setCors()`
existed, but nothing passed an engine in — every cross-origin fetch was best-effort, so ACAO was
ignored. `createFetchFn`'s post-response check also always saw an empty header map.
**Fix:** `runJS` / `createGlobalEnv` gained a `corsEngine` option; XHR now gets
`createXMLHttpRequestClass(eventLoop, corsEngine, pageOrigin)`. `main.ts` registers the existing
`media/cors.ts` `CorsService` as a DI singleton (`Tokens.CorsService`) and injects it, plus
`cspEnforcement.policyStore/resourceEnforcer/scriptEnforcer`, into the `PageRenderer` factory.

### 3. Secure-context model was missing entirely
**File:** `src/browser/security/secure-context.ts` (new), `src/browser/web-apis/web-apis-permissions.ts`
**Problem:** No `isSecureContext` anywhere, so powerful APIs were promptable/usable from
`http://` pages.
**Fix:** New `secure-context.ts` with `isSecureContextUrl` (https/wss, file/nova, localhost,
`.localhost`, 127.x, `[::1]`) and an `isSecureContextRequiredPermission` set. `PermissionStore`
takes an injectable `secureContextFor(name)` predicate (default `() => true`); `query()` returns
`'denied'` and `request()` short-circuits without prompting when it is false. The
`PermissionGatedWebApis` facade exposes `isSecureContext` (default `true`) and gates only powerful
permissions. The JS engine binds `window.isSecureContext` (non-writable) plus a global
`isSecureContext` from `pageOrigin`.

### 4. `fetch()` CORS post-response check always ran against empty headers
**File:** `src/browser/js/fetch-api.ts`
**Problem:** Line ~877 built the response header map with
`new Map(Object.entries(resHeaders.map))`. `Object.entries` on a `Map` instance returns `[]`, so
`CorsEngine.checkResponse` always saw an empty header map, always threw `CorsViolationError`, and
every cross-origin `fetch()` in CORS mode resolved as an opaque response even when the server sent
a matching `Access-Control-Allow-Origin`.
**Fix:** `headers: new Map(resHeaders.map)` copies the map's own entries, preserving lowercase keys
for the case-insensitive engine lookup.

## Files Modified

| File | Change |
|------|--------|
| `src/app/main.ts` | Added `Tokens.CorsService`; registered `ICorsService → CorsService` DI singleton; `PageRenderer` factory now passes `policyStore`, `corsEngine` (resolved `CorsService`) |
| `src/browser/js/index.ts` | `RunJSOptions.corsEngine`; `createGlobalEnv` 11th param; passes `corsEngine` to fetch/XHR; binds `window.isSecureContext` + global `isSecureContext` from `pageOrigin` |
| `src/browser/js/fetch-api.ts` | Fixed `checkResponse` header map construction (`new Map(resHeaders.map)`) |
| `src/browser/engine/page-renderer.ts` | CSP header ingestion (step 0b); canonical `origin = parseOrigin(baseUrl)`; passes `pageOrigin + corsEngine` to `runJS` |
| `src/browser/web-apis/web-apis-permissions.ts` | `PermissionStore` predicate gate; `WebApisConfig.isSecureContext`; facade gates powerful permissions only |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/security/secure-context.ts` | `isSecureContextUrl`, `isSecureContextOrigin`, `isSecureContextRequiredPermission` |
| `tests/security-runtime-enforcement.test.ts` | 22 integration tests: CSP ingestion + enforcement, CORS attach (opaque/exposed/same-origin), `window.isSecureContext`, permission gating |

## Test Results

```
npx tsc --noEmit                  → 0 errors
npx vitest run security-runtime-enforcement.test.ts → 22/22 passed
npx vitest run fetch-api.test.ts  → 36/36 passed
npx vitest run web-apis-permissions.page-renderer.same-origin-policy.cors.security → 321/321 passed
npx vitest run                    → 217 files / 9,201 tests ALL PASSED
```

## Verification Steps

1. `npx tsc --noEmit` — clean after every source edit.
2. Wrote the 22-test wiring suite; iterated against failures (bare top-level assignment vs `var`,
   `Map.forEach` argument order, lowercased `origin` header, `PermissionName` union, store-level vs
   facade-level gating semantics).
3. Used a scratch spec to isolate the fetch CORS failure to the empty headers map; confirmed
   `Object.entries(map) === []` and fixed the map copy; deleted the scratch spec.
4. Full suite 217 files / 9,201 tests green — no regressions in fetch-api, permissions, CSP, CORS,
   or the renderer.