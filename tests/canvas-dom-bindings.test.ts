import { describe, it, expect } from 'vitest';
import { createDocumentBinding, wrapElement } from '../src/browser/js/dom-bindings';
import { createObject, createNativeFunction, type JSValue, type JSObject } from '../src/browser/js/values';
import { DomTree, type DomDocument, type DomElement } from '../src/browser/rendering/dom-tree';

function makeDomTree(): { domTree: DomTree; doc: DomDocument } {
  const domTree = new DomTree();
  const doc = domTree.getDocument();
  return { domTree, doc };
}

function createCanvasElement(domTree: DomTree, width = 300, height = 150): DomElement {
  const el: DomElement = {
    domId: `test-canvas-${Date.now()}`,
    nodeType: 'element',
    parent: null,
    children: [],
    tagName: 'canvas',
    attributes: new Map([
      ['width', String(width)],
      ['height', String(height)],
    ]),
    computedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    _dirtyLayout: true,
    _dirtyPaint: true,
  };
  return el;
}

describe('Canvas 2D DOM Bindings', () => {
  describe('wrapElement — canvas tag', () => {
    it('exposes getContext on canvas elements', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      expect(wrapper.properties.has('getContext')).toBe(true);
    });

    it('getContext("2d") returns a wrapped context', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      const getCtx = wrapper.properties.get('getContext')!.value as any;
      const ctxWrapper = getCtx.nativeFn(wrapper, ['2d']);
      expect(ctxWrapper).not.toBeNull();
      expect(ctxWrapper.properties.has('fillRect')).toBe(true);
      expect(ctxWrapper.properties.has('strokeRect')).toBe(true);
      expect(ctxWrapper.properties.has('beginPath')).toBe(true);
    });

    it('getContext("2d") returns same wrapper on repeated calls', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      const getCtx = wrapper.properties.get('getContext')!.value as any;
      const ctx1 = getCtx.nativeFn(wrapper, ['2d']);
      const ctx2 = getCtx.nativeFn(wrapper, ['2d']);
      expect(ctx1).toBe(ctx2);
    });

    it('getContext("webgl") returns null', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      const getCtx = wrapper.properties.get('getContext')!.value as any;
      const result = getCtx.nativeFn(wrapper, ['webgl']);
      expect(result).toBeNull();
    });

    it('exposes width and height properties', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree, 640, 480);
      const wrapper = wrapElement(el, domTree);
      expect(wrapper.properties.has('width')).toBe(true);
      expect(wrapper.properties.has('height')).toBe(true);
    });

    it('width getter returns canvas width', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree, 640, 480);
      const wrapper = wrapElement(el, domTree);
      const getWidth = wrapper.properties.get('width')!.getter as any;
      expect(getWidth.nativeFn(wrapper, [])).toBe(640);
    });

    it('height getter returns canvas height', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree, 640, 480);
      const wrapper = wrapElement(el, domTree);
      const getHeight = wrapper.properties.get('height')!.getter as any;
      expect(getHeight.nativeFn(wrapper, [])).toBe(480);
    });

    it('width setter updates the underlying HTMLCanvasElement', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree, 300, 150);
      const wrapper = wrapElement(el, domTree);
      const setWidth = wrapper.properties.get('width')!.setter as any;
      setWidth.nativeFn(wrapper, [800]);
      const getWidth = wrapper.properties.get('width')!.getter as any;
      expect(getWidth.nativeFn(wrapper, [])).toBe(800);
    });

    it('exposes toDataURL method', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      expect(wrapper.properties.has('toDataURL')).toBe(true);
    });

    it('toDataURL returns a data URL string', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const wrapper = wrapElement(el, domTree);
      const toDataURL = wrapper.properties.get('toDataURL')!.value as any;
      const result = toDataURL.nativeFn(wrapper, []);
      expect(typeof result).toBe('string');
      expect(result).toContain('data:image/png');
    });
  });

  describe('Canvas 2D context wrapper — drawing methods', () => {
    function getCtx(el: DomElement, domTree: DomTree): JSObject {
      const wrapper = wrapElement(el, domTree);
      const getCtxFn = wrapper.properties.get('getContext')!.value as any;
      return getCtxFn.nativeFn(wrapper, ['2d']);
    }

    it('fillRect works without error', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const fillRect = ctx.properties.get('fillRect')!.value as any;
      expect(() => fillRect.nativeFn(ctx, [0, 0, 100, 100])).not.toThrow();
    });

    it('strokeRect works without error', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const strokeRect = ctx.properties.get('strokeRect')!.value as any;
      expect(() => strokeRect.nativeFn(ctx, [10, 10, 50, 50])).not.toThrow();
    });

    it('clearRect works without error', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const clearRect = ctx.properties.get('clearRect')!.value as any;
      expect(() => clearRect.nativeFn(ctx, [0, 0, 300, 150])).not.toThrow();
    });

    it('beginPath/closePath/moveTo/lineTo works', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const beginPath = ctx.properties.get('beginPath')!.value as any;
      const moveTo = ctx.properties.get('moveTo')!.value as any;
      const lineTo = ctx.properties.get('lineTo')!.value as any;
      const closePath = ctx.properties.get('closePath')!.value as any;
      const stroke = ctx.properties.get('stroke')!.value as any;
      expect(() => {
        beginPath.nativeFn(ctx, []);
        moveTo.nativeFn(ctx, [10, 10]);
        lineTo.nativeFn(ctx, [100, 100]);
        closePath.nativeFn(ctx, []);
        stroke.nativeFn(ctx, []);
      }).not.toThrow();
    });

    it('arc works', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const beginPath = ctx.properties.get('beginPath')!.value as any;
      const arc = ctx.properties.get('arc')!.value as any;
      const fill = ctx.properties.get('fill')!.value as any;
      expect(() => {
        beginPath.nativeFn(ctx, []);
        arc.nativeFn(ctx, [150, 75, 50, 0, Math.PI * 2]);
        fill.nativeFn(ctx, []);
      }).not.toThrow();
    });

    it('fillText works', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const fillText = ctx.properties.get('fillText')!.value as any;
      expect(() => fillText.nativeFn(ctx, ['Hello', 10, 30])).not.toThrow();
    });

    it('measureText returns width', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const measureText = ctx.properties.get('measureText')!.value as any;
      const result = measureText.nativeFn(ctx, ['Hello World']);
      expect(result.properties.has('width')).toBe(true);
    });

    it('save/restore round-trip', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const save = ctx.properties.get('save')!.value as any;
      const restore = ctx.properties.get('restore')!.value as any;
      expect(() => {
        save.nativeFn(ctx, []);
        restore.nativeFn(ctx, []);
      }).not.toThrow();
    });

    it('translate/rotate/scale work', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const translate = ctx.properties.get('translate')!.value as any;
      const rotate = ctx.properties.get('rotate')!.value as any;
      const scale = ctx.properties.get('scale')!.value as any;
      expect(() => {
        translate.nativeFn(ctx, [10, 20]);
        rotate.nativeFn(ctx, [0.5]);
        scale.nativeFn(ctx, [2, 2]);
      }).not.toThrow();
    });

    it('setLineDash/getLineDash round-trip', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setLineDash = ctx.properties.get('setLineDash')!.value as any;
      const getLineDash = ctx.properties.get('getLineDash')!.value as any;
      setLineDash.nativeFn(ctx, [[5, 10]]);
      const result = getLineDash.nativeFn(ctx, []);
      expect(result.properties.get('length')!.value).toBe(2);
    });

    it('createLinearGradient returns gradient wrapper', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const createLinearGradient = ctx.properties.get('createLinearGradient')!.value as any;
      const grad = createLinearGradient.nativeFn(ctx, [0, 0, 200, 0]);
      expect(grad).not.toBeNull();
      expect(grad.properties.has('addColorStop')).toBe(true);
    });

    it('createRadialGradient returns gradient wrapper', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const createRadialGradient = ctx.properties.get('createRadialGradient')!.value as any;
      const grad = createRadialGradient.nativeFn(ctx, [50, 50, 10, 100, 100, 80]);
      expect(grad).not.toBeNull();
      expect(grad.properties.has('addColorStop')).toBe(true);
    });

    it('createImageData returns ImageData wrapper', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const createImageData = ctx.properties.get('createImageData')!.value as any;
      const imgData = createImageData.nativeFn(ctx, [100, 100]);
      expect(imgData.properties.has('data')).toBe(true);
      expect(imgData.properties.has('width')).toBe(true);
      expect(imgData.properties.has('height')).toBe(true);
    });

    it('getImageData returns ImageData wrapper', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const fillRect = ctx.properties.get('fillRect')!.value as any;
      fillRect.nativeFn(ctx, [0, 0, 10, 10]);
      const getImageData = ctx.properties.get('getImageData')!.value as any;
      const imgData = getImageData.nativeFn(ctx, [0, 0, 10, 10]);
      expect(imgData.properties.has('data')).toBe(true);
      expect(imgData.properties.has('width')).toBe(true);
    });
  });

  describe('Canvas 2D context wrapper — getter/setter properties', () => {
    function getCtx(el: DomElement, domTree: DomTree): JSObject {
      const wrapper = wrapElement(el, domTree);
      const getCtxFn = wrapper.properties.get('getContext')!.value as any;
      return getCtxFn.nativeFn(wrapper, ['2d']);
    }

    it('fillStyle getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('fillStyle')!.setter as any;
      const getter = ctx.properties.get('fillStyle')!.getter as any;
      setter.nativeFn(ctx, ['#ff0000']);
      expect(getter.nativeFn(ctx, [])).toBe('#ff0000');
    });

    it('strokeStyle getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('strokeStyle')!.setter as any;
      const getter = ctx.properties.get('strokeStyle')!.getter as any;
      setter.nativeFn(ctx, ['#00ff00']);
      expect(getter.nativeFn(ctx, [])).toBe('#00ff00');
    });

    it('lineWidth getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('lineWidth')!.setter as any;
      const getter = ctx.properties.get('lineWidth')!.getter as any;
      setter.nativeFn(ctx, [3]);
      expect(getter.nativeFn(ctx, [])).toBe(3);
    });

    it('font getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('font')!.setter as any;
      const getter = ctx.properties.get('font')!.getter as any;
      setter.nativeFn(ctx, ['16px Arial']);
      expect(getter.nativeFn(ctx, [])).toBe('16px Arial');
    });

    it('globalAlpha getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('globalAlpha')!.setter as any;
      const getter = ctx.properties.get('globalAlpha')!.getter as any;
      setter.nativeFn(ctx, [0.5]);
      expect(getter.nativeFn(ctx, [])).toBe(0.5);
    });

    it('textAlign getter/setter', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree);
      const ctx = getCtx(el, domTree);
      const setter = ctx.properties.get('textAlign')!.setter as any;
      const getter = ctx.properties.get('textAlign')!.getter as any;
      setter.nativeFn(ctx, ['center']);
      expect(getter.nativeFn(ctx, [])).toBe('center');
    });

    it('canvas property returns object with width/height', () => {
      const { domTree } = makeDomTree();
      const el = createCanvasElement(domTree, 640, 480);
      const ctx = getCtx(el, domTree);
      const canvasGetter = ctx.properties.get('canvas')!.getter as any;
      const canvas = canvasGetter.nativeFn(ctx, []);
      expect(canvas.properties.get('width')!.value).toBe(640);
      expect(canvas.properties.get('height')!.value).toBe(480);
    });
  });
});
