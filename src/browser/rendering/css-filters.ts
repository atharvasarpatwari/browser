import type { RGBA } from './rasterizer';

export type FilterFunction =
  | { name: 'blur'; radius: number }
  | { name: 'brightness'; amount: number }
  | { name: 'contrast'; amount: number }
  | { name: 'grayscale'; amount: number }
  | { name: 'hue-rotate'; angle: number }
  | { name: 'invert'; amount: number }
  | { name: 'saturate'; amount: number }
  | { name: 'sepia'; amount: number }
  | { name: 'drop-shadow'; offsetX: number; offsetY: number; blur: number; color: RGBA }
  | { name: 'opacity'; amount: number };

export type FilterList = FilterFunction[];

export function parseFilter(value: string): FilterList {
  if (!value || value === 'none') return [];
  const filters: FilterList = [];
  const remaining = value.trim();
  const funcRegex = /(\w[\w-]*)\s*\(/g;
  let match: RegExpExecArray | null;
  let lastIdx = 0;

  while ((match = funcRegex.exec(remaining)) !== null) {
    const funcName = match[1].toLowerCase();
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < remaining.length && depth > 0) {
      if (remaining[end] === '(') depth++;
      if (remaining[end] === ')') depth--;
      end++;
    }
    const args = remaining.substring(start, end - 1).trim();
    const f = parseFilterFunc(funcName, args);
    if (f) filters.push(f);
  }
  return filters;
}

function parseFilterFunc(name: string, args: string): FilterFunction | null {
  const num = parseFloat(args) || 0;
  const pct = args.endsWith('%') ? num / 100 : (args.endsWith('px') ? num : num);
  switch (name) {
    case 'blur': {
      const r = parseFloat(args) || 0;
      return { name: 'blur', radius: r };
    }
    case 'brightness': return { name: 'brightness', amount: pct || 1 };
    case 'contrast': return { name: 'contrast', amount: pct || 1 };
    case 'grayscale': return { name: 'grayscale', amount: pct || 0 };
    case 'hue-rotate': {
      const deg = parseFloat(args) || 0;
      return { name: 'hue-rotate', angle: deg };
    }
    case 'invert': return { name: 'invert', amount: pct || 0 };
    case 'saturate': return { name: 'saturate', amount: pct || 1 };
    case 'sepia': return { name: 'sepia', amount: pct || 0 };
    case 'opacity': return { name: 'opacity', amount: pct || 1 };
    case 'drop-shadow': {
      const tokens = args.split(/\s+/);
      const ox = parseFloat(tokens[0]) || 0;
      const oy = parseFloat(tokens[1]) || 0;
      let blur = 0;
      let color: RGBA = { r: 0, g: 0, b: 0, a: 0.5 };
      let idx = 2;
      if (tokens.length > idx && !isNaN(parseFloat(tokens[idx]))) { blur = parseFloat(tokens[idx]) || 0; idx++; }
      if (tokens.length > idx) color = parseColorSimple(tokens.slice(idx).join(' '));
      return { name: 'drop-shadow', offsetX: ox, offsetY: oy, blur, color };
    }
    default: return null;
  }
}

