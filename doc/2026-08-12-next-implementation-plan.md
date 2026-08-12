# Next Implementation Plan — Animation Track B · Audit Expansion · Phase 1 Close-Out · Interaction & JS-Mutation Fidelity

**Date:** 2026-08-12
**Session:** Multi-track implementation plan covering the five approved directions (Animation Track B, fidelity audit expansion, Phase 1 close-out, interaction fidelity e2e, JS-driven DOM mutation fidelity).
**Status:** In Progress (approved 2026-08-12; Priority 0 under implementation)

---

## Context (verified 2026-08-12)

- The paint-time animation overlay resolves **opacity only** (`css-animations.ts` `resolveOpacity`; `paint-engine.ts` `_opacityResolver`). The animation engine already interpolates `transform` via `lerpMatrices` (`compositing/animation-engine.ts:81-82`) and the compositor already applies static transforms (`compositing/layer-compositor.ts:262`). Result: the fidelity `animation` fixture's `.slide` `translateX` keyframes parse but **never move** the box — a confirmed gap.
- Phase 1 engine-integration items from `doc/2026-08-08-future-scope-plan.md` are **mostly already done** (per `doc/2026-08-08-phase1-persistence-plugins-deferred.md`): PageLoader/PageRenderer wired, persistent cookie/bookmark/history/sessions/token/password stores in DI, microtask queues, sticky font-size, stacking triggers, PNG/JPEG/WebP decoding, `FontMetricsProvider` registry, deferred navigation. Remaining: `<img>`→paint `drawImage` verification, InMemory base-store inventory, GPU/software parity.
- **Interaction e2e is a real gap:** nothing clicks/hovers/submits through the engine. The audit's `forms` fixture never submits; `electron-smoke` only fills the address bar.
- Baseline: 12/12 fidelity fixtures rendered, 0 console/page errors, `animΔ=1`; full suite 8705/8705; e2e 3/3; tsc + build clean.

## Priorities (0 → 1 → 2)

| Prio | Track | Scope |
|------|-------|-------|
| 0 | Animation Track B | transform overlay, color/background animation, CSS transitions, animation events, lifecycle polish |
| 1 | Fidelity audit expansion | new fixtures + golden pixel baselines |
| 1 | Phase 1 close-out | verification pass (drawImage, store inventory, GPU parity) + roadmap update |
| 2 | Interaction fidelity e2e | click nav, real form submit, back/forward, scroll, hover, hash |
| 2 | JS-driven DOM mutation fidelity | rAF/style-write/mutation/counter fixtures + scheduling tests |

## Priority 0 — Animation Track B

1. **Animated transform overlay**
   - `CssAnimationAnimator.resolveTransform(el): string | null` mirroring `resolveOpacity`, reading `getComputedProperties()['transform']`.
   - `paint-engine.ts`: `setTransformResolver` + `_transformResolver`; applied as a paint-time offset on the software rasterizer path and into the layer matrix on the composited path (reuse `transform-parser` `parseTransform`/`translate3D` and `layer-compositor` static-transform machinery).
   - Wire resolver in `page-renderer.ts` alongside `setOpacityResolver`; self-scheduling via `reflow-repaint-controller` sync step (already drives per-frame repaints).
   - **Software rasterizer constraint:** matrix-less — translate only. Rotate/scale stay on the composited path.
