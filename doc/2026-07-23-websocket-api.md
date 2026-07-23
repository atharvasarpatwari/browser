# WebSocket API Implementation

**Date:** 2026-07-23
**Session:** WebSocket API + image decoder async fix
**Status:** Completed

---

## Summary

Implemented WHATWG-spec WebSocket class for the JS engine with platform-factory pattern, CSP enforcement, and event dispatch. Fixed 4 runtime bugs discovered during testing, added missing `addEventListener`/`removeEventListener` methods, and fixed 11 image-decoder test failures caused by earlier async refactor.

## Bugs Fixed

### 1. Constructor used `createNativeFunction` (no prototype support)
**File:** `src/browser/js/websocket-api.ts`
**Problem:** `createNativeFunction` creates a plain JSFunction with no `properties` map, so `WebSocket.prototype` and static constants (`CONNECTING=0`, `OPEN=1`, `CLOSING=2`, `CLOSED=3`) never resolved.
**Fix:** Changed to `createObject(null)` with `callable: true` and `nativeFn` field — same pattern as XHR and Promise constructors.

### 2. `queueMicrotask` → `enqueueMicrotask`
**File:** `src/browser/js/websocket-api.ts`
**Problem:** EventLoop API uses `enqueueMicrotask`, not `queueMicrotask`. Call failed at runtime.
**Fix:** `eventQueue.enqueueMicrotask(() => { ... })`

### 3. `emitEvent` handler detection wrong for JSFunction
**File:** `src/browser/js/websocket-api.ts`
**Problem:** `'properties' in handler` fails because JSFunction has no `properties` field (only JSObject does), so event handlers on WebSocket never fired.
**Fix:** Changed to `handler.type === 'closure'` — JSFunction always has `type: 'closure'`.

### 4. `close()` didn't update `readyState` property
**File:** `src/browser/js/websocket-api.ts`
**Problem:** `readyState` stayed `OPEN` after calling `close()`.
**Fix:** Added `setProp(wsObj, 'readyState', CLOSING, false, false)` after platform close call.

### 5. Missing `addEventListener`/`removeEventListener` on WebSocket prototype
**File:** `src/browser/js/websocket-api.ts`
**Problem:** WebSocket instances had no way to register event listeners.
**Fix:** Added prototype methods matching the XHR pattern (stores handlers in `wsObj.properties` with `_handlers_` prefix).

### 6. `decode()` async but tests calling synchronously
**File:** `tests/image-decoder.test.ts`
**Problem:** Earlier session made `ImageDecoder.decode()` return `Promise<ImageData | null>` via dynamic imports, but all 11 decode tests called it without `await`.
**Fix:** Added `async` to all 11 test callbacks and `await` before every `decoder.decode()` call.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/websocket-api.ts` | Constructor pattern, enqueueMicrotask, emitEvent handler check, readyState update, addEventListener/removeEventListener |
| `tests/image-decoder.test.ts` | Made 11 decode tests async/await |

## Files Created

| File | Purpose |
|------|---------|
| `tests/websocket.test.ts` | 24 WebSocket tests with MockWebSocket platform factory |

## Test Results

```
tests/image-decoder.test.ts  20 tests  ✓ passed
tests/websocket.test.ts      24 tests  ✓ passed
Total: 44/44 passed, 0 failures
```
