# SVG Image Decoding via the Host's Real Rasterizer (Phase 6f)

**Date:** 2026-10-01
**Session:** Next Phase 6 "smaller polish" slice after HTTP Cache Correctness Fixes. Investigation compared this against a disk-backed HTTP cache (real but riskier — `CacheEntry` doesn't serialize to JSON for free, and eviction logic mutates the store directly across 6 call sites) and SameSite cookie enforcement (re-verified as still genuinely bigger — `ResourceLoader.pageOrigin`/`setCors()` have zero real callers today, and `fetch()`/`XMLHttpRequest` still bypass `CookieJar` entirely). SVG won as the clear next phase: smaller than a prior session's "medium, needs a path-data parser" characterization suggested, and it fixes a real, demoable bug.
**Status:** Completed (1 root cause fixed)

---

## Summary

`<img src="x.svg">` rendered as a permanent gray placeholder forever — `SUPPORTED_MIME_TYPES` in `src/browser/image/decoder.ts` had no SVG entry, so `isSupportedImageType()` always rejected it and `lazy-loader.ts` never attempted a decode. A prior investigation assumed fixing this needed a custom SVG path-data parser (`d` attribute tokenizer) built on Nova's own `CanvasRenderingContext2D` scanline rasterizer — "medium, not small" work. Direct follow-up reading found a much smaller real fix: `decoder.ts` already has a `decodeViaCanvas()` escape hatch built for exactly this situation (a format with no JS decoder here — currently used for GIF), which defers to the host's own real browser rasterizer via `createImageBitmap`/`OffscreenCanvas` rather than reimplementing one.

Live verification (the actual point of doing this before committing further) caught a real gap in that plan: `createImageBitmap(svgBlob)` throws `InvalidStateError: The source image could not be decoded` in this host's Chromium build, confirmed via a direct test in the dev-preview browser pane — `createImageBitmap`'s SVG support is inconsistent across engines in a way GIF's is not. A second direct test in the same session confirmed the real, working alternative: `new Image()` + `drawImage()` rasterizes the identical SVG correctly (verified pixel-exact: the SVG's `#1e88e5` fill decoded to RGB `(30, 136, 229)`, an exact match). The shipped fix uses that path instead.

## Root Causes

1. **No SVG entry in `SUPPORTED_MIME_TYPES`, and no decode path for it.** Fixed by adding `'image/svg+xml'` to the supported set and a new `decodeSvgViaImage()` method — `Blob` → object URL → `new Image()` → `drawImage()` onto an `OffscreenCanvas` → `getImageData()`. Scoped to external `.svg` files loaded via `<img src>`, decoded once to a static bitmap at load time, exactly like GIF's existing "first frame only, not full animation" scoping. Inline `<svg>...</svg>` as live, CSS-stylable DOM content is a separate, much larger problem (the HTML5 tree-builder's SVG foreign-content/namespace handling exists but is dead code — the mode dispatcher never checks "in foreign namespace") and is not attempted here.

## Notes

- Deliberately not `createImageBitmap`-based like the existing GIF path (`decodeViaCanvas()`) — confirmed via live testing in the dev-preview pane that `createImageBitmap(svgBlob)` throws in this host's Chromium build even for a well-formed SVG with explicit width/height, while `new Image()` + `drawImage()` correctly rasterizes the same file. This is the reason the two formats got separate decode methods instead of sharing one.
- `decodeSvgViaImage()` has a 5s timeout around the `img.onload`/`onerror` wait — found necessary because happy-dom (the test environment) exposes `Image`/`OffscreenCanvas` as real functions but doesn't actually decode blob: URLs, so neither event ever fires without a safety net. This also defends the real implementation against a genuinely malformed SVG that triggers neither callback in a real browser, not just a test-environment quirk.
- Decoding as an image source (not navigating to the SVG) means embedded `<script>`/event handlers never execute — the same safety guarantee a real `<img src="*.svg">` gets in any browser, inherited for free by routing through the host's own mechanism rather than reimplementing one.
- No changes needed to `lazy-loader.ts` or `request-manager.ts`: `isSupportedImageType()` picks up the new mime automatically, and binary-body detection (`contentType.startsWith('image/')`) already covers `image/svg+xml`, so raw SVG bytes already arrived as `bodyBinary` correctly before this phase.
- Live verification surfaced a separate, pre-existing, out-of-scope gap: the test page's `img.addEventListener('load', ...)` never fired even though the image visibly rendered correctly, meaning Nova's `<img>` `load`-event dispatch to page JS has its own bug unrelated to decoding. Noted here for visibility, not fixed — this phase is scoped to decode correctness, confirmed via the actual rendered pixels, not event wiring.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/image/decoder.ts` | Added `image/svg+xml` to `SUPPORTED_MIME_TYPES`; new `decodeSvgViaImage()` method (Image+drawImage, with a 5s safety timeout) routed from `decode()` |
| `tests/image-decoder.test.ts` | +2 tests: `isSupportedImageType('image/svg+xml')`; SVG decode returns `null` in a test environment with no real decoder (fake timers skip the real 5s wait) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-01-svg-image-decoding-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 239/239 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9391/9391 tests (2 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition noted in the last several changelogs.

## Verification Steps

1. Unit tests: `isSupportedImageType('image/svg+xml')` returns `true`; `decode()` returns `null` gracefully (not a hang) in an environment without a real image decoder, confirmed via fake timers rather than a real 5-second wait.
2. Live dev-preview verification (the decisive check — this is what caught the `createImageBitmap` incompatibility before it shipped): served a real two-shape SVG (`#1e88e5` rect + `#ffeb3b` circle) from a same-origin test page (Vite's `public/` directory, cleaned up afterward — a cross-origin `http-server` was tried first and correctly blocked by real CORS, confirming the resource loader's CORS enforcement is also working as expected), navigated Nova's own address bar to it, and confirmed the image rendered with the correct colors and shapes instead of the gray placeholder box. Directly verified in the same browser context beforehand that `createImageBitmap(svgBlob)` throws while `new Image()`+`drawImage()` succeeds pixel-exact, which is what drove the implementation's actual design.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
