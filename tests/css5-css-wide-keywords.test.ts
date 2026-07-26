import { describe, it, expect } from 'vitest';
import {
  resolveCSSWideKeyword,
  isCSSWideKeywordValue,
  extractCSSWideKeyword,
  processCSSWideKeywords,
  type KeywordContext,
} from '../src/browser/rendering/css5/css-wide-keywords';

// ─────────────────────────────────────────────────────────────────────────────
// DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — Detection', () => {
  it('isCSSWideKeywordValue detects keywords', () => {
    expect(isCSSWideKeywordValue('inherit')).toBe(true);
    expect(isCSSWideKeywordValue('initial')).toBe(true);
    expect(isCSSWideKeywordValue('unset')).toBe(true);
    expect(isCSSWideKeywordValue('revert')).toBe(true);
    expect(isCSSWideKeywordValue('revert-layer')).toBe(true);
  });

  it('isCSSWideKeywordValue is case-insensitive', () => {
    expect(isCSSWideKeywordValue('INHERIT')).toBe(true);
    expect(isCSSWideKeywordValue('Initial')).toBe(true);
    expect(isCSSWideKeywordValue('Revert-Layer')).toBe(true);
  });

  it('isCSSWideKeywordValue rejects non-keywords', () => {
    expect(isCSSWideKeywordValue('red')).toBe(false);
    expect(isCSSWideKeywordValue('16px')).toBe(false);
    expect(isCSSWideKeywordValue('auto')).toBe(false);
    expect(isCSSWideKeywordValue('none')).toBe(false);
    expect(isCSSWideKeywordValue('')).toBe(false);
    expect(isCSSWideKeywordValue('  ')).toBe(false);
  });

  it('extractCSSWideKeyword returns keyword or null', () => {
    expect(extractCSSWideKeyword('inherit')).toBe('inherit');
    expect(extractCSSWideKeyword('initial')).toBe('initial');
    expect(extractCSSWideKeyword('unset')).toBe('unset');
    expect(extractCSSWideKeyword('revert')).toBe('revert');
    expect(extractCSSWideKeyword('revert-layer')).toBe('revert-layer');
    expect(extractCSSWideKeyword('red')).toBeNull();
    expect(extractCSSWideKeyword('16px')).toBeNull();
    expect(extractCSSWideKeyword('auto')).toBeNull();
  });

  it('extractCSSWideKeyword handles whitespace', () => {
    expect(extractCSSWideKeyword('  inherit  ')).toBe('inherit');
    expect(extractCSSWideKeyword(' INITIAL ')).toBe('initial');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION — inherit
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — inherit', () => {
  const ctx: KeywordContext = {
    parentComputed: new Map([
      ['color', '#ff0000'],
      ['font-size', '20px'],
      ['font-weight', '700'],
      ['margin-top', '10px'],
    ]),
    uaDefaults: new Map([
      ['display', 'block'],
    ]),
  };

  it('inherit resolves to parent computed value', () => {
    expect(resolveCSSWideKeyword('color', 'inherit', ctx)).toBe('#ff0000');
    expect(resolveCSSWideKeyword('font-size', 'inherit', ctx)).toBe('20px');
    expect(resolveCSSWideKeyword('font-weight', 'inherit', ctx)).toBe('700');
    expect(resolveCSSWideKeyword('margin-top', 'inherit', ctx)).toBe('10px');
  });

  it('inherit falls back to initial when no parent', () => {
    const noParent: KeywordContext = { parentComputed: null, uaDefaults: new Map() };
    expect(resolveCSSWideKeyword('color', 'inherit', noParent)).toBe('canvastext');
    expect(resolveCSSWideKeyword('font-size', 'inherit', noParent)).toBe('medium');
    expect(resolveCSSWideKeyword('display', 'inherit', noParent)).toBe('inline');
  });

  it('inherit falls back to initial when parent has no value for property', () => {
    const partialParent: KeywordContext = {
      parentComputed: new Map([['color', 'blue']]),
      uaDefaults: new Map(),
    };
    expect(resolveCSSWideKeyword('margin-top', 'inherit', partialParent)).toBe('0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION — initial
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — initial', () => {
  const ctx: KeywordContext = {
    parentComputed: new Map([
      ['color', '#ff0000'],
      ['font-size', '20px'],
    ]),
    uaDefaults: new Map([
      ['display', 'block'],
    ]),
  };

  it('initial returns the CSS initial value', () => {
    expect(resolveCSSWideKeyword('color', 'initial', ctx)).toBe('canvastext');
    expect(resolveCSSWideKeyword('font-size', 'initial', ctx)).toBe('medium');
    expect(resolveCSSWideKeyword('display', 'initial', ctx)).toBe('inline');
    expect(resolveCSSWideKeyword('margin-top', 'initial', ctx)).toBe('0');
    expect(resolveCSSWideKeyword('opacity', 'initial', ctx)).toBe('1');
    expect(resolveCSSWideKeyword('width', 'initial', ctx)).toBe('auto');
    expect(resolveCSSWideKeyword('float', 'initial', ctx)).toBe('none');
    expect(resolveCSSWideKeyword('position', 'initial', ctx)).toBe('static');
  });

  it('initial does not use parent values', () => {
    expect(resolveCSSWideKeyword('color', 'initial', ctx)).not.toBe('#ff0000');
    expect(resolveCSSWideKeyword('font-size', 'initial', ctx)).not.toBe('20px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION — unset
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — unset', () => {
  const ctx: KeywordContext = {
    parentComputed: new Map([
      ['color', '#ff0000'],
      ['font-size', '20px'],
      ['margin-top', '10px'],
    ]),
    uaDefaults: new Map([
      ['display', 'block'],
    ]),
  };

  it('unset resolves to inherit for inherited properties', () => {
    expect(resolveCSSWideKeyword('color', 'unset', ctx)).toBe('#ff0000');
    expect(resolveCSSWideKeyword('font-size', 'unset', ctx)).toBe('20px');
  });

  it('unset resolves to initial for non-inherited properties', () => {
    expect(resolveCSSWideKeyword('display', 'unset', ctx)).toBe('inline');
    expect(resolveCSSWideKeyword('margin-top', 'unset', ctx)).toBe('0');
    expect(resolveCSSWideKeyword('width', 'unset', ctx)).toBe('auto');
    expect(resolveCSSWideKeyword('opacity', 'unset', ctx)).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION — revert
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — revert', () => {
  it('revert falls back to UA defaults when available', () => {
    const ctx: KeywordContext = {
      parentComputed: new Map(),
      uaDefaults: new Map([
        ['display', 'block'],
        ['margin', '8px'],
      ]),
    };
    expect(resolveCSSWideKeyword('display', 'revert', ctx)).toBe('block');
    expect(resolveCSSWideKeyword('margin', 'revert', ctx)).toBe('8px');
  });

  it('revert falls back to unset when no UA default', () => {
    const ctx: KeywordContext = {
      parentComputed: new Map([
        ['color', '#ff0000'],
      ]),
      uaDefaults: new Map(),
    };
    // color is inherited → unset → inherit → parent value
    expect(resolveCSSWideKeyword('color', 'revert', ctx)).toBe('#ff0000');
  });

  it('revert-layer behaves the same as revert', () => {
    const ctx: KeywordContext = {
      parentComputed: new Map(),
      uaDefaults: new Map([
        ['display', 'block'],
      ]),
    };
    expect(resolveCSSWideKeyword('display', 'revert-layer', ctx)).toBe('block');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NON-KEYWORD PASS-THROUGH
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — Pass-Through', () => {
  const ctx: KeywordContext = {
    parentComputed: new Map(),
    uaDefaults: new Map(),
  };

  it('passes through regular values unchanged', () => {
    expect(resolveCSSWideKeyword('color', 'red', ctx)).toBe('red');
    expect(resolveCSSWideKeyword('color', '#ff0000', ctx)).toBe('#ff0000');
    expect(resolveCSSWideKeyword('color', 'rgb(255,0,0)', ctx)).toBe('rgb(255,0,0)');
    expect(resolveCSSWideKeyword('margin-top', '10px', ctx)).toBe('10px');
    expect(resolveCSSWideKeyword('font-size', '1.5em', ctx)).toBe('1.5em');
    expect(resolveCSSWideKeyword('width', 'auto', ctx)).toBe('auto');
    expect(resolveCSSWideKeyword('display', 'flex', ctx)).toBe('flex');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BATCH PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — Batch Processing', () => {
  it('processes all keywords in a computed map', () => {
    const computed = new Map([
      ['color', 'inherit'],
      ['font-size', 'initial'],
      ['display', 'unset'],
      ['margin-top', '10px'],
      ['opacity', 'revert'],
    ]);

    const ctx: KeywordContext = {
      parentComputed: new Map([['color', '#ff0000']]),
      uaDefaults: new Map([['display', 'block']]),
    };

    processCSSWideKeywords(computed, ctx);

    expect(computed.get('color')).toBe('#ff0000');
    expect(computed.get('font-size')).toBe('medium');
    expect(computed.get('display')).toBe('inline'); // unset → initial (display is non-inherited)
    expect(computed.get('margin-top')).toBe('10px'); // unchanged
    expect(computed.get('opacity')).toBe('1'); // revert → unset → initial
  });

  it('does not modify non-keyword values', () => {
    const computed = new Map([
      ['color', '#ff0000'],
      ['font-size', '16px'],
      ['display', 'flex'],
    ]);

    const ctx: KeywordContext = {
      parentComputed: new Map(),
      uaDefaults: new Map(),
    };

    processCSSWideKeywords(computed, ctx);

    expect(computed.get('color')).toBe('#ff0000');
    expect(computed.get('font-size')).toBe('16px');
    expect(computed.get('display')).toBe('flex');
  });

  it('handles empty map', () => {
    const computed = new Map<string, string>();
    const ctx: KeywordContext = { parentComputed: null, uaDefaults: new Map() };
    processCSSWideKeywords(computed, ctx);
    expect(computed.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESOLUTION — revert-layer with layer tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('CSS-Wide Keywords — revert-layer with layers', () => {
  it('revert-layer uses previous layer value', () => {
    const ctx: KeywordContext = {
      parentComputed: null,
      uaDefaults: new Map([['color', '#000000']]),
      cascadeEntries: [
        { property: 'color', value: 'red', important: false, layerIndex: 0, layerName: 'base', sourceOrder: 1 },
        { property: 'color', value: 'blue', important: false, layerIndex: 1, layerName: 'utilities', sourceOrder: 2 },
      ],
      layerOrder: ['base', 'utilities'],
    };
    // The second entry (blue, layer 1) uses revert-layer, should get red (layer 0)
    expect(resolveCSSWideKeyword('color', 'revert-layer', ctx)).toBe('red');
  });

  it('revert-layer in first layer falls back to UA', () => {
    const ctx: KeywordContext = {
      parentComputed: null,
      uaDefaults: new Map([['color', '#000000']]),
      cascadeEntries: [
        { property: 'color', value: 'red', important: false, layerIndex: 0, layerName: 'base', sourceOrder: 1 },
      ],
      layerOrder: ['base'],
    };
    expect(resolveCSSWideKeyword('color', 'revert-layer', ctx)).toBe('#000000');
  });

  it('revert-layer with no cascade entries falls back to UA', () => {
    const ctx: KeywordContext = {
      parentComputed: null,
      uaDefaults: new Map([['display', 'block']]),
      cascadeEntries: [],
      layerOrder: [],
    };
    expect(resolveCSSWideKeyword('display', 'revert-layer', ctx)).toBe('block');
  });

  it('revert-layer without layer context falls back to revert behavior', () => {
    const ctx: KeywordContext = {
      parentComputed: null,
      uaDefaults: new Map([['margin', '8px']]),
    };
    expect(resolveCSSWideKeyword('margin', 'revert-layer', ctx)).toBe('8px');
  });

  it('revert-layer across three layers', () => {
    const ctx: KeywordContext = {
      parentComputed: null,
      uaDefaults: new Map([['color', '#000000']]),
      cascadeEntries: [
        { property: 'color', value: 'red', important: false, layerIndex: 0, layerName: 'base', sourceOrder: 1 },
        { property: 'color', value: 'green', important: false, layerIndex: 1, layerName: 'mid', sourceOrder: 2 },
        { property: 'color', value: 'blue', important: false, layerIndex: 2, layerName: 'top', sourceOrder: 3 },
      ],
      layerOrder: ['base', 'mid', 'top'],
    };
    // From top layer, revert-layer should use mid layer's value
    expect(resolveCSSWideKeyword('color', 'revert-layer', ctx)).toBe('green');
  });
});
