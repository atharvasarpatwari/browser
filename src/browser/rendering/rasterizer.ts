import type { PaintCommand } from './paint-engine';
import { evaluateGradient, fillGradient } from './css-gradients';
import type { GradientInfo } from './css-gradients';
import { renderBoxShadow, renderTextShadow } from './shadows';
import type { BoxShadow, TextShadow } from './shadows';
import { applyFilters } from './css-filters';
import type { FilterList } from './css-filters';
import { applyClipBuffer } from './clip-mask';
import type { ClipShape, MaskInfo } from './clip-mask';
import { compositeBuffer } from './blend-modes';
import type { BlendMode } from './blend-modes';
import type { BorderRadius } from './borders-enhanced';
import { rasterizeTextRun } from './text-raster';
import type { TextMask } from './text-raster';

// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// RGBA COLOR
// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// COLOR PARSER
// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

const NAMED_COLORS: Record<string, RGBA> = {
  'transparent': TRANSPARENT,
  'black':       BLACK,
  'silver':      { r: 192, g: 192, b: 192, a: 1 },
  'gray':        { r: 128, g: 128, b: 128, a: 1 },
  'white':       WHITE,
  'maroon':      { r: 128, g: 0,   b: 0,   a: 1 },
  'red':         { r: 255, g: 0,   b: 0,   a: 1 },
  'purple':      { r: 128, g: 0,   b: 128, a: 1 },
  'fuchsia':     { r: 255, g: 0,   b: 255, a: 1 },
  'green':       { r: 0,   g: 128, b: 0,   a: 1 },
  'lime':        { r: 0,   g: 255, b: 0,   a: 1 },
  'olive':       { r: 128, g: 128, b: 0,   a: 1 },
  'yellow':      { r: 255, g: 255, b: 0,   a: 1 },
  'navy':        { r: 0,   g: 0,   b: 128, a: 1 },
  'blue':        { r: 0,   g: 0,   b: 255, a: 1 },
  'teal':        { r: 0,   g: 128, b: 128, a: 1 },
  'aqua':        { r: 0,   g: 255, b: 255, a: 1 },
  'orange':      { r: 255, g: 165, b: 0,   a: 1 },
  'aliceblue':   { r: 240, g: 248, b: 255, a: 1 },
  'antiquewhite':{ r: 250, g: 235, b: 215, a: 1 },
  'cyan':        { r: 0,   g: 255, b: 255, a: 1 },
  'darkblue':    { r: 0,   g: 0,   b: 139, a: 1 },
  'darkgray':    { r: 169, g: 169, b: 169, a: 1 },
  'darkgreen':   { r: 0,   g: 100, b: 0,   a: 1 },
  'darkred':     { r: 139, g: 0,   b: 0,   a: 1 },
  'gold':        { r: 255, g: 215, b: 0,   a: 1 },
  'greenyellow': { r: 173, g: 255, b: 47,  a: 1 },
  'hotpink':     { r: 255, g: 105, b: 180, a: 1 },
  'indianred':   { r: 205, g: 92,  b: 92,  a: 1 },
  'khaki':       { r: 240, g: 230, b: 140, a: 1 },
  'lightblue':   { r: 173, g: 216, b: 230, a: 1 },
  'lightgray':   { r: 211, g: 211, b: 211, a: 1 },
  'lightgreen':  { r: 144, g: 238, b: 144, a: 1 },
  'lightyellow': { r: 255, g: 255, b: 224, a: 1 },
  'magenta':     { r: 255, g: 0,   b: 255, a: 1 },
  'mediumblue':  { r: 0,   g: 0,   b: 205, a: 1 },
  'pink':        { r: 255, g: 192, b: 203, a: 1 },
  'plum':        { r: 221, g: 160, b: 221, a: 1 },
  'powderblue':  { r: 176, g: 224, b: 230, a: 1 },
  'rosybrown':   { r: 188, g: 143, b: 143, a: 1 },
  'royalblue':   { r: 65,  g: 105, b: 225, a: 1 },
  'salmon':      { r: 250, g: 128, b: 114, a: 1 },
  'seagreen':    { r: 46,  g: 139, b: 87,  a: 1 },
  'skyblue':     { r: 135, g: 206, b: 235, a: 1 },
  'slategray':   { r: 112, g: 128, b: 144, a: 1 },
  'steelblue':   { r: 70,  g: 130, b: 180, a: 1 },
  'tan':         { r: 210, g: 180, b: 140, a: 1 },
  'tomato':      { r: 255, g: 99,  b: 71,  a: 1 },
  'turquoise':   { r: 64,  g: 224, b: 208, a: 1 },
  'violet':      { r: 238, g: 130, b: 238, a: 1 },
  'wheat':       { r: 245, g: 222, b: 179, a: 1 },
  'whitesmoke':  { r: 245, g: 245, b: 245, a: 1 },
};

function clamp255(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : (n | 0);
}

function hexChar(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;       // 0-9
  if (c >= 65 && c <= 70) return c - 55;        // A-F
  if (c >= 97 && c <= 102) return c - 87;       // a-f
  return 0;
}

/**
 * Parse a CSS color string into RGBA.
 *
 * Supports: named colors, #rgb, #rrggbb, #rrggbbaa, rgb(), rgba().
 */
export function parseColor(color: string): RGBA {
  if (!color || color === 'none') return TRANSPARENT;

  const lower = color.toLowerCase().trim();

  if (lower === 'transparent') return TRANSPARENT;
  if (NAMED_COLORS[lower]) return { ...NAMED_COLORS[lower] };

  if (lower.startsWith('#')) {
    const hex = lower.slice(1);
    if (hex.length === 3) {
      return {
        r: clamp255(hexChar(hex.charCodeAt(0)) * 17),
        g: clamp255(hexChar(hex.charCodeAt(1)) * 17),
        b: clamp255(hexChar(hex.charCodeAt(2)) * 17),
        a: 1,
      };
    }
    if (hex.length === 6) {
      return {
        r: clamp255((hexChar(hex.charCodeAt(0)) << 4) | hexChar(hex.charCodeAt(1))),
        g: clamp255((hexChar(hex.charCodeAt(2)) << 4) | hexChar(hex.charCodeAt(3))),
        b: clamp255((hexChar(hex.charCodeAt(4)) << 4) | hexChar(hex.charCodeAt(5))),
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: clamp255((hexChar(hex.charCodeAt(0)) << 4) | hexChar(hex.charCodeAt(1))),
        g: clamp255((hexChar(hex.charCodeAt(2)) << 4) | hexChar(hex.charCodeAt(3))),
        b: clamp255((hexChar(hex.charCodeAt(4)) << 4) | hexChar(hex.charCodeAt(5))),
        a: clamp255((hexChar(hex.charCodeAt(6)) << 4) | hexChar(hex.charCodeAt(7))) / 255,
      };
    }
  }

  const rgbMatch = lower.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,\/]+([\d.]+%?))?\s*\)/);
  if (rgbMatch) {
    return {
      r: clamp255(parseFloat(rgbMatch[1])),
      g: clamp255(parseFloat(rgbMatch[2])),
      b: clamp255(parseFloat(rgbMatch[3])),
      a: rgbMatch[4] !== undefined
        ? clamp01(rgbMatch[4].endsWith('%') ? parseFloat(rgbMatch[4]) / 100 : parseFloat(rgbMatch[4]))
        : 1,
    };
  }

  // hsl()/hsla(), comma or space syntax, optional deg and "/ alpha". Used to fall through to BLACK.
  const hslMatch = lower.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,\/]+([\d.]+%?))?\s*\)$/);
  if (hslMatch) {
    const h = (parseFloat(hslMatch[1]) % 360) / 360;
    const s = clamp01(parseFloat(hslMatch[2]) / 100);
    const l = clamp01(parseFloat(hslMatch[3]) / 100);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number): number => {
      const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (u < 1 / 6) return p + (q - p) * 6 * u;
      if (u < 1 / 2) return q;
      if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
      return p;
    };
    const a = hslMatch[4];
    return {
      r: clamp255(Math.round(hue(h + 1 / 3) * 255)),
      g: clamp255(Math.round(hue(h) * 255)),
      b: clamp255(Math.round(hue(h - 1 / 3) * 255)),
      a: a !== undefined ? clamp01(a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a)) : 1,
    };
  }

  // CSS Color 4: oklch()/oklab()/lab()/lch()/hwb()/color(srgb …). They used to fall through to
  // BLACK, so a site styled with oklch() (iana.org's footer) drew black text on black.
  const modern = parseModernColor(lower);
  if (modern) return modern;

  return BLACK;
}

