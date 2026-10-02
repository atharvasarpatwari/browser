/**
 * @file src/browser/image/decoder.ts
 *
 * Image decoder that converts binary image data (PNG, JPEG, WebP, GIF) into
 * raw RGBA pixel data suitable for the rasterizer's drawImage() command.
 *
 * Uses the `pngjs` and `jpeg-js` libraries for format-specific decoding, plus
 * the renderer's native createImageBitmap() for GIF (first frame only — no
 * JS GIF decoder here). Unknown or unsupported MIME types produce a
 * synthetic fallback (checkerboard).
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
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED MIME TYPES
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
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

export interface IImageDecoder {
  decode(buffer: Uint8Array | ArrayBuffer, mimeType: string): DecodedImage | null | Promise<DecodedImage | null>;
}

export class ImageDecoder implements IImageDecoder {
  /**
   * Decode a binary image buffer into RGBA pixel data.
   *
   * @param buffer The raw image bytes (PNG or JPEG).
   * @param mimeType The content type (e.g. "image/png", "image/jpeg").
   * @returns DecodedImage with RGBA data, or null if decoding fails.
   */
  async decode(buffer: Uint8Array | ArrayBuffer, mimeType: string): Promise<DecodedImage | null> {
    const mime = normalizeMime(mimeType);

    if (!SUPPORTED_MIME_TYPES.has(mime)) {
      return null;
    }

    try {
      const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;

      if (mime === 'image/png') {
        return await this.decodePng(bytes);
      }

      if (mime === 'image/jpeg') {
        return await this.decodeJpeg(bytes);
      }

      if (mime === 'image/webp') {
        return await this.decodeWebp(bytes);
      }

      if (mime === 'image/gif' || mime === 'image/avif') {
        return await this.decodeViaCanvas(bytes, mime);
      }

      if (mime === 'image/svg+xml') {
        return await this.decodeSvgViaImage(bytes, mime);
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

  /**
   * Decode via the renderer's own native image decoder (createImageBitmap +
   * canvas), for formats with no JS decoder here. GIF is the original
   * real-world case — real sites lean on it for tiny spacer/icon images
   * (e.g. Hacker News), and hand-rolling LZW/GIF decoding to match
   * pngjs/jpeg-js's approach would just re-implement what Chromium already
   * does correctly. Only the first frame of an animated GIF is decoded —
   * animation is a separate feature. AVIF rides the same path (unlike SVG,
   * it's a raster bitmap codec, not vector content, so it doesn't hit the
   * createImageBitmap-can't-rasterize-vectors gap SVG did) — confirmed live
   * via a real sharp-encoded test file: createImageBitmap(aviBlob) decodes
   * correctly in this host's Chromium, no separate decode path needed.
   */
  private async decodeViaCanvas(bytes: Uint8Array, mimeType: string): Promise<DecodedImage | null> {
    if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
      return null;
    }
    // Bytes here always come from our own fetch pipeline (never a
    // SharedArrayBuffer view), so this is safe at runtime; cast needed
    // because Uint8Array's backing buffer is typed ArrayBufferLike.
    const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return {
        data: imageData.data,
        width: bitmap.width,
        height: bitmap.height,
      };
    } finally {
      bitmap.close();
    }
  }

  /**
   * Decode SVG via the renderer's own real <img>/drawImage pipeline, rather
   * than hand-writing a second SVG path-data parser — the host's own
   * rasterizer already parses/paints SVG correctly, and since it's decoded
   * as an image source rather than navigated to, embedded <script>/event
   * handlers never execute (the same guarantee a real <img src="*.svg">
   * gets in any browser). Inline <svg> as live, stylable DOM content is a
   * separate, much larger problem this does not attempt.
   *
   * Deliberately NOT createImageBitmap()-based like decodeViaCanvas() above
   * — confirmed via live testing that createImageBitmap(svgBlob) throws
   * InvalidStateError ("source image could not be decoded") in this host's
   * Chromium build, even for a well-formed SVG with explicit width/height.
   * <img> + drawImage() is the real, verified-working path for rasterizing
   * SVG; createImageBitmap's SVG support is inconsistent across engines in
   * a way GIF's is not.
   */
  private async decodeSvgViaImage(bytes: Uint8Array, mimeType: string): Promise<DecodedImage | null> {
    if (typeof Image !== 'function' || typeof OffscreenCanvas !== 'function') {
      return null;
    }
    const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      // A 5s timeout guards against a host whose Image implementation never
      // fires onload/onerror for a blob: URL (confirmed happy-dom does this
      // for real SVG content in tests — it has Image/OffscreenCanvas as
      // real functions but doesn't actually decode anything).
      const loaded = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        img.onload = () => { clearTimeout(timer); resolve(true); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = url;
      });
      if (!loaded || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null;

      const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.naturalWidth, img.naturalHeight);
      return {
        data: imageData.data,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    } finally {
      URL.revokeObjectURL(url);
    }
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
