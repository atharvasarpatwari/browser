import { describe, it, expect } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { ReflowRepaintController } from '../src/browser/rendering/reflow-repaint-controller';
import { CssAnimationAnimator } from '../src/browser/rendering/css-animations';
import { Animation, AnimationTimeline, KeyframeEffect } from '../src/browser/rendering/compositing/animation-engine';
import type { CssKeyframesRule } from '../src/browser/rendering/css5/types';
import { CssParser } from '../src/browser/rendering/css-parser';
import { collectKeyframes } from '../src/browser/rendering/css5/cascade';

const PULSE_RULE: CssKeyframesRule = {
  type: 'keyframes',
  name: 'pulse',
  keyframes: [
    { selectors: ['from'], declarations: [{ property: 'opacity', value: '1', important: false }] },
    { selectors: ['to'], declarations: [{ property: 'opacity', value: '0.2', important: false }] },
  ],
};

function animationStyle(name = 'pulse', duration = '1s'): Map<string, string> {
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
  const t0 = performance.now();
  (timeline as unknown as { _startTime: number | null })._startTime = t0;
  timeline.tick(t0 + elapsedMs);
}

/** Pin tracked animations to a 0 start offset so ticks are exact. */
function pinAnimations(animator: CssAnimationAnimator): void {
  const targets = (animator as unknown as { targets: Map<string, Set<Animation>> }).targets;
  for (const set of targets.values()) {
    for (const anim of set) (anim as unknown as { _startTime: number | null })._startTime = 0;
  }
}

/** Pin the timeline so a real-time tick reports `elapsedMs`. */
function pinElapsed(timeline: AnimationTimeline, animator: CssAnimationAnimator, elapsedMs: number): void {
  pinAnimations(animator);
  (timeline as unknown as { _startTime: number | null })._startTime = performance.now() - elapsedMs;
}

describe('CssAnimationAnimator', () => {
  it('resolveOpacity returns null when no animations are tracked', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({ domTree: tree, timeline });
    animator.sync(doc);
    const el = tree.getElementById('a') as DomElement;
    expect(animator.resolveOpacity(el)).toBeNull();
    timeline.dispose();
    animator.dispose();
  });

  it('sync creates an animation for an element with animation-name', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    animator.sync(doc);
    expect(animator.hasActiveAnimations()).toBe(true);
    expect(animator.resolveOpacity(el)).toBeCloseTo(1, 1);

    pinAnimations(animator);
    advance(timeline, 500);
    expect(animator.resolveOpacity(el)).toBeCloseTo(0.6, 1);

    advance(timeline, 1000);
    expect(animator.resolveOpacity(el)).toBeCloseTo(1, 1);
    timeline.dispose();
    animator.dispose();
  });

  it('sync marks the element paint-dirty when an animation is created', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    animator.sync(doc);
    expect(el._dirtyPaint).toBe(true);
    timeline.dispose();
    animator.dispose();
  });

  it('sync destroys the animation when animation-name becomes none', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());
    animator.sync(doc);
    expect(animator.resolveOpacity(el)).not.toBeNull();

    tree.setComputedStyle(el, new Map([['animation-name', 'none']]));
    animator.sync(doc);
    expect(animator.resolveOpacity(el)).toBeNull();
    expect(animator.hasActiveAnimations()).toBe(false);
    timeline.dispose();
    animator.dispose();
  });

  it('replaces the animation when the spec changes instead of duplicating', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle('pulse', '1s'));
    animator.sync(doc);

    tree.setComputedStyle(el, animationStyle('pulse', '2s'));
    animator.sync(doc);

    expect(animator['targets'].get(el.domId)?.size).toBe(1);
    expect(animator.resolveOpacity(el)).not.toBeNull();
    timeline.dispose();
    animator.dispose();
  });

  it('skips animations whose @keyframes are unknown or paused', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    const el = tree.getElementById('a') as DomElement;

    tree.setComputedStyle(el, animationStyle('missing'));
    animator.sync(doc);
    expect(animator.hasActiveAnimations()).toBe(false);

    tree.setComputedStyle(el, animationStyle('pulse').set('animation-play-state', 'paused'));
    animator.sync(doc);
    expect(animator.hasActiveAnimations()).toBe(false);
    timeline.dispose();
    animator.dispose();
  });

  it('registerAnimation/unregisterAnimation resolve WAAPI-created animations', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({ domTree: tree, timeline });
    const el = tree.getElementById('a') as DomElement;

    const effect = new KeyframeEffect(el.domId, [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const anim = new Animation(effect, timeline);
    anim.start();
    animator.registerAnimation(anim);

    pinAnimations(animator);
    advance(timeline, 500);
    expect(animator.resolveOpacity(el)).toBeCloseTo(0.5, 1);

    animator.unregisterAnimation(anim);
    expect(animator.resolveOpacity(el)).toBeNull();
    anim.cancel();
    timeline.dispose();
    animator.dispose();
  });

  it('supports multiple concurrent animations on the same target', () => {
    const { tree, doc } = buildDoc('<div id="a" style="width:100px;height:100px"></div>');
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({ domTree: tree, timeline });
    const el = tree.getElementById('a') as DomElement;

    const a1 = new Animation(new KeyframeEffect(el.domId, [
      { offset: 0, properties: { opacity: '1' } },
      { offset: 1, properties: { opacity: '0' } },
    ], { duration: 1000 }), timeline);
    const a2 = new Animation(new KeyframeEffect(el.domId, [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 }), timeline);
    a1.start();
    a2.start();
    animator.registerAnimation(a1);
    animator.registerAnimation(a2);

    pinAnimations(animator);
    advance(timeline, 500);
    // Later animation wins for the same property (opacity ~0.5 both ways).
    expect(animator.resolveOpacity(el)).toBeCloseTo(0.5, 1);
    a1.cancel();
    a2.cancel();
    timeline.dispose();
    animator.dispose();
  });
});