function parseColorSimple(s: string): RGBA {
  const lower = s.trim().toLowerCase();
  if (lower === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (lower === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (lower === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  return { r: 0, g: 0, b: 0, a: 0.5 };
}

export function applyFilters(buffer: ImageData, filters: FilterList): ImageData {
  if (!filters || filters.length === 0) return buffer;
  let result = buffer;
  for (const f of filters) {
    result = applyFilter(result, f);
  }
  return result;
}

function applyFilter(buffer: ImageData, filter: FilterFunction): ImageData {
  const w = buffer.width;
  const h = buffer.height;
  const data = buffer.data;

  switch (filter.name) {
    case 'blur': {
      return applyBoxBlur(buffer, filter.radius);
    }
    case 'brightness': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, data[i] * amt);
        data[i + 1] = Math.min(255, data[i + 1] * amt);
        data[i + 2] = Math.min(255, data[i + 2] * amt);
      }
      return buffer;
    }
    case 'contrast': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = clamp(((data[i] / 255 - 0.5) * amt + 0.5) * 255);
        data[i + 1] = clamp(((data[i + 1] / 255 - 0.5) * amt + 0.5) * 255);
        data[i + 2] = clamp(((data[i + 2] / 255 - 0.5) * amt + 0.5) * 255);
      }
      return buffer;
    }
    case 'grayscale': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        data[i] = data[i] * (1 - amt) + gray * amt;
        data[i + 1] = data[i + 1] * (1 - amt) + gray * amt;
        data[i + 2] = data[i + 2] * (1 - amt) + gray * amt;
      }
      return buffer;
    }
    case 'hue-rotate': {
      const angle = filter.angle * Math.PI / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;
        const nr = r * (0.213 + cosA * 0.787 - sinA * 0.213) +
                  g * (0.715 - cosA * 0.715 - sinA * 0.715) +
                  b * (0.072 - cosA * 0.072 + sinA * 0.928);
        const ng = r * (0.213 - cosA * 0.213 + sinA * 0.143) +
                  g * (0.715 + cosA * 0.285 + sinA * 0.140) +
                  b * (0.072 - cosA * 0.072 - sinA * 0.283);
        const nb = r * (0.213 - cosA * 0.213 - sinA * 0.787) +
                  g * (0.715 - cosA * 0.715 + sinA * 0.715) +
                  b * (0.072 + cosA * 0.928 + sinA * 0.072);
        data[i] = clamp(Math.round(nr * 255));
        data[i + 1] = clamp(Math.round(ng * 255));
        data[i + 2] = clamp(Math.round(nb * 255));
      }
      return buffer;
    }
    case 'invert': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = data[i] * (1 - amt) + (255 - data[i]) * amt;
        data[i + 1] = data[i + 1] * (1 - amt) + (255 - data[i + 1]) * amt;
        data[i + 2] = data[i + 2] * (1 - amt) + (255 - data[i + 2]) * amt;
      }
      return buffer;
    }
    case 'saturate': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        const gray = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        data[i] = clamp(data[i] * amt + gray * (1 - amt));
        data[i + 1] = clamp(data[i + 1] * amt + gray * (1 - amt));
        data[i + 2] = clamp(data[i + 2] * amt + gray * (1 - amt));
      }
      return buffer;
    }
    case 'sepia': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const sr = r * 0.393 + g * 0.769 + b * 0.189;
        const sg = r * 0.349 + g * 0.686 + b * 0.168;
        const sb = r * 0.272 + g * 0.534 + b * 0.131;
        data[i] = clamp(r * (1 - amt) + sr * amt);
        data[i + 1] = clamp(g * (1 - amt) + sg * amt);
        data[i + 2] = clamp(b * (1 - amt) + sb * amt);
      }
      return buffer;
    }
    case 'opacity': {
      const amt = filter.amount;
      for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = data[i + 3] * amt;
      }
      return buffer;
    }
    case 'drop-shadow': {
      return applyDropShadow(buffer, filter);
    }
    default:
      return buffer;
  }
}

function applyBoxBlur(buffer: ImageData, radius: number): ImageData {
  if (radius < 1) return buffer;
  const w = buffer.width;
  const h = buffer.height;
  const result = new ImageData(new Uint8ClampedArray(buffer.data), w, h);
  const src = buffer.data;
  const dst = result.data;
  const r = Math.ceil(radius);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0, count = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = Math.min(Math.max(x + dx, 0), w - 1);
          const py = Math.min(Math.max(y + dy, 0), h - 1);
          const si = (py * w + px) * 4;
          ar += src[si]; ag += src[si + 1]; ab += src[si + 2]; aa += src[si + 3];
          count++;
        }
      }
      const di = (y * w + x) * 4;
      dst[di] = ar / count; dst[di + 1] = ag / count;
      dst[di + 2] = ab / count; dst[di + 3] = aa / count;
    }
  }
  return result;
}

function applyDropShadow(buffer: ImageData, ds: Extract<FilterFunction, { name: 'drop-shadow' }>): ImageData {
  const w = buffer.width;
  const h = buffer.height;
  const ox = Math.round(ds.offsetX);
  const oy = Math.round(ds.offsetY);
  const blur = ds.blur;
  const pad = Math.ceil(blur) + Math.max(Math.abs(ox), Math.abs(oy)) + 2;
  const nw = w + pad * 2;
  const nh = h + pad * 2;

  const shadow = new ImageData(nw, nh);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const si = (py * w + px) * 4;
      const alpha = buffer.data[si + 3] / 255;
      if (alpha <= 0) continue;
      const sx = px + pad + ox;
      const sy = py + pad + oy;
      const di = (sy * nw + sx) * 4;
      shadow.data[di] = ds.color.r;
      shadow.data[di + 1] = ds.color.g;
      shadow.data[di + 2] = ds.color.b;
      shadow.data[di + 3] = Math.min(255, shadow.data[di + 3] + ds.color.a * 255);
    }
  }

  let result = shadow;
  if (blur > 0) result = applyBoxBlur(result, blur);

  const final = new ImageData(new Uint8ClampedArray(buffer.data), w, h);
  for (let py = 0; py < nh; py++) {
    for (let px = 0; px < nw; px++) {
      const si = (py * nw + px) * 4;
      const alpha = result.data[si + 3] / 255;
      if (alpha <= 0) continue;
      const fx = px - pad;
      const fy = py - pad;
      if (fx < 0 || fx >= w || fy < 0 || fy >= h) continue;
      const di = (fy * w + fx) * 4;
      final.data[di] = final.data[di] * (1 - alpha) + result.data[si] * alpha;
      final.data[di + 1] = final.data[di + 1] * (1 - alpha) + result.data[si + 1] * alpha;
      final.data[di + 2] = final.data[di + 2] * (1 - alpha) + result.data[si + 2] * alpha;
      final.data[di + 3] = Math.max(final.data[di + 3], result.data[si + 3]);
    }
  }

  for (let i = 0; i < final.data.length; i++) buffer.data[i] = final.data[i];
  return buffer;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}
