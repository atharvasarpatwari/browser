# Tier 2 Code Quality — Dead Code, Module Split, Type Safety

**Date:** 2026-08-20
**Session:** Tier 2 code quality improvements
**Status:** Completed

---

## Summary

Three code quality improvements: removed confirmed dead code, split the 3,549-line `web-apis.ts` monolith into 4 focused modules, and replaced 36 `as any` casts in `dom-bindings.ts` with typed interfaces.

## Root Causes

### 1. Dead code: file-verifier.ts

**File:** `src/browser/downloads/file-verifier.ts` (141 lines)
**Problem:** No imports from any production or test file — completely unreferenced.
**Fix:** `git rm src/browser/downloads/file-verifier.ts`
**Note:** `auto-updater.ts` and `task-manager.ts` were also checked — both have test files and are kept.

### 2. web-apis.ts monolith split

**File:** `src/browser/js/web-apis.ts` (3,549 lines → 2,808 lines)
**Problem:** Single file contained 29 Web API sections with 117 `as any` casts, making it the largest file in the codebase and difficult to navigate.
**Fix:** Extracted 3 largest standalone sections + shared helpers into separate modules:

| New File | Lines | Contents |
|----------|-------|----------|
| `web-apis-helpers.ts` | 68 | `createPromiseLike`, `toJSValueShallow` (shared utilities) |
| `web-apis-wasm.ts` | 380 | WebAssembly API (9 exported functions) |
| `web-apis-gpu.ts` | 254 | WebGPU API (`createGPUObject` + constants) |
| `web-apis-xr.ts` | 175 | WebXR API (`createXRSystemObject` + helpers) |

The main `web-apis.ts` imports from the new modules and re-exports them for backward compatibility with existing tests.

**Reduction:** 3,549 → 2,808 lines (-741 lines, -21%)

### 3. dom-bindings.ts `as any` cleanup

**File:** `src/browser/js/dom-bindings.ts`
**Problem:** 62 `as any` casts — the second-highest count in the codebase. Most were for event flags (`__stopPropagation`, `__stopImmediate`, `__defaultPrevented`) and canvas extensions (`__canvasElement`, `__wrappedCtx`, `__raw`).
**Fix:** Added typed interfaces and replaced 36 casts:
- `DomEventFlags` interface + `eventFlags()` helper: 19 event flag casts
- `CanvasExtensions` interface: 17 canvas internal property casts
- Remaining `as any` casts are for standard type conversions (string union casts for Canvas context properties) that are inherent to bridging JSValue→string union types

## Files Modified

| File | Change |
|------|--------|
| `src/browser/downloads/file-verifier.ts` | Deleted (dead code) |
| `src/browser/js/web-apis.ts` | Removed WASM/GPU/XR sections, added imports + re-exports from new modules |
| `src/browser/js/dom-bindings.ts` | Added `DomEventFlags`/`CanvasExtensions` interfaces, replaced 36 `as any` casts |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/js/web-apis-helpers.ts` | Shared `createPromiseLike` and `toJSValueShallow` |
| `src/browser/js/web-apis-wasm.ts` | WebAssembly API module |
| `src/browser/js/web-apis-gpu.ts` | WebGPU API module |
| `src/browser/js/web-apis-xr.ts` | WebXR API module |

## Test Results

```
npx tsc --noEmit                     → 0 errors
npx vitest run                       → 195/195 files, 8947/8947 tests pass
```

## Verification Steps

1. `npx tsc --noEmit` — confirmed 0 errors after all changes
2. `npx vitest run` — full suite green, 195/195 files, 8,947/8,947 tests
3. `as any` count in `dom-bindings.ts`: 62 → 26 (36 removed, -58%)
4. `web-apis.ts` line count: 3,549 → 2,808 (-21%)