/** One numeric component: `50%` scaled to `percentOf`, `none` = 0, `deg`/`turn`/`rad` for hues. */
function colorComponent(raw: string, percentOf: number): number {
  if (raw === 'none') return 0;
  if (raw.endsWith('%')) return (parseFloat(raw) / 100) * percentOf;
  if (raw.endsWith('turn')) return parseFloat(raw) * 360;
  if (raw.endsWith('rad')) return (parseFloat(raw) * 180) / Math.PI;
  if (raw.endsWith('grad')) return parseFloat(raw) * 0.9;
  return parseFloat(raw);
}

/** Linear-light sRGB (0..1) → 8-bit sRGB with the sRGB transfer curve. */
function encodeSrgb(r: number, g: number, b: number, alpha: number): RGBA {
  const enc = (c: number): number => {
    const x = Math.min(1, Math.max(0, c));
    return clamp255(Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255));
  };
  return { r: enc(r), g: enc(g), b: enc(b), a: clamp01(alpha) };
}

function oklabToRgba(L: number, a: number, b: number, alpha: number): RGBA {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return encodeSrgb(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    alpha,
  );
}

/** CIE Lab (D50) → XYZ D50 → Bradford to D65 → linear sRGB. */
function labToRgba(L: number, a: number, b: number, alpha: number): RGBA {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const e = 216 / 24389, k = 24389 / 27;
  const inv = (f: number): number => (f ** 3 > e ? f ** 3 : (116 * f - 16) / k);
  const X = 0.3457 / 0.3585 * inv(fx), Y = L > k * e ? fy ** 3 : L / k, Z = (1 - 0.3457 - 0.3585) / 0.3585 * inv(fz);
  const x = 0.9554734527042182 * X - 0.023098536874261423 * Y + 0.0632593086610217 * Z;
  const y = -0.028369706963208136 * X + 1.0099954580058226 * Y + 0.021041398966943008 * Z;
  const z = 0.012314001688319899 * X - 0.020507696433477912 * Y + 1.3303659366080753 * Z;
  return encodeSrgb(
    3.2409699419045226 * x - 1.537383177570094 * y - 0.4986107602930034 * z,
    -0.9692436362808796 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
    0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
    alpha,
  );
}

function parseModernColor(value: string): RGBA | null {
  const m = /^(oklch|oklab|lab|lch|hwb|color)\(\s*(.*?)\s*\)$/.exec(value);
  if (!m) return null;
  const fn = m[1]!;
  const [main, alphaRaw] = m[2]!.split('/').map((p) => p.trim());
  const parts = main!.split(/[\s,]+/).filter(Boolean);
  const alpha = alphaRaw ? colorComponent(alphaRaw, 1) : 1;
  if (fn === 'color') {
    // color(srgb r g b) and color(srgb-linear r g b); other spaces are rare enough to skip.
    const space = parts.shift();
    if (parts.length < 3 || (space !== 'srgb' && space !== 'srgb-linear')) return null;
    const [r, g, b] = parts.map((p) => colorComponent(p, 1));
    if (space === 'srgb-linear') return encodeSrgb(r!, g!, b!, alpha);
    return { r: clamp255(Math.round(r! * 255)), g: clamp255(Math.round(g! * 255)), b: clamp255(Math.round(b! * 255)), a: clamp01(alpha) };
  }
  if (parts.length < 3 || parts.some((p) => !/^(-?[\d.]+(%|deg|turn|rad|grad)?|none)$/.test(p))) return null;
  const [p0, p1, p2] = parts as [string, string, string];
  switch (fn) {
    case 'oklab': return oklabToRgba(colorComponent(p0, 1), colorComponent(p1, 0.4), colorComponent(p2, 0.4), alpha);
    case 'oklch': {
      const L = colorComponent(p0, 1), C = colorComponent(p1, 0.4), h = (colorComponent(p2, 360) * Math.PI) / 180;
      return oklabToRgba(L, C * Math.cos(h), C * Math.sin(h), alpha);
    }
    case 'lab': return labToRgba(colorComponent(p0, 100), colorComponent(p1, 125), colorComponent(p2, 125), alpha);
    case 'lch': {
      const L = colorComponent(p0, 100), C = colorComponent(p1, 150), h = (colorComponent(p2, 360) * Math.PI) / 180;
      return labToRgba(L, C * Math.cos(h), C * Math.sin(h), alpha);
    }
    case 'hwb': {
      // hwb(h w b): an hsl colour mixed with white and black.
      let w = colorComponent(p1, 1), bl = colorComponent(p2, 1);
      if (w + bl >= 1) { const g = w / (w + bl); return { r: clamp255(Math.round(g * 255)), g: clamp255(Math.round(g * 255)), b: clamp255(Math.round(g * 255)), a: clamp01(alpha) }; }
      const base = parseColor(`hsl(${((colorComponent(p0, 360) % 360) + 360) % 360} 100% 50%)`);
      const mix = (c: number): number => clamp255(Math.round((c / 255) * (1 - w - bl) * 255 + w * 255));
      return { r: mix(base.r), g: mix(base.g), b: mix(base.b), a: clamp01(alpha) };
    }
  }
  return null;
}

