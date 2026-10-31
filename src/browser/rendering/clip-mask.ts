import type { RGBA } from './rasterizer';

export type ClipShape =
  | { type: 'inset'; top: number; right: number; bottom: number; left: number; round: [number, number][] }
  | { type: 'circle'; cx: number; cy: number; r: number; rPct?: boolean; cxPx?: boolean; cyPx?: boolean }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rxPct?: boolean; ryPct?: boolean; cxPx?: boolean; cyPx?: boolean }
  | { type: 'polygon'; points: [number, number][] }
  | { type: 'none' };

export interface ClipPathInfo {
  shape: ClipShape;
  box: 'margin-box' | 'border-box' | 'padding-box' | 'content-box' | 'fill-box' | 'stroke-box' | 'view-box';
}

export function parseClipPath(value: string): ClipPathInfo {
  const fallback: ClipPathInfo = { shape: { type: 'none' }, box: 'border-box' };
  if (!value || value === 'none') return fallback;

  const insetMatch = value.match(/inset\s*\(([^)]+)\)/);
  if (insetMatch) {
    const args = insetMatch[1].split(/\s+/).filter(Boolean);
    const nums = args.map(a => parseFloat(a) || 0);
    const t = nums[0] ?? 0;
    const r = nums[1] ?? t;
    const b = nums[2] ?? t;
    const l = nums[3] ?? r;
    return { shape: { type: 'inset', top: t, right: r, bottom: b, left: l, round: [] }, box: 'border-box' };
  }

  const circleMatch = value.match(/circle\s*\(([^)]+)\)/);
  if (circleMatch) {
    const args = circleMatch[1].trim();
    const rTok = args.split(/\s+/)[0] ?? '';
    const rNum = parseFloat(rTok);
    const r = isNaN(rNum) ? 50 : rNum;
    const rPct = isNaN(rNum) || rTok.endsWith('%');
    const posMatch = args.match(/at\s+(-?\d+(?:\.\d+)?(?:%|px)?)\s+(-?\d+(?:\.\d+)?(?:%|px)?)/);
    const cx = posMatch ? (posMatch[1].endsWith('%') ? parseFloat(posMatch[1]) / 100 : parseFloat(posMatch[1])) : 0.5;
    const cy = posMatch ? (posMatch[2].endsWith('%') ? parseFloat(posMatch[2]) / 100 : parseFloat(posMatch[2])) : 0.5;
    return { shape: { type: 'circle', cx, cy, r, rPct, cxPx: !!posMatch && !posMatch[1].endsWith('%'), cyPx: !!posMatch && !posMatch[2].endsWith('%') }, box: 'border-box' };
  }

  const ellipseMatch = value.match(/ellipse\s*\(([^)]+)\)/);
  if (ellipseMatch) {
    const args = ellipseMatch[1].trim();
    const toks = args.split(/\s+/);
    // Radii keep their unit: `ellipse(75% 100% at 50% 100%)` was read as 75 px by 100 px.
    const rxTok = toks[0] && toks[0] !== 'at' ? toks[0] : '50%';
    const ryTok = toks[1] && toks[1] !== 'at' ? toks[1] : rxTok;
    const rx = parseFloat(rxTok) || 50, ry = parseFloat(ryTok) || rx;
    const posMatch = args.match(/at\s+(-?\d+(?:\.\d+)?(?:%|px)?)\s+(-?\d+(?:\.\d+)?(?:%|px)?)/);
    const cx = posMatch ? (posMatch[1].endsWith('%') ? parseFloat(posMatch[1]) / 100 : parseFloat(posMatch[1])) : 0.5;
    const cy = posMatch ? (posMatch[2].endsWith('%') ? parseFloat(posMatch[2]) / 100 : parseFloat(posMatch[2])) : 0.5;
    return { shape: { type: 'ellipse', cx, cy, rx, ry, rxPct: rxTok.endsWith('%'), ryPct: ryTok.endsWith('%'), cxPx: !!posMatch && !posMatch[1].endsWith('%'), cyPx: !!posMatch && !posMatch[2].endsWith('%') }, box: 'border-box' };
  }

  const polyMatch = value.match(/polygon\s*\(([^)]+)\)/);
  if (polyMatch) {
    const args = polyMatch[1].trim();
    const pointStrs = args.split(',');
    const points: [number, number][] = [];
    for (const ps of pointStrs) {
      const parts = ps.trim().split(/\s+/);
      if (parts.length >= 2) {
        points.push([parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0]);
      }
    }
    return { shape: { type: 'polygon', points }, box: 'border-box' };
  }

  return fallback;
}

export function isInsideClip(px: number, py: number, shape: ClipShape, w: number, h: number): boolean {
  if (shape.type === 'none') return true;

  switch (shape.type) {
    case 'inset': {
      return px >= shape.left && px < w - shape.right &&
             py >= shape.top && py < h - shape.bottom;
    }
    case 'circle': {
      const cx = shape.cxPx ? shape.cx : shape.cx * w;
      const cy = shape.cyPx ? shape.cy : shape.cy * h;
      // A percentage radius is of sqrt((w² + h²) / 2) (CSS Shapes §3.1).
      const r = shape.rPct ? (shape.r / 100) * Math.sqrt((w * w + h * h) / 2) : shape.r;
      const dx = px - cx;
      const dy = py - cy;
      return dx * dx + dy * dy <= r * r;
    }
    case 'ellipse': {
      const cx = shape.cxPx ? shape.cx : shape.cx * w;
      const cy = shape.cyPx ? shape.cy : shape.cy * h;
      const rx = shape.rxPct ? (shape.rx / 100) * w : shape.rx;
      const ry = shape.ryPct ? (shape.ry / 100) * h : shape.ry;
      if (rx <= 0 || ry <= 0) return false;
      const dx = (px - cx) / rx;
      const dy = (py - cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'polygon': {
      let inside = false;
      const { points } = shape;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i][0], yi = points[i][1];
        const xj = points[j][0], yj = points[j][1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }
    default:
      return true;
  }
}

export function applyClipBuffer(buffer: ImageData, shape: ClipShape, w: number, h: number): void {
  if (shape.type === 'none') return;
  const data = buffer.data;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      if (!isInsideClip(px, py, shape, w, h)) {
        const idx = (py * w + px) * 4;
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }
}

export interface MaskInfo {
  image: string;
  repeat: string;
  size: string;
  clip: string;
  mode: 'alpha' | 'luminance';
}

export function parseMask(value: string): MaskInfo[] {
  if (!value || value === 'none') return [];
  const layers: MaskInfo[] = [];
  const parts = value.split(',');
  for (const part of parts) {
    const s = part.trim();
    const urlMatch = s.match(/url\(['"]?([^'")]+)['"]?\)/);
    const image = urlMatch ? urlMatch[1] : 'none';
    layers.push({
      image, repeat: 'repeat', size: 'auto', clip: 'border-box',
      mode: 'alpha',
    });
  }
  return layers;
}
