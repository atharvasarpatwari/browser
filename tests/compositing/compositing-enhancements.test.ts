import { describe, it, expect, vi } from 'vitest';
import {
  parseTransform, identity4x4, multiply4x4, applyTransform,
  lerpNumber, lerpColor, lerpMatrices, decomposeMatrix, isIdentity4x4,
} from '@/browser/rendering/transform-parser';
import {
  ScrollCompositor, createScrollableContainer, scrollTo, scrollBy,
  clampScroll, getScrollTransform, isScrollable, getMaxScrollX, getMaxScrollY,
} from '@/browser/rendering/compositing/scroll-compositor';
import {
  KeyframeEffect, AnimationTimeline, Animation, createAnimation,
} from '@/browser/rendering/compositing/animation-engine';
import { CompositorThread, FrameStatus } from '@/browser/rendering/compositing/compositor-thread';
import { LayerCompositor } from '@/browser/rendering/compositing/layer-compositor';

describe('TransformParser', () => {
  it('returns null for none', () => {
    expect(parseTransform('none')).toBeNull();
    expect(parseTransform('')).toBeNull();
    expect(parseTransform(null)).toBeNull();
  });

  it('parses translate', () => {
    const r = parseTransform('translate(10px, 20px)');
    expect(r).not.toBeNull();
    expect(r!.matrix.m41).toBe(10);
    expect(r!.matrix.m42).toBe(20);
  });

  it('parses translateX and translateY', () => {
    const rx = parseTransform('translateX(15px)');
    expect(rx!.matrix.m41).toBe(15);
    expect(rx!.matrix.m42).toBe(0);

    const ry = parseTransform('translateY(25px)');
    expect(ry!.matrix.m41).toBe(0);
    expect(ry!.matrix.m42).toBe(25);
  });

  it('parses scale', () => {
    const r = parseTransform('scale(2)');
    expect(r!.matrix.m11).toBe(2);
    expect(r!.matrix.m22).toBe(2);

    const r2 = parseTransform('scale(2, 3)');
    expect(r2!.matrix.m11).toBe(2);
    expect(r2!.matrix.m22).toBe(3);
  });

  it('parses rotate', () => {
    const r = parseTransform('rotate(90deg)');
    expect(r!.matrix.m11).toBeCloseTo(0, 5);
    expect(r!.matrix.m12).toBeCloseTo(1, 5);
  });

  it('parses skew', () => {
    const r = parseTransform('skewX(10deg)');
    expect(r!.matrix.m21).toBeCloseTo(Math.tan(10 * Math.PI / 180), 5);
  });

  it('parses matrix', () => {
    const r = parseTransform('matrix(1, 0, 0, 1, 100, 200)');
    expect(r!.matrix.m41).toBe(100);
    expect(r!.matrix.m42).toBe(200);
  });

  it('chains multiple transforms', () => {
    const r = parseTransform('translateX(50px) translateY(100px)');
    expect(r!.matrix.m41).toBe(50);
    expect(r!.matrix.m42).toBe(100);
  });

  it('parses 3D transforms', () => {
    const r = parseTransform('translateZ(100px)');
    expect(r!.matrix.m43).toBe(100);

    const r2 = parseTransform('rotateX(45deg)');
    expect(r2!.matrix.m22).toBeCloseTo(Math.cos(Math.PI / 4), 5);

    const r3 = parseTransform('rotateY(45deg)');
    expect(r3!.matrix.m11).toBeCloseTo(Math.cos(Math.PI / 4), 5);
  });

  it('parses scale3d', () => {
    const r = parseTransform('scale3d(1, 2, 3)');
    expect(r!.matrix.m11).toBe(1);
    expect(r!.matrix.m22).toBe(2);
    expect(r!.matrix.m33).toBe(3);
  });

  it('parses translate3d', () => {
    const r = parseTransform('translate3d(10px, 20px, 30px)');
    expect(r!.matrix.m41).toBe(10);
    expect(r!.matrix.m42).toBe(20);
    expect(r!.matrix.m43).toBe(30);
  });

  it('identity matrix', () => {
    const id = identity4x4();
    expect(id.m11).toBe(1);
    expect(id.m22).toBe(1);
    expect(id.m33).toBe(1);
    expect(id.m44).toBe(1);
    expect(isIdentity4x4(id)).toBe(true);
  });

  it('multiply applies transforms in order', () => {
    const t1 = parseTransform('translateX(100px)')!.matrix;
    const t2 = parseTransform('translateY(50px)')!.matrix;
    const combined = multiply4x4(t1, t2);
    expect(combined.m41).toBe(100);
    expect(combined.m42).toBe(50);
  });

  it('applyTransform transforms a point', () => {
    const t = parseTransform('translate(10, 20)')!.matrix;
    const p = applyTransform({ x: 5, y: 5 }, t);
    expect(p.x).toBe(15);
    expect(p.y).toBe(25);
  });

  it('lerpNumber interpolates', () => {
    expect(lerpNumber(0, 100, 0.5)).toBe(50);
    expect(lerpNumber(0, 100, 0)).toBe(0);
    expect(lerpNumber(0, 100, 1)).toBe(100);
  });

  it('lerpColor interpolates', () => {
    const c = lerpColor('#ff0000', '#0000ff', 0.5);
    expect(c).toContain('rgba');
  });

  it('lerpMatrices interpolates', () => {
    const a = parseTransform('translateX(0)')!.matrix;
    const b = parseTransform('translateX(100)')!.matrix;
    const r = lerpMatrices(a, b, 0.5);
    expect(r.m41).toBe(50);
  });

  it('decomposeMatrix returns components', () => {
    const t = parseTransform('translate(10, 20) scale(2) rotate(45deg)')!.matrix;
    const d = decomposeMatrix(t);
    expect(d.translate[0]).toBeCloseTo(10, 5);
    expect(d.translate[1]).toBeCloseTo(20, 5);
    expect(d.scale[0]).toBeCloseTo(2, 5);
  });
});

