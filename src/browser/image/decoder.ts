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
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED MIME TYPES
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
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
}

/**
 * Check if a MIME type is a supported image format.
 */
export function isSupportedImageType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(normalizeMime(mimeType));
}