/** True when parseColor understands the value (it falls back to black otherwise). */
export function isParsableColor(color: string): boolean {
  const lower = color.toLowerCase().trim();
  return lower === 'transparent' || !!NAMED_COLORS[lower] || /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/.test(lower) ||
    /^rgba?\(/.test(lower) || /^hsla?\(/.test(lower) || parseModernColor(lower) !== null;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// BITMAP FONT (8x8 ASCII 32???126)
// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

const FONT_W = 8;
const FONT_H = 8;

/**
 * 8??8 bitmap font data for printable ASCII (32???126).
 * Each character = 8 bytes; each byte = one row, MSB = leftmost pixel.
 */
const FONT_DATA: number[] = [
  // 32  (space)
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  // 33  !
  0x18,0x18,0x18,0x18,0x18,0x00,0x18,0x00,
  // 34  "
  0x6C,0x6C,0x6C,0x00,0x00,0x00,0x00,0x00,
  // 35  #
  0x6C,0xFE,0x6C,0x6C,0xFE,0x6C,0x00,0x00,
  // 36  $
  0x18,0x7E,0xC0,0x7C,0x06,0xFC,0x18,0x00,
  // 37  %
  0x00,0xC6,0xCC,0x18,0x30,0x66,0xC6,0x00,
  // 38  &
  0x38,0x6C,0x38,0x76,0xDC,0xCC,0x76,0x00,
  // 39  '
  0x18,0x18,0x30,0x00,0x00,0x00,0x00,0x00,
  // 40  (
  0x0C,0x18,0x30,0x30,0x30,0x18,0x0C,0x00,
  // 41  )
  0x30,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x00,
  // 42  *
  0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00,
  // 43  +
  0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00,
  // 44  ,
  0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x30,
  // 45  -
  0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00,
  // 46  .
  0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00,
  // 47  /
  0x06,0x0C,0x18,0x30,0x60,0xC0,0x00,0x00,
  // 48  0
  0x7C,0xC6,0xCE,0xDE,0xF6,0xE6,0x7C,0x00,
  // 49  1
  0x18,0x38,0x78,0x18,0x18,0x18,0x7E,0x00,
  // 50  2
  0x7C,0xC6,0x06,0x1C,0x30,0x66,0xFE,0x00,
  // 51  3
  0x7C,0xC6,0x06,0x3C,0x06,0xC6,0x7C,0x00,
  // 52  4
  0x1C,0x3C,0x6C,0xCC,0xFE,0x0C,0x1E,0x00,
  // 53  5
  0xFE,0xC0,0xFC,0x06,0x06,0xC6,0x7C,0x00,
  // 54  6
  0x38,0x60,0xC0,0xFC,0xC6,0xC6,0x7C,0x00,
  // 55  7
  0xFE,0xC6,0x0C,0x18,0x30,0x30,0x30,0x00,
  // 56  8
  0x7C,0xC6,0xC6,0x7C,0xC6,0xC6,0x7C,0x00,
  // 57  9
  0x7C,0xC6,0xC6,0x7E,0x06,0x0C,0x78,0x00,
  // 58  :
  0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00,
  // 59  ;
  0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x30,
  // 60  <
  0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x00,
  // 61  =
  0x00,0x00,0x7E,0x00,0x00,0x7E,0x00,0x00,
  // 62  >
  0x60,0x30,0x18,0x0C,0x18,0x30,0x60,0x00,
  // 63  ?
  0x7C,0xC6,0x0C,0x18,0x18,0x00,0x18,0x00,
  // 64  @
  0x00,0x7C,0xC6,0xDE,0xDE,0xDE,0x7C,0x00,
  // 65  A
  0x38,0x6C,0xC6,0xC6,0xFE,0xC6,0xC6,0x00,
  // 66  B
  0xFC,0x66,0x66,0x7C,0x66,0x66,0xFC,0x00,
  // 67  C
  0x3C,0x66,0xC0,0xC0,0xC0,0x66,0x3C,0x00,
  // 68  D
  0xF8,0x6C,0x66,0x66,0x66,0x6C,0xF8,0x00,
  // 69  E
  0xFE,0x62,0x68,0x78,0x68,0x62,0xFE,0x00,
  // 70  F
  0xFE,0x62,0x68,0x78,0x68,0x60,0xF0,0x00,
  // 71  G
  0x3C,0x66,0xC0,0xC0,0xCE,0x66,0x3E,0x00,
  // 72  H
  0xC6,0xC6,0xC6,0xFE,0xC6,0xC6,0xC6,0x00,
  // 73  I
  0x3C,0x18,0x18,0x18,0x18,0x18,0x3C,0x00,
  // 74  J
  0x1E,0x0C,0x0C,0x0C,0xCC,0xCC,0x78,0x00,
  // 75  K
  0xE6,0x66,0x6C,0x78,0x6C,0x66,0xE6,0x00,
  // 76  L
  0xF0,0x60,0x60,0x60,0x62,0x66,0xFE,0x00,
  // 77  M
  0xC6,0xEE,0xFE,0xFE,0xD6,0xC6,0xC6,0x00,
  // 78  N
  0xC6,0xE6,0xF6,0xDE,0xCE,0xC6,0xC6,0x00,
  // 79  O
  0x7C,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00,
  // 80  P
  0xFC,0x66,0x66,0x7C,0x60,0x60,0xF0,0x00,
  // 81  Q
  0x7C,0xC6,0xC6,0xC6,0xD6,0xDE,0x7C,0x06,
  // 82  R
  0xFC,0x66,0x66,0x7C,0x6C,0x66,0xE6,0x00,
  // 83  S
  0x7C,0xC6,0x60,0x38,0x0C,0xC6,0x7C,0x00,
  // 84  T
  0x7E,0x7E,0x5A,0x18,0x18,0x18,0x3C,0x00,
  // 85  U
  0xC6,0xC6,0xC6,0xC6,0xC6,0xC6,0x7C,0x00,
  // 86  V
  0xC6,0xC6,0xC6,0xC6,0x6C,0x38,0x10,0x00,
  // 87  W
  0xC6,0xC6,0xD6,0xFE,0xFE,0xEE,0xC6,0x00,
  // 88  X
  0xC6,0x6C,0x38,0x38,0x6C,0xC6,0xC6,0x00,
  // 89  Y
  0x66,0x66,0x66,0x3C,0x18,0x18,0x3C,0x00,
  // 90  Z
  0xFE,0xC6,0x8C,0x18,0x32,0x66,0xFE,0x00,
  // 91  [
  0x3C,0x30,0x30,0x30,0x30,0x30,0x3C,0x00,
  // 92  backslash
  0xC0,0x60,0x30,0x18,0x0C,0x06,0x00,0x00,
  // 93  ]
  0x3C,0x0C,0x0C,0x0C,0x0C,0x0C,0x3C,0x00,
  // 94  ^
  0x10,0x38,0x6C,0xC6,0x00,0x00,0x00,0x00,
  // 95  _
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xFF,
  // 96  `
  0x30,0x18,0x0C,0x00,0x00,0x00,0x00,0x00,
  // 97  a
  0x00,0x00,0x78,0x0C,0x7C,0xCC,0x76,0x00,
  // 98  b
  0xE0,0x60,0x7C,0x66,0x66,0x66,0xDC,0x00,
  // 99  c
  0x00,0x00,0x7C,0xC6,0xC0,0xC6,0x7C,0x00,
  // 100 d
  0x1C,0x0C,0x7C,0xCC,0xCC,0xCC,0x76,0x00,
  // 101 e
  0x00,0x00,0x7C,0xC6,0xFE,0xC0,0x7C,0x00,
  // 102 f
  0x38,0x6C,0x60,0xF8,0x60,0x60,0xF0,0x00,
  // 103 g
  0x00,0x00,0x76,0xCC,0xCC,0x7C,0x0C,0xF8,
  // 104 h
  0xE0,0x60,0x6C,0x76,0x66,0x66,0xE6,0x00,
  // 105 i
  0x18,0x00,0x38,0x18,0x18,0x18,0x3C,0x00,
  // 106 j
  0x06,0x00,0x06,0x06,0x06,0x66,0x66,0x3C,
  // 107 k
  0xE0,0x60,0x66,0x6C,0x78,0x6C,0xE6,0x00,
  // 108 l
  0x38,0x18,0x18,0x18,0x18,0x18,0x3C,0x00,
  // 109 m
  0x00,0x00,0xEC,0xFE,0xD6,0xD6,0xD6,0x00,
  // 110 n
  0x00,0x00,0xDC,0x66,0x66,0x66,0x66,0x00,
  // 111 o
  0x00,0x00,0x7C,0xC6,0xC6,0xC6,0x7C,0x00,
  // 112 p
  0x00,0x00,0xDC,0x66,0x66,0x7C,0x60,0xF0,
  // 113 q
  0x00,0x00,0x76,0xCC,0xCC,0x7C,0x0C,0x1E,
  // 114 r
  0x00,0x00,0xDC,0x76,0x60,0x60,0xF0,0x00,
  // 115 s
  0x00,0x00,0x7E,0xC0,0x7C,0x06,0xFC,0x00,
  // 116 t
  0x30,0x30,0xFC,0x30,0x30,0x36,0x1C,0x00,
  // 117 u
  0x00,0x00,0xCC,0xCC,0xCC,0xCC,0x76,0x00,
  // 118 v
  0x00,0x00,0xC6,0xC6,0xC6,0x6C,0x38,0x00,
  // 119 w
  0x00,0x00,0xC6,0xD6,0xD6,0xFE,0x6C,0x00,
  // 120 x
  0x00,0x00,0xC6,0x6C,0x38,0x6C,0xC6,0x00,
  // 121 y
  0x00,0x00,0xC6,0xC6,0xCE,0x76,0x06,0xFC,
  // 122 z
  0x00,0x00,0xFC,0x98,0x30,0x64,0xFC,0x00,
  // 123 {
  0x0E,0x18,0x18,0x70,0x18,0x18,0x0E,0x00,
  // 124 |
  0x18,0x18,0x18,0x00,0x18,0x18,0x18,0x00,
  // 125 }
  0x70,0x18,0x18,0x0E,0x18,0x18,0x70,0x00,
  // 126 ~
  0x76,0xDC,0x00,0x00,0x00,0x00,0x00,0x00,
];

function getCharBitmap(charCode: number): number[] | null {
  if (charCode < 32 || charCode > 126) return null;
  const offset = (charCode - 32) * FONT_H;
  return FONT_DATA.slice(offset, offset + FONT_H);
}

// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// RASTERIZER STATE
// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

interface ClipRect {
  x: number; y: number; w: number; h: number;
}

interface RasterState {
  fillStyle: RGBA;
  strokeStyle: RGBA;
  lineWidth: number;
  font: string;
  fontSize: number;
  textAlign: string;
  globalAlpha: number;
  fillGradient: GradientInfo | null;
  blendMode: BlendMode;
  borderRadius: BorderRadius | null;
  borderBox: { x: number; y: number; w: number; h: number } | null;
  clipRect: ClipRect | null;
  translateX: number;
  translateY: number;
}

function defaultState(): RasterState {
  return {
    fillStyle: { ...BLACK },
    strokeStyle: { ...BLACK },
    lineWidth: 1,
    font: '16px sans-serif',
    fontSize: 16,
    textAlign: 'start',
    globalAlpha: 1,
    fillGradient: null,
    blendMode: 'normal',
    borderRadius: null,
    borderBox: null,
    clipRect: null,
    translateX: 0,
    translateY: 0,
  };
}

function cloneState(s: RasterState): RasterState {
  return {
    fillStyle: { ...s.fillStyle },
    strokeStyle: { ...s.strokeStyle },
    lineWidth: s.lineWidth,
    font: s.font,
    fontSize: s.fontSize,
    textAlign: s.textAlign,
    globalAlpha: s.globalAlpha,
    fillGradient: s.fillGradient,
    blendMode: s.blendMode,
    borderRadius: s.borderRadius,
    borderBox: s.borderBox ? { ...s.borderBox } : null,
    clipRect: s.clipRect ? { ...s.clipRect } : null,
    translateX: s.translateX,
    translateY: s.translateY,
  };
}

// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
// RASTERIZER
// ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

export interface RasterConfig {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio?: number;
  readonly backgroundColor?: string;
}

export class Rasterizer {
  readonly width: number;
  readonly height: number;
  private pixels: Uint8ClampedArray;
  private stateStack: RasterState[];
  private state: RasterState;

  constructor(config: RasterConfig) {
    this.width = config.width;
    this.height = config.height;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    this.stateStack = [];
    this.state = defaultState();

    const bg = config.backgroundColor
      ? parseColor(config.backgroundColor)
      : WHITE;
    this.fillWholeBuffer(bg);
  }

  private fillWholeBuffer(c: RGBA): void {
    const p = this.pixels;
    const len = p.length;
    const r = c.r, g = c.g, b = c.b, a = c.a;
    for (let i = 0; i < len; i += 4) {
      p[i]     = r;
      p[i + 1] = g;
      p[i + 2] = b;
      p[i + 3] = a * 255 | 0;
    }
  }

  /** Returns the pixel buffer as an ImageData object. */
  getImageData(): ImageData {
    return new ImageData(this.pixels as unknown as ImageDataArray, this.width, this.height);
  }

  /** Returns the raw pixel buffer (RGBA, 4 bytes per pixel). */
  getPixels(): Uint8ClampedArray {
    return this.pixels;
  }

  // ?????? Main entry point ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

  /** Execute all paint commands and return the composited ImageData. */
  rasterize(commands: readonly PaintCommand[]): ImageData {
    for (const cmd of commands) {
      this.exec(cmd);
    }
    return this.getImageData();
  }

  /** Async variant ??? resolves immediately since software rasterization is synchronous. */
  async rasterizeAsync(commands: readonly PaintCommand[]): Promise<ImageData> {
    return this.rasterize(commands);
  }

  // ?????? Command dispatch ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

  private exec(cmd: PaintCommand): void {
    switch (cmd.type) {
      case 'clearRect':
        this.clearRect(cmd.params as unknown as [number, number, number, number]);
        break;
      case 'fillRect':
        this.fillRect(cmd.params as unknown as [number, number, number, number]);
        break;
      case 'strokeRect':
        this.strokeRect(cmd.params as unknown as [number, number, number, number]);
        break;
      case 'setFillStyle':
        this.state.fillStyle = parseColor(cmd.params[0] as string);
        break;
      case 'setStrokeStyle':
        this.state.strokeStyle = parseColor(cmd.params[0] as string);
        break;
      case 'setLineWidth':
        this.state.lineWidth = cmd.params[0] as number;
        break;
      case 'setFont':
        this.setFont(cmd.params[0] as string);
        break;
      case 'setTextAlign':
        this.state.textAlign = cmd.params[0] as string;
        break;
      case 'save':
        this.stateStack.push(cloneState(this.state));
        break;
      case 'restore':
        if (this.stateStack.length > 0) {
          this.state = this.stateStack.pop()!;
        }
        break;
      case 'setGlobalAlpha':
        this.state.globalAlpha = clamp01(cmd.params[0] as number);
        break;
      case 'fillText':
        this.fillText(cmd.params as unknown as [string, number, number]);
        break;
      case 'strokeText':
        this.strokeText(cmd.params as unknown as [string, number, number]);
        break;
      case 'drawImage': {
        const imgData = cmd.params[0] as { data: Uint8ClampedArray; width: number; height: number };
        const dx = cmd.params[1] as number;
        const dy = cmd.params[2] as number;
        const dw = cmd.params[3] as number;
        const dh = cmd.params[4] as number;
        this.drawImage(imgData, dx, dy, dw, dh);
        break;
      }
      case 'setFillGradient': {
        const [grad, gx, gy, gw, gh] = cmd.params as [GradientInfo, number, number, number, number];
        this.state.fillGradient = grad;
        if (grad) {
          this.fillGradientRect(grad, gx, gy, gw, gh);
        }
        break;
      }
      case 'setBlendMode': {
        this.state.blendMode = (cmd.params[0] as string) as BlendMode;
        break;
      }
      case 'setBorderRadius': {
        const [radius, rx, ry, rw, rh] = cmd.params as [BorderRadius, number, number, number, number];
        this.state.borderRadius = radius;
        this.state.borderBox = { x: rx, y: ry, w: rw, h: rh };
        break;
      }
      case 'applyBoxShadow': {
        const [shadow, sx, sy, sw, sh] = cmd.params as [BoxShadow, number, number, number, number];
        applyBoxShadowToPixels(this.pixels, this.width, this.height, shadow, sx, sy, sw, sh);
        break;
      }
      case 'applyTextShadow': {
        const [ts, text, tx, ty, color, fontStr] = cmd.params as [TextShadow, string, number, number, string, string];
        applyTextShadowToPixels(this.pixels, this.width, this.height, ts, text, tx, ty, color, fontStr);
        break;
      }
      case 'applyFilterList': {
        const [filters, fx, fy, fw, fh] = cmd.params as [FilterList, number, number, number, number];
        applyFiltersToBuffer(this.pixels, this.width, this.height, filters, fx, fy, fw, fh);
        break;
      }
      case 'applyClipShape': {
        const [shape, cx, cy, cw, ch] = cmd.params as [ClipShape, number, number, number, number];
        applyClipShapeToPixels(this.pixels, this.width, this.height, shape, cx, cy, cw, ch);
        break;
      }
      case 'applyMask': {
        const [maskInfo, mx, my, mw, mh] = cmd.params as [MaskInfo[], number, number, number, number];
        applyMaskToPixels(this.pixels, this.width, this.height, maskInfo, mx, my, mw, mh);
        break;
      }
      case 'fillRoundedRing': {
        const [radius, rx, ry, rw, rh, bt, br, bb, bl] = cmd.params as [BorderRadius, number, number, number, number, number, number, number, number];
        this.fillRoundedRing(radius, { x: rx, y: ry, w: rw, h: rh }, bt, br, bb, bl);
        break;
      }
      case 'clip': {
        const [cx, cy, cw, ch] = cmd.params as [number, number, number, number];
        if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cw) || !Number.isFinite(ch)) break;
        const newCr: ClipRect = { x: cx, y: cy, w: cw, h: ch };
        const cur = this.state.clipRect;
        if (cur) {
          const ix = Math.max(cur.x, newCr.x);
          const iy = Math.max(cur.y, newCr.y);
          const ix1 = Math.min(cur.x + cur.w, newCr.x + newCr.w);
          const iy1 = Math.min(cur.y + cur.h, newCr.y + newCr.h);
          this.state.clipRect = ix < ix1 && iy < iy1
            ? { x: ix, y: iy, w: ix1 - ix, h: iy1 - iy }
            : { x: 0, y: 0, w: 0, h: 0 };
        } else {
          this.state.clipRect = newCr;
        }
        break;
      }
      case 'beginPath':
      case 'closePath':
      case 'fill':
      case 'stroke':
        break;
    }
  }

  private setFont(fontStr: string): void {
    this.state.font = fontStr;
    const m = fontStr.match(/(\d+(?:\.\d+)?)\s*px/);
    if (m) this.state.fontSize = parseFloat(m[1]);
  }

  // ?????? Low-level pixel operations ?????????????????????????????????????????????????????????????????????????????????????????????????????????

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private setPixelRaw(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const idx = (y * this.width + x) * 4;
    if (a >= 1) {
      this.pixels[idx]     = r;
      this.pixels[idx + 1] = g;
      this.pixels[idx + 2] = b;
      this.pixels[idx + 3] = 255;
    } else {
      const da = this.pixels[idx + 3] / 255;
      const outA = a + da * (1 - a);
      if (outA > 0) {
        const invA = 1 / outA;
        this.pixels[idx]     = (r * a + this.pixels[idx]     * da * (1 - a)) * invA | 0;
        this.pixels[idx + 1] = (g * a + this.pixels[idx + 1] * da * (1 - a)) * invA | 0;
        this.pixels[idx + 2] = (b * a + this.pixels[idx + 2] * da * (1 - a)) * invA | 0;
        this.pixels[idx + 3] = outA * 255 | 0;
      }
    }
  }

  private fillRectRaw(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0 || w <= 0 || h <= 0) return;
    let x0 = Math.max(0, x | 0);
    let y0 = Math.max(0, y | 0);
    let x1 = Math.min(this.width, (x + w) | 0);
    let y1 = Math.min(this.height, (y + h) | 0);
    // Apply clip rect
    if (this.state.clipRect) {
      const cr = this.state.clipRect;
      x0 = Math.max(x0, cr.x | 0);
      y0 = Math.max(y0, cr.y | 0);
      x1 = Math.min(x1, (cr.x + cr.w) | 0);
      y1 = Math.min(y1, (cr.y + cr.h) | 0);
    }
    if (x0 >= x1 || y0 >= y1) return;

    const radius = this.state.borderRadius;
    const box = this.state.borderBox;
    if (radius && box) {
      // Only pixels in the corner zones need coverage; rows between the corners and the middle of
      // every row are plain fills. Computing coverage for every pixel of big rounded cards made the
      // first frame of a page take 33 s on the phone.
      const rr = scaledRadii(box, radius);
      const top = box.y + Math.max(rr.tl.h, rr.tr.h), bottom = box.y + box.h - Math.max(rr.bl.h, rr.br.h);
      for (let row = y0; row < y1; row++) {
        const py = row + 0.5;
        if (py < box.y - 0.5 || py > box.y + box.h + 0.5) continue;
        const inBand = py >= top && py <= bottom;
        const left = inBand ? -Infinity : box.x + Math.max(rr.tl.w, rr.bl.w);
        const right = inBand ? Infinity : box.x + box.w - Math.max(rr.tr.w, rr.br.w);
        for (let col = x0; col < x1; col++) {
          const px = col + 0.5;
          if (px < box.x - 0.5 || px > box.x + box.w + 0.5) continue;
          const cover = px >= left && px <= right ? 1 : roundedCoverage(px, py, box, rr);
          if (cover >= 1 && a >= 1) {
            const idx = (row * this.width + col) * 4;
            this.pixels[idx] = r; this.pixels[idx + 1] = g; this.pixels[idx + 2] = b; this.pixels[idx + 3] = 255;
          } else if (cover > 0) {
            this.setPixelRaw(col, row, r, g, b, a * cover);
          }
        }
      }
      return;
    }

    if (a >= 1) {
      for (let row = y0; row < y1; row++) {
        const base = row * this.width * 4;
        for (let col = x0; col < x1; col++) {
          const idx = base + col * 4;
          this.pixels[idx]     = r;
          this.pixels[idx + 1] = g;
          this.pixels[idx + 2] = b;
          this.pixels[idx + 3] = 255;
        }
      }
    } else {
      for (let row = y0; row < y1; row++) {
        for (let col = x0; col < x1; col++) {
          this.setPixelRaw(col, row, r, g, b, a);
        }
      }
    }
  }

  // ?????? New method: fill a rect with a gradient ????????????????????????????????????????????????????????????????????????
  private fillGradientRect(grad: GradientInfo, x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    let x0 = Math.max(0, x | 0);
    let y0 = Math.max(0, y | 0);
    let x1 = Math.min(this.width, (x + w) | 0);
    let y1 = Math.min(this.height, (y + h) | 0);
    if (this.state.clipRect) {
      const cr = this.state.clipRect;
      x0 = Math.max(x0, cr.x | 0);
      y0 = Math.max(y0, cr.y | 0);
      x1 = Math.min(x1, (cr.x + cr.w) | 0);
      y1 = Math.min(y1, (cr.y + cr.h) | 0);
    }
    if (x0 >= x1 || y0 >= y1) return;
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const color = evaluateGradient(grad, px - x, py - y, w, h);
        const a = color.a * this.state.globalAlpha;
        this.setPixelRaw(px, py, color.r, color.g, color.b, a);
      }
    }
    this.state.fillGradient = null;
  }

  // ?????? Command handlers ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

  private clearRect(params: [number, number, number, number]): void {
    const [x, y, w, h] = params;
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.width, (x + w) | 0);
    const y1 = Math.min(this.height, (y + h) | 0);
    for (let row = y0; row < y1; row++) {
      const base = row * this.width * 4;
      for (let col = x0; col < x1; col++) {
        const idx = base + col * 4;
        this.pixels[idx]     = 0;
        this.pixels[idx + 1] = 0;
        this.pixels[idx + 2] = 0;
        this.pixels[idx + 3] = 0;
      }
    }
  }

  /** A rounded border: the outer rounded box minus the inner (padding) one, anti-aliased. */
  private fillRoundedRing(radius: BorderRadius, box: { x: number; y: number; w: number; h: number }, bt: number, br: number, bb: number, bl: number): void {
    const c = this.state.fillStyle;
    const a = c.a * this.state.globalAlpha;
    if (a <= 0) return;
    const inner = { x: box.x + bl, y: box.y + bt, w: box.w - bl - br, h: box.h - bt - bb };
    const shrink = (r: { w: number; h: number }, dw: number, dh: number) => ({ w: Math.max(0, r.w - dw), h: Math.max(0, r.h - dh) });
    const innerRadius: BorderRadius = {
      topLeft: shrink(radius.topLeft, bl, bt), topRight: shrink(radius.topRight, br, bt),
      bottomRight: shrink(radius.bottomRight, br, bb), bottomLeft: shrink(radius.bottomLeft, bl, bb),
    };
    let x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
    let x1 = Math.min(this.width, Math.ceil(box.x + box.w)), y1 = Math.min(this.height, Math.ceil(box.y + box.h));
    if (this.state.clipRect) {
      const cr = this.state.clipRect;
      x0 = Math.max(x0, cr.x | 0); y0 = Math.max(y0, cr.y | 0);
      x1 = Math.min(x1, (cr.x + cr.w) | 0); y1 = Math.min(y1, (cr.y + cr.h) | 0);
    }
    const outerR = scaledRadii(box, radius);
    const hasHole = inner.w > 0 && inner.h > 0;
    const innerR = hasHole ? scaledRadii(inner, innerRadius) : null;
    // Columns strictly inside the hole on rows clear of the inner corners: skipped (it used to
    // compute both coverages for every pixel of the box).
    const holeTop = inner.y + Math.max(innerR?.tl.h ?? 0, innerR?.tr.h ?? 0);
    const holeBottom = inner.y + inner.h - Math.max(innerR?.bl.h ?? 0, innerR?.br.h ?? 0);
    for (let row = y0; row < y1; row++) {
      const py = row + 0.5;
      const skipFrom = hasHole && py > holeTop && py < holeBottom ? Math.ceil(inner.x + 0.5) : Infinity;
      const skipTo = hasHole && py > holeTop && py < holeBottom ? Math.floor(inner.x + inner.w - 0.5) : -Infinity;
      for (let col = x0; col < x1; col++) {
        if (col >= skipFrom && col < skipTo) { col = skipTo - 1; continue; }
        // The ring is exact: no edge slack (that is only for straight fills snapped to whole pixels).
        const outer = roundedCoverage(col + 0.5, py, box, outerR, 0);
        if (outer <= 0) continue;
        // No slack for the hole: it would swallow a 1px outline.
        const hole = innerR ? roundedCoverage(col + 0.5, py, inner, innerR, 0) : 0;
        const cover = Math.max(0, outer - hole);
        if (cover > 0) this.setPixelRaw(col, row, c.r, c.g, c.b, a * cover);
      }
    }
  }

  private fillRect(params: [number, number, number, number]): void {
    const [x, y, w, h] = params;
    const c = this.state.fillStyle;
    const a = c.a * this.state.globalAlpha;
    this.fillRectRaw(x, y, w, h, c.r, c.g, c.b, a);
  }

  private strokeRect(params: [number, number, number, number]): void {
    const [x, y, w, h] = params;
    const c = this.state.strokeStyle;
    const a = c.a * this.state.globalAlpha;
    const lw = this.state.lineWidth;
    this.fillRectRaw(x, y, w, lw, c.r, c.g, c.b, a);
    this.fillRectRaw(x, y + h - lw, w, lw, c.r, c.g, c.b, a);
    this.fillRectRaw(x, y + lw, lw, h - 2 * lw, c.r, c.g, c.b, a);
    this.fillRectRaw(x + w - lw, y + lw, lw, h - 2 * lw, c.r, c.g, c.b, a);
  }

  private fillText(params: [string, number, number, number?]): void {
    const [text, x, y, width] = params;
    const c = this.state.fillStyle;
    const a = c.a * this.state.globalAlpha;
    // Real device font where a 2D canvas exists (any script, layout-exact widths); the 8x8
    // ASCII bitmap below is only the fallback for headless/Node runs.
    const mask = rasterizeTextRun(text, this.state.font, width);
    if (mask) { this.blendTextMask(mask, x, y, c.r, c.g, c.b, a); return; }
    const scale = this.state.fontSize / FONT_H;
    // Layout measured this run with real font advances (~0.5 em per character); the 8x8 bitmap font is 1 em wide.
    // Fit the glyphs into the laid-out width, or neighbouring words are painted over each other.
    const fitted = width !== undefined && width > 0 && text.length > 0 ? width / text.length : FONT_W * scale;
    const charW = Math.min(fitted, FONT_W * scale);
    const scaleX = charW / FONT_W;
    let startX = x;

    if (this.state.textAlign === 'center') {
      startX = x - (text.length * charW) / 2;
    } else if (this.state.textAlign === 'right' || this.state.textAlign === 'end') {
      startX = x - text.length * charW;
    }

    const baseY = Math.round(y - this.state.fontSize * 0.8);

    for (let i = 0; i < text.length; i++) {
      const bitmap = getCharBitmap(text.charCodeAt(i));
      if (bitmap) {
        const chX = Math.round(startX + i * charW);
        this.drawCharBitmap(bitmap, chX, baseY, scale, c.r, c.g, c.b, a, scaleX);
      }
    }
  }

  private strokeText(params: [string, number, number]): void {
    const [text, x, y] = params;
    const c = this.state.strokeStyle;
    const a = c.a * this.state.globalAlpha;
    // ponytail: stroked text is drawn filled with the real font (outline-only glyphs are rare on pages).
    const mask = rasterizeTextRun(text, this.state.font);
    if (mask) { this.blendTextMask(mask, x, y, c.r, c.g, c.b, a); return; }
    const scale = this.state.fontSize / FONT_H;
    const charW = FONT_W * scale;
    let startX = x;

    if (this.state.textAlign === 'center') {
      startX = x - (text.length * charW) / 2;
    } else if (this.state.textAlign === 'right' || this.state.textAlign === 'end') {
      startX = x - text.length * charW;
    }

    const baseY = Math.round(y - this.state.fontSize * 0.8);

    for (let i = 0; i < text.length; i++) {
      const bitmap = getCharBitmap(text.charCodeAt(i));
      if (bitmap) {
        const chX = Math.round(startX + i * charW);
        this.strokeCharBitmap(bitmap, chX, baseY, scale, c.r, c.g, c.b, a);
      }
    }
  }

  /** Blends a glyph coverage mask at pen position (x, baseline y), honouring text-align and the clip. */
  private blendTextMask(mask: TextMask, x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    let penX = x;
    if (this.state.textAlign === 'center') penX -= mask.advance / 2;
    else if (this.state.textAlign === 'right' || this.state.textAlign === 'end') penX -= mask.advance;
    const ox = Math.round(penX + mask.left);
    const oy = Math.round(y + mask.top);
    let x0 = Math.max(0, ox), y0 = Math.max(0, oy);
    let x1 = Math.min(this.width, ox + mask.width), y1 = Math.min(this.height, oy + mask.height);
    const clip = this.state.clipRect;
    if (clip) {
      x0 = Math.max(x0, clip.x | 0); y0 = Math.max(y0, clip.y | 0);
      x1 = Math.min(x1, (clip.x + clip.w) | 0); y1 = Math.min(y1, (clip.y + clip.h) | 0);
    }
    for (let py = y0; py < y1; py++) {
      const row = (py - oy) * mask.width - ox;
      for (let px = x0; px < x1; px++) {
        const coverage = mask.alpha[row + px]!;
        if (coverage > 0) this.setPixelRaw(px, py, r, g, b, (coverage / 255) * a);
      }
    }
  }

  private drawCharBitmap(
    bitmap: number[], ox: number, oy: number, scale: number,
    r: number, g: number, b: number, a: number,
    scaleX: number = scale,
  ): void {
    let sx = Math.max(0, ox);
    let sy = Math.max(0, oy);
    let ex = Math.min(this.width, ox + FONT_W * scaleX);
    let ey = Math.min(this.height, oy + FONT_H * scale);
    if (this.state.clipRect) {
      const cr = this.state.clipRect;
      sx = Math.max(sx, cr.x | 0);
      sy = Math.max(sy, cr.y | 0);
      ex = Math.min(ex, (cr.x + cr.w) | 0);
      ey = Math.min(ey, (cr.y + cr.h) | 0);
    }
    if (sx >= ex || sy >= ey) return;

    if (scale === 1 && scaleX === 1) {
      for (let row = sy; row < ey; row++) {
        const bmpRow = bitmap[row - oy];
        if (bmpRow === undefined) continue;
        for (let col = sx; col < ex; col++) {
          const bit = 7 - (col - ox);
          if (bmpRow & (1 << bit)) {
            this.setPixelRaw(col, row, r, g, b, a);
          }
        }
      }
    } else {
      for (let row = sy; row < ey; row++) {
        const bmpRowIdx = (row - oy) / scale | 0;
        if (bmpRowIdx < 0 || bmpRowIdx >= FONT_H) continue;
        const bmpRow = bitmap[bmpRowIdx];
        if (bmpRow === undefined) continue;
        for (let col = sx; col < ex; col++) {
          const bmpColIdx = (col - ox) / scaleX | 0;
          if (bmpColIdx < 0 || bmpColIdx >= FONT_W) continue;
          const bit = 7 - bmpColIdx;
          if (bmpRow & (1 << bit)) {
            this.setPixelRaw(col, row, r, g, b, a);
          }
        }
      }
    }
  }

  private strokeCharBitmap(
    bitmap: number[], ox: number, oy: number, scale: number,
    r: number, g: number, b: number, a: number,
  ): void {
    for (let row = 0; row < FONT_H; row++) {
      const bmpRow = bitmap[row];
      if (bmpRow === undefined) continue;
      for (let col = 0; col < FONT_W; col++) {
        const bit = 7 - col;
        if (!(bmpRow & (1 << bit))) continue;

        const isEdge =
          row === 0 || row === FONT_H - 1 ||
          col === 0 || col === FONT_W - 1 ||
          !(bmpRow & (1 << (7 - col + 1))) ||
          !(bmpRow & (1 << (7 - col - 1))) ||
          !(bitmap[row - 1] & (1 << bit)) ||
          !(bitmap[row + 1] & (1 << bit));

        if (isEdge) {
          const px = ox + col * scale;
          const py = oy + row * scale;
          this.fillRectRaw(px, py, scale, scale, r, g, b, a);
        }
      }
    }
  }

  private drawImage(
    src: { data: Uint8ClampedArray; width: number; height: number },
    dx: number, dy: number, dw: number, dh: number,
  ): void {
    if (!src || !src.data || dw <= 0 || dh <= 0 || src.width <= 0 || src.height <= 0) return;

    const alpha = this.state.globalAlpha;
    if (alpha <= 0) return;

    let x0 = Math.max(0, Math.round(dx));
    let y0 = Math.max(0, Math.round(dy));
    let x1 = Math.min(this.width, Math.round(dx + dw));
    let y1 = Math.min(this.height, Math.round(dy + dh));
    if (this.state.clipRect) {
      const cr = this.state.clipRect;
      x0 = Math.max(x0, cr.x | 0);
      y0 = Math.max(y0, cr.y | 0);
      x1 = Math.min(x1, (cr.x + cr.w) | 0);
      y1 = Math.min(y1, (cr.y + cr.h) | 0);
    }
    if (x0 >= x1 || y0 >= y1) return;

    // Draw from a copy resampled to the destination size (cached per image and size). Sampling the
    // source with nearest-neighbour aliased shrunk images into stripes and checkerboards (RC-14:
    // Wikipedia's wordmark, the IANA logo).
    const tw = Math.max(1, Math.round(dw));
    const th = Math.max(1, Math.round(dh));
    // ponytail: past 4 MP the resampled copy would cost too much memory; sample directly instead.
    const img = (src.width === tw && src.height === th) || tw * th > 4_000_000 ? src : resampled(src, tw, th);
    const exact = img.width === tw && img.height === th;
    const ox = Math.round(dx);
    const oy = Math.round(dy);
    const scaleX = img.width / dw;
    const scaleY = img.height / dh;

    for (let py = y0; py < y1; py++) {
      const srcY = Math.min(img.height - 1, Math.max(0, exact ? py - oy : Math.floor((py - dy) * scaleY)));
      for (let px = x0; px < x1; px++) {
        const srcX = Math.min(img.width - 1, Math.max(0, exact ? px - ox : Math.floor((px - dx) * scaleX)));
        const srcIdx = (srcY * img.width + srcX) * 4;
        const r = img.data[srcIdx]!;
        const g = img.data[srcIdx + 1]!;
        const b = img.data[srcIdx + 2]!;
        const a = (img.data[srcIdx + 3]! / 255) * alpha;
        this.setPixelRaw(px, py, r, g, b, a);
      }
    }
  }
}

