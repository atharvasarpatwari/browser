/**
 * rasterizer.ts
 * -------------
 * Rendering layer — Session 7 of 9 (render-tree → layout-box → text-shaping →
 * paint-record → stacking-context → compositor → rasterizer →
 * repaint-scheduler → render-devtools-bridge).
 *
 * Pure-TypeScript software rasterizer. Consumes the ordered command list
 * from the compositor (session 6) — or a raw PaintCommand[] — and writes
 * pixels into an RGBA byte buffer. No native bindings, no Canvas API, no
 * GPU.
 *
 * Scope: solid-color fills (FillRect), stroke rects (StrokeRect — filled),
 * DrawText placeholder glyphs (solid-color rectangles sized from fontSize),
 * DrawImagePlaceholder (4×4 checker tile), and source-over alpha blending
 * on every compositing step. Deterministic: same input always produces the
 * same pixel output.
 */

import type { Rect } from "./layout-box";
import type { CompositePlan, CompositeLayer } from "./compositor";
import { PaintCommandKind, type PaintCommand } from "./paint-record";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RasterOptions {
  /**
   * (dx, dy) offset applied to every command's coordinates before
   * rasterisation — useful for scrolling / viewport translate.
   */
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface RasterResult {
  /** Flat RGBA pixel buffer (width × height × 4 bytes). */
  readonly pixels: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Colour parsing
// ---------------------------------------------------------------------------

/** Parse a CSS colour string into [r, g, b, a] in [0, 255] (alpha included). */
function parseColor(color: string): [number, number, number, number] {
  // Fast-path: hex 3 or 6
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0]! + hex[0], 16);
      const g = parseInt(hex[1]! + hex[1], 16);
      const b = parseInt(hex[2]! + hex[2], 16);
      return [r, g, b, 255];
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return [r, g, b, 255];
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return [r, g, b, a];
    }
  }

  // rgba(r, g, b, a) or rgb(r, g, b)
  const rgbaMatch = color.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+))?\s*\)$/,
  );
  if (rgbaMatch) {
    const r = clamp255(Number(rgbaMatch[1]));
    const g = clamp255(Number(rgbaMatch[2]));
    const b = clamp255(Number(rgbaMatch[3]));
    const a = rgbaMatch[4] !== undefined ? Math.round(Number(rgbaMatch[4]) * 255) : 255;
    return [r, g, b, clamp255(a)];
  }

  // Named colours — common subset only; unknown → opaque black
  const named: Record<string, [number, number, number, number]> = {
    transparent: [0, 0, 0, 0],
    white: [255, 255, 255, 255],
    black: [0, 0, 0, 255],
    red: [255, 0, 0, 255],
    green: [0, 128, 0, 255],
    blue: [0, 0, 255, 255],
    yellow: [255, 255, 0, 255],
    gray: [128, 128, 128, 255],
    grey: [128, 128, 128, 255],
  };
  return named[color.toLowerCase()] ?? [0, 0, 0, 255];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

// ---------------------------------------------------------------------------
// Pixel helpers
// ---------------------------------------------------------------------------

