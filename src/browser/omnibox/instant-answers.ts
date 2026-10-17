import type { OmniboxProvider, OmniboxResult } from './omnibox';

type InstantAnswerKind = 'math' | 'unit' | 'color';

interface InstantAnswer {
  readonly kind: InstantAnswerKind;
  /** Short value shown as the row title and copied on selection. */
  readonly value: string;
  /** Longer one-line explanation shown under the value. */
  readonly detail: string;
  /** CSS color for a swatch (color answers only). */
  readonly swatch?: string;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** 12 significant digits hides float noise (0.1 + 0.2 → 0.3) without rounding real precision. */
function formatNumber(n: number): string {
  const rounded = Number(n.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

// ── Math: recursive-descent evaluator (never uses eval / Function) ──────────

const MAX_INPUT_LENGTH = 200;
const MAX_NESTING = 40;

const FUNCTIONS = new Map<string, (x: number) => number>([
  ['sqrt', Math.sqrt], ['sin', Math.sin], ['cos', Math.cos], ['tan', Math.tan],
  ['abs', Math.abs], ['ln', Math.log], ['log', Math.log10],
  ['floor', Math.floor], ['ceil', Math.ceil], ['round', Math.round],
]);
const CONSTANTS = new Map<string, number>([['pi', Math.PI], ['e', Math.E]]);

type Token =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'id'; readonly name: string }
  | { readonly kind: 'op'; readonly op: string };

class ParseError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ') { i++; continue; }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ParseError('bad number');
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
    } else if (ch >= 'a' && ch <= 'z') {
      const m = /^[a-z]+/.exec(src.slice(i))!;
      tokens.push({ kind: 'id', name: m[0] });
      i += m[0].length;
    } else if ('+-*/^%()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
    } else {
      throw new ParseError(`unexpected ${ch}`);
    }
  }
  return tokens;
}

function parseMath(input: string): { value: number; trivial: boolean } {
  const src = input.toLowerCase()
    .replace(/\*\*/g, '^').replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  const tokens = tokenize(src);
  if (tokens.length === 0) throw new ParseError('empty');

  let pos = 0;
  let depth = 0;
  const isOp = (op: string): boolean => {
    const t = tokens[pos];
    return t !== undefined && t.kind === 'op' && t.op === op;
  };
  const expect = (op: string): void => {
    if (!isOp(op)) throw new ParseError(`expected ${op}`);
    pos++;
  };
  const nested = (): number => {
    if (++depth > MAX_NESTING) throw new ParseError('too deep');
    const v = parseExpr();
    depth--;
    return v;
  };

  const parsePrimary = (): number => {
    const t = tokens[pos];
    if (t === undefined) throw new ParseError('unexpected end');
    if (t.kind === 'num') { pos++; return t.value; }
    if (t.kind === 'id') {
      pos++;
      const fn = FUNCTIONS.get(t.name);
      if (fn) { expect('('); const arg = nested(); expect(')'); return fn(arg); }
      const c = CONSTANTS.get(t.name);
      if (c !== undefined) return c;
      throw new ParseError(`unknown name ${t.name}`);
    }
    if (isOp('(')) { pos++; const v = nested(); expect(')'); return v; }
    throw new ParseError(`unexpected ${t.op}`);
  };
  const parsePower = (): number => {
    const base = parsePrimary();
    if (isOp('^')) { pos++; return Math.pow(base, parseUnary()); }
    return base;
  };
  const parseUnary = (): number => {
    if (isOp('-')) { pos++; return -parseUnary(); }
    if (isOp('+')) { pos++; return parseUnary(); }
    return parsePower();
  };
  const parseTerm = (): number => {
    let v = parseUnary();
    for (;;) {
      if (isOp('*')) { pos++; v *= parseUnary(); }
      else if (isOp('/')) { pos++; v /= parseUnary(); }
      else if (isOp('%')) { pos++; v %= parseUnary(); }
      else return v;
    }
  };
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      if (isOp('+')) { pos++; v += parseTerm(); }
      else if (isOp('-')) { pos++; v -= parseTerm(); }
      else return v;
    }
  }

  const value = parseExpr();
  if (pos !== tokens.length) throw new ParseError('trailing input');
  // A lone number, a lone constant, or a signed number is not a "calculation".
  const trivial = tokens.length === 1 || (tokens.length === 2 && tokens[0]!.kind === 'op' && tokens[1]!.kind === 'num');
  return { value, trivial };
}

