import { describe, it, expect } from 'vitest';
import { Rasterizer } from '../src/browser/rendering/rasterizer';

type Cmd = Parameters<Rasterizer['rasterize']>[0][number];
const cmd = (type: string, ...params: unknown[]): Cmd => ({ type, params }) as unknown as Cmd;

/** The rightmost column holding ink (a non-white pixel), or -1. */
function rightmostInk(r: Rasterizer, width: number, height: number): number {
  const img = r.getImageData();
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (img.data[i] !== 255 || img.data[i + 1] !== 255 || img.data[i + 2] !== 255) right = Math.max(right, x);
    }
  }
  return right;
}

function paint(width: number | undefined, text = 'Hello world'): number {
  const r = new Rasterizer({ width: 400, height: 40 });
  r.rasterize([
    cmd('setFillStyle', 'black'),
    cmd('setFont', '16px sans-serif'),
    cmd('fillText', ...(width === undefined ? [text, 10, 24] : [text, 10, 24, width])),
  ]);
  return rightmostInk(r, 400, 40);
}

describe('text painted into the width layout gave it', () => {
  it('without a width every glyph advances a full em, as before', () => {
    expect(paint(undefined)).toBeGreaterThan(10 + 11 * 16 - 16); // 11 characters x 16 px
  });

  it('with a width the ink stays inside it, so neighbouring words are not painted over', () => {
    const narrow = paint(70); // layout measured the word at ~6.4 px per character
    expect(narrow).toBeLessThanOrEqual(10 + 70);
    expect(narrow).toBeGreaterThan(10 + 70 - 12); // and it still fills it (not squeezed to nothing)
  });

  it('a width wider than a full em advance does not stretch the glyphs', () => {
    expect(paint(1000)).toBe(paint(undefined));
  });

  it('squeezes each glyph whole instead of cutting it off: the right-hand stem of an H is still drawn', () => {
    const r = new Rasterizer({ width: 400, height: 40 });
    r.rasterize([cmd('setFillStyle', 'black'), cmd('setFont', '16px sans-serif'), cmd('fillText', 'H', 10, 24, 8)]); // 16 px glyph into 8 px
    const img = r.getImageData();
    const stemHeight = (x: number): number => { let n = 0; for (let y = 0; y < 40; y++) if (img.data[(y * 400 + x) * 4] === 0) n++; return n; };
    expect(Math.max(stemHeight(10 + 5), stemHeight(10 + 6), stemHeight(10 + 7))).toBeGreaterThanOrEqual(10); // a stem, not just the crossbar
  });

  it('every character gets its share of the width', () => {
    expect(paint(110, 'a')).toBeLessThanOrEqual(10 + 16); // one character never spreads over the whole width
  });
});
