export interface DOMMatrix2D {
  a: number; b: number;
  c: number; d: number;
  e: number; f: number;
}

export interface DOMMatrix4x4 {
  m11: number; m12: number; m13: number; m14: number;
  m21: number; m22: number; m23: number; m24: number;
  m31: number; m32: number; m33: number; m34: number;
  m41: number; m42: number; m43: number; m44: number;
}

export function identity2D(): DOMMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

export function identity4x4(): DOMMatrix4x4 {
  return { m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1 };
}

export function isIdentity2D(m: DOMMatrix2D): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
}

export function isIdentity4x4(m: DOMMatrix4x4): boolean {
  return m.m11 === 1 && m.m12 === 0 && m.m13 === 0 && m.m14 === 0 &&
    m.m21 === 0 && m.m22 === 1 && m.m23 === 0 && m.m24 === 0 &&
    m.m31 === 0 && m.m32 === 0 && m.m33 === 1 && m.m34 === 0 &&
    m.m41 === 0 && m.m42 === 0 && m.m43 === 0 && m.m44 === 1;
}

export function multiply2D(a: DOMMatrix2D, b: DOMMatrix2D): DOMMatrix2D {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}

export function multiply4x4(a: DOMMatrix4x4, b: DOMMatrix4x4): DOMMatrix4x4 {
  return {
    m11: a.m11 * b.m11 + a.m12 * b.m21 + a.m13 * b.m31 + a.m14 * b.m41,
    m12: a.m11 * b.m12 + a.m12 * b.m22 + a.m13 * b.m32 + a.m14 * b.m42,
    m13: a.m11 * b.m13 + a.m12 * b.m23 + a.m13 * b.m33 + a.m14 * b.m43,
    m14: a.m11 * b.m14 + a.m12 * b.m24 + a.m13 * b.m34 + a.m14 * b.m44,
    m21: a.m21 * b.m11 + a.m22 * b.m21 + a.m23 * b.m31 + a.m24 * b.m41,
    m22: a.m21 * b.m12 + a.m22 * b.m22 + a.m23 * b.m32 + a.m24 * b.m42,
    m23: a.m21 * b.m13 + a.m22 * b.m23 + a.m23 * b.m33 + a.m24 * b.m43,
    m24: a.m21 * b.m14 + a.m22 * b.m24 + a.m23 * b.m34 + a.m24 * b.m44,
    m31: a.m31 * b.m11 + a.m32 * b.m21 + a.m33 * b.m31 + a.m34 * b.m41,
    m32: a.m31 * b.m12 + a.m32 * b.m22 + a.m33 * b.m32 + a.m34 * b.m42,
    m33: a.m31 * b.m13 + a.m32 * b.m23 + a.m33 * b.m33 + a.m34 * b.m43,
    m34: a.m31 * b.m14 + a.m32 * b.m24 + a.m33 * b.m34 + a.m34 * b.m44,
    m41: a.m41 * b.m11 + a.m42 * b.m21 + a.m43 * b.m31 + a.m44 * b.m41,
    m42: a.m41 * b.m12 + a.m42 * b.m22 + a.m43 * b.m32 + a.m44 * b.m42,
    m43: a.m41 * b.m13 + a.m42 * b.m23 + a.m43 * b.m33 + a.m44 * b.m43,
    m44: a.m41 * b.m14 + a.m42 * b.m24 + a.m43 * b.m34 + a.m44 * b.m44,
  };
}

export function to4x4(m: DOMMatrix2D): DOMMatrix4x4 {
  return { m11: m.a, m12: m.b, m13: 0, m14: 0, m21: m.c, m22: m.d, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m41: m.e, m42: m.f, m43: 0, m44: 1 };
}

function to2D(m: DOMMatrix4x4): DOMMatrix2D {
  return { a: m.m11, b: m.m12, c: m.m21, d: m.m22, e: m.m41, f: m.m42 };
}

function degToRad(deg: number): number { return deg * Math.PI / 180; }
function gradToRad(grad: number): number { return grad * Math.PI / 200; }
function turnToRad(turn: number): number { return turn * 2 * Math.PI; }

function parseAngle(value: string): number {
  const num = parseFloat(value);
  if (value.includes('rad')) return num;
  if (value.includes('grad')) return gradToRad(num);
  if (value.includes('turn')) return turnToRad(num);
  if (value.includes('deg') || /^-?\d+(\.\d+)?$/.test(value)) return degToRad(num);
  return num;
}

function parseLength(value: string): number {
  return parseFloat(value);
}