describe('ScrollCompositor', () => {
  it('creates a scrollable container', () => {
    const c = createScrollableContainer('main', 'el1', 5000, 3000, 800, 600, 'auto', 'auto');
    expect(c.scrollX).toBe(0);
    expect(c.scrollY).toBe(0);
    expect(c.scrollWidth).toBe(5000);
    expect(c.scrollHeight).toBe(3000);
    expect(isScrollable(c)).toBe(true);
  });

  it('clampScroll prevents overscroll', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    const clamped = clampScroll(c, 5000, 5000);
    expect(clamped.x).toBe(1200);
    expect(clamped.y).toBe(400);
  });

  it('scrollTo updates position', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    scrollTo(c, 100, 200);
    expect(c.scrollX).toBe(100);
    expect(c.scrollY).toBe(200);
  });

  it('scrollBy adds to position', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    scrollTo(c, 50, 50);
    scrollBy(c, 10, 20);
    expect(c.scrollX).toBe(60);
    expect(c.scrollY).toBe(70);
  });

  it('getScrollTransform returns negative offset', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    scrollTo(c, 100, 200);
    const t = getScrollTransform(c);
    expect(t.m41).toBe(-100);
    expect(t.m42).toBe(-200);
  });

  it('getMaxScroll returns max scroll position', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    expect(getMaxScrollX(c)).toBe(1200);
    expect(getMaxScrollY(c)).toBe(400);
  });

  it('ScrollCompositor manages containers', () => {
    const sc = new ScrollCompositor();
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    sc.registerContainer(c);
    expect(sc.getContainer('main')).toBe(c);
    expect(sc.getContainers().length).toBe(1);
    sc.unregisterContainer('main');
    expect(sc.getContainer('main')).toBeUndefined();
  });

  it('ScrollCompositor assigns layers to containers', () => {
    const sc = new ScrollCompositor();
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    sc.registerContainer(c);
    sc.assignLayerToContainer('layer-1', 'main');
    expect(sc.getContainerForLayer('layer-1')).toBe(c);
    sc.unassignLayer('layer-1');
    expect(sc.getContainerForLayer('layer-1')).toBeUndefined();
  });

  it('getContainerByElementId finds by element', () => {
    const sc = new ScrollCompositor();
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    sc.registerContainer(c);
    expect(sc.getContainerByElementId('el1')).toBe(c);
    expect(sc.getContainerByElementId('nonexistent')).toBeUndefined();
  });

  it('onScroll callback fires on scroll', () => {
    const fn = vi.fn();
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600);
    c.onScroll = fn;
    scrollTo(c, 50, 50);
    expect(fn).toHaveBeenCalledWith(50, 50);
  });

  it('non-scrollable container returns false', () => {
    const c = createScrollableContainer('main', 'el1', 2000, 1000, 800, 600, 'visible', 'visible');
    expect(isScrollable(c)).toBe(false);
  });

  it('clear resets all state', () => {
    const sc = new ScrollCompositor();
    sc.registerContainer(createScrollableContainer('a', 'e1', 100, 100, 50, 50));
    sc.assignLayerToContainer('l1', 'a');
    sc.clear();
    expect(sc.getContainers().length).toBe(0);
    expect(sc.getContainerForLayer('l1')).toBeUndefined();
  });
});

