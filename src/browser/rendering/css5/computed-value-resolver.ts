/**
 * @file css5/computed-value-resolver.ts
 * Resolves CSS specified values to computed values.
 *
 * After the cascade + inheritance pipeline produces a Map<string, string>
 * of specified values, this module resolves each value to its computed form:
 *
 *   - Named colors → hex (red → #ff0000)
 *   - Font-size keywords → px (small → 13px, large → 18px)
 *   - Font-weight keywords → numeric (bold → 700, lighter → inherited - 100)
 *   - Border-width keywords → px (thin → 1px, thick → 5px)
 *   - Opacity clamping (2 → 1)
 *   - Display/visibility/overflow keyword normalization
 *   - `auto` pass-through for dimensions (resolved later by layout)
 *
 * Values that require layout context (em, rem, %, vw, calc) are left as-is
 * for the layout engine to resolve.
 */

// ─────────────────────────────────────────────────────────────────────────────
// NAMED COLOR TABLE (CSS Color Level 4 — 148 named colors)
// ─────────────────────────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, string> = {
  // A
  'aliceblue':            '#f0f8ff',
  'antiquewhite':         '#faebd7',
  'aqua':                 '#00ffff',
  'aquamarine':           '#7fffd4',
  'azure':                '#f0ffff',
  // B
  'beige':                '#f5f5dc',
  'bisque':               '#ffe4c4',
  'black':                '#000000',
  'blanchedalmond':       '#ffebcd',
  'blue':                 '#0000ff',
  'blueviolet':           '#8a2be2',
  'brown':                '#a52a2a',
  'burlywood':            '#deb887',
  // C
  'cadetblue':            '#5f9ea0',
  'chartreuse':           '#7fff00',
  'chocolate':            '#d2691e',
  'coral':                '#ff7f50',
  'cornflowerblue':       '#6495ed',
  'cornsilk':             '#fff8dc',
  'crimson':              '#dc143c',
  'cyan':                 '#00ffff',
  // D
  'darkblue':             '#00008b',
  'darkcyan':             '#008b8b',
  'darkgoldenrod':        '#b8860b',
  'darkgray':             '#a9a9a9',
  'darkgreen':            '#006400',
  'darkgrey':             '#a9a9a9',
  'darkkhaki':            '#bdb76b',
  'darkmagenta':          '#8b008b',
  'darkolivegreen':       '#556b2f',
  'darkorange':           '#ff8c00',
  'darkorchid':           '#9932cc',
  'darkred':              '#8b0000',
  'darksalmon':           '#e9967a',
  'darkseagreen':         '#8fbc8f',
  'darkslateblue':        '#483d8b',
  'darkslategray':        '#2f4f4f',
  'darkslategrey':        '#2f4f4f',
  'darkturquoise':        '#00ced1',
  'darkviolet':           '#9400d3',
  'deeppink':             '#ff1493',
  'deepskyblue':          '#00bfff',
  'dimgray':              '#696969',
  'dimgrey':              '#696969',
  'dodgerblue':           '#1e90ff',
  // F
  'firebrick':            '#b22222',
  'floralwhite':          '#fffaf0',
  'forestgreen':          '#228b22',
  'fuchsia':              '#ff00ff',
  // G
  'gainsboro':            '#dcdcdc',
  'ghostwhite':           '#f8f8ff',
  'gold':                 '#ffd700',
  'goldenrod':            '#daa520',
  'gray':                 '#808080',
  'green':                '#008000',
  'greenyellow':          '#adff2f',
  'grey':                 '#808080',
  // H
  'honeydew':             '#f0fff0',
  'hotpink':              '#ff69b4',
  // I
  'indianred':            '#cd5c5c',
  'indigo':               '#4b0082',
  'ivory':                '#fffff0',
  // K
  'khaki':                '#f0e68c',
  // L
  'lavender':             '#e6e6fa',
  'lavenderblush':        '#fff0f5',
  'lawngreen':            '#7cfc00',
  'lemonchiffon':         '#fffacd',
  'lightblue':            '#add8e6',
  'lightcoral':           '#f08080',
  'lightcyan':            '#e0ffff',
  'lightgoldenrodyellow': '#fafad2',
  'lightgray':            '#d3d3d3',
  'lightgreen':           '#90ee90',
  'lightgrey':            '#d3d3d3',
  'lightpink':            '#ffb6c1',
  'lightsalmon':          '#ffa07a',
  'lightseagreen':        '#20b2aa',
  'lightskyblue':         '#87cefa',
  'lightslategray':       '#778899',
  'lightslategrey':       '#778899',
  'lightsteelblue':       '#b0c4de',
  'lightyellow':          '#ffffe0',
  'lime':                 '#00ff00',
  'limegreen':            '#32cd32',
  'linen':                '#faf0e6',
  // M
  'magenta':              '#ff00ff',
  'maroon':               '#800000',
  'mediumaquamarine':     '#66cdaa',
  'mediumblue':           '#0000cd',
  'mediumorchid':         '#ba55d3',
  'mediumpurple':         '#9370db',
  'mediumseagreen':       '#3cb371',
  'mediumslateblue':      '#7b68ee',
  'mediumspringgreen':    '#00fa9a',
  'mediumturquoise':      '#48d1cc',
  'mediumvioletred':      '#c71585',
  'midnightblue':         '#191970',
  'mintcream':            '#f5fffa',
  'mistyrose':            '#ffe4e1',
  'moccasin':             '#ffe4b5',
  // N
  'navajowhite':          '#ffdead',
  'navy':                 '#000080',
  // O
  'oldlace':              '#fdf5e6',
  'olive':                '#808000',
  'olivedrab':            '#6b8e23',
  'orange':               '#ffa500',
  'orangered':            '#ff4500',
  'orchid':               '#da70d6',
  // P
  'palegoldenrod':        '#eee8aa',
  'palegreen':            '#98fb98',
  'paleturquoise':        '#afeeee',
  'palevioletred':        '#db7093',
  'papayawhip':           '#ffefd5',
  'peachpuff':            '#ffdab9',
  'peru':                 '#cd853f',
  'pink':                 '#ffc0cb',
  'plum':                 '#dda0dd',
  'powderblue':           '#b0e0e6',
  'purple':               '#800080',
  // R
  'rebeccapurple':        '#663399',
  'red':                  '#ff0000',
  'rosybrown':            '#bc8f8f',
  'royalblue':            '#4169e1',
  // S
  'saddlebrown':          '#8b4513',
  'salmon':               '#fa8072',
  'sandybrown':           '#f4a460',
  'seagreen':             '#2e8b57',
  'seashell':             '#fff5ee',
  'sienna':               '#a0522d',
  'silver':               '#c0c0c0',
  'skyblue':              '#87ceeb',
  'slateblue':            '#6a5acd',
  'slategray':            '#708090',
  'slategrey':            '#708090',
  'snow':                 '#fffafa',
  'springgreen':          '#00ff7f',
  'steelblue':            '#4682b4',
  // T
  'tan':                  '#d2b48c',
  'teal':                 '#008080',
  'thistle':              '#d8bfd8',
  'tomato':               '#ff6347',
  'turquoise':            '#40e0d0',
  // V
  'violet':               '#ee82ee',
  // W
  'wheat':                '#f5deb3',
  'white':                '#ffffff',
  'whitesmoke':           '#f5f5f5',
  // Y
  'yellow':               '#ffff00',
  'yellowgreen':          '#9acd32',
  // Special
  'currentcolor':         'currentcolor',
  'transparent':          'transparent',
};

