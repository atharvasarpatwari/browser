# XMLHttpRequest Implementation

**Date:** 2026-07-23
**Session:** XMLHttpRequest for JS engine
**Status:** Completed

---

## Summary

Implemented the `XMLHttpRequest` API for Nova's JavaScript engine with full lifecycle support (open/send/abort), event firing (readystatechange, load, error, abort, loadend), response headers, request headers, and EventTarget mixin for addEventListener/removeEventListener. Fixed bugs in `xhr-bindings.ts` event dispatch and `xhr.ts` readyState propagation.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/xhr-bindings.ts` | Added `invokeJSFunction` helper to properly call both native functions and JSFunction objects. Fixed `addEventListener` type check to accept JSFunction objects. Fixed `dispatchEvent` to use `invokeJSFunction`. |
| `src/browser/js/xhr.ts` | Fixed `setReadyState` to also update `obj.properties` so event handlers read the correct readyState. |
| `src/browser/js/index.ts` | Added XMLHttpRequest import and global registration (done in prior session). |

## Files Created
| File | Purpose |
|------|--------|
| `src/browser/js/xhr.ts` (289 lines) | XMLHttpRequest class: open/send/abort/getResponseHeader/getAllResponseHeaders/setRequestHeader/overrideMimeType, readyState constants, event handler properties, async send via eventLoop.enqueueMicrotask + globalThis.fetch |
| `src/browser/js/xhr-bindings.ts` (99 lines) | EventTarget mixin: createEventDispatcher, fireEvent, clearEventListeners. WeakMap-based listener storage. |
| `tests/xhr.test.ts` (58 tests) | Constructor, static constants, open, setRequestHeader, send, abort, getResponseHeader, getAllResponseHeaders, overrideMimeType, addEventListener, removeEventListener, multiple instances, writable properties, error handling |

## Root Causes (bug fixes)

### 1. JSFunction is not callable from native code
**File:** `src/browser/js/xhr-bindings.ts`
**Problem:** `fireEvent` called listeners as `fn(obj, [evt])` but JSFunction is an interface object (with `nativeFn` property), not a native JS function. Same issue in `dispatchEvent` and `addEventListener` type check (`typeof fn !== 'function'` rejected JSFunction objects).
**Fix:** Added `invokeJSFunction` helper that checks `typeof fn === 'function'` for native functions and `fn.nativeFn` for JSFunction objects. Updated `addEventListener` to accept both types.

### 2. setReadyState didn't propagate to JSObject properties
**File:** `src/browser/js/xhr.ts`
**Problem:** `setReadyState` only updated `state.readyState` (internal state) but not `obj.properties.get('readyState')`. Event handlers reading `readyState` always saw the stale value from `open()` (1/OPENED).
**Fix:** Added `xhrObj.properties.set('readyState', ...)` in `setReadyState`.

## Architecture

- **XHR state:** Internal `XhrState` object stored in `WeakMap<JSObject, XhrState>` (one per instance)
- **Event dispatch:** Shared `createEventDispatcher` function attaches addEventListener/removeEventListener/dispatchEvent via WeakMap-based listener storage
- **Async send:** Uses `eventLoop.enqueueMicrotask(async () => {...})` with `globalThis.fetch` under the hood
- **State transitions:** OPENED → HEADERS_RECEIVED → LOADING → DONE (or ERROR/ABORT paths)

## Test Results
```
Test Files  1 passed (1)
     Tests  58 passed (58)
```

Full suite: **97/98 files pass, 4354/4421 tests pass** (11 pre-existing OOM failures in image-decoder.test.ts)

## Verification
- All 58 XHR tests pass covering constructor, open, send, abort, headers, events, addEventListener, error handling
- No regressions in any other test file
- `npm run typecheck` — no new TS errors (pre-existing ones only)
