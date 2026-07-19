# Crash Recovery & Site Isolation Integration Tests

**Date:** 2026-07-19
**Session:** Crash recovery and site isolation integration test suite
**Status:** Completed

---

## Summary

Created `tests/crash-recovery-isolation.test.ts` — a 105-test integration suite covering cross-module crash recovery, site isolation, lifecycle management, and error boundary scenarios across the Nova browser engine.

## What Was Tested

The new test file covers module interactions that the existing `crash-recovery.test.ts` (unit tests for individual modules) and `site-isolation.test.ts` (unit tests for security modules) did not exercise.

### Test Sections (16 describe blocks, 105 tests)

| Section | Tests | Modules Covered |
|---------|-------|-----------------|
| TabProcessManager adapter | 9 | `tab-process-adapter.ts`, `process-manager.ts` |
| LifecycleManager state machine | 10 | `lifecycle-manager.ts` |
| LifecycleManager phase registry | 8 | `lifecycle-manager.ts` |
| LifecycleManager crash recovery | 8 | `lifecycle-manager.ts` |
| LifecycleManager observers/events | 8 | `lifecycle-manager.ts` |
| LifecycleManager phase timeout | 2 | `lifecycle-manager.ts` |
| Multi-tab crash isolation | 5 | `tab-context.ts` |
| ErrorBoundary + tab operations | 8 | `error-boundary.ts` |
| ScriptGuard + tab operations | 8 | `script-guard.ts` |
| ProcessGuard + CrashReporter | 10 | `process-guard.ts`, `crash-reporter.ts` |
| ChainedErrorBoundary pipeline | 3 | `error-boundary.ts` |
| TabContext snapshot recovery | 5 | `tab-context.ts` |
| CrashReportBuilder fluent API | 6 | `crash-reporter.ts` |
| TabProcessManager crash flow | 4 | `tab-process-adapter.ts` |
| LifecycleManager → CrashReporter integration | 1 | `lifecycle-manager.ts`, `crash-reporter.ts` |
| Edge cases | 10 | Various modules |

### Key Integration Scenarios Verified

1. **TabProcessManager adapter** — Creates tab contexts with spawned processes, tracks bidirectional mappings, forwards process crashes to tab contexts, emits lifecycle events.
2. **LifecycleManager state machine** — Full state transitions (Idle → Starting → Running → Suspending → Suspended → Resuming), phase registration/execution in order, critical vs non-critical failure handling, phase timeouts.
3. **Crash recovery flow** — LifecycleManager crash → recover → restart cycle, max recovery attempts, crash count reset.
4. **Observer pattern** — Observer notifications at lifecycle boundaries (beforeStart, afterStart, onCrash, onSuspend, onResume).
5. **Multi-tab crash isolation** — Crash in one tab does not affect neighbors; each tab has isolated rendering pipeline (DomTree, LayoutEngine, PaintEngine, EventLoop).
6. **Cross-module error flow** — ProcessGuard feeds CrashReporter, LifecycleManager crash events feed CrashReporter, ErrorBoundary protects tab operations.
7. **ScriptGuard integration** — Instruction limit, timeout, stack depth protection; disabled guard bypass.
8. **ChainedErrorBoundary** — Retry boundary handles transient errors, fallback boundary catches permanent failures, aggregated error history across chain.

## Root Causes

### 1. LifecycleManager.start() throws CrashError on critical failure
**Problem:** The `start()` method wraps phase execution in try/catch; when a critical phase fails, it calls `this.crash(error)` then `throw error` — the CrashError propagates to the caller.
**Fix:** All test cases that trigger critical phase failures wrap `lm.start()` in `try/catch` blocks.

### 2. ScriptGuard.exec() returns Promise, not direct value
**Problem:** `exec()` uses `Promise.race()` internally and returns `Promise<ScriptGuardResult<T>>`, even for synchronous functions.
**Fix:** All ScriptGuard `exec()` tests use `await`.

### 3. ChainedErrorBoundary records errors per-boundary
**Problem:** Each boundary in the chain independently records errors. With 2 boundaries and 2 failed calls, total error count is 4 (not 2).
**Fix:** Updated assertion to expect 4 errors.

### 4. LifecycleManager crash stores CrashError, not original error
**Problem:** `getLastCrash()` returns the `CrashError` wrapper (message: `Critical phase "fail" failed: <original>`), not the original error.
**Fix:** Assertions use `toContain()` to match the original error message within the wrapper.

## Files Created

| File | Purpose |
|------|---------|
| `tests/crash-recovery-isolation.test.ts` | 105 integration tests for crash recovery and site isolation |

## Test Results

```
✓ tests/crash-recovery-isolation.test.ts (105 tests) 351ms

Full suite: 87 test files | 3837 tests
  86 passed | 1 failed (url-parser pre-existing)
  3834 passed | 3 failed (url-parser pre-existing)
```

## Verification Steps

1. Ran `npx vitest run tests/crash-recovery-isolation.test.ts` — all 105 tests pass
2. Ran full `npx vitest run` — no new regressions introduced (3 pre-existing url-parser failures only)
3. Verified test coverage against real source APIs in:
   - `src/browser/engine/tab-context.ts`
   - `src/browser/engine/tab-process-adapter.ts`
   - `src/browser/engine/lifecycle-manager.ts`
   - `src/browser/engine/error-boundary.ts`
   - `src/browser/engine/script-guard.ts`
   - `src/browser/engine/process-guard.ts`
   - `src/browser/engine/crash-reporter.ts`
   - `src/common/ipc/process-manager.ts`
