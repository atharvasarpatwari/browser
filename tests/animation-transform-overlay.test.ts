import { describe, it, expect } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { CssAnimationAnimator } from '../src/browser/rendering/css-animations';
import { AnimationTimeline } from '../src/browser/rendering/compositing/animation-engine';
import { LayerPromoter } from '../src/browser/rendering/compositing/layer-promoter';
import { CompositingLayer } from '../src/browser/rendering/compositing/compositing-layer';
import type { StackingContext } from '../src/browser/rendering/formatting/stacking';
import type { CssKeyframesRule } from '../src/browser/rendering/css5/types';

const SLIDE_RULE: CssKeyframesRule = {
  type: 'keyframes',
  name: 'slide',
  keyframes: [
    { selectors: ['from'], declarations: [{ property: 'transform', value: 'translateX(0px)', important: false }] },
    { selectors: ['to'], declarations: [{ property: 'transform', value: 'translateX(60px)', important: false }] },
  ],
};

function animationStyle(name = 'slide', duration = '1s'): Map<string, string> {
  return new Map([
    ['animation-name', name],
    ['animation-duration', duration],
    ['animation-timing-function', 'linear'],
    ['animation-iteration-count', 'infinite'],
    ['animation-delay', '0s'],
    ['animation-direction', 'normal'],
    ['animation-fill-mode', 'none'],
    ['animation-play-state', 'running'],
  ]);
}

