import { describe, it, expect } from 'vitest';
import { DamageTracker } from '../src/browser/rendering/damage-tracker';
import { FrameScheduler } from '../src/browser/rendering/frame-scheduler';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

function buildDoc(html: string): { doc: ReturnType<DomTree['buildFromHtml']>; tree: DomTree } {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE TRACKER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('DamageTracker', () => {
  it('should start empty', () => {
    const dt = new DamageTracker();
    expect(dt.isEmpty()).toBe(true);
    expect(dt.getRegions()).toEqual([]);
  });

  it('should add a rect', () => {
    const dt = new DamageTracker();
    dt.addRect(10, 20, 100, 50);
    expect(dt.isEmpty()).toBe(false);
    expect(dt.getRegions()).toEqual([{ x: 10, y: 20, w: 100, h: 50 }]);
  });

  it('should add a box', () => {
    const dt = new DamageTracker();
    dt.addBox({ x: 5, y: 5, width: 200, height: 100, marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 });
    expect(dt.getRegions()).toEqual([{ x: 5, y: 5, w: 200, h: 100 }]);
  });

  it('should track bounds of all damage regions', () => {
    const dt = new DamageTracker();
    dt.addRect(10, 20, 100, 50);
    dt.addRect(50, 10, 200, 80);
    const bounds = dt.getBounds();
    // rect1: x=10,y=20 → max_y=70; rect2: x=50,y=10 → max_y=90
    // bounds: x=10, y=10, w=240, h=80
    expect(bounds).toEqual({ x: 10, y: 10, w: 240, h: 80 });
  });

  it('should compact overlapping rects into one', () => {
    const dt = new DamageTracker();
    dt.addRect(10, 10, 50, 50);
    dt.addRect(30, 30, 60, 60);
    expect(dt.getRegions().length).toBe(2);
    dt.compact();
    const regions = dt.getRegions();
    expect(regions.length).toBe(1);
    expect(regions[0]).toEqual({ x: 10, y: 10, w: 80, h: 80 });
  });

  it('should keep non-overlapping rects separate after compact', () => {
    const dt = new DamageTracker();
    dt.addRect(0, 0, 10, 10);
    dt.addRect(100, 100, 10, 10);
    dt.compact();
    expect(dt.getRegions().length).toBe(2);
  });

  it('should detect intersection', () => {
    const dt = new DamageTracker();
    dt.addRect(10, 10, 50, 50);
    expect(dt.intersects(30, 30, 20, 20)).toBe(true);
    expect(dt.intersects(200, 200, 10, 10)).toBe(false);
  });

  it('should clear all regions', () => {
    const dt = new DamageTracker();
    dt.addRect(10, 10, 50, 50);
    dt.addRect(100, 100, 50, 50);
    dt.clear();
    expect(dt.isEmpty()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM TREE DIRTY FLAGS TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('DOM Tree dirty flags', () => {
  it('should initialize all nodes as dirty', () => {
    const { tree } = buildDoc('<html><body><div><span>hello</span></div></body></html>');
    const doc = tree.getDocument()!;
    const body = doc.bodyElement!;
    expect(body._dirtyLayout).toBe(true);
    expect(body._dirtyPaint).toBe(true);
    const div = body.children[0] as DomElement;
    expect(div._dirtyLayout).toBe(true);
    expect(div._dirtyPaint).toBe(true);
  });

  it('markDirty should propagate layout flag up', () => {
    const { tree } = buildDoc('<html><body><div id="a"><div id="b"><div id="c"></div></div></div></body></html>');
    const doc = tree.getDocument()!;
    const c = tree.getElementById('c')!;
    const a = tree.getElementById('a')!;

    tree.clearSubtreeDirty(doc.bodyElement!, 'layout');
    tree.clearSubtreeDirty(doc.bodyElement!, 'paint');

    expect(c._dirtyLayout).toBe(false);
    expect(a._dirtyLayout).toBe(false);

    tree.markDirty(c, 'layout');
    expect(c._dirtyLayout).toBe(true);
    expect(a._dirtyLayout).toBe(true);
  });

  it('clearDirty should clear only the specified kind', () => {
    const { tree } = buildDoc('<div id="x"></div>');
    const x = tree.getElementById('x')!;

    expect(x._dirtyLayout).toBe(true);
    expect(x._dirtyPaint).toBe(true);

    tree.clearDirty(x, 'layout');
    expect(x._dirtyLayout).toBe(false);
    expect(x._dirtyPaint).toBe(true);
  });

  it('clearSubtreeDirty should clear entire subtree', () => {
    const { tree } = buildDoc('<html><body><div id="a"><div id="b"><div id="c"></div></div></div></body></html>');
    const a = tree.getElementById('a')!;
    const b = tree.getElementById('b')!;
    const c = tree.getElementById('c')!;

    tree.clearSubtreeDirty(a, 'layout');
    expect(a._dirtyLayout).toBe(false);
    expect(b._dirtyLayout).toBe(false);
    expect(c._dirtyLayout).toBe(false);
  });

  it('processMutations should mark mutated elements dirty', () => {
    const { tree } = buildDoc('<html><body><div id="a"></div><div id="b"></div></body></html>');
    const doc = tree.getDocument()!;
    const a = tree.getElementById('a')!;
    const b = tree.getElementById('b')!;

    tree.clearSubtreeDirty(doc.bodyElement!, 'layout');
    tree.clearSubtreeDirty(doc.bodyElement!, 'paint');
    tree.clearDirty(a, 'layout');
    tree.clearDirty(a, 'paint');
    tree.clearDirty(b, 'layout');
    tree.clearDirty(b, 'paint');

    (tree as any).mutations.push({
      type: 'attributeChanged',
      targetDomId: a.domId,
      attributeName: 'class',
    });

    tree.processMutations();
    expect(a._dirtyLayout).toBe(true);
    expect(b._dirtyLayout).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INCREMENTAL LAYOUT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('LayoutEngine incremental layout', () => {
  it('layoutIncremental should return a DamageTracker', () => {
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const { tree, doc } = buildDoc('<html><body><div id="a" style="width:200px;height:100px"></div></body></html>');

    engine.layout(doc, tree);

    const a = tree.getElementById('a')!;
    tree.markDirty(a, 'layout');

    const damage = engine.layoutIncremental(doc, tree);
    expect(damage).toBeInstanceOf(DamageTracker);
  });

  it('layoutIncremental should skip clean subtrees', () => {
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const { tree, doc } = buildDoc(`
      <html><body>
        <div id="a" style="width:400px;height:200px;background-color:red">
          <span id="b" style="display:block;width:200px;height:100px;background-color:blue"></span>
        </div>
        <div id="c" style="width:400px;height:200px;background-color:green"></div>
      </body></html>
    `);

    engine.layout(doc, tree);

    const cBoxBefore = engine.getLayoutBox(tree.getElementById('c')!.domId);

    const a = tree.getElementById('a')!;
    tree.markDirty(a, 'layout');
    tree.markDirty(a, 'paint');

    engine.layoutIncremental(doc, tree);

    const cBoxAfter = engine.getLayoutBox(tree.getElementById('c')!.domId);
    expect(cBoxAfter!.x).toBe(cBoxBefore!.x);
    expect(cBoxAfter!.y).toBe(cBoxBefore!.y);
  });

  it('dirty flags should be cleared after incremental layout', () => {
    const engine = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const { tree, doc } = buildDoc('<html><body><div id="a" style="width:200px;height:100px"></div></body></html>');

    engine.layout(doc, tree);

    const a = tree.getElementById('a')!;
    tree.markDirty(a, 'layout');
    tree.markDirty(a, 'paint');

    engine.layoutIncremental(doc, tree);

    expect(a._dirtyLayout).toBe(false);
    expect(a._dirtyPaint).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INCREMENTAL PAINT TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('PaintEngine incremental paint', () => {
  it('paintIncremental should return damage for dirty elements', () => {
    const paint = new PaintEngine({ width: 800, height: 600, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const { tree, doc } = buildDoc(`
      <div id="a" style="width:200px;height:100px;background-color:red"></div>
      <div id="b" style="width:200px;height:100px;background-color:blue"></div>
    `);

    layout.layout(doc, tree);
    paint.paint(doc);

    const a = tree.getElementById('a')!;
    tree.markDirty(a, 'paint');

    const damage = paint.paintIncremental(doc, new DamageTracker());
    expect(damage.isEmpty()).toBe(false);
  });

  it('paintIncremental should not touch clean elements', () => {
    const paint = new PaintEngine({ width: 800, height: 600, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const { tree, doc } = buildDoc(`
      <div id="a" style="width:200px;height:100px;background-color:red"></div>
    `);

    layout.layout(doc, tree);
    paint.paint(doc);

    const emptyDamage = paint.paintIncremental(doc, new DamageTracker());
    expect(emptyDamage.isEmpty()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRAME SCHEDULER TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('FrameScheduler', () => {
  it('should coalesce multiple schedule calls into one callback', async () => {
    const scheduler = new FrameScheduler();
    let callCount = 0;

    scheduler.schedule(() => { callCount++; });
    scheduler.schedule(() => { callCount++; });
    scheduler.schedule(() => { callCount++; });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(callCount).toBe(1);
  });

  it('should report isScheduled correctly', async () => {
    const scheduler = new FrameScheduler();

    expect(scheduler.isScheduled()).toBe(false);
    scheduler.schedule(() => {});
    expect(scheduler.isScheduled()).toBe(true);

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(scheduler.isScheduled()).toBe(false);
  });

  it('should cancel a pending frame', async () => {
    const scheduler = new FrameScheduler();
    let called = false;

    scheduler.schedule(() => { called = true; });
    scheduler.cancel();

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(called).toBe(false);
  });

  it('should track frame count', async () => {
    const scheduler = new FrameScheduler();
    expect(scheduler.getFrameCount()).toBe(0);

    scheduler.schedule(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(scheduler.getFrameCount()).toBe(1);

    scheduler.schedule(() => {});
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(scheduler.getFrameCount()).toBe(2);
  });
});
