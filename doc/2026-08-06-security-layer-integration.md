# Full Security Layer Integration

**Date:** 2026-08-06
**Session:** Wire all 18 media security modules into production DI + runtime — SecurityLayer aggregator, navigation guard, engine middleware, PageRenderer sub-resource/SRI hooks
**Status:** Completed

---

## Summary

The 18 security wrapper modules under `src/browser/media/` (11 from 2026-07-29 plus 7 from 2026-08-06) were previously test-only. This session created a `SecurityLayer` aggregator that owns all 18 modules and exposes uniform decision APIs, then wired it into the production bootstrap so the full security layer actually runs in the browser: navigation guard chain, engine load middleware, and sub-resource/SRI enforcement in the rendering pipeline.

## Architecture Decisions

### 1. One aggregator, not 18 DI registrations
Rather than 18 tokens + registrations in `main.ts`, the `SecurityLayer` composes all 18 modules internally (composition over config) and registers as a single `Singleton` DI service (`Tokens.SecurityLayer`). Each child module stays reachable via public getters (`securityLayer.mixedContent`, `securityLayer.hstsPreload`, …) for fine-grained runtime control (e.g. `securityLayer.https.setEnforceHttps(false)`).

### 2. Decision API shape
All checks return a uniform `{ allowed, decision, reason?, upgradeUrl? }` where `decision: 'allow' | 'block' | 'warn' | 'upgrade'` and `allowed` is `true` for allow/warn. `upgrade` means *block now, retry over HTTPS* and carries the target URL.

### 3. Enforcement points wired
| Hook | Where | What runs |
|------|-------|-----------|
| `navigationGuard` | `navController.addGuard(securityLayer.navigationGuard)` in `mountBrowserUI()` | HTTPS-only upgrade, HSTS preload upgrade, DNS-rebinding (when resolved IP known), PNA (when IPs known), XSS URL warn |
| engine middleware | `engine.addMiddleware(...)` in `mountBrowserUI()` | `checkNavigation` re-run between routing and fetching (belt-and-suspenders) |
| sub-resource gate | `PageRenderer.executeAllScripts()` | `checkSubresource(baseUrl, fullUrl, 'script')` — mixed content, CSRF (state-changing), PNA |
| SRI verification | `PageRenderer.executeAllScripts()` | `verifySubresourceIntegrity()` on `integrity` attribute before executing fetched scripts |
| response headers | `PageRenderer.render()` | `applyResponseHeaders()` — records COOP/COEP/Referrer-Policy per origin, clickjacking (framed only), CORP enforcement under COEP |

### 4. Behavior notes (module defaults surfaced at runtime)
- **HTTPS-only**: `HttpsService` default `enforceHttps=true` means every `http://` navigation is blocked with an `upgrade` decision (target URL provided). Disable with `securityLayer.https.setEnforceHttps(false)`.
- **HSTS preload**: `http://` to the 41 preloaded hosts upgrades first (preload takes precedence over the generic HTTPS rule).
- **DNS/PNA are IP-gated**: they only fire when the caller supplies resolved IPs (the renderer passes them only for IP-literal hosts; the DNS layer can supply them later). No DNS resolution is performed by the layer itself.
- XSS in navigation URLs is `warn` (allowed, surfaced in events/stats) to avoid false-positive blocking of legit query strings.
- Clickjacking (`X-Frame-Options`/`frame-ancestors`) is only enforced when `framed: true` — top-level documents are never framed.

## Root Causes

### 1. `HttpsService.checkAndUpgrade` returns the *original* URL when enforcement blocks
**File:** `src/browser/media/security-layer.ts` (initial `checkNavigation`)
**Problem:** The first implementation assumed `checkAndUpgrade('http://…')` returns the upgraded URL. With `enforceHttps=true` and no HSTS entry it emits `'blocked'` and returns the original URL unchanged, so plain-http navigation passed as `allow`.
**Fix:** treat enforcement explicitly — if `isEnforceHttps() && url.startsWith('http://')`, return an `upgrade` decision with `upgradeUrl = https.upgradeUrl(url)`; only fall through to `checkAndUpgrade` for HSTS-store upgrades when enforcement is disabled:
```ts
if (this.https.isEnforceHttps() && url.startsWith('http://')) {
  const target = this.https.upgradeUrl(url);
  return { allowed: false, decision: 'upgrade', upgradeUrl: target, reason: `HTTPS required for ${url}; use ${target}` };
}
const upgraded = this.https.checkAndUpgrade(url);
if (upgraded !== url) { /* HSTS upgrade path */ }
```

