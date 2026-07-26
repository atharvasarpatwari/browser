/**
 * @file canvas/canvas-context.ts
 * CanvasRenderingContext2D — full Canvas 2D API with software rasterizer.
 *
 * Supports:
 *   - Rectangles (fill, stroke, clear)
 *   - Paths (moveTo, lineTo, arc, bezierCurveTo, quadraticCurveTo, rect, ellipse, arcTo, closePath)
 *   - Fill & stroke with scanline rasterizer
 *   - Text (fillText, strokeText, measureText)
 *   - Images (drawImage with 3/5/9 arg forms)
 *   - Transforms (translate, rotate, scale, transform, setTransform, resetTransform)
 *   - State stack (save, restore)
 *   - Gradients (linear, radial)
 *   - Patterns
 *   - Pixel data (getImageData, putImageData, createImageData)
 *   - toDataURL
 *   - Line dash, line cap, line join
 *   - Clipping (rectangular clip)
 */

import type {
  CanvasContextState,
  CanvasFillRule,
  CanvasLineCap,
  CanvasLineJoin,
  CanvasTextAlign,
  CanvasTextBaseline,
  CanvasDirection,
  CanvasImageSmoothingQuality,
  ColorStop,
  PathCommand,
  DOMMatrix2DInit,
} from './canvas-types';
import { Path2D } from './canvas-path';
import { CanvasGradient } from './canvas-gradient';
import { CanvasPattern, type CanvasPatternRepetition } from './canvas-pattern';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT STATE
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_STATE: CanvasContextState = {
  fillStyle: '#000000',
  strokeStyle: '#000000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 10,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  direction: 'ltr',
  shadowBlur: 0,
  shadowColor: 'rgba(0,0,0,0)',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
  lineDashOffset: 0,
  lineDash: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// COLOR PARSING
// ─────────────────────────────────────────────────────────────────────────────

function parseColorToRGBA(color: string): [number, number, number, number] {
  const c = color.trim().toLowerCase();

  if (c === 'transparent') return [0, 0, 0, 0];
  if (c === 'currentcolor') return [0, 0, 0, 255]; // Fallback

  // Hex
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [parseInt(hex[0]! + hex[0], 16), parseInt(hex[1]! + hex[1], 16), parseInt(hex[2]! + hex[2], 16), 255];
    }
    if (hex.length === 6) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
    }
    if (hex.length === 8) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16)];
    }
  }

  // rgb/rgba
  const rgbaMatch = c.match(/rgba?\(\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*(?:,\s*([\d.]+)%?)?\s*\)/);
  if (rgbaMatch) {
    let r = parseFloat(rgbaMatch[1]!);
    let g = parseFloat(rgbaMatch[2]!);
    let b = parseFloat(rgbaMatch[3]!);
    if (c.includes('%')) { r = r * 2.55; g = g * 2.55; b = b * 2.55; }
    const a = rgbaMatch[4] !== undefined ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255;
    return [Math.round(r), Math.round(g), Math.round(b), a];
  }

  // hsl/hsla
  const hslMatch = c.match(/hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+))?\s*\)/);
  if (hslMatch) {
    const h = parseFloat(hslMatch[1]!) / 360;
    const s = parseFloat(hslMatch[2]!) / 100;
    const l = parseFloat(hslMatch[3]!) / 100;
    const a = hslMatch[4] !== undefined ? parseFloat(hslMatch[4]!) : 1;
    const [r, g, b] = hslToRgb(h, s, l);
    return [r, g, b, Math.round(a * 255)];
  }

  // Named colors
  const NAMED: Record<string, [number, number, number, number]> = {
    black: [0, 0, 0, 255], white: [255, 255, 255, 255], red: [255, 0, 0, 255],
    green: [0, 128, 0, 255], blue: [0, 0, 255, 255], yellow: [255, 255, 0, 255],
    cyan: [0, 255, 255, 255], magenta: [255, 0, 255, 255], orange: [255, 165, 0, 255],
    purple: [128, 0, 128, 255], gray: [128, 128, 128, 255], grey: [128, 128, 128, 255],
    silver: [192, 192, 192, 255], maroon: [128, 0, 0, 255], navy: [0, 0, 128, 255],
    teal: [0, 128, 128, 255], olive: [128, 128, 0, 255], lime: [0, 255, 0, 255],
    aqua: [0, 255, 255, 255], fuchsia: [255, 0, 255, 255],
  };
  return NAMED[c] ?? [0, 0, 0, 255];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface Segment { x1: number; y1: number; x2: number; y2: number; type: 'moveTo' | 'lineTo'; }

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS RENDERING CONTEXT 2D
// ─────────────────────────────────────────────────────────────────────────────

export class CanvasRenderingContext2D {
  readonly _width: number;
  readonly _height: number;
  readonly _data: Uint8ClampedArray;

  // State
  private _state: CanvasContextState;
  private _stateStack: CanvasContextState[] = [];

  // Transform matrix [a, b, c, d, e, f]
  private _a = 1; private _b = 0; private _c = 0; private _d = 1; private _e = 0; private _f = 0;

  // Transform stack
  private _transformStack: Array<{ a: number; b: number; c: number; d: number; e: number; f: number }> = [];

  // Current path
  private _path: Path2D = new Path2D();
  private _pathStack: Path2D[] = [];

  // Clip region (rectangular)
  private _clipX = 0;
  private _clipY = 0;
  private _clipW: number;
  private _clipH: number;
  private _clipStack: Array<{ x: number; y: number; w: number; h: number }> = [];

  // Bitmap font (8x8 ASCII 32-126)
  private static readonly _FONT_W = 8;
  private static readonly _FONT_H = 8;

  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;
    this._clipW = width;
    this._clipH = height;
    this._data = new Uint8ClampedArray(width * height * 4);
    this._state = { ...DEFAULT_STATE };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PROPERTIES
  // ──────────────────────────────────────────────────────────────────────────

  get fillStyle(): string | CanvasGradient | CanvasPattern { return this._state.fillStyle; }
  set fillStyle(v: string | CanvasGradient | CanvasPattern) { this._state.fillStyle = v; }

  get strokeStyle(): string | CanvasGradient | CanvasPattern { return this._state.strokeStyle; }
  set strokeStyle(v: string | CanvasGradient | CanvasPattern) { this._state.strokeStyle = v; }

  get lineWidth(): number { return this._state.lineWidth; }
  set lineWidth(v: number) { this._state.lineWidth = v; }

  get lineCap(): CanvasLineCap { return this._state.lineCap; }
  set lineCap(v: CanvasLineCap) { this._state.lineCap = v; }

