# Tier 1 Quick Wins — Type Errors, Path Alias, CI Lint

**Date:** 2026-08-20
**Session:** Tier 1 code quality improvements
**Status:** Completed

---

## Summary

Five quick-win improvements: fixed 7 TypeScript type errors, added `@/` path alias to eliminate 29 fragile deep relative imports, fixed a filename typo, and added a lint step to CI.

## Root Causes

### 1. TypeScript type errors in lifecycle observer hooks

**File:** `tests/test-suite-comprehensive.test.ts` (lines 951–956)
**Problem:** Arrow expression bodies `async () => hooks.push('bs')` return `Promise<number>` (because `Array.push()` returns the new length), but `ILifecycleObserver` (lifecycle-manager.ts:129) requires `Promise<void>` callback return types.
**Fix:** Converted expression bodies to block bodies:
```ts
// Before:
onBeforeStart: async () => hooks.push('bs'),
// After:
onBeforeStart: async () => { hooks.push('bs'); },
```

### 2. Fragile deep relative imports in test files

**Files:** 11 test files across `tests/compositing/`, `tests/browser/rendering/`, `tests/config/`, `tests/ipc/`, `tests/native/`
**Problem:** 29 imports used `../../src/` or `../../../src/` paths that break on directory restructuring.
**Fix:** Added `@/` → `src/` path alias in `tsconfig.json` (`baseUrl` + `paths`) and `vitest.config.ts` (`resolve.alias`), then updated all 29 imports to use `@/` prefix.

### 3. Filename typo

**File:** `scripts/bulid.sh`
**Problem:** Misspelled as "bulid" instead of "build".
**Fix:** `git mv scripts/bulid.sh scripts/build.sh`

### 4. Missing lint step in CI

**File:** `.github/workflows/ci.yml`
**Problem:** CI ran typecheck and tests but not linting, so 282 pre-existing lint errors went unnoticed in CI.
**Fix:** Added `npm run lint -- --max-warnings 1000` with `continue-on-error: true` (non-blocking until pre-existing errors are cleaned up).

## Files Modified

| File | Change |
|------|--------|
| `tests/test-suite-comprehensive.test.ts` | Fix 6 arrow expression bodies (lines 951–956) |
| `tsconfig.json` | Add `baseUrl` + `paths` for `@/*` alias |
| `vitest.config.ts` | Add `@` → `src/` resolve alias |
| `tests/browser/rendering/gpu-rasterizer.test.ts` | Update 2 imports to `@/` |
| `tests/config/process-model.test.ts` | Update 2 imports to `@/` |
| `tests/compositing/tile-grid.test.ts` | Update 1 import to `@/` |
| `tests/compositing/layer-tree.test.ts` | Update 4 imports to `@/` |
| `tests/compositing/layer-promoter.test.ts` | Update 3 imports to `@/` |
| `tests/compositing/layer-damage-tracker.test.ts` | Update 2 imports to `@/` |
| `tests/compositing/layer-compositor.test.ts` | Update 6 imports to `@/` |
| `tests/compositing/compositing-layer.test.ts` | Update 4 imports to `@/` |
| `tests/compositing/compositing-enhancements.test.ts` | Update 5 imports to `@/` |
| `tests/ipc/child-process-transport.test.ts` | Update 1 import to `@/` |
| `tests/native/native-bindings.test.ts` | Update 4 imports to `@/` |
| `scripts/bulid.sh` → `scripts/build.sh` | Renamed (git mv) |
| `.github/workflows/ci.yml` | Add lint step (non-blocking) |

## Files Created

None.

## Test Results

```
npx tsc --noEmit                     → 0 errors (was 7)
npx vitest run                       → 195/195 files, 8947/8947 tests pass
npx eslint tests/ (modified files)   → 0 new errors introduced
```

## Verification Steps

1. `npx tsc --noEmit` — confirmed 0 errors (was 7 before fix)
2. `npx vitest run tests/test-suite-comprehensive.test.ts tests/compositing/ ...` — 12/12 files, 425/425 tests pass (all modified files)
3. `npx vitest run` — full suite 195/195, 8947/8947 pass
4. `npx eslint` on modified files — 0 new errors (all issues pre-existing)
