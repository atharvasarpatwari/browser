# Security Policy Modules

**Date:** 2026-07-29
**Session:** 11 security modules — Same-Origin Policy, CORS, CSP, Sandbox, HTTPS, Certificates, Mixed Content, XSS Protection, CSRF Protection, Clickjacking Protection, Permission Manager
**Status:** Completed

---

## Summary

Created 11 security policy wrapper modules under `src/browser/media/`, each following the `IDisposable` + `onEvent` pattern established by the prior 26 modules. Seven modules wrap existing security infrastructure (`src/browser/security/`) and four are entirely new implementations.

## Architecture Decisions

### Which modules wrap existing code vs. are new

| # | Module | Approach | Existing source |
|---|--------|----------|----------------|
| 1 | SameOriginPolicy | Wraps `security/origin-service.ts` stateless functions | `isSameOrigin`, `parseOrigin`, etc. |
| 2 | CorsService | Wraps `security/cors.ts` CorsEngine | CorsEngine, CorsMode, etc. |
| 3 | CspService | Self-contained (internal Map-based) | Imports `parseCspHeader`/`combineCspPolicies` only |
| 4 | SandboxService | Self-contained (internal Map-based) | Imports `SandboxEnforcer` for dispose |
| 5 | HttpsService | Self-contained (HSTS store with expiry + upgrade logic) | No existing module |
| 6 | CertificateService | Wraps `security/certificate-validator.ts` | CertificateValidator |
| 7 | MixedContentService | Self-contained (block-mode state machine) | No existing module (DevTools only before) |
| 8 | XssProtectionService | Self-contained (26 XSS patterns + 4 sanitizers) | No existing module |
| 9 | CsrfProtectionService | Self-contained (token-based with protected methods) | No existing module (OAuth only before) |
| 10 | ClickjackingProtectionService | Self-contained (X-Frame-Options + CSP frame-ancestors eval) | No existing module (parsing only before) |
| 11 | PermissionManagerService | Self-contained (per-origin permission store) | Parallel to existing `security/permission-manager.ts` |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/same-origin-policy.ts` | Same Origin Policy — origin comparison + checkAccess with SOP events |
| `src/browser/media/cors.ts` | CORS — wraps CorsEngine with event emission |
| `src/browser/media/csp.ts` | CSP — policy management, violation reporting, directive evaluation |
| `src/browser/media/sandbox.ts` | Sandbox — flag management per origin + action enforcement |
| `src/browser/media/https.ts` | HTTPS — URL upgrade, HSTS store with expiry, enforcement toggle |
| `src/browser/media/certificates.ts` | Certificates — wraps CertificateValidator + host overrides |
| `src/browser/media/mixed-content.ts` | Mixed Content — block-mode state machine (block-all/block-script/block-display/warn/disabled) |
| `src/browser/media/xss-protection.ts` | XSS Protection — 26 detection patterns, 4 context sanitizers |
| `src/browser/media/csrf-protection.ts` | CSRF Protection — token generation/validation, protected methods |
| `src/browser/media/clickjacking-protection.ts` | Clickjacking — X-Frame-Options + CSP frame-ancestors evaluation |
| `src/browser/media/permission-manager.ts` | Permission Manager — per-origin permission store with grant/revoke/reset |
| `tests/security.test.ts` | 69 tests covering all 11 modules |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Added 11 new exports (classes + interfaces + event types) |

## Test Results

```
 Test Files  1 passed (1)
      Tests  69 passed (69)
```

## Verification Steps

1. `npx vitest run tests/security.test.ts` — 69/69 pass
2. `npx vitest run` — all 378 tests pass across all suites (media + graphics + web-apis + security)
