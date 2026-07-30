import type { RGBA } from './rasterizer';
import { parseColor } from './rasterizer';

export interface BorderSide {
  width: number;
  style: 'none' | 'solid' | 'dashed' | 'dotted' | 'double' | 'groove' | 'ridge' | 'inset' | 'outset';
  color: RGBA;
}

export interface BorderRadius {
  topLeft: { w: number; h: number };
  topRight: { w: number; h: number };
  bottomRight: { w: number; h: number };
  bottomLeft: { w: number; h: number };
}

export interface BordersInfo {
  top: BorderSide;
  right: BorderSide;
  bottom: BorderSide;
  left: BorderSide;
  radius: BorderRadius;
}

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

export function parseBorderWidth(val: string): number {
  if (!val) return 0;
  if (val === 'thin') return 1;
  if (val === 'medium') return 3;
  if (val === 'thick') return 5;
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

export function parseBorderStyle(val: string): BorderSide['style'] {
  if (!val || val === 'none') return 'none';
  const s = val.trim().toLowerCase() as BorderSide['style'];
  if (['none','solid','dashed','dotted','double','groove','ridge','inset','outset'].includes(s)) return s;
  return 'none';
}

export function parseBorderRadius(val: string, width: number, height: number): BorderRadius {
  const zero = { w: 0, h: 0 };
  if (!val || val === '0') return { topLeft: zero, topRight: zero, bottomRight: zero, bottomLeft: zero };

  const parts = val.trim().split(/\s+/);
  const values: number[] = [];
  for (const p of parts) {
    if (p.endsWith('%')) {
      const pct = parseFloat(p) / 100;
      values.push(-pct);
    } else {
      values.push(parseFloat(p) || 0);
    }
  }

  const expand = (list: number[], count: number): number[] => {
    if (list.length === count) return list;
    if (list.length === 1) return [list[0], list[0], list[0], list[0]];
    if (list.length === 2) return [list[0], list[1], list[0], list[1]];
    if (list.length === 3) return [list[0], list[1], list[2], list[1]];
    return list;
  };

  const hVals = expand(values.length > 4 ? values.slice(0, 4) : values, 4);
  let vVals = hVals;
  const slashIdx = val.indexOf('/');
  if (slashIdx >= 0) {
    const vParts = val.substring(slashIdx + 1).trim().split(/\s+/);
    const vNums: number[] = vParts.map(p => {
      if (p.endsWith('%')) return -(parseFloat(p) / 100);
      return parseFloat(p) || 0;
    });
    vVals = expand(vNums, 4);
  }

  const toDim = (v: number): { w: number; h: number } => {
    if (v < 0) return { w: (-v) * width, h: (-v) * height };
    return { w: v, h: v };
  };

  const separateV = vVals !== hVals;
  return {
    topLeft: separateV ? { w: hVals[0], h: vVals[0] } : toDim(hVals[0]),
    topRight: separateV ? { w: hVals[1], h: vVals[1] } : toDim(hVals[1]),
    bottomRight: separateV ? { w: hVals[2], h: vVals[2] } : toDim(hVals[2]),
    bottomLeft: separateV ? { w: hVals[3], h: vVals[3] } : toDim(hVals[3]),
  };
}

export function parseBorders(
  style: ReadonlyMap<string, string> | undefined,
  elWidth: number,
  elHeight: number
): BordersInfo {
  if (!style) return noBorders();
  const gw = (name: string) => style.get(name) ?? '';
  const topW = parseBorderWidth(gw('border-top-width'));
  const rightW = parseBorderWidth(gw('border-right-width'));
  const bottomW = parseBorderWidth(gw('border-bottom-width'));
  const leftW = parseBorderWidth(gw('border-left-width'));
  const topC = parseColor(gw('border-top-color'));
  const rightC = parseColor(gw('border-right-color'));
  const bottomC = parseColor(gw('border-bottom-color'));
  const leftC = parseColor(gw('border-left-color'));
  const topS = parseBorderStyle(gw('border-top-style'));
  const rightS = parseBorderStyle(gw('border-right-style'));
  const bottomS = parseBorderStyle(gw('border-bottom-style'));
  const leftS = parseBorderStyle(gw('border-left-style'));
  const radius = parseBorderRadius(gw('border-radius'), elWidth, elHeight);
  return {
    top: { width: topW, style: topS, color: topC },
    right: { width: rightW, style: rightS, color: rightC },
    bottom: { width: bottomW, style: bottomS, color: bottomC },
    left: { width: leftW, style: leftS, color: leftC },
    radius,
  };
}

export function noBorders(): BordersInfo {
  const z = { w: 0, h: 0 };
  const s: BorderSide = { width: 0, style: 'none', color: TRANSPARENT };
  return { top: s, right: s, bottom: s, left: s, radius: { topLeft: z, topRight: z, bottomRight: z, bottomLeft: z } };
}

export function renderBorderSide(buffer: ImageData, x: number, y: number, w: number, h: number, side: BorderSide, position: 'top' | 'right' | 'bottom' | 'left', radius: number): void {
  if (side.style === 'none' || side.width <= 0) return;
  const data = buffer.data;
  const { width: bw, color } = side;
  const r = Math.min(radius, bw / 2);

  const fillPixel = (px: number, py: number) => {
    if (px < 0 || px >= buffer.width || py < 0 || py >= buffer.height) return;
    const idx = (py * buffer.width + px) * 4;
    const a = color.a;
    data[idx] = data[idx] * (1 - a) + color.r * a;
    data[idx + 1] = data[idx + 1] * (1 - a) + color.g * a;
    data[idx + 2] = data[idx + 2] * (1 - a) + color.b * a;
    data[idx + 3] = Math.max(data[idx + 3], a * 255);
  };

  const corner = (cx: number, cy: number, quadrant: number) => {
    for (let dy = 0; dy < bw; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r) {
          let px: number, py: number;
          if (quadrant === 0) { px = cx + dx; py = cy + dy; }
          else if (quadrant === 1) { px = cx - dx; py = cy + dy; }
          else if (quadrant === 2) { px = cx - dx; py = cy - dy; }
          else { px = cx + dx; py = cy - dy; }
          fillPixel(px, py);
        }
      }
    }
  };

  if (position === 'top') {
    for (let px = x; px < x + w; px++) {
      for (let py = y; py < y + bw; py++) fillPixel(px, py);
    }
  } else if (position === 'bottom') {
    for (let px = x; px < x + w; px++) {
      for (let py = y + h - bw; py < y + h; py++) fillPixel(px, py);
    }
  } else if (position === 'left') {
    for (let py = y + bw; py < y + h - bw; py++) {
      for (let px = x; px < x + bw; px++) fillPixel(px, py);
    }
  } else if (position === 'right') {
    for (let py = y + bw; py < y + h - bw; py++) {
      for (let px = x + w - bw; px < x + w; px++) fillPixel(px, py);
    }
  }

  if (radius > 0) {
    const rr = Math.min(bw, radius);
    if (position === 'top' || position === 'left') corner(x, y, 0);
    if (position === 'top' || position === 'right') corner(x + w, y, 1);
    if (position === 'bottom' || position === 'left') corner(x, y + h, 3);
    if (position === 'bottom' || position === 'right') corner(x + w, y + h, 2);
  }

  if (side.style === 'dashed' || side.style === 'dotted') {
    const dashLen = side.style === 'dotted' ? bw : bw * 3;
    const gapLen = bw * 2;
    const total = (position === 'top' || position === 'bottom') ? w : h;
    for (let start = 0; start < total; start += dashLen + gapLen) {
      for (let off = dashLen; off < dashLen + gapLen && start + off < total; off++) {
        if (position === 'top') for (let px = x + start + off; px < x + start + off + 1 && px < x + w; px++) for (let py = y; py < y + bw; py++) { const idx = (py * buffer.width + px) * 4; data[idx] = data[idx] * (1 - 0) + 0; data[idx + 1] = data[idx + 1] * (1 - 0) + 0; data[idx + 2] = data[idx + 2] * (1 - 0) + 0; data[idx + 3] = data[idx + 3]; }
      }
    }
  }
}
