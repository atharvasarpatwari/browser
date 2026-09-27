import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { createDocumentBinding, wrapElement, createMouseEventObject, createKeyboardEventObject, createWheelEventObject } from '../src/browser/js/dom-bindings';
import type { JSObject, NativeFunction } from '../src/browser/js/values';

function callNative(obj: JSObject, method: string, args: unknown[] = []): unknown {
  const fn = obj.properties.get(method)!.value as { nativeFn?: NativeFunction };
  return fn.nativeFn!(obj, args as never[]);
}

function readGetter(obj: JSObject, prop: string): unknown {
  const desc = obj.properties.get(prop)!;
  const getter = desc.getter as { nativeFn?: NativeFunction } | undefined;
  return getter?.nativeFn ? getter.nativeFn(obj, []) : desc.value;
}

function makeTree() {
  const parser = new HtmlParser();
  const tree = new DomTree();
  const parsed = parser.parse('<html><body><input id="a"><input id="b"></body></html>');
  const doc = tree.buildFromHtml(parsed.document);
  return { tree, doc };
}

describe('focus()/blur()/document.activeElement', () => {
  it('focus() makes the element document.activeElement and matches :focus', () => {
    const { tree, doc } = makeTree();
    const a = tree.getElementById('a')!;
    const wrappedA = wrapElement(a, tree);

    expect(tree.matches(a, ':focus')).toBe(false);
    callNative(wrappedA, 'focus');
    expect(tree.getFocusedElementId()).toBe(a.domId);
    expect(tree.matches(a, ':focus')).toBe(true);

    const docObj = createDocumentBinding(doc, tree);
    const active = readGetter(docObj, 'activeElement') as JSObject;
    expect((active as unknown as { __domNode: { domId: string } }).__domNode.domId).toBe(a.domId);
  });

  it('focusing a second element blurs the first (only one focused element at a time)', () => {
    const { tree } = makeTree();
    const a = tree.getElementById('a')!;
    const b = tree.getElementById('b')!;
    const wrappedA = wrapElement(a, tree);
    const wrappedB = wrapElement(b, tree);

    callNative(wrappedA, 'focus');
    expect(tree.getFocusedElementId()).toBe(a.domId);

    callNative(wrappedB, 'focus');
    expect(tree.getFocusedElementId()).toBe(b.domId);
    expect(tree.matches(a, ':focus')).toBe(false);
    expect(tree.matches(b, ':focus')).toBe(true);
  });

  it('blur() clears focus and document.activeElement falls back to body', () => {
    const { tree, doc } = makeTree();
    const a = tree.getElementById('a')!;
    const wrappedA = wrapElement(a, tree);

    callNative(wrappedA, 'focus');
    callNative(wrappedA, 'blur');
    expect(tree.getFocusedElementId()).toBeNull();

    const docObj = createDocumentBinding(doc, tree);
    const active = readGetter(docObj, 'activeElement') as JSObject;
    expect((active as unknown as { __domNode: { domId: string } }).__domNode.domId).toBe(doc.bodyElement!.domId);
  });

  it('focus()/blur() fire real addEventListener callbacks on the element', () => {
    const { tree } = makeTree();
    const a = tree.getElementById('a')!;
    const wrappedA = wrapElement(a, tree);

    const seen: string[] = [];
    const addListener = wrappedA.properties.get('addEventListener')!.value as { nativeFn?: NativeFunction };
    const record = (type: string) => ({
      type: 'closure' as const, isNative: true, isArrow: false, async: false, generator: false,
      params: [], body: null, closure: { declare() {}, getAll() { return new Map(); } } as never,
      properties: new Map(), name: 'handler',
      nativeFn: () => { seen.push(type); return undefined; },
    });
    addListener.nativeFn!(wrappedA, ['focus', record('focus')] as never[]);
    addListener.nativeFn!(wrappedA, ['blur', record('blur')] as never[]);

    callNative(wrappedA, 'focus');
    callNative(wrappedA, 'blur');
    expect(seen).toEqual(['focus', 'blur']);
  });
});

describe('typed event object constructors', () => {
  it('createMouseEventObject carries clientX/clientY/button/modifiers', () => {
    const evt = createMouseEventObject('click', null, { clientX: 12, clientY: 34, button: 1, shiftKey: true });
    expect(evt.properties.get('type')!.value).toBe('click');
    expect(evt.properties.get('clientX')!.value).toBe(12);
    expect(evt.properties.get('clientY')!.value).toBe(34);
    expect(evt.properties.get('button')!.value).toBe(1);
    expect(evt.properties.get('shiftKey')!.value).toBe(true);
    expect(evt.properties.get('ctrlKey')!.value).toBe(false);
  });

  it('createKeyboardEventObject carries key/code/modifiers', () => {
    const evt = createKeyboardEventObject('keydown', null, { key: 'a', code: 'KeyA', ctrlKey: true });
    expect(evt.properties.get('key')!.value).toBe('a');
    expect(evt.properties.get('code')!.value).toBe('KeyA');
    expect(evt.properties.get('ctrlKey')!.value).toBe(true);
    expect(evt.properties.get('repeat')!.value).toBe(false);
  });

  it('createWheelEventObject carries deltaX/deltaY/deltaMode', () => {
    const evt = createWheelEventObject('wheel', null, { deltaX: 0, deltaY: 100 });
    expect(evt.properties.get('deltaX')!.value).toBe(0);
    expect(evt.properties.get('deltaY')!.value).toBe(100);
    expect(evt.properties.get('deltaMode')!.value).toBe(0);
  });
});
