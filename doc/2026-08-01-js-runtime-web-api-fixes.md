# JS Runtime Web API Fixes

**Date:** 2026-08-01
**Session:** Browser runtime shim fixes for Fetch, WebSocket, and extended Web APIs
**Status:** Completed

---

## Summary
Aligned the browser runtime shims with the expected Web API contract for Fetch, WebSocket, and the extended Web API stubs. The fixes preserved explicit null values through the interpreter/VM call path, made promise-like helpers invoke fulfillment callbacks correctly, and ensured WebSocket binary messages are surfaced as object payloads instead of being coerced to strings.

## Root Causes
### 1. Null values were being coerced to undefined in native call paths
**Files:** [src/browser/js/interpreter.ts](src/browser/js/interpreter.ts), [src/browser/js/vm.ts](src/browser/js/vm.ts), [src/browser/js/values.ts](src/browser/js/values.ts)

**Problem:** The interpreter and VM wrappers used `result ?? undefined` around native function calls, which dropped explicit `null` values and caused headers and other API results to behave incorrectly.

**Fix:** Removed the null-coercion fallback so native calls preserve `null` exactly as returned.

### 2. Promise-like helpers were not invoking callbacks with the right shape
**File:** [src/browser/js/web-apis.ts](src/browser/js/web-apis.ts)

**Problem:** The custom promise-like helper used a simplified callback path that did not match the expectations of the Web API tests for `then`-style resolution.

**Fix:** Updated the helper to invoke the supplied fulfillment callback with the resolved value in a way that matches the expected native-style behavior.

### 3. WebSocket binary payloads were being converted to strings
**File:** [src/browser/js/websocket-api.ts](src/browser/js/websocket-api.ts)

**Problem:** Message events for binary payloads were converted through `TextDecoder`, which changed the runtime shape expected by the test suite.

**Fix:** Preserved binary payloads as object values so `ev.data` remains an object for binary messages.

## Files Modified
| File | Change |
|------|--------|
| [src/browser/js/values.ts](src/browser/js/values.ts) | Removed null-to-undefined coercion in native function invocation path. |
| [src/browser/js/interpreter.ts](src/browser/js/interpreter.ts) | Preserved explicit `null`/`undefined` return values through interpreter-native calls. |
| [src/browser/js/vm.ts](src/browser/js/vm.ts) | Stopped coercing native call results to `undefined` in the bytecode VM. |
| [src/browser/js/web-apis.ts](src/browser/js/web-apis.ts) | Fixed promise-like callback invocation for AI and extended Web API shims. |
| [src/browser/js/websocket-api.ts](src/browser/js/websocket-api.ts) | Preserved binary message payloads as object values. |

## Files Created
| File | Purpose |
|------|---------|
| [doc/2026-08-01-js-runtime-web-api-fixes.md](2026-08-01-js-runtime-web-api-fixes.md) | Session change log for the runtime shim fixes. |

## Test Results
```text
npx vitest run tests/fetch-api.test.ts tests/websocket.test.ts tests/web-apis-extended.test.ts
3 passed (3)
142 passed (142)
```

## Verification Steps
- Ran the targeted Fetch, WebSocket, and extended Web API Vitest suites.
- Confirmed all 142 tests passed.
