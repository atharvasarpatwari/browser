# IPC Infrastructure Fixes

**Date:** 2026-07-26
**Session:** Multi-process activation — Channel, ProcessManager, ChildProcessTransport fixes
**Status:** Completed

---

## Summary

Fixed 5 critical bugs in the IPC infrastructure to enable multi-process activation: Channel direction hardcoding, duplicate request handler responses, accumulated transport handlers on reactivation, ProcessManager readiness handshake with in-process factory, and rewrote ChildProcessTransport tests to match the new ITransport-compliant API.

## Root Causes

### 1. Channel Direction Hardcoding

**File:** `src/common/ipc/channel.ts`
**Problem:** `send()`, `request()`, and `stream()` hardcoded `'main-to-renderer'` as the message direction, ignoring the channel's config. Response messages in `_handleRequest()` hardcoded `'renderer-to-main'`.
**Fix:** Added `direction` to `ChannelConfig` (required, default `'main-to-renderer'`). All message creation methods now use `this._config.direction`.

```typescript
// Before
const msg = createFireAndForget(this.name, 'main-to-renderer', this._processId, payload);
// After
const msg = createFireAndForget(this.name, this._config.direction, this._processId, payload);
```

### 2. Duplicate Request Handler Responses

**File:** `src/common/ipc/channel.ts`
**Problem:** `_handleRequest()` iterated ALL registered handlers and sent a response for each one, causing duplicate responses and race conditions.
**Fix:** Only the first registered handler is invoked. If no handlers exist, an error response is sent immediately (instead of silently dropping).

```typescript
// Before: iterated all handlers
for (const handler of this._requestHandlers) {
  const result = await handler(msg.payload, msg);
  // ... sent response per handler
}
// After: only first handler
const handlers = Array.from(this._requestHandlers);
if (handlers.length === 0) { /* send error response */ return; }
const result = await handlers[0](msg.payload, msg);
// ... single response
```

### 3. Transport Handler Accumulation on Reactivation

**File:** `src/common/ipc/channel.ts`
**Problem:** `activate()` registered a new anonymous `onData` handler each time without tracking it. `deactivate()` had no way to remove it, causing accumulated handlers on repeated activate/deactivate cycles.
**Fix:** Added `_transportDataHandler` field to track the registered handler. `deactivate()` now calls `transport.offData()` to properly clean up. Re-registration is safe.

### 4. In-Process Factory Ready Signal Race

**File:** `src/common/ipc/process-manager.ts`
**Problem:** `createInProcessManager` factory sent the `PROCESS_READY` signal synchronously before `spawnProcess()` could register the `_waitForReady` data handler, causing all ProcessManager tests to time out.
**Fix:** Ready signal is sent asynchronously via `setTimeout(() => childSide.send(readyMsg), 0)`, allowing the manager's handler to register first.

### 5. ChildProcessTransport Test/API Mismatch

**File:** `tests/ipc/child-process-transport.test.ts`
**Problem:** Tests called non-existent methods (`attach()`, `onMessage()`, `offError()`) and accessed non-existent properties (`isAlive`) from the old API.
**Fix:** Rewrote 28 tests against the new `ITransport`-compliant API: `fromChildProcess()` factory, `onData()`/`offData()`, `connect()`/`disconnect()`, `onClose()`, `childProcess` getter.

## Files Modified

| File | Change |
|------|--------|
| `src/common/ipc/channel.ts` | Added `direction` to config, fixed hardcoded directions, fixed duplicate handler loop, added `_transportDataHandler` for cleanup |
| `src/common/ipc/process-manager.ts` | Added async ready signal in `createInProcessManager`, exported `createChildProcessManager` |
| `src/common/ipc/index.ts` | Added `createChildProcessManager` to barrel exports |
| `tests/ipc.test.ts` | Updated 3 test expectations, added 6 new tests (direction config, no duplicate handlers, reactivation lifecycle) |
| `tests/ipc/child-process-transport.test.ts` | Complete rewrite: 28 tests against ITransport-compliant API |

## Test Results

```
Test Files: 132 passed | 134 total
Tests:      5934 passed | 5993 total | 3 failed (pre-existing DNS timeouts)
```

IPC-specific: 69/69 pass (ipc.test.ts), 28/28 pass (child-process-transport.test.ts) = 97/97 IPC tests pass.

## Verification Steps

1. Ran `npx vitest run tests/ipc.test.ts` — 69/69 pass
2. Ran `npx vitest run tests/ipc/child-process-transport.test.ts` — 28/28 pass
3. Ran `npx vitest run` (full suite) — 132/134 test files pass, 5934/5993 tests pass
4. Only pre-existing failures: 3 DNS timeouts (networking-integration.test.ts) + 1 worker OOM
