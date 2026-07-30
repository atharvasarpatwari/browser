import type { DomDocument, DomElement, DomNode, DomTextNode, IDomTree } from '../rendering/dom-tree';
import { Animation, AnimationTimeline, KeyframeEffect, createAnimation, type Keyframe, type KeyframeEffectOptions } from '../rendering/compositing/animation-engine';
import {
  type JSValue, type JSObject, type JSFunction,
  createObject, createArray, createNativeFunction,
  toNumber, toString, toBoolean,
  Environment,
  callJSFunction,
} from './values';
import { HTMLCanvasElement } from '../rendering/canvas/canvas-element';
import { CanvasRenderingContext2D } from '../rendering/canvas/canvas-context';
import type { CanvasGradient } from '../rendering/canvas/canvas-gradient';
import type { CanvasPattern } from '../rendering/canvas/canvas-pattern';
import type { Path2D } from '../rendering/canvas/canvas-path';
import { isEventHandlerAttribute, isUrlAttribute, isBlockedUrlScheme } from '../security/blocked-url-schemes';

// ─────────────────────────────────────────────────────────────────────────────
// DOM BINDINGS — Bridges the JS interpreter to the Nova DOM tree
//
// DomDocument/DomElement are data types; mutation methods live on IDomTree.
// We pass IDomTree into the bindings so all DOM operations go through it.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared event infrastructure ─────────────────────────────────────────────

interface DomListenerEntry {
  type: string;
  fn: JSFunction;
  capture: boolean;
  once: boolean;
  thisArg: JSValue;
}

const domListenerMap = new WeakMap<DomNode, DomListenerEntry[]>();

function getDomListeners(node: DomNode): DomListenerEntry[] {
  let list = domListenerMap.get(node);
  if (!list) {
    list = [];
    domListenerMap.set(node, list);
  }
  return list;
}

function invokeDomListeners(
  node: DomNode,
  eventType: string,
  event: JSObject,
  isCapture: boolean,
): boolean {
  const entries = getDomListeners(node);
  let stopped = false;
  for (const entry of entries) {
    if (entry.type !== eventType || entry.capture !== isCapture) continue;
    if ((event as any).__stopImmediate) break;
    try {
      const wrapper = entry.thisArg && typeof entry.thisArg === 'object' && '__domNode' in entry.thisArg
        ? entry.thisArg
        : event.properties.get('currentTarget')?.value ?? event.properties.get('target')?.value;
      callJSFunction(entry.fn, wrapper ?? null, [event]);
    } catch { /* swallow handler errors */ }
    if (entry.once) entry.__marked = true;
    if ((event as any).__stopPropagation) { stopped = true; break; }
  }
  return stopped;
}

function cleanupDomOnceListeners(node: DomNode): void {
  const entries = getDomListeners(node);
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].__marked) entries.splice(i, 1);
  }
}

/** Create a lightweight DomElement (for document.createElement). */
function makeElement(tagName: string, parent: DomNode | null): DomElement {
  return {
    domId: `dom-js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    nodeType: 'element',
    parent,
    children: [],
    tagName: tagName.toLowerCase(),
    attributes: new Map(),
    computedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    _dirtyLayout: true,
    _dirtyPaint: true,
  };
}

/** Create a lightweight DomTextNode (for document.createTextNode). */
function makeTextNode(text: string, parent: DomNode | null): DomNode {
  return {
    domId: `dom-js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    nodeType: 'text',
    parent,
    children: [],
    text,
    _dirtyLayout: true,
    _dirtyPaint: true,
  } as DomNode & { text: string };
}

