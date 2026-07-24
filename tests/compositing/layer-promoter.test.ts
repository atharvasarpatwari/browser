import { describe, it, expect } from 'vitest';
import { LayerPromoter } from '../../src/browser/rendering/compositing/layer-promoter';
import type { StackingContext } from '../../src/browser/rendering/formatting/stacking';
import type { DomElement } from '../../src/browser/rendering/dom-tree';

function makeEl(id: string, style: Record<string, string> = {}, box?: { width: number; height: number }): DomElement {
  const map = new Map(Object.entries(style));
  return {
    domId: id,
    nodeType: 'element',
    tagName: 'div',
    attributes: new Map(),
    parent: null,
    children: [],
    computedStyle: map.size > 0 ? map : null,
    layoutBox: box ? {
      x: 0, y: 0, width: box.width, height: box.height,
      marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
      paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
      borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    } as any : null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    _dirtyLayout: false,
    _dirtyPaint: false,
  };
}

function makeCtx(
  el: DomElement,
  opts?: Partial<{ zIndex: number; isGrouped: boolean; groupOpacity: number }>,
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
  };
}

describe('LayerPromoter', () => {
  const promoter = new LayerPromoter(512);

  describe('shouldPromote', () => {
    it('promotes element with will-change: transform', () => {
      const el = makeEl('a', { 'will-change': 'transform' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('promotes element with will-change: opacity', () => {
      const el = makeEl('a', { 'will-change': 'opacity' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('promotes element with will-change: paint', () => {
      const el = makeEl('a', { 'will-change': 'paint' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('does not promote element with will-change: color (conservative)', () => {
      const el = makeEl('a', { 'will-change': 'color' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(false);
    });

    it('promotes element with transform', () => {
      const el = makeEl('a', { transform: 'translateX(10px)' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('does not promote element with transform: none', () => {
      const el = makeEl('a', { transform: 'none' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(false);
    });

    it('promotes element with opacity < 1', () => {
      const el = makeEl('a');
      const ctx = makeCtx(el, { isGrouped: true, groupOpacity: 0.5 });
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('promotes element with filter', () => {
      const el = makeEl('a', { filter: 'blur(1px)' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('does not promote element with filter: none', () => {
      const el = makeEl('a', { filter: 'none' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(false);
    });

    it('promotes element with isolation: isolate', () => {
      const el = makeEl('a', { isolation: 'isolate' });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('promotes large element for tiling', () => {
      const el = makeEl('a', {}, { width: 600, height: 600 });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(true);
    });

    it('does not promote small static element', () => {
      const el = makeEl('a', {}, { width: 100, height: 100 });
      const ctx = makeCtx(el);
      expect(promoter.shouldPromote(ctx)).toBe(false);
    });
  });

  describe('getHint', () => {
    it('returns detailed hint info', () => {
      const el = makeEl('a', { transform: 'translateX(10px)' }, { width: 200, height: 200 });
      const ctx = makeCtx(el);
      const hint = promoter.getHint(ctx);
      expect(hint.hasTransform).toBe(true);
      expect(hint.shouldPromote).toBe(true);
      expect(hint.reason).toBe('transform');
    });

    it('reports will-change hint', () => {
      const el = makeEl('a', { 'will-change': 'transform, opacity' });
      const ctx = makeCtx(el);
      const hint = promoter.getHint(ctx);
      expect(hint.willChange).toBe('transform, opacity');
      expect(hint.shouldPromote).toBe(true);
      expect(hint.reason).toContain('will-change');
    });
  });
});
