# Site Isolation — Tests & Bug Fixes

**Date:** 2026-07-19
**Session:** Site isolation test coverage + PrivilegeLevels bug fix
**Status:** Completed

---

## Summary

Wrote comprehensive tests for all 5 site isolation modules (142 tests total, exceeding the 110 target) and fixed a bug in `PrivilegeLevels` where custom policy overrides using `Map` objects were silently ignored due to `Object.entries()` not working on `Map` instances.

## Root Causes

### 1. PrivilegeLevels custom policy Map iteration bug
**File:** `src/browser/security/privilege-levels.ts`
**Problem:** The constructor used `Object.entries(custom)` to iterate custom policy overrides. When a `Map` was passed (which matches the `Partial<PrivilegePolicy>` type since `PrivilegePolicy = ReadonlyMap<ApiSurface, boolean>`), `Object.entries()` returned an empty array because `Map` instances have no enumerable own properties. Custom overrides were silently ignored.
**Fix:** Added `instanceof Map` check to use `Map.entries()` for Map instances, falling back to `Object.entries()` for plain objects:
```typescript
if (custom instanceof Map) {
  for (const [api, allowed] of custom) {
    base.set(api, allowed);
  }
} else {
  for (const [api, allowed] of Object.entries(custom)) {
    base.set(api as ApiSurface, allowed as boolean);
  }
}
```

## Files Modified

| File | Change |
|------|--------|
| `src/browser/security/privilege-levels.ts` | Fixed `Object.entries()` → Map-aware iteration in constructor |
| `tests/site-isolation.test.ts` | Created — 142 tests across all 5 site isolation modules |
| `doc/README.md` | Added site isolation session entry |

## Files Created

| File | Purpose |
|------|---------|
| `tests/site-isolation.test.ts` | Comprehensive tests for OriginIsolator, CrossOriginGuard, PermissionManager, ResourceQuotaManager, PrivilegeLevels |

## Test Results

```
Site isolation tests: 142 passed, 0 failed
Full suite: 82 files, 3437 passed, 2 pre-existing failures (memory-management.test.ts)
```

### Test Breakdown by Module

| Module | Tests | Coverage |
|--------|-------|----------|
| OriginIsolator | 25 | registerTab, unregisterTab, checkNavigation, checkIsolation, getContextForOrigin, getOriginForTab, getActiveOrigins, LRU eviction, event system, dispose |
| CrossOriginGuard | 31 | same-origin access, DOM/storage/network/cookie/postMessage checks, strict vs non-strict mode, CORS preflight, trusted origins, isSameOrigin, getCorsHeaders, violation tracking, events, dispose |
| PermissionManager | 22 | query, queryAll, grant, deny, revoke, revokeAll, request, undeniable permissions, TTL expiry, LRU eviction, getOrigins, reset, events, dispose |
| ResourceQuotaManager | 25 | trackTab, untrackTab, memory/CPU/network quota checks, peak tracking, checkQuota, getSummary, LRU eviction, events, dispose |
| PrivilegeLevels | 39 | check API surfaces per tier, checkPrivilege ordering, checkWithSandbox overrides (scripts, modals, popups, navigation, pointer lock), custom policies, getPolicy, getOrder, isSameLevel |

## Verification Steps

1. Ran `npx vitest run tests/site-isolation.test.ts` — 142/142 passed
2. Ran `npx vitest run` (full suite) — 3437/3439 passed (2 pre-existing failures unchanged)
3. Verified PrivilegeLevels fix: custom Map policy overrides now apply correctly
4. No regressions introduced