### 2. Event-forwarding signature mismatch
**File:** `src/browser/media/security-layer.ts`
**Problem:** Child modules' `onEvent` handlers expect their own event types; forwarding with a `SecurityLayerEvent` (which adds a required `service` field) was not a supertype, breaking assignability.
**Fix:** the forwarder accepts the structural supertype `{ kind: string; data?: Record<string, unknown> }` and wraps it with the service name before dispatch.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Exported `SecurityLayer` + all its types |
| `src/app/main.ts` | `Tokens.SecurityLayer`, DI `Singleton` registration, `navigationGuard` added to controller, security-layer middleware, `securityLayer` passed to `PageRenderer` |
| `src/browser/engine/page-renderer.ts` | Optional `securityLayer` dependency; sub-resource gate + SRI verification in `executeAllScripts`; `applyResponseHeaders` at top of `render()` |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/security-layer.ts` | `SecurityLayer` aggregator — 18 modules composed, `checkNavigation` / `checkSubresource` / `applyResponseHeaders` / `verifySubresourceIntegrity` / `getReferrerForPage` / `getStats` / `navigationGuard` / `onEvent` / `dispose` |
| `tests/security-layer.test.ts` | 26 tests across navigation, sub-resource, SRI, response headers, referrer, guard, stats/events/lifecycle |

## Test Results

```
> npx vitest run tests/security-layer.test.ts
 Test Files  1 passed (1)
      Tests  26 passed (26)

> npx vitest run tests/security.test.ts tests/security-protocols.test.ts tests/page-renderer.test.ts
 Test Files  3 passed (3)
      Tests  172 passed (172)          ← 69 + 79 + 24 page-renderer, no regressions

> npx vitest run                                  (full suite)
 Test Files  186 passed (1) / 188 total
      Tests  8587 passed / 3 failed (8642)
```
The 3 failures are the pre-existing live-network `tests/networking-integration.test.ts` "DnsResolver — real system resolution" cases (confirmed identical on a clean tree in the 2026-08-06 protocol session). The worker heap-OOM in a memory-stress file was recovered by the runner as before.

```
> npx tsc --noEmit
0 errors

> npx eslint src/browser/media/security-layer.ts src/browser/media/index.ts src/browser/engine/page-renderer.ts src/app/main.ts tests/security-layer.test.ts
0 errors, 5 warnings (all pre-existing: unused LifecycleManager imports, the existing `'CspEnforcement' as any` casts, unused `UsedStyle` import)
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors.
2. `npx vitest run tests/security-layer.test.ts` — 26/26 pass (HTTPS/HSTS upgrade, DNS rebinding, PNA, XSS warn, mixed content, CSRF with/without token, SRI valid/tampered, clickjacking framed vs top-level, CORP under COEP, referrer capture, navigation guard allow/block, event forwarding, dispose).
3. Regression suites (security + security-protocols + page-renderer) — 172/172 pass.
4. Full suite — only pre-existing live-DNS failures remain.
5. Lint — 0 errors (pre-existing warnings only).

## Runtime behavior to verify manually (browser)

- Navigating to `http://google.com` is blocked by the guard with a reason pointing at `https://google.com/`.
- Every plain-`http://` navigation gets the HTTPS upgrade decision (while `enforceHttps=true`).
- A page's `X-Frame-Options`/`CSP frame-ancestors` is evaluated for framed documents; `Referrer-Policy` and COOP/COEP headers are captured per origin for later sub-resource decisions.
- External `<script src integrity="sha256-…">` failing SRI is not executed.
