import { describe, it, expect } from 'vitest';
import {
  classifyDisplay,
  isBlockLevel,
  classifyChildren,
  collapseMargins,
  isMarginCollapseBlocked,
  InlineFormattingContext,
  resolveVerticalAlign,
  resolveBoxModel,
  type InlineLevelBox,
} from '../src/browser/rendering/formatting/index';
import { FloatContext } from '../src/browser/rendering/formatting/float-context';
import type { DomNode, DomElement, DomTextNode } from '../src/browser/rendering/dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function textNode(text: string): DomTextNode {
  return { domId: `t-${text}`, nodeType: 'text' as const, parent: null, children: [], text, _dirtyStyle: true, _dirtyLayout: true, _dirtyPaint: true };
}

function elem(tagName: string, display?: string): DomElement {
  const style = new Map<string, string>();
  if (display) style.set('display', display);
  return {
    domId: `e-${tagName}-${Math.random().toString(36).slice(2, 6)}`,
    nodeType: 'element' as const,
    parent: null,
    children: [],
    tagName,
    attributes: new Map(),
    computedStyle: style,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    usedStyle: null,
    willChange: null,
    _dirtyStyle: true,
    _dirtyLayout: true,
    _dirtyPaint: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// classifyDisplay / isBlockLevel
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyDisplay', () => {
  it('should classify block-level displays as block', () => {
    expect(classifyDisplay('block')).toBe('block');
    expect(classifyDisplay('flow-root')).toBe('block');
  });

  it('should classify table displays as table', () => {
    expect(classifyDisplay('table')).toBe('table');
    expect(classifyDisplay('inline-table')).toBe('table');
    expect(classifyDisplay('table-row')).toBe('table');
    expect(classifyDisplay('table-cell')).toBe('table');
  });

  it('should classify list-item as block', () => {
    expect(classifyDisplay('list-item')).toBe('block');
  });

  it('should classify inline-block as inline-block', () => {
    expect(classifyDisplay('inline-block')).toBe('inline-block');
  });

  it('should classify flex as flex', () => {
    expect(classifyDisplay('flex')).toBe('flex');
    expect(classifyDisplay('inline-flex')).toBe('inline-flex');
  });

  it('should classify grid as grid', () => {
    expect(classifyDisplay('grid')).toBe('grid');
    expect(classifyDisplay('inline-grid')).toBe('inline-grid');
  });

  it('should classify none as none', () => {
    expect(classifyDisplay('none')).toBe('none');
  });

  it('should default unknown values to inline', () => {
    expect(classifyDisplay('inline')).toBe('inline');
    expect(classifyDisplay('ruby')).toBe('inline');
    expect(classifyDisplay('run-in')).toBe('inline');
  });
});