function parseNumberList(str: string): number[] {
  return str.split(/[\s,]+/).filter(s => s.length > 0).map(parseFloat);
}

function translate2D(tx: number, ty: number): DOMMatrix2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function scale2D(sx: number, sy: number): DOMMatrix2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function rotate2D(angle: number): DOMMatrix2D {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
}

function skew2D(ax: number, ay: number): DOMMatrix2D {
  return { a: 1, b: Math.tan(ay), c: Math.tan(ax), d: 1, e: 0, f: 0 };
}

function matrix2D(a: number, b: number, c: number, d: number, e: number, f: number): DOMMatrix2D {
  return { a, b, c, d, e, f };
}

export function translate3D(tx: number, ty: number, tz: number): DOMMatrix4x4 {
  return { m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m41: tx, m42: ty, m43: tz, m44: 1 };
}

function scale3D(sx: number, sy: number, sz: number): DOMMatrix4x4 {
  return { m11: sx, m12: 0, m13: 0, m14: 0, m21: 0, m22: sy, m23: 0, m24: 0, m31: 0, m32: 0, m33: sz, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1 };
}

function rotateX3D(angle: number): DOMMatrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: c, m23: s, m24: 0, m31: 0, m32: -s, m33: c, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1 };
}

function rotateY3D(angle: number): DOMMatrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { m11: c, m12: 0, m13: -s, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0, m31: s, m32: 0, m33: c, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1 };
}

function rotateZ3D(angle: number): DOMMatrix4x4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { m11: c, m12: s, m13: 0, m14: 0, m21: -s, m22: c, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: 0, m41: 0, m42: 0, m43: 0, m44: 1 };
}

function rotate3D(x: number, y: number, z: number, angle: number): DOMMatrix4x4 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) return identity4x4();
  const nx = x / len, ny = y / len, nz = z / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return {
    m11: t * nx * nx + c, m12: t * nx * ny + s * nz, m13: t * nx * nz - s * ny, m14: 0,
    m21: t * nx * ny - s * nz, m22: t * ny * ny + c, m23: t * ny * nz + s * nx, m24: 0,
    m31: t * nx * nz + s * ny, m32: t * ny * nz - s * nx, m33: t * nz * nz + c, m34: 0,
    m41: 0, m42: 0, m43: 0, m44: 1,
  };
}

function perspective3D(d: number): DOMMatrix4x4 {
  if (d === 0) return identity4x4();
  return { m11: 1, m12: 0, m13: 0, m14: 0, m21: 0, m22: 1, m23: 0, m24: 0, m31: 0, m32: 0, m33: 1, m34: -1 / d, m41: 0, m42: 0, m43: 0, m44: 1 };
}

function matrix3D(vals: number[]): DOMMatrix4x4 {
  if (vals.length < 16) return identity4x4();
  return { m11: vals[0]!, m12: vals[1]!, m13: vals[2]!, m14: vals[3]!, m21: vals[4]!, m22: vals[5]!, m23: vals[6]!, m24: vals[7]!, m31: vals[8]!, m32: vals[9]!, m33: vals[10]!, m34: vals[11]!, m41: vals[12]!, m42: vals[13]!, m43: vals[14]!, m44: vals[15]! };
}

type ParsedTransform = { is3D: boolean; matrix: DOMMatrix4x4 } | null;

const TRANSFORM_FN_RE = /(\w+)\s*\(([^)]*)\)/g;

