# Animation Fidelity Flip: animΔ 0 → 1

**Date:** 2026-08-12
**Session:** Final debugging of the CSS-animation fidelity audit — the red `.anim` div vanished once animated opacity forced stacking-context grouping, leaving `animΔ=0`; root cause found and fixed, audit now reports `animΔ=1`.
**Status:** Completed

---

## Summary
The fidelity audit's `animation` fixture rendered the red `.anim` div correctly for the first two frames, then the fill vanished (pure white) once animated opacity dropped enough to force opacity-grouping of the element's stacking context. Investigation proved the paint command stream and software rasterizer were both correct, then isolated the bug to a stale stacking-context cache: `paintIncremental` rebuilds the stacking tree every frame, but `ctx.bgCommands` was only repopulated on a cold `getElementPaintCommands` call, so warm-cache elements rendered nothing after the second frame. The audit now detects the live animation (`animΔ=1`, `frameDeltaClusters: 1`) with zero console/page errors.

## Root Causes

### 1. `bgCommands` never repopulated on warm-cache stacking contexts
**File:** `src/browser/rendering/paint-engine.ts`
**Problem:** `paintIncremental()` rebuilds `this.stackingTree` (fresh `StackingContext` objects with `bgCommands: []`) on every frame. `getElementPaintCommands()` returned early on a cache hit (`if (cached) return cached;`) *before* the `ctx.bgCommands = commands` sync, so `bgCommands` was only populated during cold recompute (initial `paint()`, or when an element was marked paint-dirty). An `opacity`-animated element like `.anim` is never paint-dirty (opacity lives on the stacking-context group, not in repainted commands), so from frame 3 onward its child context painted `bgCommands: []` → nothing. A `transform`-animated sibling (`.slide`) stayed visible only because its geometry changes every frame keep it cold/dirty.

Evidence chain:
- `ctxCommands` stream head/tail showed the red `fillRect(8,107.84,100,100)` in frames 1–2 only; the `render group` debug (bgCommands.length > 0) fired in frame 2 only.
- `getElementPaintCommands(.anim)` reported `cacheHit=true bgColor=#f00` every frame — cached commands contained the fill, but no paint path emitted them.
- Isolation test (`Rasterizer` + `save/setGlobalAlpha(0.998)/fillRect/restore`) produced `pixel@50,150={255,0,0}` — rasterizer was never the problem.

**Fix:** Extracted `syncStackingBgCommands(node, commands)` and call it on *both* cache hit and cold compute:

```ts
private getElementPaintCommands(node: DomElement): PaintCommand[] {
  const cached = this.elementCommands.get(node);
  if (cached) {
    this.syncStackingBgCommands(node, cached);
    return cached;
  }
  // ...compute...
  this.elementCommands.set(node, commands);
  this.syncStackingBgCommands(node, commands);
  return commands;
}

private syncStackingBgCommands(node: DomElement, commands: PaintCommand[]): void {
  if (this.stackingTree) {
    const ctx = this.findStackingContext(this.stackingTree, node);
    if (ctx) ctx.bgCommands = commands;
  }
}
```

`buildFlatLayers()` (called from both `paint()` and `paintIncremental()`) walks every element through `paintElement()` → `getElementPaintCommands()`, so each frame's fresh contexts get their `bgCommands` re-synced from the (cheap, cached) command arrays. The group wrapper in `renderStackingContext` then applies `setGlobalAlpha(groupOpacity)` correctly.

