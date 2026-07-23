import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import * as jpeg from 'jpeg-js';
import { ImageDecoder, isSupportedImageType } from '../src/browser/image/decoder';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — generate minimal valid image buffers
// ─────────────────────────────────────────────────────────────────────────────

function createMinimalPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) << 2;
      png.data[idx]     = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function createMinimalJpeg(width: number, height: number, r: number, g: number, b: number): Buffer {
  const frameData = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      frameData[idx]     = r;
      frameData[idx + 1] = g;
      frameData[idx + 2] = b;
    }
  }
  const rawImageData = {
    data: frameData,
    width,
    height,
  };
  return jpeg.encode(rawImageData, 50).data;
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('isSupportedImageType', () => {
  it('should support image/png', () => {
    expect(isSupportedImageType('image/png')).toBe(true);
  });

  it('should support image/jpeg', () => {
    expect(isSupportedImageType('image/jpeg')).toBe(true);
  });

  it('should support image/jpg (normalize to jpeg)', () => {
    expect(isSupportedImageType('image/jpg')).toBe(true);
  });

  it('should support with charset suffix', () => {
    expect(isSupportedImageType('image/png; charset=utf-8')).toBe(true);
  });

  it('should not support image/webp', () => {
    expect(isSupportedImageType('image/webp')).toBe(false);
  });

  it('should not support image/gif', () => {
    expect(isSupportedImageType('image/gif')).toBe(false);
  });

  it('should not support text/html', () => {
    expect(isSupportedImageType('text/html')).toBe(false);
  });
});

describe('ImageDecoder', () => {
  const decoder = new ImageDecoder();

  describe('PNG decoding', () => {
    it('should decode a 1x1 red PNG', async () => {
      const pngBuf = createMinimalPng(1, 1, 255, 0, 0);
      const result = await decoder.decode(new Uint8Array(pngBuf), 'image/png');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(1);
      expect(result!.height).toBe(1);
      expect(result!.data.length).toBe(4);
      expect(result!.data[0]).toBe(255); // R
      expect(result!.data[1]).toBe(0);   // G
      expect(result!.data[2]).toBe(0);   // B
      expect(result!.data[3]).toBe(255); // A
    });

    it('should decode a 4x4 blue PNG', async () => {
      const pngBuf = createMinimalPng(4, 4, 0, 0, 255);
      const result = await decoder.decode(new Uint8Array(pngBuf), 'image/png');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(4);
      expect(result!.height).toBe(4);
      expect(result!.data.length).toBe(4 * 4 * 4);

      // Check all pixels are blue
      for (let i = 0; i < 4 * 4; i++) {
        expect(result!.data[i * 4]).toBe(0);     // R
        expect(result!.data[i * 4 + 1]).toBe(0); // G
        expect(result!.data[i * 4 + 2]).toBe(255); // B
        expect(result!.data[i * 4 + 3]).toBe(255); // A
      }
    });

    it('should handle PNG with ArrayBuffer input', async () => {
      const pngBuf = createMinimalPng(2, 2, 100, 200, 50);
      const arrayBuffer = new Uint8Array(pngBuf).buffer;
      const result = await decoder.decode(arrayBuffer, 'image/png');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(2);
      expect(result!.height).toBe(2);
    });
  });

  describe('JPEG decoding', () => {
    it('should decode a 1x1 red JPEG', async () => {
      const jpegBuf = createMinimalJpeg(1, 1, 255, 0, 0);
      const result = await decoder.decode(new Uint8Array(jpegBuf), 'image/jpeg');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(1);
      expect(result!.height).toBe(1);
      expect(result!.data.length).toBe(4);
      // JPEG is lossy so values won't be exact, but R channel should be dominant
      expect(result!.data[0]).toBeGreaterThan(200); // R
      expect(result!.data[1]).toBeLessThan(50);     // G
      expect(result!.data[2]).toBeLessThan(50);     // B
    });

    it('should decode a 4x4 green JPEG', async () => {
      const jpegBuf = createMinimalJpeg(4, 4, 0, 200, 0);
      const result = await decoder.decode(new Uint8Array(jpegBuf), 'image/jpeg');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(4);
      expect(result!.height).toBe(4);
      expect(result!.data.length).toBe(4 * 4 * 4);
    });
  });

  describe('Error handling', () => {
    it('should return null for unsupported MIME type', async () => {
      const buf = new Uint8Array([1, 2, 3, 4]);
      const result = await decoder.decode(buf, 'image/webp');
      expect(result).toBeNull();
    });

    it('should return null for garbage PNG data', async () => {
      const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      const result = await decoder.decode(garbage, 'image/png');
      expect(result).toBeNull();
    });

    it('should return null for garbage JPEG data', async () => {
      const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
      const result = await decoder.decode(garbage, 'image/jpeg');
      expect(result).toBeNull();
    });

    it('should return null for empty buffer', async () => {
      const result = await decoder.decode(new Uint8Array(0), 'image/png');
      expect(result).toBeNull();
    });

    it('should return null for text/html MIME type', async () => {
      const result = await decoder.decode(new Uint8Array([1, 2, 3]), 'text/html');
      expect(result).toBeNull();
    });
  });

  describe('Edge cases', () => {
    it('should handle MIME type with parameters', async () => {
      const pngBuf = createMinimalPng(1, 1, 0, 0, 0);
      const result = await decoder.decode(new Uint8Array(pngBuf), 'image/png; charset=utf-8');
      expect(result).not.toBeNull();
    });

    it('should handle image/jpg normalization', async () => {
      const jpegBuf = createMinimalJpeg(1, 1, 128, 128, 128);
      const result = await decoder.decode(new Uint8Array(jpegBuf), 'image/jpg');
      expect(result).not.toBeNull();
    });

    it('should decode a large PNG (100x100)', async () => {
      const pngBuf = createMinimalPng(100, 100, 128, 64, 32);
      const result = await decoder.decode(new Uint8Array(pngBuf), 'image/png');

      expect(result).not.toBeNull();
      expect(result!.width).toBe(100);
      expect(result!.height).toBe(100);
      expect(result!.data.length).toBe(100 * 100 * 4);
    });
  });
});
