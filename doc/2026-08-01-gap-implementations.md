# Gap Implementations — Reflow Wiring, Stacking Triggers, Sticky Font-Size, WebP

**Date:** 2026-08-01
**Session:** Implement 4 of the 5 source-level gaps found in the protocols-and-rendering inventory (ReflowRepaintController dead code, no WebP, hardcoded sticky font-size, missing will-change stacking trigger).
**Status:** Completed

---

## Summary
Wired the previously dead `ReflowRepaintController` into the production `PageRenderer`, added the missing `will-change` stacking-context trigger to `render-tree.ts`, replaced the hardcoded `fontSize = 16` in sticky recomputation with real computed-style resolution, and added WebP decoding via the pure-TS `@stacksjs/ts-webp` package. All targeted tests pass (394 across 8 suites); the only `tsc` errors remaining are the 10 pre-existing `src/browser/js/` ones.

## Root Causes

### 1. ReflowRepaintController was dead code
**File:** `src/browser/rendering/reflow-repaint-controller.ts` / `src/browser/engine/page-renderer.ts`
**Problem:** The controller was defined and unit-tested but never instantiated in production. `BrowserEngine` rendered pages through `PageRenderer.render()`, which did a full `layout()` + `paint()` and then discarded everything — the incremental invalidation/scheduling machinery was unreachable. DOM mutations created by JS bindings (which set `_dirtyStyle/_dirtyLayout/_dirtyPaint` on new nodes) never triggered incremental reflow.
**Fix:** `PageRenderer` now creates a `ReflowRepaintController` after the initial paint in `initReflowController(doc)` (page-renderer.ts:141):
```ts
private initReflowController(doc: DomDocument): void {
  const { domTree, layoutEngine, paintEngine } = this.deps;
  this.reflowController?.dispose();
  const controller = new ReflowRepaintController(layoutEngine, paintEngine, domTree, {
    viewportWidth: 1920,
    viewportHeight: 1080,
  });
  controller.init(doc);
  controller.setStyleRecalcCallback(() => this.recalcStylesIncremental());
  const compositor = (paintEngine as { getLayerCompositor?: () => LayerCompositor | null }).getLayerCompositor?.();
  if (compositor) controller.setLayerCompositor(compositor);
  this.reflowController = controller;
}
```
New public API: `getReflowController()` and `requestReflow()` (invalidates the document root + coalesces a frame). `dispose()` now disposes the controller.

### 2. Missing `will-change` stacking-context trigger
**File:** `src/browser/rendering/render-tree.ts:49-55`
**Problem:** `buildRenderObject()` created a stacking context for `filter`, `transform`, `opacity < 1`, fixed/sticky, positioned+z-index, `mix-blend-mode`, and `isolation` — but not `will-change`. `formatting/stacking.ts` already handled `will-change` (transform/opacity/paint), so the render-object path disagreed with the stacking-context-tree path (same element could be promoted to a layer without being treated as a stacking context).
**Fix:** Added a `willChangeSc` check (transform/opacity/paint/filter):
```ts
const willChange = style.get('will-change');
const willChangeSc = willChange !== undefined && willChange !== 'auto'
  && willChange.split(',').map((s: string) => s.trim().toLowerCase())
    .some((p: string) => p === 'transform' || p === 'opacity' || p === 'paint' || p === 'filter');
const scCtx = hasFilter || hasTransform || willChangeSc || opacity < 1 || ...
```

### 3. Sticky `fontSize` hardcoded to 16
**File:** `src/browser/rendering/positioning.ts:391`
**Problem:** `StickyController.recomputeOne()` used `const fontSize = 16; // TODO: resolve from style`, so `top: 2em` on a sticky element resolved as `32px` regardless of the element's actual font-size.
**Fix:** Added an exported `resolveFontSize(style)` helper (handles px/em/rem, CSS keyword sizes, numeric fallbacks, default 16) and replaced the constant:
```ts
const fontSize = resolveFontSize(style);
```

