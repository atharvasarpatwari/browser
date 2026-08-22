import type { RGBA } from './rasterizer';

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay'
  | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion'
  | 'hue' | 'saturation' | 'color' | 'luminosity'
  | 'plus-lighter' | 'plus-darker';

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function lum(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function setLum(r: number, g: number, b: number, l: number): { r: number; g: number; b: number } {
  const d = l - lum(r, g, b);
  return { r: r + d, g: g + d, b: b + d };
}

function clipColor(r: number, g: number, b: number, a: number): { r: number; g: number; b: number } {
  const l = lum(r, g, b);
  const n = Math.min(r, g, b);
  const x = Math.max(r, g, b);
  if (n < 0) return setLum(r, g, b, l + (n * (l - 255)) / (n - 255));
  if (x > 255) return setLum(r, g, b, l + ((x - 255) * (255 - l)) / (x - l));
  return { r, g, b };
}

function sat(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function setSat(r: number, g: number, b: number, s: number): { r: number; g: number; b: number } {
  const ref = [r, g, b].sort((a, b) => a - b);
  const min = ref[0];
  const mid = ref[1];
  const max = ref[2];
  let result = { r, g, b };
  if (max > min) {
    const arr = [r, g, b];
    for (let i = 0; i < 3; i++) {
      if (arr[i] === min) result = { ...result, [['r', 'g', 'b'][i]]: (arr[i] * s) / (max - min) };
      else if (arr[i] !== max) result = { ...result, [['r', 'g', 'b'][i]]: ((arr[i] - min) * s) / (max - min) };
    }
  }
  return result;
}

function blendChannel(b: number, s: number, mode: BlendMode): number {
  const bc = b / 255;
  const sc = s / 255;
  let result: number;
  switch (mode) {
    case 'multiply': result = bc * sc; break;
    case 'screen': result = 1 - (1 - bc) * (1 - sc); break;
    case 'overlay': result = bc < 0.5 ? 2 * bc * sc : 1 - 2 * (1 - bc) * (1 - sc); break;
    case 'darken': result = Math.min(bc, sc); break;
    case 'lighten': result = Math.max(bc, sc); break;
    case 'color-dodge': result = bc === 0 ? 0 : Math.min(1, sc / (1 - bc)); break;
    case 'color-burn': result = bc >= 1 ? 1 : 1 - Math.min(1, (1 - sc) / bc); break;
    case 'hard-light': result = sc < 0.5 ? 2 * bc * sc : 1 - 2 * (1 - bc) * (1 - sc); break;
    case 'soft-light': {
      const d = bc <= 0.25 ? ((16 * bc - 12) * bc + 4) * bc : Math.sqrt(bc);
      result = sc < 0.5 ? bc - (1 - 2 * sc) * bc * (1 - bc) : bc + (2 * sc - 1) * (d - bc);
      break;
    }
    case 'difference': result = Math.abs(bc - sc); break;
    case 'exclusion': result = bc + sc - 2 * bc * sc; break;
    case 'plus-lighter': result = Math.min(1, bc + sc); break;
    case 'plus-darker': result = Math.max(0, bc + sc - 1); break;
    default: result = sc; break;
  }
  return clamp(Math.round(result * 255));
}

export function blendColors(back: RGBA, src: RGBA, mode: BlendMode): RGBA {
  if (mode === 'normal' || mode === 'plus-lighter' || mode === 'plus-darker') {
    return src;
  }

  const br = back.r, bg = back.g, bb = back.b;
  const sr = src.r, sg = src.g, sb = src.b;

  if (mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity') {
    const s = sat(sr, sg, sb);
    const l = lum(sr, sg, sb);
    let result: { r: number; g: number; b: number };
    switch (mode) {
      case 'hue': {
        const t = setSat(sr, sg, sb, sat(br, bg, bb));
        result = setLum(t.r, t.g, t.b, lum(br, bg, bb));
        break;
      }
      case 'saturation': {
        const t = setSat(br, bg, bb, sat(sr, sg, sb));
        result = setLum(t.r, t.g, t.b, lum(br, bg, bb));
        break;
      }
      case 'color': {
        result = setLum(sr, sg, sb, lum(br, bg, bb));
        break;
      }
      case 'luminosity': {
        result = setLum(br, bg, bb, lum(sr, sg, sb));
        break;
      }
      default: result = { r: sr, g: sg, b: sb };
    }
    const clipped = clipColor(result.r, result.g, result.b, src.a);
    return { r: clipped.r, g: clipped.g, b: clipped.b, a: src.a };
  }

  return {
    r: blendChannel(back.r, src.r, mode),
    g: blendChannel(back.g, src.g, mode),
    b: blendChannel(back.b, src.b, mode),
    a: src.a,
  };
}

export function compositeBuffer(dst: ImageData, src: ImageData, mode: BlendMode, dx: number, dy: number): void {
  for (let py = 0; py < src.height; py++) {
    for (let px = 0; px < src.width; px++) {
      const bx = dx + px;
      const by = dy + py;
      if (bx < 0 || bx >= dst.width || by < 0 || by >= dst.height) continue;
      const si = (py * src.width + px) * 4;
      const di = (by * dst.width + bx) * 4;
      const sAlpha = src.data[si + 3] / 255;
      if (sAlpha <= 0) continue;

      const back: RGBA = { r: dst.data[di], g: dst.data[di + 1], b: dst.data[di + 2], a: dst.data[di + 3] / 255 };
      const srcColor: RGBA = { r: src.data[si], g: src.data[si + 1], b: src.data[si + 2], a: sAlpha };

      const blended = blendColors(back, srcColor, mode);

      const outA = blended.a + back.a * (1 - blended.a);
      if (outA > 0) {
        dst.data[di] = (blended.r * blended.a + back.r * back.a * (1 - blended.a)) / outA;
      }
      dst.data[di + 1] = (blended.g * blended.a + back.g * back.a * (1 - blended.a)) / outA;
      dst.data[di + 2] = (blended.b * blended.a + back.b * back.a * (1 - blended.a)) / outA;
      dst.data[di + 3] = outA * 255;
    }
  }
}
