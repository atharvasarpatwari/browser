# IPC Infrastructure Overhaul — Bugs, Streaming, Transforms, Robustness

**Date:** 2026-07-26
**Session:** IPC overhaul — bug fixes, streaming rewrite, new transports, heartbeat, backpressure
**Status:** Completed

---

## Summary

Comprehensive IPC overhaul fixing 2 bugs, rewriting streaming with queue-based approach and server-side handlers, adding typed topic messaging (`subscribe()`), fixing ProcessManager readonly field mutations, adding heartbeat/keepalive, extending the ITransport interface with `bufferedAmount`/`onDrain`/`offDrain` for backpressure, and implementing two new transports (WorkerTransport for worker_threads, SocketTransport for TCP/Unix). 33 new tests, 6683 total pass.

## Root Causes

### 1. CrossProcessPageLoader `subscribe()` Does Not Exist on IChannel
**File:** `src/common/ipc/cross-process-page-loader.ts:44`
**Problem:** `CrossProcessPageLoader.onProgress()` called `this.channel.subscribe<ILoadProgress>(...)` but `IChannel` had no `subscribe()` method. Only `onMessage()`, `offMessage()`, `send()`, `request()`, `stream()` existed. This would cause a TypeScript compile error or runtime failure.
**Fix:** Added `subscribe<T>(topic: string, handler: (payload: T) => void): () => void` to the `IChannel` interface and `Channel` class. The implementation wraps topic-filtered messages in a `{ __topic__, __payload__ }` envelope sent via fire-and-forget, with topic-level filtering on the receiving side.

### 2. Stream Request Handler Empty
**File:** `src/common/ipc/channel.ts:396-399`
**Problem:** `_handleStreamRequest()` had an empty body with only a comment. Incoming stream requests were silently dropped — no chunks were ever sent back.
**Fix:** Implemented the handler to: (1) find registered `ChannelStreamHandler`, (2) call it to get an async iterable, (3) iterate and send each chunk via `createStreamChunk`, (4) send a final `done: true` chunk.

### 3. ProcessManager `readonly` Field Mutation via `as any`
**File:** `src/common/ipc/process-manager.ts` (12+ locations)
**Problem:** `ProcessInfo` interface declared all fields as `readonly`, but the manager mutated `state`, `readyAt`, `crashCount`, `transport`, and `channelManager` via `(info as any).field = ...`. This bypassed TypeScript's type system and created fragile code.
**Fix:** Introduced `MutableProcessInfo` interface extending `ProcessInfo` with mutable fields. Internal `_processes` map uses `MutableProcessInfo`. All `as any` casts eliminated.

## Features Implemented

### Topic-Based Subscribe (`channel.ts`)
- `subscribe<T>(topic, handler)` — registers a message handler filtered by topic, returns an unsubscribe function
- `send(topic, payload)` overload — wraps payload in `{ __topic__, __payload__ }` envelope
- Topic filtering happens on the receiver side inside the message handler

### Queue-Based Streaming (`channel.ts`)
- Rewrote `stream()` method with a proper queue: incoming chunks are pushed to a queue, the async iterator pulls from it
- Added `onStream()` / `offStream()` to `IChannel` for server-side stream handlers
- `_handleStreamRequest()` now properly iterates async generator and sends chunks back
- Stream timeout support (clears on completion, rejects on timeout)
- Cleanup in `finally` block removes transport handler and clears pending stream state

### ProcessManager Heartbeat (`process-manager.ts`)
- Heartbeat channel `__heartbeat__` auto-created per process on Ready
- Parent sends `{ type: 'ping' }` every 15s, child responds with `{ type: 'pong' }`
- Miss counter: after 3 missed heartbeats, process is treated as crashed
- Heartbeat timers cleaned up on process destroy, crash, and manager dispose

### Transport Backpressure (`transport.ts`)
- Added to `ITransport`: `bufferedAmount` (readonly), `onDrain(handler)`, `offDrain(handler)`
- Updated all 6 transport implementations: InProcessTransport, EventEmitterTransport, ChildProcessTransport, ChildSideTransport, WorkerParentTransport, WorkerSideTransport
- `TransportConfig` extended with `highWaterMark` and `lowWaterMark` (0 = disabled)
- SocketTransport implements proper backpressure via Node.js `socket.write()` return value + drain event

### WorkerTransport (`worker-transport.ts`)
- `WorkerParentTransport` — wraps a Worker instance (parent side): `postMessage`/`on('message')` with `bufferedAmount` tracking
- `WorkerSideTransport` — wraps `parentPort` (worker side): same API pattern
- Both implement full `ITransport` interface including backpressure

### SocketTransport (`socket-transport.ts`)
- `SocketTransport` — client-side TCP/Unix socket via `net.connect()` with `bufferedAmount` tracking
- `SocketServerTransport` — server-side wrapper for connected `net.Socket` instances
- Both implement proper backpressure: track buffered bytes, await drain when write returns false

## Files Modified

| File | Change |
|------|--------|
| `src/common/ipc/channel.ts` | Added `subscribe()`, `send(topic, payload)`, `onStream()/offStream()`, queue-based `stream()`, `_handleStreamRequest()`, `ChannelStreamHandler` type |
| `src/common/ipc/transport.ts` | Added `bufferedAmount`, `onDrain()`, `offDrain()` to `ITransport` and all implementations; added `highWaterMark`/`lowWaterMark` to config |
| `src/common/ipc/process-manager.ts` | Added `MutableProcessInfo`, removed all `as any` casts, added heartbeat system |
| `src/common/ipc/child-process-transport.ts` | Added `bufferedAmount`, `onDrain()`, `offDrain()` to both transport classes |
| `src/common/ipc/index.ts` | Added exports for new transports and types |

## Files Created

| File | Purpose |
|------|---------|
| `src/common/ipc/worker-transport.ts` | WorkerParentTransport + WorkerSideTransport for worker_threads IPC |
| `src/common/ipc/socket-transport.ts` | SocketTransport + SocketServerTransport for TCP/Unix IPC |
| `tests/ipc-advanced.test.ts` | 33 tests covering subscribe, streaming, heartbeat, backpressure, all new transports |

## Test Results

```
Test Files  147 passed (149)
     Tests  6683 passed, 3 failed (pre-existing DNS timeouts)
    Errors  1 error (pre-existing OOM)

New IPC tests: 33/33 pass
Existing IPC tests: 158/158 pass (no regressions)
```
