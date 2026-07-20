# Image Decoding — PNG & JPEG Support

**Date:** 2026-07-20
**Session:** Image decoding implementation
**Status:** Completed

---

## Summary

Implemented real image decoding (PNG and JPEG) for the Nova Browser. Fixed the network layer to support binary data transfer, added image decoders via `pngjs` and `jpeg-js` libraries, and wired real decoding into the lazy loader pipeline. Images now decode from actual network responses instead of generating synthetic placeholders.

## Root Causes

### 1. Network layer corrupts binary data
**File:** `src/browser/netwroking/request-manager.ts`
**Problem:** `FetchHttpClient.send()` always called `res.text()` for every response, corrupting binary image data by interpreting raw bytes as UTF-8 text
**Fix:** Added binary content-type detection (`image/*`, `font/*`, `audio/*`, `video/*`) — uses `res.arrayBuffer()` for binary content, stores result in new `bodyBinary: Uint8Array | null` field on `HttpResponseSpec`

### 2. Lazy loader never fetched real images
**File:** `src/browser/rendering/lazy-loader.ts`
**Problem:** `loadImage()` generated synthetic checkerboard placeholders via `generateImageData()`, never calling `ResourceLoader.loadImage()`
**Fix:** `LazyLoader.init()` now accepts optional `IResourceLoader` + `baseUrl`. `loadImage()` sets a placeholder immediately, then asynchronously fetches and decodes via `ImageDecoder`. Falls back to placeholder on any failure.

### 3. No image decoder existed
**File:** `src/browser/image/decoder.ts` (new)
**Problem:** Zero image format support — no PNG, JPEG, or any other decoder
**Fix:** Created `ImageDecoder` class using `pngjs` for PNG and `jpeg-js` for JPEG. Returns `DecodedImage` with raw RGBA `Uint8ClampedArray` data ready for the rasterizer.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/image/decoder.ts` | `ImageDecoder` class — decodes PNG/JPEG binary data to RGBA pixels |
| `src/browser/image/index.ts` | Barrel exports for the image module |
| `tests/image-decoder.test.ts` | 20 tests covering PNG/JPEG decode, error handling, edge cases |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/netwroking/request-manager.ts` | Added `bodyBinary: Uint8Array | null` to `HttpResponseSpec`; `FetchHttpClient` uses `res.arrayBuffer()` for binary content |
| `src/browser/netwroking/resource-loader.ts` | Added `bodyBinary: Uint8Array | null` to `ResourceLoadResult`; propagated through all response paths |
| `src/browser/rendering/lazy-loader.ts` | Accepts `IResourceLoader` + `baseUrl` in `init()`; async `loadImageAsync()` fetches + decodes real images; `resolveUrl()` for relative paths |
| `src/browser/engine/page-renderer.ts` | Passes `resourceLoader` and `result.url` to `lazyLoader.init()` |
| `package.json` | Added `pngjs`, `jpeg-js` dependencies and `@types/pngjs`, `@types/jpeg-js` devDependencies |

## Test Results

```
Image decoder tests: 20 passed | 0 failed
Full test suite: 89/90 files passed | 3924/3980 tests passed
(1 pre-existing failure in crash-recovery-isolation.test.ts)
```

## Key Design Decisions

1. **Graceful fallback**: If decoding fails (unsupported format, corrupt data, network error), the synthetic placeholder is kept — images never break the page
2. **Binary detection by MIME type**: `FetchHttpClient` checks `content-type` header for `image/*`, `font/*`, `audio/*`, `video/*` prefixes before deciding text vs binary read
3. **Lazy async loading**: `loadImage()` sets placeholder synchronously (visual feedback), then fires async decode — no blocking of the main thread
4. **URL resolution**: Relative `src` attributes resolved against the page's base URL from `PageLoadResult`
5. **Normalized MIME types**: `image/jpg` → `image/jpeg`, handles charset suffixes like `image/png; charset=utf-8`
