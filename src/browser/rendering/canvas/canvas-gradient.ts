/**
 * @file canvas/canvas-gradient.ts
 * CanvasGradient class — linear and radial gradients for Canvas 2D.
 */

import type { ColorStop } from './canvas-types';

export class CanvasGradient {
  readonly type: 'linear' | 'radial';
  private _stops: ColorStop[] = [];

  // Linear gradient params
  private _x0: number;
  private _y0: number;
  private _x1: number;
  private _y1: number;

  // Radial gradient params
  private _cx0: number;
  private _cy0: number;
  private _r0: number;
  private _cx1: number;
  private _cy1: number;
  private _r1: number;

  constructor(type: 'linear' | 'radial', ...args: number[]) {
    this.type = type;
    if (type === 'linear') {
      [this._x0, this._y0, this._x1, this._y1] = args;
      this._cx0 = 0; this._cy0 = 0; this._r0 = 0;
      this._cx1 = 0; this._cy1 = 0; this._r1 = 0;
    } else {
      [this._cx0, this._cy0, this._r0, this._cx1, this._cy1, this._r1] = args;
      this._x0 = 0; this._y0 = 0; this._x1 = 0; this._y1 = 0;
    }
  }

  addColorStop(offset: number, color: string): void {
    if (offset < 0 || offset > 1) throw new TypeError('Offset must be between 0 and 1');
    this._stops.push({ offset, color });
    this._stops.sort((a, b) => a.offset - b.offset);
  }

  get stops(): readonly ColorStop[] { return this._stops; }

  /** Compute the interpolated color at a given position. */
  getColorAt(t: number): string {
    if (this._stops.length === 0) return '#000000';
    if (this._stops.length === 1) return this._stops[0]!.color;
    if (t <= this._stops[0]!.offset) return this._stops[0]!.color;
    if (t >= this._stops[this._stops.length - 1]!.offset) return this._stops[this._stops.length - 1]!.color;

    for (let i = 0; i < this._stops.length - 1; i++) {
      const s0 = this._stops[i]!;
      const s1 = this._stops[i + 1]!;
      if (t >= s0.offset && t <= s1.offset) {
        const range = s1.offset - s0.offset;
        const localT = range === 0 ? 0 : (t - s0.offset) / range;
        return interpolateColor(s0.color, s1.color, localT);
      }
    }
    return this._stops[this._stops.length - 1]!.color;
  }

  /** Compute the gradient parameter (0..1) for a point. */
  getParameterAt(x: number, y: number): number {
    if (this.type === 'linear') {
      const dx = this._x1 - this._x0;
      const dy = this._y1 - this._y0;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) return 0;
      const px = x - this._x0;
      const py = y - this._y0;
      return Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
    } else {
      // Radial gradient
      const dx = this._cx1 - this._cx0;
      const dy = this._cy1 - this._cy0;
      const dist = Math.sqrt((x - this._cx0) ** 2 + (y - this._cy0) ** 2);
      const maxDist = this._r1 + Math.sqrt(dx * dx + dy * dy);
      return maxDist === 0 ? 0 : Math.max(0, Math.min(1, dist / maxDist));
    }
  }

  /** Linear interpolation for gradient parameters (approximate for radial). */
  getColorAtPoint(x: number, y: number): string {
    const t = this.getParameterAt(x, y);
    return this.getColorAt(t);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR INTERPOLATION
// ─────────────────────────────────────────────────────────────────────────────

function parseColor(color: string): [number, number, number, number] {
  const c = color.trim().toLowerCase();
  // Hex
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0], 16),
        parseInt(hex[1]! + hex[1], 16),
        parseInt(hex[2]! + hex[2], 16),
        255,
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        255,
      ];
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16),
      ];
    }
  }
  // rgb/rgba
  const rgbaMatch = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbaMatch) {
    return [
      parseInt(rgbaMatch[1]!, 10),
      parseInt(rgbaMatch[2]!, 10),
      parseInt(rgbaMatch[3]!, 10),
      rgbaMatch[4] !== undefined ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255,
    ];
  }
  // Named colors (basic)
  const NAMED: Record<string, [number, number, number, number]> = {
    black: [0, 0, 0, 255], white: [255, 255, 255, 255],
    red: [255, 0, 0, 255], green: [0, 128, 0, 255], blue: [0, 0, 255, 255],
    transparent: [0, 0, 0, 0],
  };
  return NAMED[c] ?? [0, 0, 0, 255];
}

function interpolateColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1, a1] = parseColor(c1);
  const [r2, g2, b2, a2] = parseColor(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = Math.round(a1 + (a2 - a1) * t);
  if (a === 255) return `rgb(${r},${g},${b})`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}
