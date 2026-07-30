import type { RGBA } from './rasterizer';
import { parseColor } from './rasterizer';

export interface BoxShadow {
  inset: boolean;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: RGBA;
}

export interface TextShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: RGBA;
}

function splitCSSTopLevel(value: string): string[] {
  const result: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) { result.push(value.substring(start, i)); start = i + 1; }
  }
  result.push(value.substring(start));
  return result;
}

export function parseBoxShadow(value: string): BoxShadow[] {
  if (!value || value === 'none') return [];
  const shadows: BoxShadow[] = [];
  const parts = splitCSSTopLevel(value);
  for (const part of parts) {
    const s = part.trim();
    const inset = s.includes('inset');
    const tokens = s.replace('inset', '').trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const ox = parseFloat(tokens[0]) || 0;
    const oy = parseFloat(tokens[1]) || 0;
    let blur = 0;
    let spread = 0;
    let color: RGBA = { r: 0, g: 0, b: 0, a: 0.5 };
    let idx = 2;
    if (tokens.length > idx) {
      const n = parseFloat(tokens[idx]);
      if (!isNaN(n)) { blur = n; idx++; }
    }
    if (tokens.length > idx) {
      const n = parseFloat(tokens[idx]);
      if (!isNaN(n)) { spread = n; idx++; }
    }
    if (tokens.length > idx) {
      color = parseColor(tokens.slice(idx).join(' '));
    }
    shadows.push({ inset, offsetX: ox, offsetY: oy, blur, spread, color });
  }
  return shadows;
}

export function parseTextShadow(value: string): TextShadow[] {
  if (!value || value === 'none') return [];
  const shadows: TextShadow[] = [];
  const parts = splitCSSTopLevel(value);
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length < 2) continue;
    const ox = parseFloat(tokens[0]) || 0;
    const oy = parseFloat(tokens[1]) || 0;
    let blur = 0;
    let color: RGBA = { r: 0, g: 0, b: 0, a: 0.5 };
    let idx = 2;
    if (tokens.length > idx) {
      const n = parseFloat(tokens[idx]);
      if (!isNaN(n)) { blur = n; idx++; }
    }
    if (tokens.length > idx) {
      color = parseColor(tokens.slice(idx).join(' '));
    }
    shadows.push({ offsetX: ox, offsetY: oy, blur, color });
  }
  return shadows;
}

function gaussianKernel(radius: number): Float64Array {
  const size = Math.max(1, Math.ceil(radius * 3));
  const kernel = new Float64Array(size * 2 + 1);
  const sigma = Math.max(0.001, radius / 2);
  let sum = 0;
  for (let i = -size; i <= size; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + size] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

function boxBlur(buffer: ImageData, radius: number): ImageData {
  if (radius < 1) return buffer;
  const w = buffer.width;
  const h = buffer.height;
  const result = new ImageData(new Uint8ClampedArray(buffer.data), w, h);
  const src = buffer.data;
  const dst = result.data;
  const kernel = gaussianKernel(Math.ceil(radius));
  const kHalf = (kernel.length - 1) / 2;

  const row = new Float64Array(w * 4);
  for (let y = 0; y < h; y++) {
    row.fill(0);
    for (let kx = 0; kx < kernel.length; kx++) {
      const sx = kx - kHalf;
      const weight = kernel[kx];
      for (let x = 0; x < w; x++) {
        const px = Math.min(Math.max(x + sx, 0), w - 1);
        const si = (y * w + px) * 4;
        const di = x * 4;
        row[di] += src[si] * weight;
        row[di + 1] += src[si + 1] * weight;
        row[di + 2] += src[si + 2] * weight;
        row[di + 3] += src[si + 3] * weight;
      }
    }
    for (let x = 0; x < w; x++) {
      const di = (y * w + x) * 4;
      dst[di] = row[x * 4];
      dst[di + 1] = row[x * 4 + 1];
      dst[di + 2] = row[x * 4 + 2];
      dst[di + 3] = row[x * 4 + 3];
    }
  }

  const col = new Float64Array(h * 4);
  for (let x = 0; x < w; x++) {
    col.fill(0);
    for (let ky = 0; ky < kernel.length; ky++) {
      const sy = ky - kHalf;
      const weight = kernel[ky];
      for (let y = 0; y < h; y++) {
        const py = Math.min(Math.max(y + sy, 0), h - 1);
        const si = (py * w + x) * 4;
        const di = y * 4;
        col[di] += dst[si] * weight;
        col[di + 1] += dst[si + 1] * weight;
        col[di + 2] += dst[si + 2] * weight;
        col[di + 3] += dst[si + 3] * weight;
      }
    }
    for (let y = 0; y < h; y++) {
      const di = (y * w + x) * 4;
      dst[di] = col[y * 4];
      dst[di + 1] = col[y * 4 + 1];
      dst[di + 2] = col[y * 4 + 2];
      dst[di + 3] = col[y * 4 + 3];
    }
  }

  return result;
}

export function renderBoxShadow(buffer: ImageData, shadow: BoxShadow, x: number, y: number, w: number, h: number): void {
  if (!w || !h) return;
  const sx = x + shadow.offsetX - shadow.spread;
  const sy = y + shadow.offsetY - shadow.spread;
  const sw = w + shadow.spread * 2;
  const sh = h + shadow.spread * 2;

  const shadowCanvas = new ImageData(sw, sh);
  const sd = shadowCanvas.data;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const idx = (py * sw + px) * 4;
      sd[idx] = shadow.color.r;
      sd[idx + 1] = shadow.color.g;
      sd[idx + 2] = shadow.color.b;
      sd[idx + 3] = shadow.color.a * 255;
    }
  }

  const blurred = boxBlur(shadowCanvas, shadow.blur);

  const data = buffer.data;
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const bx = sx + px;
      const by = sy + py;
      if (bx < 0 || bx >= buffer.width || by < 0 || by >= buffer.height) continue;
      const si = (py * sw + px) * 4;
      const di = (by * buffer.width + bx) * 4;
      const alpha = blurred.data[si + 3] / 255;
      if (alpha <= 0) continue;
      data[di] = data[di] * (1 - alpha) + blurred.data[si] * alpha;
      data[di + 1] = data[di + 1] * (1 - alpha) + blurred.data[si + 1] * alpha;
      data[di + 2] = data[di + 2] * (1 - alpha) + blurred.data[si + 2] * alpha;
      data[di + 3] = Math.max(data[di + 3], blurred.data[si + 3]);
    }
  }
}

export function renderTextShadow(buffer: ImageData, shadow: TextShadow, textBuffer: ImageData, tx: number, ty: number): void {
  const data = buffer.data;
  const sb = textBuffer;
  for (let py = 0; py < sb.height; py++) {
    for (let px = 0; px < sb.width; px++) {
      const si = (py * sb.width + px) * 4;
      const alpha = sb.data[si + 3] / 255;
      if (alpha <= 0) continue;
      const bx = tx + px + shadow.offsetX;
      const by = ty + py + shadow.offsetY;
      if (bx < 0 || bx >= buffer.width || by < 0 || by >= buffer.height) continue;
      const di = (by * buffer.width + bx) * 4;
      const sa = shadow.color.a * alpha;
      data[di] = data[di] * (1 - sa) + shadow.color.r * sa;
      data[di + 1] = data[di + 1] * (1 - sa) + shadow.color.g * sa;
      data[di + 2] = data[di + 2] * (1 - sa) + shadow.color.b * sa;
      data[di + 3] = Math.max(data[di + 3], shadow.color.a * 255);
    }
  }
}
