# web-apis.ts as any Cleanup + Type Interface Hardening

**Date:** 2026-08-21
**Session:** Complete `as any` elimination across remaining JS engine files
**Status:** Completed

---

## Summary
Eliminated all 91 `as any` casts from `web-apis.ts` (91 → 0), completing the full `as any` cleanup across 4 target files. Also hardened type interfaces in `values.ts` to match actual runtime usage patterns.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/web-apis.ts` | 91 `as any` → 0; added `NativeTypedArrayLike` interface; used `JSObjectWithMeta`, `JSFunction`, `JSObject`, `JSValue` casts throughout |
| `src/browser/js/values.ts` | Fixed `__listeners` type (Map→Array), `__remote` type (boolean→JSObject), `__rangeState` typed interface, `__syncProps` typed function |

## Final as any counts (all 4 target files)

| File | Before | After |
|------|--------|-------|
| `typed-arrays.ts` | 95 | 2 (comments only) |
| `index.ts` | 58 | 0 |
| `dom-bindings.ts` | 24 | 0 |
| `web-apis.ts` | 91 | 0 |
| **Total** | **268** | **2** |

## Key changes in web-apis.ts

1. **`NativeTypedArrayLike` interface** — typed `length`, `BYTES_PER_ELEMENT`, and index access for host-provided native TypedArrays
2. **MessageChannel/MessagePort** — `__remote` as `JSObject`, `__listeners` as `Array<{type, fn}>`
3. **DOM helpers** (`domRemoveChild`, `domInsertBefore`, `domAppendChild`, `domCloneNode`) — extract `nativeFn` to const before invocation to satisfy TS narrowing
4. **Selection API** — `rangeObj.__rangeState` typed with `startContainer/startOffset/endContainer/endOffset`
5. **Event listeners** — `??= []` nullish coalescing for `__listeners` push/filter patterns
6. **Random value generation** — `NativeTypedArrayLike` for host typed array detection
7. **NodeWalker** — `(children as JSObject).type === 'array'` instead of `(children as any)`
8. **Record<string, JSValue>** — `unknown` intermediate cast for `name in obj` index access patterns
9. **Closure type checks** — `(callback as JSFunction).type === 'closure'` throughout

## values.ts interface fixes

| Field | Before | After |
|-------|--------|-------|
| `__listeners` | `Map<string, Set<(ev: unknown) => void>>` | `Array<{ type: string; fn: JSFunction }>` |
| `__remote` | `boolean` | `JSObject` |
| `__rangeState` | `unknown` | `{ startContainer: JSObject; startOffset: number; endContainer: JSObject; endOffset: number }` |
| `__syncProps` | `unknown` | `() => void` |

## Test Results

```
npx tsc --noEmit          0 errors
npx vitest run            194/195 files, 8946/8947 tests pass
npx vitest run css-animations.test.ts  11/11 pass (flaky under parallel load only)
```
