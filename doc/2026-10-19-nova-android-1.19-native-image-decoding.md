# Nova Android 1.19 — Images Decoded With the Device's Own Codecs (GIF, SVG, AVIF)

**Date:** 2026-10-19
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 9.
**Status:** Completed. Verified with real codecs in the built-in browser and installed on the user's tablet. The on-screen check is pending, because the user was in a game on the tablet and Nova wasn't brought to the front over it.

---

## Summary
Page images were decoded only by pure-JavaScript decoders:
- `pngjs`, a Node library run through shims;
- `jpeg-js`;
- a WebP decoder.

Every other format had no decoder, so **GIF, SVG and AVIF images stayed blank placeholders**. A MIME pre-filter in the lazy loader dropped them before decoding was even tried. JS-decoding a large JPEG is also slow on a phone.

Images are now decoded with the WebView's own codecs (`createImageBitmap` → `OffscreenCanvas` → pixels). The JS decoders remain only for headless runs and tests. Images whose longest side is over 2048 px are scaled down to bound memory. Nova **1.19** (versionCode 20).

## Root Causes
### 1. No decoder for GIF, SVG or AVIF; slow JS decoding
**File:** `src/browser/image/decoder.ts`
**Problem:** `ImageDecoder.decode` returned `null` for anything outside PNG, JPEG and WebP, and decoded those three in JavaScript.
**Fix:** `decodeWithPlatform(bytes, mime)` runs first wherever `createImageBitmap` and `OffscreenCanvas` exist, which includes the WebView:
- **Decoding:** a `Blob` of the bytes goes through `createImageBitmap`, is drawn on an `OffscreenCanvas`, and comes back as RGBA via `getImageData`. The platform sniffs the bytes, so wrong or missing Content-Types still work.
- **SVG:** Chromium won't build a bitmap from an SVG blob, so `svgToBitmap` decodes it through an `<img>` element first. SVGs without an intrinsic size get the 300×150 CSS default.
- **Size cap:** images over 2048 px on their longest side are resized by the platform (`resizeQuality: 'high'`). An 8000×4000 RGBA image would otherwise take 128 MB.
- **Fallback:** if the platform path is missing or throws, the existing JS decoders run as before.

### 2. MIME filter dropped every other format
**File:** `src/browser/rendering/lazy-loader.ts`
**Problem:** `if (isSupportedImageType(result.contentType))` decided whether to decode at all, so only PNG, JPEG and WebP ever reached the decoder.
**Fix:** the gate is removed, and the decoder decides; it returns `null` when it can't decode. `isSupportedImageType` stays, since it describes the JS decoders and has its own tests.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/image/decoder.ts` | `decodeWithPlatform`, `svgToBitmap`, `MAX_DECODED_SIDE`; tried before the JS decoders |
| `src/browser/rendering/lazy-loader.ts` | MIME pre-filter removed |
| `android/app/build.gradle` | 1.18 (19) → 1.19 (20) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/image-decoder-native.test.ts` | 5 tests with stubbed platform codecs: GIF/AVIF decoded, JPEG through the platform, an 8000×4000 image scaled to 2048×1024, fallback to JS when the platform fails, and no codecs means `null` (not a throw) |
| `doc/2026-10-19-nova-android-1.19-native-image-decoding.md` | This change log |

## Test Results
Before the decoder change, 3 of the new tests failed; the fallback and no-codec cases already passed.
```
npx vitest run tests/image-decoder-native.test.ts -> 5 passed (5)
npx tsc --noEmit                                  -> exit 0
npx vitest run                                    -> 272 files, 10509 passed (10509)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.19.apk                    -> verified (1,523,448 B)
```

## Verification Steps
1. In the built-in browser (real Chromium codecs), ran `ImageDecoder` on real bytes. All five decoded in **122 ms** total:
   | Input | Result |
   |-------|--------|
   | 1×1 GIF | red pixel |
   | 40×20 SVG | blue, 40×20 |
   | 30×10 JPEG made with `convertToBlob` | green |
   | 5000×1000 PNG | scaled to **2048×410** |
   | the JPEG served as `application/octet-stream` | still decoded |
2. **Tablet (OPD2305):** `adb install -r Nova-1.19.apk` gave `Success`, versionName 1.19. The user was playing a game on the tablet, so the install ran in the background and Nova was not opened over the game. The on-screen checks are still pending.

## Known ceilings
- Animated GIFs show their first frame only.
- Images are decoded at most 2048 px on the longest side.

## What's new in Nova 1.19 (user-facing)
- GIF, SVG and AVIF images now show (logos, icons, many photos).
- Photos decode much faster, and very large images no longer risk running the app out of memory.
