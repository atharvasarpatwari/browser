# Tier 3 Testing & CI — Multi-Platform CI, Build Verification, Stale Test Cleanup

**Date:** 2026-08-20
**Session:** Tier 3 testing and CI improvements
**Status:** Completed

---

## Summary

Three CI/testing improvements: expanded CI to run on Windows + Linux + macOS, added Vite build verification to CI, and cleaned up stale test results file.

## Root Causes

### 1. Stale vitest-web-apis.json

**File:** `vitest-web-apis.json`
**Problem:** Contained results from a previous test run showing 24/68 tests failing in `web-apis-extended.test.ts`. These failures were caused by import paths that no longer resolved after the web-apis.ts module split in Tier 2. The re-exports added in Tier 2 fixed all 24 failures (now 68/68 pass), but the JSON file was never updated.
**Fix:** `git rm vitest-web-apis.json` — stale artifact removed.

### 2. CI only ran on Windows

**File:** `.github/workflows/ci.yml`
**Problem:** The `check` job ran only on `windows-latest`. The test suite has platform-specific behavior (Node.js crypto fallbacks, path separators, etc.) that could break on Linux/macOS without detection.
**Fix:** Added matrix strategy with `fail-fast: false` across `windows-latest`, `ubuntu-latest`, `macos-latest`. Each platform runs typecheck + lint + full vitest independently.

### 3. Vite build not verified in CI

**File:** `.github/workflows/ci.yml`
**Problem:** The CI ran typecheck and tests but never ran `npm run build:web`, so Vite build regressions (chunk splitting, missing exports, bundle size issues) went undetected.
**Fix:** Added dedicated `build` job that runs `npm run build:web` and verifies `dist/index.html` exists.

## Files Modified

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Added matrix strategy (3 OS), added `build` job for Vite verification |
| `vitest-web-apis.json` | Deleted (stale test results) |

## Test Results

```
npx tsc --noEmit                     → 0 errors
npx vitest run                       → 195/195 files, 8947/8947 tests pass
npx vite build                       → built in 7.11s, dist/index.html verified
```

## CI Pipeline (after changes)

```
CI Gate
├── check (matrix: windows/ubuntu/macos)
│   ├── Typecheck
│   ├── Lint (non-blocking)
│   └── Unit tests
├── build (ubuntu)
│   ├── Build web bundle
│   └── Verify output
└── e2e (windows)
    ├── Build web bundle
    └── Electron e2e tests
```
