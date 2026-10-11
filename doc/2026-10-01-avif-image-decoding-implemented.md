# AVIF Image Decoding via the Host's Real Rasterizer (Phase 6g)

**Date:** 2026-10-01
**Session:** Direct continuation of the SVG image decoding phase just shipped — same file, same host-delegation pattern, same live-verification methodology. Compared against two other candidates: full GIF animation (confirmed genuinely not small — needs a live-verification spike on two real unknowns plus new per-element animation-scheduling plumbing) and a Permissions settings page (real, but bigger than Profiles was — needs threading a persisted store through the JS-engine binding layer, not just a storage class + UI section).
**Status:** Completed (1 root cause fixed)

---

## Summary

AVIF — the last of the original three "image format gaps" (AVIF/GIF-animation/SVG) — had zero decode support: `SUPPORTED_MIME_TYPES` in `src/browser/image/decoder.ts` had no AVIF entry, so `<img src="x.avif">` always rendered as a placeholder. Unlike SVG (a vector format needing a dedicated `<img>`+`drawImage` decode path, since `createImageBitmap` can't rasterize vector content in this host), AVIF is a raster bitmap codec exactly like GIF — so this phase reuses the existing `decodeViaCanvas()` method as-is, with zero new decode logic.

Live verification — the same discipline that caught a real `createImageBitmap`/SVG incompatibility last phase — came first, not last: a real AVIF test file was generated locally via `sharp` (installed as a scratch dev dependency, not downloaded from any external source) and `createImageBitmap()` was tested directly against it in the dev-preview browser pane before writing any code. It decoded correctly on the first try (requested color `#1e88e5` → decoded `(29,137,228)`, an exact match within AVIF's lossy rounding), confirming the `decodeViaCanvas` path works for AVIF exactly as predicted from Chromium's long-standing (since Chrome 85, 2020) native AVIF support.

## Root Causes

1. **No AVIF entry in `SUPPORTED_MIME_TYPES`, and no decode path for it.** Fixed with a 2-line change: added `'image/avif'` to the supported set and routed it to the existing `decodeViaCanvas()` method (the same one GIF already uses) in `decode()`'s dispatch — no new method needed, unlike SVG.

## Notes

- A debugging detour during live verification: after editing `decoder.ts`, Nova's dev-preview kept showing the placeholder even after a hard reload, and a direct `import('/src/browser/image/decoder.ts')` check in the running page confirmed `isSupportedImageType('image/avif')` was still returning `false` — the on-disk source was correct, but Vite's dev-server cache (`node_modules/.vite`) was serving a stale pre-bundled copy. Clearing that cache and restarting the dev server picked up the change immediately. Not a code bug; noted here only because it cost real time during this session and would otherwise look like a silent regression to a future reader hitting the same stale-cache symptom.
- No other files needed changes — confirmed, same as SVG: `src/browser/rendering/lazy-loader.ts`'s `isSupportedImageType()` check and `src/browser/networking/request-manager.ts`'s binary-content-type detection are both format-agnostic and already flow `image/avif` through correctly.
- No licensing concern: AVIF is AV1-based and royalty-free under the Alliance for Open Media's patent license, unlike e.g. HEVC — host-delegation isn't legally different here from GIF/WebP.
- The real AVIF test file (sharp-encoded, 460 bytes, a solid-color 32×32 square) and the test HTML page were both created under `public/_avif-test/` for same-origin serving during live verification, then deleted afterward — not part of the shipped diff.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/image/decoder.ts` | Added `image/avif` to `SUPPORTED_MIME_TYPES`; routed it to the existing `decodeViaCanvas()` method in `decode()`'s dispatch; updated that method's doc comment to explain why AVIF rides the same path SVG couldn't |
| `tests/image-decoder.test.ts` | +2 tests: `isSupportedImageType('image/avif')`; AVIF decode returns `null` in a test environment with no real decoder (same shape as the existing GIF test — no fake-timer handling needed, since this path has no timeout logic unlike the SVG one) |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-01-avif-image-decoding-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 239/239 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9393/9393 tests (2 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition noted in the last several changelogs.

## Verification Steps

1. Live verification came first, before any code was written: generated a real AVIF file locally via `sharp` and called `createImageBitmap()` on its bytes directly in the dev-preview browser pane, confirming it decodes correctly in this host's Chromium (pixel-exact within AVIF's lossy rounding) before committing to the `decodeViaCanvas` design.
2. Unit tests: `isSupportedImageType('image/avif')` returns `true`; `decode()` returns `null` gracefully for an unparseable buffer in happy-dom, matching the established GIF test pattern.
3. Full end-to-end live verification: served the same real AVIF file from a same-origin test page, navigated Nova's own address bar there, and confirmed the image rendered as the correct solid blue square instead of the placeholder — after working through a Vite dev-cache staleness issue (see Notes) that initially made the fix look like it wasn't working.
4. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
