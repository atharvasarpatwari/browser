# HTTPS-First and CSP Enforcement Were Fully Built, but Invisible to the User

**Date:** 2026-09-16
**Session:** User shared research comparing how Chrome, Edge, Firefox, and Safari each expose an "HTTPS-First"/"HTTPS-Only Mode" toggle in their own settings UI. Investigating Nova's equivalent found the enforcement itself already fully implemented and on by default — the gap was that nothing let the user see or turn it off. Fixing that surfaced a near-identical bug next to it: the existing `enableCsp` setting in the same Privacy & Security section had never been wired to anything real either. Asked directly to check it, and found the same class of bug with a different shape.
**Status:** Completed

---

## Summary
`HttpsService` (`src/browser/media/https.ts`) already defaults `_enforceHttps` to `true` and is already wired into `SecurityLayer.checkNavigation()`'s upgrade logic — every `http://` navigation (other than loopback hosts) is already silently upgraded to `https://`, matching the exact behavior the user's research described for other browsers. But `setEnforceHttps`/`isEnforceHttps` were referenced nowhere outside those two files: no setting existed to display or change it, and the on-by-default state had no persistence, so it was a hardcoded constant dressed up as a feature. Added a real `httpsOnlyMode` toggle to the existing Settings → Privacy & Security section, wired to the live `HttpsService` instance both at startup and on live changes.

The neighboring `enableCsp` setting turned out to be worse: it had a `SettingDefinition` entry and a test asserting its default value, but grepping for it anywhere else in the codebase came back empty — it was never read by anything. Unlike HTTPS enforcement, CSP enforcement itself had no on/off switch at any level; `CspPolicyStore`, the shared object all three CSP consumers (`CspNavigationGuard`, `CspResourceEnforcer`, `CspScriptEnforcer`) already depend on, simply always returned whatever policy a page had sent. Added the on/off switch at that one shared choke point instead of touching all three consumers individually, then wired it the same way as the HTTPS setting.

## Root Causes

