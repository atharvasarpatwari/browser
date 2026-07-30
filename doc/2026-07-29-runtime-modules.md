# Runtime Modules — Call Stack, Task Queue, Microtasks, requestAnimationFrame, requestIdleCallback

**Date:** 2026-07-29
**Session:** Add 5 runtime execution modules under `src/browser/media/`
**Status:** Completed

---

## Summary

Created 5 runtime modules that model browser execution primitives as standalone services, each following the `IDisposable` + `onEvent` pattern. These complement the existing `EventLoop` class (which is deeply coupled to JS runtime internals) by providing clean, testable wrappers suitable for use at the application layer.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/media/index.ts` | Added re-exports for all 5 runtime modules |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/media/call-stack.ts` | Execution frame tracking with push/pop/peek, max depth enforcement, stack trace formatting |
| `src/browser/media/task-queue.ts` | Macrotask scheduling with delay, recurring tasks, runOnce/runAll |
| `src/browser/media/microtasks.ts` | Dual-priority (high/normal) microtask queue with drain |
| `src/browser/media/request-animation-frame.ts` | rAF callback scheduling, FPS clamping (1-120), bulk runPending |
| `src/browser/media/request-idle-callback.ts` | Idle callback with `IdleDeadline`, timeout support, `timeRemaining()` |
| `tests/runtime.test.ts` | 58 tests across all 5 modules |

## Architecture Decisions

1. **Standalone, not wrapping EventLoop** — `EventLoop` is deeply intertwined with JS runtime internals (interpreter references, timer clamping, task IDs). These modules are clean-room implementations that serve the same conceptual purpose without the coupling.
2. **Call Stack** — Uses a simple array with a configurable max depth (default 1000). Frames store function name, file, line, column, args, and timestamp. `getStackTrace()` formats like V8's `Error.stack`.
3. **Task Queue** — Mirrors `EventLoop.schedule/clearTimer/runOnce/runAll` semantics but without timer clamping or interpreter dependency. Recurring tasks re-queue after execution.
4. **Microtasks** — Two priority levels (high = `process.nextTick` analog, normal = `queueMicrotask` analog). High drains first. Count returned from `drain()`.
5. **Animation Frame** — `runPending(timestamp)` executes all queued callbacks with the given timestamp. FPS is configurable but purely informational (not tied to actual vsync).
6. **Idle Callback** — `IdleDeadlineImpl` tracks elapsed time with `performance.now()` for `timeRemaining()`. `didTimeout` is computed by comparing elapsed vs timeout. Default timeout is 50ms.

## Test Results

```
 Test Files  6 passed (6)
      Tests  494 passed (494)  [436 existing + 58 new]
```

All 58 new tests pass. The pre-existing `done()` deprecation warning in `tests/media.test.ts:302` is unrelated.
