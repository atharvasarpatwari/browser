import type { UsedStyle } from '../dom-tree';

/**
 * Convert a resolved computed style Map into a UsedStyle object.
 *
 * "Used style" is computed style with all values resolved to absolute
 * pixel numbers or canonical values, making layout-engine hot paths
 * simpler (no string parsing during layout).
 */
export function buildUsedStyle(computed: ReadonlyMap<string, string>, containerWidth: number, containerHeight: number, defaultFontSize: number): UsedStyle {
  const fontSize = resolveLength(computed.get('font-size') ?? '16px', defaultFontSize, containerWidth, containerHeight, defaultFontSize);
  const em = fontSize;
  const rem = defaultFontSize;
  const display = computed.get('display') ?? 'inline';
  const position = computed.get('position') ?? 'static';

  const boxSizing = computed.get('box-sizing') ?? 'content-box';
  const widthStr = computed.get('width') ?? 'auto';
  const heightStr = computed.get('height') ?? 'auto';

  const mt = resolveEdgeValue(computed.get('margin-top'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const mr = resolveEdgeValue(computed.get('margin-right'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const mb = resolveEdgeValue(computed.get('margin-bottom'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const ml = resolveEdgeValue(computed.get('margin-left'), em, rem, containerWidth, containerHeight, defaultFontSize);

  const pt = resolveEdgeValue(computed.get('padding-top'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const pr = resolveEdgeValue(computed.get('padding-right'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const pb = resolveEdgeValue(computed.get('padding-bottom'), em, rem, containerWidth, containerHeight, defaultFontSize);
  const pl = resolveEdgeValue(computed.get('padding-left'), em, rem, containerWidth, containerHeight, defaultFontSize);

  const bts = computed.get('border-top-style') ?? 'none';
  const brs = computed.get('border-right-style') ?? 'none';
  const bbs = computed.get('border-bottom-style') ?? 'none';
  const bls = computed.get('border-left-style') ?? 'none';

  const btw = (bts === 'none' || bts === 'hidden') ? 0 : resolveBorderWidth(computed.get('border-top-width') ?? 'medium', defaultFontSize);
  const brw = (brs === 'none' || brs === 'hidden') ? 0 : resolveBorderWidth(computed.get('border-right-width') ?? 'medium', defaultFontSize);
  const bbw = (bbs === 'none' || bbs === 'hidden') ? 0 : resolveBorderWidth(computed.get('border-bottom-width') ?? 'medium', defaultFontSize);
  const blw = (bls === 'none' || bls === 'hidden') ? 0 : resolveBorderWidth(computed.get('border-left-width') ?? 'medium', defaultFontSize);

  return {
    display,
    position,
    boxSizing,
    marginTop: mt,
    marginRight: mr,
    marginBottom: mb,
    marginLeft: ml,
    paddingTop: pt,
    paddingRight: pr,
    paddingBottom: pb,
    paddingLeft: pl,
    borderTopWidth: btw,
    borderRightWidth: brw,
    borderBottomWidth: bbw,
    borderLeftWidth: blw,
    borderTopStyle: bts,
    borderRightStyle: brs,
    borderBottomStyle: bbs,
    borderLeftStyle: bls,
    width: widthStr === 'auto' ? null : resolveLength(widthStr, defaultFontSize, containerWidth, containerHeight, defaultFontSize),
    height: heightStr === 'auto' ? null : resolveLength(heightStr, defaultFontSize, containerWidth, containerHeight, defaultFontSize),
    minWidth: resolveLength(computed.get('min-width') ?? '0', defaultFontSize, containerWidth, containerHeight, defaultFontSize),
    minHeight: resolveLength(computed.get('min-height') ?? '0', defaultFontSize, containerWidth, containerHeight, defaultFontSize),
    maxWidth: parseMax(computed.get('max-width'), defaultFontSize, containerWidth, containerHeight),
    maxHeight: parseMax(computed.get('max-height'), defaultFontSize, containerWidth, containerHeight),
    fontSize,
    lineHeight: resolveLineHeight(computed.get('line-height') ?? 'normal', fontSize, defaultFontSize),
    fontWeight: resolveFontWeight(computed.get('font-weight') ?? '400'),
    fontFamily: computed.get('font-family') ?? 'serif',
    color: computed.get('color') ?? '#000000',
    backgroundColor: computed.get('background-color') ?? 'transparent',
    textAlign: computed.get('text-align') ?? 'start',
    verticalAlign: computed.get('vertical-align') ?? 'baseline',
    float: computed.get('float') ?? 'none',
    clear: computed.get('clear') ?? 'none',
    overflowX: computed.get('overflow-x') ?? 'visible',
    overflowY: computed.get('overflow-y') ?? 'visible',
    zIndex: parseZIndex(computed.get('z-index')),
    opacity: parseFloat(computed.get('opacity') ?? '1'),
    visibility: computed.get('visibility') ?? 'visible',
    boxShadow: computed.get('box-shadow') ?? 'none',
  };
}

function resolveEdgeValue(value: string | undefined, em: number, rem: number, containerWidth: number, containerHeight: number, defaultFontSize: number): number {
  if (!value || value === 'auto') return 0;
  return resolveLength(value, em, containerWidth, containerHeight, rem);
}

function resolveLength(value: string, defaultFontSize: number, containerWidth: number, containerHeight: number, rootFontSize: number): number {
  const s = value.trim();
  if (s === '0' || s === '0px') return 0;
  if (s.endsWith('px')) return parseFloat(s) || 0;
  if (s.endsWith('em')) return (parseFloat(s) || 0) * defaultFontSize;
  if (s.endsWith('rem')) return (parseFloat(s) || 0) * rootFontSize;
  if (s.endsWith('%')) return (parseFloat(s) || 0) / 100 * containerWidth;
  if (s.endsWith('vw')) return (parseFloat(s) || 0) / 100 * containerWidth;
  if (s.endsWith('vh')) return (parseFloat(s) || 0) / 100 * containerHeight;
  if (s.endsWith('pt')) return (parseFloat(s) || 0) * 1.333;
  const parsed = parseFloat(s);
  if (!isNaN(parsed)) return parsed;
  return 0;
}

function resolveBorderWidth(value: string, fontSize: number): number {
  switch (value) {
    case 'thin': return 1;
    case 'medium': return 3;
    case 'thick': return 5;
    default: return resolveLength(value, fontSize, 0, 0, fontSize);
  }
}

function resolveLineHeight(value: string, fontSize: number, defaultFontSize: number): number | 'normal' {
  if (value === 'normal') return 'normal';
  if (value.endsWith('%')) return fontSize * (parseFloat(value) / 100);
  // unitless number → multiplier
  const num = parseFloat(value);
  if (!isNaN(num) && /^\d+(\.\d+)?$/.test(value.trim())) return fontSize * num;
  const resolved = resolveLength(value, defaultFontSize, 0, 0, defaultFontSize);
  if (resolved > 0) return resolved;
  return 'normal';
}

function resolveFontWeight(value: string): number {
  switch (value) {
    case 'normal': return 400;
    case 'bold': return 700;
    case 'lighter': return 300;
    case 'bolder': return 800;
    default: return parseInt(value, 10) || 400;
  }
}

function parseMax(value: string | undefined, fontSize: number, cw: number, ch: number): number | null {
  if (!value || value === 'none' || value === 'auto') return null;
  return resolveLength(value, fontSize, cw, ch, fontSize);
}

function parseZIndex(value: string | undefined): number | 'auto' {
  if (!value || value === 'auto') return 'auto';
  const n = parseInt(value, 10);
  return isNaN(n) ? 'auto' : n;
}
