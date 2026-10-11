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

/**
 * Pluggable font metrics provider.
 *
 * Extends {@link TextMeasurer} with a stable identity (`name`) and an
 * availability probe so a registry can pick the best implementation for the
 * current environment (canvas in a browser, heuristic in Node/bundlers).
 */
export interface FontMetricsProvider extends TextMeasurer {
  /** Stable identifier used for diagnostics and tests. */
  readonly name: string;
  /** Whether this provider can measure text in the current environment. */
  isAvailable(): boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEURISTIC MEASUREMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Monospace text measurement matching the rasterizer's actual glyph
 * rendering.
 *
 * The paint stage (rasterizer.ts fillText/strokeText) has no real font/glyph
 * shaping yet — it draws every character on a fixed 8x8 bitmap-font grid
 * advanced by exactly 1.0 * fontSize per character, regardless of font
 * family, weight, or which character it is. A proportional width estimate
 * here (narrower for "i", wider for "M", scaled by font family) used to
 * produce widths letting words sit closer together than the bitmap font
 * actually draws them, so every word overran into the next one — layout
 * positioned each word assuming ~0.5-0.6x fontSize/char, paint drew it at a
 * full 1.0x fontSize/char. Once the rasterizer can shape real proportional
 * glyphs, this can go back to estimating real metrics — until then it must
 * match what paint actually draws, or text overlaps on every page.
 */
export class HeuristicTextMeasurer implements TextMeasurer {
  measure(text: string, fontSize: number, _fontFamily: string, _fontWeight?: string): TextMetrics {
    return {
      width: text.length * fontSize,
      height: fontSize * 1.2,
      baseline: fontSize * 0.8,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS-BASED MEASUREMENT (browser only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canvas-based text measurement for browser environments.
 *
 * Real `canvas.measureText()` reports how an actual font would render —
 * which the paint stage still can't do (see HeuristicTextMeasurer above):
 * it only draws a fixed-width bitmap font. Measuring "real" widths here
 * while paint draws monospace bitmap glyphs is exactly the layout/paint
 * mismatch that caused every page's text to overlap, so this delegates to
 * the same monospace measurement paint actually uses rather than pretending
 * real font metrics apply. Swap this back to real `measureText()` only once
 * the rasterizer can paint proportional glyphs.
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

  /** True when a 2D canvas context is available for real measurement. */
  isAvailable(): boolean {
    return this.ctx !== null;
  }

  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics {
    return this.fallback.measure(text, fontSize, fontFamily, fontWeight);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FONT METRICS PROVIDERS  (pluggable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Heuristic provider — always available, works in every environment.
 */
export class HeuristicFontMetricsProvider implements FontMetricsProvider {
  readonly name = 'heuristic';
  private readonly measurer = new HeuristicTextMeasurer();

  isAvailable(): boolean {
    return true;
  }

  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics {
    return this.measurer.measure(text, fontSize, fontFamily, fontWeight);
  }
}

/**
 * Canvas provider — preferred in browsers, unavailable in Node/bundlers.
 */
export class CanvasFontMetricsProvider implements FontMetricsProvider {
  readonly name = 'canvas';
  private readonly measurer = new CanvasTextMeasurer();

  isAvailable(): boolean {
    return this.measurer.isAvailable();
  }

  measure(text: string, fontSize: number, fontFamily: string, fontWeight?: string): TextMetrics {
    return this.measurer.measure(text, fontSize, fontFamily, fontWeight);
  }
}

/**
 * Registry that selects the first available provider.
 *
 * Consumers can plug in custom providers (measurement overrides, test mocks,
 * native font engines) via {@link register} without touching measurement call
 * sites. The best available provider is cached until the registry changes.
 */
export class FontMetricsRegistry {
  private providers: FontMetricsProvider[] = [];
  private selected: FontMetricsProvider | null = null;

  /** Register a provider. Later registrations are lower priority. */
  register(provider: FontMetricsProvider): void {
    this.providers.push(provider);
    this.selected = null;
  }

  /** All registered providers, in priority order. */
  getProviders(): readonly FontMetricsProvider[] {
    return this.providers;
  }

  /** The first available provider; falls back to the heuristic default. */
  getBest(): FontMetricsProvider {
    if (this.selected) return this.selected;
    this.selected = this.providers.find(p => p.isAvailable())
      ?? new HeuristicFontMetricsProvider();
    return this.selected;
  }

  clear(): void {
    this.providers = [];
    this.selected = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SINGLETON
// ─────────────────────────────────────────────────────────────────────────────

let _globalMeasurer: TextMeasurer | null = null;

const _globalRegistry = new FontMetricsRegistry();
_globalRegistry.register(new CanvasFontMetricsProvider());
_globalRegistry.register(new HeuristicFontMetricsProvider());

/**
 * Get the global text measurer.
 * Uses the best available FontMetricsProvider from the global registry
 * (canvas in browsers, heuristic otherwise).
 */
export function getTextMeasurer(): TextMeasurer {
  if (!_globalMeasurer) {
    _globalMeasurer = _globalRegistry.getBest();
  }
  return _globalMeasurer;
}

/**
 * Override the global text measurer (useful for testing).
 */
export function setTextMeasurer(measurer: TextMeasurer): void {
  _globalMeasurer = measurer;
}

/**
 * Get the global font metrics registry.
 *
 * Plug in custom providers with `getFontMetricsRegistry().register(provider)`.
 * The highest-priority available provider is selected automatically.
 */
export function getFontMetricsRegistry(): FontMetricsRegistry {
  return _globalRegistry;
}

/**
 * Plug a custom provider into the global registry and refresh the selected
 * measurer. Returns the registry for chaining.
 */
export function setFontMetricsProvider(provider: FontMetricsProvider): FontMetricsRegistry {
  _globalRegistry.register(provider);
  _globalMeasurer = null;
  return _globalRegistry;
}