2. **Color/background-color animation**
   - Extend `interpolateProperty` in `animation-engine.ts` to lerp colors for `color`/`background-color`/`border-color` (reuse `lerpColor`).
   - Controller marks elements with active color animations paint-dirty each frame so background repaints; overlay-only — no `computedStyle` mutation (preserves last session's contract).
3. **CSS transitions**
   - New transition engine (in `css-animations.ts` or new `css-transitions.ts`): diff computed style across recalc, spawn overlay `KeyframeEffect` from old→new value with the transition duration/timing, resolve through the same overlay.
   - Requires a style-change hook in the recalc path (controller style recalc → diff snapshot).
4. **Animation events**
   - `animationstart` / `animationiteration` / `animationend` dispatched on the target element from the animator at timeline phase transitions.
   - Infinite animations: no `end`, `iteration` each loop.
5. **Lifecycle polish**
   - Pause tracked animations when the page/tab is hidden; resume on visible.
   - Respect `prefers-reduced-motion` (unit test; the `media` fixture has reduced-motion scope).
6. **Tests + audit**
   - Unit tests: css-animations (transform/color resolve), paint-engine (transform offset emission), compositing (layer matrix), transitions, events.
   - New audit fixture `transform.html`: static 2D transform box + animated translate box; assert a **moving region** via two-frame region-delta (stronger than the current signature-level `animΔ`).

## Priority 1 — Fidelity audit expansion

- New fixtures: `transform`, `color-anim`, `webp`, `gradients` (linear/radial), `sticky`, `rtl`, `canvas2d` (page `<canvas>` through the engine's canvas 2D wrapper), `reduced-motion`.
- Split `images` into `<img>`-only and `background-image`-only isolates to verify the `drawImage` path independently.
- **Golden baselines** (`golden.json`): per-fixture quantized signature + top-color set + non-white/cluster floors. Flag-only drift by default; `AUDIT_STRICT=1` fails on drift. Deterministic software rasterizer keeps signatures stable.
- Report: add expected/drift columns; keep the 0 console/page-error invariant; trim `settleMs` to bound total runtime (~60s for 20 fixtures).

## Priority 1 — Phase 1 close-out (verification pass)

- Verify `<img>` element → paint `drawImage` end-to-end (`paint-engine.ts:528`; `lazy-loader` decode).
- Confirm every `InMemory*` base store (`token/sessions/history/cookie/bookmark`) has a persistent subclass registered in DI (`persistent-stores.ts`).
- GPU vs software rasterizer parity for `drawImage` and animated frames (audit runs software; ensure no GPU drift).
- Fix residual gaps; mark Phase 1 **Completed** in the roadmap doc.

## Priority 2 — Interaction fidelity e2e

- New `tests/e2e/interaction.spec.ts`; refactor the audit's loopback HTTP server + canvas-stats helpers into a shared helper.
- Cases: click-navigation (page A link → page B), **real form submit** (fill input, click Submit → `forms-done.html` green signature), back/forward (committed URL + canvas changes), wheel/`scrollTo` re-render, `:hover` repaint (verify `:hover` support first), anchor hash jump (scroll/canvas change).
- Assertions: canvas signatures, committed URL, 0 console/page errors.

## Priority 2 — JS-driven DOM mutation fidelity

- Fixtures: `rAF.html` (requestAnimationFrame moves a div per frame → frameDelta + region movement), `mutation.html` (createElement/appendChild mid-load), `style-write.html` (`el.style.background` repaints), `counter.html` (textContent ticks → text re-render).
- Unit tests: reflow-repaint scheduling under mutation — dirty subtree → incremental paint only; text changes → correct damage regions; rAF-driven layout changes mark layout-dirty, not just paint-dirty.

## Verification gates (per track)

```
npx tsc --noEmit
npx vitest run <targeted suites>
npx vitest run                     # full suite (8705 baseline)
npm run build:web
AUDIT_FIXTURE=<name> npx playwright test tests/e2e/fidelity-audit.spec.ts
npx playwright test                # full e2e (smoke + keep-alive + fidelity + interaction)
```

After each track: change-log doc in `doc/` + row in `doc/README.md` (AGENTS.md).

## Risks & notes

- Transform rotate/scale not representable in the matrix-less software rasterizer — scope to translate on the software path; document in the change log.
- Golden signatures are flag-only by default to avoid CI flake from text rasterization variance.
- Transitions need style-change diffing; ensure the overlay contract (no `computedStyle` mutation) holds throughout.
- Audit runtime grows with fixtures; use `AUDIT_FIXTURE` env for targeted re-runs.

## Deliverable

This plan document + implementation in the priority order above, each track gated and documented. Progress tracked via change logs under `doc/` (see `doc/README.md`).
