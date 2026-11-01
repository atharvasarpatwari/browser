import type { DomDocument, DomElement, DomNode, DomTextNode, IDomTree } from '../rendering/dom-tree';
import { Animation, AnimationTimeline, KeyframeEffect, createAnimation, type Keyframe, type KeyframeEffectOptions } from '../rendering/compositing/animation-engine';
import type { CssAnimationAnimator } from '../rendering/css-animations';
import {
  type JSValue, type JSObject, type JSFunction, type JSObjectWithMeta,
  createObject, createArray, createNativeFunction,
  toNumber, toString, toBoolean,
  Environment,
  callJSFunction, ITERATOR_KEY, createIteratorArray, type PropertyDescriptor,
} from './values';
import { HTMLCanvasElement } from '../rendering/canvas/canvas-element';
import { CanvasRenderingContext2D } from '../rendering/canvas/canvas-context';
import type { CanvasGradient } from '../rendering/canvas/canvas-gradient';
import type { CanvasPattern } from '../rendering/canvas/canvas-pattern';
import { Path2D } from '../rendering/canvas/canvas-path';
import { isEventHandlerAttribute, isUrlAttribute, isBlockedUrlScheme } from '../security/blocked-url-schemes';
import { getScriptCookieProvider } from '../networking/cookie-service';
import { HtmlParser } from '../rendering/html-parser';
import { controlKind, controlValue, setControlValue, controlChecked, formOf } from '../rendering/form-controls';

// ─────────────────────────────────────────────────────────────────────────────
// DOM BINDINGS — Bridges the JS interpreter to the Nova DOM tree
//
// DomDocument/DomElement are data types; mutation methods live on IDomTree.
// We pass IDomTree into the bindings so all DOM operations go through it.
// ─────────────────────────────────────────────────────────────────────────────

/** Internal event extension properties monkey-patched onto JSObject event instances. */
interface DomEventFlags {
  __stopPropagation: boolean;
  __stopImmediate: boolean;
  __defaultPrevented: boolean;
}

function isClosure(v: JSValue): v is JSFunction {
  return typeof v === 'object' && v !== null && 'type' in v && (v as JSFunction).type === 'closure';
}

/** Typed access to event extension flags on a JSObject. */
function eventFlags(evt: JSObject): DomEventFlags {
  const e = evt as JSObject & DomEventFlags;
  return e;
}

/** Internal canvas extension properties stored on JSObject wrappers. */
interface CanvasExtensions {
  __canvasElement?: HTMLCanvasElement;
  __wrappedCtx?: JSObject;
  __canvasEl?: HTMLCanvasElement;
  __raw?: unknown;
}

// ── Shared event infrastructure ─────────────────────────────────────────────

interface DomListenerEntry {
  type: string;
  fn: JSFunction;
  capture: boolean;
  once: boolean;
  thisArg: JSValue;
  __marked?: boolean;
}

const domListenerMap = new WeakMap<DomNode, DomListenerEntry[]>();

function getDomListeners(node: DomNode | DomDocument): DomListenerEntry[] {
  let list = domListenerMap.get(node as DomNode);
  if (!list) {
    list = [];
    domListenerMap.set(node as DomNode, list);
  }
  return list;
}

function invokeDomListeners(
  node: DomNode | DomDocument,
  eventType: string,
  event: JSObject,
  isCapture: boolean,
): boolean {
  const entries = getDomListeners(node);
  let stopped = false;
  for (const entry of entries) {
    if (entry.type !== eventType || entry.capture !== isCapture) continue;
    if (eventFlags(event).__stopImmediate) break;
    try {
      const wrapper = entry.thisArg && typeof entry.thisArg === 'object' && '__domNode' in entry.thisArg
        ? entry.thisArg
        : event.properties.get('currentTarget')?.value ?? event.properties.get('target')?.value;
      callJSFunction(entry.fn, wrapper ?? null, [event]);
    } catch { /* swallow handler errors */ }
    if (entry.once) entry.__marked = true;
    if (eventFlags(event).__stopPropagation) { stopped = true; break; }
  }
  return stopped;
}

function cleanupDomOnceListeners(node: DomNode | DomDocument): void {
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
    usedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    _dirtyStyle: true,
    _dirtyLayout: true,
    _dirtyPaint: true,
  };
}

