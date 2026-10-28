import type { RGBA } from './rasterizer';
import { parseColor } from './rasterizer';

export type GradientType = 'linear' | 'radial' | 'conic' | 'repeating-linear' | 'repeating-radial';

export interface ColorStop {
  color: RGBA;
  offset: number;
}

export interface GradientInfo {
  type: GradientType;
  angle: number;
  shape: 'circle' | 'ellipse';
  size: string;
  position: { cx: number; cy: number };
  stops: ColorStop[];
  repetitions: boolean;
  /** Explicit radial size (`120% 140%`, `40px`), as fractions of the box (rx of width, ry of height). */
  radii?: { rx: number; ry: number; px?: { rx: number; ry: number } };
}

export function isGradientValue(val: string): boolean {
  if (!val) return false;
  const s = val.trim().toLowerCase();
  return s.startsWith('linear-gradient(') ||
    s.startsWith('radial-gradient(') ||
    s.startsWith('conic-gradient(') ||
    s.startsWith('repeating-linear-gradient(') ||
    s.startsWith('repeating-radial-gradient(');
}

function parseAngle(angleStr: string): number {
  const s = angleStr.trim();
  if (s.endsWith('deg')) return parseFloat(s) || 0;
  if (s.endsWith('rad')) return (parseFloat(s) || 0) * 180 / Math.PI;
  if (s.endsWith('grad')) return (parseFloat(s) || 0) * 0.9;
  if (s.endsWith('turn')) return (parseFloat(s) || 0) * 360;
  if (s === 'to top') return 0;
  if (s === 'to right') return 90;
  if (s === 'to bottom') return 180;
  if (s === 'to left') return 270;
  if (s === 'to top right' || s === 'to right top') return 45;
  if (s === 'to top left' || s === 'to left top') return 315;
  if (s === 'to bottom right' || s === 'to right bottom') return 135;
  if (s === 'to bottom left' || s === 'to left bottom') return 225;
  return 180;
}

function parseStops(args: string): ColorStop[] {
  const stops: ColorStop[] = [];
  const parts = splitGradientStops(args);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // A colour, then one or two positions (`#2f8f4e 45%`, `rgba(0,0,0,.5) 10%`, `#fff 0 40%`).
    // The colour part used to be required to contain no digits, so every hex or rgb() stop with a
    // position failed to parse and painted black.
    const match = trimmed.match(/^(.*?)\s+(-?\d*\.?\d+(?:%|px)?)(?:\s+(-?\d*\.?\d+(?:%|px)?))?$/);
    if (match) {
      const color = parseColor(match[1].trim());
      // ponytail: px positions need the gradient length; they become automatic positions.
      const offsetOf = (t: string) => (t.endsWith('%') ? (parseFloat(t) || 0) / 100 : t.endsWith('px') ? -1 : parseFloat(t) || 0);
      stops.push({ color, offset: offsetOf(match[2]) });
      if (match[3]) stops.push({ color, offset: offsetOf(match[3]) });
    } else {
      stops.push({ color: parseColor(trimmed), offset: -1 });
    }
  }
  if (stops.length === 0) {
    stops.push({ color: { r: 0, g: 0, b: 0, a: 1 }, offset: 0 });
    stops.push({ color: { r: 0, g: 0, b: 0, a: 1 }, offset: 1 });
  }
  if (stops.length === 1) {
    const c = stops[0];
    stops.push({ color: c.color, offset: 1 });
  }
  let hasAny = false;
  for (const s of stops) { if (s.offset >= 0) { hasAny = true; break; } }
  if (!hasAny) {
    for (let i = 0; i < stops.length; i++) {
      stops[i].offset = stops.length > 1 ? i / (stops.length - 1) : 0;
    }
  }
  stops.sort((a, b) => a.offset - b.offset);
  if (stops[0].offset < 0) stops[0].offset = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].offset < 0) {
      const prev = stops[i - 1].offset;
      const next = stops[i + 1]?.offset ?? 1;
      stops[i].offset = prev + (next - prev) / 2;
    }
  }
  return stops;
}