export function createDocumentBinding(
  doc: DomDocument,
  domTree: IDomTree,
): JSObject {
  const docObj = createObject(null);

  // getElementById
  docObj.properties.set('getElementById', {
    value: createNativeFunction('getElementById', (_this, args) => {
      const id = toString(args[0]);
      const el = domTree.getElementById(id);
      return el ? wrapElement(el, domTree) : null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // querySelector
  docObj.properties.set('querySelector', {
    value: createNativeFunction('querySelector', (_this, args) => {
      const sel = toString(args[0]);
      const el = domTree.querySelector(sel);
      return el ? wrapElement(el, domTree) : null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // querySelectorAll
  docObj.properties.set('querySelectorAll', {
    value: createNativeFunction('querySelectorAll', (_this, args) => {
      const sel = toString(args[0]);
      const els = domTree.querySelectorAll(sel);
      return createArray(els.map(e => wrapElement(e, domTree)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // getElementsByTagName
  docObj.properties.set('getElementsByTagName', {
    value: createNativeFunction('getElementsByTagName', (_this, args) => {
      const tag = toString(args[0]);
      const els = domTree.getElementsByTagName(tag);
      return createArray(els.map(e => wrapElement(e, domTree)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // getElementsByClassName
  docObj.properties.set('getElementsByClassName', {
    value: createNativeFunction('getElementsByClassName', (_this, args) => {
      const names = toString(args[0]);
      const els = domTree.getElementsByClassName(names);
      return createArray(els.map(e => wrapElement(e, domTree)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // createElement — creates a detached element (not yet in the tree)
  docObj.properties.set('createElement', {
    value: createNativeFunction('createElement', (_this, args) => {
      const tag = toString(args[0]);
      const el = makeElement(tag, null);
      return wrapElement(el, domTree);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // createTextNode
  docObj.properties.set('createTextNode', {
    value: createNativeFunction('createTextNode', (_this, args) => {
      const text = toString(args[0]);
      const node = makeTextNode(text, null);
      return wrapTextNode(node);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // createEvent — creates an event object for dispatchEvent
  docObj.properties.set('createEvent', {
    value: createNativeFunction('createEvent', (_this, args) => {
      const type = toString(args[0] ?? 'event');
      const bubbles = args.length > 1 ? toBoolean(args[1]) : false;
      const cancelable = args.length > 2 ? toBoolean(args[2]) : false;
      return createEventObject(type, null, { bubbles, cancelable });
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // body
  docObj.properties.set('body', {
    value: doc.bodyElement ? wrapElement(doc.bodyElement, domTree) : null,
    writable: true, enumerable: true, configurable: true,
  });

  // documentElement
  docObj.properties.set('documentElement', {
    value: doc.children.length > 0 && doc.children[0].nodeType === 'element'
      ? wrapElement(doc.children[0] as DomElement, domTree) : null,
    writable: true, enumerable: true, configurable: true,
  });

  // readyState
  docObj.properties.set('readyState', {
    value: 'complete',
    writable: false, enumerable: true, configurable: false,
  });

  // addEventListener (document-level — shared infrastructure)
  docObj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1] as JSFunction;
      const entries = getDomListeners(doc);
      const dup = entries.find(e => e.type === type && e.fn === fn && !e.capture);
      if (!dup) entries.push({ type, fn, capture: false, once: false, thisArg: _this });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // dispatchEvent (document-level — three-phase dispatch)
  docObj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_this, args) => {
      const evt = args[0] as JSObject;
      if (!evt || typeof evt !== 'object') return true;
      const eventType = toString(evt.properties.get('type')?.value ?? '');
      if (!eventType) return true;

      (evt as any).__stopPropagation = false;
      (evt as any).__stopImmediate = false;
      (evt as any).__defaultPrevented = false;

      const ancestors: DomNode[] = [];
      let cur: DomNode | null = doc.bodyElement;
      while (cur) {
        ancestors.push(cur);
        cur = cur.parent;
      }

      const wrappedDoc = docObj;
      evt.properties.set('eventPhase', { value: 1, writable: true, enumerable: true, configurable: false });
      evt.properties.set('currentTarget', { value: wrappedDoc, writable: true, enumerable: true, configurable: false });

      // Capture phase (root → target)
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        const wrapped = wrapElement(ancestor as DomElement, domTree);
        evt.properties.set('currentTarget', { value: wrapped, writable: true, enumerable: true, configurable: false });
        if (invokeDomListeners(ancestor, eventType, evt, true)) break;
        if ((evt as any).__stopPropagation) break;
      }

      // Target phase (document itself)
      if (!(evt as any).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 2, writable: true, enumerable: true, configurable: false });
        evt.properties.set('currentTarget', { value: wrappedDoc, writable: true, enumerable: true, configurable: false });
        invokeDomListeners(doc, eventType, evt, false);
      }

      // Cleanup
      evt.properties.set('currentTarget', { value: null, writable: true, enumerable: true, configurable: false });
      evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
      cleanupDomOnceListeners(doc);
      for (const ancestor of ancestors) cleanupDomOnceListeners(ancestor);

      return !(evt as any).__defaultPrevented;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return docObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

const elementCache = new WeakMap<DomElement, JSObject>();

// ── Animation Registry ─────────────────────────────────────────────────────
// Maps element domId → active Animation[] for getAnimations().
const elementAnimations = new Map<string, Animation[]>();

function getElementAnimations(domId: string): Animation[] {
  let list = elementAnimations.get(domId);
  if (!list) {
    list = [];
    elementAnimations.set(domId, list);
  }
  return list;
}

/**
 * Parse a JS keyframes argument into Keyframe[].
 * Supports: array of { offset?, ...props } and property-indexed { prop: [from, to], offset: [0, 1] } forms.
 */
function parseKeyframesArg(kfArg: JSValue): Keyframe[] {
  if (!kfArg || typeof kfArg !== 'object') return [];
  const obj = kfArg as JSObject;

  // Array form: [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 1 }]
  if (obj.type === 'array' || Array.isArray(obj)) {
    const arr = Array.isArray(obj) ? obj : [];
    const len = !Array.isArray(obj) ? Number(obj.properties.get('length')?.value ?? 0) : obj.length;
    const result: Keyframe[] = [];
    for (let i = 0; i < len; i++) {
      const item = Array.isArray(obj) ? (obj as any)[i] : obj.properties.get(String(i))?.value;
      if (!item || typeof item !== 'object') continue;
      const itemObj = item as JSObject;
      const props: Record<string, string> = {};
      let offset = i / Math.max(len - 1, 1);
      for (const [k, desc] of itemObj.properties) {
        if (k === 'offset') {
          const o = Number(desc.value);
          if (!isNaN(o)) offset = o;
        } else if (k !== 'easing') {
          props[k] = String(desc.value);
        }
      }
      const easing = itemObj.properties.get('easing')?.value;
      result.push({ offset, properties: props, easing: easing !== undefined ? String(easing) : undefined });
    }
    return result;
  }

  // Property-indexed form: { opacity: [0, 1], transform: ['scale(1)', 'scale(2)'], offset: [0, 1] }
  const result: Keyframe[] = [];
  const allProps = new Set<string>();
  const propValues = new Map<string, JSValue[]>();
  let offsets: number[] = [];
  for (const [k, desc] of obj.properties) {
    if (k === 'offset') {
      const arr = desc.value;
      if (typeof arr === 'object' && arr !== null) {
        const aLen = Number((arr as JSObject).properties.get('length')?.value ?? 0);
        for (let i = 0; i < aLen; i++) {
          const v = (arr as JSObject).properties.get(String(i))?.value;
          const n = Number(v);
          if (!isNaN(n)) offsets.push(n);
        }
      }
    } else if (k === 'easing') {
      // skip
    } else {
      allProps.add(k);
      const arr = desc.value;
      if (typeof arr === 'object' && arr !== null) {
        const vals: JSValue[] = [];
        const aLen = Number((arr as JSObject).properties.get('length')?.value ?? 0);
        for (let i = 0; i < aLen; i++) {
          vals.push((arr as JSObject).properties.get(String(i))?.value);
        }
        propValues.set(k, vals);
      }
    }
  }
  if (allProps.size === 0) return result;
  const numKeyframes = Math.max(...[...propValues.values()].map(v => v.length), offsets.length, 2);
  for (let i = 0; i < numKeyframes; i++) {
    const props: Record<string, string> = {};
    for (const p of allProps) {
      const vals = propValues.get(p);
      if (vals && i < vals.length) props[p] = String(vals[i]);
    }
    const offset = i < offsets.length ? offsets[i] : i / Math.max(numKeyframes - 1, 1);
    result.push({ offset, properties: props });
  }
  return result;
}

/**
 * Parse a JS options argument into KeyframeEffectOptions.
 * Supports number (duration) or object with duration/delay/etc.
 */
function parseAnimationOptions(optionsArg: JSValue): KeyframeEffectOptions {
  if (optionsArg === undefined || optionsArg === null) return { duration: 1000 };
  if (typeof optionsArg === 'number') return { duration: optionsArg };
  if (typeof optionsArg !== 'object') return { duration: 1000 };
  const obj = optionsArg as JSObject;
  const readProp = (name: string, def: any): any => {
    const desc = obj.properties.get(name)?.value;
    return desc !== undefined ? desc : def;
  };
  return {
    duration: Number(readProp('duration', 1000)),
    delay: Number(readProp('delay', 0)),
    endDelay: Number(readProp('endDelay', 0)),
    iterations: Number(readProp('iterations', 1)),
    iterationStart: Number(readProp('iterationStart', 0)),
    direction: readProp('direction', 'normal') as any,
    fill: readProp('fill', 'none') as any,
    easing: readProp('easing', 'linear') as string,
  };
}

// ── Shared animation timeline for JS-created animations ──
const jsAnimationTimeline = new AnimationTimeline();

/**
 * Create a JSObject wrapper around a real Animation engine instance.
 */
export function wrapAnimation(anim: Animation): JSObject {
  const obj = createObject(null);

  const syncProps = () => {
    obj.properties.set('playState', { value: anim.playState, writable: true, enumerable: true, configurable: true });
    obj.properties.set('playbackRate', { value: 1, writable: true, enumerable: true, configurable: true });
    obj.properties.set('currentTime', { value: anim.currentTime, writable: true, enumerable: true, configurable: true });
    obj.properties.set('startTime', { value: anim.currentTime, writable: true, enumerable: true, configurable: true });
    obj.properties.set('finished', { value: anim.finished, writable: true, enumerable: true, configurable: true });
    obj.properties.set('pending', { value: anim.pending, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onfinish', { value: obj.properties.get('onfinish')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('oncancel', { value: obj.properties.get('oncancel')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onremove', { value: obj.properties.get('onremove')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
  };

  syncProps();

  // Wire finish callback
  const prevOnFinish = anim.onFinish;
  anim.onFinish = (evt) => {
    const cb = obj.properties.get('onfinish')?.value;
    if (typeof cb === 'object' && cb !== null && (cb as any).type === 'closure') {
      callJSFunction(cb as JSFunction, obj, []);
    }
    if (prevOnFinish) prevOnFinish(evt);
    syncProps();
  };

  anim.onCancel = (evt) => {
    const cb = obj.properties.get('oncancel')?.value;
    if (typeof cb === 'object' && cb !== null && (cb as any).type === 'closure') {
      callJSFunction(cb as JSFunction, obj, []);
    }
    syncProps();
  };

  obj.properties.set('play', {
    value: createNativeFunction('play', () => { anim.start(); syncProps(); return obj; }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('pause', {
    value: createNativeFunction('pause', () => { anim.pause(); syncProps(); return obj; }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('finish', {
    value: createNativeFunction('finish', () => { anim.finish(); syncProps(); return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('cancel', {
    value: createNativeFunction('cancel', () => { anim.cancel(); syncProps(); return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('reverse', {
    value: createNativeFunction('reverse', () => { anim.reverse(); syncProps(); return obj; }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('commitStyles', {
    value: createNativeFunction('commitStyles', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('updatePlaybackRate', {
    value: createNativeFunction('updatePlaybackRate', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });

  (obj as any).__animation = anim;
  return obj;
}

function getAttr(el: DomElement, name: string): string | undefined {
  return el.attributes.get(name);
}

export function wrapElement(el: DomElement, domTree: IDomTree): JSObject {
  const cached = elementCache.get(el);
  if (cached) return cached;

  const obj = createObject(null);

  // Cache immediately to prevent infinite recursion on circular parent/child references
  elementCache.set(el, obj);

  // Store DOM reference on the JSObject
  (obj as JSObject & { __domNode: DomElement }).__domNode = el;

  // tagName (uppercase)
  obj.properties.set('tagName', {
    value: el.tagName.toUpperCase(),
    writable: false, enumerable: true, configurable: false,
  });

  // id (getter/setter backed by DOM attributes)
  obj.properties.set('id', {
    value: getAttr(el, 'id') ?? '',
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get id', () => getAttr(el, 'id') ?? ''),
    setter: createNativeFunction('set id', (_t, args) => {
      const val = toString(args[0]);
      domTree.setAttribute(el, 'id', val);
    }),
  });

  // className (getter/setter backed by DOM class attribute)
  obj.properties.set('className', {
    value: getAttr(el, 'class') ?? '',
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get className', () => getAttr(el, 'class') ?? ''),
    setter: createNativeFunction('set className', (_t, args) => {
      const val = toString(args[0]);
      domTree.setAttribute(el, 'class', val);
    }),
  });

  // textContent (getter/setter — clears children and sets text)
  obj.properties.set('textContent', {
    value: getTextContent(el),
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get textContent', () => getTextContent(el)),
    setter: createNativeFunction('set textContent', (_t, args) => {
      const val = toString(args[0]);
      const textNode = makeTextNode(val, el);
      (el as { children: DomNode[] }).children = [textNode];
      domTree.setTextContent(el, val);
    }),
  });

  // children (element nodes only)
  obj.properties.set('children', {
    value: createArray(
      el.children.filter((c): c is DomElement => c.nodeType === 'element')
        .map(c => wrapElement(c, domTree))
    ),
    writable: false, enumerable: true, configurable: false,
  });

  // childNodes (all nodes)
  obj.properties.set('childNodes', {
    value: createArray(el.children.map(c =>
      c.nodeType === 'element' ? wrapElement(c as DomElement, domTree) : wrapTextNode(c)
    )),
    writable: false, enumerable: true, configurable: false,
  });

  // parentNode
  obj.properties.set('parentNode', {
    value: el.parent && el.parent.nodeType === 'element'
      ? wrapElement(el.parent as DomElement, domTree) : null,
    writable: false, enumerable: true, configurable: false,
  });

  // firstChild
  obj.properties.set('firstChild', {
    value: el.children.length > 0
      ? (el.children[0].nodeType === 'element'
        ? wrapElement(el.children[0] as DomElement, domTree)
        : wrapTextNode(el.children[0]))
      : null,
    writable: false, enumerable: true, configurable: false,
  });

  // innerHTML (read-only getter — returns concatenated child HTML)
  obj.properties.set('innerHTML', {
    value: getInnerHTML(el),
    writable: true, enumerable: true, configurable: true,
  });

  // style
  const styleObj = createObject(null);
  const elStyle = el.computedStyle ?? new Map();
  for (const [k, v] of elStyle) {
    styleObj.properties.set(k, { value: v, writable: true, enumerable: true, configurable: true });
  }
  obj.properties.set('style', { value: styleObj, writable: true, enumerable: true, configurable: true });

  // getAttribute
  obj.properties.set('getAttribute', {
    value: createNativeFunction('getAttribute', (_this, args) => {
      const name = toString(args[0]);
      return getAttr(el, name) ?? null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // setAttribute (sanitized — blocks on* event handlers and dangerous URL schemes)
  obj.properties.set('setAttribute', {
    value: createNativeFunction('setAttribute', (_this, args) => {
      const name = toString(args[0]);
      const value = toString(args[1]);

      // Block event handler attributes (onclick, onerror, etc.)
      if (isEventHandlerAttribute(name)) {
        return undefined;
      }

      // Block dangerous URL schemes in URL-bearing attributes
      if (isUrlAttribute(name) && isBlockedUrlScheme(value)) {
        return undefined;
      }

      domTree.setAttribute(el, name, value);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // removeAttribute
  obj.properties.set('removeAttribute', {
    value: createNativeFunction('removeAttribute', (_this, args) => {
      const name = toString(args[0]);
      domTree.removeAttribute(el, name);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // hasAttribute
  obj.properties.set('hasAttribute', {
    value: createNativeFunction('hasAttribute', (_this, args) => {
      const name = toString(args[0]);
      return el.attributes.has(name);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // appendChild
  obj.properties.set('appendChild', {
    value: createNativeFunction('appendChild', (_this, args) => {
      const child = args[0] as JSObject;
      if (typeof child === 'object' && child !== null && '__domNode' in child) {
        const domNode = (child as JSObject & { __domNode: DomNode }).__domNode;
        domTree.appendChild(el, domNode);
      }
      return args[0];
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // removeChild
  obj.properties.set('removeChild', {
    value: createNativeFunction('removeChild', (_this, args) => {
      const child = args[0] as JSObject;
      if (typeof child === 'object' && child !== null && '__domNode' in child) {
        const domNode = (child as JSObject & { __domNode: DomNode }).__domNode;
        domTree.removeChild(el, domNode);
      }
      return args[0];
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // insertBefore
  obj.properties.set('insertBefore', {
    value: createNativeFunction('insertBefore', (_this, args) => {
      const newChild = args[0] as JSObject;
      const refChild = args[1] as JSObject;
      if (typeof newChild === 'object' && newChild !== null && '__domNode' in newChild) {
        const newNode = (newChild as JSObject & { __domNode: DomNode }).__domNode;
        const refNode = (typeof refChild === 'object' && refChild !== null && '__domNode' in refChild)
          ? (refChild as JSObject & { __domNode: DomNode }).__domNode
          : null;
        domTree.insertBefore(el, newNode, refNode);
      }
      return args[0];
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // cloneNode
  obj.properties.set('cloneNode', {
    value: createNativeFunction('cloneNode', (_this, args) => {
      const deep = args.length > 0 ? toBoolean(args[0]) : false;
      const cloned = deep ? deepClone(el) : shallowClone(el);
      return wrapElement(cloned, domTree);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // addEventListener (with capture/once support)
  obj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1] as JSFunction;
      const opts = args[2];
      const capture = typeof opts === 'boolean' ? opts
        : (opts && typeof opts === 'object' && 'value' in opts) ? false
        : (opts && typeof opts === 'object' && typeof opts === 'object')
          ? toBoolean((opts as any).properties?.get('capture')?.value ?? false)
          : false;
      const once = (opts && typeof opts === 'object' && typeof opts === 'object' && 'properties' in opts)
        ? toBoolean((opts as any).properties?.get('once')?.value ?? false)
        : false;
      const entries = getDomListeners(el);
      const dup = entries.find(e => e.type === type && e.fn === fn && e.capture === capture);
      if (!dup) entries.push({ type, fn, capture, once, thisArg: _this });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // removeEventListener
  obj.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1] as JSFunction;
      const opts = args[2];
      const capture = typeof opts === 'boolean' ? opts : false;
      const entries = getDomListeners(el);
      const idx = entries.findIndex(e => e.type === type && e.fn === fn && e.capture === capture);
      if (idx !== -1) entries.splice(idx, 1);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // dispatchEvent — three-phase: capture → target → bubble
  obj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_this, args) => {
      const evt = args[0] as JSObject;
      if (!evt || typeof evt !== 'object') return true;
      const eventType = toString(evt.properties.get('type')?.value ?? '');
      if (!eventType) return true;

      // Initialize propagation state
      (evt as any).__stopPropagation = false;
      (evt as any).__stopImmediate = false;
      (evt as any).__defaultPrevented = false;

      // Build ancestor chain (elements only, no text or document nodes)
      // When composed=false, stop at shadow root boundaries.
      // When composed=true, cross shadow boundaries to the host element.
      const composed = evt.properties.get('composed')?.value === true;
      const ancestors: DomNode[] = [];
      let cur: DomNode | null = el.parent;
      while (cur) {
        if (cur.nodeType === 'element') {
          ancestors.push(cur);
        }
        // Shadow root boundary: a fragment node with a host (e.g. shadow root).
        // When composed=false, stop here; when composed=true, jump to host.
        const isShadowBoundary = cur.nodeType !== 'element' && 'host' in cur && (cur as any).host;
        if (isShadowBoundary) {
          if (!composed) break;
          const host = (cur as any).host as DomNode;
          if (host && host.nodeType === 'element') ancestors.push(host);
          cur = host?.parent ?? null;
        } else {
          cur = cur.parent;
        }
      }

      const bubbles = evt.properties.get('bubbles')?.value === true;

      // Set target
      const wrappedTarget = wrapElement(el, domTree);
      evt.properties.set('target', { value: wrappedTarget, writable: false, enumerable: true, configurable: false });

      // ── CAPTURE PHASE: root → parent-of-target ──
      evt.properties.set('eventPhase', { value: 1, writable: true, enumerable: true, configurable: false });
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        const wrapped = wrapElement(ancestor as DomElement, domTree);
        evt.properties.set('currentTarget', { value: wrapped, writable: true, enumerable: true, configurable: false });
        if (invokeDomListeners(ancestor, eventType, evt, true)) break;
        if ((evt as any).__stopPropagation) break;
      }

      // ── TARGET PHASE ──
      if (!(evt as any).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 2, writable: true, enumerable: true, configurable: false });
        evt.properties.set('currentTarget', { value: wrappedTarget, writable: true, enumerable: true, configurable: false });
        invokeDomListeners(el, eventType, evt, false);
        if (!(evt as any).__stopPropagation) {
          invokeDomListeners(el, eventType, evt, true);
        }
      }

      // ── BUBBLE PHASE: parent-of-target → root ──
      if (bubbles && !(evt as any).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 3, writable: true, enumerable: true, configurable: false });
        for (const ancestor of ancestors) {
          const wrapped = wrapElement(ancestor as DomElement, domTree);
          evt.properties.set('currentTarget', { value: wrapped, writable: true, enumerable: true, configurable: false });
          if (invokeDomListeners(ancestor, eventType, evt, false)) break;
          if ((evt as any).__stopPropagation) break;
        }
      }

      // Cleanup
      evt.properties.set('currentTarget', { value: null, writable: true, enumerable: true, configurable: false });
      evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
      cleanupDomOnceListeners(el);
      for (const ancestor of ancestors) cleanupDomOnceListeners(ancestor);

      return !(evt as any).__defaultPrevented;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // matches (simple selector matching)
  obj.properties.set('matches', {
    value: createNativeFunction('matches', (_this, args) => {
      const sel = toString(args[0]);
      const matched = domTree.querySelector(sel);
      return matched === el;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // getElementsByClassName
  obj.properties.set('getElementsByClassName', {
    value: createNativeFunction('getElementsByClassName', (_this, args) => {
      const names = toString(args[0]);
      const tokens = names.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return createArray([]);
      const result: DomElement[] = [];
      const queue: DomNode[] = [...el.children];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.nodeType === 'element') {
          const childEl = node as DomElement;
          const classAttr = childEl.attributes.get('class') ?? '';
          const classSet = new Set(classAttr.split(/\s+/));
          if (tokens.every(t => classSet.has(t))) result.push(childEl);
        }
        for (const child of node.children) queue.push(child);
      }
      return createArray(result.map(e => wrapElement(e, domTree)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // getBoundingClientRect
  obj.properties.set('getBoundingClientRect', {
    value: createNativeFunction('getBoundingClientRect', () => {
      const box = el.layoutBox;
      const rect = createObject(null);
      rect.properties.set('x', { value: box ? box.x : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('y', { value: box ? box.y : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('width', { value: box ? box.width : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('height', { value: box ? box.height : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('top', { value: box ? box.y : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('left', { value: box ? box.x : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('right', { value: box ? box.x + box.width : 0, writable: false, enumerable: true, configurable: false });
      rect.properties.set('bottom', { value: box ? box.y + box.height : 0, writable: false, enumerable: true, configurable: false });
      return rect;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // Image-specific properties (getter/setter backed by DOM element state)
  const tagName = el.tagName.toLowerCase();
  if (tagName === 'img') {
    obj.properties.set('loading', {
      value: undefined,
      writable: true,
      enumerable: true,
      configurable: true,
      getter: createNativeFunction('get loading', () => el.loadingState === 'lazy' ? 'lazy' : 'eager'),
      setter: createNativeFunction('set loading', (_t, args) => {
        el.loadingState = toString(args[0]) === 'lazy' ? 'lazy' : 'none';
      }),
    });
    obj.properties.set('complete', {
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: true,
      getter: createNativeFunction('get complete', () => el.loadingState === 'loaded' || el.loadingState === 'none'),
    });
    obj.properties.set('naturalWidth', {
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: true,
      getter: createNativeFunction('get naturalWidth', () => el.naturalWidth),
    });
    obj.properties.set('naturalHeight', {
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: true,
      getter: createNativeFunction('get naturalHeight', () => el.naturalHeight),
    });
  }

  // Canvas-specific properties
  if (tagName === 'canvas') {
    // Lazily create / retrieve the TS-side HTMLCanvasElement
    const getCanvas = (): HTMLCanvasElement => {
      let hc = (el as any).__canvasElement as HTMLCanvasElement | undefined;
      if (!hc) {
        const w = parseInt(el.attributes.get('width') ?? '300', 10) || 300;
        const h = parseInt(el.attributes.get('height') ?? '150', 10) || 150;
        hc = new HTMLCanvasElement(w, h);
        (el as any).__canvasElement = hc;
      }
      return hc;
    };
    const attrs = el.attributes as Map<string, string>;

    obj.properties.set('getContext', {
      value: createNativeFunction('getContext', (_this, args) => {
        const contextId = toString(args[0] ?? '');
        if (contextId === '2d') {
          const hc = getCanvas();
          const ctx = hc.getContext('2d');
          if (!ctx) return null;
          // Cache the wrapped context on the canvas element's wrapper
          let wrapped = (obj as any).__wrappedCtx as JSObject | undefined;
          if (!wrapped) {
            wrapped = wrapCanvasContext(ctx);
            (obj as any).__wrappedCtx = wrapped;
            // Store reference back to canvas for 'canvas' property
            (wrapped as any).__canvasEl = hc;
          }
          return wrapped;
        }
        return null;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    obj.properties.set('width', {
      value: parseInt(el.attributes.get('width') ?? '300', 10) || 300,
      writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get width', () => getCanvas().width),
      setter: createNativeFunction('set width', (_t, args) => {
        const v = toNumber(args[0]);
        getCanvas().width = v;
        attrs.set('width', String(v));
        (obj as any).__wrappedCtx = undefined;
      }),
    });

    obj.properties.set('height', {
      value: parseInt(el.attributes.get('height') ?? '150', 10) || 150,
      writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get height', () => getCanvas().height),
      setter: createNativeFunction('set height', (_t, args) => {
        const v = toNumber(args[0]);
        getCanvas().height = v;
        attrs.set('height', String(v));
        (obj as any).__wrappedCtx = undefined;
      }),
    });

    obj.properties.set('toDataURL', {
      value: createNativeFunction('toDataURL', (_this, args) => {
        const type = args[0] !== undefined ? toString(args[0]) : undefined;
        const quality = args[1] !== undefined ? toNumber(args[1]) : undefined;
        return getCanvas().toDataURL(type, quality);
      }),
      writable: true, enumerable: true, configurable: true,
    });

    obj.properties.set('toBlob', {
      value: createNativeFunction('toBlob', (_this, args) => {
        const callback = args[0] as JSFunction;
        const type = args[1] !== undefined ? toString(args[1]) : undefined;
        const quality = args[2] !== undefined ? toNumber(args[2]) : undefined;
        getCanvas().toBlob((blob) => {
          // Blob is passed as-is (will be wrapped by JS engine if needed)
          if (callback) callJSFunction(callback, null, [blob as any]);
        }, type, quality);
      }),
      writable: true, enumerable: true, configurable: true,
    });
  }

  // Iframe-specific properties (SOP-enforced contentWindow / contentDocument)
  if (tagName === 'iframe') {
    const iframeOrigin = getAttr(el, 'data-origin') ?? getAttr(el, 'srcdoc') !== null ? '' : (() => {
      const src = getAttr(el, 'src') ?? '';
      try { return new URL(src).origin; } catch { return ''; }
    })();

    // contentWindow — returns null for cross-origin iframes
    obj.properties.set('contentWindow', {
      value: null,
      writable: false, enumerable: true, configurable: true,
      getter: createNativeFunction('get contentWindow', () => {
        // In a real browser, this returns the Window proxy for the iframe.
        // Cross-origin iframes return null for contentWindow in some contexts.
        // For now, return a placeholder object representing the child window.
        const childWindow = createObject(null);
        childWindow.properties.set('origin', {
          value: iframeOrigin || 'null',
          writable: false, enumerable: true, configurable: false,
        });
        return childWindow;
      }),
    });

    // contentDocument — blocked for cross-origin iframes
    obj.properties.set('contentDocument', {
      value: null,
      writable: false, enumerable: true, configurable: true,
      getter: createNativeFunction('get contentDocument', () => {
        // Cross-origin iframe contentDocument access is blocked by SOP
        // The CrossOriginGuard.checkAccess() would be called here in production.
        // For now, return null for cross-origin iframes.
        if (iframeOrigin) {
          // Would need calling page origin to do full SOP check.
          // Return null as a safe default for cross-origin.
          return null;
        }
        // Same-origin: return the iframe's document
        return null; // Placeholder — full implementation needs document proxy
      }),
    });
  }

  // ── Web Animations API: animate() ──
  obj.properties.set('animate', {
    value: createNativeFunction('animate', (_this, args) => {
      const kfArg = args[0];
      const optsArg = args[1];
      const keyframes = parseKeyframesArg(kfArg);
      const options = parseAnimationOptions(optsArg);
      if (keyframes.length === 0) {
        // Return a finished animation for empty keyframes
        const emptyEffect = new KeyframeEffect(el.domId, [{ offset: 0, properties: {} }], { duration: 0 });
        const emptyAnim = new Animation(emptyEffect, jsAnimationTimeline);
        emptyAnim.finish();
        return wrapAnimation(emptyAnim);
      }
      const effect = new KeyframeEffect(el.domId, keyframes, options);
      const anim = new Animation(effect, jsAnimationTimeline);
      anim.start();
      // Track by element for getAnimations()
      getElementAnimations(el.domId).push(anim);
      // Clean up when finished
      const origFinish = anim.onFinish;
      anim.onFinish = (evt) => {
        const list = elementAnimations.get(el.domId);
        if (list) {
          const idx = list.indexOf(anim);
          if (idx >= 0) list.splice(idx, 1);
        }
        if (origFinish) origFinish(evt);
      };
      return wrapAnimation(anim);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Web Animations API: getAnimations() ──
  obj.properties.set('getAnimations', {
    value: createNativeFunction('getAnimations', () => {
      const anims = elementAnimations.get(el.domId) ?? [];
      return createArray(anims.filter(a => a.playState !== 'idle' && a.playState !== 'finished').map(a => wrapAnimation(a)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS 2D CONTEXT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

/** Unwrap a JSObject to get the raw data behind it (e.g., ImageData, CanvasGradient, Path2D). */
function unwrapRaw(v: JSValue): any {
  if (v && typeof v === 'object' && '__raw' in (v as any)) return (v as any).__raw;
  return v;
}

/** Unwrap an image source for drawImage: accepts a canvas wrapper or a raw image-data object. */
function unwrapImageSource(v: JSValue): any {
  if (v && typeof v === 'object') {
    const obj = v as JSObject;
    // If it's a canvas element wrapper, get the HTMLCanvasElement
    if ('__canvasEl' in (obj as any)) return (obj as any).__canvasEl;
    // If it's an ImageData-like raw object
    if ('__raw' in (obj as any)) return (obj as any).__raw;
    // If it looks like { data, width, height } pass through
    if (obj.properties.has('data') && obj.properties.has('width') && obj.properties.has('height')) {
      return {
        data: (obj.properties.get('data')?.value as any)?._data ?? obj.properties.get('data')?.value,
        width: toNumber(obj.properties.get('width')?.value),
        height: toNumber(obj.properties.get('height')?.value),
      };
    }
  }
  return v;
}

/** Wrap a canvas gradient as a JSObject. */
function wrapGradient(g: CanvasGradient): JSObject {
  const obj = createObject(null);
  (obj as any).__raw = g;
  obj.properties.set('addColorStop', {
    value: createNativeFunction('addColorStop', (_this, args) => {
      g.addColorStop(toNumber(args[0]), toString(args[1]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return obj;
}

/** Wrap a canvas pattern as a JSObject. */
function wrapPattern(p: any): JSObject {
  const obj = createObject(null);
  (obj as any).__raw = p;
  return obj;
}

/** Wrap an ImageData as a JSObject. */
function wrapImageData(d: { data: Uint8ClampedArray; width: number; height: number }): JSObject {
  const obj = createObject(null);
  (obj as any).__raw = d;
  obj.properties.set('data', { value: d.data as any, writable: false, enumerable: true, configurable: false });
  obj.properties.set('width', { value: d.width, writable: false, enumerable: true, configurable: false });
  obj.properties.set('height', { value: d.height, writable: false, enumerable: true, configurable: false });
  return obj;
}

/** Wrap a Path2D as a JSObject. */
function wrapPath2D(p: Path2D): JSObject {
  const obj = createObject(null);
  (obj as any).__raw = p;
  obj.properties.set('addPath', {
    value: createNativeFunction('addPath', (_this, args) => {
      const other = unwrapRaw(args[0]);
      if (other && typeof other === 'object' && '_commands' in other) {
        p._commands.push(...other._commands);
      }
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('closePath', {
    value: createNativeFunction('closePath', () => p.closePath()),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('moveTo', {
    value: createNativeFunction('moveTo', (_t, args) => p.moveTo(toNumber(args[0]), toNumber(args[1]))),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('lineTo', {
    value: createNativeFunction('lineTo', (_t, args) => p.lineTo(toNumber(args[0]), toNumber(args[1]))),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('arc', {
    value: createNativeFunction('arc', (_t, args) => p.arc(toNumber(args[0]), toNumber(args[1]), toNumber(args[2]), toNumber(args[3]), toNumber(args[4]), args[5] !== undefined ? toBoolean(args[5]) : undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('rect', {
    value: createNativeFunction('rect', (_t, args) => p.rect(toNumber(args[0]), toNumber(args[1]), toNumber(args[2]), toNumber(args[3]))),
    writable: true, enumerable: true, configurable: true,
  });
  return obj;
}

/** Wrap a TextMetrics as a JSObject. */
function wrapTextMetrics(m: any): JSObject {
  const obj = createObject(null);
  (obj as any).__raw = m;
  const fields = [
    'width', 'actualBoundingBoxAscent', 'actualBoundingBoxDescent',
    'actualBoundingBoxLeft', 'actualBoundingBoxRight',
    'fontBoundingBoxAscent', 'fontBoundingBoxDescent',
  ];
  for (const f of fields) {
    obj.properties.set(f, { value: m[f] ?? 0, writable: false, enumerable: true, configurable: false });
  }
  return obj;
}

function wrapCanvasContext(ctx: CanvasRenderingContext2D): JSObject {
  const obj = createObject(null);

  // Store raw context for internal access
  (obj as any).__raw = ctx;

  // ── State ──
  obj.properties.set('save', {
    value: createNativeFunction('save', () => { ctx.save(); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('restore', {
    value: createNativeFunction('restore', () => { ctx.restore(); }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Transforms ──
  obj.properties.set('translate', {
    value: createNativeFunction('translate', (_t, a) => { ctx.translate(toNumber(a[0]), toNumber(a[1])); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('rotate', {
    value: createNativeFunction('rotate', (_t, a) => { ctx.rotate(toNumber(a[0])); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('scale', {
    value: createNativeFunction('scale', (_t, a) => { ctx.scale(toNumber(a[0]), toNumber(a[1])); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('transform', {
    value: createNativeFunction('transform', (_t, a) => {
      ctx.transform(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), toNumber(a[5]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('setTransform', {
    value: createNativeFunction('setTransform', (_t, a) => {
      ctx.setTransform(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), toNumber(a[5]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('resetTransform', {
    value: createNativeFunction('resetTransform', () => { ctx.resetTransform(); }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Line dash ──
  obj.properties.set('setLineDash', {
    value: createNativeFunction('setLineDash', (_t, a) => {
      const segs = Array.isArray(a[0]) ? a[0].map(toNumber) : [];
      ctx.setLineDash(segs);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('getLineDash', {
    value: createNativeFunction('getLineDash', () => createArray(ctx.getLineDash())),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Path ──
  obj.properties.set('beginPath', {
    value: createNativeFunction('beginPath', () => { ctx.beginPath(); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('closePath', {
    value: createNativeFunction('closePath', () => { ctx.closePath(); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('moveTo', {
    value: createNativeFunction('moveTo', (_t, a) => { ctx.moveTo(toNumber(a[0]), toNumber(a[1])); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('lineTo', {
    value: createNativeFunction('lineTo', (_t, a) => { ctx.lineTo(toNumber(a[0]), toNumber(a[1])); }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('quadraticCurveTo', {
    value: createNativeFunction('quadraticCurveTo', (_t, a) => {
      ctx.quadraticCurveTo(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('bezierCurveTo', {
    value: createNativeFunction('bezierCurveTo', (_t, a) => {
      ctx.bezierCurveTo(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), toNumber(a[5]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('arc', {
    value: createNativeFunction('arc', (_t, a) => {
      ctx.arc(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), a[5] !== undefined ? toBoolean(a[5]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('arcTo', {
    value: createNativeFunction('arcTo', (_t, a) => {
      ctx.arcTo(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('ellipse', {
    value: createNativeFunction('ellipse', (_t, a) => {
      ctx.ellipse(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), toNumber(a[5]), toNumber(a[6]), a[7] !== undefined ? toBoolean(a[7]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('rect', {
    value: createNativeFunction('rect', (_t, a) => {
      ctx.rect(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('clip', {
    value: createNativeFunction('clip', (_t, a) => {
      ctx.clip(a[0] !== undefined ? toString(a[0]) as any : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Drawing ──
  obj.properties.set('clearRect', {
    value: createNativeFunction('clearRect', (_t, a) => {
      ctx.clearRect(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('fillRect', {
    value: createNativeFunction('fillRect', (_t, a) => {
      ctx.fillRect(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('strokeRect', {
    value: createNativeFunction('strokeRect', (_t, a) => {
      ctx.strokeRect(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('fill', {
    value: createNativeFunction('fill', (_t, a) => {
      ctx.fill(a[0] !== undefined ? toString(a[0]) as any : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('stroke', {
    value: createNativeFunction('stroke', () => { ctx.stroke(); }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Text ──
  obj.properties.set('fillText', {
    value: createNativeFunction('fillText', (_t, a) => {
      ctx.fillText(toString(a[0]), toNumber(a[1]), toNumber(a[2]), a[3] !== undefined ? toNumber(a[3]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('strokeText', {
    value: createNativeFunction('strokeText', (_t, a) => {
      ctx.strokeText(toString(a[0]), toNumber(a[1]), toNumber(a[2]), a[3] !== undefined ? toNumber(a[3]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('measureText', {
    value: createNativeFunction('measureText', (_t, a) => {
      return wrapTextMetrics(ctx.measureText(toString(a[0])));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Images ──
  obj.properties.set('drawImage', {
    value: createNativeFunction('drawImage', (_t, a) => {
      const img = unwrapImageSource(a[0]);
      if (!img) return;
      if (a.length === 3) {
        ctx.drawImage(img, toNumber(a[1]), toNumber(a[2]));
      } else if (a.length === 5) {
        ctx.drawImage(img, toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]));
      } else if (a.length === 9) {
        ctx.drawImage(img, toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]),
          toNumber(a[5]), toNumber(a[6]), toNumber(a[7]), toNumber(a[8]));
      }
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Pixel data ──
  obj.properties.set('getImageData', {
    value: createNativeFunction('getImageData', (_t, a) => {
      return wrapImageData(ctx.getImageData(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3])));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('putImageData', {
    value: createNativeFunction('putImageData', (_t, a) => {
      const raw = unwrapRaw(a[0]);
      ctx.putImageData(raw, toNumber(a[1]), toNumber(a[2]));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('createImageData', {
    value: createNativeFunction('createImageData', (_t, a) => {
      return wrapImageData(ctx.createImageData(toNumber(a[0]), toNumber(a[1])));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Gradients & patterns ──
  obj.properties.set('createLinearGradient', {
    value: createNativeFunction('createLinearGradient', (_t, a) => {
      return wrapGradient(ctx.createLinearGradient(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3])));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('createRadialGradient', {
    value: createNativeFunction('createRadialGradient', (_t, a) => {
      return wrapGradient(ctx.createRadialGradient(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), toNumber(a[3]), toNumber(a[4]), toNumber(a[5])));
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('createPattern', {
    value: createNativeFunction('createPattern', (_t, a) => {
      const img = unwrapImageSource(a[0]);
      if (!img) return null;
      const rep = a[1] !== undefined ? toString(a[1]) : 'repeat';
      const p = ctx.createPattern(img, rep as any);
      return p ? wrapPattern(p) : null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Path2D support ──
  obj.properties.set('Path2D', {
    value: createNativeFunction('Path2D', (_t, a) => {
      const { Path2D: P2D } = require('../rendering/canvas/canvas-path');
      const p = a[0] !== undefined ? new P2D(unwrapRaw(a[0])) : new P2D();
      return wrapPath2D(p);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Export ──
  obj.properties.set('toDataURL', {
    value: createNativeFunction('toDataURL', (_t, a) => {
      return ctx.toDataURL(a[0] !== undefined ? toString(a[0]) : undefined, a[1] !== undefined ? toNumber(a[1]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('toBlob', {
    value: createNativeFunction('toBlob', (_t, a) => {
      const callback = a[0] as JSFunction;
      ctx.toBlob((blob) => {
        if (callback) callJSFunction(callback, null, [blob as any]);
      }, a[1] !== undefined ? toString(a[1]) : undefined, a[2] !== undefined ? toNumber(a[2]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── canvas reference ──
  obj.properties.set('canvas', {
    value: undefined, // set by wrapElement when creating the context
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get canvas', () => {
      const hc = (obj as any).__canvasEl;
      if (!hc) return null;
      // Return a minimal object with width/height
      const canvasRef = createObject(null);
      canvasRef.properties.set('width', { value: hc.width, writable: false, enumerable: true, configurable: false });
      canvasRef.properties.set('height', { value: hc.height, writable: false, enumerable: true, configurable: false });
      return canvasRef;
    }),
  });

  // ── Getter/setter properties ──
  const gsProps: Array<[string, () => any, (v: any) => void]> = [
    ['fillStyle', () => ctx.fillStyle, (v) => { ctx.fillStyle = unwrapRaw(v); }],
    ['strokeStyle', () => ctx.strokeStyle, (v) => { ctx.strokeStyle = unwrapRaw(v); }],
    ['lineWidth', () => ctx.lineWidth, (v) => { ctx.lineWidth = toNumber(v); }],
    ['lineCap', () => ctx.lineCap, (v) => { ctx.lineCap = toString(v) as any; }],
    ['lineJoin', () => ctx.lineJoin, (v) => { ctx.lineJoin = toString(v) as any; }],
    ['miterLimit', () => ctx.miterLimit, (v) => { ctx.miterLimit = toNumber(v); }],
    ['globalAlpha', () => ctx.globalAlpha, (v) => { ctx.globalAlpha = toNumber(v); }],
    ['globalCompositeOperation', () => ctx.globalCompositeOperation, (v) => { ctx.globalCompositeOperation = toString(v); }],
    ['font', () => ctx.font, (v) => { ctx.font = toString(v); }],
    ['textAlign', () => ctx.textAlign, (v) => { ctx.textAlign = toString(v) as any; }],
    ['textBaseline', () => ctx.textBaseline, (v) => { ctx.textBaseline = toString(v) as any; }],
    ['direction', () => ctx.direction, (v) => { ctx.direction = toString(v) as any; }],
    ['shadowBlur', () => ctx.shadowBlur, (v) => { ctx.shadowBlur = toNumber(v); }],
    ['shadowColor', () => ctx.shadowColor, (v) => { ctx.shadowColor = toString(v); }],
    ['shadowOffsetX', () => ctx.shadowOffsetX, (v) => { ctx.shadowOffsetX = toNumber(v); }],
    ['shadowOffsetY', () => ctx.shadowOffsetY, (v) => { ctx.shadowOffsetY = toNumber(v); }],
    ['imageSmoothingEnabled', () => ctx.imageSmoothingEnabled, (v) => { ctx.imageSmoothingEnabled = toBoolean(v); }],
    ['imageSmoothingQuality', () => ctx.imageSmoothingQuality, (v) => { ctx.imageSmoothingQuality = toString(v) as any; }],
    ['lineDashOffset', () => ctx.lineDashOffset, (v) => { ctx.lineDashOffset = toNumber(v); }],
  ];

  for (const [name, getter, setter] of gsProps) {
    obj.properties.set(name, {
      value: undefined,
      writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction(`get ${name}`, getter),
      setter: createNativeFunction(`set ${name}`, (_t, a) => setter(a[0])),
    });
  }

  return obj;
}

function wrapTextNode(node: DomNode): JSObject {
  const obj = createObject(null);
  obj.properties.set('nodeType', { value: 3, writable: false, enumerable: true, configurable: false });
  obj.properties.set('textContent', {
    value: (node as DomNode & { text?: string }).text ?? '',
    writable: true, enumerable: true, configurable: true,
  });
  (obj as JSObject & { __domNode: DomNode }).__domNode = node;
  return obj;
}

function getTextContent(el: DomElement): string {
  let text = '';
  for (const child of el.children) {
    if (child.nodeType === 'text') {
      text += (child as DomNode & { text?: string }).text ?? '';
    } else if (child.nodeType === 'element') {
      text += getTextContent(child as DomElement);
    }
  }
  return text;
}

function getInnerHTML(el: DomElement): string {
  let html = '';
  for (const child of el.children) {
    if (child.nodeType === 'text') {
      html += escapeHTML((child as DomNode & { text?: string }).text ?? '');
    } else if (child.nodeType === 'element') {
      const childEl = child as DomElement;
      html += `<${childEl.tagName}`;
      for (const [k, v] of childEl.attributes) {
        html += ` ${k}="${escapeAttr(v)}"`;
      }
      html += '>';
      html += getInnerHTML(childEl);
      html += `</${childEl.tagName}>`;
    }
  }
  return html;
}

function escapeHTML(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeHTML(s).replace(/"/g, '&quot;');
}

function shallowClone(el: DomElement): DomElement {
  return {
    domId: `dom-js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    nodeType: 'element',
    parent: null,
    children: [],
    tagName: el.tagName,
    attributes: new Map(el.attributes),
    computedStyle: null,
    layoutBox: null,
  };
}

function deepClone(el: DomElement): DomElement {
  const clone = shallowClone(el);
  for (const child of el.children) {
    if (child.nodeType === 'element') {
      const childClone = deepClone(child as DomElement);
      (childClone as unknown as { parent: DomNode | null }).parent = clone;
      clone.children.push(childClone);
    } else {
      const textClone = {
        domId: `dom-js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        nodeType: 'text' as const,
        parent: clone as unknown as DomNode | null,
        children: [],
        text: (child as DomNode & { text?: string }).text ?? '',
      };
      clone.children.push(textClone);
    }
  }
  return clone;
}

export function createEventObject(type: string, target: JSValue, options?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean }): JSObject {
  const evt = createObject(null);
  evt.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  evt.properties.set('target', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('currentTarget', { value: target, writable: true, enumerable: true, configurable: false });
  evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
  evt.properties.set('bubbles', { value: options?.bubbles ?? false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('cancelable', { value: options?.cancelable ?? false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('composed', { value: options?.composed ?? false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('defaultPrevented', { value: false, writable: true, enumerable: true, configurable: false });
  evt.properties.set('preventDefault', {
    value: createNativeFunction('preventDefault', (_this, _args) => {
      (evt as any).__defaultPrevented = true;
      evt.properties.set('defaultPrevented', { value: true, writable: true, enumerable: true, configurable: false });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopPropagation', {
    value: createNativeFunction('stopPropagation', (_this, _args) => {
      (evt as any).__stopPropagation = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopImmediatePropagation', {
    value: createNativeFunction('stopImmediatePropagation', (_this, _args) => {
      (evt as any).__stopPropagation = true;
      (evt as any).__stopImmediate = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return evt;
}
