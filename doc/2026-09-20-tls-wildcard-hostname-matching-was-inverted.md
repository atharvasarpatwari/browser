# TLS Wildcard Certificate Matching Was Completely Inverted

**Date:** 2026-09-20
**Session:** Asked to "improvise" with no target named — continued the session's established pattern of bisecting real, popular sites for concrete engine gaps (following the earlier YouTube/Unicode-escape-identifier fix). Tried `github.com` next.
**Status:** Completed

---

## Summary

Navigating to `github.com` in real Electron (via the production `RawSocketHttpClient`/`TlsHandler` path, not the CORS-limited dev-mode fetch fallback) failed to load **every single external script** from `github.githubassets.com` — GitHub's own asset CDN — each rejected with `Certificate verification failed for "github.githubassets.com": [hostname-mismatch]`. Since `rejectUnauthorized: false` is set on the real socket (Nova does its own cert verification instead of deferring to Node's), this pointed straight at `TlsHandler`'s own hostname-matching logic rather than a real certificate problem.

Found the exact bug in `TlsHandler.hostnameMatches()`'s wildcard branch. `github.githubassets.com` is covered by a `*.githubassets.com`-style SAN (typical for CDN-hosted domains), and the one-label-only check meant to reject a wildcard covering multiple subdomain levels had its condition **inverted** — it accepted the case it should reject and rejected the case it should accept. This isn't specific to GitHub: any site whose certificate uses a wildcard SAN (the overwhelming majority of real-world HTTPS sites behind a CDN or cloud host) would have every subdomain matching that wildcard silently fail hostname verification, with no existing test ever having caught it since `tests/tls-handler.test.ts` only covered exact-match hostnames.

## Root Cause

**File:** `src/browser/networking/tls-handler.ts`, `hostnameMatches()`
**Problem:**
```ts
const suffix = pattern.slice(1); // ".example.com"
return hostname.endsWith(suffix) && hostname.slice(0, -suffix.length).indexOf('.') !== -1;
```
For `*.githubassets.com` matching `github.githubassets.com`, the remaining prefix after stripping the suffix is `"github"` — zero dots, i.e. exactly the valid one-label case a wildcard is supposed to cover (RFc 6125 §6.4.3). But the condition required `indexOf('.') !== -1` (a dot **must** be present) to return `true` — the exact opposite of correct: it demanded a *multi-level* prefix to accept the match, and rejected the single-level case it was written to accept. The function's own docstring example (`*.example.com matches sub.example.com`) doesn't even hold against its own code.
**Fix:** Flipped the comparison to `=== -1` — the match now succeeds when there is *no* additional dot in the prefix (a genuine single label), and correctly still rejects both `a.b.example.com` (multi-level) and the bare apex `example.com` (which fails the `endsWith` check on its own, since it's shorter than the required suffix).

## Notes

- Confirmed via direct before/after diagnostic against real `github.com` in a live Electron instance: all 8 `hostname-mismatch` console errors disappeared after the fix, and the previously-blocked scripts now actually execute (surfacing separate, unrelated JS-parser/runtime gaps in GitHub's own bundle — real, but out of scope for this fix, matching this session's one-root-cause-at-a-time pattern).
- This bug predates this session; it wasn't introduced by anything done today. It was simply never exercised by a test with a real wildcard SAN, and every previous real-site test this session happened to hit exact-match or CORS-blocked certs instead.
- Did not touch `buildCertificateChainReal()`'s SAN parsing or the socket-owner's SNI handling — both were read and confirmed already correct (SNI is passed via `servername`, and the DNS-prefixed SAN entries are parsed correctly); the bug was isolated entirely to the wildcard-match arithmetic itself.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/tls-handler.ts` | `hostnameMatches()`'s wildcard branch: `indexOf('.') !== -1` → `indexOf('.') === -1`, so a genuine single-label wildcard match is accepted instead of rejected (and vice versa for multi-level) |
| `tests/tls-handler.test.ts` | Two new `verifyChain` tests: a real single-level wildcard SAN (`*.githubassets.com` / `github.githubassets.com`) now returns `Valid`; a wildcard is still correctly rejected against both a multi-level subdomain and the bare apex domain |

## Test Results

```
npx tsc --noEmit -p .                      → 0 errors
npx vitest run tests/tls-handler.test.ts   → 36/36 passed (34 existing + 2 new)
Real Electron diagnostic (github.com)      → all 8 hostname-mismatch errors gone; scripts now execute
```

## Verification Steps

1. Ran a temporary real-Electron diagnostic (Playwright `_electron.launch`, matching the established `youtube-smoke.spec.ts` pattern) navigating to `https://github.com` and capturing console errors — found 8 identical `hostname-mismatch` failures, all against `github.githubassets.com`.
2. Traced the rejection to `TlsHandler.verifyChain()` → `verifyHostname()` → `hostnameMatches()`'s wildcard branch, reasoning through the exact string-slicing arithmetic by hand before touching any code.
3. Added two new tests reproducing the exact bug shape (a real single-level wildcard match, plus the two cases a wildcard must still reject) — **confirmed they failed against the unmodified code** (single-level wildcard wrongly returned `hostname-mismatch`; the multi-level/apex cases wrongly returned `valid`) before making any fix, proving the bug was real rather than assumed.
4. Applied the one-character fix (`!==` → `===`), reran the same tests — all pass, including the pre-existing 34.
5. `npx tsc --noEmit -p .` clean.
6. Rebuilt (`npm run build:web`) and re-ran the exact same real-Electron `github.com` diagnostic — confirmed all 8 `hostname-mismatch` errors are gone and the previously-blocked scripts now execute.
7. Ran the full `vitest` suite for regressions.
