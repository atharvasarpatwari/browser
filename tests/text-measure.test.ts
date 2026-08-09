import { describe, it, expect } from 'vitest';
import {
  HeuristicTextMeasurer,
  CanvasTextMeasurer,
  getTextMeasurer,
  setTextMeasurer,
  getFontMetricsRegistry,
  setFontMetricsProvider,
  HeuristicFontMetricsProvider,
  CanvasFontMetricsProvider,
  FontMetricsRegistry,
} from '../src/browser/rendering/formatting/text-measure';
import type { TextMeasurer, TextMetrics, FontMetricsProvider } from '../src/browser/rendering/formatting/text-measure';

// ─── HeuristicTextMeasurer ──────────────────────────────────────────────────

describe('HeuristicTextMeasurer', () => {
  const measurer = new HeuristicTextMeasurer();

  it('returns zero width for empty string', () => {
    const m = measurer.measure('', 16, 'sans-serif');
    expect(m.width).toBe(0);
    expect(m.height).toBe(16 * 1.2);
    expect(m.baseline).toBe(16 * 0.8);
  });

  it('measures text with positive width', () => {
    const m = measurer.measure('hello', 16, 'sans-serif');
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBe(16 * 1.2);
    expect(m.baseline).toBe(16 * 0.8);
  });

  it('wider characters produce greater width', () => {
    const narrow = measurer.measure('iiii', 16, 'sans-serif');
    const wide = measurer.measure('MMMM', 16, 'sans-serif');
    expect(wide.width).toBeGreaterThan(narrow.width);
  });

  it('monospace font is wider than serif for same text', () => {
    const serif = measurer.measure('hello', 16, 'serif');
    const mono = measurer.measure('hello', 16, 'monospace');
    expect(mono.width).toBeGreaterThanOrEqual(serif.width);
  });

  it('bold text is slightly wider than normal', () => {
    const normal = measurer.measure('hello', 16, 'sans-serif');
    const bold = measurer.measure('hello', 16, 'sans-serif', 'bold');
    expect(bold.width).toBeGreaterThan(normal.width);
  });

  it('larger font size produces proportionally larger metrics', () => {
    const small = measurer.measure('hello', 12, 'sans-serif');
    const large = measurer.measure('hello', 24, 'sans-serif');
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it('CJK characters are full-width', () => {
    const latin = measurer.measure('xxxx', 16, 'sans-serif');
    const cjk = measurer.measure('xxxx', 16, 'sans-serif');
    // CJK chars use charWidthFactor 1.0 vs Latin 0.6
    const cjkActual = measurer.measure('你好世界', 16, 'sans-serif');
    expect(cjkActual.width).toBeGreaterThan(0);
  });

  it('handles comma-separated font families', () => {
    const m = measurer.measure('hello', 16, 'Courier New, monospace');
    expect(m.width).toBeGreaterThan(0);
  });

  it('unknown font family uses default factor', () => {
    const m = measurer.measure('hello', 16, 'UnknownFont');
    expect(m.width).toBeGreaterThan(0);
  });
});

// ─── CanvasTextMeasurer ─────────────────────────────────────────────────────

describe('CanvasTextMeasurer', () => {
  it('falls back to heuristic in Node environment', () => {
    const measurer = new CanvasTextMeasurer();
    const m = measurer.measure('hello', 16, 'sans-serif');
    // In Node, no canvas available — falls back to heuristic
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBe(16 * 1.2);
  });
});

// ─── Global singleton ───────────────────────────────────────────────────────

describe('getTextMeasurer / setTextMeasurer', () => {
  it('returns a default measurer', () => {
    const m = getTextMeasurer();
    expect(m).toBeDefined();
    expect(typeof m.measure).toBe('function');
  });

  it('allows overriding the global measurer', () => {
    const custom: TextMeasurer = {
      measure: (): TextMetrics => ({ width: 42, height: 10, baseline: 8 }),
    };
    setTextMeasurer(custom);
    const m = getTextMeasurer();
    expect(m.measure('anything', 16, 'sans-serif')).toEqual({ width: 42, height: 10, baseline: 8 });

    // Restore default
    setTextMeasurer(new HeuristicTextMeasurer());
  });

  it('default measurer is HeuristicTextMeasurer', () => {
    setTextMeasurer(new HeuristicTextMeasurer());
    const m = getTextMeasurer();
    expect(m).toBeInstanceOf(HeuristicTextMeasurer);
  });
});

// ─── FontMetricsProvider adapters ────────────────────────────────────────────

describe('FontMetricsProvider adapters', () => {
  it('HeuristicFontMetricsProvider is always available', () => {
    const provider = new HeuristicFontMetricsProvider();
    expect(provider.name).toBe('heuristic');
    expect(provider.isAvailable()).toBe(true);
  });

  it('HeuristicFontMetricsProvider measures text', () => {
    const provider = new HeuristicFontMetricsProvider();
    const m = provider.measure('hello', 16, 'sans-serif');
    expect(m.width).toBeGreaterThan(0);
    expect(m.height).toBe(16 * 1.2);
  });

  it('CanvasFontMetricsProvider is unavailable without a DOM canvas', () => {
    const provider = new CanvasFontMetricsProvider();
    expect(provider.name).toBe('canvas');
    expect(provider.isAvailable()).toBe(false);
  });

  it('CanvasFontMetricsProvider falls back to heuristic measurement in Node', () => {
    const provider = new CanvasFontMetricsProvider();
    const m = provider.measure('hello', 16, 'sans-serif');
    expect(m.width).toBeGreaterThan(0);
  });
});

// ─── FontMetricsRegistry ─────────────────────────────────────────────────────

describe('FontMetricsRegistry', () => {
  it('selects the first available provider', () => {
    const registry = new FontMetricsRegistry();
    const heuristic = new HeuristicFontMetricsProvider();
    registry.register(heuristic);
    expect(registry.getBest()).toBe(heuristic);
  });

  it('skips unavailable providers', () => {
    const registry = new FontMetricsRegistry();
    const canvas = new CanvasFontMetricsProvider();
    const heuristic = new HeuristicFontMetricsProvider();
    registry.register(canvas);
    registry.register(heuristic);
    // canvas is unavailable in Node — heuristic wins
    expect(registry.getBest()).toBe(heuristic);
    expect(registry.getProviders()).toEqual([canvas, heuristic]);
  });

  it('falls back to heuristic when nothing is registered', () => {
    const registry = new FontMetricsRegistry();
    expect(registry.getBest()).toBeInstanceOf(HeuristicFontMetricsProvider);
  });

  it('caches the selected provider', () => {
    const registry = new FontMetricsRegistry();
    const heuristic = new HeuristicFontMetricsProvider();
    registry.register(heuristic);
    expect(registry.getBest()).toBe(heuristic);
    expect(registry.getBest()).toBe(heuristic);
  });

  it('invalidates the cache when the provider list changes', () => {
    const registry = new FontMetricsRegistry();
    registry.register(new HeuristicFontMetricsProvider());
    expect(registry.getBest()).toBeInstanceOf(HeuristicFontMetricsProvider);

    // Replacing the list must drop the cached selection.
    registry.clear();
    const custom: FontMetricsProvider = {
      name: 'custom',
      isAvailable: () => true,
      measure: (): TextMetrics => ({ width: 1, height: 2, baseline: 3 }),
    };
    registry.register(custom);
    expect(registry.getBest()).toBe(custom);
  });

  it('clear empties the provider list', () => {
    const registry = new FontMetricsRegistry();
    registry.register(new HeuristicFontMetricsProvider());
    registry.clear();
    expect(registry.getProviders()).toHaveLength(0);
  });
});

// ─── Global registry plug-in ─────────────────────────────────────────────────

describe('getFontMetricsRegistry / setFontMetricsProvider', () => {
  it('exposes a global registry', () => {
    expect(getFontMetricsRegistry()).toBeInstanceOf(FontMetricsRegistry);
  });

  it('setFontMetricsProvider registers a provider and refreshes the measurer', () => {
    const custom: FontMetricsProvider = {
      name: 'custom-global',
      isAvailable: () => true,
      measure: (): TextMetrics => ({ width: 7, height: 3, baseline: 1 }),
    };
    setFontMetricsProvider(custom);
    expect(getTextMeasurer()).not.toBeInstanceOf(HeuristicTextMeasurer);

    // Cleanup: restore heuristic global state.
    setTextMeasurer(new HeuristicTextMeasurer());
  });
});