/**
 * How much of the pixel centred at (px, py) lies inside the rounded box: 1 inside, 0 outside,
 * anti-aliased across the curved corners (elliptical, as border-radius w/h allow).
 */
type Corner = { w: number; h: number };
type Radii = { tl: Corner; tr: Corner; br: Corner; bl: Corner };

/** Corner radii scaled down together when they would overlap (CSS Backgrounds §5.5). Once per fill. */
function scaledRadii(box: { w: number; h: number }, r: BorderRadius): Radii {
  const f = Math.min(1,
    box.w / Math.max(1e-6, r.topLeft.w + r.topRight.w), box.w / Math.max(1e-6, r.bottomLeft.w + r.bottomRight.w),
    box.h / Math.max(1e-6, r.topLeft.h + r.bottomLeft.h), box.h / Math.max(1e-6, r.topRight.h + r.bottomRight.h));
  const s = (c: Corner): Corner => ({ w: c.w * f, h: c.h * f });
  return { tl: s(r.topLeft), tr: s(r.topRight), br: s(r.bottomRight), bl: s(r.bottomLeft) };
}

/** Coverage of one corner ellipse centred at (cx, cy); 1 when the corner is square. */
function cornerCoverage(px: number, py: number, rw: number, rh: number, cx: number, cy: number): number {
  if (rw <= 0 || rh <= 0) return 1;
  const dx = (px - cx) / rw, dy = (py - cy) / rh;
  const d = Math.sqrt(dx * dx + dy * dy);
  const c = 0.5 - (d - 1) * Math.min(rw, rh);
  return c <= 0 ? 0 : c >= 1 ? 1 : c;
}

