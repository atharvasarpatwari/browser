import { describe, it, expect, vi } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, UsedStyle } from '../src/browser/rendering/dom-tree';
import { ReflowRepaintController } from '../src/browser/rendering/reflow-repaint-controller';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import type { IPaintEngine } from '../src/browser/rendering/paint-engine';

function buildDoc(html: string): { doc: DomDocument; tree: DomTree } {
  const parser = new HtmlParser();
  const tree = new DomTree();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

describe('style invalidation — markDirty', () => {
  it('should set _dirtyStyle and propagate dirty flags up ancestors', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"><span id="s"></span></div></body></html>');
    const body = doc.bodyElement!;
    const div = tree.getElementById('d')!;
    const span = tree.getElementById('s')!;

    // Clear initial dirty state
    tree.clearSubtreeDirty(body, 'style');
    tree.clearSubtreeDirty(body, 'layout');
    tree.clearSubtreeDirty(body, 'paint');

    expect(span._dirtyStyle).toBe(false);
    expect(span._dirtyLayout).toBe(false);
    expect(span._dirtyPaint).toBe(false);

    tree.markDirty(span, 'style');

    expect(span._dirtyStyle).toBe(true);
    expect(span._dirtyLayout).toBe(true);
    expect(span._dirtyPaint).toBe(true);

    // Ancestors get layout + paint dirty (but not _dirtyStyle)
    expect(div._dirtyLayout).toBe(true);
    expect(div._dirtyPaint).toBe(true);
    expect(body._dirtyLayout).toBe(true);
    expect(body._dirtyPaint).toBe(true);
  });

  it('should mark subtree dirty with markSubtreeDirty', () => {
    const { doc, tree } = buildDoc('<html><body><div id="outer"><div id="inner"><span id="s"></span></div></div></body></html>');
    const body = doc.bodyElement!;
    tree.clearSubtreeDirty(body, 'style');

    const outer = tree.getElementById('outer')!;
    const inner = tree.getElementById('inner')!;
    const span = tree.getElementById('s')!;

    tree.markSubtreeDirty(outer, 'style');

    expect(outer._dirtyStyle).toBe(true);
    expect(inner._dirtyStyle).toBe(true);
    expect(span._dirtyStyle).toBe(true);
  });

  it('should clear dirty flags with clearDirty', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    const div = tree.getElementById('d')!;
    tree.markDirty(div, 'style');

    expect(div._dirtyStyle).toBe(true);

    tree.clearDirty(div, 'style');
    expect(div._dirtyStyle).toBe(false);
    // layout/paint remain dirty from markDirty propagation
    expect(div._dirtyLayout).toBe(true);
  });

  it('should clear subtree dirty flags with clearSubtreeDirty', () => {
    const { doc, tree } = buildDoc('<html><body><div id="outer"><div id="inner"></div></div></body></html>');
    const body = doc.bodyElement!;
    tree.markSubtreeDirty(body, 'style');
    tree.clearSubtreeDirty(body, 'style');

    expect(body._dirtyStyle).toBe(false);
    const outer = tree.getElementById('outer')!;
    expect(outer._dirtyStyle).toBe(false);
    const inner = tree.getElementById('inner')!;
    expect(inner._dirtyStyle).toBe(false);
  });
});

describe('UsedStyle integration', () => {
  it('should set usedStyle via setUsedStyle', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d"></div></body></html>');
    const div = tree.getElementById('d')!;
    expect(div.usedStyle).toBeNull();

    const used: UsedStyle = {
      display: 'block',
      position: 'static',
      boxSizing: 'content-box',
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 10, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTopWidth: 0, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0,
      borderTopStyle: 'none', borderRightStyle: 'none', borderBottomStyle: 'none', borderLeftStyle: 'none',
      width: null, height: null,
      minWidth: 0, minHeight: 0, maxWidth: null, maxHeight: null,
      fontSize: 16, lineHeight: 'normal', fontWeight: 400, fontFamily: 'serif',
      color: '#000000', backgroundColor: 'transparent',
      textAlign: 'start', verticalAlign: 'baseline',
      float: 'none', clear: 'none',
      overflowX: 'visible', overflowY: 'visible',
      zIndex: 'auto', opacity: 1, visibility: 'visible',
      boxShadow: 'none',
    };
    tree.setUsedStyle(div, used);
    expect(div.usedStyle).toBe(used);
    expect(div.usedStyle!.paddingTop).toBe(10);
  });
});

describe('ReflowRepaintController style recalc callback', () => {
  function createMockPaintEngine(): IPaintEngine {
    return {
      paint: vi.fn(),
      paintIncremental: vi.fn(),
      dispose: vi.fn(),
      getLastImageData: vi.fn(() => null),
    } as unknown as IPaintEngine;
  }

  it('should set and invoke styleRecalcCallback in processFrame', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d">text</div></body></html>');
    const layoutEngine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    const paintEngine = createMockPaintEngine();
    const controller = new ReflowRepaintController(layoutEngine, paintEngine, tree);

    controller.init(doc);
    const cb = vi.fn();
    controller.setStyleRecalcCallback(cb);

    // Simulate an animation frame cycle
    controller.invalidateLayout(doc.bodyElement!);
    controller.requestFrame();

    // We need to trigger processFrame — requestFrame schedules async,
    // so call it directly
    // Use a trick: set a very small timeout and then call processFrame manually
    // Actually, just call the scheduler's internal callback directly
    expect(cb).not.toHaveBeenCalled();

    // Direct call to processFrame should invoke the callback
    // But processFrame checks this.processing and this.document
    // Let's just use a different approach: tick the scheduler
    // Actually, let's just directly verify the callback is stored and called
    controller.setStyleRecalcCallback(cb);

    // Access the private scheduler's scheduled callback: we need to use
    // a public method. Instead, let's verify via the processFrame path.
    (controller as any).processFrame();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('should not invoke styleRecalcCallback when not set', () => {
    const { doc, tree } = buildDoc('<html><body><div id="d">text</div></body></html>');
    const layoutEngine = new LayoutEngine({ viewportWidth: 1000, viewportHeight: 800, defaultFontSize: 16 });
    const paintEngine = createMockPaintEngine();
    const controller = new ReflowRepaintController(layoutEngine, paintEngine, tree);

    controller.init(doc);
    (controller as any).processFrame();
    // should not throw
  });
});
