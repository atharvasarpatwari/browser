/**
 * Page text is drawn with the device's real font through a canvas coverage mask
 * (text-raster.ts). Before 1.16 every run came from an 8x8 ASCII bitmap font, so
 * Arabic/CJK/Cyrillic text and accented letters were blank on the phone.
 *
 * The stub canvas "draws" each character as a solid 10x8 box above the baseline,
 * which is enough to check placement, colour, clipping, alignment and caching.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rasterizer } from '../src/browser/rendering/rasterizer';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';
import { rasterizeTextRun, resetTextRaster } from '../src/browser/rendering/text-raster';

const GLYPH_W = 10;
const GLYPH_H = 8;
let fillTextCalls = 0;

class StubCanvas {
  width = 1;
  height = 1;
  private drawn: { text: string; x: number; y: number } | null = null;
  getContext() {
    const self = this;
    return {
      font: '', fillStyle: '', textBaseline: '',
      measureText: (t: string) => ({ width: [...t].length * GLYPH_W, actualBoundingBoxAscent: GLYPH_H, actualBoundingBoxDescent: 2 }),
      fillText(text: string, x: number, y: number) { fillTextCalls++; self.drawn = { text, x, y }; },
      getImageData(_x: number, _y: number, w: number, h: number) {
        const data = new Uint8ClampedArray(w * h * 4);
        const d = self.drawn;
        if (d) {
          for (let py = Math.max(0, d.y - GLYPH_H); py < d.y; py++) {
            for (let px = d.x; px < Math.min(w, d.x + [...d.text].length * GLYPH_W); px++) data[(py * w + px) * 4 + 3] = 255;
          }
        }
        return { data };
      },
    };
  }
}

const cmd = (type: string, ...params: unknown[]): PaintCommand => ({ type, params } as PaintCommand);
const pixel = (r: Rasterizer, x: number, y: number) => {
  const d = r.getImageData();
  const i = (y * d.width + x) * 4;
  return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]];
};
const draw = (text: string, extra: PaintCommand[] = [], x = 20, y = 30) => {
  const r = new Rasterizer({ width: 200, height: 60 });
  r.rasterize([cmd('setFillStyle', 'rgb(200, 0, 0)'), cmd('setFont', '16px sans-serif'), ...extra, cmd('fillText', text, x, y)]);
  return r;
};

describe('text drawn with the real font (canvas mask)', () => {
  beforeEach(() => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = StubCanvas;
    resetTextRaster();
    fillTextCalls = 0;
  });
  afterEach(() => {
    delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
    resetTextRaster();
  });

  it('paints the run in its colour at the pen position, glyphs sitting on the baseline', () => {
    const r = draw('Hi');
    expect(pixel(r, 21, 26)).toEqual([200, 0, 0, 255]);      // inside the first glyph
    expect(pixel(r, 20 + 2 * GLYPH_W + 2, 26)[0]).toBe(255);  // past the run: background
    expect(pixel(r, 21, 31)[0]).toBe(255);                    // below the baseline: background
  });

  it('draws scripts the bitmap font could not (Arabic, CJK, Cyrillic, accents)', () => {
    for (const text of ['مرحبا', '该域名', 'Данный', 'réservé']) {
      expect(pixel(draw(text), 21, 26)).toEqual([200, 0, 0, 255]);
    }
  });

  it('honours the clip rect and text-align', () => {
    const clipped = draw('Hello', [cmd('clip', 0, 0, 25, 60)]);
    expect(pixel(clipped, 22, 26)[0]).toBe(200);
    expect(pixel(clipped, 30, 26)[0]).toBe(255);
    const centred = draw('Hi', [cmd('setTextAlign', 'center')], 100);
    expect(pixel(centred, 100 - GLYPH_W + 1, 26)[0]).toBe(200);
    expect(pixel(centred, 100 + GLYPH_W + 2, 26)[0]).toBe(255);
  });

  it('caches masks: repainting the same run does not draw it again', () => {
    rasterizeTextRun('again', '16px sans-serif');
    rasterizeTextRun('again', '16px sans-serif');
    expect(fillTextCalls).toBe(1);
    rasterizeTextRun('again', 'bold 16px sans-serif');
    expect(fillTextCalls).toBe(2);
  });
});

describe('without a 2D canvas (Node/headless)', () => {
  it('falls back to the bitmap font for ASCII', () => {
    resetTextRaster();
    expect(rasterizeTextRun('Hi', '16px sans-serif')).toBeNull();
    const r = draw('H');
    const lit = Array.from({ length: 16 }, (_, dy) => Array.from({ length: 16 }, (_, dx) => pixel(r, 20 + dx, 17 + dy)[1])).flat();
    expect(lit.some((g) => g === 0)).toBe(true); // some red pixels from the bitmap glyph
  });
});

describe('line breaking for CJK (no spaces)', () => {
  it('allows a break before each ideograph, so Chinese text wraps', async () => {
    const { segmentText } = await import('../src/browser/rendering/formatting/line-break');
    // `code >= 0x203C || code <= 0x203D` was true for every code point, classifying all text
    // past U+203D (CJK, kana, Hangul…) as "ambiguous": no break opportunities, one long line.
    expect(segmentText('该域名仅用于').map((s) => s.text)).toEqual(['该', '域', '名', '仅', '用', '于']);
    expect(segmentText('日本語のテキスト').length).toBeGreaterThan(3);
  });
});
