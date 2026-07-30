# JS Engine Modules — Bytecode, Interpreter, Garbage Collection, JIT Compiler

**Date:** 2026-07-29
**Session:** Add 4 JS engine wrapper modules under `src/browser/media/`
**Status:** Completed

---

## Summary

Created 4 JS engine modules that model browser execution internals as standalone services, each following the `IDisposable` + `onEvent` pattern. These complement the existing deep JS engine infrastructure (`src/browser/js/`) by providing clean, testable wrappers at the application layer.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Added re-exports for all 4 JS engine modules |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/bytecode.ts` | Bytecode compilation/disassembly with 60 opcodes, cache, source parsing |
| `src/browser/media/interpreter.ts` | Token-based execution with step limits, timeouts, pause/resume, context variables |
| `src/browser/media/garbage-collection.ts` | Two-generation GC simulation with allocation tracking, thresholds, stats |
| `src/browser/media/jit-compiler.ts` | JIT profiling with hot detection, tier management (interpreter→bytecode→jit→wasm), compilation |
| `tests/js-engine.test.ts` | 54 tests across all 4 modules |

## Root Causes (Bug Fixes)

### 1. Duplicate export name
**File:** `src/browser/media/index.ts`
**Problem:** Both `garbage-collection.ts` and `jit-compiler.ts` exported `DEFAULT_THRESHOLDS`, causing a Rolldown build error.
**Fix:** Renamed JIT's export to `JIT_DEFAULT_THRESHOLDS` throughout `jit-compiler.ts` and the barrel file.

### 2. Timeout boundary condition
**File:** `src/browser/media/interpreter.ts`
**Problem:** `Date.now() > deadline` fails when `timeout=0` because `Date.now() === deadline` (same millisecond).
**Fix:** Changed `>` to `>=` to catch immediate deadline expiry.

## Test Results

```
Test Files  7 passed (7)
     Tests  548 passed (548)  [494 existing + 54 new]
```

All 54 new tests pass. The pre-existing `done()` deprecation warning in `tests/media.test.ts:302` is unrelated.
