# src/ Typecheck Cleanup

**Date:** 2026-08-01
**Session:** Fixed every remaining TypeScript error in `src/` (0 remaining in source). 341 errors remain in `tests/` (separate batch).
**Status:** Completed (src only)

---

## Summary
Ran `npx tsc --noEmit` and drove the `src/` error count to zero across rendering, security, media, and UI modules: 10 distinct source files fixed in this session (plus earlier in-session fixes to css-parser, transform-parser, property-definitions). Test files were intentionally left untouched — they still have 341 errors.

## Root Causes (problem → fix)

### 1. Selector stringifier hit `:where()` unhandled
**File:** `src/browser/rendering/css-parser.ts`
**Problem:** `CssPseudoClassSelector` union has a `where` member with `selectors` (no `name`). The else-branch `result += `:${pc.name}`` failed typecheck (`Property 'name' does not exist`).
**Fix:**
```ts
} else if (pc.type === 'where') {
  const inner = pc.selectors.map((s: CssSelector) => selectorToString(s)).join(', ');
  result += `:where(${inner})`;
} else {
  result += `:${pc.name}`;
}
```

### 2. Ternary widened perspective to `number[]`
**File:** `src/browser/rendering/compositing/transform-parser.ts`
**Problem:** `decomposeMatrix` return type requires `perspective: [number, number, number, number]`, but the else branch `[0, 0, 0, 1]` widened the ternary to `number[]`.
**Fix:** `: [0, 0, 0, 1] as [number, number, number, number];`

### 3. Duplicate CSS property definition keys
**File:** `src/browser/rendering/css5/property-definitions.ts`
**Problem:** `cursor` (lines 128 & 195) and `column-gap` (lines 160 & 209) declared twice → TS1117 duplicate key.
**Fix:** Removed the later duplicate entries (Misc block).

### 4. Animation `effect` property was read-only
**File:** `src/browser/rendering/compositing/animation-engine.ts`
**Problem:** `Animation.effect` was `readonly` but reassigned in `reverse()` → TS2540.
**Fix:** Removed `readonly` (kept `timeline` readonly).

### 5. Implicit-any map callback
**File:** `src/browser/rendering/compositing/layer-promoter.ts`
**Problem:** `willChange.split(',').map(s => ...)` → `s` implicitly `any` (TS7006).
**Fix:** `map((s: string) => ...)`.

### 6. ReadonlyMap assigned to mutable Map
**File:** `src/browser/rendering/dom-tree.ts`
**Problem:** `setComputedStyle` receives `ReadonlyMap<string, string>` but assigned directly to `element.computedStyle: Map<string, string>` → TS2739.
**Fix:** `element.computedStyle = new Map(style);`

### 7. HtmlElement passed where MutableElement required
**File:** `src/browser/rendering/html5/shadow.ts`
**Problem:** `getSlotName(slotElement)` where `slotElement` is `HtmlElement` (missing `_shadowRoot`, `_assignedSlot`, `_internals`) → TS2345.
**Fix:** `getSlotName(slotElement as unknown as MutableElement)`.

### 8. ImageData missing `colorSpace`
**File:** `src/browser/rendering/lazy-loader.ts`
**Problem:** Object literal assigned to `el.imageData: ImageData` lacked required `colorSpace` → TS2741.
**Fix:** Added `colorSpace: 'srgb'`.

### 9. ImageData constructor overload mismatch
**File:** `src/browser/rendering/rasterizer.ts`
**Problem:** `this.pixels: Uint8ClampedArray<ArrayBufferLike>` not assignable to `ImageDataArray` (`ArrayBuffer` required) → TS2769.
**Fix:** `new ImageData(this.pixels as unknown as ImageDataArray, this.width, this.height)`.

### 10. Wrong layout config key names
**File:** `src/browser/rendering/reflow-repaint-controller.ts`
**Problem:** Passed `{ width, height }` but `LayoutConfig` declares `viewportWidth`/`viewportHeight` → TS2353.
**Fix:** `{ viewportWidth: this.viewportWidth, viewportHeight: this.viewportHeight }`.

### 11. ApiSurface typo `'notification'`
**File:** `src/browser/security/preload.ts`
**Problem:** Bridge API map key `'notification'` not in `ApiSurface` union (which has `'notifications'`) → TS2769.
**Fix:** `['notifications', ['Notification']]`.

### 12. IBookmarkBar missing `setService`
**File:** `src/ui/components/bookmark-bar/bookmark-bar.ts`
**Problem:** Interface didn't declare `setService` implemented by the class → `browser-window.ts` call failed TS2339.
**Fix:** Added `setService(service: IBookmarkService): void;` to `IBookmarkBar`.

### 13. GPUQuerySetDescriptor undefined + unexported
**File:** `src/browser/media/webgpu.ts`
**Problem:** Used in `IGPUDevice.createQuerySet` and re-exported from `media/index.ts` but never defined/exported → TS2724.
**Fix:**
```ts
interface GPUQuerySetDescriptor {
  readonly type: 'occlusion' | 'timestamp';
  readonly count: number;
}
```
and added `GPUQuerySetDescriptor` to the `export type { ... }` list.

## Files Modified
| File | Change |
|------|--------|
| src/browser/rendering/css-parser.ts | Handle `:where()` pseudo-class in selectorToString |
| src/browser/rendering/compositing/transform-parser.ts | Cast perspective else-branch to 4-tuple |
| src/browser/rendering/css5/property-definitions.ts | Removed duplicate `cursor`, `column-gap` keys |
| src/browser/rendering/compositing/animation-engine.ts | Dropped `readonly` from `Animation.effect` |
| src/browser/rendering/compositing/layer-promoter.ts | Typed `map` callback param `s: string` |
| src/browser/rendering/dom-tree.ts | Copy ReadonlyMap → Map in setComputedStyle |
| src/browser/rendering/html5/shadow.ts | Cast slotElement to MutableElement |
| src/browser/rendering/lazy-loader.ts | Added `colorSpace: 'srgb'` to imageData |
| src/browser/rendering/rasterizer.ts | Cast pixels to ImageDataArray for ImageData ctor |
| src/browser/rendering/reflow-repaint-controller.ts | viewportWidth/viewportHeight config keys |
| src/browser/security/preload.ts | `'notification'` → `'notifications'` ApiSurface |
| src/ui/components/bookmark-bar/bookmark-bar.ts | Added `setService` to IBookmarkBar |
| src/browser/media/webgpu.ts | Defined + exported GPUQuerySetDescriptor |

## Files Created
| File | Purpose |
|------|--------|
| doc/2026-08-01-src-typecheck-cleanup.md | This change log |

## Test Results
```
npx tsc --noEmit
  src/ errors: 0  (was 16 at session start)
  tests/ errors: 341 (untouched this session, separate batch)
```
