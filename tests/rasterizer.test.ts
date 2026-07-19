import { describe, it, expect } from 'vitest';
import { Rasterizer, parseColor } from '../src/browser/rendering/rasterizer';
import type { RGBA } from '../src/browser/rendering/rasterizer';
import type { PaintCommand } from '../src/browser/rendering/paint-engine';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function cmd(type: string, ...params: unknown[]): PaintCommand {
  return { type: type as PaintCommand['type'], params };
}

function getPixel(img: ImageData, x: number, y: number): [number, number, number, number] {
  const idx = (y * img.width + x) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2], img.data[idx + 3]];
}

function pixelApprox(actual: [number, number, number, number], r: number, g: number, b: number, a: number, tolerance = 2): void {
  expect(Math.abs(actual[0] - r)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual[1] - g)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual[2] - b)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual[3] - a)).toBeLessThanOrEqual(tolerance);
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR PARSER
// ─────────────────────────────────────────────────────────────────────────────

describe('parseColor', () => {
  it('parses named colors', () => {
    const red = parseColor('red');
    expect(red.r).toBe(255);
    expect(red.g).toBe(0);
    expect(red.b).toBe(0);
    expect(red.a).toBe(1);
  });

  it('parses white', () => {
    const w = parseColor('white');
    expect(w).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });

  it('parses black', () => {
    const b = parseColor('black');
    expect(b).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it('parses transparent', () => {
    const t = parseColor('transparent');
    expect(t).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it('parses blue', () => {
    const b = parseColor('blue');
    expect(b.r).toBe(0);
    expect(b.g).toBe(0);
    expect(b.b).toBe(255);
    expect(b.a).toBe(1);
  });

  it('parses gray', () => {
    const g = parseColor('gray');
    expect(g.r).toBe(128);
    expect(g.g).toBe(128);
    expect(g.b).toBe(128);
    expect(g.a).toBe(1);
  });

  it('parses orange', () => {
    const o = parseColor('orange');
    expect(o.r).toBe(255);
    expect(o.g).toBe(165);
    expect(o.b).toBe(0);
    expect(o.a).toBe(1);
  });

  it('parses #rgb shorthand', () => {
    const c = parseColor('#f00');
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(c.a).toBe(1);
  });

  it('parses #rgb with values', () => {
    const c = parseColor('#0f0');
    expect(c.r).toBe(0);
    expect(c.g).toBe(255);
    expect(c.b).toBe(0);
    expect(c.a).toBe(1);
  });

  it('parses #rrggbb', () => {
    const c = parseColor('#ff8800');
    expect(c.r).toBe(255);
    expect(c.g).toBe(136);
    expect(c.b).toBe(0);
    expect(c.a).toBe(1);
  });

  it('parses #rrggbbaa', () => {
    const c = parseColor('#ff000080');
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(Math.abs(c.a - 0.502)).toBeLessThan(0.01);
  });

  it('parses rgb()', () => {
    const c = parseColor('rgb(100, 200, 50)');
    expect(c.r).toBe(100);
    expect(c.g).toBe(200);
    expect(c.b).toBe(50);
    expect(c.a).toBe(1);
  });

  it('parses rgba()', () => {
    const c = parseColor('rgba(255, 0, 0, 0.5)');
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(c.a).toBe(0.5);
  });

  it('parses rgba() with percentage alpha', () => {
    const c = parseColor('rgba(0, 128, 255, 75%)');
    expect(c.r).toBe(0);
    expect(c.g).toBe(128);
    expect(c.b).toBe(255);
    expect(c.a).toBe(0.75);
  });

  it('returns black for empty input', () => {
    const c = parseColor('');
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(c.a).toBe(0);
  });

  it('returns transparent for "none"', () => {
    const c = parseColor('none');
    expect(c.a).toBe(0);
  });

  it('handles case-insensitive named colors', () => {
    const r = parseColor('RED');
    expect(r.r).toBe(255);
    expect(r.g).toBe(0);
    expect(r.b).toBe(0);
  });

  it('parses yellow', () => {
    const y = parseColor('yellow');
    expect(y.r).toBe(255);
    expect(y.g).toBe(255);
    expect(y.b).toBe(0);
    expect(y.a).toBe(1);
  });

  it('parses #000000', () => {
    const c = parseColor('#000000');
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(c.a).toBe(1);
  });

  it('parses #ffffff', () => {
    const c = parseColor('#ffffff');
    expect(c.r).toBe(255);
    expect(c.g).toBe(255);
    expect(c.b).toBe(255);
    expect(c.a).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RASTERIZER — BASIC OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

describe('Rasterizer', () => {
  describe('constructor', () => {
    it('creates a blank white canvas', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      const img = r.getImageData();
      expect(img.width).toBe(4);
      expect(img.height).toBe(4);
      const [cr, cg, cb, ca] = getPixel(img, 0, 0);
      expect(cr).toBe(255);
      expect(cg).toBe(255);
      expect(cb).toBe(255);
      expect(ca).toBe(255);
    });

    it('creates with custom background', () => {
      const r = new Rasterizer({ width: 2, height: 2, backgroundColor: 'red' });
      const img = r.getImageData();
      const [cr, cg, cb, ca] = getPixel(img, 0, 0);
      expect(cr).toBe(255);
      expect(cg).toBe(0);
      expect(cb).toBe(0);
      expect(ca).toBe(255);
    });

    it('creates with transparent background', () => {
      const r = new Rasterizer({ width: 2, height: 2, backgroundColor: 'transparent' });
      const img = r.getImageData();
      const [, , , ca] = getPixel(img, 0, 0);
      expect(ca).toBe(0);
    });
  });

  describe('clearRect', () => {
    it('clears a region to transparent', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([cmd('clearRect', 1, 1, 2, 2)]);
      const img = r.getImageData();
      const [cr, cg, cb, ca] = getPixel(img, 1, 1);
      expect(ca).toBe(0);
      const [wr, wg, wb, wa] = getPixel(img, 0, 0);
      expect(wr).toBe(255);
      expect(wa).toBe(255);
    });

    it('clears only the specified region', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([cmd('clearRect', 2, 2, 2, 2)]);
      const img = r.getImageData();
      expect(getPixel(img, 1, 1)[3]).toBe(255);
      expect(getPixel(img, 2, 2)[3]).toBe(0);
      expect(getPixel(img, 3, 3)[3]).toBe(0);
      expect(getPixel(img, 4, 4)[3]).toBe(255);
    });
  });

  describe('fillRect', () => {
    it('fills a solid color rectangle', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 3, 3), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 4, 4), 255, 255, 255, 255);
    });

    it('fills with a hex color', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setFillStyle', '#00ff00'),
        cmd('fillRect', 2, 2, 2, 2),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 2, 2), 0, 255, 0, 255);
      pixelApprox(getPixel(img, 3, 3), 0, 255, 0, 255);
      pixelApprox(getPixel(img, 0, 0), 255, 255, 255, 255);
    });

    it('fills with a named color (blue)', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 0, 0, 8, 8),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 0, 0, 255, 255);
    });

    it('fills full buffer with blue', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          pixelApprox(getPixel(img, x, y), 0, 0, 255, 255);
        }
      }
    });

    it('handles out-of-bounds fillRect', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', -1, -1, 10, 10),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 3, 3), 255, 0, 0, 255);
    });

    it('handles zero-size fillRect', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 0, 0),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 255, 255, 255);
    });

    it('handles negative-size fillRect', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, -5, -5),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 255, 255, 255);
    });
  });

  describe('strokeRect', () => {
    it('strokes a rectangle outline', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setStrokeStyle', 'red'),
        cmd('strokeRect', 1, 1, 6, 6),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 1, 1), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 6, 1), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 1, 6), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 6, 6), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 3, 3), 255, 255, 255, 255);
    });

    it('respects lineWidth', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setStrokeStyle', 'blue'),
        cmd('setLineWidth', 2),
        cmd('strokeRect', 1, 1, 6, 6),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 1, 1), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 2, 1), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 1, 2), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 3, 3), 255, 255, 255, 255);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ALPHA / OPACITY
  // ───────────────────────────────────────────────────────────────────────────

  describe('alpha compositing', () => {
    it('setGlobalAlpha applies to subsequent fills', () => {
      const r = new Rasterizer({ width: 8, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
        cmd('setGlobalAlpha', 0.5),
        cmd('fillRect', 4, 0, 4, 4),
      ]);
      const img = r.getImageData();
      const [, , cbFull] = getPixel(img, 0, 0);
      const [, , cbHalf] = getPixel(img, 5, 0);
      expect(cbFull).toBe(0);
      expect(cbHalf).toBeGreaterThan(0);
    });

    it('globalAlpha = 0 leaves canvas unchanged', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('setGlobalAlpha', 0),
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      const [cr, cg, cb, ca] = getPixel(img, 0, 0);
      expect(cr).toBe(255);
      expect(cg).toBe(255);
      expect(cb).toBe(255);
      expect(ca).toBe(255);
    });

    it('globalAlpha blends with white background', () => {
      const r = new Rasterizer({ width: 8, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
        cmd('setGlobalAlpha', 0.5),
        cmd('fillRect', 4, 0, 4, 4),
      ]);
      const img = r.getImageData();
      const [crFull] = getPixel(img, 0, 0);
      const [crHalf] = getPixel(img, 5, 0);
      expect(crFull).toBe(255);
      expect(crHalf).toBe(255);
    });

    it('color with alpha composites over background', () => {
      const r = new Rasterizer({ width: 4, height: 4, backgroundColor: 'transparent' });
      r.rasterize([
        cmd('setFillStyle', 'rgba(255, 0, 0, 0.5)'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      const [cr, , , ca] = getPixel(img, 0, 0);
      expect(cr).toBe(255);
      expect(ca).toBeGreaterThan(0);
      expect(ca).toBeLessThan(255);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SAVE / RESTORE
  // ───────────────────────────────────────────────────────────────────────────

  describe('save/restore', () => {
    it('restores fill style after save/restore', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('save'),
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 0, 0, 4, 4),
        cmd('restore'),
        cmd('fillRect', 4, 0, 4, 4),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 5, 0), 255, 0, 0, 255);
    });

    it('restores globalAlpha after save/restore', () => {
      const r = new Rasterizer({ width: 12, height: 4 });
      r.rasterize([
        cmd('setFillStyle', 'green'),
        cmd('fillRect', 0, 0, 4, 4),
        cmd('setGlobalAlpha', 0.3),
        cmd('save'),
        cmd('setGlobalAlpha', 1),
        cmd('setFillStyle', 'green'),
        cmd('fillRect', 4, 0, 4, 4),
        cmd('restore'),
        cmd('fillRect', 8, 0, 4, 4),
      ]);
      const img = r.getImageData();
      const [crFull] = getPixel(img, 0, 0);
      const [crRestore] = getPixel(img, 9, 0);
      expect(crFull).toBe(0);
      expect(crRestore).toBeGreaterThan(0);
    });

    it('nested save/restore works', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('save'),
        cmd('setFillStyle', 'green'),
        cmd('save'),
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 0, 0, 4, 4),
        cmd('restore'),
        cmd('fillRect', 4, 0, 4, 4),
        cmd('restore'),
        cmd('fillRect', 0, 4, 4, 4),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 5, 0), 0, 128, 0, 255);
      pixelApprox(getPixel(img, 0, 5), 255, 0, 0, 255);
    });

    it('restore with empty stack is a no-op', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('restore'),
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEXT RENDERING
  // ───────────────────────────────────────────────────────────────────────────

  describe('fillText', () => {
    it('renders text at given position', () => {
      const r = new Rasterizer({ width: 64, height: 32 });
      r.rasterize([
        cmd('setFillStyle', 'black'),
        cmd('fillText', 'A', 0, 16),
      ]);
      const img = r.getImageData();
      let hasBlack = false;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 64; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 0 && cg === 0 && cb === 0) hasBlack = true;
        }
      }
      expect(hasBlack).toBe(true);
    });

    it('renders multi-character text', () => {
      const r = new Rasterizer({ width: 128, height: 32 });
      r.rasterize([
        cmd('setFillStyle', 'black'),
        cmd('fillText', 'Hi', 0, 16),
      ]);
      const img = r.getImageData();
      let blackPixels = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 128; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 0 && cg === 0 && cb === 0) blackPixels++;
        }
      }
      expect(blackPixels).toBeGreaterThan(10);
    });

    it('renders space as blank', () => {
      const r = new Rasterizer({ width: 64, height: 16 });
      r.rasterize([
        cmd('setFillStyle', 'black'),
        cmd('fillText', ' ', 0, 12),
      ]);
      const img = r.getImageData();
      let blackPixels = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 64; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 0 && cg === 0 && cb === 0) blackPixels++;
        }
      }
      expect(blackPixels).toBe(0);
    });

    it('text with textAlign "center" centers text', () => {
      const r = new Rasterizer({ width: 64, height: 16 });
      r.rasterize([
        cmd('setFont', '8px monospace'),
        cmd('setTextAlign', 'center'),
        cmd('setFillStyle', 'black'),
        cmd('fillText', 'A', 32, 8),
      ]);
      const img = r.getImageData();
      let minX = 64, maxX = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 64; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 0 && cg === 0 && cb === 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (maxX >= minX) {
        const center = (minX + maxX) / 2;
        expect(Math.abs(center - 32)).toBeLessThan(8);
      }
    });

    it('text with textAlign "right" right-aligns', () => {
      const r = new Rasterizer({ width: 64, height: 16 });
      r.rasterize([
        cmd('setFont', '8px monospace'),
        cmd('setTextAlign', 'right'),
        cmd('setFillStyle', 'black'),
        cmd('fillText', 'A', 32, 8),
      ]);
      const img = r.getImageData();
      let maxX = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 64; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 0 && cg === 0 && cb === 0 && x > maxX) maxX = x;
        }
      }
      expect(maxX).toBeLessThanOrEqual(32);
    });
  });

  describe('strokeText', () => {
    it('renders stroked text', () => {
      const r = new Rasterizer({ width: 64, height: 32 });
      r.rasterize([
        cmd('setStrokeStyle', 'red'),
        cmd('strokeText', 'A', 0, 16),
      ]);
      const img = r.getImageData();
      let hasRed = false;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 64; x++) {
          const [cr, cg, cb] = getPixel(img, x, y);
          if (cr === 255 && cg === 0 && cb === 0) hasRed = true;
        }
      }
      expect(hasRed).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // FULL FRAME COMPOSITION
  // ───────────────────────────────────────────────────────────────────────────

  describe('full frame rasterization', () => {
    it('processes multiple paint commands in order', () => {
      const r = new Rasterizer({ width: 16, height: 16 });
      const commands: PaintCommand[] = [
        cmd('clearRect', 0, 0, 16, 16),
        cmd('setFillStyle', '#ffffff'),
        cmd('fillRect', 0, 0, 16, 16),
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 8, 8),
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 8, 0, 8, 8),
        cmd('setFillStyle', 'green'),
        cmd('fillRect', 0, 8, 8, 8),
        cmd('setFillStyle', 'yellow'),
        cmd('fillRect', 8, 8, 8, 8),
      ];
      const img = r.rasterize(commands);
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 10, 0), 0, 0, 255, 255);
      pixelApprox(getPixel(img, 0, 10), 0, 128, 0, 255);
      pixelApprox(getPixel(img, 10, 10), 255, 255, 0, 255);
    });

    it('overlapping fills respect paint order', () => {
      const r = new Rasterizer({ width: 8, height: 8 });
      const img = r.rasterize([
        cmd('setFillStyle', 'blue'),
        cmd('fillRect', 0, 0, 8, 8),
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
      pixelApprox(getPixel(img, 5, 5), 0, 0, 255, 255);
    });

    it('produces correct ImageData dimensions', () => {
      const r = new Rasterizer({ width: 100, height: 50 });
      const img = r.getImageData();
      expect(img.width).toBe(100);
      expect(img.height).toBe(50);
      expect(img.data.length).toBe(100 * 50 * 4);
    });

    it('getPixels returns the raw buffer', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      const pixels = r.getPixels();
      expect(pixels).toBeInstanceOf(Uint8ClampedArray);
      expect(pixels.length).toBe(4 * 4 * 4);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE CASES
  // ───────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles 1x1 canvas', () => {
      const r = new Rasterizer({ width: 1, height: 1 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 1, 1),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
    });

    it('handles very large canvas', () => {
      const r = new Rasterizer({ width: 1000, height: 1000 });
      r.rasterize([
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 999, 999, 1, 1),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 999, 999), 255, 0, 0, 255);
    });

    it('ignores unsupported commands gracefully', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      r.rasterize([
        cmd('beginPath'),
        cmd('closePath'),
        cmd('fill'),
        cmd('stroke'),
        cmd('clip'),
        cmd('drawImage', null, 0, 0),
        cmd('setFillStyle', 'red'),
        cmd('fillRect', 0, 0, 4, 4),
      ]);
      const img = r.getImageData();
      pixelApprox(getPixel(img, 0, 0), 255, 0, 0, 255);
    });

    it('processes empty command list', () => {
      const r = new Rasterizer({ width: 4, height: 4 });
      const img = r.rasterize([]);
      pixelApprox(getPixel(img, 0, 0), 255, 255, 255, 255);
    });
  });
});