1. **A fully-built, on-by-default security feature had zero settings-UI exposure.** `HttpsService.setEnforceHttps()`/`isEnforceHttps()` existed and were correctly consumed by `SecurityLayer.checkNavigation()`, but grepping the whole codebase for those names turned up matches only inside `security-layer.ts` and `https.ts` themselves — never from `main.ts`'s DI wiring or `settings-page.ts`'s declarative setting schema. The behavior was real and active, but nothing let a user see it was on, confirm it, or turn it off, and nothing persisted the choice across restarts.
2. **The `enableCsp` setting was pure decoration — CSP enforcement had no disable mechanism to wire it to in the first place.** `enableCsp` existed as a `SettingDefinition` and was asserted in one test (`settings-page.test.ts`), but was never read anywhere else — no code branched on it, and CSP enforcement always ran unconditionally once headers arrived. This differed from the HTTPS case in one important way: `HttpsService` already had a real toggle sitting unused; CSP's enforcement pipeline (`CspNavigationGuard`/`CspResourceEnforcer`/`CspScriptEnforcer`) had *no* toggle anywhere to wire the setting to — the setting wasn't just unwired, the wire had nowhere to plug in. Added one: all three consumers already fetch their policy through the same `CspPolicyStore.getEnforcePolicy(origin)` call and already treat a `null` return as "no policy → allow" (verified by reading each consumer's null-check), so adding a single `enabled` flag to `CspPolicyStore` that makes `getEnforcePolicy()` return `null` when disabled turns off enforcement everywhere at once, with no changes needed to any of the three consumers.

## Notes
- Followed the same wiring idiom already used for `BrowserName.init(settingsService)` for both settings (read the persisted value once at startup, subscribe to `settingsService.onChange` for live updates) rather than introducing a new pattern. `SecurityLayer` already exposes its `HttpsService` instance publicly as `securityLayer.https`, and `main.ts` already resolves `cspEnforcement` earlier in the same bootstrap method — so both wirings are two lines each, no new plumbing.
- Turning HTTPS-Only Mode off only disables the *unconditional* upgrade step (`checkNavigation()`'s step 2). HSTS preload and the HSTS store (steps 1 and 2b, unaffected by this setting) still force HTTPS for hosts that specifically require it — matching the real-world relationship between HSTS and HTTPS-Only/HTTPS-First mode described in the user's research, where the two are layered, not the same mechanism.
- The CSP fix is the smaller, root-cause-correct diff on purpose: putting the `enabled` check inside `CspPolicyStore.getEnforcePolicy()` means all three enforcement points (navigation, scripts, resources) turn off together from one flag, instead of three separate `if (!enabled) return allow` guards that could drift out of sync if a fourth consumer is ever added.
- `CspPolicyStore.getReportOnlyPolicy()` is unrelated dead code (never called by anything, confirmed by grep) — left untouched since it wasn't part of what broke and isn't part of the `enableCsp` setting's own scope.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/settings-page.ts` | Added `httpsOnlyMode` boolean setting to the `'privacy'` section (`defaultValue: true`, matching the engine's existing hardcoded default); `enableCsp` already existed |
| `src/app/main.ts` | Applies the persisted `httpsOnlyMode` value to `securityLayer.https` at startup and live-updates it via `settingsService.onChange`; same pattern for `enableCsp` → `cspEnforcement.policyStore.setEnabled()` |
| `src/browser/security/csp-policy-store.ts` | Added `enabled` flag with `isEnabled()`/`setEnabled()`; `getEnforcePolicy()` now returns `null` immediately when disabled |
| `tests/content-security-policy.test.ts` | Added a `CspPolicyStore` test covering default-enabled state and disable/re-enable behavior |

## Files Created
- `doc/2026-09-16-https-only-mode-setting.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                    → 0 errors (repo-wide)
npx vitest run tests/content-security-policy.test.ts     → 180/180 passed (1 new)
npx vitest run (full suite)                               → 223 files / 9256 tests passed (0 regressions)
```

## Verification Steps
1. Grepped for `setEnforceHttps`/`isEnforceHttps`/`enforceHttps` across the repo and confirmed zero references outside `security-layer.ts`/`https.ts` — the feature existed but was completely unwired to any UI or persistence.
2. Read `settings-page.ts`'s existing `'privacy'` section and `settings-service.ts`'s `SettingsService` class in full to confirm the declarative `SettingDefinition` schema and the `onChange`/`getBoolean` API needed for wiring.
3. Confirmed `SecurityLayer` exposes its `HttpsService` instance as a public `readonly https` property, so no new accessor was needed to reach it from `main.ts`.
4. Added the `httpsOnlyMode` setting definition and its two-line startup-apply + live-subscribe wiring in `main.ts`, reusing the exact idiom already used for `BrowserName.init()`.
5. Asked to check `enableCsp` too. Grepped for it and found only the settings-schema entry and one test asserting its default — nothing consumed it. Read `csp-enforcement.ts` and all three enforcement modules (`csp-navigation-guard.ts`, `csp-resource-enforcer.ts`, `csp-script-enforcer.ts`) and confirmed each independently fetches its policy via `policyStore.getEnforcePolicy(origin)` and already treats `null` as "allow" — the one shared choke point to add a switch to.
6. Added `enabled`/`isEnabled()`/`setEnabled()` to `CspPolicyStore`, made `getEnforcePolicy()` short-circuit to `null` when disabled, and wired `main.ts`'s `enableCsp` setting to it the same way as `httpsOnlyMode`.
7. Added one test to `tests/content-security-policy.test.ts`'s existing `CspPolicyStore` suite covering the default-enabled state and disable/re-enable behavior.
8. Ran `npx tsc --noEmit -p .` (0 errors), the CSP test file directly (180/180 passed), and the full `npx vitest run` suite (223 files / 9256 tests, 0 regressions).