/**
 * How much of the pixel centred at (px, py) lies inside the rounded box: 1 inside, 0 outside,
 * anti-aliased across the curved corners (elliptical, as border-radius w/h allow).
 */
function roundedCoverage(px: number, py: number, box: { x: number; y: number; w: number; h: number }, r: Radii, slack = 0.5): number {
  // Half a pixel of slack: a 1px border at a fractional x (160.9) has its pixel centre (160.5)
  // just outside the box, which erased whole border sides on the phone.
  if (px < box.x - slack || py < box.y - slack || px > box.x + box.w + slack || py > box.y + box.h + slack) return 0;
  const l = box.x, t = box.y, rgt = box.x + box.w, btm = box.y + box.h;
  if (px < l + r.tl.w && py < t + r.tl.h) return cornerCoverage(px, py, r.tl.w, r.tl.h, l + r.tl.w, t + r.tl.h);
  if (px > rgt - r.tr.w && py < t + r.tr.h) return cornerCoverage(px, py, r.tr.w, r.tr.h, rgt - r.tr.w, t + r.tr.h);
  if (px > rgt - r.br.w && py > btm - r.br.h) return cornerCoverage(px, py, r.br.w, r.br.h, rgt - r.br.w, btm - r.br.h);
  if (px < l + r.bl.w && py > btm - r.bl.h) return cornerCoverage(px, py, r.bl.w, r.bl.h, l + r.bl.w, btm - r.bl.h);
  return 1;
}

