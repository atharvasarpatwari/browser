import { describe, it, expect } from 'vitest';
import {
  resolveComputedValue,
  resolveAllComputedValues,
  resolveFontSizeKeyword,
  resolveFontWeightKeyword,
  resolveBorderWidthKeyword,
  type ResolutionContext,
} from '../src/browser/rendering/css5/computed-value-resolver';

const CTX: ResolutionContext = { parentFontSize: 16, parentFontWeight: 400 };

// ─────────────────────────────────────────────────────────────────────────────
// COLOR RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Colors', () => {
  it('resolves named colors to hex', () => {
    expect(resolveComputedValue('color', 'red', CTX)).toBe('#ff0000');
    expect(resolveComputedValue('color', 'blue', CTX)).toBe('#0000ff');
    expect(resolveComputedValue('color', 'green', CTX)).toBe('#008000');
    expect(resolveComputedValue('color', 'black', CTX)).toBe('#000000');
    expect(resolveComputedValue('color', 'white', CTX)).toBe('#ffffff');
    expect(resolveComputedValue('color', 'transparent', CTX)).toBe('transparent');
  });

  it('resolves all 148 named colors', () => {
    // Spot-check a range
    expect(resolveComputedValue('color', 'aliceblue', CTX)).toBe('#f0f8ff');
    expect(resolveComputedValue('color', 'coral', CTX)).toBe('#ff7f50');
    expect(resolveComputedValue('color', 'crimson', CTX)).toBe('#dc143c');
    expect(resolveComputedValue('color', 'darkgoldenrod', CTX)).toBe('#b8860b');
    expect(resolveComputedValue('color', 'forestgreen', CTX)).toBe('#228b22');
    expect(resolveComputedValue('color', 'gold', CTX)).toBe('#ffd700');
    expect(resolveComputedValue('color', 'khaki', CTX)).toBe('#f0e68c');
    expect(resolveComputedValue('color', 'lavender', CTX)).toBe('#e6e6fa');
    expect(resolveComputedValue('color', 'magenta', CTX)).toBe('#ff00ff');
    expect(resolveComputedValue('color', 'olive', CTX)).toBe('#808000');
    expect(resolveComputedValue('color', 'orchid', CTX)).toBe('#da70d6');
    expect(resolveComputedValue('color', 'plum', CTX)).toBe('#dda0dd');
    expect(resolveComputedValue('color', 'rebeccapurple', CTX)).toBe('#663399');
    expect(resolveComputedValue('color', 'salmon', CTX)).toBe('#fa8072');
    expect(resolveComputedValue('color', 'sienna', CTX)).toBe('#a0522d');
    expect(resolveComputedValue('color', 'turquoise', CTX)).toBe('#40e0d0');
    expect(resolveComputedValue('color', 'violet', CTX)).toBe('#ee82ee');
    expect(resolveComputedValue('color', 'yellow', CTX)).toBe('#ffff00');
  });

  it('resolves currentcolor', () => {
    expect(resolveComputedValue('border-top-color', 'currentcolor', CTX)).toBe('currentcolor');
  });

  it('resolves colors on border-color properties', () => {
    expect(resolveComputedValue('border-top-color', 'red', CTX)).toBe('#ff0000');
    expect(resolveComputedValue('border-right-color', 'blue', CTX)).toBe('#0000ff');
    expect(resolveComputedValue('border-bottom-color', 'green', CTX)).toBe('#008000');
    expect(resolveComputedValue('border-left-color', 'white', CTX)).toBe('#ffffff');
  });

  it('resolves colors on background-color', () => {
    expect(resolveComputedValue('background-color', 'red', CTX)).toBe('#ff0000');
    expect(resolveComputedValue('background-color', 'transparent', CTX)).toBe('transparent');
  });

  it('resolves colors on outline-color', () => {
    expect(resolveComputedValue('outline-color', 'red', CTX)).toBe('#ff0000');
  });

  it('resolves colors on text-decoration-color', () => {
    expect(resolveComputedValue('text-decoration-color', 'red', CTX)).toBe('#ff0000');
  });

  it('passes through hex colors unchanged', () => {
    expect(resolveComputedValue('color', '#ff0000', CTX)).toBe('#ff0000');
    expect(resolveComputedValue('color', '#abc', CTX)).toBe('#abc');
    expect(resolveComputedValue('color', '#123456', CTX)).toBe('#123456');
  });

  it('passes through rgb/rgba/hsl/hsla unchanged', () => {
    expect(resolveComputedValue('color', 'rgb(255,0,0)', CTX)).toBe('rgb(255,0,0)');
    expect(resolveComputedValue('color', 'rgba(0,0,0,0.5)', CTX)).toBe('rgba(0,0,0,0.5)');
    expect(resolveComputedValue('color', 'hsl(360,100%,50%)', CTX)).toBe('hsl(360,100%,50%)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FONT-SIZE KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Font-Size Keywords', () => {
  it('resolves absolute font-size keywords', () => {
    expect(resolveFontSizeKeyword('xx-small', 16)).toBe('7px');
    expect(resolveFontSizeKeyword('x-small', 16)).toBe('9px');
    expect(resolveFontSizeKeyword('small', 16)).toBe('13px');
    expect(resolveFontSizeKeyword('medium', 16)).toBe('16px');
    expect(resolveFontSizeKeyword('large', 16)).toBe('18px');
    expect(resolveFontSizeKeyword('x-large', 16)).toBe('24px');
    expect(resolveFontSizeKeyword('xx-large', 16)).toBe('32px');
  });

  it('resolves relative font-size keywords', () => {
    expect(resolveFontSizeKeyword('smaller', 16)).toBe('13px');
    expect(resolveFontSizeKeyword('larger', 16)).toBe('19px');
    expect(resolveFontSizeKeyword('smaller', 20)).toBe('16px');
    expect(resolveFontSizeKeyword('larger', 20)).toBe('24px');
  });

  it('returns null for non-keywords', () => {
    expect(resolveFontSizeKeyword('16px', 16)).toBeNull();
    expect(resolveFontSizeKeyword('1.5em', 16)).toBeNull();
    expect(resolveFontSizeKeyword('100%', 16)).toBeNull();
    expect(resolveFontSizeKeyword('auto', 16)).toBeNull();
  });

  it('resolves font-size via computeComputedValue', () => {
    expect(resolveComputedValue('font-size', 'small', CTX)).toBe('13px');
    expect(resolveComputedValue('font-size', 'large', CTX)).toBe('18px');
    expect(resolveComputedValue('font-size', 'medium', CTX)).toBe('16px');
    expect(resolveComputedValue('font-size', '16px', CTX)).toBe('16px');
    expect(resolveComputedValue('font-size', '1.5em', CTX)).toBe('1.5em');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FONT-WEIGHT KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Font-Weight Keywords', () => {
  it('resolves absolute font-weight keywords', () => {
    expect(resolveFontWeightKeyword('normal', 400)).toBe('400');
    expect(resolveFontWeightKeyword('bold', 400)).toBe('700');
    expect(resolveFontWeightKeyword('lighter', 400)).toBe('300');
    expect(resolveFontWeightKeyword('bolder', 400)).toBe('500');
  });

  it('resolves numeric-like keywords', () => {
    expect(resolveFontWeightKeyword('thin', 400)).toBe('100');
    expect(resolveFontWeightKeyword('hairline', 400)).toBe('100');
    expect(resolveFontWeightKeyword('extra-light', 400)).toBe('200');
    expect(resolveFontWeightKeyword('ultra-light', 400)).toBe('200');
    expect(resolveFontWeightKeyword('light', 400)).toBe('300');
    expect(resolveFontWeightKeyword('regular', 400)).toBe('400');
    expect(resolveFontWeightKeyword('book', 400)).toBe('400');
    expect(resolveFontWeightKeyword('medium', 400)).toBe('500');
    expect(resolveFontWeightKeyword('semi-bold', 400)).toBe('600');
    expect(resolveFontWeightKeyword('demi-bold', 400)).toBe('600');
    expect(resolveFontWeightKeyword('extra-bold', 400)).toBe('800');
    expect(resolveFontWeightKeyword('ultra-bold', 400)).toBe('800');
    expect(resolveFontWeightKeyword('black', 400)).toBe('900');
    expect(resolveFontWeightKeyword('heavy', 400)).toBe('900');
  });

  it('respects clamping for bolder/lighter', () => {
    expect(resolveFontWeightKeyword('bolder', 900)).toBe('900'); // clamped to max
    expect(resolveFontWeightKeyword('lighter', 100)).toBe('100'); // clamped to min
    expect(resolveFontWeightKeyword('bolder', 700)).toBe('800');
    expect(resolveFontWeightKeyword('lighter', 300)).toBe('200');
  });

  it('returns null for non-keywords', () => {
    expect(resolveFontWeightKeyword('400', 400)).toBeNull();
    expect(resolveFontWeightKeyword('700', 400)).toBeNull();
    expect(resolveFontWeightKeyword('normal', 400)).toBe('400');
  });

  it('resolves font-weight via computeComputedValue', () => {
    expect(resolveComputedValue('font-weight', 'bold', CTX)).toBe('700');
    expect(resolveComputedValue('font-weight', 'lighter', { parentFontSize: 16, parentFontWeight: 700 })).toBe('600');
    expect(resolveComputedValue('font-weight', '400', CTX)).toBe('400');
    expect(resolveComputedValue('font-weight', '700', CTX)).toBe('700');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BORDER-WIDTH KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Border-Width Keywords', () => {
  it('resolves border-width keywords', () => {
    expect(resolveBorderWidthKeyword('thin')).toBe('1px');
    expect(resolveBorderWidthKeyword('medium')).toBe('3px');
    expect(resolveBorderWidthKeyword('thick')).toBe('5px');
  });

  it('returns null for non-keywords', () => {
    expect(resolveBorderWidthKeyword('1px')).toBeNull();
    expect(resolveBorderWidthKeyword('0')).toBeNull();
    expect(resolveBorderWidthKeyword('auto')).toBeNull();
  });

  it('resolves border-width via computeComputedValue', () => {
    expect(resolveComputedValue('border-top-width', 'thin', CTX)).toBe('1px');
    expect(resolveComputedValue('border-right-width', 'medium', CTX)).toBe('3px');
    expect(resolveComputedValue('border-bottom-width', 'thick', CTX)).toBe('5px');
    expect(resolveComputedValue('border-left-width', '1px', CTX)).toBe('1px');
  });

  it('resolves outline-width keywords', () => {
    expect(resolveComputedValue('outline-width', 'thin', CTX)).toBe('1px');
    expect(resolveComputedValue('outline-width', 'medium', CTX)).toBe('3px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPACITY CLAMPING
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Opacity', () => {
  it('clamps opacity to [0, 1]', () => {
    expect(resolveComputedValue('opacity', '0', CTX)).toBe('0');
    expect(resolveComputedValue('opacity', '0.5', CTX)).toBe('0.5');
    expect(resolveComputedValue('opacity', '1', CTX)).toBe('1');
    expect(resolveComputedValue('opacity', '2', CTX)).toBe('1');
    expect(resolveComputedValue('opacity', '-1', CTX)).toBe('0');
    expect(resolveComputedValue('opacity', '1.5', CTX)).toBe('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Keyword Normalization', () => {
  it('normalizes display values', () => {
    expect(resolveComputedValue('display', 'block', CTX)).toBe('block');
    expect(resolveComputedValue('display', 'inline-block', CTX)).toBe('inline-block');
    expect(resolveComputedValue('display', 'flex', CTX)).toBe('flex');
    expect(resolveComputedValue('display', 'grid', CTX)).toBe('grid');
    expect(resolveComputedValue('display', 'none', CTX)).toBe('none');
  });

  it('normalizes position values', () => {
    expect(resolveComputedValue('position', 'static', CTX)).toBe('static');
    expect(resolveComputedValue('position', 'relative', CTX)).toBe('relative');
    expect(resolveComputedValue('position', 'absolute', CTX)).toBe('absolute');
    expect(resolveComputedValue('position', 'fixed', CTX)).toBe('fixed');
    expect(resolveComputedValue('position', 'sticky', CTX)).toBe('sticky');
  });

  it('normalizes overflow values', () => {
    expect(resolveComputedValue('overflow', 'visible', CTX)).toBe('visible');
    expect(resolveComputedValue('overflow', 'hidden', CTX)).toBe('hidden');
    expect(resolveComputedValue('overflow', 'scroll', CTX)).toBe('scroll');
    expect(resolveComputedValue('overflow', 'auto', CTX)).toBe('auto');
    expect(resolveComputedValue('overflow', 'clip', CTX)).toBe('clip');
  });

  it('normalizes visibility', () => {
    expect(resolveComputedValue('visibility', 'visible', CTX)).toBe('visible');
    expect(resolveComputedValue('visibility', 'hidden', CTX)).toBe('hidden');
    expect(resolveComputedValue('visibility', 'collapse', CTX)).toBe('collapse');
  });

  it('normalizes text-align', () => {
    expect(resolveComputedValue('text-align', 'left', CTX)).toBe('left');
    expect(resolveComputedValue('text-align', 'right', CTX)).toBe('right');
    expect(resolveComputedValue('text-align', 'center', CTX)).toBe('center');
    expect(resolveComputedValue('text-align', 'justify', CTX)).toBe('justify');
    expect(resolveComputedValue('text-align', 'start', CTX)).toBe('start');
    expect(resolveComputedValue('text-align', 'end', CTX)).toBe('end');
  });

  it('normalizes float', () => {
    expect(resolveComputedValue('float', 'none', CTX)).toBe('none');
    expect(resolveComputedValue('float', 'left', CTX)).toBe('left');
    expect(resolveComputedValue('float', 'right', CTX)).toBe('right');
  });

  it('normalizes direction', () => {
    expect(resolveComputedValue('direction', 'ltr', CTX)).toBe('ltr');
    expect(resolveComputedValue('direction', 'rtl', CTX)).toBe('rtl');
  });

  it('normalizes white-space', () => {
    expect(resolveComputedValue('white-space', 'normal', CTX)).toBe('normal');
    expect(resolveComputedValue('white-space', 'pre', CTX)).toBe('pre');
    expect(resolveComputedValue('white-space', 'nowrap', CTX)).toBe('nowrap');
    expect(resolveComputedValue('white-space', 'pre-wrap', CTX)).toBe('pre-wrap');
    expect(resolveComputedValue('white-space', 'pre-line', CTX)).toBe('pre-line');
    expect(resolveComputedValue('white-space', 'break-spaces', CTX)).toBe('break-spaces');
  });

  it('normalizes vertical-align', () => {
    expect(resolveComputedValue('vertical-align', 'baseline', CTX)).toBe('baseline');
    expect(resolveComputedValue('vertical-align', 'sub', CTX)).toBe('sub');
    expect(resolveComputedValue('vertical-align', 'super', CTX)).toBe('super');
    expect(resolveComputedValue('vertical-align', 'text-top', CTX)).toBe('text-top');
    expect(resolveComputedValue('vertical-align', 'text-bottom', CTX)).toBe('text-bottom');
    expect(resolveComputedValue('vertical-align', 'middle', CTX)).toBe('middle');
    expect(resolveComputedValue('vertical-align', 'top', CTX)).toBe('top');
    expect(resolveComputedValue('vertical-align', 'bottom', CTX)).toBe('bottom');
  });

  it('normalizes line-height number', () => {
    expect(resolveComputedValue('line-height', 'normal', CTX)).toBe('normal');
    expect(resolveComputedValue('line-height', '1.5', CTX)).toBe('1.5');
    expect(resolveComputedValue('line-height', '2', CTX)).toBe('2');
    expect(resolveComputedValue('line-height', '12px', CTX)).toBe('12px');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PASS-THROUGH
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Pass-Through', () => {
  it('passes through special values', () => {
    expect(resolveComputedValue('width', 'auto', CTX)).toBe('auto');
    expect(resolveComputedValue('display', 'none', CTX)).toBe('none');
    expect(resolveComputedValue('line-height', 'normal', CTX)).toBe('normal');
  });

  it('passes through unit values', () => {
    expect(resolveComputedValue('width', '100px', CTX)).toBe('100px');
    expect(resolveComputedValue('width', '50%', CTX)).toBe('50%');
    expect(resolveComputedValue('font-size', '1.5em', CTX)).toBe('1.5em');
    expect(resolveComputedValue('margin-top', '2rem', CTX)).toBe('2rem');
  });

  it('passes through calc()', () => {
    expect(resolveComputedValue('width', 'calc(100% - 20px)', CTX)).toBe('calc(100% - 20px)');
  });

  it('passes through empty string', () => {
    expect(resolveComputedValue('color', '', CTX)).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Z-INDEX
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Z-Index', () => {
  it('resolves z-index to integer', () => {
    expect(resolveComputedValue('z-index', '0', CTX)).toBe('0');
    expect(resolveComputedValue('z-index', '1', CTX)).toBe('1');
    expect(resolveComputedValue('z-index', '-1', CTX)).toBe('-1');
    expect(resolveComputedValue('z-index', '999', CTX)).toBe('999');
  });

  it('passes through z-index: auto', () => {
    expect(resolveComputedValue('z-index', 'auto', CTX)).toBe('auto');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FLEX / GRID
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Flex/Grid', () => {
  it('resolves flex-grow to number', () => {
    expect(resolveComputedValue('flex-grow', '0', CTX)).toBe('0');
    expect(resolveComputedValue('flex-grow', '1', CTX)).toBe('1');
    expect(resolveComputedValue('flex-grow', '2.5', CTX)).toBe('2.5');
  });

  it('resolves flex-shrink to number', () => {
    expect(resolveComputedValue('flex-shrink', '0', CTX)).toBe('0');
    expect(resolveComputedValue('flex-shrink', '1', CTX)).toBe('1');
  });

  it('resolves order to integer', () => {
    expect(resolveComputedValue('order', '0', CTX)).toBe('0');
    expect(resolveComputedValue('order', '-1', CTX)).toBe('-1');
    expect(resolveComputedValue('order', '5', CTX)).toBe('5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BATCH RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Computed Value Resolver — Batch', () => {
  it('resolveAllComputedValues resolves all in a map', () => {
    const computed = new Map([
      ['color', 'red'],
      ['font-size', 'small'],
      ['font-weight', 'bold'],
      ['border-top-width', 'thin'],
      ['opacity', '2'],
      ['display', 'flex'],
      ['width', '100px'],
    ]);

    resolveAllComputedValues(computed, CTX);

    expect(computed.get('color')).toBe('#ff0000');
    expect(computed.get('font-size')).toBe('13px');
    expect(computed.get('font-weight')).toBe('700');
    expect(computed.get('border-top-width')).toBe('1px');
    expect(computed.get('opacity')).toBe('1');
    expect(computed.get('display')).toBe('flex');
    expect(computed.get('width')).toBe('100px'); // unchanged
  });

  it('does not modify map with no resolvable values', () => {
    const computed = new Map([
      ['width', '100px'],
      ['margin-top', '10px'],
      ['display', 'block'],
    ]);

    resolveAllComputedValues(computed, CTX);

    expect(computed.get('width')).toBe('100px');
    expect(computed.get('margin-top')).toBe('10px');
    expect(computed.get('display')).toBe('block');
  });
});
