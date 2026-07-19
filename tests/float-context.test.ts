import { describe, it, expect } from 'vitest';
import { FloatContext } from '../src/browser/rendering/formatting/float-context';
import type { LayoutBox } from '../src/browser/rendering/dom-tree';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBox(
  x: number, y: number, w: number, h: number,
  side: 'left' | 'right' = 'left',
): LayoutBox {
  return {
    x, y, width: w, height: h,
    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
  };
}

// ─── Constructor ────────────────────────────────────────────────────────────

describe('FloatContext constructor', () => {
  it('creates empty context with no floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.hasFloats()).toBe(false);
    expect(ctx.getFloats()).toHaveLength(0);
    expect(ctx.getCurrentBottom()).toBe(0);
  });
});

// ─── placeFloat ─────────────────────────────────────────────────────────────

describe('placeFloat', () => {
  it('places a left float at the left edge', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    const placed = ctx.placeFloat(box, 'left', 0);
    expect(placed).not.toBeNull();
    expect(placed!.x).toBe(0);
    expect(placed!.y).toBe(0);
    expect(ctx.hasFloats()).toBe(true);
  });

  it('places a right float at the right edge', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    const placed = ctx.placeFloat(box, 'right', 0);
    expect(placed).not.toBeNull();
    expect(placed!.x).toBe(600); // 800 - 200
  });

  it('stacks left floats vertically when no horizontal space', () => {
    const ctx = new FloatContext(0, 0, 200, 600);
    const box1 = makeBox(0, 0, 200, 100);
    const box2 = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box1, 'left', 0);
    ctx.placeFloat(box2, 'left', 0);
    expect(ctx.getFloats()).toHaveLength(2);
    // Second float should be below the first
    expect(ctx.getFloats()[1]!.y).toBeGreaterThanOrEqual(100);
  });

  it('updates currentBottom after placing', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 150);
    ctx.placeFloat(box, 'left', 0);
    expect(ctx.getCurrentBottom()).toBe(150);
  });

  it('accounts for margins in float placement', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 180, 80);
    box.marginLeft = 10;
    box.marginRight = 10;
    box.marginTop = 5;
    box.marginBottom = 5;
    const placed = ctx.placeFloat(box, 'left', 0);
    expect(placed).not.toBeNull();
    // Margin box width = 180 + 10 + 10 = 200
    expect(ctx.getCurrentBottom()).toBe(90); // 5 + 80 + 5
  });
});

// ─── getAvailableWidth ──────────────────────────────────────────────────────

describe('getAvailableWidth', () => {
  it('returns full width when no floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getAvailableWidth(0, 100)).toBe(800);
  });

  it('reduces width for left float at same Y', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'left', 0);
    const available = ctx.getAvailableWidth(0, 100);
    expect(available).toBe(600); // 800 - 200
  });

  it('reduces width for right float at same Y', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'right', 0);
    const available = ctx.getAvailableWidth(0, 100);
    expect(available).toBe(600); // 800 - 200
  });

  it('returns full width when Y is below all floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'left', 0);
    const available = ctx.getAvailableWidth(200, 50); // Y=200 is below float (0-100)
    expect(available).toBe(800);
  });

  it('reduces width for both left and right floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const leftBox = makeBox(0, 0, 200, 100);
    const rightBox = makeBox(0, 0, 200, 100);
    ctx.placeFloat(leftBox, 'left', 0);
    ctx.placeFloat(rightBox, 'right', 0);
    const available = ctx.getAvailableWidth(0, 100);
    expect(available).toBe(400); // 800 - 200 - 200
  });

  it('returns 0 when float area is fully occupied', () => {
    const ctx = new FloatContext(0, 0, 200, 600);
    const leftBox = makeBox(0, 0, 100, 100);
    const rightBox = makeBox(0, 0, 100, 100);
    ctx.placeFloat(leftBox, 'left', 0);
    ctx.placeFloat(rightBox, 'right', 0);
    const available = ctx.getAvailableWidth(0, 100);
    expect(available).toBe(0);
  });
});

// ─── getLeftOffset ──────────────────────────────────────────────────────────

describe('getLeftOffset', () => {
  it('returns 0 when no left floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getLeftOffset(0, 100)).toBe(0);
  });

  it('returns left float width as offset', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'left', 0);
    expect(ctx.getLeftOffset(0, 100)).toBe(200);
  });

  it('ignores right floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'right', 0);
    expect(ctx.getLeftOffset(0, 100)).toBe(0);
  });
});

// ─── getExclusionZones ──────────────────────────────────────────────────────

describe('getExclusionZones', () => {
  it('returns empty array when no floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getExclusionZones()).toEqual([]);
  });

  it('returns zones for placed floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const leftBox = makeBox(0, 0, 200, 100);
    const rightBox = makeBox(0, 0, 200, 100);
    ctx.placeFloat(leftBox, 'left', 0);
    ctx.placeFloat(rightBox, 'right', 0);
    const zones = ctx.getExclusionZones();
    expect(zones).toHaveLength(2);
    expect(zones[0]!.side).toBe('left');
    expect(zones[1]!.side).toBe('right');
  });
});

// ─── getYAfterClear ─────────────────────────────────────────────────────────

describe('getYAfterClear', () => {
  it('returns currentY for clear: none', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    expect(ctx.getYAfterClear('none', 50)).toBe(50);
  });

  it('returns float bottom for clear: left', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'left', 0);
    expect(ctx.getYAfterClear('left', 0)).toBe(100);
  });

  it('returns float bottom for clear: right', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'right', 0);
    expect(ctx.getYAfterClear('right', 0)).toBe(100);
  });

  it('returns max of both sides for clear: both', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const leftBox = makeBox(0, 0, 200, 100);
    const rightBox = makeBox(0, 0, 200, 200);
    ctx.placeFloat(leftBox, 'left', 0);
    ctx.placeFloat(rightBox, 'right', 0);
    expect(ctx.getYAfterClear('both', 0)).toBe(200); // max(100, 200)
  });

  it('returns currentY when no matching floats', () => {
    const ctx = new FloatContext(0, 0, 800, 600);
    const box = makeBox(0, 0, 200, 100);
    ctx.placeFloat(box, 'left', 0);
    expect(ctx.getYAfterClear('right', 50)).toBe(50); // no right floats
  });
});
