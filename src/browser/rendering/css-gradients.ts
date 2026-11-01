import type { RGBA } from './rasterizer';
import { parseColor } from './rasterizer';

export type GradientType = 'linear' | 'radial' | 'conic' | 'repeating-linear' | 'repeating-radial';

export interface ColorStop {
  color: RGBA;
  offset: number;
  /** A position given in px: an offset only once the gradient line's length is known. */
  px?: number;
}

export interface GradientInfo {
  type: GradientType;
  angle: number;
  shape: 'circle' | 'ellipse';
  size: string;
  position: { cx: number; cy: number };
  stops: ColorStop[];
  repetitions: boolean;
  /** The stops as written (auto = -1, px kept), re-normalized per gradient length when any is px. */
  rawStops?: ColorStop[];
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

function parseRawStops(args: string): ColorStop[] {
  const stops: ColorStop[] = [];
  for (const part of splitGradientStops(args)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // A colour, then one or two positions (`#2f8f4e 45%`, `rgba(0,0,0,.5) 10%`, `#fff 0 40%`).
    const match = trimmed.match(/^(.*?)\s+(-?\d*\.?\d+(?:%|px)?)(?:\s+(-?\d*\.?\d+(?:%|px)?))?$/);
    if (match) {
      const color = parseColor(match[1]!.trim());
      const stopAt = (t: string): ColorStop => (t.endsWith('px')
        ? { color, offset: -1, px: parseFloat(t) || 0 }
        : { color, offset: t.endsWith('%') ? (parseFloat(t) || 0) / 100 : parseFloat(t) || 0 });
      stops.push(stopAt(match[2]!));
      if (match[3]) stops.push(stopAt(match[3]));
    } else {
      stops.push({ color: parseColor(trimmed), offset: -1 });
    }
  }
  if (stops.length === 0) stops.push({ color: { r: 0, g: 0, b: 0, a: 1 }, offset: -1 }, { color: { r: 0, g: 0, b: 0, a: 1 }, offset: -1 });
  if (stops.length === 1) stops.push({ color: stops[0]!.color, offset: -1 });
  return stops;
}

/**
 * Stop positions per CSS Images §3.5.1: px against the gradient length, a missing first/last at
 * 0%/100%, each position at least the one before, and runs of automatic stops spread evenly. Stops
 * were sorted by offset instead, so an automatic stop (-1) jumped to the front
 * (`red 10%, blue, green 90%` started blue) and px stops were treated as automatic.
 */
function normalizeStops(raw: readonly ColorStop[], length?: number): ColorStop[] {
  const stops = raw.map((st) => ({ color: st.color, offset: st.px !== undefined && length ? st.px / length : st.px !== undefined ? -1 : st.offset }));
  if (stops[0]!.offset < 0) stops[0]!.offset = 0;
  if (stops[stops.length - 1]!.offset < 0) stops[stops.length - 1]!.offset = 1;
  let max = -Infinity;
  for (const st of stops) if (st.offset >= 0) { st.offset = Math.max(st.offset, max); max = st.offset; }
  for (let i = 1; i < stops.length - 1; i++) {
    if (stops[i]!.offset >= 0) continue;
    let j = i;
    while (stops[j]!.offset < 0) j++;
    const from = stops[i - 1]!.offset, to = stops[j]!.offset;
    for (let k = i; k < j; k++) stops[k]!.offset = from + (to - from) * (k - i + 1) / (j - i + 1);
    i = j;
  }
  return stops;
}

function parseStops(args: string): ColorStop[] {
  return normalizeStops(parseRawStops(args));
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

  const rawStops = parseRawStops(remainder);
  const stops = normalizeStops(rawStops);

  return {
    type: gtype, angle, shape, size, position: { cx, cy }, stops, repetitions: repeating,
    ...(rawStops.some((st) => st.px !== undefined) ? { rawStops } : {}),
    ...(radii ? { radii } : {}),
  };
}

export function evaluateGradient(grad: GradientInfo, x: number, y: number, w: number, h: number): RGBA {
  if (!w || !h) return { r: 0, g: 0, b: 0, a: 0 };

  let t: number;
  const { angle, position, shape, size } = grad;
  let { stops } = grad;

  if (grad.type === 'linear' || grad.type === 'repeating-linear') {
    // The gradient line through the centre, long enough to reach the corners (CSS Images §3.1.1).
    // t was scaled to run from -0.5 to 1.5 across the box, so every linear gradient changed colour
    // in its middle half only.
    const rad = angle * Math.PI / 180;
    const nx = Math.sin(rad);
    const ny = -Math.cos(rad);
    const length = Math.abs(w * nx) + Math.abs(h * ny) || 1;
    t = ((x - w / 2) * nx + (y - h / 2) * ny) / length + 0.5;
    if (grad.rawStops) stops = stopsForLength(grad, length);
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

  // Repeating gradients repeat the span of their stops, not 0..1 (`… #00f 10px 20px` repeats every 20px).
  if (grad.repetitions) {
    const first = stops[0]!.offset, period = stops[stops.length - 1]!.offset - first;
    t = period > 0 ? first + ((((t - first) % period) + period) % period) : t - Math.floor(t);
  }

  return interpolateStops(stops, t);
}

const stopsCache = new WeakMap<GradientInfo, { length: number; stops: ColorStop[] }>();

function stopsForLength(grad: GradientInfo, length: number): ColorStop[] {
  const hit = stopsCache.get(grad);
  if (hit && hit.length === length) return hit.stops;
  const stops = normalizeStops(grad.rawStops!, length);
  stopsCache.set(grad, { length, stops });
  return stops;
}

function interpolateStops(stops: ColorStop[], t: number): RGBA {
  // Before the first stop / after the last one, their colours continue (not just outside 0..1:
  // `transparent 50%, #00f 50%` has no stop at 100%).
  if (stops.length === 1 || t <= stops[0]!.offset) return stopColor(stops[0]!);
  if (t >= stops[stops.length - 1]!.offset) return stopColor(stops[stops.length - 1]!);

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
