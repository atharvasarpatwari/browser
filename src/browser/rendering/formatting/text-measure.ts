// ─────────────────────────────────────────────────────────────────────────────
// TEXT MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metrics for a measured text run.
 */
export interface TextMetrics {
  /** Width of the text in pixels. */
  width: number;
  /** Height of the text in pixels (typically line-height). */
  height: number;
  /** Baseline offset from the top of the text box. */
  baseline: number;
}

/**
 * Text measurement strategy.
 *
 * In a browser environment, this would use Canvas.measureText().
 * For our Node.js/bundler environment, we use heuristic-based measurement
 * that approximates real font metrics.
 */
export interface TextMeasurer {
  /** Measure a text string with given font properties. */
  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEURISTIC MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Width factors per font family (approximate average character width / font size).
 * These are calibrated to produce reasonable line breaking behavior.
 */
const FONT_WIDTH_FACTORS: Record<string, number> = {
  'serif': 0.53,
  'sans-serif': 0.55,
  'monospace': 0.6,
  'arial': 0.55,
  'helvetica': 0.55,
  'times new roman': 0.53,
  'courier new': 0.6,
  'georgia': 0.53,
  'verdana': 0.58,
  'tahoma': 0.55,
  'trebuchet ms': 0.55,
};

/**
 * Width adjustment per character category.
 * Different characters have different widths even in the same font.
 */
function getCharWidthFactor(code: number): number {
  // ASCII fast path
  if (code < 128) {
    // Narrow characters (~0.4 * fontSize)
    if (code === 0x69 || code === 0x6C || code === 0x31 // i l 1
      || code === 0x2E || code === 0x2C || code === 0x27 // . , '
      || code === 0x21 || code === 0x7C // ! |
    ) return 0.35;

    // Wide characters (~0.7 * fontSize)
    if (code === 0x4D || code === 0x57 || code === 0x6D || code === 0x77 // M W m w
      || code === 0x40 // @
    ) return 0.72;

    // Normal width
    if (code === 0x20) return 0.25; // space
    if (code === 0x09) return 0.25 * 4; // tab (~4 spaces)
    if (code === 0x2D) return 0.4; // hyphen
    if (code === 0x28 || code === 0x29) return 0.35; // ( )
    return 0.6; // default Latin
  }

  // CJK characters are typically full-width
  if (code >= 0x4E00 && code <= 0x9FFF) return 1.0; // CJK Unified
  if (code >= 0x3400 && code <= 0x4DBF) return 1.0; // CJK Extension A
  if (code >= 0xF900 && code <= 0xFAFF) return 1.0; // CJK Compat
  if (code >= 0x3000 && code <= 0x303F) return 1.0; // CJK Symbols
  if (code >= 0x3040 && code <= 0x309F) return 1.0; // Hiragana
  if (code >= 0x30A0 && code <= 0x30FF) return 1.0; // Katakana
  if (code >= 0xFF00 && code <= 0xFFEF) return 1.0; // Fullwidth
  if (code >= 0xAC00 && code <= 0xD7A3) return 1.0; // Hangul syllables
  if (code >= 0x0E00 && code <= 0x0E7F) return 0.9; // Thai (approximation)

  // Cyrillic, Arabic, Latin Extended — slightly wider
  if (code >= 0x0400 && code <= 0x06FF) return 0.58;

  // Default
  return 0.6;
}

/**
 * Heuristic text measurement.
 *
 * Uses character-by-character width estimation based on font family
 * and character categories. This produces reasonable line breaking
 * without access to a real font engine.
 *
 * In a real browser, you would use:
 *   canvas.font = `${fontSize}px ${fontFamily}`;
 *   const metrics = canvas.measureText(text);
 */
export class HeuristicTextMeasurer implements TextMeasurer {
  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics {
    if (!text || text.length === 0) {
      return { width: 0, height: fontSize * 1.2, baseline: fontSize * 0.8 };
    }

    // Get the base width factor for this font family
    const familyLower = fontFamily.toLowerCase().split(',')[0]!.trim();
    const baseFactor = FONT_WIDTH_FACTORS[familyLower] ?? 0.55;

    // Bold text is slightly wider
    const boldFactor = fontWeight === 'bold' || fontWeight === '700' ? 1.05 : 1.0;

    // Sum character widths
    let totalWidth = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      const charFactor = getCharWidthFactor(code);
      totalWidth += charFactor * baseFactor * boldFactor;
    }

    const width = totalWidth * fontSize;

    // Baseline: typically ~80% of font size from top
    const baseline = fontSize * 0.8;

    return {
      width,
      height: fontSize * 1.2,
      baseline,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS-BASED MEASUREMENT (browser only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canvas-based text measurement for browser environments.
 * Falls back to heuristic if canvas is not available.
 */
export class CanvasTextMeasurer implements TextMeasurer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private fallback = new HeuristicTextMeasurer();

  constructor() {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
    }
  }

  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics {
    if (!this.ctx) {
      return this.fallback.measure(text, fontSize, fontFamily, fontWeight);
    }

    const weight = fontWeight ?? 'normal';
    this.ctx.font = `${weight} ${fontSize}px ${fontFamily}`;
    const tm = this.ctx.measureText(text);

    return {
      width: tm.width,
      height: fontSize * 1.2,
      baseline: tm.actualBoundingBoxAscent ?? fontSize * 0.8,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let _globalMeasurer: TextMeasurer | null = null;

/**
 * Get the global text measurer.
 * Uses CanvasTextMeasurer if available, otherwise HeuristicTextMeasurer.
 */
export function getTextMeasurer(): TextMeasurer {
  if (!_globalMeasurer) {
    _globalMeasurer = new HeuristicTextMeasurer();
  }
  return _globalMeasurer;
}

/**
 * Override the global text measurer (useful for testing).
 */
export function setTextMeasurer(measurer: TextMeasurer): void {
  _globalMeasurer = measurer;
}