/** Create a lightweight DomTextNode (for document.createTextNode). */
function makeTextNode(text: string, parent: DomNode | null): DomTextNode {
  return {
    domId: `dom-js-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    nodeType: 'text',
    parent,
    children: [],
    text,
    _dirtyStyle: true,
    _dirtyLayout: true,
    _dirtyPaint: true,
  };
}

/** addEventListener's third argument: `true` (capture) or `{ capture, once }`. */
function listenerOptions(opts: JSValue): { capture: boolean; once: boolean } {
  if (typeof opts === 'boolean') return { capture: opts, once: false };
  if (opts && typeof opts === 'object' && 'properties' in opts) {
    const o = opts as JSObject;
    return { capture: toBoolean(o.properties.get('capture')?.value ?? false), once: toBoolean(o.properties.get('once')?.value ?? false) };
  }
  return { capture: false, once: false };
}

/** Each document node's JS object, so element events can reach `document` listeners. */
const documentObjects = new WeakMap<DomNode, JSObject>();

export function createDocumentBinding(
  doc: DomDocument,
  domTree: IDomTree,
  /** URL `document.cookie` is scoped to (the document's current URL). */
  cookieUrl: () => string = () => '',
): JSObject {
  const docObj = createObject(interfacePrototype('Document'));
  documentObjects.set(doc, docObj);

  // document.cookie — through the platform's ScriptCookieProvider (cookie-service.ts).
  // HttpOnly cookies are never visible or writable here.
  docObj.properties.set('cookie', {
    value: '',
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get cookie', () => getScriptCookieProvider()?.get(cookieUrl()) ?? ''),
    setter: createNativeFunction('set cookie', (_t, args) => {
      getScriptCookieProvider()?.set(cookieUrl(), toString(args[0]));
      return undefined;
    }),
  });

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

  // createDocumentFragment / createComment / createElementNS / hasFocus (missing; calling them
  // now throws, so pages that build DOM with fragments stopped at the first one).
  docObj.properties.set('createDocumentFragment', {
    value: createNativeFunction('createDocumentFragment', () => wrapElement(makeElement(FRAGMENT_TAG, null), domTree)),
    writable: true, enumerable: true, configurable: true,
  });
  docObj.properties.set('createComment', {
    // ponytail: a comment is an empty text node (nothing renders either way).
    value: createNativeFunction('createComment', () => wrapTextNode(makeTextNode('', null), domTree)),
    writable: true, enumerable: true, configurable: true,
  });
  docObj.properties.set('createElementNS', {
    value: createNativeFunction('createElementNS', (_this, args) => {
      const qname = toString(args[1]);
      return wrapElement(makeElement(qname.includes(':') ? qname.split(':')[1]! : qname, null), domTree);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  docObj.properties.set('hasFocus', {
    value: createNativeFunction('hasFocus', () => true),
    writable: true, enumerable: true, configurable: true,
  });

  // createTextNode
  docObj.properties.set('createTextNode', {
    value: createNativeFunction('createTextNode', (_this, args) => {
      const text = toString(args[0]);
      const node = makeTextNode(text, null);
      return wrapTextNode(node, domTree);
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
      // capture / once were ignored here: capture listeners ran while bubbling, `once` every time.
      const { capture, once } = listenerOptions(args[2]);
      const entries = getDomListeners(doc);
      const dup = entries.find(e => e.type === type && e.fn === fn && e.capture === capture);
      if (!dup) entries.push({ type, fn, capture, once, thisArg: _this });
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

      eventFlags(evt).__stopPropagation = false;
      eventFlags(evt).__stopImmediate = false;
      eventFlags(evt).__defaultPrevented = false;

      // Elements only: the walk used to reach the document node itself and wrap it as an element
      // (no tagName), so every document.dispatchEvent threw (DOMContentLoaded never reached anyone).
      const ancestors: DomNode[] = [];
      let cur: DomNode | null = doc.bodyElement;
      while (cur && cur.nodeType === 'element') {
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
        if (eventFlags(evt).__stopPropagation) break;
      }

      // Target phase (document itself)
      if (!eventFlags(evt).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 2, writable: true, enumerable: true, configurable: false });
        evt.properties.set('currentTarget', { value: wrappedDoc, writable: true, enumerable: true, configurable: false });
        invokeDomListeners(doc, eventType, evt, false);
      }

      // Cleanup
      evt.properties.set('currentTarget', { value: null, writable: true, enumerable: true, configurable: false });
      evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
      cleanupDomOnceListeners(doc);
      for (const ancestor of ancestors) cleanupDomOnceListeners(ancestor);

      return !eventFlags(evt).__defaultPrevented;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return docObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// ELEMENT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

const elementCache = new WeakMap<DomElement, JSObject>();

// ── DOM interface prototypes ───────────────────────────────────────────────
// EventTarget ← Node ← Element/HTMLElement ← HTMLInputElement…, Node ← Text, Node ← Document.
// Wrappers link to them so `x instanceof HTMLElement` works and `Element.prototype.foo = …`
// polyfills reach every element (the interfaces did not exist: instanceof threw).
const INTERFACE_PARENT: Record<string, string | null> = {
  EventTarget: null, Node: 'EventTarget', Element: 'Node', HTMLElement: 'Element', Text: 'Node', Document: 'Node',
  HTMLMediaElement: 'HTMLElement', HTMLVideoElement: 'HTMLMediaElement', HTMLAudioElement: 'HTMLMediaElement',
};
const TAG_INTERFACE: Record<string, string> = {
  a: 'HTMLAnchorElement', img: 'HTMLImageElement', input: 'HTMLInputElement', button: 'HTMLButtonElement', form: 'HTMLFormElement',
  select: 'HTMLSelectElement', option: 'HTMLOptionElement', textarea: 'HTMLTextAreaElement', label: 'HTMLLabelElement',
  div: 'HTMLDivElement', span: 'HTMLSpanElement', p: 'HTMLParagraphElement', ul: 'HTMLUListElement', ol: 'HTMLOListElement', li: 'HTMLLIElement',
  table: 'HTMLTableElement', tr: 'HTMLTableRowElement', td: 'HTMLTableCellElement', th: 'HTMLTableCellElement',
  script: 'HTMLScriptElement', style: 'HTMLStyleElement', link: 'HTMLLinkElement', meta: 'HTMLMetaElement', iframe: 'HTMLIFrameElement',
  canvas: 'HTMLCanvasElement', video: 'HTMLVideoElement', audio: 'HTMLAudioElement', body: 'HTMLBodyElement', html: 'HTMLHtmlElement',
  head: 'HTMLHeadElement', template: 'HTMLTemplateElement', h1: 'HTMLHeadingElement', h2: 'HTMLHeadingElement', h3: 'HTMLHeadingElement',
  h4: 'HTMLHeadingElement', h5: 'HTMLHeadingElement', h6: 'HTMLHeadingElement', br: 'HTMLBRElement', hr: 'HTMLHRElement', svg: 'SVGElement',
};
export const DOM_INTERFACE_NAMES = [...new Set([...Object.keys(INTERFACE_PARENT), ...Object.values(TAG_INTERFACE)])];
const interfaceProtos = new Map<string, JSObject>();
export function interfacePrototype(name: string): JSObject {
  let proto = interfaceProtos.get(name);
  if (!proto) {
    const parent = name in INTERFACE_PARENT ? INTERFACE_PARENT[name] : name === 'SVGElement' ? 'Element' : 'HTMLElement';
    proto = createObject(parent ? interfacePrototype(parent) : null);
    interfaceProtos.set(name, proto);
  }
  return proto;
}

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
      const item = Array.isArray(obj) ? (obj as unknown[])[i] : obj.properties.get(String(i))?.value;
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
  const offsets: number[] = [];
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
    direction: readProp('direction', 'normal') as 'normal' | 'reverse' | 'alternate' | 'alternate-reverse',
    fill: readProp('fill', 'none') as 'none' | 'forwards' | 'backwards' | 'both',
    easing: readProp('easing', 'linear') as string,
  };
}

// ── Shared animation timeline for JS-created animations ──
const jsAnimationTimeline = new AnimationTimeline();

// ── Active animation runtime ────────────────────────────────────────────────
// Set by the page renderer so JS-created animations (element.animate()) share
// the reflow controller's timeline and are resolved at paint time by the
// animator. Falls back to the module timeline when unset (unit-test contexts).
export interface AnimationRuntime {
  timeline: AnimationTimeline;
  animator: CssAnimationAnimator;
}

let activeAnimationRuntime: AnimationRuntime | null = null;

/** Set (or clear) the active animation runtime for JS-created animations. */
export function setAnimationRuntime(runtime: AnimationRuntime | null): void {
  activeAnimationRuntime = runtime;
}

function getAnimationRuntime(): AnimationRuntime | null {
  return activeAnimationRuntime;
}

/**
 * Dispatch an animation event to element's addEventListener listeners.
 * Called by CssAnimationAnimator when animations fire start/iteration/end.
 */
export function dispatchAnimationEventToElement(
  event: { type: string; target: DomElement; animationName: string; currentTime: number },
): void {
  const jsEvent = createObject(null);
  jsEvent.properties.set('type', { value: event.type, writable: true, enumerable: true, configurable: true });
  jsEvent.properties.set('target', { value: event.target as unknown as JSValue, writable: true, enumerable: true, configurable: true });
  jsEvent.properties.set('animationName', { value: event.animationName, writable: true, enumerable: true, configurable: true });
  jsEvent.properties.set('currentTime', { value: event.currentTime, writable: true, enumerable: true, configurable: true });
  jsEvent.properties.set('bubbles', { value: false, writable: true, enumerable: true, configurable: true });
  jsEvent.properties.set('cancelable', { value: false, writable: true, enumerable: true, configurable: true });
  invokeDomListeners(event.target, event.type, jsEvent, false);
}

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
    obj.properties.set('finished', { value: anim.finished as unknown as JSValue, writable: true, enumerable: true, configurable: true });
    obj.properties.set('pending', { value: anim.pending, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onfinish', { value: obj.properties.get('onfinish')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('oncancel', { value: obj.properties.get('oncancel')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onremove', { value: obj.properties.get('onremove')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onanimationstart', { value: obj.properties.get('onanimationstart')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onanimationiteration', { value: obj.properties.get('onanimationiteration')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
    obj.properties.set('onanimationend', { value: obj.properties.get('onanimationend')?.value ?? undefined, writable: true, enumerable: true, configurable: true });
  };

  syncProps();

  // Wire finish callback
  const prevOnFinish = anim.onFinish;
  anim.onFinish = (evt) => {
    const cb = obj.properties.get('onfinish')?.value;
    if (isClosure(cb)) {
      callJSFunction(cb, obj, []);
    }
    if (prevOnFinish) prevOnFinish(evt);
    syncProps();
  };

  anim.onCancel = (evt) => {
    const cb = obj.properties.get('oncancel')?.value;
    if (isClosure(cb)) {
      callJSFunction(cb, obj, []);
    }
    syncProps();
  };

  // Wire animationstart/iteration/end to dispatch DOM events on the element
  anim.setEventHandler((event) => {
    const propKey = event.type === 'animationstart' ? 'onanimationstart'
      : event.type === 'animationiteration' ? 'onanimationiteration'
      : 'onanimationend';
    const cb = obj.properties.get(propKey)?.value;
    if (isClosure(cb)) {
      callJSFunction(cb, obj, []);
    }
  });

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

  (obj as JSObjectWithMeta).__animation = anim;
  return obj;
}

function getAttr(el: DomElement, name: string): string | undefined {
  return el.attributes.get(name);
}

export function wrapElement(el: DomElement, domTree: IDomTree): JSObject {
  const cached = elementCache.get(el);
  if (cached) return cached;

  const obj = createObject(interfacePrototype(TAG_INTERFACE[el.tagName.toLowerCase()] ?? 'HTMLElement'));

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
        for (const n of expandFragment(domNode)) domTree.appendChild(el, n);
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
        for (const n of expandFragment(newNode)) domTree.insertBefore(el, n, refNode);
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
      const { capture, once } = listenerOptions(args[2]);
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
      eventFlags(evt).__stopPropagation = false;
      eventFlags(evt).__stopImmediate = false;
      eventFlags(evt).__defaultPrevented = false;

      // Build ancestor chain (elements only, no text or document nodes)
      // When composed=false, stop at shadow root boundaries.
      // When composed=true, cross shadow boundaries to the host element.
      const composed = evt.properties.get('composed')?.value === true;
      const ancestors: DomNode[] = [];
      let docNode: DomNode | null = null;
      let cur: DomNode | null = el.parent;
      while (cur) {
        if (cur.nodeType === 'element') {
          ancestors.push(cur);
        } else if (cur.nodeType === 'document') {
          docNode = cur;
        }
        // Shadow root boundary: a fragment node with a host (e.g. shadow root).
        // When composed=false, stop here; when composed=true, jump to host.
        const isShadowBoundary = cur.nodeType !== 'element' && 'host' in cur && (cur as unknown as { host: DomNode }).host;
        if (isShadowBoundary) {
          if (!composed) break;
          const host = (cur as unknown as { host: DomNode }).host as DomNode;
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

      // The document is the last stop of bubbling and the first of capture. Element events never
      // reached it, so `document.addEventListener('click', …)` delegation saw no real click.
      const docTarget = docNode ? documentObjects.get(docNode) ?? null : null;

      // ── CAPTURE PHASE: root → parent-of-target ──
      evt.properties.set('eventPhase', { value: 1, writable: true, enumerable: true, configurable: false });
      if (docNode && docTarget) {
        evt.properties.set('currentTarget', { value: docTarget, writable: true, enumerable: true, configurable: false });
        invokeDomListeners(docNode, eventType, evt, true);
      }
      for (let i = ancestors.length - 1; i >= 0 && !eventFlags(evt).__stopPropagation; i--) {
        const ancestor = ancestors[i];
        const wrapped = wrapElement(ancestor as DomElement, domTree);
        evt.properties.set('currentTarget', { value: wrapped, writable: true, enumerable: true, configurable: false });
        if (invokeDomListeners(ancestor, eventType, evt, true)) break;
        if (eventFlags(evt).__stopPropagation) break;
      }

      // ── TARGET PHASE ──
      if (!eventFlags(evt).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 2, writable: true, enumerable: true, configurable: false });
        evt.properties.set('currentTarget', { value: wrappedTarget, writable: true, enumerable: true, configurable: false });
        invokeDomListeners(el, eventType, evt, false);
        if (!eventFlags(evt).__stopPropagation) {
          invokeDomListeners(el, eventType, evt, true);
        }
      }

      // ── BUBBLE PHASE: parent-of-target → root ──
      if (bubbles && !eventFlags(evt).__stopPropagation) {
        evt.properties.set('eventPhase', { value: 3, writable: true, enumerable: true, configurable: false });
        for (const ancestor of ancestors) {
          const wrapped = wrapElement(ancestor as DomElement, domTree);
          evt.properties.set('currentTarget', { value: wrapped, writable: true, enumerable: true, configurable: false });
          if (invokeDomListeners(ancestor, eventType, evt, false)) break;
          if (eventFlags(evt).__stopPropagation) break;
        }
        if (docNode && docTarget && !eventFlags(evt).__stopPropagation) {
          evt.properties.set('currentTarget', { value: docTarget, writable: true, enumerable: true, configurable: false });
          invokeDomListeners(docNode, eventType, evt, false);
        }
      }

      // Cleanup
      evt.properties.set('currentTarget', { value: null, writable: true, enumerable: true, configurable: false });
      evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
      cleanupDomOnceListeners(el);
      if (docNode) cleanupDomOnceListeners(docNode);
      for (const ancestor of ancestors) cleanupDomOnceListeners(ancestor);

      return !eventFlags(evt).__defaultPrevented;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // matches — was `querySelector(sel) === el`, true only for the first match in the document
  obj.properties.set('matches', {
    value: createNativeFunction('matches', (_this, args) => domTree.querySelectorAll(toString(args[0])).includes(el)),
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
      let hc = (el as unknown as CanvasExtensions).__canvasElement as HTMLCanvasElement | undefined;
      if (!hc) {
        const w = parseInt(el.attributes.get('width') ?? '300', 10) || 300;
        const h = parseInt(el.attributes.get('height') ?? '150', 10) || 150;
        hc = new HTMLCanvasElement(w, h);
        (el as unknown as CanvasExtensions).__canvasElement = hc;
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
          let wrapped = (obj as unknown as CanvasExtensions).__wrappedCtx as JSObject | undefined;
          if (!wrapped) {
            wrapped = wrapCanvasContext(ctx);
            (obj as unknown as CanvasExtensions).__wrappedCtx = wrapped;
            // Store reference back to canvas for 'canvas' property
            (wrapped as unknown as CanvasExtensions).__canvasEl = hc;
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
        (obj as unknown as CanvasExtensions).__wrappedCtx = undefined;
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
        (obj as unknown as CanvasExtensions).__wrappedCtx = undefined;
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
          if (callback) callJSFunction(callback, null, [blob as unknown as JSValue]);
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
      const runtime = getAnimationRuntime();
      const timeline = runtime?.timeline ?? jsAnimationTimeline;
      const effect = new KeyframeEffect(el.domId, keyframes, options);
      const anim = new Animation(effect, timeline);
      anim.start();
      // Route through the animator so animated values render at paint time.
      runtime?.animator.registerAnimation(anim);
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
        runtime?.animator.unregisterAnimation(anim);
        if (origFinish) origFinish(evt);
      };
      return wrapAnimation(anim);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  defineTreeApis(obj, el, domTree);
  defineElementExtras(obj, el, domTree);

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
  if (v && typeof v === 'object' && '__raw' in (v as unknown as CanvasExtensions)) return (v as unknown as CanvasExtensions).__raw;
  return v;
}

/** Unwrap an image source for drawImage: accepts a canvas wrapper or a raw image-data object. */
function unwrapImageSource(v: JSValue): any {
  if (v && typeof v === 'object') {
    const obj = v as JSObject;
    // If it's a canvas element wrapper, get the HTMLCanvasElement
    if ('__canvasEl' in (obj as unknown as CanvasExtensions)) return (obj as unknown as CanvasExtensions).__canvasEl;
    // If it's an ImageData-like raw object
    if ('__raw' in (obj as unknown as CanvasExtensions)) return (obj as unknown as CanvasExtensions).__raw;
    // If it looks like { data, width, height } pass through
    if (obj.properties.has('data') && obj.properties.has('width') && obj.properties.has('height')) {
      return {
        data: (obj.properties.get('data')?.value as unknown as { _data?: unknown })?._data ?? obj.properties.get('data')?.value,
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
  (obj as unknown as CanvasExtensions).__raw = g;
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
  (obj as unknown as CanvasExtensions).__raw = p;
  return obj;
}

/** Wrap an ImageData as a JSObject. */
function wrapImageData(d: { data: Uint8ClampedArray; width: number; height: number }): JSObject {
  const obj = createObject(null);
  (obj as unknown as CanvasExtensions).__raw = d;
  obj.properties.set('data', { value: d.data as unknown as JSValue, writable: false, enumerable: true, configurable: false });
  obj.properties.set('width', { value: d.width, writable: false, enumerable: true, configurable: false });
  obj.properties.set('height', { value: d.height, writable: false, enumerable: true, configurable: false });
  return obj;
}

/** Wrap a Path2D as a JSObject. */
function wrapPath2D(p: Path2D): JSObject {
  const obj = createObject(null);
  (obj as unknown as CanvasExtensions).__raw = p;
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
  (obj as unknown as CanvasExtensions).__raw = m;
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
  (obj as unknown as CanvasExtensions).__raw = ctx;

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
      ctx.clip(a[0] !== undefined ? toString(a[0]) as 'nonzero' | 'evenodd' : undefined);
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
      ctx.fill(a[0] !== undefined ? toString(a[0]) as 'nonzero' | 'evenodd' : undefined);
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
      const p = ctx.createPattern(img, rep as 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat');
      return p ? wrapPattern(p) : null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Path2D support ──
  obj.properties.set('Path2D', {
    value: createNativeFunction('Path2D', (_t, a) => {
      const p = a[0] !== undefined ? new Path2D(unwrapRaw(a[0])) : new Path2D();
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
        if (callback) callJSFunction(callback, null, [blob as unknown as JSValue]);
      }, a[1] !== undefined ? toString(a[1]) : undefined, a[2] !== undefined ? toNumber(a[2]) : undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── canvas reference ──
  obj.properties.set('canvas', {
    value: undefined, // set by wrapElement when creating the context
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get canvas', () => {
      const hc = (obj as unknown as CanvasExtensions).__canvasEl;
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
    ['lineCap', () => ctx.lineCap, (v) => { ctx.lineCap = toString(v) as CanvasLineCap; }],
    ['lineJoin', () => ctx.lineJoin, (v) => { ctx.lineJoin = toString(v) as CanvasLineJoin; }],
    ['miterLimit', () => ctx.miterLimit, (v) => { ctx.miterLimit = toNumber(v); }],
    ['globalAlpha', () => ctx.globalAlpha, (v) => { ctx.globalAlpha = toNumber(v); }],
    ['globalCompositeOperation', () => ctx.globalCompositeOperation, (v) => { ctx.globalCompositeOperation = toString(v); }],
    ['font', () => ctx.font, (v) => { ctx.font = toString(v); }],
    ['textAlign', () => ctx.textAlign, (v) => { ctx.textAlign = toString(v) as CanvasTextAlign; }],
    ['textBaseline', () => ctx.textBaseline, (v) => { ctx.textBaseline = toString(v) as CanvasTextBaseline; }],
    ['direction', () => ctx.direction, (v) => { ctx.direction = toString(v) as CanvasDirection; }],
    ['shadowBlur', () => ctx.shadowBlur, (v) => { ctx.shadowBlur = toNumber(v); }],
    ['shadowColor', () => ctx.shadowColor, (v) => { ctx.shadowColor = toString(v); }],
    ['shadowOffsetX', () => ctx.shadowOffsetX, (v) => { ctx.shadowOffsetX = toNumber(v); }],
    ['shadowOffsetY', () => ctx.shadowOffsetY, (v) => { ctx.shadowOffsetY = toNumber(v); }],
    ['imageSmoothingEnabled', () => ctx.imageSmoothingEnabled, (v) => { ctx.imageSmoothingEnabled = toBoolean(v); }],
    ['imageSmoothingQuality', () => ctx.imageSmoothingQuality, (v) => { ctx.imageSmoothingQuality = toString(v) as ImageSmoothingQuality; }],
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

// ─────────────────────────────────────────────────────────────────────────────
// TREE APIS: live navigation getters, selectors, HTML insertion, ChildNode/ParentNode
// ─────────────────────────────────────────────────────────────────────────────

export function wrapNode(node: DomNode | null | undefined, domTree: IDomTree): JSValue {
  if (!node) return null;
  return node.nodeType === 'element' ? wrapElement(node as DomElement, domTree) : wrapTextNode(node, domTree);
}

function isDescendantOf(node: DomNode, ancestor: DomElement): boolean {
  for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

/** Parses an HTML string into detached DOM nodes, applying setAttribute's safety rules. */
function parseHtmlFragment(html: string, domTree: IDomTree): DomNode[] {
  if (!domTree.parseFragment) return [];
  const body = new HtmlParser().parse(`<!doctype html><html><body>${html}</body></html>`).document.bodyElement;
  const nodes = domTree.parseFragment(body?.children ?? []);
  const scrub = (n: DomNode): void => {
    if (n.nodeType !== 'element') return;
    const attrs = (n as DomElement).attributes as Map<string, string>;
    for (const [name, value] of [...attrs]) {
      if (isEventHandlerAttribute(name) || (isUrlAttribute(name) && isBlockedUrlScheme(value))) attrs.delete(name);
    }
    for (const c of n.children) scrub(c);
  };
  nodes.forEach(scrub);
  return nodes;
}

/** ParentNode/ChildNode arguments: nodes as-is, anything else becomes a text node. */
function argsToNodes(args: JSValue[]): DomNode[] {
  return args.flatMap((a) =>
    typeof a === 'object' && a !== null && '__domNode' in a
      ? expandFragment((a as JSObject & { __domNode: DomNode }).__domNode)
      : [makeTextNode(toString(a), null)]);
}

const FRAGMENT_TAG = '#document-fragment';
/** Each <template>'s content fragment. */
const templateContents = new WeakMap<DomElement, DomElement>();

/** Default actions the browser performs for script-initiated activation (set by the browser window). */
export interface ActivationHandler {
  /** What a click that was not cancelled does: follow a link, tick a box, submit a form… */
  activate(el: DomElement): void;
  /** Submit a form; `fireSubmitEvent` false for `form.submit()`. */
  submit(form: DomElement, submitter: DomElement | null, fireSubmitEvent: boolean): void;
}
let activationHandler: ActivationHandler | null = null;
export function setActivationHandler(handler: ActivationHandler | null): void {
  activationHandler = handler;
}

/** A DocumentFragment inserts its children, and is left empty. */
function expandFragment(node: DomNode): DomNode[] {
  if (node.nodeType !== 'element' || (node as DomElement).tagName !== FRAGMENT_TAG) return [node];
  const kids = [...(node as DomElement).children];
  (node as { children: DomNode[] }).children = [];
  return kids;
}

const camelToKebab = (k: string): string => (k === 'cssFloat' ? 'float' : k.startsWith('--') ? k : k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
const kebabToCamel = (k: string): string => k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

function parseInlineStyle(css: string): Map<string, string> {
  const m = new Map<string, string>();
  // ponytail: splits on ';', so a ';' inside url("…") breaks; a real declaration parser if a site needs it.
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i > 0) m.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return m;
}

/**
 * element.style: reads and writes go to the element's style attribute, which the cascade applies.
 * It was a snapshot of computed values, so `el.style.display = "none"` changed nothing on screen.
 */
class StyleDeclarationMap extends Map<string, PropertyDescriptor> {
  constructor(private readonly el: DomElement, private readonly domTree: IDomTree) { super(); }
  decls(): Map<string, string> { return parseInlineStyle(this.el.attributes.get('style') ?? ''); }
  write(m: Map<string, string>): void {
    const css = [...m].map(([k, v]) => `${k}: ${v}`).join('; ');
    if (css) this.domTree.setAttribute(this.el, 'style', css);
    else this.domTree.removeAttribute(this.el, 'style');
  }
  setDecl(name: string, value: JSValue): void {
    const m = this.decls();
    const v = value === null || value === undefined ? '' : toString(value).trim();
    if (v === '') m.delete(camelToKebab(name)); else m.set(camelToKebab(name), v);
    this.write(m);
  }
  override get(key: string): PropertyDescriptor | undefined {
    const own = super.get(key);
    if (own || key.startsWith('Symbol(')) return own;
    return { value: this.decls().get(camelToKebab(key)) ?? '', writable: true, enumerable: true, configurable: true };
  }
  override has(key: string): boolean { return super.has(key) || this.decls().has(camelToKebab(key)); }
  override set(key: string, desc: PropertyDescriptor): this {
    if (super.has(key) || desc.getter || desc.setter) return super.set(key, desc);
    this.setDecl(key, desc.value);
    return this;
  }
  override *[Symbol.iterator](): MapIterator<[string, PropertyDescriptor]> {
    yield* super[Symbol.iterator]();
    for (const [k, v] of this.decls()) yield [kebabToCamel(k), { value: v, writable: true, enumerable: true, configurable: true }];
  }
}

/** element.dataset: data-* attributes by camelCase name (it was missing). */
class DatasetMap extends Map<string, PropertyDescriptor> {
  constructor(private readonly el: DomElement, private readonly domTree: IDomTree) { super(); }
  private attr(key: string): string { return 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); }
  override get(key: string): PropertyDescriptor | undefined {
    const v = this.el.attributes.get(this.attr(key));
    return v === undefined ? undefined : { value: v, writable: true, enumerable: true, configurable: true };
  }
  override has(key: string): boolean { return this.el.attributes.has(this.attr(key)); }
  override set(key: string, desc: PropertyDescriptor): this { this.domTree.setAttribute(this.el, this.attr(key), toString(desc.value)); return this; }
  override delete(key: string): boolean { const had = this.has(key); if (had) this.domTree.removeAttribute(this.el, this.attr(key)); return had; }
  override *[Symbol.iterator](): MapIterator<[string, PropertyDescriptor]> {
    for (const [k, v] of this.el.attributes) if (k.startsWith('data-')) yield [kebabToCamel(k.slice(5)), { value: v, writable: true, enumerable: true, configurable: true }];
  }
  override keys(): MapIterator<string> { return [...this].map(([k]) => k)[Symbol.iterator]() as MapIterator<string>; }
  override entries(): MapIterator<[string, PropertyDescriptor]> { return [...this][Symbol.iterator]() as MapIterator<[string, PropertyDescriptor]>; }
}

/** Element APIs pages call constantly; calling a missing method now throws, so these matter. */
function defineElementExtras(obj: JSObject, el: DomElement, domTree: IDomTree): void {
  const method = (name: string, fn: (args: JSValue[]) => JSValue): void => {
    obj.properties.set(name, { value: createNativeFunction(name, (_this, args) => fn(args)), writable: true, enumerable: true, configurable: true });
  };
  const nodeOf = (v: JSValue): DomNode | null => (typeof v === 'object' && v !== null && '__domNode' in v ? (v as JSObject & { __domNode: DomNode }).__domNode : null);

  // style
  const style = createObject(null);
  const decls = new StyleDeclarationMap(el, domTree);
  style.properties = decls;
  // Methods and cssText go straight into the map (our set() would treat them as CSS properties).
  Map.prototype.set.call(decls, 'setProperty', { value: createNativeFunction('setProperty', (_t, a) => { decls.setDecl(toString(a[0]), a[1]); return undefined; }), writable: true, enumerable: false, configurable: true });
  Map.prototype.set.call(decls, 'getPropertyValue', { value: createNativeFunction('getPropertyValue', (_t, a) => decls.decls().get(camelToKebab(toString(a[0]))) ?? ''), writable: true, enumerable: false, configurable: true });
  Map.prototype.set.call(decls, 'removeProperty', { value: createNativeFunction('removeProperty', (_t, a) => { const k = camelToKebab(toString(a[0])); const m = decls.decls(); const old = m.get(k) ?? ''; m.delete(k); decls.write(m); return old; }), writable: true, enumerable: false, configurable: true });
  Map.prototype.set.call(decls, 'getPropertyPriority', { value: createNativeFunction('getPropertyPriority', () => ''), writable: true, enumerable: false, configurable: true });
  Map.prototype.set.call(decls, 'cssText', {
    value: undefined, writable: true, enumerable: false, configurable: true,
    getter: createNativeFunction('get cssText', () => el.attributes.get('style') ?? ''),
    setter: createNativeFunction('set cssText', (_t, a) => { decls.write(parseInlineStyle(toString(a[0]))); return undefined; }),
  });
  obj.properties.set('style', {
    value: style, writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get style', () => style),
    setter: createNativeFunction('set style', (_t, a) => { decls.write(parseInlineStyle(toString(a[0]))); return undefined; }),
  });

  // classList
  const classes = (): string[] => (el.attributes.get('class') ?? '').split(/\s+/).filter(Boolean);
  const writeClasses = (list: string[]): void => { domTree.setAttribute(el, 'class', list.join(' ')); };
  const classList = createObject(null);
  const cmethod = (name: string, fn: (args: JSValue[]) => JSValue) =>
    classList.properties.set(name, { value: createNativeFunction(name, (_t, a) => fn(a)), writable: true, enumerable: false, configurable: true });
  cmethod('add', (a) => { const l = classes(); for (const n of a.map(toString)) if (!l.includes(n)) l.push(n); writeClasses(l); return undefined; });
  cmethod('remove', (a) => { const rm = a.map(toString); writeClasses(classes().filter((c) => !rm.includes(c))); return undefined; });
  cmethod('contains', (a) => classes().includes(toString(a[0])));
  cmethod('toggle', (a) => {
    const n = toString(a[0]); const l = classes(); const has = l.includes(n);
    const want = a.length > 1 && a[1] !== undefined ? toBoolean(a[1]) : !has;
    if (want && !has) writeClasses([...l, n]);
    if (!want && has) writeClasses(l.filter((c) => c !== n));
    return want;
  });
  cmethod('replace', (a) => { const l = classes(); const i = l.indexOf(toString(a[0])); if (i < 0) return false; l[i] = toString(a[1]); writeClasses([...new Set(l)]); return true; });
  cmethod('item', (a) => classes()[toNumber(a[0])] ?? null);
  cmethod('forEach', (a) => { classes().forEach((c, i) => callJSFunction(a[0] as JSFunction, a[1], [c, i, classList])); return undefined; });
  cmethod('toString', () => el.attributes.get('class') ?? '');
  for (const name of ['values', 'keys', 'entries', ITERATOR_KEY]) {
    cmethod(name, () => createIteratorArray(name === 'entries' ? classes().map((c, i) => createArray([i, c])) : name === 'keys' ? classes().map((_c, i) => i) : classes()));
  }
  classList.properties.set('length', { value: 0, writable: false, enumerable: false, configurable: true, getter: createNativeFunction('get length', () => classes().length) });
  classList.properties.set('value', {
    value: '', writable: true, enumerable: false, configurable: true,
    getter: createNativeFunction('get value', () => el.attributes.get('class') ?? ''),
    setter: createNativeFunction('set value', (_t, a) => { domTree.setAttribute(el, 'class', toString(a[0])); return undefined; }),
  });
  obj.properties.set('classList', { value: classList, writable: false, enumerable: true, configurable: true });

  // dataset
  const dataset = createObject(null);
  dataset.properties = new DatasetMap(el, domTree);
  obj.properties.set('dataset', { value: dataset, writable: false, enumerable: true, configurable: true });

  const fire = (type: string, bubbles: boolean): boolean => {
    const evt = createEventObject(type, obj, { bubbles, cancelable: true });
    const dispatch = obj.properties.get('dispatchEvent')?.value;
    if (dispatch && typeof dispatch === 'object') return callJSFunction(dispatch as JSFunction, obj, [evt]) !== false;
    return true;
  };
  method('contains', (a) => { for (let n = nodeOf(a[0]); n; n = n.parent as DomNode | null) if (n === el) return true; return false; });
  // el.click(): the event, then (unless a listener cancelled it) the default action — a scripted
  // click on a link or a submit button used to do nothing.
  method('click', () => { if (fire('click', true)) { toggleDetails(el, domTree); activationHandler?.activate(el); } return undefined; });
  if (el.tagName.toLowerCase() === 'form') {
    method('submit', () => { activationHandler?.submit(el, null, false); return undefined; });
    method('requestSubmit', (a) => { activationHandler?.submit(el, nodeOf(a[0]) as DomElement | null, true); return undefined; });
    method('reset', () => {
      // Back to the markup's values (formValue/formChecked hold what the user changed).
      const walk = (n: DomNode): void => {
        for (const c of (n as DomElement).children ?? []) {
          if (c.nodeType !== 'element') continue;
          delete (c as DomElement).formValue;
          delete (c as DomElement).formChecked;
          walk(c);
        }
      };
      walk(el);
      fire('reset', true);
      return undefined;
    });
  }
  method('focus', () => { fire('focus', false); fire('focusin', true); return undefined; });
  method('blur', () => { fire('blur', false); fire('focusout', true); return undefined; });
  for (const name of ['scrollIntoView', 'scrollTo', 'scrollBy', 'scroll', 'setPointerCapture', 'releasePointerCapture', 'normalize']) method(name, () => undefined);
  method('toggleAttribute', (a) => {
    const n = toString(a[0]); const has = el.attributes.has(n);
    const want = a.length > 1 && a[1] !== undefined ? toBoolean(a[1]) : !has;
    if (want && !has) domTree.setAttribute(el, n, '');
    if (!want && has) domTree.removeAttribute(el, n);
    return want;
  });
  method('hasChildNodes', () => el.children.length > 0);
  method('getClientRects', () => {
    const rect = obj.properties.get('getBoundingClientRect')?.value;
    return createArray(rect && typeof rect === 'object' ? [callJSFunction(rect as JSFunction, obj, [])] : []);
  });
  method('replaceWith', (a) => {
    const parent = el.parent as DomElement | null;
    if (!parent) return undefined;
    for (const n of argsToNodes(a)) domTree.insertBefore(parent, n, el);
    domTree.removeChild(parent, el);
    return undefined;
  });
  method('insertAdjacentElement', (a) => {
    const node = nodeOf(a[1]);
    if (!node) return null;
    const where = toString(a[0]).toLowerCase();
    const parent = el.parent as DomElement | null;
    if (where === 'beforebegin' && parent) domTree.insertBefore(parent, node, el);
    else if (where === 'afterend' && parent) domTree.insertBefore(parent, node, (parent.children[parent.children.indexOf(el) + 1] as DomNode | undefined) ?? null);
    else if (where === 'afterbegin') domTree.insertBefore(el, node, el.children[0] ?? null);
    else if (where === 'beforeend') domTree.appendChild(el, node);
    else return null;
    return a[1];
  });
  method('getElementsByTagName', (a) => {
    const tag = toString(a[0]).toLowerCase();
    const out: JSValue[] = [];
    const walk = (n: DomNode): void => {
      for (const c of (n as DomElement).children ?? []) {
        if (c.nodeType !== 'element') continue;
        if (tag === '*' || (c as DomElement).tagName.toLowerCase() === tag) out.push(wrapElement(c as DomElement, domTree));
        walk(c);
      }
    };
    walk(el);
    return createArray(out);
  });
}

function defineTreeApis(obj: JSObject, el: DomElement, domTree: IDomTree): void {
  const getter = (name: string, fn: () => JSValue): void => {
    obj.properties.set(name, {
      value: undefined, writable: false, enumerable: true, configurable: true,
      getter: createNativeFunction(`get ${name}`, fn),
    });
  };
  const method = (name: string, fn: (args: JSValue[]) => JSValue): void => {
    obj.properties.set(name, {
      value: createNativeFunction(name, (_this, args) => fn(args)),
      writable: true, enumerable: true, configurable: true,
    });
  };
  const elementChildren = (): DomElement[] => el.children.filter((c): c is DomElement => c.nodeType === 'element');
  const parentEl = (): DomElement | null => (el.parent && el.parent.nodeType === 'element' ? el.parent as DomElement : null);
  const siblings = (): DomNode[] => el.parent?.children ?? [];
  const insertAll = (parent: DomElement, nodes: DomNode[], ref: DomNode | null): void => {
    for (const n of nodes) domTree.insertBefore(parent, n, ref);
  };

  // Live navigation (these were values captured when the wrapper was first made, and the
  // wrapper is cached per element, so scripts saw the old tree after every change).
  getter('children', () => createArray(elementChildren().map((c) => wrapElement(c, domTree))));
  getter('childNodes', () => createArray(el.children.map((c) => wrapNode(c, domTree))));
  getter('childElementCount', () => elementChildren().length);

  // Layout geometry. offsetWidth/clientWidth were undefined, so script-measured UI (menus sized to
  // their content, carousels, sticky headers, "is it overflowing?" checks) computed NaN and broke.
  const box = () => el.layoutBox;
  const offsetParentEl = (): DomElement | null => {
    for (let p = parentEl(); p; p = p.parent && p.parent.nodeType === 'element' ? p.parent as DomElement : null) {
      const pos = p.computedStyle?.get('position') ?? 'static';
      if (pos !== 'static' || p.tagName.toLowerCase() === 'body') return p;
    }
    return null;
  };
  getter('offsetWidth', () => Math.round(box()?.width ?? 0));
  getter('offsetHeight', () => Math.round(box()?.height ?? 0));
  getter('offsetLeft', () => Math.round((box()?.x ?? 0) - (offsetParentEl()?.layoutBox?.x ?? 0)));
  getter('offsetTop', () => Math.round((box()?.y ?? 0) - (offsetParentEl()?.layoutBox?.y ?? 0)));
  getter('offsetParent', () => wrapNode(offsetParentEl(), domTree));
  const clientW = () => { const b = box(); return b ? Math.round(b.width - b.borderLeft - b.borderRight) : 0; };
  const clientH = () => { const b = box(); return b ? Math.round(b.height - b.borderTop - b.borderBottom) : 0; };
  getter('clientWidth', clientW);
  getter('clientHeight', clientH);
  getter('clientLeft', () => Math.round(box()?.borderLeft ?? 0));
  getter('clientTop', () => Math.round(box()?.borderTop ?? 0));
  // ponytail: no per-element scrolling yet, so the scroll size is the client size.
  getter('scrollWidth', clientW);
  getter('scrollHeight', clientH);

  getter('outerHTML', () => outerHTMLOf(el));
  obj.properties.set('innerText', {
    value: undefined, writable: true, enumerable: true, configurable: true,
    // ponytail: the text content, without CSS-aware line breaks or hidden-element skipping.
    getter: createNativeFunction('get innerText', () => textOf(el)),
    setter: createNativeFunction('set innerText', (_t, args) => {
      const val = toString(args[0]);
      (el as { children: DomNode[] }).children = [makeTextNode(val, el)];
      domTree.setTextContent(el, val);
      return undefined;
    }),
  });
  method('getAttributeNames', () => createArray([...el.attributes.keys()]));
  obj.properties.set('nodeType', { value: 1, writable: false, enumerable: true, configurable: true });
  if (!obj.properties.has('nodeName')) getter('nodeName', () => el.tagName.toUpperCase());
  // DOM §4.4: preceding 2, following 4, contains 8, contained-by 16.
  method('compareDocumentPosition', (args) => {
    const other = domNodeOf(args[0]);
    if (!other || other === el) return 0;
    const chain = (n: DomNode): DomNode[] => { const out: DomNode[] = []; for (let c: DomNode | null = n; c; c = c.parent) out.unshift(c); return out; };
    const a = chain(el), b = chain(other);
    if (a[0] !== b[0]) return 1 | 32; // disconnected
    if (b.includes(el)) return 4 | 16;  // other is inside el: follows and is contained
    if (a.includes(other)) return 2 | 8;  // other contains el: precedes and contains
    let i = 0;
    while (a[i] === b[i]) i++;
    const parent = a[i - 1]!;
    return parent.children.indexOf(a[i]!) < parent.children.indexOf(b[i]!) ? 4 : 2;
  });

  const tag = el.tagName.toLowerCase();
  if (tag === 'select') {
    const options = (): DomElement[] => {
      const out: DomElement[] = [];
      const walk = (n: DomElement): void => { for (const c of n.children) if (c.nodeType === 'element') { const e = c as DomElement; if (e.tagName.toLowerCase() === 'option') out.push(e); else walk(e); } };
      walk(el);
      return out;
    };
    getter('options', () => createArray(options().map((o) => wrapElement(o, domTree))));
    obj.properties.set('selectedIndex', {
      value: undefined, writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get selectedIndex', () => {
        const opts = options();
        const value = controlValue(el);
        const i = opts.findIndex((o) => (o.attributes.get('value') ?? textOf(o).trim()) === value);
        return i >= 0 ? i : (opts.length > 0 ? 0 : -1);
      }),
      setter: createNativeFunction('set selectedIndex', (_t, args) => {
        const o = options()[Math.trunc(Number(args[0]))];
        if (o) { setControlValue(el, o.attributes.get('value') ?? textOf(o).trim()); domTree.markDirty(el, 'paint'); }
        return undefined;
      }),
    });
  }
  if (tag === 'form') {
    // form.elements: its controls in tree order, also reachable by name.
    getter('elements', () => {
      const arr = createArray(formControlsOf(el).map((c) => wrapElement(c, domTree)));
      for (const c of formControlsOf(el)) {
        const name = c.attributes.get('name') ?? c.attributes.get('id');
        if (name && !arr.properties.has(name)) arr.properties.set(name, { value: wrapElement(c, domTree), writable: false, enumerable: false, configurable: true });
      }
      return arr;
    });
  }
  getter('parentNode', () => wrapNode(parentEl(), domTree));
  getter('parentElement', () => wrapNode(parentEl(), domTree));
  getter('firstChild', () => wrapNode(el.children[0], domTree));
  getter('lastChild', () => wrapNode(el.children[el.children.length - 1], domTree));
  getter('firstElementChild', () => wrapNode(elementChildren()[0], domTree));
  getter('lastElementChild', () => { const c = elementChildren(); return wrapNode(c[c.length - 1], domTree); });
  getter('nextSibling', () => { const s = siblings(); return wrapNode(s[s.indexOf(el) + 1], domTree); });
  getter('previousSibling', () => { const s = siblings(); return wrapNode(s[s.indexOf(el) - 1], domTree); });
  getter('nextElementSibling', () => {
    const s = siblings(); return wrapNode(s.slice(s.indexOf(el) + 1).find((n) => n.nodeType === 'element'), domTree);
  });
  getter('previousElementSibling', () => {
    const s = siblings(); return wrapNode(s.slice(0, s.indexOf(el)).reverse().find((n) => n.nodeType === 'element'), domTree);
  });

  // innerHTML: live getter + setter (the setter did nothing before)
  obj.properties.set('innerHTML', {
    value: undefined, writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get innerHTML', () => getInnerHTML(el)),
    setter: createNativeFunction('set innerHTML', (_t, args) => {
      for (const c of [...el.children]) domTree.removeChild(el, c);
      for (const n of parseHtmlFragment(toString(args[0]), domTree)) domTree.appendChild(el, n);
      return undefined;
    }),
  });

  method('insertAdjacentHTML', (args) => {
    const where = toString(args[0]).toLowerCase();
    const nodes = parseHtmlFragment(toString(args[1]), domTree);
    const parent = parentEl();
    if (where === 'beforebegin' && parent) insertAll(parent, nodes, el);
    else if (where === 'afterbegin') insertAll(el, nodes, el.children[0] ?? null);
    else if (where === 'beforeend') insertAll(el, nodes, null);
    else if (where === 'afterend' && parent) { const s = siblings(); insertAll(parent, nodes, s[s.indexOf(el) + 1] ?? null); }
    else throw new SyntaxError(`insertAdjacentHTML: '${toString(args[0])}' is not a valid position`);
    return undefined;
  });

  // Selectors scoped to this element. ponytail: a document-wide query filtered to descendants
  // (O(document) per call); walk the subtree directly if it shows up in profiles.
  // `:scope` is this element (it matched only the root, so `el.querySelectorAll(':scope > li')`
  // found nothing): mark it for the query with an attribute set outside the DOM's mutation log.
  const scoped = (selector: string): readonly DomElement[] => {
    if (!/:scope\b/i.test(selector)) return domTree.querySelectorAll(selector);
    const attrs = el.attributes as Map<string, string>;
    attrs.set('data-nova-scope', '');
    try { return domTree.querySelectorAll(selector.replace(/:scope\b/gi, '[data-nova-scope]')); } finally { attrs.delete('data-nova-scope'); }
  };
  method('querySelectorAll', (args) => createArray(
    scoped(toString(args[0])).filter((e) => isDescendantOf(e, el)).map((e) => wrapElement(e, domTree))));
  method('querySelector', (args) => wrapNode(scoped(toString(args[0])).find((e) => isDescendantOf(e, el)), domTree));
  method('closest', (args) => {
    const matches = new Set(domTree.querySelectorAll(toString(args[0])));
    for (let n: DomNode | null = el; n && n.nodeType === 'element'; n = n.parent) if (matches.has(n as DomElement)) return wrapNode(n, domTree);
    return null;
  });

  // ParentNode / ChildNode
  method('append', (args) => { insertAll(el, argsToNodes(args), null); return undefined; });
  method('prepend', (args) => { insertAll(el, argsToNodes(args), el.children[0] ?? null); return undefined; });
  method('replaceChildren', (args) => {
    for (const c of [...el.children]) domTree.removeChild(el, c);
    insertAll(el, argsToNodes(args), null);
    return undefined;
  });
  method('before', (args) => { const p = parentEl(); if (p) insertAll(p, argsToNodes(args), el); return undefined; });
  method('after', (args) => {
    const p = parentEl(); if (!p) return undefined;
    const s = siblings(); insertAll(p, argsToNodes(args), s[s.indexOf(el) + 1] ?? null); return undefined;
  });
  method('remove', () => { const p = parentEl(); if (p) domTree.removeChild(p, el); return undefined; });

  // Reflected attributes
  for (const name of ['lang', 'dir', 'title']) {
    obj.properties.set(name, {
      value: undefined, writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction(`get ${name}`, () => getAttr(el, name) ?? ''),
      setter: createNativeFunction(`set ${name}`, (_t, args) => { domTree.setAttribute(el, name, toString(args[0])); return undefined; }),
    });
  }
  // Form controls: the live value/checked state the page UI types and ticks into (scripts read
  // what the user typed, and setting .value repaints the field).
  if (controlKind(el)) {
    obj.properties.set('value', {
      value: undefined, writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get value', () => controlValue(el)),
      setter: createNativeFunction('set value', (_t, args) => {
        setControlValue(el, toString(args[0]));
        domTree.markDirty(el, 'paint');
        return undefined;
      }),
    });
    obj.properties.set('checked', {
      value: undefined, writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get checked', () => controlChecked(el)),
      setter: createNativeFunction('set checked', (_t, args) => {
        el.formChecked = toBoolean(args[0]);
        domTree.markDirty(el, 'paint');
        return undefined;
      }),
    });
    getter('form', () => wrapNode(formOf(el), domTree));
  }

  obj.properties.set('hidden', {
    value: undefined, writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get hidden', () => el.attributes.has('hidden')),
    setter: createNativeFunction('set hidden', (_t, args) => {
      if (toBoolean(args[0])) domTree.setAttribute(el, 'hidden', ''); else domTree.removeAttribute(el, 'hidden');
      return undefined;
    }),
  });
  if (el.tagName.toLowerCase() === 'template') {
    // template.content: a fragment holding the template's markup (it was undefined, so stamping
    // out `tpl.content.cloneNode(true)` threw). Children parsed or set by innerHTML move into it.
    getter('content', () => {
      let frag = templateContents.get(el);
      if (!frag) templateContents.set(el, frag = makeElement(FRAGMENT_TAG, null));
      for (const c of [...el.children]) domTree.appendChild(frag, c);
      return wrapElement(frag, domTree);
    });
  }
  if (el.tagName.toLowerCase() === 'details') {
    obj.properties.set('open', {
      value: undefined, writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get open', () => el.attributes.has('open')),
      setter: createNativeFunction('set open', (_t, args) => { setDetailsOpen(el, toBoolean(args[0]), domTree); return undefined; }),
    });
  }
}

const textNodeCache = new WeakMap<DomNode, JSObject>();

/**
 * A text node's wrapper. textContent/data/nodeValue are live: writes go through the DOM tree, so
 * they show on screen and reach MutationObservers. It was a snapshot (writes did nothing) and a
 * new object on every access (`p.firstChild === p.firstChild` was false).
 */
function wrapTextNode(node: DomNode, domTree: IDomTree): JSObject {
  const cached = textNodeCache.get(node);
  if (cached) return cached;
  const obj = createObject(interfacePrototype('Text'));
  textNodeCache.set(node, obj);
  obj.properties.set('nodeType', { value: 3, writable: false, enumerable: true, configurable: false });
  obj.properties.set('nodeName', { value: '#text', writable: false, enumerable: true, configurable: false });
  const text = () => (node as DomNode & { text?: string }).text ?? '';
  for (const name of ['textContent', 'data', 'nodeValue', 'wholeText']) {
    obj.properties.set(name, {
      value: undefined, writable: name !== 'wholeText', enumerable: true, configurable: true,
      getter: createNativeFunction(`get ${name}`, text),
      setter: name === 'wholeText' ? undefined : createNativeFunction(`set ${name}`, (_t, a) => { domTree.setTextContent(node as DomTextNode, toString(a[0] ?? '')); return undefined; }),
    });
  }
  obj.properties.set('length', { value: 0, writable: false, enumerable: true, configurable: true, getter: createNativeFunction('get length', () => text().length) });
  const parent = () => wrapNode(node.parent && node.parent.nodeType === 'element' ? node.parent as DomElement : null, domTree);
  obj.properties.set('parentNode', { value: null, writable: false, enumerable: true, configurable: true, getter: createNativeFunction('get parentNode', parent) });
  obj.properties.set('parentElement', { value: null, writable: false, enumerable: true, configurable: true, getter: createNativeFunction('get parentElement', parent) });
  obj.properties.set('remove', {
    value: createNativeFunction('remove', () => { if (node.parent && node.parent.nodeType === 'element') domTree.removeChild(node.parent as DomElement, node); return undefined; }),
    writable: true, enumerable: false, configurable: true,
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

// HTML §13.3: void elements have no end tag. `<br>` came back as `<br></br>`, which a script's
// innerHTML round trip re-parsed into two line breaks.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function getInnerHTML(el: DomElement): string {
  let html = '';
  for (const child of el.children) {
    if (child.nodeType === 'text') {
      html += escapeHTML((child as DomNode & { text?: string }).text ?? '');
    } else if (child.nodeType === 'element') {
      html += outerHTMLOf(child as DomElement);
    }
  }
  return html;
}

function outerHTMLOf(el: DomElement): string {
  const tag = el.tagName.toLowerCase();
  let html = `<${tag}`;
  for (const [k, v] of el.attributes) html += ` ${k}="${escapeAttr(v)}"`;
  html += '>';
  if (VOID_TAGS.has(tag)) return html;
  return html + getInnerHTML(el) + `</${tag}>`;
}

function textOf(n: DomNode): string {
  if (n.nodeType === 'text') return (n as DomNode & { text?: string }).text ?? '';
  return n.children.map(textOf).join('');
}

const domNodeOf = (v: JSValue): DomNode | null =>
  (typeof v === 'object' && v !== null && '__domNode' in v ? (v as JSObject & { __domNode: DomNode }).__domNode : null);

const LISTED_CONTROLS = new Set(['button', 'fieldset', 'input', 'object', 'output', 'select', 'textarea']);

function formControlsOf(form: DomElement): DomElement[] {
  const out: DomElement[] = [];
  const walk = (n: DomElement): void => {
    for (const c of n.children) {
      if (c.nodeType !== 'element') continue;
      const e = c as DomElement;
      if (LISTED_CONTROLS.has(e.tagName.toLowerCase())) out.push(e);
      walk(e);
    }
  };
  walk(form);
  return out;
}

/**
 * `new FormData(form)` (XHR §5): the form's successful controls as name/value pairs. FormData
 * didn't exist, so scripts that serialize a form before submitting it with fetch threw.
 * ponytail: string values only (no File entries).
 */
export function createFormData(formArg: JSValue): JSObject {
  const entries: Array<[string, string]> = [];
  const form = domNodeOf(formArg) as DomElement | null;
  if (form && form.nodeType === 'element') {
    for (const c of formControlsOf(form)) {
      const name = c.attributes.get('name');
      const kind = controlKind(c);
      if (!name || !kind || c.attributes.has('disabled')) continue;
      const type = (c.attributes.get('type') ?? '').toLowerCase();
      if (kind === 'button' || type === 'file' || type === 'image' || type === 'reset' || type === 'submit') continue;
      if ((kind === 'checkbox' || kind === 'radio') && !controlChecked(c)) continue;
      entries.push([name, (kind === 'checkbox' || kind === 'radio') ? (c.attributes.get('value') ?? 'on') : controlValue(c)]);
    }
  }
  const fd = createObject(null);
  const fn = (name: string, f: (a: JSValue[]) => JSValue): void => {
    fd.properties.set(name, { value: createNativeFunction(name, (_t, a) => f(a)), writable: true, enumerable: false, configurable: true });
  };
  fn('get', (a) => entries.find(([k]) => k === toString(a[0]))?.[1] ?? null);
  fn('getAll', (a) => createArray(entries.filter(([k]) => k === toString(a[0])).map(([, v]) => v)));
  fn('has', (a) => entries.some(([k]) => k === toString(a[0])));
  fn('append', (a) => { entries.push([toString(a[0]), toString(a[1])]); return undefined; });
  fn('set', (a) => {
    const k = toString(a[0]);
    const i = entries.findIndex(([n]) => n === k);
    const rest = entries.filter(([n], j) => n !== k || j === i);
    entries.splice(0, entries.length, ...rest);
    if (i >= 0) entries[entries.findIndex(([n]) => n === k)]![1] = toString(a[1]); else entries.push([k, toString(a[1])]);
    return undefined;
  });
  fn('delete', (a) => { const k = toString(a[0]); for (let i = entries.length - 1; i >= 0; i--) if (entries[i]![0] === k) entries.splice(i, 1); return undefined; });
  fn('entries', () => createArray(entries.map(([k, v]) => createArray([k, v]))));
  fn('keys', () => createArray(entries.map(([k]) => k)));
  fn('values', () => createArray(entries.map(([, v]) => v)));
  fn('forEach', (a) => { for (const [k, v] of [...entries]) callJSFunction(a[0] as JSFunction, undefined, [v, k, fd]); return undefined; });
  return fd;
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
    usedStyle: null,
    layoutBox: null,
    imageData: null,
    naturalWidth: 0,
    naturalHeight: 0,
    loadingState: 'none',
    willChange: null,
    _dirtyStyle: true,
    _dirtyLayout: true,
    _dirtyPaint: true,
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
        _dirtyStyle: true,
        _dirtyLayout: true,
        _dirtyPaint: true,
      };
      clone.children.push(textClone);
    }
  }
  return clone;
}

/**
 * Dispatches a trusted UI event (a tap's `click`) at an element through the same capture/bubble
 * path page scripts use. Returns false when a listener called preventDefault().
 */
export function dispatchDomEvent(el: DomElement, type: string, domTree: IDomTree): boolean {
  const target = wrapElement(el, domTree);
  const event = createEventObject(type, target, { bubbles: true, cancelable: true });
  const dispatch = target.properties.get('dispatchEvent')?.value;
  if (!dispatch || typeof dispatch !== 'object') return true;
  const notCanceled = callJSFunction(dispatch as JSFunction, target, [event]) !== false;
  if (notCanceled && type === 'click') toggleDetails(el, domTree);
  return notCanceled;
}

/**
 * HTML §4.11.1: a click on a <details>' summary opens or closes it. Tapping one did nothing.
 */
function toggleDetails(el: DomElement, domTree: IDomTree): void {
  for (let n: DomNode | null = el; n && n.nodeType === 'element'; n = n.parent) {
    const tag = (n as DomElement).tagName.toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'label') return;
    if (tag !== 'summary') continue;
    const details = n.parent as DomElement | null;
    if (details?.tagName.toLowerCase() !== 'details' || details.children.find((c) => c.nodeType === 'element' && (c as DomElement).tagName.toLowerCase() === 'summary') !== n) return;
    setDetailsOpen(details, !details.attributes.has('open'), domTree);
    return;
  }
}

/**
 * Opens or closes a <details> and fires its `toggle` event (HTML §4.11.1; it doesn't bubble).
 * ponytail: fired synchronously rather than queued as a task.
 */
function setDetailsOpen(details: DomElement, open: boolean, domTree: IDomTree): void {
  if (open === details.attributes.has('open')) return;
  if (open) domTree.setAttribute(details, 'open', '');
  else domTree.removeAttribute(details, 'open');
  const target = wrapElement(details, domTree);
  const dispatch = target.properties.get('dispatchEvent')?.value;
  if (dispatch && typeof dispatch === 'object') callJSFunction(dispatch as JSFunction, target, [createEventObject('toggle', target, { bubbles: false })]);
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
      eventFlags(evt).__defaultPrevented = true;
      evt.properties.set('defaultPrevented', { value: true, writable: true, enumerable: true, configurable: false });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopPropagation', {
    value: createNativeFunction('stopPropagation', (_this, _args) => {
      eventFlags(evt).__stopPropagation = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopImmediatePropagation', {
    value: createNativeFunction('stopImmediatePropagation', (_this, _args) => {
      eventFlags(evt).__stopPropagation = true;
      eventFlags(evt).__stopImmediate = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return evt;
}
