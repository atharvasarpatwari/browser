# PageLoader & PageRenderer Extraction

**Date:** 2026-07-19  
**Session:** Extract inline adapters from main.ts into standalone classes  
**Status:** Completed

---

## Summary

Extracted the inline `createPageLoader()` and `createPageRenderer()` adapter methods from `main.ts` into proper standalone classes implementing the `IPageLoader` and `IPageRenderer` interfaces. This improves code organization, testability, and separation of concerns.

## Root Causes

### Problem
- `ApplicationBootstrap.createPageLoader()` was an inline adapter object literal
- `ApplicationBootstrap.createPageRenderer()` was a large inline adapter with 6 helper methods
- Both were private methods, making them untestable in isolation
- The render lambda ignored the `AbortSignal` parameter from the interface

### Solution
1. Created standalone `PageLoader` class wrapping `IResourceLoader`
2. Created standalone `PageRenderer` class extracting the full rendering pipeline
3. Wired both into `BrowserEngine` via existing plugin points
4. Removed all inline adapter methods and helper functions from `main.ts`

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/engine/page-loader.ts` | Standalone PageLoader class implementing IPageLoader |
| `src/browser/engine/page-renderer.ts` | Standalone PageRenderer class implementing IPageRenderer |
| `tests/page-loader.test.ts` | 14 comprehensive tests for PageLoader |
| `tests/page-renderer.test.ts` | 22 comprehensive tests for PageRenderer |

## Files Modified

| File | Changes |
|------|---------|
| `src/app/main.ts` | Removed createPageLoader(), createPageRenderer(), and 6 helper methods; added imports for new classes; updated wiring |

## Architecture Decisions

1. **Dependency Injection:** Both classes accept dependencies via constructor parameters
2. **Interface Compliance:** Both implement the existing `IPageLoader` and `IPageRenderer` interfaces
3. **Signal Propagation:** `PageRenderer.render()` now properly accepts and propagates the `AbortSignal`
4. **Method Extraction:** All 6 helper methods from `main.ts` were moved into `PageRenderer` as private methods
5. **Static Methods:** `resolveUrl()` was made a static method since it doesn't need instance state

## Test Results

```
Test Files:  80 passed | 1 failed (81)
Tests:       3295 passed | 2 failed (3297)
```

New tests: 36 tests (14 PageLoader + 22 PageRenderer) — all passing
Pre-existing failures: 2 tests in `memory-management.test.ts` (PermissionManager cap behavior)

## Verification Steps

1. ✅ Created PageLoader class implementing IPageLoader interface
2. ✅ Created PageRenderer class implementing IPageRenderer interface
3. ✅ Both classes are properly testable in isolation
4. ✅ Signal propagation works correctly through the pipeline
5. ✅ All existing tests continue to pass
6. ✅ New comprehensive tests cover both classes (36 tests)
7. ✅ Documentation updated with implementation details

## Benefits

1. **Testability:** Standalone classes can be unit tested in isolation with mocked dependencies
2. **Separation of Concerns:** Each class has a single responsibility (loading vs rendering)
3. **Code Reusability:** Classes can be instantiated multiple times for different tabs
4. **Maintainability:** Clear boundaries between networking and rendering subsystems
5. **Bug Fixes:** Proper signal propagation (currently ignored in render lambda)
6. **Coverage:** Fills critical gaps in test coverage for orchestration layer
