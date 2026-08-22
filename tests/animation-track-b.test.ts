import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KeyframeEffect,
  Animation,
  AnimationTimeline,
  createAnimation,
} from '../src/browser/rendering/compositing/animation-engine';
import { parseTransform, lerpMatrices, lerpColor, lerpNumber } from '../src/browser/rendering/transform-parser';
import { CssTransitionEngine } from '../src/browser/rendering/css-transitions';
import type { IDomTree, DomElement, DomDocument } from '../src/browser/rendering/dom-tree';
import { evaluatePrefersReducedMotion } from '../src/browser/rendering/css5/cascade';
import type { AnimationFrameService } from '../src/browser/media/request-animation-frame';

// ── lerpColor ────────────────────────────────────────────────────────────────
describe('lerpColor', () => {
  it('interpolates hex colors', () => {
    const result = lerpColor('#000000', '#ffffff', 0.5);
    expect(result).toBe('rgba(128,128,128,1)');
  });

  it('interpolates short hex colors', () => {
    const result = lerpColor('#000', '#fff', 0.5);
    expect(result).toBe('rgba(128,128,128,1)');
  });

  it('interpolates rgb() colors', () => {
    const result = lerpColor('rgb(0,0,0)', 'rgb(255,255,255)', 0.5);
    expect(result).toBe('rgba(128,128,128,1)');
  });

  it('interpolates rgba() colors', () => {
    const result = lerpColor('rgba(0,0,0,0)', 'rgba(255,255,255,1)', 0.5);
    expect(result).toBe('rgba(128,128,128,0.5)');
  });

  it('interpolates rgba() with partial alpha', () => {
    const result = lerpColor('rgba(255,0,0,0.5)', 'rgba(0,0,255,1)', 0.5);
    const match = result.match(/rgba\(128,0,128,([\d.]+)\)/);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1]!)).toBeCloseTo(0.75, 2);
  });

  it('returns start color at t=0', () => {
    const result = lerpColor('#ff0000', '#00ff00', 0);
    expect(result).toBe('rgba(255,0,0,1)');
  });

  it('returns end color at t=1', () => {
    const result = lerpColor('#ff0000', '#00ff00', 1);
    expect(result).toBe('rgba(0,255,0,1)');
  });

  it('handles mixed hex and rgb inputs', () => {
    const result = lerpColor('#ff0000', 'rgb(0,255,0)', 0.5);
    expect(result).toBe('rgba(128,128,0,1)');
  });

  it('falls back for unrecognized colors', () => {
    const result = lerpColor('currentColor', '#ff0000', 0.5);
    expect(result).toBe('rgba(128,0,0,1)');
  });
});

// ── interpolateProperty for color properties ─────────────────────────────────
describe('interpolateProperty for color properties', () => {
  function makeEffect(target: string, keyframes: any[], opts?: any) {
    return new KeyframeEffect(target, keyframes, opts);
  }

  it('interpolates background-color between hex values', () => {
    const effect = makeEffect('el1', [
      { offset: 0, properties: { 'background-color': '#ff0000' } },
      { offset: 1, properties: { 'background-color': '#00ff00' } },
    ]);
    const anim = new Animation(effect, new AnimationTimeline());
    anim.start();
    const mid = effect.compute(effect.duration / 2);
    expect(mid['background-color']).toContain('128');
  });

  it('interpolates color property with rgb() values', () => {
    const effect = makeEffect('el2', [
      { offset: 0, properties: { 'color': 'rgb(255,0,0)' } },
      { offset: 1, properties: { 'color': 'rgb(0,0,255)' } },
    ]);
    const anim = new Animation(effect, new AnimationTimeline());
    anim.start();
    const mid = effect.compute(effect.duration / 2);
    expect(mid['color']).toContain('128');
  });

  it('interpolates border-color', () => {
    const effect = makeEffect('el3', [
      { offset: 0, properties: { 'border-color': '#000000' } },
      { offset: 1, properties: { 'border-color': '#ffffff' } },
    ]);
    const anim = new Animation(effect, new AnimationTimeline());
    anim.start();
    const mid = effect.compute(effect.duration / 2);
    expect(mid['border-color']).toContain('128');
  });
});

