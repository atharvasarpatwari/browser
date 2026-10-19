/**
 * In a browser/WebView, ImageDecoder uses the platform's codecs (createImageBitmap) before
 * the pure-JS decoders: GIF, AVIF and SVG had no decoder at all, and jpeg-js/pngjs are slow
 * on a phone. The stubs stand in for the WebView's createImageBitmap and OffscreenCanvas.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageDecoder } from '../src/browser/image/decoder';

type Bitmap = { width: number; height: number; close(): void };
let lastBlobType = '';
let resizedTo: { w?: number; h?: number } | null = null;
let decodeFails = false;

function stubPlatform(width: number, height: number): void {
  const g = globalThis as Record<string, unknown>;
  g.createImageBitmap = async (src: Blob | Bitmap, opts?: { resizeWidth?: number; resizeHeight?: number }): Promise<Bitmap> => {
    if (src instanceof Blob) {
      lastBlobType = src.type;
      if (decodeFails) throw new Error('The source image could not be decoded.');
      return { width, height, close() {} };
    }
    resizedTo = { w: opts?.resizeWidth, h: opts?.resizeHeight };
    return { width: opts?.resizeWidth ?? width, height: opts?.resizeHeight ?? height, close() {} };
  };
  g.OffscreenCanvas = class {
    constructor(public width: number, public height: number) {}
    getContext() {
      const { width, height } = this;
      return {
        drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4).fill(7), width, height }),
      };
    }
  };
}

describe('native image decoding (WebView)', () => {
  beforeEach(() => { lastBlobType = ''; resizedTo = null; decodeFails = false; });
  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.createImageBitmap;
    delete g.OffscreenCanvas;
  });

  it('decodes formats the JS decoders never handled (GIF, AVIF)', async () => {
    stubPlatform(3, 2);
    for (const mime of ['image/gif', 'image/avif']) {
      const img = await new ImageDecoder().decode(new Uint8Array([1, 2, 3]), mime);
      expect(img).toMatchObject({ width: 3, height: 2 });
      expect(img!.data.length).toBe(3 * 2 * 4);
      expect(lastBlobType).toBe(mime);
    }
  });

  it('uses the native codec for JPEG too (much faster than jpeg-js)', async () => {
    stubPlatform(4, 4);
    const img = await new ImageDecoder().decode(new Uint8Array([0xff, 0xd8]), 'image/jpeg; charset=binary');
    expect(img?.width).toBe(4);
    expect(lastBlobType).toBe('image/jpeg');
  });

  it('scales very large images down (longest side 2048) to bound memory', async () => {
    stubPlatform(8000, 4000);
    const img = await new ImageDecoder().decode(new Uint8Array([1]), 'image/png');
    expect(resizedTo).toEqual({ w: 2048, h: 1024 });
    expect(img).toMatchObject({ width: 2048, height: 1024 });
  });

  it('falls back to the JS decoders when the platform cannot decode', async () => {
    stubPlatform(1, 1);
    decodeFails = true;
    // Not a real PNG either: both paths fail, and decode reports null instead of throwing.
    expect(await new ImageDecoder().decode(new Uint8Array([1, 2, 3]), 'image/png')).toBeNull();
  });
});

describe('without platform codecs (Node/tests)', () => {
  it('still rejects unknown formats instead of throwing', async () => {
    expect(await new ImageDecoder().decode(new Uint8Array([1]), 'image/gif')).toBeNull();
  });
});