### 4. No WebP decoding
**File:** `src/browser/image/decoder.ts`
**Problem:** Only `image/png`, `image/jpeg`, `image/jpg` were in `SUPPORTED_MIME_TYPES`; `image/webp` returned `null`. `tests/image-decoder.test.ts:63-65` even asserted webp was unsupported.
**Fix:** Added `image/webp` to the set and a `decodeWebp()` path using the pure-TS decoder (lazy `await import('@stacksjs/ts-webp')` — no Node builtins, so it respects the Vite externalization rule):
```ts
private async decodeWebp(bytes: Uint8Array): Promise<DecodedImage | null> {
  const { decode } = await import('@stacksjs/ts-webp');
  const raw = decode(bytes);
  if (!raw || raw.width <= 0 || raw.height <= 0) return null;
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}
```

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | Import ReflowRepaintController + LayerCompositor; create/init controller after paint; `getReflowController()`, `requestReflow()`; dispose controller |
| `src/browser/rendering/render-tree.ts` | Added `will-change` (transform/opacity/paint/filter) stacking-context trigger |
| `src/browser/rendering/positioning.ts` | Added `resolveFontSize()`; sticky recompute now uses it (was hardcoded 16) |
| `src/browser/image/decoder.ts` | `image/webp` in SUPPORTED_MIME_TYPES + `decodeWebp()` via `@stacksjs/ts-webp` |
| `package.json` / `package-lock.json` | Added `@stacksjs/ts-webp@0.1.2` dependency |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-08-01-gap-implementations.md` | This change log |

## Test Files Modified
| File | Change |
|------|--------|
| `tests/image-decoder.test.ts` | `image/webp` now supported; added WebP decode round-trip tests (1x1 red, 4x4 green, ArrayBuffer input); moved "unsupported MIME" test to `image/gif` |
| `tests/positioning.test.ts` | Added sticky suite: `top: 2em` resolves against element font-size (10px → 20px); stays at flow position pre-threshold |
| `tests/render-paint-enhanced.test.ts` | Added will-change stacking-context tests (transform, opacity+filter, color=no) + transform test |
| `tests/page-renderer.test.ts` | Added: controller wired after paint; `requestReflow()` schedules a frame |

## Test Results
```
# Targeted suites (all green):
npx vitest run tests/image-decoder.test.ts tests/page-renderer.test.ts tests/stacking.test.ts tests/render-paint-enhanced.test.ts
#   ✓ 4 files / 161 tests passed

npx vitest run tests/positioning.test.ts tests/render-paint-enhanced.test.ts tests/image-decoder.test.ts
#   ✓ 3 files / 156 tests passed

npx vitest run tests/page-renderer.test.ts
#   ✓ 1 file / 24 tests passed

npx vitest run tests/reflow-repaint.test.ts tests/style-invalidation.test.ts tests/integration.test.ts tests/css-animation-integration.test.ts tests/memory-management.test.ts
#   ✓ 5 files / 104 tests passed

# Full suite (regression baseline):
npx vitest run
#   176 passed files, 8417 tests passed; 6 failed files / 7 failed tests
#   The 7 failures (bytecode-vm undefined semantics, js-builtins structuredClone null, worker undefined,
#   download-manager sort timestamp, networking DNS localhost, rasterizer alpha 255) were confirmed
#   IDENTICAL on git HEAD via `git stash` — pre-existing, unrelated to this session.

# Typecheck (no new errors):
npx tsc --noEmit
#   10 errors, all pre-existing in src/browser/js/* (interpreter/vm/values/web-apis/websocket-api)

# Vite production build (webp lib bundles cleanly):
npm run build:web
#   ✓ built in 1.39s — dist-CL77qzGg.js (49.75 kB) holds the webp decoder chunk
```

## Verification Steps
1. `npm install @stacksjs/ts-webp@0.1.2` (pure TS ESM, zero native deps, no Node builtins at module scope — verified by scanning `dist/*.js` for `node:`/`require(`).
2. Ran each targeted vitest suite above — all pass.
3. Ran full `npx vitest run` and diffed failures against `git stash` baseline at HEAD — identical 7 pre-existing failures.
4. `npx tsc --noEmit` — only the 10 known `src/browser/js/` errors remain.
5. `npm run build:web` — production Vite build succeeds with the new dynamic-imported decoder chunk.