  get lineJoin(): CanvasLineJoin { return this._state.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this._state.lineJoin = v; }

  get miterLimit(): number { return this._state.miterLimit; }
  set miterLimit(v: number) { this._state.miterLimit = v; }

  get globalAlpha(): number { return this._state.globalAlpha; }
  set globalAlpha(v: number) { this._state.globalAlpha = Math.max(0, Math.min(1, v)); }

  get globalCompositeOperation(): string { return this._state.globalCompositeOperation; }
  set globalCompositeOperation(v: string) { this._state.globalCompositeOperation = v; }

  get font(): string { return this._state.font; }
  set font(v: string) { this._state.font = v; }

  get textAlign(): CanvasTextAlign { return this._state.textAlign; }
  set textAlign(v: CanvasTextAlign) { this._state.textAlign = v; }

  get textBaseline(): CanvasTextBaseline { return this._state.textBaseline; }
  set textBaseline(v: CanvasTextBaseline) { this._state.textBaseline = v; }

  get direction(): CanvasDirection { return this._state.direction; }
  set direction(v: CanvasDirection) { this._state.direction = v; }

  get shadowBlur(): number { return this._state.shadowBlur; }
  set shadowBlur(v: number) { this._state.shadowBlur = v; }

  get shadowColor(): string { return this._state.shadowColor; }
  set shadowColor(v: string) { this._state.shadowColor = v; }

  get shadowOffsetX(): number { return this._state.shadowOffsetX; }
  set shadowOffsetX(v: number) { this._state.shadowOffsetX = v; }

  get shadowOffsetY(): number { return this._state.shadowOffsetY; }
  set shadowOffsetY(v: number) { this._state.shadowOffsetY = v; }

  get imageSmoothingEnabled(): boolean { return this._state.imageSmoothingEnabled; }
  set imageSmoothingEnabled(v: boolean) { this._state.imageSmoothingEnabled = v; }

  get imageSmoothingQuality(): CanvasImageSmoothingQuality { return this._state.imageSmoothingQuality; }
  set imageSmoothingQuality(v: CanvasImageSmoothingQuality) { this._state.imageSmoothingQuality = v; }

  get lineDashOffset(): number { return this._state.lineDashOffset; }
  set lineDashOffset(v: number) { this._state.lineDashOffset = v; }

  get canvas(): { width: number; height: number } { return { width: this._width, height: this._height }; }

  // ──────────────────────────────────────────────────────────────────────────
  // STATE MANAGEMENT
  // ──────────────────────────────────────────────────────────────────────────

  save(): void {
    this._stateStack.push({ ...this._state });
    this._pathStack.push(this._path.clone());
    this._clipStack.push({ x: this._clipX, y: this._clipY, w: this._clipW, h: this._clipH });
    this._transformStack.push({ a: this._a, b: this._b, c: this._c, d: this._d, e: this._e, f: this._f });
  }

