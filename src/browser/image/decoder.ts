/**
 * @file src/browser/image/decoder.ts
 *
 * Image decoder that converts binary image data (PNG, JPEG) into raw RGBA
 * pixel data suitable for the rasterizer's drawImage() command.
 *
 * Uses the `pngjs` and `jpeg-js` libraries for format-specific decoding.
 * Unknown or unsupported MIME types produce a synthetic fallback (checkerboard).
 */

import type { PNG } from 'pngjs';
import type * as jpeg from 'jpeg-js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedImage {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** The image's own size when it was rasterized at another (SVG at its display size). */
  readonly naturalWidth?: number;
  readonly naturalHeight?: number;
}

/** The size to rasterize a vector image at, in device pixels. Raster formats ignore it. */
export interface DecodeSize { readonly width: number; readonly height: number }

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED MIME TYPES
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

function normalizeMime(mimeType: string): string {
  const lower = mimeType.toLowerCase().split(';')[0].trim();
  // Normalize image/jpg → image/jpeg
  if (lower === 'image/jpg') return 'image/jpeg';
  return lower;
}

// ─────────────────────────────────────────────────────────────────────────────
// DECODER
// ─────────────────────────────────────────────────────────────────────────────

/** Longest side kept after decoding; bigger images are scaled down to bound memory (8000×4000 RGBA is 128 MB). */
const MAX_DECODED_SIDE = 2048;

interface PlatformBitmap { readonly width: number; readonly height: number; close?(): void }
interface PlatformGlobals {
  createImageBitmap?: (src: unknown, opts?: { resizeWidth?: number; resizeHeight?: number; resizeQuality?: string }) => Promise<PlatformBitmap>;
  OffscreenCanvas?: new (w: number, h: number) => {
    getContext(type: '2d'): { drawImage(img: unknown, x: number, y: number, w?: number, h?: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null;
  };
}

/** Decodes through createImageBitmap + OffscreenCanvas, or returns null where they don't exist or fail. */
async function decodeWithPlatform(bytes: Uint8Array, mime: string, size?: DecodeSize): Promise<DecodedImage | null> {
  const g = globalThis as PlatformGlobals;
  if (typeof g.createImageBitmap !== 'function' || typeof g.OffscreenCanvas !== 'function') return null;
  try {
    const blob = new Blob([bytes as BlobPart], mime ? { type: mime } : undefined);
    if (mime === 'image/svg+xml') return await decodeSvg(blob, g.OffscreenCanvas, size);
    let bitmap: PlatformBitmap | null = await g.createImageBitmap(blob);
    if (!bitmap || !bitmap.width || !bitmap.height) return null;
    const scale = Math.min(1, MAX_DECODED_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1) {
      const resized = await g.createImageBitmap(bitmap, {
        resizeWidth: Math.round(bitmap.width * scale), resizeHeight: Math.round(bitmap.height * scale), resizeQuality: 'high',
      });
      bitmap.close?.();
      bitmap = resized;
    }
    const { width, height } = bitmap;
    const ctx = new g.OffscreenCanvas(width, height).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } catch {
    return null;
  }
}

/**
 * createImageBitmap rejects SVG blobs in Chromium; an <img> decodes them. It is drawn onto a canvas
 * at `size` (its display size × DPR) so the vectors are rasterized sharp: decoded at its intrinsic
 * size and scaled up, Wikipedia's wordmark was a blur.
 */
async function decodeSvg(blob: Blob, Canvas: NonNullable<PlatformGlobals['OffscreenCanvas']>, size?: DecodeSize): Promise<DecodedImage | null> {
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const naturalWidth = img.naturalWidth || 300, naturalHeight = img.naturalHeight || 150; // CSS default object size
    // Scaled up to cover `size`, keeping the SVG's own aspect (a box can still be a placeholder).
    const up = size ? Math.max(1, size.width / naturalWidth, size.height / naturalHeight) : 1;
    const k = up * Math.min(1, MAX_DECODED_SIDE / (Math.max(naturalWidth, naturalHeight) * up));
    const width = Math.max(1, Math.round(naturalWidth * k)), height = Math.max(1, Math.round(naturalHeight * k));
    const ctx = new Canvas(width, height).getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height, naturalWidth, naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface IImageDecoder {
  decode(buffer: Uint8Array | ArrayBuffer, mimeType: string, size?: DecodeSize): DecodedImage | null | Promise<DecodedImage | null>;
}

export class ImageDecoder implements IImageDecoder {
  /**
   * Decode a binary image buffer into RGBA pixel data.
   *
   * @param buffer The raw image bytes (PNG or JPEG).
   * @param mimeType The content type (e.g. "image/png", "image/jpeg").
   * @returns DecodedImage with RGBA data, or null if decoding fails.
   */
  async decode(buffer: Uint8Array | ArrayBuffer, mimeType: string, size?: DecodeSize): Promise<DecodedImage | null> {
    const mime = normalizeMime(mimeType);
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

    // The WebView's own codecs first: every format the platform knows (GIF, AVIF, SVG had no
    // decoder here at all) and far faster than jpeg-js/pngjs on a phone. JS decoders are the
    // fallback where no platform codec exists (Node, tests).
    const native = await decodeWithPlatform(bytes, mime, size);
    if (native) return native;

    if (!SUPPORTED_MIME_TYPES.has(mime)) {
      return null;
    }

    try {

      if (mime === 'image/png') {
        return await this.decodePng(bytes);
      }

      if (mime === 'image/jpeg') {
        return await this.decodeJpeg(bytes);
      }

      if (mime === 'image/webp') {
        return await this.decodeWebp(bytes);
      }

      return null;
    } catch {
      return null;
    }
  }

  private async decodePng(bytes: Uint8Array): Promise<DecodedImage | null> {
    // pngjs is Node-only — lazy import to avoid bundling into browser
    const { PNG } = await import('pngjs');
    // pngjs expects a Node.js Buffer
    const nodeBuffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const png = PNG.sync.read(nodeBuffer);

    return {
      data: new Uint8ClampedArray(png.data),
      width: png.width,
      height: png.height,
    };
  }

  private async decodeJpeg(bytes: Uint8Array): Promise<DecodedImage | null> {
    const jpeg = await import('jpeg-js');
    const raw = jpeg.decode(bytes, { useTArray: true });
    if (!raw || raw.width <= 0 || raw.height <= 0) {
      return null;
    }

    return {
      data: new Uint8ClampedArray(raw.data),
      width: raw.width,
      height: raw.height,
    };
  }

  private async decodeWebp(bytes: Uint8Array): Promise<DecodedImage | null> {
    // Pure-TS decoder — lazy import keeps it out of the initial bundle.
    const { decode } = await import('@stacksjs/ts-webp');
    const raw = decode(bytes);
    if (!raw || raw.width <= 0 || raw.height <= 0) {
      return null;
    }

    return {
      data: new Uint8ClampedArray(raw.data),
      width: raw.width,
      height: raw.height,
    };
  }
}

/**
 * Check if a MIME type is a supported image format.
 */
export function isSupportedImageType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(normalizeMime(mimeType));
}