type Pixels = { data: Uint8ClampedArray; width: number; height: number };
const resampleCache = new WeakMap<Uint8ClampedArray, Pixels>();

/**
 * `src` resampled to tw×th: an area average (box filter) when shrinking, bilinear when enlarging,
 * both on premultiplied alpha so transparent edges don't darken. Cached per source, last size.
 */
function resampled(src: Pixels, tw: number, th: number): Pixels {
  const cached = resampleCache.get(src.data);
  if (cached && cached.width === tw && cached.height === th) return cached;
  const out = new Uint8ClampedArray(tw * th * 4);
  const sw = src.width, sh = src.height, sd = src.data;
  const sx = sw / tw, sy = sh / th;
  const shrink = sx > 1 || sy > 1;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      if (shrink) {
        const xs = Math.floor(x * sx), xe = Math.min(sw, Math.max(xs + 1, Math.ceil((x + 1) * sx)));
        const ys = Math.floor(y * sy), ye = Math.min(sh, Math.max(ys + 1, Math.ceil((y + 1) * sy)));
        for (let yy = ys; yy < ye; yy++) {
          for (let xx = xs; xx < xe; xx++) {
            const i = (yy * sw + xx) * 4;
            const pa = sd[i + 3]!;
            r += sd[i]! * pa; g += sd[i + 1]! * pa; b += sd[i + 2]! * pa; a += pa; n++;
          }
        }
      } else {
        const fx = Math.max(0, (x + 0.5) * sx - 0.5), fy = Math.max(0, (y + 0.5) * sy - 0.5);
        const x0 = Math.min(sw - 1, Math.floor(fx)), y0 = Math.min(sh - 1, Math.floor(fy));
        const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
        const wx = fx - x0, wy = fy - y0;
        for (const [xx, yy, w] of [[x0, y0, (1 - wx) * (1 - wy)], [x1, y0, wx * (1 - wy)], [x0, y1, (1 - wx) * wy], [x1, y1, wx * wy]] as const) {
          const i = (yy * sw + xx) * 4;
          const pa = sd[i + 3]! * w;
          r += sd[i]! * pa; g += sd[i + 1]! * pa; b += sd[i + 2]! * pa; a += pa; n += w;
        }
      }
      const o = (y * tw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = n > 0 ? a / n : 0;
    }
  }
  const result = { data: out, width: tw, height: th };
  resampleCache.set(src.data, result);
  return result;
}

