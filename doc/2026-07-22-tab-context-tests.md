# TabContext & TabContextManager Tests

**Date:** 2026-07-22
**Session:** Comprehensive test suite for tab isolation
**Status:** Completed

---

## Summary

Added 25 tests covering the full TabContext and TabContextManager API: construction, state machine transitions, crash/recovery lifecycle, snapshots, event bus, config management, manager CRUD, and disposal.

## Files Created

| File | Purpose |
|------|--------|
| `tests/tab-context.test.ts` | 25 vitest tests for TabContext + TabContextManager |

## Files Modified

| File | Change |
|------|--------|
| `doc/README.md` | Added index entry |

## Test Results

```
 ✓ tests/tab-context.test.ts (25 tests) 499ms
  Test Files  1 passed (1)
       Tests  25 passed (25)
```

## Test Coverage

| Category | Tests | Details |
|----------|-------|---------|
| Construction | 3 | Idle state, unique IDs, default config |
| State transitions | 5 | Idle→Loading, Loading→Active, →Crashed, blocked in Crashed, blocked in Disposed |
| Crash & Recovery | 4 | crashInfo fields, crashCount increment, recover success, recover at limit |
| Snapshots | 2 | snapshot fields, snapshotSaved event |
| Events | 3 | stateChanged, crashed, recovered events |
| Config | 2 | getConfig returns copy, updateConfig merges partial |
| TabContextManager | 4 | createContext, getContext hit/miss, destroyContext |
| Dispose | 2 | transitions to Disposed, clears event loop |