describe('isBlockLevel', () => {
  it('should return true for block-level displays', () => {
    expect(isBlockLevel('block')).toBe(true);
    expect(isBlockLevel('flex')).toBe(true);
    expect(isBlockLevel('grid')).toBe(true);
    expect(isBlockLevel('list-item')).toBe(true);
    expect(isBlockLevel('inline-block')).toBe(true);
    expect(isBlockLevel('table')).toBe(true);
  });

  it('should return false for inline displays', () => {
    expect(isBlockLevel('inline')).toBe(false);
    expect(isBlockLevel('none')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyChildren — anonymous block generation
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyChildren', () => {
  it('should group contiguous block children into one group', () => {
    const children: DomNode[] = [
      elem('div', 'block'),
      elem('p', 'block'),
      elem('span', 'block'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(1);
    expect(groups[0]!.length).toBe(3);
  });

  it('should group contiguous inline children into one group', () => {
    const children: DomNode[] = [
      textNode('hello'),
      textNode(' '),
      textNode('world'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(1);
    expect(groups[0]!.length).toBe(3);
  });

  it('should wrap inline children between blocks as anonymous blocks', () => {
    const children: DomNode[] = [
      elem('div', 'block'),
      textNode('inline text'),
      elem('p', 'block'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(3);
    // First group: block (div)
    expect(groups[0]!.length).toBe(1);
    expect(groups[0]![0]!.isBlock).toBe(true);
    // Second group: anonymous inline block
    expect(groups[1]!.length).toBe(1);
    expect(groups[1]![0]!.isBlock).toBe(false);
    // Third group: block (p)
    expect(groups[2]!.length).toBe(1);
    expect(groups[2]![0]!.isBlock).toBe(true);
  });

  it('should handle text nodes at the start', () => {
    const children: DomNode[] = [
      textNode('before'),
      elem('div', 'block'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(2);
    expect(groups[0]![0]!.isBlock).toBe(false);
    expect(groups[1]![0]!.isBlock).toBe(true);
  });

  it('should handle text nodes at the end', () => {
    const children: DomNode[] = [
      elem('div', 'block'),
      textNode('after'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(2);
    expect(groups[0]![0]!.isBlock).toBe(true);
    expect(groups[1]![0]!.isBlock).toBe(false);
  });

  it('should handle mixed block and inline alternation', () => {
    const children: DomNode[] = [
      elem('div', 'block'),
      textNode('a'),
      elem('p', 'block'),
      textNode('b'),
    ];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(4);
  });

  it('should treat elements without computedStyle as inline', () => {
    const el = elem('span');
    el.computedStyle = null;
    const groups = classifyChildren([el]);
    expect(groups.length).toBe(1);
    expect(groups[0]![0]!.display).toBe('inline');
  });

  it('should handle empty children list', () => {
    const groups = classifyChildren([]);
    expect(groups.length).toBe(0);
  });

  it('should skip non-element, non-text nodes', () => {
    const comment = { domId: 'c1', nodeType: 'comment' as const, parent: null, children: [], text: '', _dirtyStyle: true, _dirtyLayout: true, _dirtyPaint: true };
    const children: DomNode[] = [comment, elem('div', 'block')];
    const groups = classifyChildren(children);
    expect(groups.length).toBe(1);
    expect(groups[0]![0]!.isBlock).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Margin collapsing
// ─────────────────────────────────────────────────────────────────────────────

describe('collapseMargins', () => {
  it('should take the larger of two positive margins', () => {
    expect(collapseMargins(10, 20)).toBe(20);
    expect(collapseMargins(20, 10)).toBe(20);
  });

  it('should take the larger of equal positive margins', () => {
    expect(collapseMargins(15, 15)).toBe(15);
  });

  it('should take the more negative of two negative margins', () => {
    expect(collapseMargins(-5, -10)).toBe(-10);
    expect(collapseMargins(-10, -5)).toBe(-10);
  });

  it('should subtract absolute values when one is negative', () => {
    expect(collapseMargins(20, -5)).toBe(15);
    expect(collapseMargins(-5, 20)).toBe(15);
  });

  it('should handle zero margins', () => {
    expect(collapseMargins(0, 10)).toBe(10);
    expect(collapseMargins(10, 0)).toBe(10);
    expect(collapseMargins(0, 0)).toBe(0);
  });

  it('should handle mixed zero and negative', () => {
    expect(collapseMargins(0, -5)).toBe(-5);
    expect(collapseMargins(-5, 0)).toBe(-5);
  });
});

describe('isMarginCollapseBlocked', () => {
  it('should be blocked when parent has top border', () => {
    expect(isMarginCollapseBlocked(1, 0, 0, 0, 'top')).toBe(true);
  });

  it('should be blocked when parent has top padding', () => {
    expect(isMarginCollapseBlocked(0, 0, 1, 0, 'top')).toBe(true);
  });

  it('should not be blocked with zero top border and padding', () => {
    expect(isMarginCollapseBlocked(0, 0, 0, 0, 'top')).toBe(false);
  });

  it('should be blocked when parent has bottom border', () => {
    expect(isMarginCollapseBlocked(0, 1, 0, 0, 'bottom')).toBe(true);
  });

  it('should be blocked when parent has bottom padding', () => {
    expect(isMarginCollapseBlocked(0, 0, 0, 1, 'bottom')).toBe(true);
  });

  it('should not be blocked with zero bottom border and padding', () => {
    expect(isMarginCollapseBlocked(0, 0, 0, 0, 'bottom')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// InlineFormattingContext — line boxes
// ─────────────────────────────────────────────────────────────────────────────

describe('InlineFormattingContext', () => {
  it('should create an initial line box at startY', () => {
    const ctx = new InlineFormattingContext(800, 0);
    expect(ctx.lineBoxes.length).toBe(1);
    expect(ctx.lineBoxes[0]!.y).toBe(0);
  });

  it('should add a box to the current line', () => {
    const ctx = new InlineFormattingContext(800, 0);
    const box: InlineLevelBox = {
      element: null,
      box: { x: 0, y: 0, width: 100, height: 20, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 },
      baselineOffset: 16,
      isAnonymous: true,
      textContent: 'test',
    };
    ctx.addBox(box);
    expect(ctx.lineBoxes[0]!.boxes.length).toBe(1);
    expect(ctx.lineBoxes[0]!.usedWidth).toBe(100);
  });

  it('should wrap to a new line when box does not fit', () => {
    const ctx = new InlineFormattingContext(200, 0);
    const box1: InlineLevelBox = {
      element: null,
      box: { x: 0, y: 0, width: 150, height: 20, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 },
      baselineOffset: 16,
      isAnonymous: true,
    };
    const box2: InlineLevelBox = {
      element: null,
      box: { x: 0, y: 0, width: 100, height: 20, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 },
      baselineOffset: 16,
      isAnonymous: true,
    };
    ctx.addBox(box1);
    ctx.addBox(box2);
    expect(ctx.lineBoxes.length).toBe(2);
  });

  it('should compute total height via finalize()', () => {
    const ctx = new InlineFormattingContext(800, 10);
    const box: InlineLevelBox = {
      element: null,
      box: { x: 0, y: 0, width: 50, height: 20, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 },
      baselineOffset: 16,
      isAnonymous: true,
    };
    ctx.addBox(box);
    const totalHeight = ctx.finalize();
    expect(totalHeight).toBeGreaterThanOrEqual(20);
    expect(ctx.getEndY()).toBe(10 + totalHeight);
  });

  it('should return total height via getTotalHeight()', () => {
    const ctx = new InlineFormattingContext(800, 0);
    const h = ctx.getTotalHeight();
    expect(h).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveVerticalAlign
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveVerticalAlign', () => {
  it('should default to baseline offset', () => {
    expect(resolveVerticalAlign(undefined, 16, 24)).toBe(16 * 0.8);
  });

  it('should resolve baseline', () => {
    expect(resolveVerticalAlign('baseline', 16, 24)).toBe(16 * 0.8);
  });

  it('should resolve top', () => {
    expect(resolveVerticalAlign('top', 16, 24)).toBe(24);
  });

  it('should resolve bottom', () => {
    expect(resolveVerticalAlign('bottom', 16, 24)).toBe(0);
  });

  it('should resolve middle', () => {
    expect(resolveVerticalAlign('middle', 16, 24)).toBe(12);
  });

  it('should resolve sub', () => {
    expect(resolveVerticalAlign('sub', 16, 24)).toBe(16 * 0.4);
  });

  it('should resolve super', () => {
    expect(resolveVerticalAlign('super', 16, 24)).toBe(16 * 1.2);
  });

  it('should resolve text-top', () => {
    expect(resolveVerticalAlign('text-top', 16, 24)).toBe(16);
  });

  it('should resolve text-bottom', () => {
    expect(resolveVerticalAlign('text-bottom', 16, 24)).toBe(24 - 16);
  });

  it('should resolve percentage values', () => {
    expect(resolveVerticalAlign('50%', 16, 24)).toBe(12);
  });

  it('should resolve px values', () => {
    expect(resolveVerticalAlign('10px', 16, 24)).toBe(10);
  });

  it('should resolve em values', () => {
    expect(resolveVerticalAlign('2em', 16, 24)).toBe(32);
  });

  it('should fallback for unknown keywords', () => {
    expect(resolveVerticalAlign('unknown', 16, 24)).toBe(16 * 0.8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveBoxModel
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveBoxModel', () => {
  const resolveLength = (v: string, _fs: number, _cw: number) => parseFloat(v) || 0;
  const parseBorderWidth = (v: string) => {
    if (v === 'thin') return 1;
    if (v === 'medium') return 3;
    if (v === 'thick') return 5;
    return parseFloat(v) || 0;
  };

  it('should compute default box model with no styles', () => {
    const result = resolveBoxModel(new Map(), resolveLength, parseBorderWidth, 16, 800);
    expect(result.margins.top).toBe(0);
    expect(result.padding.top).toBe(0);
    expect(result.borders.top).toBe(0);
    expect(result.borderWidthBox).toBe(800);
    expect(result.contentWidth).toBe(800);
  });

  it('should resolve margins from shorthand', () => {
    const style = new Map([['margin', '10']]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    expect(result.margins.top).toBe(10);
    expect(result.margins.left).toBe(10);
  });

  it('should resolve individual margin properties over shorthand', () => {
    const style = new Map([['margin', '10'], ['margin-left', '20']]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    expect(result.margins.left).toBe(20);
    expect(result.margins.top).toBe(10);
  });

  it('should resolve padding', () => {
    const style = new Map([['padding', '8']]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    expect(result.padding.top).toBe(8);
    expect(result.padding.right).toBe(8);
  });

  it('should resolve borders', () => {
    const style = new Map([
      ['border-top-width', '2'],
      ['border-right-width', '3'],
      ['border-bottom-width', '4'],
      ['border-left-width', '5'],
    ]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    expect(result.borders.top).toBe(2);
    expect(result.borders.right).toBe(3);
    expect(result.borders.bottom).toBe(4);
    expect(result.borders.left).toBe(5);
  });

  it('should use content-box sizing by default', () => {
    const style = new Map([
      ['width', '200'],
      ['padding-left', '10'],
      ['padding-right', '10'],
      ['border-left-width', '2'],
      ['border-right-width', '2'],
    ]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    // content-box: borderWidthBox = 200 + 10 + 10 + 2 + 2 = 224
    expect(result.borderWidthBox).toBe(224);
    expect(result.contentWidth).toBe(200);
    expect(result.boxSizing).toBe('content-box');
  });

  it('should use border-box sizing', () => {
    const style = new Map([
      ['width', '200'],
      ['padding-left', '10'],
      ['padding-right', '10'],
      ['border-left-width', '2'],
      ['border-right-width', '2'],
      ['box-sizing', 'border-box'],
    ]);
    const result = resolveBoxModel(style, resolveLength, parseBorderWidth, 16, 800);
    expect(result.borderWidthBox).toBe(200);
    expect(result.contentWidth).toBe(176);
    expect(result.boxSizing).toBe('border-box');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FloatContext
// ─────────────────────────────────────────────────────────────────────────────

describe('FloatContext', () => {
  function makeBox(w: number, h: number) {
    return {
      x: 0, y: 0, width: w, height: h,
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    };
  }

  it('should place a left float at the left edge', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(100, 50);
    const result = ctx.placeFloat(box, 'left', 0);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(0);
    expect(result!.y).toBe(0);
  });

  it('should place a right float at the right edge', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(100, 50);
    const result = ctx.placeFloat(box, 'right', 0);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(700);
    expect(result!.y).toBe(0);
  });

  it('should stack left floats vertically when no room side by side', () => {
    const ctx = new FloatContext(0, 0, 200, 600);
    const box1 = makeBox(150, 50);
    const box2 = makeBox(150, 50);
    ctx.placeFloat(box1, 'left', 0);
    ctx.placeFloat(box2, 'left', 0);
    expect(ctx.getFloats().length).toBe(2);
    expect(ctx.getCurrentBottom()).toBeGreaterThanOrEqual(100);
  });

  it('should report hasFloats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.hasFloats()).toBe(false);
    ctx.placeFloat(makeBox(100, 50), 'left', 0);
    expect(ctx.hasFloats()).toBe(true);
  });

  it('should compute available width with no floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getAvailableWidth(0, 20)).toBe(800);
  });

  it('should reduce available width with left float', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(200, 50), 'left', 0);
    const avail = ctx.getAvailableWidth(10, 20);
    expect(avail).toBeLessThan(800);
  });

  it('should return left offset', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(200, 50), 'left', 0);
    expect(ctx.getLeftOffset(10, 20)).toBeGreaterThan(0);
  });

  it('should return zero left offset with no floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getLeftOffset(0, 20)).toBe(0);
  });

  it('should generate exclusion zones', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(100, 50), 'left', 0);
    const zones = ctx.getExclusionZones();
    expect(zones.length).toBe(1);
    expect(zones[0]!.side).toBe('left');
  });

  it('should handle clear: left', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(100, 50), 'left', 0);
    const y = ctx.getYAfterClear('left', 0);
    expect(y).toBeGreaterThanOrEqual(50);
  });

  it('should handle clear: both', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(100, 50), 'left', 0);
    ctx.placeFloat(makeBox(100, 30), 'right', 0);
    const y = ctx.getYAfterClear('both', 0);
    expect(y).toBeGreaterThanOrEqual(50);
  });

  it('should not affect Y with clear: none', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    ctx.placeFloat(makeBox(100, 50), 'left', 0);
    expect(ctx.getYAfterClear('none', 10)).toBe(10);
  });
});
