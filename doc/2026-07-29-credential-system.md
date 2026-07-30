# Credential System — Credential Store, Encryption, Autofill, Passkeys

**Date:** 2026-07-29
**Session:** Implement 4-module credential system for Nova Browser
**Status:** Completed

---

## Summary
Implemented a complete credential system with 4 modules: CredentialStore (generic credential vault), EncryptionService (AES-GCM + XOR fallback), AutofillService (form field detection and filling), and PasskeyManager (WebAuthn-style passkey registration and authentication). All modules follow the existing `IDisposable` + event emission patterns.

## Architecture Decisions
- **Separate directory** `src/browser/credentials/` — follows the pattern of `devtools/` and `extensions/` with its own `index.ts` barrel file
- **CredentialStore** uses `Map<string, CredentialEntry>` with UUID-style IDs (`cred-<hex>`), matching the `InMemoryBookmarkStore` pattern
- **EncryptionService** provides two-tier encryption: SubtleCrypto AES-GCM when available (Web Crypto API), XOR fallback when not — following the existing `InMemoryPasswordStore` fallback design
- **AutofillService** is a façade over CredentialStore, with URL matching by hostname and form field heuristics (username/password inference via `name`, `id`, `autocomplete`, `type` attributes) — confidence scoring for multi-credential ranking
- **PasskeyManager** simulates WebAuthn Level 2: `createCredential` (ECDSA P-256 key generation), `getCredentials` (with `allowCredentials` filtering), host permission mapping via `rpId`

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/credentials/credential-store.ts` | CredentialStore — save/get/getByUrl/getAll/update/delete/recordUse/clear with event emission (created/updated/deleted/used) |
| `src/browser/credentials/encryption.ts` | EncryptionService — AES-GCM via SubtleCrypto with XOR fallback, key generation (aes-gcm/pbkdf2), deriveKey with PBKDF2, export/import key |
| `src/browser/credentials/autofill.ts` | AutofillService — getCredentialsForUrl/getSuggestions/fillFields/autoFill/saveFromForm with URL matching, field heuristics, confidence scoring |
| `src/browser/credentials/passkeys.ts` | PasskeyManager — createCredential (ECDSA P-256 key pair), getCredentials/getCredentialsForRp/getCredentialById/deleteCredential |
| `src/browser/credentials/index.ts` | Barrel file — re-exports all public types and functions |
| `tests/credentials.test.ts` | 54 tests across all 4 modules |

## Test Results
```
✓ tests/credentials.test.ts (54 tests)
  CredentialStore: 16/16
  EncryptionService: 11/11
  AutofillService: 15/15
  PasskeyManager: 12/12

All 54 tests pass.
Existing test suites (414 tests across 4 other files) show no regressions.
```
