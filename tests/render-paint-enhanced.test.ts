import { describe, it, expect } from 'vitest';
import { parseGradient, evaluateGradient, isGradientValue } from '../src/browser/rendering/css-gradients';
import { parseBackgrounds, evaluateBackground } from '../src/browser/rendering/enhanced-backgrounds';
import { parseBorders, parseBorderRadius, parseBorderStyle, noBorders } from '../src/browser/rendering/borders-enhanced';
import { parseBoxShadow, parseTextShadow } from '../src/browser/rendering/shadows';
import { parseFilter, applyFilters } from '../src/browser/rendering/css-filters';
import { parseClipPath, parseMask, isInsideClip } from '../src/browser/rendering/clip-mask';
import { blendColors, compositeBuffer } from '../src/browser/rendering/blend-modes';
import { buildRenderObject, flattenRenderOrder, sortByPaintOrder } from '../src/browser/rendering/render-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { Rasterizer } from '../src/browser/rendering/rasterizer';

// ─────────────────────────────────────────────────────────────────────────────
// CSS GRADIENTS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseGradient', () => {
  it('parses linear-gradient to bottom', () => {
    const g = parseGradient('linear-gradient(red, blue)');
    expect(g).toBeTruthy();
    expect(g!.type).toBe('linear');
    expect(g!.stops.length).toBe(2);
    expect(g!.angle).toBeCloseTo(180);
  });

  it('parses linear-gradient with angle', () => {
    const g = parseGradient('linear-gradient(45deg, red, blue)');
    expect(g).toBeTruthy();
    expect(g!.angle).toBeCloseTo(45);
  });

  it('parses linear-gradient with direction keyword', () => {
    const g = parseGradient('linear-gradient(to right, red, blue)');
    expect(g).toBeTruthy();
    expect(g!.angle).toBeCloseTo(90);
  });

  it('parses radial-gradient', () => {
    const g = parseGradient('radial-gradient(circle, red, blue)');
    expect(g).toBeTruthy();
    expect(g!.type).toBe('radial');
    expect(g!.shape).toBe('circle');
  });

  it('returns null for non-gradient value', () => {
    expect(parseGradient('red')).toBeNull();
    expect(parseGradient('')).toBeNull();
  });

  it('parses gradient with multiple stops', () => {
    const g = parseGradient('linear-gradient(red, yellow, blue)');
    expect(g).toBeTruthy();
    expect(g!.stops.length).toBe(3);
  });

  it('handles color-stop positions', () => {
    const g = parseGradient('linear-gradient(red 0%, blue 100%)');
    expect(g).toBeTruthy();
    expect(g!.stops[0].offset).toBe(0);
    expect(g!.stops[1].offset).toBe(1);
  });
});

describe('evaluateGradient', () => {
  it('evaluates linear-gradient at start point', () => {
    const g = parseGradient('linear-gradient(red, blue)')!;
    const c = evaluateGradient(g, 0, 0, 100, 100);
    expect(c.r).toBeGreaterThan(200);
    expect(c.b).toBeLessThan(50);
  });

  it('evaluates linear-gradient at end point', () => {
    const g = parseGradient('linear-gradient(red, blue)')!;
    const c = evaluateGradient(g, 99, 99, 100, 100);
    expect(c.b).toBeGreaterThan(200);
    expect(c.r).toBeLessThan(50);
  });
});

