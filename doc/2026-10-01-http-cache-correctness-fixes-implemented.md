# HTTP Cache Correctness Fixes (Phase 6e) — Three Real Bugs in the Live Cache

**Date:** 2026-10-01
**Session:** Next Phase 6 "smaller polish" slice after Bookmark Import/Export. Investigation compared this against reopen/duplicate tab (both already fully shipped — stale audit item) and an Extensions settings page (weakest candidate — no real extension-loading mechanism exists at all, and the `'list'` setting-type mechanism Profiles added is hardcoded to that one manager's shape, not actually generic). Cache correctness won as the clear, well-bounded next phase: two files, additive, real confirmed bugs.
**Status:** Completed (3 root causes fixed)

---

## Summary

The live, wired HTTP cache (`CacheManager`, used by `ResourceLoader`) had three real, confirmed correctness bugs, independent of the separate (bigger, previously-rejected) idea of adding disk persistence on top of it: `Cache-Control: no-store` was never honored (every 2xx/3xx response got cached regardless), no ETag/Last-Modified revalidation existed at all (entries already stored `etag`/`lastModified` but nothing ever sent a conditional request or handled a `304`), and binary response bodies (images/fonts/audio/video) were silently dropped on every cache hit — `CacheEntry` had no `bodyBinary` field, so a cached image's bytes were lost and `lazy-loader.ts` fell back to a placeholder forever.

Fixed all three additively in `cache-manager.ts` (new `bodyBinary` field, new raw `getStale()` lookup for revalidation) and `resource-loader.ts` (conditional-header injection, 304 handling, a `no-store`/`no-cache`-aware populate-cache guard). A Plan-agent validation pass caught four real issues in the first draft before implementation: `getStale()` needed to be snapshotted *before* calling `get()` (which deletes an expired entry as a side effect, so capturing it later would already find the revalidation candidate gone); the 304 branch needed to sit after the CORS/CORP checks (not before) and must not explicitly release the concurrency slot (the surrounding `finally` already does, and an explicit call would double-release — a pattern that already exists as a pre-existing, out-of-scope latent bug on a few unrelated early-return branches in the same function); `max-age=0` — the standard real-world ETag-revalidation pattern — was being treated as "no TTL given" by a truthy check instead of a `!== null` check; and an existing cache-hit test needed updating once `bodyBinary` became a required field.

## Root Causes

1. **`Cache-Control: no-store` was never checked before caching.** `ResponseParser.parse()` already computed `parsed.cache.noStore`/`.noCache` but `resource-loader.ts`'s populate-cache block never consulted it. Fixed by guarding the `cache.set()` call on `!parsed.cache.noStore`, and forcing `no-cache` responses to an immediately-stale `expiresAt` (reusing the existing staleness mechanism — no new field — so the very next request is forced through the new conditional-revalidation path rather than being served as if fresh).
2. **No ETag/Last-Modified revalidation existed anywhere on the live path.** `CacheEntry` already retained `etag`/`lastModified`, but no code ever sent `If-None-Match`/`If-Modified-Since` or handled a `304`. Fixed by adding `CacheManager.getStale()` (a raw lookup bypassing the expiry/eviction logic in `get()`, used only to recover a possibly-expired entry's validators), injecting conditional headers when a stale entry exists, and special-casing a `304` response to refresh the entry's freshness while reusing its stored body.
3. **Binary bodies were dropped on every cache hit.** `CacheEntry` had no `bodyBinary` field — cached image/font/audio/video responses stored an empty string and the cache-hit path hardcoded `bodyBinary: null`, so `lazy-loader.ts`'s `if (!result.bodyBinary) return;` guard silently kept the placeholder forever for any image served from cache. Fixed by adding `bodyBinary: Uint8Array | null` to `CacheEntry` and threading it through both the populate and cache-hit paths.

## Notes

- `parsed.cache`'s already-correct fields (`etag`, `lastModified`, `immutable`, `maxAge`) now back the populate-cache block directly, replacing the old manual `cache-control` regex/substring parsing — fewer lines, confirmed no behavior change against the pre-existing TTL/immutable tests.
- A pre-existing, unrelated latent bug was found and deliberately left alone: several early-return branches in `loadResourceCore` (e.g. CORS/CORP violation paths) call `this.releaseSlot()` explicitly despite sitting inside a `try` whose `finally` already releases it once on every exit path — a double-release on those specific branches. Out of scope for this phase; noted so the new 304 branch doesn't copy the same mistake (it deliberately does not call `releaseSlot()` itself).
- `CachePolicy.enableEtagRevalidation` (already defined, already dead — nothing reads it) was left untouched rather than wiring it as a toggle for this new logic — adding a config gate for a value nothing currently varies would be unrequested scope.
- `cache-control.ts`'s `DiskCacheStorage` (a Map-backed fake with zero real callers, confirmed during the earlier Bookmark Import/Export investigation) stays untouched — fully orthogonal to these fixes.
- Three pre-existing test files (`cache-manager.test.ts`, `test-suite-comprehensive.test.ts`, plus one literal in `resource-loader.test.ts`) needed a mechanical `bodyBinary: null,` added to their `CacheEntry`-literal constructions once the field became required — no behavior changes, pure type-safety follow-through.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/cache-manager.ts` | Added `bodyBinary: Uint8Array \| null` to `CacheEntry`; new `getStale()` raw lookup on `ICacheManager`/`CacheManager`; `set()` threads `bodyBinary` and sizes by binary length when present |
| `src/browser/networking/resource-loader.ts` | Cache-hit path returns real `bodyBinary`; conditional `if-none-match`/`if-modified-since` headers sent when a stale entry exists; new 304 branch reuses the cached body and refreshes freshness; populate-cache guard skips `no-store` and force-stales `no-cache`, using `parsed.cache`'s already-correct fields instead of manual header parsing |
| `tests/resource-loader.test.ts` | +4 tests (below); 1 existing literal updated for the new required `bodyBinary` field |
| `tests/cache-manager.test.ts` | Mechanical `bodyBinary: null` addition to existing `CacheEntry` literals — no behavior change |
| `tests/test-suite-comprehensive.test.ts` | Same mechanical addition — no behavior change |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-01-http-cache-correctness-fixes-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 239/239 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9389/9389 tests (4 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition (`dns.lookup('localhost')` resolving to IPv6 rather than the IPv4 the tests expect) noted in the last several changelogs.

## Verification Steps

1. Real-pipeline tests (no mocks of `ResourceLoader`/`CacheManager` themselves): a `no-store` response is confirmed never cached; a `no-cache` response is cached but the second request sends `If-None-Match` and reuses the first response's body on a `304`; a `max-age=0` ETag'd response revalidates the same way and does not use the 304 response's own (deliberately wrong, in the test) body, proving the cached body — not the 304 — is what's served; a binary (image) response's `bodyBinary` survives unchanged through a second, cache-hit load.
2. Confirmed the two pre-existing TTL/immutable cache-integration tests still pass unmodified, since the new populate-cache logic reuses `parsed.cache`'s already-correct values rather than changing their computation.
3. No live dev-preview verification is meaningful here — this is a caching-layer correctness fix with no visible UI surface; the real-pipeline tests above are the actual proof, matching this session's established pattern for non-UI networking fixes.
4. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