// ?????? Adapter functions for new rendering modules ??????????????????????????????????????????????????????????????????????????????

/**
 * An outer box-shadow, drawn straight into the page pixels: an alpha mask of the (spread) box,
 * blurred with three separable running-sum box blurs (≈ the Gaussian CSS specifies, σ = blur/2),
 * composited outside the element's own border box (outer shadows never show under the element).
 * It used to copy the whole page buffer twice per shadow, blur with an O(w·h·r²) kernel (a 20px
 * shadow on a big card took seconds; httpforever.com's first frame took 33 s on the phone) and
 * paint over the element itself, greying every card.
 */
function applyBoxShadowToPixels(
  pixels: Uint8ClampedArray, pw: number, ph: number,
  shadow: BoxShadow, x: number, y: number, w: number, h: number,
): void {
  if (w <= 0 || h <= 0 || shadow.color.a <= 0) return;
  const sigma = Math.max(0, shadow.blur) / 2;
  const r = Math.round(sigma); // each of the three box passes
  const pad = 3 * r + 1;
  const ox = Math.round(x + shadow.offsetX - shadow.spread) - pad;
  const oy = Math.round(y + shadow.offsetY - shadow.spread) - pad;
  const sw = Math.max(1, Math.round(w + shadow.spread * 2));
  const sh = Math.max(1, Math.round(h + shadow.spread * 2));
  const mw = sw + pad * 2, mh = sh + pad * 2;
  const mask = new Float32Array(mw * mh);
  for (let yy = pad; yy < pad + sh; yy++) mask.fill(1, yy * mw + pad, yy * mw + pad + sw);
  if (r > 0) {
    const tmp = new Float32Array(Math.max(mw, mh));
    const pass = (len: number, lines: number, at: (line: number, i: number) => number) => {
      for (let line = 0; line < lines; line++) {
        for (let i = 0; i < len; i++) tmp[i] = mask[at(line, i)]!;
        let sum = 0;
        for (let i = -r; i <= r; i++) if (i >= 0 && i < len) sum += tmp[i]!;
        for (let i = 0; i < len; i++) {
          mask[at(line, i)] = sum / (2 * r + 1);
          const add = i + r + 1, drop = i - r;
          if (add < len) sum += tmp[add]!;
          if (drop >= 0) sum -= tmp[drop]!;
        }
      }
    };
    for (let k = 0; k < 3; k++) {
      pass(mw, mh, (line, i) => line * mw + i);
      pass(mh, mw, (line, i) => i * mw + line);
    }
  }
  const { r: cr, g: cg, b: cb, a: ca } = shadow.color;
  const bx0 = x, by0 = y, bx1 = x + w, by1 = y + h;
  for (let my = 0; my < mh; my++) {
    const py = oy + my;
    if (py < 0 || py >= ph) continue;
    for (let mx = 0; mx < mw; mx++) {
      const px = ox + mx;
      if (px < 0 || px >= pw) continue;
      if (px + 0.5 > bx0 && px + 0.5 < bx1 && py + 0.5 > by0 && py + 0.5 < by1) continue; // under the element
      const alpha = mask[my * mw + mx]! * ca;
      if (alpha <= 0.002) continue;
      const di = (py * pw + px) * 4;
      pixels[di] = pixels[di]! * (1 - alpha) + cr * alpha;
      pixels[di + 1] = pixels[di + 1]! * (1 - alpha) + cg * alpha;
      pixels[di + 2] = pixels[di + 2]! * (1 - alpha) + cb * alpha;
      pixels[di + 3] = Math.max(pixels[di + 3]!, alpha * 255);
    }
  }
}

