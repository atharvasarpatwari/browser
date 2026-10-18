/**
 * @file text-raster.ts
 * Glyph coverage masks drawn with the device's real fonts.
 *
 * The software rasterizer used to draw every text run from an 8x8 ASCII bitmap font:
 * blocky, squeezed into the widths layout measured with the real font, and blank for
 * anything outside ASCII (Arabic, CJK, Cyrillic, accented letters). Layout already
 * measures with a 2D canvas, so the same canvas draws the run once in white; its alpha
 * channel becomes a mask the rasterizer blends in the run's colour.
 *
 * Returns null where no 2D canvas exists (Node, headless tests): callers keep the bitmap path.
 */

/** Coverage of one text run; `left`/`top` place the mask relative to the pen position and baseline. */
export interface TextMask {
  readonly alpha: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly top: number;
  /** The run's advance width (after fitting to maxWidth), for text-align. */
  readonly advance: number;
}

interface Ctx2D {
  font: string;
  fillStyle: string;
  textBaseline: string;
  measureText(text: string): { width: number; actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number };
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
}
interface ScratchCanvas { width: number; height: number; getContext(type: '2d'): unknown }

const CACHE_LIMIT = 512;
const MAX_MASK_PIXELS = 2_000_000;
const cache = new Map<string, TextMask | null>();
let canvas: ScratchCanvas | null | undefined;

function scratchCanvas(): ScratchCanvas | null {
  if (canvas !== undefined) return canvas;
  try {
    const Offscreen = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => ScratchCanvas }).OffscreenCanvas;
    if (Offscreen) canvas = new Offscreen(1, 1);
    else if (typeof document !== 'undefined') canvas = document.createElement('canvas') as unknown as ScratchCanvas;
    else canvas = null;
    if (canvas && !canvas.getContext('2d')) canvas = null;
  } catch {
    canvas = null;
  }
  return canvas;
}

/** Forget the scratch canvas and cached masks (tests swap the canvas implementation). */
export function resetTextRaster(): void {
  canvas = undefined;
  cache.clear();
}

/**
 * Draws `text` in `cssFont` (e.g. "bold 16px Georgia, serif") and returns its coverage mask.
 * `maxWidth` squeezes the run to the width layout gave it, as canvas fillText does.
 */
export function rasterizeTextRun(text: string, cssFont: string, maxWidth?: number): TextMask | null {
  if (!text) return null;
  const key = `${cssFont}\u0000${maxWidth ?? ''}\u0000${text}`;
  if (cache.has(key)) {
    const hit = cache.get(key)!;
    cache.delete(key); // keep recently used entries at the end (LRU)
    cache.set(key, hit);
    return hit;
  }

  const c = scratchCanvas();
  if (!c) return null;
  let ctx = c.getContext('2d') as Ctx2D;
  ctx.font = cssFont;
  const metrics = ctx.measureText(text);
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(cssFont)?.[1] ?? '16');
  const advance = maxWidth !== undefined && maxWidth > 0 ? Math.min(metrics.width, maxWidth) : metrics.width;
  const pad = Math.ceil(size * 0.25) + 1; // italic overhang, antialiasing
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent ?? size) + 2;
  const descent = Math.ceil(metrics.actualBoundingBoxDescent ?? size * 0.3) + 2;
  const width = Math.ceil(advance) + 2 * pad;
  const height = ascent + descent;

  let mask: TextMask | null = null;
  if (width > 0 && height > 0 && width * height <= MAX_MASK_PIXELS) {
    c.width = width;   // resizing clears the canvas and resets its state
    c.height = height;
    ctx = c.getContext('2d') as Ctx2D;
    ctx.font = cssFont;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    if (maxWidth !== undefined && maxWidth > 0) ctx.fillText(text, pad, ascent, maxWidth);
    else ctx.fillText(text, pad, ascent);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8ClampedArray(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]!;
    mask = { alpha, width, height, left: -pad, top: -ascent, advance };
  }

  cache.set(key, mask);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return mask;
}
