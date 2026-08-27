# Pipeline Session 8 — RepaintScheduler

**Date:** 2026-08-27
**Session:** Pipeline module 8 — repaint scheduling and coalescing
**Status:** Completed

---

## Summary
Implemented `RepaintScheduler`, the top-level orchestrator that drives the full 7-stage rendering pipeline on demand, coalesces repaint requests within a single tick, and records per-frame performance metrics.

## Module Overview

**File:** `src/browser/rendering/pipeline/repaint-scheduler.ts`

`RepaintScheduler` accepts a `DOMNodeLike` DOM tree, a style resolver, and optional viewport dimensions. It runs the complete pipeline (render tree → layout → text shaping → paint records → stacking context → compositing → rasterization) and returns a `PipelineSnapshot` containing every intermediate artifact plus aggregated `FrameMetrics`.

### Key API
| Method | Description |
|--------|-------------|
| `setDOM(dom)` | Provide the DOM tree |
| `setStyleResolver(fn)` | Provide the style resolver |
| `renderSync()` | Run full pipeline synchronously, return `PipelineSnapshot` |
| `requestRepaint()` | Coalesce into a single microtask frame via `setTimeout(…, 0)` |
| `cancelRepaint()` | Cancel a pending coalesced frame |
| `setViewport(w, h)` | Update viewport dimensions and trigger repaint |
| `renderSync()` stores `lastSnapshot` | — |
| `frameCount` / `history` / `maxHistory` | Frame counter and metrics history |
| `onFrameReady(cb)` | Register callback for coalesced frames |
| `dispose()` | Clear all state |

### Exports
- `RepaintScheduler`
- `PipelineSnapshot`
- `FrameMetrics`
- `RepaintSchedulerOptions`

## Coalescing Design
Multiple `requestRepaint()` calls within the same tick are collapsed into a single frame. The scheduler uses `setTimeout(…, 0)` for this — only one timer is active at a time. `cancelRepaint()` clears the pending timer.

## Bug Fixes During Development
1. **`renderSync()` not storing `_lastSnapshot`**: Initially only `renderFrame()` set `_lastSnapshot`, causing null dereferences when devtools bridge tests used `sched.lastSnapshot` after `renderSync()`. Fixed by adding `this._lastSnapshot = snapshot` in `renderSync()`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/pipeline/repaint-scheduler.ts` | New module (session 8) |
| `tests/repaint-scheduler-pipeline.test.ts` | New test suite (13 tests) |

## Test Results
```
tests/repaint-scheduler-pipeline.test.ts (13 tests) — all pass
Full suite: 205 files / 9082 tests — 0 failures
tsc --noEmit: 0 errors
```