// ─────────────────────────────────────────────────────────────────────────────
// FONT-SIZE KEYWORD TABLE
// ─────────────────────────────────────────────────────────────────────────────

const FONT_SIZE_KEYWORDS: Record<string, number> = {
  'xx-small': 7,
  'x-small':  9,
  'small':    13,
  'medium':   16,
  'large':    18,
  'x-large':  24,
  'xx-large': 32,
};

/**
 * Absolute font-size keywords → pixel value.
 * `smaller` and `larger` are relative and need parent context.
 */
export function resolveFontSizeKeyword(value: string, parentFontSize: number): string | null {
  const px = FONT_SIZE_KEYWORDS[value.toLowerCase()];
  if (px !== undefined) return `${px}px`;

  const v = value.toLowerCase();
  if (v === 'smaller') return `${Math.round(parentFontSize * 0.8)}px`;
  if (v === 'larger') return `${Math.round(parentFontSize * 1.2)}px`;

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FONT-WEIGHT KEYWORD TABLE
// ─────────────────────────────────────────────────────────────────────────────

const FONT_WEIGHT_KEYWORDS: Record<string, number> = {
  'thin':       100,
  'hairline':   100,
  'extra-light': 200,
  'ultra-light': 200,
  'light':      300,
  'normal':     400,
  'regular':    400,
  'book':       400,
  'medium':     500,
  'semi-bold':  600,
  'demi-bold':  600,
  'bold':       700,
  'extra-bold': 800,
  'ultra-bold': 800,
  'black':      900,
  'heavy':      900,
  'extra-black': 900,
  'ultra-black': 900,
};

/**
 * Resolves a font-weight keyword to its numeric equivalent.
 * `bolder` and `lighter` are relative and need parent context.
 */
export function resolveFontWeightKeyword(
  value: string,
  parentWeight: number,
): string | null {
  const v = value.toLowerCase();

  const absolute = FONT_WEIGHT_KEYWORDS[v];
  if (absolute !== undefined) return String(absolute);

  if (v === 'bolder') {
    return String(Math.min(900, parentWeight + 100));
  }
  if (v === 'lighter') {
    return String(Math.max(100, parentWeight - 100));
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BORDER-WIDTH KEYWORD TABLE
// ─────────────────────────────────────────────────────────────────────────────

const BORDER_WIDTH_KEYWORDS: Record<string, number> = {
  'thin':   1,
  'medium': 3,
  'thick':  5,
};

/**
 * Resolves a border-width keyword to pixels.
 */
export function resolveBorderWidthKeyword(value: string): string | null {
  const px = BORDER_WIDTH_KEYWORDS[value.toLowerCase()];
  return px !== undefined ? `${px}px` : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTED VALUE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolutionContext {
  /** Parent element's computed font-size in px (default: 16). */
  readonly parentFontSize: number;
  /** Parent element's computed font-weight (default: 400). */
  readonly parentFontWeight: number;
}

const DEFAULT_CTX: ResolutionContext = { parentFontSize: 16, parentFontWeight: 400 };

/**
 * Resolves a specified value to its computed form for a given property.
 *
 * Handles:
 *   - Named colors → hex
 *   - Font-size keywords → px
 *   - Font-weight keywords → numeric
 *   - Border-width keywords → px
 *   - Opacity clamping (values outside [0,1])
 *   - Display/visibility/overflow/position normalization
 *   - `auto` pass-through for dimensions
 *
 * Values with em/rem/%/vw/vh/calc() are left as-is for the layout engine.
 *
 * @param property  - CSS property name
 * @param value     - Specified value string
 * @param context   - Resolution context (parent font size, etc.)
 * @returns         - Resolved computed value string
 */
export function resolveComputedValue(
  property: string,
  value: string,
  context?: ResolutionContext,
): string {
  const ctx = context ?? DEFAULT_CTX;
  const prop = property.toLowerCase();
  const v = value.trim();

  // ── Special values ──────────────────────────────────────────────────
  if (v === '' || v === 'initial') return v;
  if (v === 'auto' || v === 'normal' || v === 'none') return v;
  if (v === 'currentcolor' || v === 'inherit') return v;

  // ── Color resolution ────────────────────────────────────────────────
  if (prop.endsWith('color') || prop === 'color' || prop === 'background-color' ||
      prop === 'border-top-color' || prop === 'border-right-color' ||
      prop === 'border-bottom-color' || prop === 'border-left-color' ||
      prop === 'outline-color' || prop === 'text-decoration-color') {
    return resolveColor(v);
  }

  // ── Font-size ───────────────────────────────────────────────────────
  if (prop === 'font-size') {
    const resolved = resolveFontSizeKeyword(v, ctx.parentFontSize);
    if (resolved) return resolved;
  }

  // ── Font-weight ─────────────────────────────────────────────────────
  if (prop === 'font-weight') {
    const resolved = resolveFontWeightKeyword(v, ctx.parentFontWeight);
    if (resolved) return resolved;
  }

  // ── Border-width keywords ───────────────────────────────────────────
  if (prop.endsWith('-width') || prop === 'border-width' || prop === 'outline-width') {
    const resolved = resolveBorderWidthKeyword(v);
    if (resolved) return resolved;
  }

  // ── Opacity clamping ────────────────────────────────────────────────
  if (prop === 'opacity') {
    const n = parseFloat(v);
    if (isFinite(n)) return String(Math.max(0, Math.min(1, n)));
  }

  // ── z-index: integer ────────────────────────────────────────────────
  if (prop === 'z-index' && v !== 'auto') {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return String(n);
  }

  // ── Flex grow/shrink/order: number ──────────────────────────────────
  if (prop === 'flex-grow' || prop === 'flex-shrink') {
    const n = parseFloat(v);
    if (isFinite(n) && n >= 0) return String(n);
  }
  if (prop === 'order') {
    const n = parseInt(v, 10);
    if (!isNaN(n)) return String(n);
  }

  // ── Line-height: number multiplier vs keyword ───────────────────────
  if (prop === 'line-height') {
    if (v === 'normal') return 'normal';
    const n = parseFloat(v);
    if (!isNaN(n) && !v.endsWith('px') && !v.endsWith('em') && !v.endsWith('rem') && !v.endsWith('%')) {
      return String(n);
    }
  }

  // ── Visibility: normalize ───────────────────────────────────────────
  if (prop === 'visibility') {
    if (v === 'visible' || v === 'hidden' || v === 'collapse') return v;
  }

  // ── Overflow: normalize ─────────────────────────────────────────────
  if (prop === 'overflow' || prop === 'overflow-x' || prop === 'overflow-y') {
    if (['visible', 'hidden', 'scroll', 'auto', 'clip'].includes(v)) return v;
  }

  // ── Display: normalize ──────────────────────────────────────────────
  if (prop === 'display') {
    const lower = v.toLowerCase();
    if (['block', 'inline', 'inline-block', 'flex', 'inline-flex',
         'grid', 'inline-grid', 'none', 'table', 'inline-table',
         'table-row', 'table-cell', 'table-column', 'table-caption',
         'list-item', 'run-in', 'contents'].includes(lower)) {
      return lower;
    }
  }

  // ── Position: normalize ─────────────────────────────────────────────
  if (prop === 'position') {
    const lower = v.toLowerCase();
    if (['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(lower)) {
      return lower;
    }
  }

  // ── Text-align: normalize ───────────────────────────────────────────
  if (prop === 'text-align') {
    const lower = v.toLowerCase();
    if (['left', 'right', 'center', 'justify', 'start', 'end',
         'match-parent', 'justify-all'].includes(lower)) {
      return lower;
    }
  }

  // ── Float: normalize ────────────────────────────────────────────────
  if (prop === 'float') {
    const lower = v.toLowerCase();
    if (['none', 'left', 'right', 'inline-start', 'inline-end'].includes(lower)) {
      return lower;
    }
  }

  // ── Clear: normalize ────────────────────────────────────────────────
  if (prop === 'clear') {
    const lower = v.toLowerCase();
    if (['none', 'left', 'right', 'both', 'inline-start', 'inline-end'].includes(lower)) {
      return lower;
    }
  }

  // ── Direction: normalize ────────────────────────────────────────────
  if (prop === 'direction') {
    const lower = v.toLowerCase();
    if (lower === 'ltr' || lower === 'rtl') return lower;
  }

  // ── White-space: normalize ──────────────────────────────────────────
  if (prop === 'white-space') {
    const lower = v.toLowerCase();
    if (['normal', 'pre', 'nowrap', 'pre-wrap', 'pre-line', 'break-spaces'].includes(lower)) {
      return lower;
    }
  }

  // ── Vertical-align: normalize ───────────────────────────────────────
  if (prop === 'vertical-align') {
    const lower = v.toLowerCase();
    if (['baseline', 'sub', 'super', 'text-top', 'text-bottom',
         'middle', 'top', 'bottom'].includes(lower)) {
      return lower;
    }
  }

  // ── Pass through everything else (em, rem, %, px, etc.) ────────────
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOR RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a color value — named colors to hex, hex/rgb/hsl pass through.
 */
function resolveColor(value: string): string {
  const v = value.trim().toLowerCase();

  // Named color
  const hex = NAMED_COLORS[v];
  if (hex !== undefined) return hex;

  // Pass through hex, rgb(), rgba(), hsl(), hsla(), currentcolor, transparent
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves all values in a computed style map to their computed forms.
 * Mutates the map in place.
 *
 * @param computed  - Computed style map
 * @param context   - Resolution context
 * @returns         - The same map (mutated)
 */
export function resolveAllComputedValues(
  computed: Map<string, string>,
  context?: ResolutionContext,
): Map<string, string> {
  const ctx = context ?? DEFAULT_CTX;
  for (const [prop, value] of computed) {
    const resolved = resolveComputedValue(prop, value, ctx);
    if (resolved !== value) {
      computed.set(prop, resolved);
    }
  }
  return computed;
}