function matchTransformFn(name: string, argsStr: string): DOMMatrix4x4 | null {
  const args = parseNumberList(argsStr);
  const n = args.length;

  switch (name) {
    case 'matrix': {
      if (n < 6) return null;
      const m = matrix2D(args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!);
      return to4x4(m);
    }
    case 'matrix3d': {
      if (n < 16) return null;
      return matrix3D(args);
    }
    case 'perspective': {
      if (n < 1) return null;
      return perspective3D(args[0]!);
    }
    case 'rotate': {
      if (n < 1) return null;
      const angle = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(rotate2D(angle));
    }
    case 'rotatex':
    case 'rotateX': {
      if (n < 1) return null;
      const ax = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return rotateX3D(ax);
    }
    case 'rotatey':
    case 'rotateY': {
      if (n < 1) return null;
      const ay = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return rotateY3D(ay);
    }
    case 'rotatez':
    case 'rotateZ': {
      if (n < 1) return null;
      const az = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(rotate2D(az));
    }
    case 'rotate3d': {
      if (n < 4) return null;
      const ang = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[3] ?? '0');
      return rotate3D(args[0]!, args[1]!, args[2]!, ang);
    }
    case 'scale': {
      if (n < 1) return null;
      const sx = args[0]!;
      const sy = n >= 2 ? args[1]! : sx;
      return to4x4(scale2D(sx, sy));
    }
    case 'scalex':
    case 'scaleX': {
      if (n < 1) return null;
      return to4x4(scale2D(args[0]!, 1));
    }
    case 'scaley':
    case 'scaleY': {
      if (n < 1) return null;
      return to4x4(scale2D(1, args[0]!));
    }
    case 'scalez':
    case 'scaleZ': {
      if (n < 1) return null;
      return scale3D(1, 1, args[0]!);
    }
    case 'scale3d': {
      if (n < 3) return null;
      return scale3D(args[0]!, args[1]!, args[2]!);
    }
    case 'skew': {
      if (n < 1) return null;
      const parts = argsStr.split(/[\s,]+/).filter(s => s.length > 0);
      const sax = parseAngle(parts[0] ?? '0');
      const say = parts[1] ? parseAngle(parts[1]) : 0;
      return to4x4(skew2D(sax, say));
    }
    case 'skewx':
    case 'skewX': {
      if (n < 1) return null;
      const sxAngle = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(skew2D(sxAngle, 0));
    }
    case 'skewy':
    case 'skewY': {
      if (n < 1) return null;
      const syAngle = parseAngle(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(skew2D(0, syAngle));
    }
    case 'translate': {
      if (n < 1) return null;
      const tx = parseFloat(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      const ty = n >= 2 ? args[1]! : 0;
      return to4x4(translate2D(tx, ty));
    }
    case 'translatex':
    case 'translateX': {
      if (n < 1) return null;
      const txVal = parseFloat(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(translate2D(txVal, 0));
    }
    case 'translatey':
    case 'translateY': {
      if (n < 1) return null;
      const tyVal = parseFloat(argsStr.split(/[\s,]+/).filter(s => s.length > 0)[0] ?? '0');
      return to4x4(translate2D(0, tyVal));
    }
    case 'translatez':
    case 'translateZ': {
      if (n < 1) return null;
      return translate3D(0, 0, args[0]!);
    }
    case 'translate3d': {
      if (n < 3) return null;
      return translate3D(args[0]!, args[1]!, args[2]!);
    }
    default:
      return null;
  }
}

export function parseTransform(transformStr: string | null | undefined): ParsedTransform {
  if (!transformStr || transformStr === 'none' || transformStr.trim() === '') {
    return null;
  }

  let found = false;
  let is3D = false;
  let result: DOMMatrix4x4 = identity4x4();
  let match: RegExpExecArray | null;

  TRANSFORM_FN_RE.lastIndex = 0;

  while ((match = TRANSFORM_FN_RE.exec(transformStr)) !== null) {
    found = true;
    const name = match[1]!.toLowerCase();
    const argsStr = match[2]!.trim();
    const m = matchTransformFn(name, argsStr);
    if (!m) return null;

    if ((name === 'matrix3d' || name === 'perspective' || name.startsWith('rotate3') || name === 'rotate3d' || name === 'scale3d' || name === 'translate3d' ||
      name === 'rotatex' || name === 'rotatey' || name === 'scalez' || name === 'translatez') &&
      name !== 'rotate' && name !== 'scale' && name !== 'skew' && name !== 'translate') {
      is3D = true;
    }

    result = multiply4x4(m, result);
  }

  if (!found) {
    return null;
  }

  return { is3D, matrix: result };
}

/** True when the matrix is a pure translation (no rotation/scale/skew/perspective). */
export function isPureTranslation4x4(m: DOMMatrix4x4): boolean {
  return Math.abs(m.m11 - 1) < 1e-6 && Math.abs(m.m22 - 1) < 1e-6 && Math.abs(m.m33 - 1) < 1e-6 &&
    Math.abs(m.m44 - 1) < 1e-6 &&
    Math.abs(m.m12) < 1e-6 && Math.abs(m.m13) < 1e-6 && Math.abs(m.m14) < 1e-6 &&
    Math.abs(m.m21) < 1e-6 && Math.abs(m.m23) < 1e-6 && Math.abs(m.m24) < 1e-6 &&
    Math.abs(m.m31) < 1e-6 && Math.abs(m.m32) < 1e-6 && Math.abs(m.m34) < 1e-6 &&
    Math.abs(m.m43) < 1e-6;
}

/** Extract the (x, y) translation component of a 4x4 matrix. */
export function translationOf4x4(m: DOMMatrix4x4): { x: number; y: number } {
  return { x: m.m41, y: m.m42 };
}

export function applyTransform2D(point: { x: number; y: number }, m: DOMMatrix2D): { x: number; y: number } {
  return {
    x: m.a * point.x + m.c * point.y + m.e,
    y: m.b * point.x + m.d * point.y + m.f,
  };
}

export function applyTransform(point: { x: number; y: number; z?: number }, m: DOMMatrix4x4): { x: number; y: number; z: number } {
  const zVal = point.z ?? 0;
  const w = 1 / (m.m14 * point.x + m.m24 * point.y + m.m34 * zVal + m.m44);
  return {
    x: (m.m11 * point.x + m.m21 * point.y + m.m31 * zVal + m.m41) * w,
    y: (m.m12 * point.x + m.m22 * point.y + m.m32 * zVal + m.m42) * w,
    z: (m.m13 * point.x + m.m23 * point.y + m.m33 * zVal + m.m43) * w,
  };
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpColor(a: string, b: string, t: number): string {
  const parseColor = (c: string): [number, number, number, number] => {
    const hex6 = c.match(/^#([0-9a-f]{6})$/i);
    if (hex6) {
      const n = parseInt(hex6[1]!, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    }
    const hex3 = c.match(/^#([0-9a-f]{3})$/i);
    if (hex3) {
      return [
        parseInt(hex3[1]![0]! + hex3[1]![0]!, 16),
        parseInt(hex3[1]![1]! + hex3[1]![1]!, 16),
        parseInt(hex3[1]![2]! + hex3[1]![2]!, 16),
        255,
      ];
    }
    return [0, 0, 0, 255];
  };

  const ca = parseColor(a);
  const cb = parseColor(b);
  const r = Math.round(lerpNumber(ca[0], cb[0], t));
  const g = Math.round(lerpNumber(ca[1], cb[1], t));
  const b2 = Math.round(lerpNumber(ca[2], cb[2], t));
  const alpha = lerpNumber(ca[3], cb[3], t) / 255;
  return `rgba(${r},${g},${b2},${alpha})`;
}

export function lerpMatrices(a: DOMMatrix4x4, b: DOMMatrix4x4, t: number): DOMMatrix4x4 {
  const result: DOMMatrix4x4 = identity4x4();
  const keys: (keyof DOMMatrix4x4)[] = ['m11', 'm12', 'm13', 'm14', 'm21', 'm22', 'm23', 'm24', 'm31', 'm32', 'm33', 'm34', 'm41', 'm42', 'm43', 'm44'];
  for (const k of keys) {
    result[k] = lerpNumber(a[k], b[k], t);
  }
  return result;
}

export function decomposeMatrix(m: DOMMatrix4x4): { translate: [number, number, number]; scale: [number, number, number]; skew: [number, number]; rotate: [number, number, number]; perspective: [number, number, number, number] } {
  const m33 = m.m33;
  const perspective = m.m14 !== 0 || m.m24 !== 0 || m.m34 !== 0 || m.m44 !== 1
    ? [m.m14, m.m24, m.m34, m.m44] as [number, number, number, number]
    : [0, 0, 0, 1] as [number, number, number, number];

  const translate: [number, number, number] = [m.m41, m.m42, m.m43];

  const row: [number, number, number][] = [
    [m.m11, m.m12, m.m13],
    [m.m21, m.m22, m.m23],
    [m.m31, m.m32, m.m33],
  ];

  const scale: [number, number, number] = [0, 0, 0];
  const skew: [number, number] = [0, 0];

  for (let i = 0; i < 3; i++) {
    scale[i] = Math.sqrt(row[i][0] * row[i][0] + row[i][1] * row[i][1] + row[i][2] * row[i][2]);
    if (scale[i] !== 0) {
      row[i][0] /= scale[i];
      row[i][1] /= scale[i];
      row[i][2] /= scale[i];
    }
  }

  skew[0] = row[0][1] !== 0 ? Math.asin(-row[0][1]) : 0;

  const rotate: [number, number, number] = [
    Math.atan2(row[2][1], row[2][2]),
    Math.atan2(-row[2][0], Math.sqrt(row[2][1] * row[2][1] + row[2][2] * row[2][2])),
    Math.atan2(row[1][0], row[0][0]),
  ];

  return { translate, scale, skew, rotate, perspective };
}