function applyTextShadowToPixels(
  pixels: Uint8ClampedArray, pw: number, ph: number,
  shadow: TextShadow, text: string, x: number, y: number, color: string, fontStr: string,
): void {
  const buffer = new ImageData(new Uint8ClampedArray(pixels), pw, ph);
  const fsize = parseInt(fontStr.match(/(\d+)/)?.[1] ?? '16', 10);
  const scale = fsize / FONT_H;
  const charW = FONT_W * scale;
  const baseY = Math.round(y - fsize * 0.8);
  const c = parseColor(color);
  const startX = x;
  for (let i = 0; i < text.length; i++) {
    const bitmap = getCharBitmap(text.charCodeAt(i));
    if (bitmap) {
      const chX = Math.round(startX + i * charW);
      const sx = chX + shadow.offsetX;
      const sy = baseY + shadow.offsetY;
      drawCharBitmapOnBuffer(buffer, bitmap, sx, sy, scale, shadow.color.r, shadow.color.g, shadow.color.b, shadow.color.a);
    }
  }
  for (let i = 0; i < pixels.length; i++) pixels[i] = buffer.data[i];
}

function drawCharBitmapOnBuffer(
  buffer: ImageData, bitmap: number[], ox: number, oy: number, scale: number,
  r: number, g: number, b: number, a: number,
): void {
  const w = buffer.width, h = buffer.height;
  const data = buffer.data;
  const sx = Math.max(0, ox);
  const sy = Math.max(0, oy);
  const ex = Math.min(w, ox + FONT_W * scale);
  const ey = Math.min(h, oy + FONT_H * scale);
  for (let row = sy; row < ey; row++) {
    const bmpRowIdx = scale === 1 ? (row - oy) : ((row - oy) / scale | 0);
    if (bmpRowIdx < 0 || bmpRowIdx >= FONT_H) continue;
    const bmpRow = bitmap[bmpRowIdx];
    if (!bmpRow) continue;
    for (let col = sx; col < ex; col++) {
      const bmpColIdx = scale === 1 ? (col - ox) : ((col - ox) / scale | 0);
      if (bmpColIdx < 0 || bmpColIdx >= FONT_W) continue;
      if (bmpRow & (1 << (7 - bmpColIdx))) {
        const idx = (col + row * w) * 4;
        const alpha = a;
        const invA = 1 - alpha;
        data[idx] = data[idx] * invA + r * alpha;
        data[idx + 1] = data[idx + 1] * invA + g * alpha;
        data[idx + 2] = data[idx + 2] * invA + b * alpha;
        data[idx + 3] = Math.max(data[idx + 3], alpha * 255);
      }
    }
  }
}

function renderBoxShadowOnImageData(
  buffer: ImageData, shadow: BoxShadow, x: number, y: number, w: number, h: number,
): void {
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

  const blurCanvas = new ImageData(new Uint8ClampedArray(shadowCanvas.data), sw, sh);
  const blurred = applyBoxBlurRaw(blurCanvas, shadow.blur);

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

function applyBoxBlurRaw(buffer: ImageData, radius: number): ImageData {
  if (radius < 1) return buffer;
  const w = buffer.width;
  const h = buffer.height;
  const src = buffer.data;
  const result = new ImageData(new Uint8ClampedArray(src), w, h);
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

/**
 * A CSS `filter` on one element: applied to that element's rectangle only. It was applied to the
 * whole page buffer, so a logo's `filter: drop-shadow(…)` shadowed and greyed the entire page and
 * took 7 s per frame (httpforever.com).
 * ponytail: drop-shadow is skipped (it needs the element's own pixels as a separate layer;
 * drawn over the rectangle it would cast a box-shaped shadow).
 */
function applyFiltersToBuffer(
  pixels: Uint8ClampedArray, pw: number, ph: number,
  filters: FilterList, fx: number, fy: number, fw: number, fh: number,
): void {
  const list = filters.filter((f) => (f as { name?: string }).name !== 'drop-shadow') as FilterList;
  if (list.length === 0) return;
  const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
  const x1 = Math.min(pw, Math.ceil(fx + fw)), y1 = Math.min(ph, Math.ceil(fy + fh));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return;
  const region = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) region.set(pixels.subarray(((y0 + y) * pw + x0) * 4, ((y0 + y) * pw + x1) * 4), y * rw * 4);
  const filtered = applyFilters(new ImageData(region, rw, rh), list).data;
  for (let y = 0; y < rh; y++) pixels.set(filtered.subarray(y * rw * 4, (y + 1) * rw * 4), ((y0 + y) * pw + x0) * 4);
}

function applyClipShapeToPixels(
  pixels: Uint8ClampedArray, pw: number, ph: number,
  shape: ClipShape, cx: number, cy: number, cw: number, ch: number,
): void {
  if (shape.type === 'none') return;
  const buffer = new ImageData(new Uint8ClampedArray(pixels), pw, ph);
  applyClipBuffer(buffer, shape, cw, ch);
  for (let i = 0; i < pixels.length; i++) pixels[i] = buffer.data[i];
}

function applyMaskToPixels(
  pixels: Uint8ClampedArray, pw: number, ph: number,
  maskInfo: MaskInfo[], mx: number, my: number, mw: number, mh: number,
): void {
  if (maskInfo.length === 0) return;
  // Simple alpha mask: zero out pixels outside the element's content box
  // Full mask-image support (URL images, luminance masks) requires image loading
  // For now, the mask clips to the element bounds with a simple alpha cutoff
  if (mw <= 0 || mh <= 0) return;
  const x0 = Math.max(0, mx | 0);
  const y0 = Math.max(0, my | 0);
  const x1 = Math.min(pw, (mx + mw) | 0);
  const y1 = Math.min(ph, (my + mh) | 0);
  // Zero out any pixels in the element's area that have low alpha (simulate luminance mask)
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const idx = (py * pw + px) * 4;
      if (pixels[idx + 3] < 10) {
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }
}
