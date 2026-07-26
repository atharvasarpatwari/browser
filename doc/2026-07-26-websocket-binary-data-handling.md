# WebSocket Binary Data Handling Fixes

**Date:** 2026-07-26
**Session:** Fix binary data handling in WebSocket API
**Status:** Completed

---

## Summary

Fixed three gaps in the Nova Browser's WebSocket implementation: binary send support, binary receive support, and close code validation. Added 14 new tests (38 total WebSocket tests).

## Root Causes

### 1. Binary send only stringified data
**File:** `src/browser/js/websocket-api.ts`
**Problem:** The `send()` method had no handling for objects with `__type_override` indicating binary types (ArrayBuffer, TypedArray). All objects fell through to `String(data)`, producing `'[object Object]'`.
**Fix:** Added `__type_override` detection before the generic object branch. When `__type_override === 'arraybuffer'` or matches a typed array name, extract `__buffer` from the JSObject's `.properties` Map and pass it directly to the platform WebSocket.

### 2. Binary receive always produced `'[Binary Data]'` string
**File:** `src/browser/js/websocket-api.ts`
**Problem:** The message handler's `typeof ev.data === 'string'` check was the only path; binary data was always stringified to `'[Binary Data]'`.
**Fix:** Added a branch checking for `ev.data.properties.has('__binaryData')`. When `binaryType === 'arraybuffer'`, extracts `__buffer` from the binary data JSObject; otherwise passes the wrapper through.

### 3. Close code not validated per spec
**File:** `src/browser/js/websocket-api.ts`
**Problem:** `close()` accepted any code without validation. The WHATWG spec requires codes to be absent, 1000, or in range 3000-4999, and reason to be max 123 bytes UTF-8.
**Fix:** Added validation before setting CLOSING state. Throws `DOMException('SyntaxError')` for invalid codes and oversized reasons.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/websocket-api.ts` | Added `TYPED_ARRAY_TYPES` set, binary send detection in `send()`, binary receive handling in message listener, close code/reason validation in `close()` |
| `tests/websocket.test.ts` | Added `createObject` import, updated `MockWebSocket` to track raw sent data, added 14 tests for binary send/receive/close validation/protocol |

## Test Results

```
tests/websocket.test.ts  (38 tests) — 38 passed
Full suite: 150+ test files, only 3 pre-existing DNS timeout failures
```

## Verification Steps

1. All 38 WebSocket tests pass (24 existing + 14 new)
2. Full test suite passes (no regressions)
3. Binary send: objects with `__type_override: 'arraybuffer'` have `__buffer` extracted and passed to platform
4. Binary send: typed array objects (`uint8array`, etc.) handled identically
5. Binary receive: `__binaryData`-flagged objects unwrapped when `binaryType === 'arraybuffer'`
6. Close validation: codes 1000, 3000-4999 accepted; 1-999, 1001-2999, 5000+ rejected with SyntaxError
7. Close validation: reason > 123 UTF-8 bytes rejected with SyntaxError