describe('CssAnimationAnimator in the paint pipeline', () => {
  it('paints animated opacity through layers and stacking contexts', () => {
    const { tree, doc } = buildDoc(
      '<html><body><div id="a" style="width:100px;height:100px;background-color:red"></div></body></html>',
    );
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const paint = new PaintEngine({ width: 800, height: 600, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const timeline = new AnimationTimeline();
    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    paint.setOpacityResolver((el) => animator.resolveOpacity(el));

    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    layout.layout(doc, tree);
    animator.sync(doc);
    pinAnimations(animator);
    advance(timeline, 500);

    paint.paint(doc);
    const layer = paint.getLayers().find(l => l.bounds === el.layoutBox);
    expect(layer).toBeDefined();
    expect(layer!.opacity).toBeCloseTo(0.6, 1);

    // Stacking-context path applies the animated opacity as group alpha.
    const commands = paint.compositeFrame();
    const alphaCmd = commands.find(c => c.type === 'setGlobalAlpha');
    expect(alphaCmd).toBeDefined();
    expect(alphaCmd!.params[0]).toBeCloseTo(0.6, 1);

    timeline.dispose();
    animator.dispose();
    layout.dispose();
    paint.dispose();
  });

  it('animated values flow through the controller processFrame loop', () => {
    const { tree, doc } = buildDoc(
      '<html><body><div id="a" style="width:100px;height:100px;background-color:blue"></div></body></html>',
    );
    const layout = new LayoutEngine({ viewportWidth: 800, viewportHeight: 600, defaultFontSize: 16 });
    const paint = new PaintEngine({ width: 800, height: 600, backgroundColor: '#ffffff', devicePixelRatio: 1, showDebugBorders: false });
    const ctrl = new ReflowRepaintController(layout, paint, tree, { viewportWidth: 800, viewportHeight: 600 });
    ctrl.init(doc);

    const animator = new CssAnimationAnimator({
      domTree: tree,
      timeline: ctrl.animationTimeline,
      getKeyframes: () => new Map<string, CssKeyframesRule>([['pulse', PULSE_RULE]]),
    });
    ctrl.setAnimationAnimator(animator);
    paint.setOpacityResolver((el) => animator.resolveOpacity(el));

    const el = tree.getElementById('a') as DomElement;
    tree.setComputedStyle(el, animationStyle());

    layout.layout(doc, tree);
    paint.paint(doc);

    animator.sync(doc);
    pinElapsed(ctrl.animationTimeline, animator, 500);
    ctrl.processFrame();

    const layer = paint.getLayers().find(l => l.bounds === el.layoutBox);
    expect(layer).toBeDefined();
    expect(layer!.opacity).toBeCloseTo(0.6, 1);

    ctrl.dispose();
    layout.dispose();
    paint.dispose();
  });

  it('legacy CssParser pipe preserves @keyframes for the runtime animator', () => {
    const parser = new CssParser();

    const sheet = parser.parseStylesheet(`
      @keyframes pulse { from { opacity: 1; } to { opacity: 0.2; } }
      .anim { width: 100px; height: 100px; background: #f00; animation: pulse 1s linear infinite; }
    `);

    const kf = sheet.rules.find(r => r.keyframes);
    expect(kf?.keyframes?.name).toBe('pulse');
    expect(kf?.keyframes?.frames).toHaveLength(2);
    expect(kf?.keyframes?.frames[1].declarations.get('opacity')).toBe('0.2');

    // The keyframes entry must not disturb normal style computation.
    const computed = parser.computeStylesForElement(
      'div',
      new Map([['class', 'anim']]),
      sheet.rules,
    );
    expect(computed.get('animation-name')).toBe('pulse');
    expect(computed.get('animation-duration')).toBe('1s');

    // Rebuild the css5 sheet through the same transform page-renderer uses so
    // collectKeyframes can resolve the pulse animation.
    const css5Parser = parser.getCss5Parser();
    const rebuilt: { rules: unknown[] } = { rules: [] };
    let order = 0;
    for (const rule of sheet.rules) {
      if (rule.selector === '__external__') continue;
      if (rule.keyframes) {
        (rebuilt.rules as Array<Record<string, unknown>>).push({
          type: 'keyframes',
          name: rule.keyframes.name,
          keyframes: rule.keyframes.frames.map((kf2) => ({
            selectors: kf2.selectors,
            declarations: Array.from(kf2.declarations.entries()).map(([property, value]) => ({
              property, value, important: false,
            })),
          })),
        });
        continue;
      }
      const selector = css5Parser.parseSelector(rule.selector);
      if (!selector) continue;
      (rebuilt.rules as Array<Record<string, unknown>>).push({
        type: 'style',
        selectors: [selector],
        declarations: Array.from(rule.declarations.entries()).map(([property, value]) => ({
          property, value, important: false,
        })),
        specificity: { id: rule.specificity.id, a: rule.specificity.class, b: rule.specificity.tag },
        sourceOrder: order++,
        sourceUrl: rule.sourceUrl,
      });
    }
    const keyframes = collectKeyframes(rebuilt as never);
    expect(keyframes.has('pulse')).toBe(true);
  });
});