describe('isGradientValue', () => {
  it('detects gradient strings', () => {
    expect(isGradientValue('linear-gradient(red, blue)')).toBe(true);
    expect(isGradientValue('radial-gradient(red, blue)')).toBe(true);
    expect(isGradientValue('conic-gradient(red, blue)')).toBe(true);
    expect(isGradientValue('repeating-linear-gradient(red, blue)')).toBe(true);
    expect(isGradientValue('red')).toBe(false);
    expect(isGradientValue('')).toBe(false);
    expect(isGradientValue('none')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUNDS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBackgrounds', () => {
  it('parses background-color only', () => {
    const bg = parseBackgrounds('transparent', '#ff0000');
    expect(bg.color.r).toBe(255);
    expect(bg.color.g).toBe(0);
    expect(bg.color.b).toBe(0);
  });

  it('parses none background', () => {
    const bg = parseBackgrounds('none');
    expect(bg.layers[0].image).toBe('none');
  });

  it('parses gradient background-image', () => {
    const bg = parseBackgrounds('linear-gradient(red, blue)', 'transparent');
    expect(bg.layers[0].image).toContain('linear-gradient');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BORDERS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBorders', () => {
  it('returns no borders for empty style', () => {
    const b = parseBorders(new Map(), 100, 100);
    expect(b.top.width).toBe(0);
    expect(b.top.style).toBe('none');
  });

  it('parses uniform border-width', () => {
    const style = new Map<string, string>([
      ['border-top-width', '5px'],
      ['border-right-width', '5px'],
      ['border-bottom-width', '5px'],
      ['border-left-width', '5px'],
      ['border-top-style', 'solid'],
      ['border-right-style', 'solid'],
      ['border-bottom-style', 'solid'],
      ['border-left-style', 'solid'],
      ['border-top-color', '#ff0000'],
    ]);
    const b = parseBorders(style, 100, 100);
    expect(b.top.width).toBe(5);
    expect(b.top.style).toBe('solid');
    expect(b.top.color.r).toBe(255);
  });

  it('parses noBorders', () => {
    const b = noBorders();
    expect(b.top.width).toBe(0);
  });
});

describe('parseBorderRadius', () => {
  it('parses single value', () => {
    const r = parseBorderRadius('10px', 100, 100);
    expect(r.topLeft.w).toBe(10);
    expect(r.topRight.w).toBe(10);
    expect(r.bottomRight.w).toBe(10);
    expect(r.bottomLeft.w).toBe(10);
  });

  it('parses two values', () => {
    const r = parseBorderRadius('10px 20px', 100, 100);
    expect(r.topLeft.w).toBe(10);
    expect(r.topRight.w).toBe(20);
    expect(r.bottomRight.w).toBe(10);
    expect(r.bottomLeft.w).toBe(20);
  });

  it('parses four values', () => {
    const r = parseBorderRadius('1px 2px 3px 4px', 100, 100);
    expect(r.topLeft.w).toBe(1);
    expect(r.topRight.w).toBe(2);
    expect(r.bottomRight.w).toBe(3);
    expect(r.bottomLeft.w).toBe(4);
  });

  it('parses percentage values', () => {
    const r = parseBorderRadius('50%', 200, 100);
    expect(r.topLeft.w).toBeCloseTo(100);
    expect(r.topLeft.h).toBeCloseTo(50);
  });

  it('parses slash syntax', () => {
    const r = parseBorderRadius('10px / 20px', 100, 100);
    expect(r.topLeft.w).toBe(10);
    expect(r.topLeft.h).toBe(20);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SHADOWS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBoxShadow', () => {
  it('parses simple offset shadow', () => {
    const shadows = parseBoxShadow('5px 5px rgba(0,0,0,0.5)');
    expect(shadows.length).toBe(1);
    expect(shadows[0].offsetX).toBe(5);
    expect(shadows[0].offsetY).toBe(5);
    expect(shadows[0].color.a).toBeCloseTo(0.5);
  });

  it('parses shadow with blur', () => {
    const shadows = parseBoxShadow('2px 2px 4px #000');
    expect(shadows.length).toBe(1);
    expect(shadows[0].blur).toBe(4);
  });

  it('parses shadow with spread', () => {
    const shadows = parseBoxShadow('2px 2px 4px 6px #000');
    expect(shadows.length).toBe(1);
    expect(shadows[0].blur).toBe(4);
    expect(shadows[0].spread).toBe(6);
  });

  it('parses inset shadow', () => {
    const shadows = parseBoxShadow('inset 2px 2px #000');
    expect(shadows.length).toBe(1);
    expect(shadows[0].inset).toBe(true);
  });

  it('handles none', () => {
    expect(parseBoxShadow('none')).toEqual([]);
  });

  it('parses multiple shadows', () => {
    const shadows = parseBoxShadow('1px 1px #000, 2px 2px #fff');
    expect(shadows.length).toBe(2);
  });
});

describe('parseTextShadow', () => {
  it('parses simple text shadow', () => {
    const shadows = parseTextShadow('1px 1px #000');
    expect(shadows.length).toBe(1);
    expect(shadows[0].offsetX).toBe(1);
    expect(shadows[0].offsetY).toBe(1);
  });

  it('handles none', () => {
    expect(parseTextShadow('none')).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseFilter', () => {
  it('parses blur', () => {
    const f = parseFilter('blur(5px)');
    expect(f.length).toBe(1);
    if (f[0].name === 'blur') {
      expect(f[0].radius).toBe(5);
    } else {
      expect(f[0].name).toBe('blur');
    }
  });

  it('parses brightness', () => {
    const f = parseFilter('brightness(0.5)');
    expect(f.length).toBe(1);
  });

  it('parses multiple filters', () => {
    const f = parseFilter('blur(2px) brightness(1.5)');
    expect(f.length).toBe(2);
  });

  it('handles none', () => {
    expect(parseFilter('none')).toEqual([]);
  });

  it('parses drop-shadow', () => {
    const f = parseFilter('drop-shadow(2px 2px 4px black)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('drop-shadow');
  });

  it('parses grayscale', () => {
    const f = parseFilter('grayscale(100%)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('grayscale');
  });

  it('parses sepia', () => {
    const f = parseFilter('sepia(50%)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('sepia');
  });

  it('parses hue-rotate', () => {
    const f = parseFilter('hue-rotate(90deg)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('hue-rotate');
  });

  it('parses invert', () => {
    const f = parseFilter('invert(1)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('invert');
  });

  it('parses saturate', () => {
    const f = parseFilter('saturate(2)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('saturate');
  });

  it('parses contrast', () => {
    const f = parseFilter('contrast(200%)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('contrast');
  });

  it('parses opacity filter', () => {
    const f = parseFilter('opacity(0.5)');
    expect(f.length).toBe(1);
    expect(f[0].name).toBe('opacity');
  });
});

describe('applyFilters', () => {
  it('applies brightness filter', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[0] = 100; buffer.data[1] = 100; buffer.data[2] = 100; buffer.data[3] = 255;
    const filters = parseFilter('brightness(2)');
    const result = applyFilters(buffer, filters);
    expect(result.data[0]).toBe(200);
  });

  it('applies grayscale filter', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[0] = 255; buffer.data[1] = 0; buffer.data[2] = 0; buffer.data[3] = 255;
    const filters = parseFilter('grayscale(1)');
    const result = applyFilters(buffer, filters);
    expect(result.data[0]).toBeCloseTo(result.data[1], -1);
    expect(result.data[1]).toBeCloseTo(result.data[2], -1);
  });

  it('applies invert filter', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[0] = 255; buffer.data[1] = 0; buffer.data[2] = 0; buffer.data[3] = 255;
    const filters = parseFilter('invert(1)');
    const result = applyFilters(buffer, filters);
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(255);
    expect(result.data[2]).toBe(255);
  });

  it('returns same buffer if no filters', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[0] = 100;
    const result = applyFilters(buffer, []);
    expect(result.data[0]).toBe(100);
  });

  it('applies opacity filter', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[3] = 255;
    const filters = parseFilter('opacity(0.5)');
    const result = applyFilters(buffer, filters);
    expect(result.data[3]).toBe(128);
  });

  it('applies sepia filter', () => {
    const buffer = new ImageData(2, 2);
    buffer.data[0] = 100; buffer.data[1] = 150; buffer.data[2] = 200; buffer.data[3] = 255;
    const filters = parseFilter('sepia(1)');
    const result = applyFilters(buffer, filters);
    expect(result.data[0]).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIP / MASK
// ─────────────────────────────────────────────────────────────────────────────

describe('parseClipPath', () => {
  it('parses inset', () => {
    const c = parseClipPath('inset(10px)');
    expect(c.shape.type).toBe('inset');
    if (c.shape.type === 'inset') {
      expect(c.shape.top).toBe(10);
      expect(c.shape.right).toBe(10);
      expect(c.shape.bottom).toBe(10);
      expect(c.shape.left).toBe(10);
    }
  });

  it('parses circle', () => {
    const c = parseClipPath('circle(50%)');
    expect(c.shape.type).toBe('circle');
  });

  it('parses ellipse', () => {
    const c = parseClipPath('ellipse(50% 50%)');
    expect(c.shape.type).toBe('ellipse');
  });

  it('parses polygon', () => {
    const c = parseClipPath('polygon(0 0, 100% 0, 100% 100%)');
    expect(c.shape.type).toBe('polygon');
    if (c.shape.type === 'polygon') {
      expect(c.shape.points.length).toBe(3);
    }
  });

  it('handles none', () => {
    const c = parseClipPath('none');
    expect(c.shape.type).toBe('none');
  });
});

describe('isInsideClip', () => {
  it('inset: inside point passes', () => {
    const shape = { type: 'inset' as const, top: 10, right: 10, bottom: 10, left: 10, round: [] };
    expect(isInsideClip(15, 15, shape, 100, 100)).toBe(true);
  });

  it('inset: outside point fails', () => {
    const shape = { type: 'inset' as const, top: 10, right: 10, bottom: 10, left: 10, round: [] };
    expect(isInsideClip(5, 5, shape, 100, 100)).toBe(false);
  });

  it('none always passes', () => {
    const shape = { type: 'none' as const };
    expect(isInsideClip(0, 0, shape, 100, 100)).toBe(true);
    expect(isInsideClip(999, 999, shape, 100, 100)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLEND MODES
// ─────────────────────────────────────────────────────────────────────────────

describe('blendColors', () => {
  it('normal blend returns source', () => {
    const result = blendColors({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 255, b: 0, a: 1 }, 'normal');
    expect(result.r).toBe(0);
    expect(result.g).toBe(255);
  });

  it('multiply blend', () => {
    const result = blendColors({ r: 200, g: 200, b: 200, a: 1 }, { r: 128, g: 128, b: 128, a: 1 }, 'multiply');
    expect(result.r).toBeLessThan(128);
  });

  it('screen blend', () => {
    const result = blendColors({ r: 100, g: 100, b: 100, a: 1 }, { r: 200, g: 200, b: 200, a: 1 }, 'screen');
    expect(result.r).toBeGreaterThan(100);
  });

  it('darken blend', () => {
    const result = blendColors({ r: 200, g: 100, b: 50, a: 1 }, { r: 100, g: 200, b: 50, a: 1 }, 'darken');
    expect(result.r).toBe(100);
    expect(result.g).toBe(100);
  });

  it('lighten blend', () => {
    const result = blendColors({ r: 200, g: 100, b: 50, a: 1 }, { r: 100, g: 200, b: 50, a: 1 }, 'lighten');
    expect(result.r).toBe(200);
    expect(result.g).toBe(200);
  });

  it('difference blend', () => {
    const result = blendColors({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 255, b: 0, a: 1 }, 'difference');
    expect(result.r).toBe(255);
    expect(result.g).toBe(255);
  });

  it('exclusion blend', () => {
    const result = blendColors({ r: 255, g: 0, b: 0, a: 1 }, { r: 128, g: 128, b: 128, a: 1 }, 'exclusion');
    expect(result.r).toBeGreaterThan(0);
    expect(result.g).toBeCloseTo(128, -1);
  });

  it('overlay blend', () => {
    const result = blendColors({ r: 100, g: 100, b: 100, a: 1 }, { r: 200, g: 200, b: 200, a: 1 }, 'overlay');
    expect(result.r).toBeGreaterThan(100);
  });

  it('color-dodge blend', () => {
    const result = blendColors({ r: 128, g: 128, b: 128, a: 1 }, { r: 200, g: 200, b: 200, a: 1 }, 'color-dodge');
    expect(result.r).toBeGreaterThan(200);
  });

  it('color-burn blend', () => {
    const result = blendColors({ r: 128, g: 128, b: 128, a: 1 }, { r: 50, g: 50, b: 50, a: 1 }, 'color-burn');
    expect(result.r).toBeLessThan(50);
  });

  it('hard-light blend', () => {
    const result = blendColors({ r: 100, g: 100, b: 100, a: 1 }, { r: 200, g: 200, b: 200, a: 1 }, 'hard-light');
    expect(result.r).toBeGreaterThan(100);
  });

  it('soft-light blend', () => {
    const result = blendColors({ r: 100, g: 100, b: 100, a: 1 }, { r: 200, g: 200, b: 200, a: 1 }, 'soft-light');
    expect(result.r).toBeGreaterThan(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RENDER TREE
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRenderObject', () => {
  it('builds a render object from a DOM element', () => {
    const el = {
      nodeType: 'element' as const,
      tagName: 'div',
      computedStyle: new Map([['display', 'block']]),
      children: [],
    };
    const ro = buildRenderObject(el as any);
    expect(ro.nodeType).toBe('block');
    expect(ro.visible).toBe(true);
  });

  it('marks display:none as invisible', () => {
    const el = {
      nodeType: 'element' as const,
      tagName: 'div',
      computedStyle: new Map([['display', 'none']]),
      children: [],
    };
    const ro = buildRenderObject(el as any);
    expect(ro.visible).toBe(false);
  });

  it('flattens render order', () => {
    const childDom = { nodeType: 'element', tagName: 'span', computedStyle: new Map(), children: [] };
    const parentDom = {
      nodeType: 'element', tagName: 'div',
      computedStyle: new Map([['display', 'block']]),
      children: [childDom],
    };
    const parent = buildRenderObject(parentDom as any);
    const list = flattenRenderOrder(parent);
    expect(list.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION: Rasterizer with new command types
// ─────────────────────────────────────────────────────────────────────────────

describe('Rasterizer new command types', () => {
  it('handles setFillGradient command', () => {
    const r = new Rasterizer({ width: 10, height: 10 });
    r.rasterize([
      {
        type: 'setFillGradient',
        params: [parseGradient('linear-gradient(red, blue)'), 0, 0, 10, 10],
      },
    ]);
    const img = r.getImageData();
    expect(img.data[0]).toBeGreaterThan(200);
  });

  it('handles applyBoxShadow command', () => {
    const r = new Rasterizer({ width: 20, height: 20 });
    r.rasterize([
      { type: 'setFillStyle', params: ['red'] },
      { type: 'fillRect', params: [5, 5, 10, 10] },
      {
        type: 'applyBoxShadow',
        params: [{ offsetX: 0, offsetY: 0, blur: 2, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.5 }, inset: false }, 5, 5, 10, 10],
      },
    ]);
    const img = r.getImageData();
    expect(img.data[3]).toBe(255);
  });

  it('handles applyFilterList command', () => {

    const r = new Rasterizer({ width: 10, height: 10 });
    r.rasterize([
      { type: 'setFillStyle', params: ['red'] },
      { type: 'fillRect', params: [0, 0, 10, 10] },
      { type: 'applyFilterList', params: [parseFilter('brightness(2)'), 0, 0, 10, 10] },
    ]);
    const img = r.getImageData();
    expect(img.data[0]).toBe(255);
  });

  it('handles applyClipShape command', () => {

    const r = new Rasterizer({ width: 10, height: 10 });
    r.rasterize([
      { type: 'setFillStyle', params: ['red'] },
      { type: 'fillRect', params: [0, 0, 10, 10] },
      {
        type: 'applyClipShape',
        params: [{ type: 'inset', top: 3, right: 3, bottom: 3, left: 3, round: [] }, 0, 0, 10, 10],
      },
    ]);
    const img = r.getImageData();
    expect(img.data[0]).toBe(0);
  });

  it('handles setBlendMode command', () => {

    const r = new Rasterizer({ width: 10, height: 10 });
    expect(() => {
      r.rasterize([{ type: 'setBlendMode', params: ['multiply'] }]);
    }).not.toThrow();
  });

  it('handles applyTextShadow command', () => {

    const r = new Rasterizer({ width: 50, height: 20 });
    expect(() => {
      r.rasterize([
        { type: 'setFillStyle', params: ['black'] },
        { type: 'setFont', params: ['normal 16px monospace'] },
        { type: 'fillText', params: ['X', 10, 10] },
        {
          type: 'applyTextShadow',
          params: [{ offsetX: 1, offsetY: 1, blur: 0, color: { r: 0, g: 0, b: 0, a: 0.5 } }, 'X', 10, 10, '#000', 'normal 16px monospace'],
        },
      ]);
    }).not.toThrow();
  });

  it('handles setBorderRadius command', () => {

    const r = new Rasterizer({ width: 10, height: 10 });
    expect(() => {
      r.rasterize([
        { type: 'setFillStyle', params: ['red'] },
        { type: 'fillRect', params: [0, 0, 10, 10] },
        {
          type: 'setBorderRadius',
          params: [{ topLeft: { w: 5, h: 5 }, topRight: { w: 5, h: 5 }, bottomRight: { w: 5, h: 5 }, bottomLeft: { w: 5, h: 5 } }, 0, 0, 10, 10],
        },
      ]);
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLIP RECT (overlow:hidden)
// ─────────────────────────────────────────────────────────────────────────────

describe('clip rect', () => {
  it('should clip fillRect when clip is set', () => {
    const r = new Rasterizer({ width: 20, height: 20 });
    const img = r.rasterize([
      { type: 'fillRect', params: [0, 0, 20, 20] },
      { type: 'clip', params: [5, 5, 10, 10] },
      { type: 'setFillStyle', params: ['red'] },
      { type: 'fillRect', params: [0, 0, 20, 20] },
    ]);
    // Top-left corner (0,0) should be black/white from initial fill, not red (clipped)
    expect(img.data[0]).toBeLessThan(200);
    // Inside clip (6,6) should be red
    const idx = (6 * 20 + 6) * 4;
    expect(img.data[idx]).toBeGreaterThan(200);
    expect(img.data[idx + 1]).toBeLessThan(50);
    expect(img.data[idx + 2]).toBeLessThan(50);
  });

  it('should clip drawImage when clip is set', () => {
    const r = new Rasterizer({ width: 10, height: 10 });
    const src = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1);
    const img = r.rasterize([
      { type: 'clip', params: [2, 2, 3, 3] },
      { type: 'drawImage', params: [src, 0, 0, 10, 10] },
    ]);
    // Outside clip: pixel should be background (white)
    expect(img.data[0]).toBe(255);
    // Inside clip at (3,3): should be red
    const idx = (3 * 10 + 3) * 4;
    expect(img.data[idx]).toBe(255);
    expect(img.data[idx + 1]).toBe(0);
    expect(img.data[idx + 2]).toBe(0);
  });

  it('should save/restore clip rect', () => {
    const r = new Rasterizer({ width: 10, height: 10 });
    const img = r.rasterize([
      { type: 'clip', params: [2, 2, 6, 6] },
      { type: 'save', params: [] },
      { type: 'clip', params: [0, 0, 3, 3] },
      { type: 'setFillStyle', params: ['red'] },
      { type: 'fillRect', params: [0, 0, 10, 10] },
      { type: 'restore', params: [] },
      { type: 'setFillStyle', params: ['blue'] },
      { type: 'fillRect', params: [0, 0, 10, 10] },
    ]);
    // save+restore should restore the wider clip rect
    const idx = (4 * 10 + 4) * 4;
    expect(img.data[idx + 2]).toBeGreaterThan(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BORDER PER-SIDE COLORS
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBorders per-side colors', () => {
  it('should parse per-side border colors', () => {
    const style = new Map<string, string>([
      ['border-top-color', 'red'],
      ['border-right-color', 'green'],
      ['border-bottom-color', 'blue'],
      ['border-left-color', 'yellow'],
      ['border-top-width', '5'],
      ['border-right-width', '5'],
      ['border-bottom-width', '5'],
      ['border-left-width', '5'],
      ['border-top-style', 'solid'],
      ['border-right-style', 'solid'],
      ['border-bottom-style', 'solid'],
      ['border-left-style', 'solid'],
    ]);
    const info = parseBorders(style, 100, 100);
    expect(info.top.color.r).toBe(255);
    expect(info.right.color.g).toBe(128);
    expect(info.bottom.color.b).toBe(255);
  });

  it('should fall back to black for missing border-color', () => {
    const style = new Map<string, string>([
      ['border-top-width', '5'],
      ['border-top-style', 'solid'],
    ]);
    const info = parseBorders(style, 100, 100);
    expect(info.top.color.r).toBe(0);
    expect(info.top.color.g).toBe(0);
    expect(info.top.color.b).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DASHED / DOTTED BORDERS
// ─────────────────────────────────────────────────────────────────────────────

describe('border styles', () => {
  it('should parse dashed and dotted styles', () => {
    const s1 = parseBorderStyle('dashed');
    expect(s1).toBe('dashed');
    const s2 = parseBorderStyle('dotted');
    expect(s2).toBe('dotted');
    const s3 = parseBorderStyle('double');
    expect(s3).toBe('double');
    const s4 = parseBorderStyle('groove');
    expect(s4).toBe('groove');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND SIZE / POSITION
// ─────────────────────────────────────────────────────────────────────────────

describe('parseBackgrounds', () => {
  it('should parse background-size', () => {
    const bg = parseBackgrounds('url(test.png)');
    expect(bg.layers[0].image).not.toBe('none');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MASK-IMAGE
// ─────────────────────────────────────────────────────────────────────────────

describe('parseMask', () => {
  it('should return empty for none', () => {
    const masks = parseMask('none');
    expect(masks.length).toBe(0);
  });

  it('should parse url mask', () => {
    const masks = parseMask('url(mask.png)');
    expect(masks.length).toBe(1);
    expect(masks[0].image).toBe('mask.png');
  });

  it('should parse multiple masks', () => {
    const masks = parseMask('url(a.png), url(b.png)');
    expect(masks.length).toBe(2);
    expect(masks[0].image).toBe('a.png');
    expect(masks[1].image).toBe('b.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RENDER OBJECT TREE
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRenderObject', () => {
  function makeElement(overrides?: Partial<DomElement>): DomElement {
    return {
      domId: 'test',
      nodeType: 'element',
      tagName: 'div',
      attributes: new Map(),
      computedStyle: null,
      usedStyle: null,
      layoutBox: null,
      imageData: null,
      naturalWidth: 0,
      naturalHeight: 0,
      loadingState: 'none',
      willChange: null,
      parent: null,
      children: [],
      _dirtyStyle: false,
      _dirtyLayout: false,
      _dirtyPaint: false,
      ...overrides,
    } as DomElement;
  }

  it('should build render object with display block', () => {
    const el = makeElement({
      computedStyle: new Map([['display', 'block']]),
      layoutBox: { x: 0, y: 0, width: 100, height: 50, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 },
    });
    const ro = buildRenderObject(el);
    expect(ro.nodeType).toBe('block');
    expect(ro.visible).toBe(true);
  });

  it('should mark display:none elements as not visible', () => {
    const el = makeElement({
      computedStyle: new Map([['display', 'none']]),
    });
    const ro = buildRenderObject(el);
    expect(ro.visible).toBe(false);
  });

  it('should detect stacking context from opacity < 1', () => {
    const el = makeElement({
      computedStyle: new Map([['opacity', '0.5']]),
    });
    const ro = buildRenderObject(el);
    expect(ro.createsStackingContext).toBe(true);
  });
});