// ── Animation events ─────────────────────────────────────────────────────────
describe('Animation events', () => {
  let frameId = 0;
  const frames: Array<{ id: number; callback: (now: number) => void }> = [];
  const fakeFrameService = {
    request: (cb: (now: number) => void) => {
      const id = ++frameId;
      frames.push({ id, callback: cb });
      return id;
    },
    cancel: (id: number) => {
      const idx = frames.findIndex(f => f.id === id);
      if (idx !== -1) frames.splice(idx, 1);
    },
    dispose: () => { frames.length = 0; },
  };

  beforeEach(() => {
    frameId = 0;
    frames.length = 0;
  });

  it('dispatches animationstart on first tick', () => {
    const timeline = new AnimationTimeline(fakeFrameService as unknown as AnimationFrameService);
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const anim = new Animation(effect, timeline);
    const events: string[] = [];
    anim.setEventHandler((e) => { events.push(e.type); });
    anim.start();

    // Trigger first frame
    if (frames.length > 0) {
      frames[0]!.callback(performance.now());
    }

    expect(events).toContain('animationstart');
    timeline.dispose();
  });

  it('dispatches animationend when finished', () => {
    const timeline = new AnimationTimeline(fakeFrameService as unknown as AnimationFrameService);
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100 });
    const anim = new Animation(effect, timeline);
    const events: string[] = [];
    anim.setEventHandler((e) => { events.push(e.type); });
    anim.start();

    // Simulate enough time to finish
    for (const frame of frames) {
      frame.callback(performance.now() + 200);
    }

    expect(events).toContain('animationend');
    timeline.dispose();
  });

  it('dispatches animationiteration on iteration boundary', () => {
    const timeline = new AnimationTimeline(fakeFrameService as unknown as AnimationFrameService);
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100, iterations: 3 });
    const anim = new Animation(effect, timeline);
    const events: string[] = [];
    anim.setEventHandler((e) => { events.push(e.type); });
    anim.start();

    // Simulate past first iteration
    const startTime = performance.now();
    for (let i = 0; i < 5; i++) {
      if (frames.length > 0) {
        const frame = frames[0]!;
        frame.callback(startTime + 100 * (i + 1));
      }
    }

    expect(events).toContain('animationiteration');
    timeline.dispose();
  });
});

// ── Animation pauseAll/resumeAll ─────────────────────────────────────────────
describe('AnimationTimeline pauseAll/resumeAll', () => {
  let frameId = 0;
  const frames: Array<{ id: number; callback: (now: number) => void }> = [];
  const fakeFrameService = {
    request: (cb: (now: number) => void) => {
      const id = ++frameId;
      frames.push({ id, callback: cb });
      return id;
    },
    cancel: (id: number) => {
      const idx = frames.findIndex(f => f.id === id);
      if (idx !== -1) frames.splice(idx, 1);
    },
    dispose: () => { frames.length = 0; },
  };

  beforeEach(() => {
    frameId = 0;
    frames.length = 0;
  });

  it('pauses all running animations', () => {
    const timeline = new AnimationTimeline(fakeFrameService as unknown as AnimationFrameService);
    const effect1 = new KeyframeEffect('a', [{ offset: 0, properties: { opacity: '0' } }, { offset: 1, properties: { opacity: '1' } }], { duration: 1000 });
    const effect2 = new KeyframeEffect('b', [{ offset: 0, properties: { opacity: '0' } }, { offset: 1, properties: { opacity: '1' } }], { duration: 1000 });
    const anim1 = new Animation(effect1, timeline);
    const anim2 = new Animation(effect2, timeline);
    anim1.start();
    anim2.start();

    timeline.pauseAll();

    expect(anim1.playState).toBe('paused');
    expect(anim2.playState).toBe('paused');
    timeline.dispose();
  });

  it('resumes all paused animations', () => {
    const timeline = new AnimationTimeline(fakeFrameService as unknown as AnimationFrameService);
    const effect = new KeyframeEffect('a', [{ offset: 0, properties: { opacity: '0' } }, { offset: 1, properties: { opacity: '1' } }], { duration: 1000 });
    const anim = new Animation(effect, timeline);
    anim.start();
    anim.pause();

    timeline.resumeAll();

    expect(anim.playState).toBe('running');
    timeline.dispose();
  });
});

// ── CssTransitionEngine ──────────────────────────────────────────────────────
function createMockDomElement(id: string, style: Record<string, string> = {}): DomElement {
  const computedStyle = new Map(Object.entries(style));
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    parent: null,
    children: [],
    _dirtyStyle: false,
    _dirtyLayout: false,
    _dirtyPaint: false,
    attributes: new Map(),
    computedStyle,
    usedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
  };
}

function createMockDocument(elements: DomElement[]): DomDocument {
  for (let i = 1; i < elements.length; i++) {
    (elements[i]! as any).parent = elements[i - 1]!;
    (elements[i - 1]! as any).children.push(elements[i]!);
  }
  return {
    domId: 'doc',
    nodeType: 'document',
    parent: null,
    children: elements as any,
    _dirtyStyle: false,
    _dirtyLayout: false,
    _dirtyPaint: false,
    htmlElement: elements[0] ?? null,
    headElement: null,
    bodyElement: elements[0] ?? null,
  } as DomDocument;
}

