# CSP `upgrade-insecure-requests` Was Silently Discarded

**Date:** 2026-09-19
**Session:** Wire `CspGuardAdapter` to actually follow the upgraded URL CSP already computes. Landed into this branch on 2026-09-20 from a separate background session (`distracted-keller-882a3c`) that had finished and verified this fix independently.
**Status:** Completed

---

## Summary

`CspNavigationGuard.checkNavigation()` already detected a page's
`Content-Security-Policy: upgrade-insecure-requests` directive and computed the `https:` URL via
`tryUpgrade()`, returning `{ allowed: true, upgradedUrl }`. But `CspGuardAdapter.canNavigate()` —
the `INavigationGuard` that plugs CSP into `NavigationController`'s guard chain — only read
`result.allowed` and threw `upgradedUrl` away. A site sending that directive had it silently
ignored: Nova loaded the original `http://` URL instead of upgrading it.

The background session that found this (`distracted-keller-882a3c`) branched independently from
`main` and didn't yet have this branch's `INavigationGuard.upgradeUrl()` / `NavigationController`
redirect mechanism (added here earlier for `SecurityLayer`'s own HTTPS/HSTS upgrade decision), so
it ported that mechanism over before building on it. Landing the fix into this branch found that
mechanism already present — only the actual `CspGuardAdapter` fix and its tests were new.

## Root Cause

**File:** `src/browser/security/csp-guard-adapter.ts`
**Problem:** `canNavigate()` returned `result.allowed`, which is `true` for the
upgrade-insecure-requests case — so the guard chain treated the navigation as a plain allow and
never looked at `upgradedUrl` at all.
**Fix:** `canNavigate()` now returns `false` whenever `result.upgradedUrl` is present (mirroring
how `SecurityLayer.checkNavigation()` already represents an upgrade as `allowed: false`), and a
new `upgradeUrl(request)` method returns that URL so `NavigationController` can re-navigate to it.
`blockedReason()` mentions the upgraded URL instead of a generic CSP-blocked message. Extracted the
three duplicated `checkNavigation(...)` call sites into a private `check()` helper.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/security/csp-guard-adapter.ts` | `canNavigate()` blocks (returns `false`) when CSP computed an `upgradedUrl`; added `upgradeUrl(request)`; `blockedReason()` surfaces the upgraded URL; deduped the three `checkNavigation()` calls into a `check()` helper |
| `tests/content-security-policy.test.ts` | New `CspGuardAdapter` describe block: no-policy allow, upgrade-insecure-requests blocks `canNavigate` and exposes `upgradeUrl`/`blockedReason`, and a genuine CSP violation blocks with no `upgradeUrl` |

Note: `src/browser/navigation/navigation-controller.ts` and `src/browser/media/security-layer.ts`
needed no change on this branch — the `upgradeUrl?()` guard hook and its `SecurityLayer`
implementation were already landed here as part of the same-day HTTPS-upgrade-was-a-block fix.

## Test Results

```
npx tsc --noEmit -p .                              → 0 errors
npx vitest run tests/content-security-policy.test.ts → 183/183 passed (180 existing + 3 new)
```

## Verification Steps

1. Read `CspNavigationResult`'s shape in `csp-navigation-guard.ts` — confirmed the
   upgrade-insecure-requests branch already returns `{ allowed: true, upgradedUrl }`.
2. Diffed the originating session's `navigation-controller.ts`/`security-layer.ts` changes against
   this branch's current files — confirmed byte-for-byte equivalent logic already present, so only
   `csp-guard-adapter.ts` needed to land here.
3. Added the `CspGuardAdapter` tests covering: no policy → allow, `upgrade-insecure-requests` →
   block + correct `upgradeUrl`, and a `form-action 'none'` violation → block with no `upgradeUrl`.
4. `npx tsc --noEmit -p .` clean; `content-security-policy.test.ts` green (183/183, no regressions).