/** Evaluates an arithmetic expression; null when it is not a valid, finite, non-trivial calculation. */
function evaluateExpression(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_INPUT_LENGTH) return null;
  // Dates read as subtraction (2024-01-15 → 2008); never treat them as math.
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(trimmed)) return null;
  try {
    const { value, trivial } = parseMath(trimmed);
    return trivial || !Number.isFinite(value) ? null : value;
  } catch {
    return null;
  }
}

// ── Units ───────────────────────────────────────────────────────────────────

interface UnitInfo {
  readonly category: string;
  readonly label: string;
  /** Multiply by this to reach the category's base unit (unused for temperature). */
  readonly factor: number;
}

const UNITS = new Map<string, UnitInfo>();

function defineUnits(category: string, label: string, factor: number, aliases: readonly string[]): void {
  for (const alias of aliases) UNITS.set(alias, { category, label, factor });
}

// length (base: m)
defineUnits('length', 'm', 1, ['m', 'meter', 'meters', 'metre', 'metres']);
defineUnits('length', 'km', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
defineUnits('length', 'cm', 0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
defineUnits('length', 'mm', 0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
defineUnits('length', 'mi', 1609.344, ['mi', 'mile', 'miles']);
defineUnits('length', 'yd', 0.9144, ['yd', 'yard', 'yards']);
defineUnits('length', 'ft', 0.3048, ['ft', 'foot', 'feet']);
defineUnits('length', 'in', 0.0254, ['in', 'inch', 'inches']);
// mass (base: g)
defineUnits('mass', 'g', 1, ['g', 'gram', 'grams']);
defineUnits('mass', 'kg', 1000, ['kg', 'kilogram', 'kilograms']);
defineUnits('mass', 'mg', 0.001, ['mg', 'milligram', 'milligrams']);
defineUnits('mass', 'lb', 453.59237, ['lb', 'lbs', 'pound', 'pounds']);
defineUnits('mass', 'oz', 28.349523125, ['oz', 'ounce', 'ounces']);
// volume (base: ml, US customary)
defineUnits('volume', 'ml', 1, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
defineUnits('volume', 'l', 1000, ['l', 'liter', 'liters', 'litre', 'litres']);
defineUnits('volume', 'gal', 3785.411784, ['gal', 'gallon', 'gallons']);
defineUnits('volume', 'qt', 946.352946, ['qt', 'quart', 'quarts']);
defineUnits('volume', 'cup', 236.588237, ['cup', 'cups']);
defineUnits('volume', 'tbsp', 14.78676478, ['tbsp', 'tablespoon', 'tablespoons']);
defineUnits('volume', 'tsp', 4.92892159, ['tsp', 'teaspoon', 'teaspoons']);
// time (base: s)
defineUnits('time', 'ms', 0.001, ['ms', 'millisecond', 'milliseconds']);
defineUnits('time', 's', 1, ['s', 'sec', 'secs', 'second', 'seconds']);
defineUnits('time', 'min', 60, ['min', 'mins', 'minute', 'minutes']);
defineUnits('time', 'h', 3600, ['h', 'hr', 'hrs', 'hour', 'hours']);
defineUnits('time', 'd', 86400, ['d', 'day', 'days']);
defineUnits('time', 'wk', 604800, ['wk', 'wks', 'week', 'weeks']);
// data (base: byte; decimal SI and binary IEC prefixes)
defineUnits('data', 'bit', 0.125, ['bit', 'bits']);
defineUnits('data', 'B', 1, ['b', 'byte', 'bytes']);
defineUnits('data', 'KB', 1e3, ['kb', 'kilobyte', 'kilobytes']);
defineUnits('data', 'MB', 1e6, ['mb', 'megabyte', 'megabytes']);
defineUnits('data', 'GB', 1e9, ['gb', 'gigabyte', 'gigabytes']);
defineUnits('data', 'TB', 1e12, ['tb', 'terabyte', 'terabytes']);
defineUnits('data', 'KiB', 1024, ['kib']);
defineUnits('data', 'MiB', 1024 ** 2, ['mib']);
defineUnits('data', 'GiB', 1024 ** 3, ['gib']);
defineUnits('data', 'TiB', 1024 ** 4, ['tib']);
// speed (base: m/s)
defineUnits('speed', 'm/s', 1, ['m/s', 'mps']);
defineUnits('speed', 'km/h', 1 / 3.6, ['km/h', 'kmh', 'kph']);
defineUnits('speed', 'mph', 0.44704, ['mph']);
defineUnits('speed', 'kn', 1852 / 3600, ['kn', 'knot', 'knots']);
// temperature (affine — converted through kelvin, factor unused)
defineUnits('temperature', '°C', 1, ['c', '°c', 'celsius']);
defineUnits('temperature', '°F', 1, ['f', '°f', 'fahrenheit']);
defineUnits('temperature', 'K', 1, ['k', 'kelvin']);

function toKelvin(value: number, label: string): number {
  if (label === '°C') return value + 273.15;
  if (label === '°F') return (value - 32) * 5 / 9 + 273.15;
  return value;
}

function fromKelvin(kelvin: number, label: string): number {
  if (label === '°C') return kelvin - 273.15;
  if (label === '°F') return (kelvin - 273.15) * 9 / 5 + 32;
  return kelvin;
}

const UNIT_RE = /^(-?\d[\d,]*(?:\.\d+)?)\s*([a-z°/]+)\s+(?:to|in|into|as)\s+([a-z°/]+)$/;

function convertUnits(input: string): { value: number; from: string; to: string; result: number } | null {
  const m = UNIT_RE.exec(input.trim().toLowerCase());
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  const from = UNITS.get(m[2]!);
  const to = UNITS.get(m[3]!);
  if (!Number.isFinite(value) || !from || !to || from.category !== to.category) return null;

  const result = from.category === 'temperature'
    ? fromKelvin(toKelvin(value, from.label), to.label)
    : value * from.factor / to.factor;
  return Number.isFinite(result) ? { value, from: from.label, to: to.label, result } : null;
}

// ── Color ───────────────────────────────────────────────────────────────────

interface Rgb { readonly r: number; readonly g: number; readonly b: number }

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number): number => (n + hue / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number): number => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: Math.round(((h * 60) + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function parseColor(input: string): Rgb | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex) {
    const h = hex[1]!.length === 3 ? hex[1]!.replace(/./g, (c) => c + c) : hex[1]!;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s);
  if (rgb) {
    const [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return r <= 255 && g <= 255 && b <= 255 ? { r, g, b } : null;
  }
  const hsl = /^hsl\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%\s*\)$/.exec(s);
  if (hsl) {
    const [h, sat, lig] = [Number(hsl[1]), Number(hsl[2]), Number(hsl[3])];
    return h <= 360 && sat <= 100 && lig <= 100 ? hslToRgb(h, sat, lig) : null;
  }
  return null;
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

// ── Detection ───────────────────────────────────────────────────────────────

/** Returns the instant answer for `input`, or null when the input is an ordinary query. */
function detectInstantAnswer(input: string): InstantAnswer | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const color = parseColor(trimmed);
  if (color) {
    const hex = `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
    const { h, s, l } = rgbToHsl(color);
    return {
      kind: 'color',
      value: hex,
      detail: `rgb(${color.r}, ${color.g}, ${color.b}) · hsl(${h}, ${s}%, ${l}%)`,
      swatch: hex,
    };
  }

  const unit = convertUnits(trimmed);
  if (unit) {
    const result = formatNumber(unit.result);
    return {
      kind: 'unit',
      value: `${result} ${unit.to}`,
      detail: `${formatNumber(unit.value)} ${unit.from} = ${result} ${unit.to}`,
    };
  }

  const math = evaluateExpression(trimmed);
  if (math !== null) {
    const value = formatNumber(math);
    return { kind: 'math', value, detail: `${trimmed} = ${value}` };
  }
  return null;
}

const ANSWER_ICONS: Readonly<Record<InstantAnswerKind, string>> = { math: '🧮', unit: '📏', color: '🎨' };

class InstantAnswerProvider implements OmniboxProvider {
  readonly name = 'instant-answers';

  getSuggestions(input: string): OmniboxResult[] {
    const answer = detectInstantAnswer(input);
    if (!answer) return [];
    return [{
      type: 'answer',
      id: `answer:${answer.kind}`,
      text: answer.value,
      description: answer.detail,
      hint: 'Copy',
      icon: ANSWER_ICONS[answer.kind],
      score: 100,
      source: this.name,
      action: 'copy',
      ...(answer.swatch ? { meta: { swatch: answer.swatch } } : {}),
    }];
  }
}

export { detectInstantAnswer, evaluateExpression, convertUnits, parseColor, formatNumber, InstantAnswerProvider };
export type { InstantAnswer, InstantAnswerKind };