describe('CssTransitionEngine', () => {
  it('parses transition-* longhands and detects property changes', () => {
    const el = createMockDomElement('el1', {
      'transition-property': 'opacity',
      'transition-duration': '300ms',
      'transition-delay': '0s',
      'transition-timing-function': 'ease',
      'opacity': '1',
    });
    const doc = createMockDocument([el]);
    const domTree: IDomTree = {
      getDocument: () => doc,
      getElementById: () => null,
      markDirty: vi.fn(),
    } as any;
    const timeline = new AnimationTimeline();
    const engine = new CssTransitionEngine({
      domTree,
      timeline,
      registerAnimation: vi.fn(),
      unregisterAnimation: vi.fn(),
    });

    // First sync — establishes baseline
    engine.sync(doc);
    expect(el.computedStyle!.get('opacity')).toBe('1');

    // Change the property
    el.computedStyle!.set('opacity', '0.5');
    engine.sync(doc);

    // Should have registered an animation
    expect(timeline._animations.size).toBe(1);
    engine.dispose();
    timeline.dispose();
  });

  it('skips transition when duration is 0', () => {
    const el = createMockDomElement('el1', {
      'transition-property': 'opacity',
      'transition-duration': '0s',
      'opacity': '1',
    });
    const doc = createMockDocument([el]);
    const domTree: IDomTree = {
      getDocument: () => doc,
      getElementById: () => null,
      markDirty: vi.fn(),
    } as any;
    const timeline = new AnimationTimeline();
    const engine = new CssTransitionEngine({
      domTree,
      timeline,
      registerAnimation: vi.fn(),
      unregisterAnimation: vi.fn(),
    });

    engine.sync(doc);
    el.computedStyle!.set('opacity', '0.5');
    engine.sync(doc);

    expect(timeline._animations.size).toBe(0);
    engine.dispose();
    timeline.dispose();
  });

  it('handles comma-separated transition properties', () => {
    const el = createMockDomElement('el1', {
      'transition-property': 'opacity, background-color',
      'transition-duration': '200ms, 500ms',
      'transition-delay': '0s, 100ms',
      'transition-timing-function': 'ease, linear',
      'opacity': '1',
      'background-color': '#ff0000',
    });
    const doc = createMockDocument([el]);
    const domTree: IDomTree = {
      getDocument: () => doc,
      getElementById: () => null,
      markDirty: vi.fn(),
    } as any;
    const timeline = new AnimationTimeline();
    const engine = new CssTransitionEngine({
      domTree,
      timeline,
      registerAnimation: vi.fn(),
      unregisterAnimation: vi.fn(),
    });

    engine.sync(doc);
    el.computedStyle!.set('opacity', '0');
    el.computedStyle!.set('background-color', '#00ff00');
    engine.sync(doc);

    // Should register one animation per changed property
    expect(timeline._animations.size).toBe(2);
    engine.dispose();
    timeline.dispose();
  });

  it('cancels transition when element is removed', () => {
    const el = createMockDomElement('el1', {
      'transition-property': 'opacity',
      'transition-duration': '300ms',
      'opacity': '1',
    });
    const doc = createMockDocument([el]);
    const domTree: IDomTree = {
      getDocument: () => doc,
      getElementById: () => null,
      markDirty: vi.fn(),
    } as any;
    const timeline = new AnimationTimeline();
    const unregisterFn = vi.fn();
    const engine = new CssTransitionEngine({
      domTree,
      timeline,
      registerAnimation: vi.fn(),
      unregisterAnimation: unregisterFn,
    });

    engine.sync(doc);
    el.computedStyle!.set('opacity', '0.5');
    engine.sync(doc);
    expect(timeline._animations.size).toBe(1);

    // Remove element from DOM
    (doc as any).children = [];
    (doc as any).bodyElement = null;
    (doc as any).htmlElement = null;
    engine.sync(doc);

    // Animation should be cancelled
    expect(timeline._animations.size).toBe(0);
    expect(unregisterFn).toHaveBeenCalled();
    engine.dispose();
    timeline.dispose();
  });
});

// ── evaluatePrefersReducedMotion ─────────────────────────────────────────────
describe('evaluatePrefersReducedMotion', () => {
  it('returns false (not reduced) by default', () => {
    expect(evaluatePrefersReducedMotion()).toBe(false);
  });

  it('returns false with explicit viewport', () => {
    expect(evaluatePrefersReducedMotion({ width: 1920, height: 1080 })).toBe(false);
  });
});

// ── KeyframeEffect easing parsing ────────────────────────────────────────────
describe('KeyframeEffect easing', () => {
  it('parses cubic-bezier easing', () => {
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1', easing: 'cubic-bezier(0.42,0,0.58,1)' } },
    ], { duration: 1000 });
    const mid = effect.compute(500);
    expect(mid['opacity']).toBeDefined();
  });

  it('handles step easing', () => {
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000, easing: 'linear' });
    const mid = effect.compute(500);
    expect(parseFloat(mid['opacity'])).toBeCloseTo(0.5, 1);
  });
});

// ── Animation fill modes ─────────────────────────────────────────────────────
describe('Animation fill modes', () => {
  it('forwards fill keeps final state after animation ends', () => {
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100, fill: 'forwards' });
    const anim = new Animation(effect, new AnimationTimeline());
    anim.start();
    anim.finish();
    expect(anim.getComputedProperties(200)['opacity']).toBe('1');
  });

  it('backwards fill shows first keyframe before start', () => {
    const effect = new KeyframeEffect('target', [
      { offset: 0, properties: { opacity: '0.5' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100, delay: 50, fill: 'backwards' });
    const anim = new Animation(effect, new AnimationTimeline());
    anim.start();
    // Before delay expires
    expect(anim.getComputedProperties(20)['opacity']).toBe('0.5');
  });
});
