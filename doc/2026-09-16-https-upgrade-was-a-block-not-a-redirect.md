# HTTPS-Only Mode Didn't Upgrade Navigations — It Just Blocked Them

**Date:** 2026-09-16
**Session:** Direct continuation of adding the `httpsOnlyMode` setting. The user re-shared the same HTTPS-First research (Chrome/Edge/Firefox all "retry as HTTPS," only warning if the retry itself fails) and asked to update the implementation against it. Checking Nova's actual navigation path against that description found the upgrade was never followed through.
**Status:** Completed

---

## Summary
`SecurityLayer.checkNavigation()` correctly computes an `'upgrade'` decision with the target HTTPS URL whenever a plain `http://` navigation needs upgrading (HSTS preload, the `httpsOnlyMode` setting, or the HSTS store). But nothing ever consumed `upgradeUrl` — `SecurityLayer.navigationGuard.canNavigate()` only ever returned `true`/`false`, and `NavigationController.runGuards()`/`navigateTo()` only understood "allow" or "hard block." So with HTTPS-Only Mode on (the default), typing or clicking any `http://` link didn't silently load the HTTPS version the way Chrome/Edge/Firefox do — it failed outright with a `NavigationBlockedError`, whose message happened to *mention* the HTTPS URL as English text but never navigated there. The toggle added earlier this session was real, but the feature underneath it had never actually redirected anyone, on any code path, since `decision: 'upgrade'` was introduced.

## Root Causes

1. **The navigation guard contract could only say yes or no — never "try this URL instead."** `INavigationGuard.canNavigate()` returns a `boolean`, and `NavigationController.runGuards()` treated any `false` as a terminal failure, calling `this.fail()` with a `NavigationBlockedError`. `SecurityLayer.checkNavigation()` already had the exact right answer computed (the upgraded HTTPS URL) but had no way to hand it back through that boolean-only contract — the only place it surfaced was as a sentence inside `blockedReason()`, meant for a human reading an error message, not for the controller to act on. Fixed by adding an optional `upgradeUrl(request)` method to `INavigationGuard`: when a guard blocks a navigation but can name a better URL, `NavigationController.navigateTo()` now recurses into that URL instead of failing. `SecurityLayer.navigationGuard` implements it by returning `checkNavigation(url).upgradeUrl` whenever the decision was `'upgrade'`.

## Notes
- Scoped this narrowly to the guard that was actually broken and directly tied to the setting just shipped. While reading the surrounding code, found a *second*, differently-shaped instance of the same bug class: CSP's own `upgrade-insecure-requests` directive computes an upgraded URL in `CspNavigationGuard.checkNavigation()` (`{ allowed: true, upgradedUrl }`) but `CspGuardAdapter.canNavigate()` only reads `.allowed` and silently drops `.upgradedUrl` — so a site sending that CSP directive still loads over plain HTTP today. Not fixed here (different shape: CSP's version returns `allowed: true`, not `false`, so it doesn't fit through the same `!allowed` branch this fix uses) — flagged as a follow-up task instead of bundling a second redesign into this one.
- Verified there's no infinite-redirect risk: `SecurityLayer.checkNavigation()` only computes an upgrade for URLs that are `http://`-like (`isHttpLike` gate at the top of the function), so the recursive `navigateTo()` call on the resulting `https://` URL can never trigger another upgrade from the same guard.
- The engine-level middleware in `main.ts` (`engine.addMiddleware(...securityLayer.checkNavigation...)`) was not touched — it runs on the navigation entry the controller already committed, which is now the upgraded HTTPS URL by the time that middleware sees it, so it was never the source of the bug and needed no change.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/navigation/navigation-controller.ts` | Added optional `upgradeUrl(request)` to `INavigationGuard`; `runGuards()` surfaces it when a guard blocks; `navigateTo()` recurses into the upgraded URL instead of failing when one is present |
| `src/browser/media/security-layer.ts` | `navigationGuard` now implements `upgradeUrl()`, returning the HTTPS target whenever `checkNavigation()`'s decision is `'upgrade'` |
| `tests/navigation-controller.test.ts` | Added a test confirming a guard-supplied `upgradeUrl` results in a successful navigation to the upgraded URL, not a block |
| `tests/security-layer.test.ts` | Added tests confirming `navigationGuard.upgradeUrl()` returns the HTTPS target when blocking, and is falsy for navigations that are simply allowed |

## Files Created
- `doc/2026-09-16-https-upgrade-was-a-block-not-a-redirect.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                                          → 0 errors (repo-wide)
npx vitest run tests/navigation-controller.test.ts tests/security-layer.test.ts
  tests/content-security-policy.test.ts                                        → 255/255 passed (3 new)
npx vitest run (full suite)                                                    → 223 files / 9260 tests passed (0 regressions)
```

## Verification Steps
1. Re-read `SecurityLayer.checkNavigation()` against the user's re-shared research describing Chrome/Edge/Firefox's "retry as HTTPS, warn only if that fails" behavior, and traced where `decision: 'upgrade'` actually goes.
2. Found `SecurityLayer.navigationGuard.canNavigate()` returns only `check.allowed` (`false` for an upgrade decision) and that `NavigationController.runGuards()`/`navigateTo()` have no concept of "block, but here's where to go instead" — confirmed by grepping every consumer of `upgradeUrl`/`decision === 'upgrade'` in the codebase and finding none that acts on it, only one that stringifies it into an error message.
3. Added the `upgradeUrl()` guard capability, wired `NavigationController` to follow it, and implemented it on `SecurityLayer.navigationGuard`.
4. Added tests at both layers (`NavigationController` honoring a synthetic guard's `upgradeUrl`; `SecurityLayer.navigationGuard.upgradeUrl` returning the right value) and ran the targeted suites (255/255 passed) plus the full suite.
5. Found and flagged (but did not fix) a second, differently-shaped instance of the same bug class in CSP's `upgrade-insecure-requests` directive, out of scope for this fix.
