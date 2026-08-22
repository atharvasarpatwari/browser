# typed-arrays.ts — Remove All `as any` Casts

**Date:** 2026-08-21
**Session:** Eliminate every remaining `as any` cast in `src/browser/js/typed-arrays.ts` using typed helpers and `JSObjectWithMeta`
**Status:** Completed

---

## Summary

Removed all 60 `as any` casts from code in `typed-arrays.ts` (final count: **2**, both inside the two pre-existing explanatory comment lines at the top of the file, which were intentionally left untouched). Element access now goes through the existing `readTypedElement`/`writeTypedElement` helpers; metadata access uses `JSObjectWithMeta`; native constructor lookup is fully typed.

## Changes

### 1. Typed element access (view reads/writes)
Replaced all `(view as any)[i]` patterns with helpers:
- Reads → `readTypedElement(view, i)` in: `find`, `findIndex`, `sort` (collect), `reverse`, `copyWithin`, `join`, `map`, `filter`, `reduce` (init + iteration), `some`, `every`, `at`, `toString`, `forEach`.
- Writes → `writeTypedElement(view, i, v)` in: `sort` (write-back), `reverse` (both swaps), `copyWithin`.

### 2. Metadata casts → `JSObjectWithMeta`
- `(ta as any).__type_override/__nativeBuffer/__nativeView/__taOffset/__taMeta` → single `createObject(...) as JSObjectWithMeta` then direct property assignment (`wrapTypedArray`).
- `(ref as any).__weakTarget/__type_override` → `as JSObjectWithMeta` (WeakRef ctor + `deref`).
- `(registry as any).__frCallback/__frRegistry/__type_override` → `as JSObjectWithMeta` (FinalizationRegistry ctor/register/unregister).
- `(obj as any).__nativeView` → `(obj as JSObjectWithMeta).__nativeView` in `getTypedArrayNativeView` (return type tightened `any` → `TypedArrayLike`) and `getAtomicsView`.
- `(_this as any).__taMeta as TypedArrayMeta` → `(_this as JSObjectWithMeta).__taMeta as unknown as TypedArrayMeta` (`map`, `filter`).

### 3. Constructor argument narrowing
In `createTypedArrayConstructor` / static `from`:
- `(firstArg as any).__nativeView` → `(firstArg as JSObjectWithMeta).__nativeView` (+ `as TypedArrayLike` on extraction).
- `(firstArg as any).type === 'array'` → `(firstArg as JSObject).type === 'array'`.
- `(firstArg as any).properties?.has('length')` → `(firstArg as JSObject).properties?.has('length')`.
- `(firstArg/src as any).__nativeBuffer` → `(… as JSObjectWithMeta).__nativeBuffer`.
- `(src as any).properties?.has(Symbol.iterator as any)` → `(src as JSObject).properties?.has(Symbol.iterator as unknown as string)` (properties map is keyed by `string`).
- `'closure' in (cleanupCallback as any)` → plain `'closure' in cleanupCallback` (narrowed to object first).
- `registry.set/delete(target as any, …)` → plain `target` (already narrowed to a non-null object type).

### 4. Native typed-array constructor typing
`getTypedArrayConstructor` previously returned `any` via `(globalThis as any)[name]`. Now:
```typescript
type NativeTypedArrayCtor = new (
  buffer: ArrayBuffer,
  byteOffset?: number,
  length?: number,
) => TypedArrayLike;

function getTypedArrayConstructor(name: string): NativeTypedArrayCtor {
  const ctor = (globalThis as unknown as Record<string, NativeTypedArrayCtor | undefined>)[name];
  if (!ctor) throw new Error('No native ' + name);
  return ctor;
}
```
This let all `newView[i] = x as any` writes become plain assignments (`newView` is now statically `TypedArrayLike`).

## Root Causes / Type Errors Surfaced & Fixed

Removing `any` exposed 3 latent errors (2 pre-existing, 1 introduced by the de-`any`ing itself):

1. **Interface lacks implicit index signature** (`wrapTypedArray`)
   - `ta.__taMeta = meta` failed: `__taMeta` is `{ TypedArrayName: string; [key: string]: unknown }` and TypeScript does not grant interfaces implicit index signatures.
   - Fix: `ta.__taMeta = meta as unknown as NonNullable<JSObjectWithMeta['__taMeta']>;`

2. **`TYPED_ARRAY_NAMES.includes(string)`** (pre-existing, `ArrayBuffer.isView`)
   - `as const` tuple's `.includes()` requires the literal union, not `string`.
   - Fix: `(TYPED_ARRAY_NAMES as readonly string[]).includes(meta.__type_override)`.

3. **Possibly-undefined buffer passed to `wrapTypedArray`** (pre-existing, `subarray`)
   - `parentBuf` was `ArrayBuffer | undefined` but unchecked.
   - Fix: guard extended to `if (!parentView || !parentBuf || !meta) throw …` (also narrows the type).

Also added `byteLength: number` to the local `TypedArrayLike` interface so the `byteLength` getter (`view?.byteLength ?? 0`) typechecks against real typed-array views.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/typed-arrays.ts` | Removed all 60 code-level `as any` casts; typed `getTypedArrayConstructor`; fixed 3 surfaced type errors; added `byteLength` to `TypedArrayLike` |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-08-21-typed-arrays-as-any-cleanup.md` | This change log |

## Test Results

```
npx tsc --noEmit
→ exit 0, 0 errors project-wide

npx vitest run tests/typed-arrays.test.ts
 Test Files  1 passed (1)
      Tests  88 passed (88)

Select-String -Path "src\browser\js\typed-arrays.ts" -Pattern "as any" | Measure-Object | Select-Object -ExpandProperty Count
→ 2   (both are comment lines 14 & 48; 0 in code)
```

## Verification Steps

1. Grepped all `as any` occurrences before editing (62 total incl. comments).
2. Applied per-pattern replacements using existing `readTypedElement`/`writeTypedElement` helpers and `JSObjectWithMeta`/`JSObject` casts.
3. Ran `npx tsc --noEmit` — initially 3 errors in this file; fixed all three; re-ran → exit 0, zero errors project-wide.
4. Ran the dedicated test suite `tests/typed-arrays.test.ts` — 88/88 pass.
5. Re-counted `as any`: 2 (comments only), meeting the "0 or near 0" goal.