function splitGradientStops(args: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { result.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

export function parseGradient(value: string): GradientInfo | null {
  const s = value.trim().toLowerCase();
  const repeating = s.startsWith('repeating-');
  const gtype: GradientType = repeating
    ? (s.startsWith('repeating-linear') ? 'repeating-linear' : 'repeating-radial')
    : (s.startsWith('linear-gradient') ? 'linear' : 'radial');
  const inner = s.substring(s.indexOf('(') + 1, s.lastIndexOf(')'));
  if (!inner) return null;

  let angle = 180;
  let shape: 'circle' | 'ellipse' = 'ellipse';
  let size = 'farthest-corner';
  let cx = 0.5, cy = 0.5;
  let radii: GradientInfo['radii'];

  let remainder = inner;
  if (gtype === 'linear' || gtype === 'repeating-linear') {
    const angleMatch = inner.match(/^\s*(to\s+(?:top|right|bottom|left)(?:\s+(?:top|right|bottom|left))?|-?\d+(?:\.\d+)?(?:deg|rad|grad|turn))\s*,\s*/);
    if (angleMatch) {
      angle = parseAngle(angleMatch[1]);
      remainder = inner.substring(angleMatch[0].length);
    }
  } else {
    // The prelude (shape, size, `at` position) is the first argument when it isn't a colour stop;
    // it used to be parsed as a stop, which painted the whole gradient black.
    const parts = splitGradientStops(inner);
    const first = (parts[0] ?? '').trim();
    const isPrelude = /\bat\b|^(circle|ellipse|closest-|farthest-)|^-?\d/.test(first);
    const prelude = isPrelude ? first : '';
    if (isPrelude) remainder = parts.slice(1).join(',');
    const radialMatch = prelude.match(/\b(circle|ellipse)\b/);
    if (radialMatch) shape = radialMatch[1] as 'circle' | 'ellipse';
    const keyword = (v: string, axis: 'x' | 'y') => ({ left: 0, top: 0, center: 0.5, right: 1, bottom: 1 } as Record<string, number>)[v] ?? (axis === 'x' ? 0.5 : 0.5);
    const posMatch = prelude.match(/\bat\s+(\S+)(?:\s+(\S+))?/);
    if (posMatch) {
      const p = (v: string | undefined, axis: 'x' | 'y') => (!v ? 0.5 : v.endsWith('%') ? parseFloat(v) / 100 : /^[a-z]/.test(v) ? keyword(v, axis) : 0.5);
      cx = p(posMatch[1], 'x');
      cy = p(posMatch[2], 'y');
    }
    const kwMatch = prelude.match(/(closest-side|farthest-side|closest-corner|farthest-corner)/);
    if (kwMatch) size = kwMatch[1];
    // Explicit size before `at`: one value (circle radius) or two (ellipse radii), % or px.
    const sizePart = prelude.split(/\bat\b/)[0]!.replace(/\b(circle|ellipse)\b/, '').trim();
    const nums = sizePart ? sizePart.split(/\s+/).filter((t) => /^-?\d/.test(t)) : [];
    if (nums.length) {
      const frac = (t: string) => (t.endsWith('%') ? parseFloat(t) / 100 : NaN);
      const pxv = (t: string) => (t.endsWith('%') ? NaN : parseFloat(t));
      const a = nums[0]!, b = nums[1] ?? nums[0]!;
      radii = { rx: frac(a), ry: frac(b), px: { rx: pxv(a), ry: pxv(b) } };
    }
  }

  const stops = parseStops(remainder);

  return { type: gtype, angle, shape, size, position: { cx, cy }, stops, repetitions: repeating, ...(radii ? { radii } : {}) };
}

export function evaluateGradient(grad: GradientInfo, x: number, y: number, w: number, h: number): RGBA {
  if (!w || !h) return { r: 0, g: 0, b: 0, a: 0 };

  let t: number;
  const { stops, angle, position, shape, size } = grad;

  if (grad.type === 'linear' || grad.type === 'repeating-linear') {
    const rad = angle * Math.PI / 180;
    const nx = Math.sin(rad);
    const ny = -Math.cos(rad);
    t = ((x / w - 0.5) * nx + (y / h - 0.5) * ny) * 2 + 0.5;
  } else if (grad.radii) {
    // Explicit radii: distance in units of the ellipse's own radii.
    const rx = Number.isFinite(grad.radii.rx) ? grad.radii.rx * w : grad.radii.px!.rx;
    const ry = Number.isFinite(grad.radii.ry) ? grad.radii.ry * h : grad.radii.px!.ry;
    const dx = (x - position.cx * w) / Math.max(1e-6, rx);
    const dy = (y - position.cy * h) / Math.max(1e-6, ry);
    t = Math.sqrt(dx * dx + dy * dy);
  } else {
    const dx = x / w - position.cx;
    const dy = y / h - position.cy;
    t = Math.sqrt(dx * dx + dy * dy) * Math.SQRT2;
  }

  if (grad.repetitions) {
    t = t - Math.floor(t);
  }

  return interpolateStops(stops, t);
}

function interpolateStops(stops: ColorStop[], t: number): RGBA {
  if (t <= 0 || stops.length === 1) return stopColor(stops[0]);
  if (t >= 1) return stopColor(stops[stops.length - 1]);

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (t >= a.offset && t <= b.offset) {
      const span = b.offset - a.offset;
      const frac = span > 0 ? (t - a.offset) / span : 0;
      return blendColors(a.color, b.color, frac);
    }
  }
  return stopColor(stops[0]);
}

function stopColor(s: ColorStop): RGBA {
  return s.color;
}

function blendColors(a: RGBA, b: RGBA, t: number): RGBA {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
  };
}

export function fillGradient(buffer: ImageData, grad: GradientInfo, x: number, y: number, w: number, h: number): void {
  const data = buffer.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const color = evaluateGradient(grad, px, py, w, h);
      const idx = ((py + y) * buffer.width + (px + x)) * 4;
      const a = color.a;
      const invA = 1 - a;
      data[idx] = data[idx] * invA + color.r * a;
      data[idx + 1] = data[idx + 1] * invA + color.g * a;
      data[idx + 2] = data[idx + 2] * invA + color.b * a;
      data[idx + 3] = Math.max(data[idx + 3], a * 255);
    }
  }
}