### 2. (Earlier in session) legacy parser pipe dropped `@keyframes`
**File:** `src/browser/rendering/css-parser.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** `buildCss5Stylesheet` (page-renderer.ts:521) converted legacy `CssRule[]` to style rules only, silently dropping `@keyframes`, so the runtime animator saw no keyframes (initial `animΔ=0`).
**Fix:** `CssRule` gained `keyframes?: { name, frames: CssKeyframeDecl[] }`; `convertRule` emits a keyframes pseudo-rule (`selector: ''`) instead of dropping it; `computeStylesForElement` skips those entries; `buildCss5Stylesheet` re-emits them as `type: 'keyframes'`. `_lastStylesheet` now set eagerly in `applyComputedStyles`/`recalcStylesIncremental`.

### 3. (Earlier in session) canvas replaced per animation frame
**File:** `src/ui/components/content-renderer/content-renderer.ts`, `src/ui/components/navigation-fetcher.ts`
**Problem:** `pageRepainted` fired every animation frame and `renderFromImageData` recreated the canvas via `innerHTML=''`, detaching the DOM element mid-capture → audit error `locator.screenshot: Element is not attached to the DOM`.
**Fix:** `renderFromImageData(imageData, freshCanvas = false)` reuses the existing canvas (resize + `putImageData` in place) unless `freshCanvas` is requested; `pageLoadReady` → `renderFromEngine(session, true)`, `pageRepainted` → `renderFromEngine(session, false)`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/paint-engine.ts` | `syncStackingBgCommands` helper; bgCommands re-synced on cache hit so per-frame stacking contexts paint grouped opacity fills |
| `src/browser/rendering/css-parser.ts` | Legacy `CssRule` carries `@keyframes`; `convertRule` emits keyframes pseudo-rule; `computeStylesForElement` skips them |
| `src/browser/engine/page-renderer.ts` | `buildCss5Stylesheet` re-emits `@keyframes`; `_lastStylesheet` set eagerly |
| `src/ui/components/content-renderer/content-renderer.ts` | `renderFromImageData(imageData, freshCanvas = false)` in-place canvas reuse |
| `src/ui/components/navigation-fetcher.ts` | fresh canvas on `pageLoadReady`, in-place update on `pageRepainted` |

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/rendering/css-animations.ts` | (from earlier sessions) unified CSS/WAAPI animation engine — retained, not changed this session |

## Debug Scaffolding Removed (this session)
- `[anim-debug]` `console.log`s removed from: `navigation-fetcher.ts`, `paint-engine.ts` (compositeFrame stream dumps), `formatting/stacking.ts` (createContext + render group), `css-animations.ts` (sync), `page-renderer.ts` (keyframes).
- Deleted temporary `tests/scratch-anim-debug.test.ts` and `tests/scratch-rasterizer.test.ts`.

## Test Results
```
npx tsc --noEmit                              → exit 0
npx vitest run tests/css-animations.test.ts tests/rasterizer.test.ts
  → 2 files, 67 passed
npx vitest run (6 render-related suites)      → 212 passed
npx vitest run                                → 191 files, 8705 passed / 0 failed
npm run build:web                             → clean (chunk-size warning only)
AUDIT_FIXTURE=animation (e2e)                 → 1 passed
npx playwright test fidelity-audit.spec.ts    → 1 passed (27.2s), all 12 fixtures rendered,
                                               0 console errors, 0 page errors
npx playwright test (full e2e)                → 3 passed (35.5s)
```

Audit report (`fidelity-report/report.json`, `report.md`):
```
| animation | rendered | 137ms | 1920x1080 | 0.0047 | 7 | ... | 0/0 | | animΔ=1 |
frameDeltaClusters: 1   (was 0 before this session)
topColors include #381818 (dimmed red div at animated opacity) — fill now present every frame
```

## Verification Steps
1. Confirmed the software rasterizer handles the exact grouped command sequence (save → setGlobalAlpha → red fillRect → restore) in an isolation test.
2. Pixel-region map of the `.anim` box (`y=105..215, x=0..115`) showed `R` fills for frames 1–2 and all-white from frame 3 before the fix; all-`R` every frame after.
3. After removing all debug scaffolding, re-ran the full unit suite (8705/8705), full fidelity audit (12/12 rendered, zero errors, `animΔ=1`), and full Electron e2e (3/3).
