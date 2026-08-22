# Tier 5 — Architecture: Circular Dependency Breakdown

**Date:** 2026-08-20
**Session:** Tier 5 of codebase improvement plan
**Status:** Completed

---

## Summary

Broke all 3 circular dependency cycles in `src/browser/` by extracting shared types and utilities into dependency-free locations. The codebase now has a clean directed acyclic graph (DAG) structure within `src/browser/`, enabling future package extraction and improving build-time analysis.

## Root Causes

### 1. networking <-> engine cycle
**File:** `src/browser/networking/request-manager.ts`
**Problem:** `request-manager.ts` imported `IPageLoader` and `PageLoadResult` from `engine/browser-engine.ts`, while `engine/` depends on `networking/` for resource loading. This created a bidirectional dependency.
**Fix:** Extracted `IPageLoader` and `PageLoadResult` interfaces into a new `src/browser/engine/engine-types.ts` file. `request-manager.ts` now imports from `engine-types.ts` (no outbound dependency). `browser-engine.ts` re-exports the types for backward compatibility.

### 2. storage <-> bookmarks cycle
**File:** `src/browser/storage/bookmark-store.ts`, `persistent-stores.ts`
**Problem:** `bookmark-store.ts` and `persistent-stores.ts` imported `generateSecureId` from `bookmarks/bookmark-validator.ts`, while `bookmarks/` depends on `storage/` for persistence.
**Fix:** Extracted `generateSecureId` into a new `src/common/crypto-utils.ts` utility module. Both `storage/` and `bookmarks/` now import from this shared location. The `crypto-utils.ts` module also includes a `randomHex` helper and uses a counter suffix to guarantee uniqueness even with `Math.random` fallback.

### 3. rendering/compositing <-> rendering/formatting cycle
**File:** `src/browser/rendering/formatting/stacking.ts`
**Problem:** `formatting/stacking.ts` imported `parseTransform` and `isPureTranslation4x4` from `compositing/transform-parser.ts`, while `compositing/` imports `StackingContext` from `formatting/stacking.ts`.
**Fix:** Moved `transform-parser.ts` from `compositing/` to the parent `rendering/` directory. Both `compositing/` and `formatting/` now import from `../transform-parser` (a shared utility with zero internal dependencies).

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/engine/engine-types.ts` | Shared `IPageLoader` and `PageLoadResult` interfaces (breaks networking <-> engine cycle) |
| `src/common/crypto-utils.ts` | `generateSecureId` and `randomHex` utilities (breaks storage <-> bookmarks cycle) |
| `src/browser/rendering/transform-parser.ts` | Matrix types and transform utilities (breaks compositing <-> formatting cycle) |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/engine/browser-engine.ts` | Imports `IPageLoader`/`PageLoadResult` from `engine-types.ts`, re-exports for backward compat, removes duplicate interface definitions |
| `src/browser/networking/request-manager.ts` | Imports from `engine-types.ts` instead of `browser-engine.ts` |
| `src/browser/storage/bookmark-store.ts` | Imports `generateSecureId` from `common/crypto-utils.ts`, passes `'bm'` prefix |
| `src/browser/storage/persistent-stores.ts` | Imports `generateSecureId` from `common/crypto-utils.ts`, passes `'bm'` prefix |
| `src/browser/rendering/compositing/compositing-layer.ts` | Imports from `../transform-parser` instead of `./transform-parser` |
| `src/browser/rendering/compositing/scroll-compositor.ts` | Imports from `../transform-parser` instead of `./transform-parser` |
| `src/browser/rendering/compositing/animation-engine.ts` | Imports from `../transform-parser` instead of `./transform-parser` |
| `src/browser/rendering/compositing/compositor-thread.ts` | Imports from `../transform-parser` instead of `./transform-parser` |
| `src/browser/rendering/compositing/index.ts` | Re-exports from `../transform-parser` instead of `./transform-parser` |
| `src/browser/rendering/formatting/stacking.ts` | Imports from `../transform-parser` instead of `../compositing/transform-parser` |
| `tests/animation-track-b.test.ts` | Updated import path for transform-parser |
| `tests/compositing/compositing-enhancements.test.ts` | Updated import path for transform-parser |

## Files Deleted

| File | Reason |
|------|--------|
| `src/browser/rendering/compositing/transform-parser.ts` | Moved to `rendering/transform-parser.ts` |

## Architecture Impact

### Before (circular)
```
networking ←→ engine     (IPageLoader/PageLoadResult)
storage    ←→ bookmarks  (generateSecureId)
compositing ←→ formatting (transform-parser)
```

### After (DAG)
```
networking → engine-types  (no cycle)
storage    → common/crypto-utils  (no cycle)
compositing → rendering/transform-parser  (no cycle)
formatting  → rendering/transform-parser  (no cycle)
```

### Remaining dependency graph
The 24 subdirectories of `src/browser/` now form a clean DAG with 11 leaf packages (zero deps) that could be extracted as separate npm packages in the future:
- `accessibility`, `auth`, `credentials`, `extensions`, `downloads`, `image`, `navigation-controls`, `omnibox`, `pdf-viewer`, `settings`, `web-apis`

## Test Results

```
npx tsc --noEmit           → 0 errors
npx vitest run             → 195/195 files, 8947/8947 tests passed
npx vite build             → successful (1.79s)
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors (all type-only imports resolved correctly)
2. `npx vitest run` — 195/195 files, 8,947/8,947 tests pass
3. `npx vite build` — successful, dist/index.html generated
4. Verified no remaining imports from old paths (`grep` for all 3 old import patterns returns 0 matches)
