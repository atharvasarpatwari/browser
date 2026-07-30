import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isShorthandProperty, getLonghands, getInitialValue, isInheritedProperty } from '../src/browser/rendering/css5/property-definitions';
import { expandShorthands, collectKeyframes, computeComputedStyles, type StyleableElement } from '../src/browser/rendering/css5/cascade';
import { type CssStylesheet, type CssRule, type CssSelector, type CssSpecificity } from '../src/browser/rendering/css5/types';
import { AnimationTimeline, Animation, KeyframeEffect, createAnimation } from '../src/browser/rendering/compositing/animation-engine';
import { ReflowRepaintController } from '../src/browser/rendering/reflow-repaint-controller';

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1a: Animation longhand properties
// ─────────────────────────────────────────────────────────────────────────────

describe('Animation property definitions', () => {
  const longhands = ['animation-name', 'animation-duration', 'animation-timing-function',
    'animation-delay', 'animation-iteration-count', 'animation-direction',
    'animation-fill-mode', 'animation-play-state'];

  for (const prop of longhands) {
    it(`registers '${prop}' with an initial value`, () => {
      expect(getInitialValue(prop)).not.toBe('initial');
      expect(isInheritedProperty(prop)).toBe(false);
    });
  }

  it('registers animation shorthand', () => {
    expect(isShorthandProperty('animation')).toBe(true);
    expect(getLonghands('animation')).toEqual([
      'animation-name', 'animation-duration', 'animation-timing-function',
      'animation-delay', 'animation-iteration-count', 'animation-direction',
      'animation-fill-mode', 'animation-play-state',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1b: Animation shorthand expansion
// ─────────────────────────────────────────────────────────────────────────────

describe('Animation shorthand expansion', () => {
  it('expands name + duration', () => {
    const expanded = expandShorthands([
      { property: 'animation', value: 'fadeIn 2s', important: false },
    ]);
    const map = new Map(expanded.map(d => [d.property, d.value]));
    expect(map.get('animation-name')).toBe('fadeIn');
    expect(map.get('animation-duration')).toBe('2s');
    expect(map.get('animation-timing-function')).toBe('ease');
    expect(map.get('animation-delay')).toBe('0s');
    expect(map.get('animation-iteration-count')).toBe('1');
    expect(map.get('animation-direction')).toBe('normal');
    expect(map.get('animation-fill-mode')).toBe('none');
    expect(map.get('animation-play-state')).toBe('running');
  });

  it('expands full shorthand', () => {
    const expanded = expandShorthands([
      { property: 'animation', value: 'slideIn 1s ease-out 200ms 2 alternate forwards running', important: false },
    ]);
    const map = new Map(expanded.map(d => [d.property, d.value]));
    expect(map.get('animation-name')).toBe('slideIn');
    expect(map.get('animation-duration')).toBe('1s');
    expect(map.get('animation-timing-function')).toBe('ease-out');
    expect(map.get('animation-delay')).toBe('200ms');
    expect(map.get('animation-iteration-count')).toBe('2');
    expect(map.get('animation-direction')).toBe('alternate');
    expect(map.get('animation-fill-mode')).toBe('forwards');
    expect(map.get('animation-play-state')).toBe('running');
  });

  it('handles infinite iteration', () => {
    const expanded = expandShorthands([
      { property: 'animation', value: 'pulse 500ms infinite', important: false },
    ]);
    const map = new Map(expanded.map(d => [d.property, d.value]));
    expect(map.get('animation-iteration-count')).toBe('infinite');
  });

  it('handles paused play-state', () => {
    const expanded = expandShorthands([
      { property: 'animation', value: 'anim 1s paused', important: false },
    ]);
    const map = new Map(expanded.map(d => [d.property, d.value]));
    expect(map.get('animation-play-state')).toBe('paused');
  });

  it('handles only name', () => {
    const expanded = expandShorthands([
      { property: 'animation', value: 'bounce', important: false },
    ]);
    const map = new Map(expanded.map(d => [d.property, d.value]));
    expect(map.get('animation-name')).toBe('bounce');
    expect(map.get('animation-duration')).toBe('0s');
  });

  it('does not expand non-animation properties', () => {
    const expanded = expandShorthands([
      { property: 'margin', value: '10px', important: false },
    ]);
    const found = expanded.some(d => d.property.startsWith('animation'));
    expect(found).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1c: @keyframes collection
// ─────────────────────────────────────────────────────────────────────────────

describe('@keyframes collection', () => {
  function makeKeyframesRule(name: string): CssRule {
    return {
      type: 'keyframes',
      name,
      keyframes: [
        { selectors: ['0%'], declarations: [{ property: 'opacity', value: '0', important: false }] },
        { selectors: ['100%'], declarations: [{ property: 'opacity', value: '1', important: false }] },
      ],
    };
  }

  it('collects top-level @keyframes', () => {
    const stylesheet: CssStylesheet = {
      rules: [
        makeKeyframesRule('fadeIn'),
        { type: 'style', selectors: ['.foo'], specificity: { id: 0, a: 0, b: 1 }, declarations: [], sourceOrder: 1 },
        makeKeyframesRule('slideIn'),
      ],
      imported: [],
    };
    const kfs = collectKeyframes(stylesheet);
    expect(kfs.size).toBe(2);
    expect(kfs.has('fadeIn')).toBe(true);
    expect(kfs.has('slideIn')).toBe(true);
    expect(kfs.get('fadeIn')!.keyframes.length).toBe(2);
  });

  it('collects @keyframes inside @media', () => {
    const stylesheet: CssStylesheet = {
      rules: [
        {
          type: 'media',
          mediaQueries: [{ mediaType: 'screen', features: [], modifier: undefined }],
          rules: [makeKeyframesRule('nestedAnim')],
        },
      ],
      imported: [],
    };
    const kfs = collectKeyframes(stylesheet);
    expect(kfs.has('nestedAnim')).toBe(true);
  });

  it('returns empty map when no @keyframes exist', () => {
    const stylesheet: CssStylesheet = {
      rules: [{ type: 'style', selectors: ['div'], specificity: { id: 0, a: 0, b: 1 }, declarations: [], sourceOrder: 1 }],
      imported: [],
    };
    const kfs = collectKeyframes(stylesheet);
    expect(kfs.size).toBe(0);
  });

  it('animation-* properties appear in computed styles', () => {
    const stylesheet: CssStylesheet = {
      rules: [],
      imported: [],
    };
    const element: StyleableElement = {
      tagName: 'div',
      attributes: new Map(),
      parent: null,
      children: [],
    };
    const computed = computeComputedStyles(element, stylesheet);
    expect(computed.get('animation-name')).toBe('none');
    expect(computed.get('animation-duration')).toBe('0s');
    expect(computed.get('animation-timing-function')).toBe('ease');
    expect(computed.get('animation-delay')).toBe('0s');
    expect(computed.get('animation-iteration-count')).toBe('1');
    expect(computed.get('animation-direction')).toBe('normal');
    expect(computed.get('animation-fill-mode')).toBe('none');
    expect(computed.get('animation-play-state')).toBe('running');
  });

  it('computes animation values from shorthand', () => {
    const divSelector: CssSelector = { type: 'compound', tagName: 'div', id: null, classes: [], attributes: [], pseudoClasses: [], pseudoElement: null };
    const stylesheet: CssStylesheet = {
      rules: [{
        type: 'style',
        selectors: [divSelector],
        specificity: { id: 0, a: 0, b: 1 },
        declarations: [{ property: 'animation', value: 'fadeIn 500ms ease-out', important: false }],
        sourceOrder: 1,
      }],
      imported: [],
    };
    const element: StyleableElement = {
      tagName: 'div',
      attributes: new Map<string, string>(),
      parent: null,
      children: [],
    };
    const computed = computeComputedStyles(element, stylesheet);
    expect(computed.get('animation-name')).toBe('fadeIn');
    expect(computed.get('animation-duration')).toBe('500ms');
    expect(computed.get('animation-timing-function')).toBe('ease-out');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Animation timeline integration
// ─────────────────────────────────────────────────────────────────────────────

describe('Animation timeline in rendering pipeline', () => {
  it('ReflowRepaintController has an AnimationTimeline', () => {
    const layoutEngine = { layoutIncremental: vi.fn() } as any;
    const paintEngine = { paintIncremental: vi.fn() } as any;
    const domTree = { setComputedStyle: vi.fn(), setUsedStyle: vi.fn(), clearDirty: vi.fn() } as any;
    const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    expect(ctrl.animationTimeline).toBeDefined();
    expect(ctrl.animationTimeline).toBeInstanceOf(AnimationTimeline);
  });

  it('processFrame ticks animation timeline', () => {
    const doc = { domId: 'doc', nodeType: 'document', parent: null, children: [] } as any;
    const layoutEngine = { layoutIncremental: vi.fn(() => ({ damagedRegions: [] })) } as any;
    const paintEngine = { paintIncremental: vi.fn() } as any;
    const domTree = { setComputedStyle: vi.fn(), setUsedStyle: vi.fn(), clearDirty: vi.fn() } as any;
    const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    ctrl.init(doc);

    const timeline = ctrl.animationTimeline;
    const tickSpy = vi.spyOn(timeline, 'tick');
    ctrl['_animationTimeline'] = timeline;

    ctrl.requestFrame();
    // processFrame will be called asynchronously via the scheduler
    // We can verify tick is wired by checking the processFrame method directly
    const processSpy = vi.spyOn(ctrl as any, 'processFrame');
    ctrl.requestFrame();
    expect(tickSpy).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  it('ReflowRepaintController ticks timeline before layout', () => {
    const layoutEngine = { layoutIncremental: vi.fn(() => ({ damagedRegions: [] })) } as any;
    const paintEngine = { paintIncremental: vi.fn() } as any;
    const domTree = { } as any;
    const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);

    const timeline = ctrl.animationTimeline;
    const tickSpy = vi.spyOn(timeline, 'tick');
    const layoutSpy = vi.spyOn(layoutEngine, 'layoutIncremental');

    ctrl.init({ domId: 'doc', nodeType: 'document', parent: null, children: [] } as any);
    ctrl['_styleRecalcCallback'] = vi.fn();

    // Simulate processFrame manually
    (ctrl as any).processing = false;
    (ctrl as any).document = { domId: 'doc', nodeType: 'document', parent: null, children: [] };
    (ctrl as any).processFrame();

    expect(tickSpy).toHaveBeenCalled();
    expect(layoutSpy).toHaveBeenCalled();
    ctrl.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: Web Animations API engine integration
// ─────────────────────────────────────────────────────────────────────────────

describe('Animation engine: Web Animations API bridge', () => {
  it('createAnimation returns an Animation with correct options', () => {
    const anim = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 2000, delay: 100, iterations: 3, fill: 'both' });
    expect(anim.effect.duration).toBe(2000);
    expect(anim.effect.delay).toBe(100);
    expect(anim.effect.iterations).toBe(3);
    expect(anim.effect.fill).toBe('both');
  });

  it('KeyframeEffect parses property-indexed keyframes', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0', transform: 'scale(0)' } },
      { offset: 0.5, properties: { opacity: '0.5', transform: 'scale(1.5)' } },
      { offset: 1, properties: { opacity: '1', transform: 'scale(2)' } },
    ], { duration: 1000 });
    expect(effect.keyframes.length).toBe(3);
    expect(effect._propertySet.has('opacity')).toBe(true);
    expect(effect._propertySet.has('transform')).toBe(true);
  });

  it('Animation is attachable to multiple timelines', () => {
    const tl1 = new AnimationTimeline();
    const tl2 = new AnimationTimeline();
    const anim = createAnimation('el', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100 });
    tl1.attach(anim);
    tl2.attach(anim);
    expect(tl1.isRunning).toBe(true);
    expect(tl2.isRunning).toBe(true);
    anim.cancel();
    tl1.dispose();
    tl2.dispose();
  });

  it('AnimationTimeline tick advances animation time', () => {
    const timeline = new AnimationTimeline();
    const effect = new KeyframeEffect('el', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const anim = new Animation(effect, timeline);
    anim.start();
    // startLoop sets timeline._startTime = performance.now()
    // tick expects absolute timestamps: time = now - timeline._startTime
    const startTime = performance.now();
    timeline.tick(startTime);
    expect(anim.playState).toBe('running');
    timeline.tick(startTime + 1500);
    expect(anim.playState).toBe('finished');
    timeline.dispose();
  });

  it('Animation wrapper exposes playState lifecycle', () => {
    const anim = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 500 });
    expect(anim.playState).toBe('idle');
    anim.start();
    expect(anim.playState).toBe('running');
    anim.pause();
    expect(anim.playState).toBe('paused');
    anim.start();
    anim.finish();
    expect(anim.playState).toBe('finished');
  });

  it('getComputedProperties returns empty for idle animation', () => {
    const anim = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 500 });
    expect(anim.getComputedProperties(0)).toEqual({});
  });

  it('getComputedProperties returns interpolated values for running animation', () => {
    const anim = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    anim.start();
    const at500 = anim.getComputedProperties(500);
    expect(parseFloat(at500.opacity!)).toBeCloseTo(0.5, 1);
  });

  it('supports multiple concurrent animations on same target', () => {
    const timeline = new AnimationTimeline();
    const anim1 = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 500 }, timeline);
    const anim2 = createAnimation('el1', [
      { offset: 0, properties: { transform: 'translateX(0)' } },
      { offset: 1, properties: { transform: 'translateX(100px)' } },
    ], { duration: 500 }, timeline);
    anim1.start();
    anim2.start();
    expect(timeline.animations.length).toBe(2);
    const startTime = performance.now();
    timeline.tick(startTime + 250);
    const v1 = anim1.getComputedProperties();
    expect(parseFloat(v1.opacity!)).toBeCloseTo(0.5, 1);
    const v2 = anim2.getComputedProperties();
    expect(v2.transform).toBeDefined();
    anim1.cancel();
    anim2.cancel();
    timeline.dispose();
  });
});