describe('AnimationEngine', () => {
  it('KeyframeEffect computes keyframes', () => {
    const kfs = [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ];
    const effect = new KeyframeEffect('el1', kfs, { duration: 1000 });
    const r0 = effect.compute(0);
    expect(r0.opacity).toBe('0');
    const r1 = effect.compute(1000);
    expect(r1.opacity).toBe('1');
    const rMid = effect.compute(500);
    expect(parseFloat(rMid.opacity!)).toBeCloseTo(0.5, 1);
  });

  it('KeyframeEffect handles delay and fill', () => {
    const kfs = [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ];
    const effect = new KeyframeEffect('el1', kfs, { duration: 1000, delay: 500, fill: 'backwards' });
    const r = effect.compute(0);
    expect(r.opacity).toBe('0');
  });

  it('KeyframeEffect handles iteration count', () => {
    const kfs = [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ];
    const effect = new KeyframeEffect('el1', kfs, { duration: 1000, iterations: 2 });
    const r = effect.compute(1500);
    expect(parseFloat(r.opacity!)).toBeCloseTo(0.5, 1);
  });

  it('KeyframeEffect alternate direction', () => {
    const kfs = [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ];
    const effect = new KeyframeEffect('el1', kfs, {
      duration: 1000, iterations: 2, direction: 'alternate',
    });
    const r0 = effect.compute(500);
    expect(parseFloat(r0.opacity!)).toBeCloseTo(0.5, 1);
    const r1 = effect.compute(1500);
    expect(parseFloat(r1.opacity!)).toBeCloseTo(0.5, 1);
  });

  it('Animation lifecycle: start and finish', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    expect(anim.playState).toBe('idle');
    anim.start();
    expect(anim.playState).toBe('running');
    anim.finish();
    expect(anim.playState).toBe('finished');
  });

  it('Animation pause and resume', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    anim.start();
    anim.pause();
    expect(anim.playState).toBe('paused');
    anim.start();
    expect(anim.playState).toBe('running');
    anim.finish();
  });

  it('Animation cancel triggers onCancel', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    let cancelled = false;
    anim.onCancel = () => { cancelled = true; };
    anim.start();
    anim.cancel();
    expect(cancelled).toBe(true);
    expect(anim.playState).toBe('idle');
  });

  it('Animation onFinish callback', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    let finished = false;
    anim.onFinish = () => { finished = true; };
    anim.start();
    anim.finish();
    expect(finished).toBe(true);
  });

  it('getComputedProperties returns interpolated values', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0', transform: 'translateX(0px)' } },
      { offset: 1, properties: { opacity: '1', transform: 'translateX(100px)' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    anim.start();
    const props = anim.getComputedProperties(500);
    expect(parseFloat(props.opacity!)).toBeCloseTo(0.5, 1);
  });

  it('createAnimation helper', () => {
    const anim = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 500 });
    expect(anim.playState).toBe('idle');
    expect(anim.effect.duration).toBe(500);
  });

  it('Timeline stops when no animations', () => {
    const timeline = new AnimationTimeline();
    const anim1 = createAnimation('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 100 });
    timeline.attach(anim1);
    expect(timeline.isRunning).toBe(true);
    timeline.detach(anim1);
    expect(timeline.isRunning).toBe(false);
  });

  it('reverse animation', () => {
    const effect = new KeyframeEffect('el1', [
      { offset: 0, properties: { opacity: '0' } },
      { offset: 1, properties: { opacity: '1' } },
    ], { duration: 1000 });
    const timeline = new AnimationTimeline();
    const anim = new Animation(effect, timeline);
    anim.start();
    anim.reverse();
    expect(anim.playState).toBe('running');
    anim.finish();
  });

  it('easing functions', () => {
    const kfs = [
      { offset: 0, properties: { opacity: '0' }, easing: 'ease-in' },
      { offset: 0.5, properties: { opacity: '0.5' } },
      { offset: 1, properties: { opacity: '1' }, easing: 'ease-out' },
    ];
    const effect = new KeyframeEffect('el1', kfs, { duration: 1000, easing: 'ease-in-out' });
    const r = effect.compute(500);
    expect(parseFloat(r.opacity!)).toBeGreaterThan(0);
    expect(parseFloat(r.opacity!)).toBeLessThan(1);
  });
});

describe('CompositorThread', () => {
  it('constructs with LayerCompositor', () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);
    expect(ct.compositor).toBe(lc);
    expect(ct.frameCount).toBe(0);
    ct.dispose();
  });

  it('processes a frame', async () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);

    const layerTree = {
      getCompositingOrder: () => [],
      getDirtyLayers: () => [],
      updateBounds: () => {},
      clearAllDamage: () => {},
    } as any;

    ct.scheduleFrame(layerTree);

    await new Promise<void>(resolve => {
      ct.onFrameResult((result) => {
        expect(result.status).toBe(FrameStatus.Completed);
        expect(result.imageData).not.toBeNull();
        expect(result.duration).toBeGreaterThanOrEqual(0);
        ct.dispose();
        resolve();
      });
    });
  });

  it('frame result callbacks receive data', async () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);

    const layerTree = {
      getCompositingOrder: () => [],
      getDirtyLayers: () => [],
      updateBounds: () => {},
      clearAllDamage: () => {},
    } as any;

    let called = false;
    ct.onFrameResult(() => { called = true; });
    ct.scheduleFrame(layerTree);

    await new Promise<void>(resolve => {
      setTimeout(() => {
        expect(called).toBe(true);
        ct.dispose();
        resolve();
      }, 50);
    });
  });

  it('maintains scroll compositor', () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);
    expect(ct.scrollCompositor).toBeDefined();
    ct.dispose();
  });

  it('maintains animation timeline', () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);
    expect(ct.animationTimeline).toBeDefined();
    ct.dispose();
  });

  it('resize delegates to compositor', () => {
    const lc = new LayerCompositor({ width: 100, height: 100 });
    const ct = new CompositorThread(lc);
    ct.resize(200, 200);
    ct.dispose();
  });
});
