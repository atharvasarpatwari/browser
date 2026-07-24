import { describe, it, expect } from 'vitest';
import {
  isInheritedProperty,
  getInitialValue,
  isShorthandProperty,
  getLonghands,
  isCSSWideKeyword,
  getInheritedProperties,
  getAllPropertyDefinitions,
} from '../src/browser/rendering/css5/property-definitions';

// ─────────────────────────────────────────────────────────────────────────────
// INHERITANCE
// ─────────────────────────────────────────────────────────────────────────────

describe('Property Definitions — Inheritance', () => {
  it('recognizes inherited properties', () => {
    expect(isInheritedProperty('color')).toBe(true);
    expect(isInheritedProperty('font-size')).toBe(true);
    expect(isInheritedProperty('font-family')).toBe(true);
    expect(isInheritedProperty('font-weight')).toBe(true);
    expect(isInheritedProperty('line-height')).toBe(true);
    expect(isInheritedProperty('text-align')).toBe(true);
    expect(isInheritedProperty('visibility')).toBe(true);
    expect(isInheritedProperty('cursor')).toBe(true);
    expect(isInheritedProperty('direction')).toBe(true);
    expect(isInheritedProperty('white-space')).toBe(true);
    expect(isInheritedProperty('list-style-type')).toBe(true);
    expect(isInheritedProperty('border-collapse')).toBe(true);
    expect(isInheritedProperty('border-spacing')).toBe(true);
    expect(isInheritedProperty('caption-side')).toBe(true);
    expect(isInheritedProperty('empty-cells')).toBe(true);
    expect(isInheritedProperty('table-layout')).toBe(true);
    expect(isInheritedProperty('vertical-align')).toBe(true);
    expect(isInheritedProperty('orphans')).toBe(true);
    expect(isInheritedProperty('widows')).toBe(true);
    expect(isInheritedProperty('quotes')).toBe(true);
    expect(isInheritedProperty('color-scheme')).toBe(true);
    expect(isInheritedProperty('accent-color')).toBe(true);
  });

  it('recognizes non-inherited properties', () => {
    expect(isInheritedProperty('display')).toBe(false);
    expect(isInheritedProperty('position')).toBe(false);
    expect(isInheritedProperty('margin-top')).toBe(false);
    expect(isInheritedProperty('padding-left')).toBe(false);
    expect(isInheritedProperty('width')).toBe(false);
    expect(isInheritedProperty('height')).toBe(false);
    expect(isInheritedProperty('border-top-width')).toBe(false);
    expect(isInheritedProperty('opacity')).toBe(false);
    expect(isInheritedProperty('z-index')).toBe(false);
    expect(isInheritedProperty('float')).toBe(false);
    expect(isInheritedProperty('overflow')).toBe(false);
    expect(isInheritedProperty('background-color')).toBe(false);
    expect(isInheritedProperty('top')).toBe(false);
    expect(isInheritedProperty('transform')).toBe(false);
    expect(isInheritedProperty('filter')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isInheritedProperty('Color')).toBe(true);
    expect(isInheritedProperty('COLOR')).toBe(true);
    expect(isInheritedProperty('Font-Size')).toBe(true);
    expect(isInheritedProperty('DISPLAY')).toBe(false);
  });

  it('returns correct count of inherited properties', () => {
    const inherited = getInheritedProperties();
    expect(inherited.length).toBeGreaterThanOrEqual(30);
    // All should be inherited
    for (const prop of inherited) {
      expect(isInheritedProperty(prop)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INITIAL VALUES
// ─────────────────────────────────────────────────────────────────────────────

describe('Property Definitions — Initial Values', () => {
  it('returns correct initial values for display properties', () => {
    expect(getInitialValue('display')).toBe('inline');
    expect(getInitialValue('position')).toBe('static');
    expect(getInitialValue('float')).toBe('none');
    expect(getInitialValue('clear')).toBe('none');
  });

  it('returns correct initial values for box model', () => {
    expect(getInitialValue('margin-top')).toBe('0');
    expect(getInitialValue('margin-right')).toBe('0');
    expect(getInitialValue('padding-left')).toBe('0');
    expect(getInitialValue('width')).toBe('auto');
    expect(getInitialValue('height')).toBe('auto');
    expect(getInitialValue('box-sizing')).toBe('content-box');
  });

  it('returns correct initial values for borders', () => {
    expect(getInitialValue('border-top-width')).toBe('medium');
    expect(getInitialValue('border-top-style')).toBe('none');
    expect(getInitialValue('border-top-color')).toBe('currentcolor');
    expect(getInitialValue('border-collapse')).toBe('separate');
    expect(getInitialValue('border-spacing')).toBe('0');
  });

  it('returns correct initial values for typography', () => {
    expect(getInitialValue('color')).toBe('canvastext');
    expect(getInitialValue('font-family')).toBe('sans-serif');
    expect(getInitialValue('font-size')).toBe('medium');
    expect(getInitialValue('font-weight')).toBe('normal');
    expect(getInitialValue('font-style')).toBe('normal');
    expect(getInitialValue('line-height')).toBe('normal');
    expect(getInitialValue('text-align')).toBe('start');
    expect(getInitialValue('text-decoration')).toBe('none solid currentcolor');
    expect(getInitialValue('text-transform')).toBe('none');
    expect(getInitialValue('white-space')).toBe('normal');
    expect(getInitialValue('direction')).toBe('ltr');
    expect(getInitialValue('letter-spacing')).toBe('normal');
    expect(getInitialValue('word-spacing')).toBe('normal');
  });

  it('returns correct initial values for lists', () => {
    expect(getInitialValue('list-style-type')).toBe('disc');
    expect(getInitialValue('list-style-position')).toBe('outside');
    expect(getInitialValue('list-style-image')).toBe('none');
  });

  it('returns correct initial values for flexbox', () => {
    expect(getInitialValue('flex-direction')).toBe('row');
    expect(getInitialValue('flex-wrap')).toBe('nowrap');
    expect(getInitialValue('flex-grow')).toBe('0');
    expect(getInitialValue('flex-shrink')).toBe('1');
    expect(getInitialValue('flex-basis')).toBe('auto');
    expect(getInitialValue('justify-content')).toBe('stretch');
    expect(getInitialValue('align-items')).toBe('stretch');
    expect(getInitialValue('align-self')).toBe('auto');
    expect(getInitialValue('order')).toBe('0');
  });

  it('returns correct initial values for grid', () => {
    expect(getInitialValue('grid-template-columns')).toBe('none');
    expect(getInitialValue('grid-template-rows')).toBe('none');
    expect(getInitialValue('grid-auto-flow')).toBe('row');
    expect(getInitialValue('grid-column')).toBe('auto');
    expect(getInitialValue('grid-row')).toBe('auto');
  });

  it('returns correct initial values for overflow/visibility', () => {
    expect(getInitialValue('overflow')).toBe('visible');
    expect(getInitialValue('overflow-x')).toBe('visible');
    expect(getInitialValue('visibility')).toBe('visible');
    expect(getInitialValue('opacity')).toBe('1');
    expect(getInitialValue('z-index')).toBe('auto');
  });

  it('returns "initial" for unknown properties', () => {
    expect(getInitialValue('nonexistent')).toBe('initial');
    expect(getInitialValue('fake-prop')).toBe('initial');
  });

  it('is case-insensitive', () => {
    expect(getInitialValue('Display')).toBe('inline');
    expect(getInitialValue('COLOR')).toBe('canvastext');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHORTHANDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Property Definitions — Shorthands', () => {
  it('recognizes standard shorthands', () => {
    expect(isShorthandProperty('margin')).toBe(true);
    expect(isShorthandProperty('padding')).toBe(true);
    expect(isShorthandProperty('border')).toBe(true);
    expect(isShorthandProperty('border-width')).toBe(true);
    expect(isShorthandProperty('border-style')).toBe(true);
    expect(isShorthandProperty('border-color')).toBe(true);
    expect(isShorthandProperty('border-radius')).toBe(true);
    expect(isShorthandProperty('background')).toBe(true);
    expect(isShorthandProperty('font')).toBe(true);
    expect(isShorthandProperty('list-style')).toBe(true);
    expect(isShorthandProperty('flex')).toBe(true);
    expect(isShorthandProperty('overflow')).toBe(true);
    expect(isShorthandProperty('transition')).toBe(true);
    expect(isShorthandProperty('gap')).toBe(true);
  });

  it('recognizes non-shorthands', () => {
    expect(isShorthandProperty('color')).toBe(false);
    expect(isShorthandProperty('display')).toBe(false);
    expect(isShorthandProperty('margin-top')).toBe(false);
    expect(isShorthandProperty('font-size')).toBe(false);
    expect(isShorthandProperty('width')).toBe(false);
  });

  it('returns longhands for margin', () => {
    const longhands = getLonghands('margin');
    expect(longhands).toEqual(['margin-top', 'margin-right', 'margin-bottom', 'margin-left']);
  });

  it('returns longhands for padding', () => {
    const longhands = getLonghands('padding');
    expect(longhands).toEqual(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
  });

  it('returns longhands for border', () => {
    const longhands = getLonghands('border');
    expect(longhands).toEqual(['border-width', 'border-style', 'border-color']);
  });

  it('returns longhands for font', () => {
    const longhands = getLonghands('font');
    expect(longhands).toEqual(['font-style', 'font-variant', 'font-weight', 'font-size', 'line-height', 'font-family']);
  });

  it('returns longhands for flex', () => {
    const longhands = getLonghands('flex');
    expect(longhands).toEqual(['flex-grow', 'flex-shrink', 'flex-basis']);
  });

  it('returns empty array for non-shorthands', () => {
    expect(getLonghands('color')).toEqual([]);
    expect(getLonghands('width')).toEqual([]);
    expect(getLonghands('display')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CSS-WIDE KEYWORD DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Property Definitions — CSS-Wide Keyword Detection', () => {
  it('detects CSS-wide keywords', () => {
    expect(isCSSWideKeyword('inherit')).toBe(true);
    expect(isCSSWideKeyword('initial')).toBe(true);
    expect(isCSSWideKeyword('unset')).toBe(true);
    expect(isCSSWideKeyword('revert')).toBe(true);
    expect(isCSSWideKeyword('revert-layer')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isCSSWideKeyword('Inherit')).toBe(true);
    expect(isCSSWideKeyword('INITIAL')).toBe(true);
    expect(isCSSWideKeyword('Unset')).toBe(true);
    expect(isCSSWideKeyword('Revert')).toBe(true);
  });

  it('rejects non-keywords', () => {
    expect(isCSSWideKeyword('red')).toBe(false);
    expect(isCSSWideKeyword('16px')).toBe(false);
    expect(isCSSWideKeyword('auto')).toBe(false);
    expect(isCSSWideKeyword('none')).toBe(false);
    expect(isCSSWideKeyword('normal')).toBe(false);
    expect(isCSSWideKeyword('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ALL PROPERTIES
// ─────────────────────────────────────────────────────────────────────────────

describe('Property Definitions — All Properties', () => {
  it('contains a substantial number of properties', () => {
    const defs = getAllPropertyDefinitions();
    expect(Object.keys(defs).length).toBeGreaterThanOrEqual(100);
  });

  it('every property has an initial value', () => {
    const defs = getAllPropertyDefinitions();
    for (const [prop, def] of Object.entries(defs)) {
      expect(def.initialValue).toBeDefined();
      expect(typeof def.initialValue).toBe('string');
      expect(def.initialValue.length).toBeGreaterThan(0);
    }
  });

  it('every property has an inherited flag', () => {
    const defs = getAllPropertyDefinitions();
    for (const [prop, def] of Object.entries(defs)) {
      expect(typeof def.inherited).toBe('boolean');
    }
  });
});