/** Write a single pixel (RGBA) into the buffer. */
function putPixel(
  pixels: Uint8ClampedArray,
  stride: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a: number,
): void {
  if (x < 0 || y < 0) return;
  const idx = (y * stride + x) * 4;
  if (idx < 0 || idx + 3 >= pixels.length) return;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

/** Source-over composite a single colour onto the buffer at (x, y). */
function compositePixel(
  pixels: Uint8ClampedArray,
  stride: number,
  x: number,
  y: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
): void {
  if (sa === 0) return;
  if (x < 0 || y < 0) return;
  const idx = (y * stride + x) * 4;
  if (idx < 0 || idx + 3 >= pixels.length) return;

  const dstA = pixels[idx + 3] / 255;
  const srcA = sa / 255;
  const outA = srcA + dstA * (1 - srcA);

  if (outA === 0) {
    pixels[idx] = 0;
    pixels[idx + 1] = 0;
    pixels[idx + 2] = 0;
    pixels[idx + 3] = 0;
    return;
  }

  const invOutA = 1 / outA;
  pixels[idx] = Math.round((sr * srcA + pixels[idx]! * dstA * (1 - srcA)) * invOutA);
  pixels[idx + 1] = Math.round((sg * srcA + pixels[idx + 1]! * dstA * (1 - srcA)) * invOutA);
  pixels[idx + 2] = Math.round((sb * srcA + pixels[idx + 2]! * dstA * (1 - srcA)) * invOutA);
  pixels[idx + 3] = Math.round(outA * 255);
}

// ---------------------------------------------------------------------------
// Scan-line fill
// ---------------------------------------------------------------------------

/** Fill a horizontal span [x0, x1) at row y with source-over blending. */
function fillScanline(
  pixels: Uint8ClampedArray,
  stride: number,
  height: number,
  y: number,
  x0: number,
  x1: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
): void {
  if (y < 0 || y >= height) return;
  const ix0 = Math.max(0, Math.ceil(x0));
  const ix1 = Math.min(stride, Math.floor(x1));
  for (let x = ix0; x < ix1; x++) {
    compositePixel(pixels, stride, x, y, sr, sg, sb, sa);
  }
}

/** Fill a solid axis-aligned rect (source-over). */
function fillRect(
  pixels: Uint8ClampedArray,
  stride: number,
  height: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  sr: number,
  sg: number,
  sb: number,
  sa: number,
): void {
  const y0 = Math.max(0, Math.ceil(ry));
  const y1 = Math.min(height, Math.floor(ry + rh));
  for (let y = y0; y < y1; y++) {
    fillScanline(pixels, stride, height, y, rx, rx + rw, sr, sg, sb, sa);
  }
}

// ---------------------------------------------------------------------------
// Command rasterisers
// ---------------------------------------------------------------------------

function rasterFillRect(
  pixels: Uint8ClampedArray,
  stride: number,
  h: number,
  cmd: Extract<PaintCommand, { kind: PaintCommandKind.FillRect }>,
  ox: number,
  oy: number,
): void {
  const [r, g, b, a] = parseColor(cmd.color);
  fillRect(pixels, stride, h, cmd.rect.x + ox, cmd.rect.y + oy, cmd.rect.width, cmd.rect.height, r, g, b, a);
}

function rasterStrokeRect(
  pixels: Uint8ClampedArray,
  stride: number,
  h: number,
  cmd: Extract<PaintCommand, { kind: PaintCommandKind.StrokeRect }>,
  ox: number,
  oy: number,
): void {
  const [r, g, b, a] = parseColor(cmd.color);
  fillRect(pixels, stride, h, cmd.rect.x + ox, cmd.rect.y + oy, cmd.rect.width, cmd.rect.height, r, g, b, a);
}

function rasterDrawText(
  pixels: Uint8ClampedArray,
  stride: number,
  h: number,
  cmd: Extract<PaintCommand, { kind: PaintCommandKind.DrawText }>,
  ox: number,
  oy: number,
): void {
  // Placeholder glyph rendering: fill a rectangle representing the text's
  // bounding box with the text colour. Deterministic — no font engine
  // required.
  const [r, g, b, a] = parseColor(cmd.color);
  const textWidth = cmd.text.length * cmd.fontSize * 0.6;
  const textHeight = cmd.fontSize * 1.2;
  const x = cmd.x + ox;
  const y = cmd.y - cmd.fontSize + oy;
  fillRect(pixels, stride, h, x, y, textWidth, textHeight, r, g, b, a);
}

function rasterDrawImagePlaceholder(
  pixels: Uint8ClampedArray,
  stride: number,
  w: number,
  h: number,
  cmd: Extract<PaintCommand, { kind: PaintCommandKind.DrawImagePlaceholder }>,
  ox: number,
  oy: number,
): void {
  const rx = Math.max(0, Math.ceil(cmd.rect.x + ox));
  const ry = Math.max(0, Math.ceil(cmd.rect.y + oy));
  const rw = Math.min(w, Math.floor(cmd.rect.x + cmd.rect.width + ox));
  const rh = Math.min(h, Math.floor(cmd.rect.y + cmd.rect.height + oy));

  for (let y = ry; y < rh; y++) {
    for (let x = rx; x < rw; x++) {
      // 4×4 checker: alternate between #cccccc and #999999
      const isLight = ((x >> 2) + (y >> 2)) % 2 === 0;
      const grey = isLight ? 204 : 153;
      compositePixel(pixels, stride, x, y, grey, grey, grey, 255);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rasterises a CompositePlan into an RGBA pixel buffer.
 * Layers are composited in order; within each layer, commands are drawn in
 * sequence. Source-over alpha blending applies at every compositing step.
 */
export function rasterizePlan(
  plan: CompositePlan,
  width: number,
  height: number,
  options: RasterOptions = {},
): RasterResult {
  const allCmds: PaintCommand[] = [];
  for (const layer of plan.layers) {
    for (const cmd of layer.commands) allCmds.push(cmd);
  }
  return rasterize(allCmds, width, height, options);
}

/**
 * Rasterises a flat, paint-order command list into an RGBA pixel buffer.
 *
 * The buffer is `width * height * 4` bytes, with pixels laid out row-major
 * (top-left origin). Each command is drawn in sequence with source-over
 * alpha blending.
 */
export function rasterize(
  commands: readonly PaintCommand[],
  width: number,
  height: number,
  options: RasterOptions = {},
): RasterResult {
  const stride = width;
  const size = stride * height * 4;
  const pixels = new Uint8ClampedArray(size);

  // Default background: transparent (all zeros)
  const ox = options.offsetX ?? 0;
  const oy = options.offsetY ?? 0;

  for (const cmd of commands) {
    switch (cmd.kind) {
      case PaintCommandKind.FillRect:
        rasterFillRect(pixels, stride, height, cmd, ox, oy);
        break;
      case PaintCommandKind.StrokeRect:
        rasterStrokeRect(pixels, stride, height, cmd, ox, oy);
        break;
      case PaintCommandKind.DrawText:
        rasterDrawText(pixels, stride, height, cmd, ox, oy);
        break;
      case PaintCommandKind.DrawImagePlaceholder:
        rasterDrawImagePlaceholder(pixels, stride, width, height, cmd, ox, oy);
        break;
    }
  }

  return { pixels, width, height };
}