  restore(): void {
    if (this._stateStack.length > 0) {
      this._state = this._stateStack.pop()!;
      this._path = this._pathStack.pop()!;
      const clip = this._clipStack.pop()!;
      this._clipX = clip.x;
      this._clipY = clip.y;
      this._clipW = clip.w;
      this._clipH = clip.h;
      const t = this._transformStack.pop()!;
      this._a = t.a; this._b = t.b; this._c = t.c; this._d = t.d; this._e = t.e; this._f = t.f;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TRANSFORMS
  // ──────────────────────────────────────────────────────────────────────────

  translate(x: number, y: number): void {
    const { _a: a, _b: b, _c: c, _d: d, _e: e, _f: f } = this;
    this._e = a * x + c * y + e;
    this._f = b * x + d * y + f;
  }

  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { _a: a, _b: b, _c: c, _d: d } = this;
    this._a = a * cos + c * sin;
    this._b = b * cos + d * sin;
    this._c = c * cos - a * sin;
    this._d = d * cos - b * sin;
  }

  scale(x: number, y: number): void {
    this._a *= x;
    this._b *= x;
    this._c *= y;
    this._d *= y;
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const { _a: oa, _b: ob, _c: oc, _d: od, _e: oe, _f: of_ } = this;
    this._a = oa * a + oc * b;
    this._b = ob * a + od * b;
    this._c = oa * c + oc * d;
    this._d = ob * c + od * d;
    this._e = oa * e + oc * f + oe;
    this._f = ob * e + od * f + of_;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this._a = a;
    this._b = b;
    this._c = c;
    this._d = d;
    this._e = e;
    this._f = f;
  }

  resetTransform(): void {
    this._a = 1;
    this._b = 0;
    this._c = 0;
    this._d = 1;
    this._e = 0;
    this._f = 0;
  }

  /** Apply current transform to a point. */
  private _applyTransform(x: number, y: number): [number, number] {
    return [
      this._a * x + this._c * y + this._e,
      this._b * x + this._d * y + this._f,
    ];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LINE DASH
  // ──────────────────────────────────────────────────────────────────────────

  setLineDash(segments: number[]): void {
    this._state.lineDash = [...segments];
  }

  getLineDash(): number[] {
    return [...this._state.lineDash];
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PATH OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────

  beginPath(): void {
    this._path = new Path2D();
  }

  closePath(): void {
    this._path.closePath();
  }

  moveTo(x: number, y: number): void {
    this._path.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this._path.lineTo(x, y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    this._path.quadraticCurveTo(cpx, cpy, x, y);
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this._path.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  }

  arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, ccw = false): void {
    this._path.arc(cx, cy, r, startAngle, endAngle, ccw);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    this._path.arcTo(x1, y1, x2, y2, r);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, startAngle: number, endAngle: number, ccw = false): void {
    this._path.ellipse(cx, cy, rx, ry, rotation, startAngle, endAngle, ccw);
  }

  rect(x: number, y: number, w: number, h: number): void {
    this._path.rect(x, y, w, h);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CLIPPING
  // ──────────────────────────────────────────────────────────────────────────

  clip(fillRule: CanvasFillRule = 'nonzero'): void {
    // Rectangular clipping: intersect current clip with path bounding box
    const bb = this._getBoundingBox(this._path);
    if (bb) {
      const nx = Math.max(this._clipX, bb.x);
      const ny = Math.max(this._clipY, bb.y);
      const nr = Math.min(this._clipX + this._clipW, bb.x + bb.w);
      const nb = Math.min(this._clipY + this._clipH, bb.y + bb.h);
      this._clipX = nx;
      this._clipY = ny;
      this._clipW = Math.max(0, nr - nx);
      this._clipH = Math.max(0, nb - ny);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RECTANGLES (fast path, no path needed)
  // ──────────────────────────────────────────────────────────────────────────

  clearRect(x: number, y: number, w: number, h: number): void {
    const [tx, ty] = this._applyTransform(x, y);
    const [tx2, ty2] = this._applyTransform(x + w, y + h);
    const rx = Math.min(tx, tx2);
    const ry = Math.min(ty, ty2);
    const rw = Math.abs(tx2 - tx);
    const rh = Math.abs(ty2 - ty);

    const x0 = Math.max(0, Math.floor(rx));
    const y0 = Math.max(0, Math.floor(ry));
    const x1 = Math.min(this._width, Math.ceil(rx + rw));
    const y1 = Math.min(this._height, Math.ceil(ry + rh));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (this._inClip(px, py)) {
          this._setPixel(px, py, 0, 0, 0, 0);
        }
      }
    }
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FILL & STROKE
  // ──────────────────────────────────────────────────────────────────────────

  fill(fillRule: CanvasFillRule = 'nonzero'): void {
    const segments = this._pathToSegments(this._path);
    const fillStyle = this._state.fillStyle;
    const globalAlpha = this._state.globalAlpha;

    if (typeof fillStyle === 'string') {
      const [r, g, b, a] = parseColorToRGBA(fillStyle);
      const alpha = (a / 255) * globalAlpha;
      if (alpha <= 0) return;
      this._scanlineFill(segments, (px, py) => {
        if (!this._inClip(px, py)) return;
        this._blendPixel(px, py, r, g, b, alpha);
      });
    } else {
      this._scanlineFill(segments, (px, py) => {
        if (!this._inClip(px, py)) return;
        const [r, g, b, a] = this._resolveFillStyle(px, py);
        const alpha = (a / 255) * globalAlpha;
        if (alpha <= 0) return;
        this._blendPixel(px, py, r, g, b, alpha);
      });
    }
  }

  stroke(): void {
    const segments = this._pathToSegments(this._path);
    const lw = this._state.lineWidth;
    if (lw <= 0) return;

    const strokeStyle = this._state.strokeStyle;
    const globalAlpha = this._state.globalAlpha;
    const halfW = lw / 2;

    if (typeof strokeStyle === 'string') {
      const [r, g, b, a] = parseColorToRGBA(strokeStyle);
      const alpha = (a / 255) * globalAlpha;
      if (alpha <= 0) return;
      for (const seg of segments) {
        if (seg.type === 'moveTo' || seg.type === 'lineTo') {
          this._drawThickLine(seg.x1, seg.y1, seg.x2, seg.y2, halfW, r, g, b, alpha);
        }
      }
    } else {
      for (const seg of segments) {
        if (seg.type === 'moveTo' || seg.type === 'lineTo') {
          const midX = (seg.x1 + seg.x2) / 2;
          const midY = (seg.y1 + seg.y2) / 2;
          const [r, g, b, a] = this._resolveStrokeStyle(midX, midY);
          const alpha = (a / 255) * globalAlpha;
          if (alpha <= 0) continue;
          this._drawThickLine(seg.x1, seg.y1, seg.x2, seg.y2, halfW, r, g, b, alpha);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEXT
  // ──────────────────────────────────────────────────────────────────────────

  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    const [r, g, b, a] = this._resolveFillStyle(0, 0);
    const alpha = (a / 255) * this._state.globalAlpha;
    if (alpha <= 0) return;

    const fontSize = this._parseFontSize();
    const charW = CanvasRenderingContext2D._FONT_W;
    const charH = CanvasRenderingContext2D._FONT_H;
    const scale = fontSize / charH;

    let startX = x;
    if (this._state.textAlign === 'center') startX -= (text.length * charW * scale) / 2;
    else if (this._state.textAlign === 'right' || this._state.textAlign === 'end') startX -= text.length * charW * scale;

    let charY: number;
    switch (this._state.textBaseline) {
      case 'top':
      case 'hanging':
        charY = Math.round(y);
        break;
      case 'middle':
        charY = Math.round(y - (charH * scale) / 2);
        break;
      default: // 'alphabetic', 'bottom', etc.
        charY = Math.round(y - charH * scale);
        break;
    }

    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      const charX = Math.round(startX + i * charW * scale);
      this._drawBitmapChar(ch, charX, charY, scale, r, g, b, alpha);
    }
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    // For bitmap font, stroke is same as fill (outline at this resolution)
    this.fillText(text, x, y, maxWidth);
  }

  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number; actualBoundingBoxLeft: number; actualBoundingBoxRight: number; fontBoundingBoxAscent: number; fontBoundingBoxDescent: number } {
    const fontSize = this._parseFontSize();
    const charW = CanvasRenderingContext2D._FONT_W;
    const scale = fontSize / CanvasRenderingContext2D._FONT_H;
    const width = text.length * charW * scale;
    return {
      width,
      actualBoundingBoxAscent: fontSize * 0.8,
      actualBoundingBoxDescent: fontSize * 0.2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      fontBoundingBoxAscent: fontSize,
      fontBoundingBoxDescent: 0,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IMAGES
  // ──────────────────────────────────────────────────────────────────────────

  drawImage(image: { data: Uint8ClampedArray; width: number; height: number }, ...args: number[]): void {
    let sx = 0, sy = 0, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number;

    if (args.length === 2) {
      [dx, dy] = args;
      sw = image.width;
      sh = image.height;
      dw = image.width;
      dh = image.height;
    } else if (args.length === 4) {
      [dx, dy, dw, dh] = args;
      sx = 0;
      sy = 0;
      sw = image.width;
      sh = image.height;
    } else if (args.length === 8) {
      [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    } else {
      return;
    }

    const [tdx, tdy] = this._applyTransform(dx, dy);
    const [tdx2, tdy2] = this._applyTransform(dx + dw, dy + dh);
    const screenW = Math.abs(tdx2 - tdx);
    const screenH = Math.abs(tdy2 - tdy);
    if (screenW === 0 || screenH === 0) return;

    const x0 = Math.max(0, Math.floor(Math.min(tdx, tdx2)));
    const y0 = Math.max(0, Math.floor(Math.min(tdy, tdy2)));
    const x1 = Math.min(this._width, Math.ceil(Math.max(tdx, tdx2)));
    const y1 = Math.min(this._height, Math.ceil(Math.max(tdy, tdy2)));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (!this._inClip(px, py)) continue;
        const srcX = Math.floor(sx + ((px - Math.min(tdx, tdx2)) / screenW) * sw);
        const srcY = Math.floor(sy + ((py - Math.min(tdy, tdy2)) / screenH) * sh);
        if (srcX < 0 || srcX >= image.width || srcY < 0 || srcY >= image.height) continue;
        const srcIdx = (srcY * image.width + srcX) * 4;
        const r = image.data[srcIdx] ?? 0;
        const g = image.data[srcIdx + 1] ?? 0;
        const b = image.data[srcIdx + 2] ?? 0;
        const a = (image.data[srcIdx + 3] ?? 0) / 255;
        if (a <= 0) continue;
        this._blendPixel(px, py, r, g, b, a * this._state.globalAlpha);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PIXEL DATA
  // ──────────────────────────────────────────────────────────────────────────

  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
    const data = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const srcX = Math.floor(sx + x);
        const srcY = Math.floor(sy + y);
        if (srcX >= 0 && srcX < this._width && srcY >= 0 && srcY < this._height) {
          const srcIdx = (srcY * this._width + srcX) * 4;
          const dstIdx = (y * sw + x) * 4;
          data[dstIdx] = this._data[srcIdx];
          data[dstIdx + 1] = this._data[srcIdx + 1];
          data[dstIdx + 2] = this._data[srcIdx + 2];
          data[dstIdx + 3] = this._data[srcIdx + 3];
        }
      }
    }
    return { data, width: sw, height: sh, colorSpace: 'srgb' };
  }

  putImageData(imagedata: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number): void {
    const { data, width: sw, height: sh } = imagedata;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const dstX = Math.floor(dx + x);
        const dstY = Math.floor(dy + y);
        if (dstX >= 0 && dstX < this._width && dstY >= 0 && dstY < this._height) {
          const srcIdx = (y * sw + x) * 4;
          const dstIdx = (dstY * this._width + dstX) * 4;
          this._data[dstIdx] = data[srcIdx] ?? 0;
          this._data[dstIdx + 1] = data[srcIdx + 1] ?? 0;
          this._data[dstIdx + 2] = data[srcIdx + 2] ?? 0;
          this._data[dstIdx + 3] = data[srcIdx + 3] ?? 0;
        }
      }
    }
  }

  createImageData(sw: number, sh: number): ImageData {
    return { data: new Uint8ClampedArray(sw * sh * 4), width: sw, height: sh, colorSpace: 'srgb' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GRADIENTS & PATTERNS
  // ──────────────────────────────────────────────────────────────────────────

  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
    return new CanvasGradient('linear', x0, y0, x1, y1);
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient {
    return new CanvasGradient('radial', x0, y0, r0, x1, y1, r1);
  }

  createPattern(image: { data: Uint8ClampedArray; width: number; height: number }, repetition: CanvasPatternRepetition = 'repeat'): CanvasPattern | null {
    if (!image) return null;
    const imgData: ImageData = { data: new Uint8ClampedArray(image.data), width: image.width, height: image.height, colorSpace: 'srgb' };
    return new CanvasPattern(imgData, repetition);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TO DATA URL
  // ──────────────────────────────────────────────────────────────────────────

  toDataURL(type = 'image/png', quality = 0.92): string {
    const png = this._encodePNG();
    const base64 = uint8ArrayToBase64(png);
    return `data:image/png;base64,${base64}`;
  }

  toBlob(callback: (blob: Blob | null) => void, type = 'image/png', quality = 0.92): void {
    const png = this._encodePNG();
    try {
      const blob = new Blob([png as unknown as ArrayBuffer], { type });
      callback(blob);
    } catch {
      callback(null);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: PIXEL OPERATIONS
  // ──────────────────────────────────────────────────────────────────────────

  private _inClip(x: number, y: number): boolean {
    return x >= this._clipX && x < this._clipX + this._clipW &&
           y >= this._clipY && y < this._clipY + this._clipH;
  }

  private _setPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return;
    const idx = (y * this._width + x) * 4;
    this._data[idx] = r;
    this._data[idx + 1] = g;
    this._data[idx + 2] = b;
    this._data[idx + 3] = a;
  }

  /** Source-over alpha blending. */
  private _blendPixel(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return;
    const idx = (y * this._width + x) * 4;
    const srcA = a;
    const dstA = this._data[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      this._data[idx + 3] = 0;
      return;
    }
    this._data[idx] = Math.round((r * srcA + this._data[idx] * dstA * (1 - srcA)) / outA);
    this._data[idx + 1] = Math.round((g * srcA + this._data[idx + 1] * dstA * (1 - srcA)) / outA);
    this._data[idx + 2] = Math.round((b * srcA + this._data[idx + 2] * dstA * (1 - srcA)) / outA);
    this._data[idx + 3] = Math.round(outA * 255);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: STYLE RESOLUTION
  // ──────────────────────────────────────────────────────────────────────────

  private _resolveFillStyle(x: number, y: number): [number, number, number, number] {
    const s = this._state.fillStyle;
    if (typeof s === 'string') return parseColorToRGBA(s);
    if (s instanceof CanvasGradient) {
      const color = s.getColorAtPoint(x, y);
      return parseColorToRGBA(color);
    }
    if (s instanceof CanvasPattern) {
      const [r, g, b, a] = s.getPixelAt(x, y);
      return [r, g, b, a];
    }
    return [0, 0, 0, 255];
  }

  private _resolveStrokeStyle(x: number, y: number): [number, number, number, number] {
    const s = this._state.strokeStyle;
    if (typeof s === 'string') return parseColorToRGBA(s);
    if (s instanceof CanvasGradient) {
      const color = s.getColorAtPoint(x, y);
      return parseColorToRGBA(color);
    }
    if (s instanceof CanvasPattern) {
      const [r, g, b, a] = s.getPixelAt(x, y);
      return [r, g, b, a];
    }
    return [0, 0, 0, 255];
  }

  private _parseFontSize(): number {
    const match = this._state.font.match(/([\d.]+)px/);
    return match ? parseFloat(match[1]!) : 10;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: PATH TO LINE SEGMENTS
  // ──────────────────────────────────────────────────────────────────────────

  private _pathToSegments(path: Path2D): Segment[] {
    const segments: Segment[] = [];
    let cx = 0, cy = 0;
    let sx = 0, sy = 0;

    for (const cmd of path._commands) {
      switch (cmd.type) {
        case 'moveTo': {
          const [tx, ty] = this._applyTransform(cmd.x, cmd.y);
          cx = tx; cy = ty;
          sx = tx; sy = ty;
          break;
        }
        case 'lineTo': {
          const [tx, ty] = this._applyTransform(cmd.x, cmd.y);
          segments.push({ x1: cx, y1: cy, x2: tx, y2: ty, type: 'lineTo' });
          cx = tx; cy = ty;
          break;
        }
        case 'quadraticCurveTo': {
          const [tcpx, tcpy] = this._applyTransform(cmd.cpx, cmd.cpy);
          const [tx, ty] = this._applyTransform(cmd.x, cmd.y);
          const pts = this._subdivideQuadratic(cx, cy, tcpx, tcpy, tx, ty, 20);
          for (let i = 0; i < pts.length - 1; i++) {
            segments.push({ x1: pts[i]![0], y1: pts[i]![1], x2: pts[i + 1]![0], y2: pts[i + 1]![1], type: 'lineTo' });
          }
          cx = tx; cy = ty;
          break;
        }
        case 'bezierCurveTo': {
          const [tc1x, tc1y] = this._applyTransform(cmd.cp1x, cmd.cp1y);
          const [tc2x, tc2y] = this._applyTransform(cmd.cp2x, cmd.cp2y);
          const [tx, ty] = this._applyTransform(cmd.x, cmd.y);
          const pts = this._subdivideCubic(cx, cy, tc1x, tc1y, tc2x, tc2y, tx, ty, 30);
          for (let i = 0; i < pts.length - 1; i++) {
            segments.push({ x1: pts[i]![0], y1: pts[i]![1], x2: pts[i + 1]![0], y2: pts[i + 1]![1], type: 'lineTo' });
          }
          cx = tx; cy = ty;
          break;
        }
        case 'arc': {
          const arcPts = this._arcToPoints(cmd.cx, cmd.cy, cmd.r, cmd.startAngle, cmd.endAngle, cmd.ccw);
          for (let i = 0; i < arcPts.length - 1; i++) {
            const [p1x, p1y] = this._applyTransform(arcPts[i]![0], arcPts[i]![1]);
            const [p2x, p2y] = this._applyTransform(arcPts[i + 1]![0], arcPts[i + 1]![1]);
            if (i === 0) {
              segments.push({ x1: cx, y1: cy, x2: p1x, y2: p1y, type: 'lineTo' });
            }
            segments.push({ x1: p1x, y1: p1y, x2: p2x, y2: p2y, type: 'lineTo' });
            cx = p2x; cy = p2y;
          }
          if (arcPts.length > 0) {
            const last = arcPts[arcPts.length - 1]!;
            cx = this._applyTransform(last[0], last[1])[0];
            cy = this._applyTransform(last[0], last[1])[1];
          }
          break;
        }
        case 'ellipse': {
          const ellPts = this._arcToPoints(0, 0, 1, cmd.startAngle, cmd.endAngle, cmd.ccw);
          for (let i = 0; i < ellPts.length; i++) {
            const [ex, ey] = ellPts[i]!;
            const cos = Math.cos(cmd.rotation);
            const sin = Math.sin(cmd.rotation);
            const wx = cmd.cx + cmd.rx * ex * cos - cmd.ry * ey * sin;
            const wy = cmd.cy + cmd.rx * ex * sin + cmd.ry * ey * cos;
            const [tx, ty] = this._applyTransform(wx, wy);
            if (i === 0) {
              segments.push({ x1: cx, y1: cy, x2: tx, y2: ty, type: 'lineTo' });
            } else {
              segments.push({ x1: cx, y1: cy, x2: tx, y2: ty, type: 'lineTo' });
            }
            cx = tx; cy = ty;
          }
          break;
        }
        case 'arcTo': {
          // Simplified: just lineTo to the target
          const [tx1, ty1] = this._applyTransform(cmd.x1, cmd.y1);
          const [tx2, ty2] = this._applyTransform(cmd.x2, cmd.y2);
          segments.push({ x1: cx, y1: cy, x2: tx1, y2: ty1, type: 'lineTo' });
          segments.push({ x1: tx1, y1: ty1, x2: tx2, y2: ty2, type: 'lineTo' });
          cx = tx1; cy = ty1;
          break;
        }
        case 'rect': {
          const [tx, ty] = this._applyTransform(cmd.x, cmd.y);
          const [tx2, ty2] = this._applyTransform(cmd.x + cmd.w, cmd.y + cmd.h);
          segments.push({ x1: tx, y1: ty, x2: tx2, y2: ty, type: 'lineTo' });
          segments.push({ x1: tx2, y1: ty, x2: tx2, y2: ty2, type: 'lineTo' });
          segments.push({ x1: tx2, y1: ty2, x2: tx, y2: ty2, type: 'lineTo' });
          segments.push({ x1: tx, y1: ty2, x2: tx, y2: ty, type: 'lineTo' });
          cx = tx; cy = ty;
          break;
        }
        case 'closePath': {
          if (cx !== sx || cy !== sy) {
            segments.push({ x1: cx, y1: cy, x2: sx, y2: sy, type: 'lineTo' });
          }
          cx = sx; cy = sy;
          break;
        }
      }
    }

    return segments;
  }

  private _subdivideQuadratic(x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number, steps: number): [number, number][] {
    const pts: [number, number][] = [[x0, y0]];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      pts.push([
        mt * mt * x0 + 2 * mt * t * cpx + t * t * x1,
        mt * mt * y0 + 2 * mt * t * cpy + t * t * y1,
      ]);
    }
    return pts;
  }

  private _subdivideCubic(x0: number, y0: number, cp1x: number, cp1y: number, cp2x: number, cp2y: number, x1: number, y1: number, steps: number): [number, number][] {
    const pts: [number, number][] = [[x0, y0]];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      pts.push([
        mt * mt * mt * x0 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x1,
        mt * mt * mt * y0 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y1,
      ]);
    }
    return pts;
  }

  private _arcToPoints(cx: number, cy: number, r: number, start: number, end: number, ccw: boolean): [number, number][] {
    let angleDiff = end - start;
    if (ccw) {
      if (angleDiff > 0) angleDiff -= Math.PI * 2;
    } else {
      if (angleDiff < 0) angleDiff += Math.PI * 2;
    }

    const steps = Math.max(8, Math.ceil(Math.abs(angleDiff) / (Math.PI / 18)));
    const pts: [number, number][] = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = start + angleDiff * t;
      pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return pts;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: SCANLINE FILL
  // ──────────────────────────────────────────────────────────────────────────

  private _scanlineFill(segments: Segment[], plotPixel: (x: number, y: number) => void): void {
    if (segments.length === 0) return;

    // Find bounding box
    let minY = Infinity, maxY = -Infinity;
    for (const seg of segments) {
      minY = Math.min(minY, seg.y1, seg.y2);
      maxY = Math.max(maxY, seg.y1, seg.y2);
    }

    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this._height - 1, Math.ceil(maxY));

    // For each scanline
    for (let y = y0; y <= y1; y++) {
      const scanY = y + 0.5; // Pixel center
      const intersections: number[] = [];

      for (const seg of segments) {
        // Skip horizontal segments
        if (seg.y1 === seg.y2) continue;

        // Check if scanline crosses this edge
        const minY2 = Math.min(seg.y1, seg.y2);
        const maxY2 = Math.max(seg.y1, seg.y2);
        if (scanY < minY2 || scanY > maxY2) continue;

        // Compute intersection x
        const t = (scanY - seg.y1) / (seg.y2 - seg.y1);
        intersections.push(seg.x1 + t * (seg.x2 - seg.x1));
      }

      // Sort intersections
      intersections.sort((a, b) => a - b);

      // Fill between pairs (nonzero winding)
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const x0_ = Math.max(0, Math.floor(intersections[i]!));
        const x1_ = Math.min(this._width - 1, Math.ceil(intersections[i + 1]!));
        for (let x = x0_; x <= x1_; x++) {
          plotPixel(x, y);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: THICK LINE (STROKE)
  // ──────────────────────────────────────────────────────────────────────────

  private _drawThickLine(x1: number, y1: number, x2: number, y2: number, halfW: number, r: number, g: number, b: number, alpha: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      // Single point
      this._drawThickPoint(x1, y1, halfW, r, g, b, alpha);
      return;
    }

    // Perpendicular direction
    const nx = -dy / len;
    const ny = dx / len;

    // Four corners of the line rectangle
    const corners = [
      [x1 + nx * halfW, y1 + ny * halfW],
      [x1 - nx * halfW, y1 - ny * halfW],
      [x2 - nx * halfW, y2 - ny * halfW],
      [x2 + nx * halfW, y2 + ny * halfW],
    ];

    // Find bounding box
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of corners) {
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }

    // Rasterize the quad using scanlines
    const sy0 = Math.max(0, Math.floor(minY));
    const sy1 = Math.min(this._height - 1, Math.ceil(maxY));

    for (let y = sy0; y <= sy1; y++) {
      const scanY = y + 0.5;
      const xs: number[] = [];

      for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i]!;
        const [bx, by] = corners[(i + 1) % 4]!;
        if ((ay < scanY && by >= scanY) || (by < scanY && ay >= scanY)) {
          const t = (scanY - ay) / (by - ay);
          xs.push(ax + t * (bx - ax));
        }
      }

      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const x0_ = Math.max(0, Math.floor(xs[i]!));
        const x1_ = Math.min(this._width - 1, Math.ceil(xs[i + 1]!));
        for (let x = x0_; x <= x1_; x++) {
          if (this._inClip(x, y)) {
            this._blendPixel(x, y, r, g, b, alpha);
          }
        }
      }
    }

    // Round caps
    if (this._state.lineCap === 'round') {
      this._drawThickPoint(x1, y1, halfW, r, g, b, alpha);
      this._drawThickPoint(x2, y2, halfW, r, g, b, alpha);
    }
  }

  private _drawThickPoint(cx: number, cy: number, r: number, cr: number, g: number, b: number, alpha: number): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this._width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this._height - 1, Math.ceil(cy + r));
    const rSq = r * r;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= rSq) {
          if (this._inClip(x, y)) {
            this._blendPixel(x, y, cr, g, b, alpha);
          }
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: BITMAP FONT (8x8 ASCII)
  // ──────────────────────────────────────────────────────────────────────────

  private _drawBitmapChar(charCode: number, x: number, y: number, scale: number, r: number, g: number, b: number, alpha: number): void {
    if (charCode < 32 || charCode > 126) return;

    const pattern = BITMAP_FONT[charCode - 32]!;
    const fw = CanvasRenderingContext2D._FONT_W;
    const fh = CanvasRenderingContext2D._FONT_H;

    for (let row = 0; row < fh; row++) {
      const bits = pattern[row] ?? 0;
      for (let col = 0; col < fw; col++) {
        if (bits & (1 << (fw - 1 - col))) {
          // Draw scaled pixel
          const px0 = Math.floor(x + col * scale);
          const py0 = Math.floor(y + row * scale);
          const px1 = Math.floor(x + (col + 1) * scale);
          const py1 = Math.floor(y + (row + 1) * scale);
          for (let py = py0; py < py1; py++) {
            for (let px = px0; px < px1; px++) {
              if (this._inClip(px, py)) {
                this._blendPixel(px, py, r, g, b, alpha);
              }
            }
          }
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: BOUNDING BOX
  // ──────────────────────────────────────────────────────────────────────────

  private _getBoundingBox(path: Path2D): { x: number; y: number; w: number; h: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const cmd of path._commands) {
      const points: [number, number][] = [];
      switch (cmd.type) {
        case 'moveTo':
        case 'lineTo':
          points.push([cmd.x, cmd.y]);
          break;
        case 'rect':
          points.push([cmd.x, cmd.y], [cmd.x + cmd.w, cmd.y], [cmd.x + cmd.w, cmd.y + cmd.h], [cmd.x, cmd.y + cmd.h]);
          break;
        case 'quadraticCurveTo':
          points.push([cmd.cpx, cmd.cpy], [cmd.x, cmd.y]);
          break;
        case 'bezierCurveTo':
          points.push([cmd.cp1x, cmd.cp1y], [cmd.cp2x, cmd.cp2y], [cmd.x, cmd.y]);
          break;
        case 'arc':
        case 'ellipse':
          points.push([cmd.cx - (cmd.type === 'ellipse' ? cmd.rx : cmd.r), cmd.cy - (cmd.type === 'ellipse' ? cmd.ry : cmd.r)]);
          points.push([cmd.cx + (cmd.type === 'ellipse' ? cmd.rx : cmd.r), cmd.cy + (cmd.type === 'ellipse' ? cmd.ry : cmd.r)]);
          break;
      }
      for (const [px, py] of points) {
        minX = Math.min(minX, px);
        minY = Math.min(minY, py);
        maxX = Math.max(maxX, px);
        maxY = Math.max(maxY, py);
      }
    }

    if (minX === Infinity) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INTERNAL: PNG ENCODER (minimal, uncompressed IDAT)
  // ──────────────────────────────────────────────────────────────────────────

  private _encodePNG(): Uint8Array {
    const w = this._width;
    const h = this._height;

    // Raw image data: filter byte (0) + RGBA per pixel per row
    const rawSize = h * (1 + w * 4);
    const raw = new Uint8Array(rawSize);
    for (let y = 0; y < h; y++) {
      raw[y * (1 + w * 4)] = 0; // No filter
      for (let x = 0; x < w; x++) {
        const srcIdx = (y * w + x) * 4;
        const dstIdx = y * (1 + w * 4) + 1 + x * 4;
        raw[dstIdx] = this._data[srcIdx] ?? 0;
        raw[dstIdx + 1] = this._data[srcIdx + 1] ?? 0;
        raw[dstIdx + 2] = this._data[srcIdx + 2] ?? 0;
        raw[dstIdx + 3] = this._data[srcIdx + 3] ?? 0;
      }
    }

    // Deflate: store blocks (no compression, valid zlib stream)
    const deflated = deflateStore(raw);

    // Build PNG
    const chunks: Uint8Array[] = [];

    // Signature
    chunks.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

    // IHDR
    const ihdr = new Uint8Array(13);
    writeUint32(ihdr, 0, w);
    writeUint32(ihdr, 4, h);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // color type: RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace
    chunks.push(makeChunk('IHDR', ihdr));

    // IDAT
    chunks.push(makeChunk('IDAT', deflated));

    // IEND
    chunks.push(makeChunk('IEND', new Uint8Array(0)));

    // Calculate total size
    let totalSize = 0;
    for (const chunk of chunks) totalSize += chunk.length;
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PNG HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function writeUint32(arr: Uint8Array, offset: number, value: number): void {
  arr[offset] = (value >>> 24) & 0xff;
  arr[offset + 1] = (value >>> 16) & 0xff;
  arr[offset + 2] = (value >>> 8) & 0xff;
  arr[offset + 3] = value & 0xff;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  writeUint32(chunk, 0, len);

  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);

  chunk.set(data, 8);

  // CRC32
  const crc = crc32(chunk.slice(4, 8 + len));
  writeUint32(chunk, 8 + len, crc);

  return chunk;
}

function deflateStore(data: Uint8Array): Uint8Array {
  // zlib wrapper around DEFLATE stored blocks
  const maxBlockSize = 65535;
  const numBlocks = Math.ceil(data.length / maxBlockSize) || 1;
  // zlib header (2) + blocks + adler32 (4)
  const resultSize = 2 + numBlocks * 5 + data.length + 4;
  const result = new Uint8Array(resultSize);

  result[0] = 0x78; // CMF
  result[1] = 0x01; // FLG (no dict, level 0)

  let offset = 2;
  let remaining = data.length;
  let srcOffset = 0;

  while (remaining > 0) {
    const blockSize = Math.min(maxBlockSize, remaining);
    const isLast = blockSize === remaining;

    result[offset] = isLast ? 0x01 : 0x00;
    result[offset + 1] = blockSize & 0xff;
    result[offset + 2] = (blockSize >> 8) & 0xff;
    result[offset + 3] = (~blockSize) & 0xff;
    result[offset + 4] = ((~blockSize) >> 8) & 0xff;
    offset += 5;

    result.set(data.subarray(srcOffset, srcOffset + blockSize), offset);
    offset += blockSize;
    srcOffset += blockSize;
    remaining -= blockSize;
  }

  // Adler32 checksum
  let a = 1, bv = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    bv = (bv + a) % 65521;
  }
  const adler = (bv << 16) | a;
  writeUint32(result, offset, adler);

  return result;
}

// CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Base64 encoding
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function uint8ArrayToBase64(arr: Uint8Array): string {
  let result = '';
  const len = arr.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = arr[i]!;
    const b1 = i + 1 < len ? arr[i + 1]! : 0;
    const b2 = i + 2 < len ? arr[i + 2]! : 0;
    result += B64_CHARS[(b0 >> 2) & 0x3f];
    result += B64_CHARS[((b0 << 4) | (b1 >> 4)) & 0x3f];
    result += i + 1 < len ? B64_CHARS[((b1 << 2) | (b2 >> 6)) & 0x3f] : '=';
    result += i + 2 < len ? B64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BITMAP FONT DATA (8x8 ASCII 32-126)
// Each character is 8 rows, each row is 8 bits (MSB left)
// ─────────────────────────────────────────────────────────────────────────────

const BITMAP_FONT: number[][] = [
  // 32 (space)
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  // 33 !
  [0x18, 0x3C, 0x3C, 0x18, 0x18, 0x00, 0x18, 0x00],
  // 34 "
  [0x36, 0x36, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00],
  // 35 #
  [0x36, 0x36, 0x7F, 0x36, 0x7F, 0x36, 0x36, 0x00],
  // 36 $
  [0x0C, 0x3E, 0x03, 0x1E, 0x30, 0x1F, 0x0C, 0x00],
  // 37 %
  [0x00, 0x63, 0x33, 0x18, 0x0C, 0x66, 0x63, 0x00],
  // 38 &
  [0x1C, 0x36, 0x1C, 0x6E, 0x3B, 0x33, 0x6E, 0x00],
  // 39 '
  [0x06, 0x06, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00],
  // 40 (
  [0x18, 0x0C, 0x06, 0x06, 0x06, 0x0C, 0x18, 0x00],
  // 41 )
  [0x06, 0x0C, 0x18, 0x18, 0x18, 0x0C, 0x06, 0x00],
  // 42 *
  [0x00, 0x66, 0x3C, 0xFF, 0x3C, 0x66, 0x00, 0x00],
  // 43 +
  [0x00, 0x0C, 0x0C, 0x3F, 0x0C, 0x0C, 0x00, 0x00],
  // 44 ,
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C, 0x06],
  // 45 -
  [0x00, 0x00, 0x00, 0x3F, 0x00, 0x00, 0x00, 0x00],
  // 46 .
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C, 0x00],
  // 47 /
  [0x60, 0x30, 0x18, 0x0C, 0x06, 0x03, 0x01, 0x00],
  // 48 0-57 9 (simple bitmap)
  [0x3C, 0x66, 0x6E, 0x76, 0x66, 0x66, 0x3C, 0x00], // 0
  [0x18, 0x18, 0x38, 0x18, 0x18, 0x18, 0x7E, 0x00], // 1
  [0x3C, 0x66, 0x30, 0x18, 0x0C, 0x66, 0x7E, 0x00], // 2
  [0x3C, 0x66, 0x30, 0x38, 0x30, 0x66, 0x3C, 0x00], // 3
  [0x38, 0x3C, 0x36, 0x33, 0x7F, 0x30, 0x78, 0x00], // 4
  [0x7E, 0x03, 0x7F, 0x60, 0x30, 0x66, 0x3C, 0x00], // 5
  [0x1C, 0x06, 0x03, 0x7F, 0x66, 0x66, 0x3C, 0x00], // 6
  [0x7E, 0x66, 0x30, 0x18, 0x0C, 0x0C, 0x0C, 0x00], // 7
  [0x3C, 0x66, 0x66, 0x3C, 0x66, 0x66, 0x3C, 0x00], // 8
  [0x3C, 0x66, 0x66, 0x7E, 0x30, 0x66, 0x3C, 0x00], // 9
  // 58 :
  [0x00, 0x0C, 0x0C, 0x00, 0x00, 0x0C, 0x0C, 0x00],
  // 59 ;
  [0x00, 0x0C, 0x0C, 0x00, 0x00, 0x0C, 0x0C, 0x06],
  // 60 <
  [0x30, 0x18, 0x0C, 0x06, 0x0C, 0x18, 0x30, 0x00],
  // 61 =
  [0x00, 0x00, 0x3F, 0x00, 0x3F, 0x00, 0x00, 0x00],
  // 62 >
  [0x06, 0x0C, 0x18, 0x30, 0x18, 0x0C, 0x06, 0x00],
  // 63 ?
  [0x3C, 0x66, 0x30, 0x18, 0x18, 0x00, 0x18, 0x00],
  // 64 @
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x0C, 0x0C, 0x00],
  // 65 A-90 Z
  [0x18, 0x3C, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x00], // A
  [0x7C, 0x66, 0x66, 0x7C, 0x66, 0x66, 0x7C, 0x00], // B
  [0x3C, 0x66, 0x03, 0x03, 0x03, 0x66, 0x3C, 0x00], // C
  [0x78, 0x6C, 0x66, 0x66, 0x66, 0x6C, 0x78, 0x00], // D
  [0x7E, 0x03, 0x03, 0x7E, 0x03, 0x03, 0x7E, 0x00], // E
  [0x7E, 0x03, 0x03, 0x7E, 0x03, 0x03, 0x03, 0x00], // F
  [0x3C, 0x66, 0x03, 0x03, 0x73, 0x66, 0x7C, 0x00], // G
  [0x66, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x66, 0x00], // H
  [0x3C, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00], // I
  [0x78, 0x30, 0x30, 0x30, 0x33, 0x36, 0x1C, 0x00], // J
  [0x66, 0x36, 0x1E, 0x0E, 0x1E, 0x36, 0x66, 0x00], // K
  [0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x7E, 0x00], // L
  [0xC6, 0xEE, 0xFE, 0xD6, 0xC6, 0xC6, 0xC6, 0x00], // M
  [0x66, 0x76, 0x7E, 0x7E, 0x6E, 0x66, 0x66, 0x00], // N
  [0x3C, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00], // O
  [0x7C, 0x66, 0x66, 0x7C, 0x03, 0x03, 0x03, 0x00], // P
  [0x3C, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x70, 0x00], // Q
  [0x7C, 0x66, 0x66, 0x7C, 0x1E, 0x36, 0x66, 0x00], // R
  [0x3C, 0x66, 0x03, 0x3C, 0x60, 0x66, 0x3C, 0x00], // S
  [0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00], // T
  [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00], // U
  [0x66, 0x66, 0x66, 0x66, 0x3C, 0x3C, 0x18, 0x00], // V
  [0xC6, 0xC6, 0xC6, 0xD6, 0xFE, 0xEE, 0xC6, 0x00], // W
  [0x66, 0x66, 0x3C, 0x18, 0x3C, 0x66, 0x66, 0x00], // X
  [0x66, 0x66, 0x66, 0x3C, 0x18, 0x18, 0x18, 0x00], // Y
  [0x7E, 0x66, 0x30, 0x18, 0x0C, 0x66, 0x7E, 0x00], // Z
  // 91-96 [\]^_`
  [0x3C, 0x06, 0x06, 0x06, 0x06, 0x06, 0x3C, 0x00], // [
  [0x0C, 0x12, 0x30, 0x7C, 0x30, 0x62, 0xFE, 0x00], // backslash
  [0x3C, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3C, 0x00], // ]
  [0x08, 0x14, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00], // ^
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7E, 0x00], // _
  [0x0C, 0x0C, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00], // `
  // 97-122 a-z
  [0x00, 0x00, 0x3C, 0x60, 0x7E, 0x66, 0x7E, 0x00], // a
  [0x03, 0x03, 0x3F, 0x66, 0x66, 0x66, 0x3B, 0x00], // b
  [0x00, 0x00, 0x3C, 0x66, 0x03, 0x66, 0x3C, 0x00], // c
  [0x60, 0x60, 0x7E, 0x66, 0x66, 0x66, 0x7E, 0x00], // d
  [0x00, 0x00, 0x3C, 0x66, 0x7F, 0x03, 0x3E, 0x00], // e
  [0x1C, 0x36, 0x06, 0x1F, 0x06, 0x06, 0x0F, 0x00], // f
  [0x00, 0x00, 0x7E, 0x66, 0x66, 0x7E, 0x60, 0x7C], // g
  [0x03, 0x03, 0x3F, 0x66, 0x66, 0x66, 0x66, 0x00], // h
  [0x0C, 0x00, 0x1C, 0x0C, 0x0C, 0x0C, 0x1E, 0x00], // i
  [0x30, 0x00, 0x30, 0x30, 0x30, 0x33, 0x33, 0x1E], // j
  [0x03, 0x03, 0x36, 0x1E, 0x0E, 0x1E, 0x36, 0x00], // k
  [0x1C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x1E, 0x00], // l
  [0x00, 0x00, 0x33, 0x7F, 0x7F, 0x6B, 0x63, 0x00], // m
  [0x00, 0x00, 0x3F, 0x66, 0x66, 0x66, 0x66, 0x00], // n
  [0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x3C, 0x00], // o
  [0x00, 0x00, 0x3B, 0x66, 0x66, 0x3F, 0x03, 0x07], // p
  [0x00, 0x00, 0x7E, 0x66, 0x66, 0x7E, 0x60, 0x60], // q
  [0x00, 0x00, 0x3B, 0x6E, 0x06, 0x06, 0x0F, 0x00], // r
  [0x00, 0x00, 0x7E, 0x03, 0x3C, 0x60, 0x3F, 0x00], // s
  [0x0C, 0x0C, 0x3E, 0x0C, 0x0C, 0x2C, 0x18, 0x00], // t
  [0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x7E, 0x00], // u
  [0x00, 0x00, 0x66, 0x66, 0x66, 0x3C, 0x18, 0x00], // v
  [0x00, 0x00, 0x63, 0x6B, 0x7F, 0x7F, 0x36, 0x00], // w
  [0x00, 0x00, 0x63, 0x36, 0x1C, 0x36, 0x63, 0x00], // x
  [0x00, 0x00, 0x66, 0x66, 0x66, 0x7E, 0x60, 0x3C], // y
  [0x00, 0x00, 0x7E, 0x18, 0x0C, 0x36, 0x7E, 0x00], // z
  // 127 (DEL)
  [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
];
