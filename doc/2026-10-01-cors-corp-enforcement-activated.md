# Activate CORS/CORP Subresource Enforcement (Phase 6i)

**Date:** 2026-10-01
**Session:** Surfaced by two independent prior investigations in passing (an HTTP cache correctness phase, and a SameSite cookie re-verification) that both noticed `ResourceLoader.setCors()` has zero callers anywhere in the codebase. Chosen over a DevTools Accessibility tab (genuinely small and clean, but feature polish — deferred as a strong future candidate) and SameSite cookie enforcement itself (re-confirmed still genuinely bigger; the real blocker is this same dead `pageOrigin` plumbing, but SameSite needs more on top of it that's out of scope here).
**Status:** Completed (1 root cause fixed)

---

## Summary

`ResourceLoader.pageOrigin` defaulted to `''` and was only ever set via `setCors()` — which nothing in the codebase ever called. This meant two already-written, already-tested blocks of enforcement logic had never executed once in the shipped app: the CORS post-response check and CORP (Cross-Origin-Resource-Policy) enforcement, both gated on `if (this.pageOrigin)`. CORP in particular is a real, meaningful, currently-100%-inert security control — any site could ignore `Cross-Origin-Resource-Policy: same-origin/same-site` entirely.

The naive fix (just call `setCors()`) would have caused a real regression, caught before writing any code: `resource-loader.ts` hardcoded `mode: CorsMode.Cors` for every subresource request, but `ResourceLoader` only ever handles HTML-parser-discovered passive subresources (images, stylesheets, scripts, sub-documents) — real browsers load these in `no-cors` mode by default, not `cors` mode. Turning on enforcement with the mode left as `Cors` would have made every ordinary cross-origin image/stylesheet/script that doesn't send `Access-Control-Allow-Origin` start failing to load. Verified directly in `cors.ts` that `CorsMode.NoCors` is already fully and correctly handled (no preflight, no ACAO requirement, opaque response) — so changing the hardcoded mode was the correct fix, not a corner cut.

Live verification surfaced one more real wrinkle beyond the plan: the dev-preview harness routes requests through the real browser's own `fetch()` (no raw-socket access, same limitation hit by prior phases), and an initial live test without `Access-Control-Allow-Origin` on the test server failed at the *real* browser's CORS layer before Nova's own logic ever ran — a different failure mode than the one being tested, not a bug in the fix. Adding ACAO to the test fixture unblocked it, and the real CORP block then fired correctly on the very next request.

## Root Causes

1. **`setCors()` had zero callers, so `pageOrigin`/CORS/CORP were permanently inert.** Fixed by calling `resourceLoader.setCors(this.deps.corsEngine, parseOrigin(result.url))` once per navigation in `PageRenderer.render()` (the already-per-navigation entry point), reusing the already-resolved `corsEngine` dependency that `fetch()`/XHR already use — no new service, no new DI registration. Paired with changing the two hardcoded `CorsMode.Cors` occurrences in `resource-loader.ts` to `CorsMode.NoCors`, matching what real browsers actually use for this traffic and avoiding the regression a naive wiring would have caused.

## Notes

- `IResourceLoader` didn't declare `setCors()` (only the concrete `ResourceLoader` class did) — added it to the interface, matching how `setOnLoad()` is already exposed there for the same reason (an interface-typed consumer needing to call a configuration setter). Three existing test files had hand-written mock `IResourceLoader` objects that needed a `setCors: vi.fn()` added to satisfy the now-stricter interface — a mechanical type-safety fix, no behavior change.
- `fetch()`/`XMLHttpRequest` are untouched — they already go through a separate, already-correctly-wired CORS path via `fetch-api.ts`/`xhr.ts`.
- Explicitly out of scope: SameSite cookie enforcement (the bigger, still-deferred problem this same dead `pageOrigin` was partly blocking); upgrading subresource CORS mode to real `cors` mode when an explicit `crossorigin` attribute is present (real browsers do this, but no plumbing currently carries that attribute from the HTML parser's discovered-resource list down to `ResourceLoader` — a real, separate, additive enhancement); per-tab isolation of `ResourceLoader`/`pageOrigin` (confirmed a single app-wide instance shared across all tabs today — a pre-existing architectural fact, unrelated to this fix).
- A DevTools Accessibility tab was investigated as an alternative and found genuinely small and low-risk (Console/Network/Elements panels turned out to already be shipped via a separate, previously-overlooked `devtools-panel.ts`; Accessibility would reuse an already-tested audit engine against the same DOM tree already feeding the Elements tab) — a strong candidate for a future phase, not picked this round only because this phase is a live security gap.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Added `setCors()` to the `IResourceLoader` interface; changed both hardcoded `CorsMode.Cors` occurrences to `CorsMode.NoCors` (pre-request and post-response checks) |
| `src/browser/engine/page-renderer.ts` | `render()` now calls `resourceLoader.setCors(corsEngine, parseOrigin(result.url))` once per navigation |
| `tests/resource-loader.test.ts` | +6 tests: regression guard (ordinary cross-origin resource still loads), same-origin unaffected, CORP same-origin/same-site blocking, same-site-allows via the existing `www.`-stripping `isSameSite()`, and pre-`setCors()` behavior preserved |
| `tests/page-loader.test.ts`, `tests/page-renderer.test.ts`, `tests/security-runtime-enforcement.test.ts` | Added `setCors: vi.fn()` to existing mock `IResourceLoader` objects (type-safety only, no behavior change) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-01-cors-corp-enforcement-activated.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 240/240 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9411/9411 tests (6 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition noted in the last several changelogs.

## Verification Steps

1. Real-pipeline tests (no mocks of `ResourceLoader`/`CorsEngine` themselves): an ordinary cross-origin resource with no special headers still loads after `setCors()` is wired (the regression guard the naive fix would have failed); a same-origin resource is unaffected regardless of `setCors()` state; a cross-origin resource with `Cross-Origin-Resource-Policy: same-origin` is now blocked; a cross-site resource with `same-site` is blocked; a `www.`-prefix variant of the same host is correctly allowed under `same-site` (matching this codebase's existing, simpler `isSameSite()` — a `www.`-strip compare, not a full eTLD+1 extraction); CORP headers are silently ignored when `setCors()` is never called (preserving pre-fix behavior for any caller that doesn't opt in).
2. Live dev-preview verification, full end-to-end: a real two-script test page (one plain cross-origin script, one sending `Cross-Origin-Resource-Policy: same-origin`) confirmed the plain script still loads and executes (no regression) while the CORP-protected one is now actually blocked — the first real, observable proof this enforcement has ever run. Hit and worked through a real environment wrinkle along the way: the dev-preview harness's `fetch()`-based HTTP client is itself subject to the *host* browser's own CORS rules, so the first test needed `Access-Control-Allow-Origin` on the test fixture before Nova's own CORP logic could be observed in isolation — a harness detail, not a defect in the fix.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
