import type { PaintCommand } from './paint-engine';

// ─────────────────────────────────────────────────────────────────────────────
// RGBA COLOR
// ─────────────────────────────────────────────────────────────────────────────

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 1 };

// ─────────────────────────────────────────────────────────────────────────────
// COLOR PARSER
// ─────────────────────────────────────────────────────────────────────────────

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
  'gray':        { r: 128, g: 128, b: 128, a: 1 },
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
  'orange':      { r: 255, g: 165, b: 0,   a: 1 },
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

  return BLACK;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// BITMAP FONT (8x8 ASCII 32–126)
// ─────────────────────────────────────────────────────────────────────────────

const FONT_W = 8;
const FONT_H = 8;

/**
 * 8×8 bitmap font data for printable ASCII (32–126).
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

// ─────────────────────────────────────────────────────────────────────────────
// RASTERIZER STATE
// ─────────────────────────────────────────────────────────────────────────────

interface RasterState {
  fillStyle: RGBA;
  strokeStyle: RGBA;
  lineWidth: number;
  font: string;
  fontSize: number;
  textAlign: string;
  globalAlpha: number;
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RASTERIZER
// ─────────────────────────────────────────────────────────────────────────────

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
    return new ImageData(this.pixels, this.width, this.height);
  }

  /** Returns the raw pixel buffer (RGBA, 4 bytes per pixel). */
  getPixels(): Uint8ClampedArray {
    return this.pixels;
  }

  // ── Main entry point ─────────────────────────────────────────────

  /** Execute all paint commands and return the composited ImageData. */
  rasterize(commands: readonly PaintCommand[]): ImageData {
    for (const cmd of commands) {
      this.exec(cmd);
    }
    return this.getImageData();
  }

  // ── Command dispatch ─────────────────────────────────────────────

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
      case 'beginPath':
      case 'closePath':
      case 'fill':
      case 'stroke':
      case 'clip':
        break;
    }
  }

  private setFont(fontStr: string): void {
    this.state.font = fontStr;
    const m = fontStr.match(/(\d+(?:\.\d+)?)\s*px/);
    if (m) this.state.fontSize = parseFloat(m[1]);
  }

  // ── Low-level pixel operations ───────────────────────────────────

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
    const x0 = Math.max(0, x | 0);
    const y0 = Math.max(0, y | 0);
    const x1 = Math.min(this.width, (x + w) | 0);
    const y1 = Math.min(this.height, (y + h) | 0);

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

  // ── Command handlers ─────────────────────────────────────────────

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

  private fillText(params: [string, number, number]): void {
    const [text, x, y] = params;
    const c = this.state.fillStyle;
    const a = c.a * this.state.globalAlpha;
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
        this.drawCharBitmap(bitmap, chX, baseY, scale, c.r, c.g, c.b, a);
      }
    }
  }

  private strokeText(params: [string, number, number]): void {
    const [text, x, y] = params;
    const c = this.state.strokeStyle;
    const a = c.a * this.state.globalAlpha;
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

  private drawCharBitmap(
    bitmap: number[], ox: number, oy: number, scale: number,
    r: number, g: number, b: number, a: number,
  ): void {
    const sx = Math.max(0, ox);
    const sy = Math.max(0, oy);
    const ex = Math.min(this.width, ox + FONT_W * scale);
    const ey = Math.min(this.height, oy + FONT_H * scale);

    if (scale === 1) {
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
          const bmpColIdx = (col - ox) / scale | 0;
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

  /**
   * Draw an ImageData source onto the canvas with scaling.
   * Uses nearest-neighbor sampling for simplicity.
   */
  private drawImage(
    src: { data: Uint8ClampedArray; width: number; height: number },
    dx: number, dy: number, dw: number, dh: number,
  ): void {
    if (!src || !src.data || dw <= 0 || dh <= 0 || src.width <= 0 || src.height <= 0) return;

    const alpha = this.state.globalAlpha;
    if (alpha <= 0) return;

    const x0 = Math.max(0, Math.round(dx));
    const y0 = Math.max(0, Math.round(dy));
    const x1 = Math.min(this.width, Math.round(dx + dw));
    const y1 = Math.min(this.height, Math.round(dy + dh));

    const scaleX = src.width / dw;
    const scaleY = src.height / dh;

    for (let py = y0; py < y1; py++) {
      const srcY = Math.min(src.height - 1, Math.max(0, Math.floor((py - dy) * scaleY)));
      for (let px = x0; px < x1; px++) {
        const srcX = Math.min(src.width - 1, Math.max(0, Math.floor((px - dx) * scaleX)));
        const srcIdx = (srcY * src.width + srcX) * 4;
        const r = src.data[srcIdx]!;
        const g = src.data[srcIdx + 1]!;
        const b = src.data[srcIdx + 2]!;
        const a = (src.data[srcIdx + 3]! / 255) * alpha;
        this.setPixelRaw(px, py, r, g, b, a);
      }
    }
  }
}
