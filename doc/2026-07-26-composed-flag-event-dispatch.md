# Composed Flag Support for Event Dispatch

**Date:** 2026-07-26
**Session:** Add `composed` flag to event dispatch for shadow DOM boundary crossing
**Status:** Completed

---

## Summary

Added `composed` flag support to event dispatch in both the TypeScript event system (`events.ts`) and the JS-side DOM bindings (`dom-bindings.ts`). When `composed === false` (default), events stop at shadow root boundaries. When `composed === true`, events cross shadow DOM boundaries by jumping to the host element and continuing propagation.

## Root Cause

### 1. Events ignored shadow DOM boundaries entirely
**File:** `src/browser/rendering/html5/events.ts`
**Problem:** The ancestor chain walk in `dispatchEvent` walked `node.parent` unconditionally — events dispatched inside shadow trees would propagate through the shadow root into the outer document, violating the WHATWG DOM spec.
**Fix:** Added `isShadowRoot` check during ancestor walk. When `composed === false`, the walk stops at shadow root boundaries. When `composed === true`, it jumps to the host element and continues.

### 2. JS-side dispatch had no composed awareness
**File:** `src/browser/js/dom-bindings.ts`
**Problem:** `createEventObject` didn't accept a `composed` option, and the element-level `dispatchEvent` had no shadow boundary handling.
**Fix:** Added `composed` to `createEventObject` options. Added `composed` property to the event JSObject. Added shadow root boundary detection in the ancestor walk (via `host` property check on non-element nodes).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/html5/events.ts` | Added imports for `isShadowRoot`/`MutableShadowRoot` from shadow.ts. Modified `dispatchEvent` ancestor chain to respect `composed` flag — stops at shadow root when false, crosses to host when true. |
| `src/browser/js/dom-bindings.ts` | Added `composed` option to `createEventObject`. Added `composed` property to event JSObject. Modified element-level `dispatchEvent` to detect shadow root boundaries and respect `composed` flag. |
| `tests/html5-events.test.ts` | Added 6 tests for composed flag: non-composed stops at boundary, composed crosses boundary, capture phase respects boundaries, composed flag defaults/preservation. |

## Test Results

```
✓ tests/html5-events.test.ts (50 tests) — 21ms
  Test Files  1 passed (1)
  Tests       50 passed (50)
```

## Verification

1. Non-composed event dispatched on shadow tree child does NOT reach host listener
2. Composed event dispatched on shadow tree child DOES reach host listener
3. Capture phase respects shadow boundaries for non-composed events
4. Capture phase crosses boundaries for composed events
5. All 44 pre-existing event tests continue to pass
6. No new TypeScript errors introduced