function buildDoc(html: string): { doc: ReturnType<DomTree['buildFromHtml']>; tree: DomTree } {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

/** Drive the timeline deterministically to a known elapsed time. */
function advance(timeline: AnimationTimeline, elapsedMs: number): void {
  (timeline as unknown as { _startTime: number | null })._startTime = 0;
  timeline.tick(elapsedMs);
  (timeline as unknown as { _startTime: number | null })._startTime = performance.now() - elapsedMs;
}

/** Pin tracked animations to a 0 start offset so ticks are exact. */
function pinAnimations(animator: CssAnimationAnimator): void {
  const targets = (animator as unknown as { targets: Map<string, Set<{ _startTime: number | null }>> }).targets;
  for (const set of targets.values()) {
    for (const anim of set) anim._startTime = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveTransform
// ─────────────────────────────────────────────────────────────────────────────

describe('CssAnimationAnimator.resolveTransform', () => {
  it('returns null when no animations are tracked', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({ domTree: tree, timeline });
    animator.sync(doc);
    const el = tree.getElementById('a') as DomElement;
    expect(animator.resolveTransform(el)).toBeNull();
    timeline.dispose();
    animator.dispose();
  });

  it('interpolates translateX mid-animation', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['slide', SLIDE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    animator.sync(doc);
    pinAnimations(animator);
    advance(timeline, 500);

    const transform = animator.resolveTransform(el);
    expect(transform).not.toBeNull();
    expect(transform).toContain('matrix3d');
    // Interpolated matrix must be a pure translation of ~30px on x.
    expect(transform!).toContain(',30,');
    timeline.dispose();
    animator.dispose();
  });

  it('returns the start value at t=0 and wraps at iteration boundaries', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['slide', SLIDE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    animator.sync(doc);

    pinAnimations(animator);
    advance(timeline, 0);
    expect(animator.resolveTransform(el)).toContain('translateX(0px)');

    // Infinite animation: one full period later it wraps back to the start.
    advance(timeline, 1000);
    expect(animator.resolveTransform(el)).toContain('translateX(0px)');

    // Three quarters through: translateX(45px).
    advance(timeline, 1750);
    expect(animator.resolveTransform(el)).toContain('45');
    timeline.dispose();
    animator.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flat layer path (PaintLayer.translate)
// ─────────────────────────────────────────────────────────────────────────────

describe('animated transform overlay — flat layer path', () => {
  function setupPipeline() {
    const { tree, doc } = buildDoc(
      '<html><body><div id="a" style="width:100px;height:100px;background-color:red"></div></body></html>',
    );
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const paint = new PaintEngine({ width: 800, height: 600, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['slide', SLIDE_RULE]]),
    });
    paint.setTransformResolver((el) => animator.resolveTransform(el));
    return { tree, doc, layout, paint, timeline, animator };
  }

  it('records the animated translation on the PaintLayer', () => {
    const { tree, doc, layout, paint, timeline, animator } = setupPipeline();
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    layout.layout(doc, tree);
    animator.sync(doc);
    pinAnimations(animator);
    advance(timeline, 500);

    paint.paint(doc);
    const layer = paint.getLayers().find(l => l.bounds === el.layoutBox);
    expect(layer).toBeDefined();
    expect(layer!.translate).not.toBeNull();
    expect(layer!.translate!.x).toBeCloseTo(30, 0);
    expect(layer!.translate!.y).toBeCloseTo(0, 6);

    timeline.dispose();
    animator.dispose();
    layout.dispose();
    paint.dispose();
  });

  it('leaves translate null when no animation is active', () => {
    const { tree, doc, layout, paint, timeline, animator } = setupPipeline();
    const el = tree.getElementById('a') as DomElement;

    layout.layout(doc, tree);
    animator.sync(doc); // no animation-name set → nothing tracked

    paint.paint(doc);
    const layer = paint.getLayers().find(l => l.bounds === el.layoutBox);
    expect(layer).toBeDefined();
    expect(layer!.translate).toBeNull();

    timeline.dispose();
    animator.dispose();
    layout.dispose();
    paint.dispose();
  });

  it('emits a translate command on the stacking-context composite path', () => {
    const { tree, doc, layout, paint, timeline, animator } = setupPipeline();
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    layout.layout(doc, tree);
    animator.sync(doc);
    pinAnimations(animator);
    advance(timeline, 500);

    paint.paint(doc);
    const commands = paint.compositeFrame();
    const translateCmd = commands.find(c => c.type === 'translate');
    expect(translateCmd).toBeDefined();
    expect(translateCmd!.params[0]).toBeCloseTo(30, 0);
    expect(translateCmd!.params[1]).toBeCloseTo(0, 6);

    timeline.dispose();
    animator.dispose();
    layout.dispose();
    paint.dispose();
  });

  it('flat fallback composite path applies layer.translate', () => {
    const { tree, doc, layout, paint, timeline, animator } = setupPipeline();
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    layout.layout(doc, tree);
    animator.sync(doc);
    pinAnimations(animator);
    advance(timeline, 500);

    paint.paint(doc);

    // Force the flat (non-stacking) composite branch.
    (paint as unknown as { stackingTree: unknown }).stackingTree = null;
    const commands = paint.compositeFrame();
    const translateCmd = commands.find(c => c.type === 'translate');
    expect(translateCmd).toBeDefined();
    expect(translateCmd!.params[0]).toBeCloseTo(30, 0);

    // save/restore must bracket the translated content
    const firstSave = commands.findIndex(c => c.type === 'save');
    const translateIdx = commands.findIndex(c => c.type === 'translate');
    expect(firstSave).toBeGreaterThanOrEqual(0);
    expect(translateIdx).toBeGreaterThan(firstSave);
    expect(commands.some(c => c.type === 'restore')).toBe(true);

    timeline.dispose();
    animator.dispose();
    layout.dispose();
    paint.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composited path — promotion + layer matrix
// ─────────────────────────────────────────────────────────────────────────────

function makeEl(id: string, style: Record<string, string> = {}): DomElement {
  const map = new Map(Object.entries(style));
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    attributes: new Map(),
    parent: null,
    children: [],
    computedStyle: map.size > 0 ? map : null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    usedStyle: null,
    _dirtyLayout: false,
    _dirtyPaint: false,
    _dirtyStyle: false,
  };
}

function makeCtx(
  el: DomElement,
  opts?: Partial<Pick<StackingContext, 'zIndex' | 'isGrouped' | 'groupOpacity' | 'translate'>>,
): StackingContext {
  return {
    element: el,
    zIndex: opts?.zIndex ?? 0,
    children: [],
    bgCommands: [],
    blockEntries: [],
    floatEntries: [],
    inlineEntries: [],
    positionedAutoEntries: [],
    isGrouped: opts?.isGrouped ?? false,
    groupOpacity: opts?.groupOpacity ?? 1,
    willChange: el.computedStyle?.get('will-change') ?? null,
    translate: opts?.translate ?? null,
  };
}

describe('animated transform — composited path', () => {
  const promoter = new LayerPromoter(512);

  it('promotes an element with a non-zero animated translation', () => {
    const el = makeEl('a');
    const ctx = makeCtx(el, { translate: { x: 30, y: 0 } });
    expect(promoter.shouldPromote(ctx)).toBe(true);
    const hint = promoter.getHint(ctx);
    expect(hint.hasAnimatedTransform).toBe(true);
    expect(hint.hasTransform).toBe(true);
    expect(hint.reason).toBe('animated transform');
  });

  it('does not promote an element with a zero animated translation', () => {
    const el = makeEl('a');
    const ctx = makeCtx(el, { translate: { x: 0, y: 0 } });
    expect(promoter.shouldPromote(ctx)).toBe(false);
    expect(promoter.getHint(ctx).hasAnimatedTransform).toBe(false);
  });

  it('still reports static transform reason when no animated translation exists', () => {
    const el = makeEl('a', { transform: 'translateX(10px)' });
    const ctx = makeCtx(el);
    const hint = promoter.getHint(ctx);
    expect(hint.shouldPromote).toBe(true);
    expect(hint.reason).toBe('transform');
  });

  it('CompositingLayer uses the animated translation as its matrix', () => {
    const el = makeEl('a', {}, );
    const ctx = makeCtx(el, { translate: { x: 30, y: -12 } });
    const layer = new CompositingLayer(el, ctx);
    expect(layer.transformMatrix).not.toBeNull();
    expect(layer.transformMatrix!.m41).toBe(30);
    expect(layer.transformMatrix!.m42).toBe(-12);
    expect(layer.hasTransform).toBe(true);
  });

  it('CompositingLayer falls back to the static transform when not animating', () => {
    const el = makeEl('a', { transform: 'translateX(10px)' });
    const ctx = makeCtx(el);
    const layer = new CompositingLayer(el, ctx);
    expect(layer.transformMatrix).not.toBeNull();
    expect(layer.transformMatrix!.m41).toBe(10);
    expect(layer.hasTransform).toBe(true);
  });

  it('CompositingLayer has no matrix without animated or static transforms', () => {
    const el = makeEl('a');
    const ctx = makeCtx(el);
    const layer = new CompositingLayer(el, ctx);
    expect(layer.transformMatrix).toBeNull();
    expect(layer.hasTransform).toBe(false);
  });
});
