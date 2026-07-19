# IPC System — Design and Bug Fixes

**Date:** 2026-07-18
**Session:** IPC system design, implementation, and bug fixes (19→0 failures)
**Status:** Completed

---

## Summary

Designed and implemented a complete IPC (inter-process communication) system with 6 modules, 64 tests. All 19 initial test failures were diagnosed and fixed in 4 source files, achieving 2650/2650 passing tests across 68 test files.

## Root Causes

### 1. JSON.stringify toJSON() Trap
**File:** `src/common/ipc/serializer.ts`
**Problem:** `JSON.stringify(message, replacer)` calls `value.toJSON()` BEFORE invoking the replacer. `Date.toJSON()` returns an ISO string, so the replacer never sees a Date instance — it sees a plain string and passes it through. The tagged wrapper `{ __ipc_type__: 'date', ... }` was never applied.
**Fix:** Replaced replacer/reviver with a pre-process/post-process approach. `preprocess()` walks the object tree BEFORE `JSON.stringify` runs, wrapping Date/Map/Set/RegExp/Error/BigInt/undefined/ArrayBuffer in tagged objects. `postprocess()` walks the parsed JSON tree AFTER `JSON.parse()`, reconstructing native types from tags.

```typescript
// BEFORE (broken — Date.toJSON runs before replacer)
encode(message: IPCMessage): string {
  return JSON.stringify(message, replacer);
}

// AFTER (works — preprocess wraps types before stringify)
encode(message: IPCMessage): string {
  const preprocessed = preprocess(message);
  return JSON.stringify(preprocessed);
}
```

### 2. JSON.parse Reviver undefined Key Deletion
**File:** `src/common/ipc/serializer.ts`
**Problem:** When `JSON.parse`'s reviver returns `undefined` for a key, `JSON.parse` deletes that key from the parent object entirely. So `{ val: undefined }` becomes `{}` after round-trip, failing the `'val' in payload` check.
**Fix:** Switched from `JSON.parse(data, reviver)` to `JSON.parse(data)` + `postprocess()`. The postprocess function sets `result[k] = undefined` for tagged-undefined values, which preserves the key with an undefined value (key existence is maintained).

### 3. ServiceProxy _connected Never Set
**File:** `src/common/ipc/service-proxy.ts`
**Problem:** `_connected` was initialized to `false` and never set to `true`. Every `invoke()` call threw "not connected". The proxy was designed to be connected upon construction (a channel is provided), but the constructor forgot to set the flag.
**Fix:** Added `this._connected = true;` at the end of the constructor.

### 4. Channel `_handleIncoming` Ignored Active State
**File:** `src/common/ipc/channel.ts`
**Problem:** When a channel was deactivated, its `onData` handler on the transport remained registered, and `_handleIncoming` did not check `this._active`. Deactivated stub channels still responded to ping requests, making `proxy.ping()` return `true` even after `stub.deactivate()`.
**Fix:** Added `if (!this._active) return;` at the top of `_handleIncoming`. Now deactivated channels silently drop incoming messages.

### 5. ProcessManager `require()` in ESM Context
**File:** `src/common/ipc/process-manager.ts`
**Problem:** `createInProcessManager` used `require('./transport')` inside the factory function. The project uses ES modules, and vitest transpiles to ESM — `require()` is not available.
**Fix:** Changed `require('./transport')` to `await import('./transport')`.

## Files Modified

| File | Change |
|------|--------|
| `src/common/ipc/serializer.ts` | Replaced replacer/reviver with preprocess/postprocess (fixes toJSON trap + undefined deletion) |
| `src/common/ipc/service-proxy.ts` | Set `_connected = true` in constructor |
| `src/common/ipc/channel.ts` | Added `_active` check in `_handleIncoming` |
| `src/common/ipc/process-manager.ts` | Changed `require()` to `await import()` in `createInProcessManager` |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-07-18-ipc-design.md` | This document |

## Test Results

```
68 test files — 2650 tests — all passing

IPC-specific: 64 tests (Message Protocol, Serializer, InProcessTransport,
Channel, ChannelManager, ServiceProxy + ServiceStub, ProcessManager)
```

## Verification

1. `npx vitest run tests/ipc.test.ts` — 64/64 pass
2. `npx vitest run` — 2650/2650 pass (68 files)
3. No regressions in any existing test file
