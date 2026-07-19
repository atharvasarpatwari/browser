# Crash Recovery & Isolation System

**Date:** 2026-07-18
**Session:** Crash recovery/isolation — per-tab isolation, script guard, error boundary, process guard, crash reporter, lifecycle enhancements
**Status:** Completed

---

## Summary

Implemented a complete crash recovery and isolation system for the Nova Browser. Each tab gets its own isolated rendering pipeline and JS context so a crash in one tab does not affect others. ScriptGuard enforces execution limits, ErrorBoundary provides structured recovery strategies, ProcessGuard catches global errors, CrashReporter logs structured diagnostics, and LifecycleManager was enhanced with crash count tracking, exponential backoff auto-recovery, and recovery event emission.

## Root Causes

### 1. No per-tab isolation
**Problem:** All tabs shared the same rendering pipeline — a crash in one tab's script execution could corrupt the entire browser state.
**Fix:** Created `TabContext` class that owns its own `DomTree`, `LayoutEngine`, `PaintEngine`, and `EventLoop`. Each tab gets a `TabContext` via `TabContextManager`, and crashes are isolated to that tab's context.

### 2. No script execution limits
**Problem:** JavaScript code could run infinite loops, cause stack overflows, or consume excessive time, hanging the browser.
**Fix:** Created `ScriptGuard` with wall-clock timeout (Promise.race), instruction count limits (tick()), and stack depth limits (pushFrame/popFrame). The interpreter calls `tick()` on each instruction and `pushFrame()`/`popFrame()` around function calls.

### 3. No structured error recovery
**Problem:** Errors in pipeline stages (parse, style, layout, paint, script) either crashed the whole browser or were silently swallowed.
**Fix:** Created `ErrorBoundary` with configurable recovery strategies: fail-fast, retry with exponential backoff, fallback value, or swallow-and-log. Supports async operations with timeout per attempt.

### 4. No global error catching
**Problem:** Uncaught exceptions and unhandled promise rejections could crash the Node.js process without any diagnostic information.
**Fix:** Created `ProcessGuard` that installs `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers, recording errors structurally and optionally triggering auto-recovery.

### 5. No crash diagnostics
**Problem:** When crashes occurred, there was no structured way to log, query, or analyze them.
**Fix:** Created `CrashReporter` with structured `CrashReport` objects (source, severity, phase, tab ID, URL, context, stack trace), builder pattern for report construction, and diagnostic queries (by source, severity, tab, recency, frequency summary).

### 6. LifecycleManager had no crash awareness
**Problem:** The lifecycle manager tracked state but had no concept of crash count, recovery attempts, or backoff.
**Fix:** Enhanced `LifecycleManager` with `_crashCount`, `_lastCrash`, `RecoveryConfig` (autoRecover, maxRecoveryAttempts, backoffBaseMs, backoffMaxMs), `recover()` method, `recovered` event emission with attempt number, and `crashed` event now includes `crashCount`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/engine/tab-context.ts` | Created — TabContext, TabContextManager, TabContextEventBus, per-tab isolation |
| `src/browser/engine/script-guard.ts` | Created — ScriptGuard, execution limits, stack depth, instruction counting |
| `src/browser/engine/error-boundary.ts` | Created — ErrorBoundary, ChainedErrorBoundary, recovery strategies |
| `src/browser/engine/process-guard.ts` | Created — ProcessGuard, global error handlers, error recording |
| `src/browser/engine/crash-reporter.ts` | Created — CrashReporter, CrashReportBuilder, structured diagnostics |
| `src/browser/engine/lifecycle-manager.ts` | Enhanced — crash count, RecoveryConfig, recover(), backoff, recovery events |
| `src/browser/js/event-loop.ts` | Added `clear()` method (needed by TabContext.dispose) |
| `tests/crash-recovery.test.ts` | Created — 88 tests covering all crash recovery modules |

## Test Results

```
67 test files, 2586 tests passed (0 failed)
crash-recovery.test.ts: 88 tests
```

Test breakdown by module:
- TabContext: 20 tests (state transitions, crash/recover, snapshot, events, config)
- TabContextManager: 5 tests (create, lookup, destroy, crashed filter, dispose)
- TabContextEventBus: 4 tests (emit, off, dispose, error resilience)
- ScriptGuard: 13 tests (exec, execAsync, tick, pushFrame/popFrame, limits, reset, config, disabled)
- ErrorBoundary: 12 tests (fail-fast, retry, history, context, async, chaining)
- ChainedErrorBoundary: 3 tests (success stops chain, combined history, dispose)
- ProcessGuard: 9 tests (record, fatal, warning, history, hasRecentErrors, onFatal callback, clear, config, dispose)
- CrashReporter: 8 tests (store, filter by source/severity/tab, recent, summary, clear, config, dispose)
- CrashReportBuilder: 4 tests (complete build, missing error, missing source, defaults)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   ProcessGuard                          │
│  (global error catching: uncaughtException, etc.)       │
└────────────────────┬────────────────────────────────────┘
                     │ recordError()
┌────────────────────▼────────────────────────────────────┐
│                   CrashReporter                         │
│  (structured logging, queries, frequency stats)         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   LifecycleManager                      │
│  (crash count, RecoveryConfig, auto-recover w/ backoff) │
│  States: Idle→Starting→Running→Crashed→(Recovering)→... │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   TabContextManager                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  TabContext  │  │  TabContext  │  │  TabContext  │  │
│  │  (isolated   │  │  (isolated   │  │  (isolated   │  │
│  │   pipeline)  │  │   pipeline)  │  │   pipeline)  │  │
│  │              │  │              │  │              │  │
│  │  DomTree     │  │  DomTree     │  │  DomTree     │  │
│  │  LayoutEngine│  │  LayoutEngine│  │  LayoutEngine│  │
│  │  PaintEngine │  │  PaintEngine │  │  PaintEngine │  │
│  │  EventLoop   │  │  EventLoop   │  │  EventLoop   │  │
│  │  ScriptGuard │  │  ScriptGuard │  │  ScriptGuard │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   ErrorBoundary                         │
│  (per-stage error catching, retry/fallback strategies)  │
└─────────────────────────────────────────────────────────┘
```
