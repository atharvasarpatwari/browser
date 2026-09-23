import type { DomDocument, DomElement, DomNode, DomTextNode, IDomTree } from '../rendering/dom-tree';
import { Animation, AnimationTimeline, KeyframeEffect, createAnimation, type Keyframe, type KeyframeEffectOptions } from '../rendering/compositing/animation-engine';
import type { CssAnimationAnimator } from '../rendering/css-animations';
import {
  type JSValue, type JSObject, type JSFunction, type JSObjectWithMeta,
  createObject, createArray, createNativeFunction,
  toNumber, toString, toBoolean,
  Environment,
  callJSFunction,
} from './values';
import { HTMLCanvasElement } from '../rendering/canvas/canvas-element';
import { CanvasRenderingContext2D } from '../rendering/canvas/canvas-context';
import type { CanvasGradient } from '../rendering/canvas/canvas-gradient';
import type { CanvasPattern } from '../rendering/canvas/canvas-pattern';
import { Path2D } from '../rendering/canvas/canvas-path';
import { isEventHandlerAttribute, isUrlAttribute, isBlockedUrlScheme } from '../security/blocked-url-schemes';
import { offerElementForUpgrade, notifyConnectedTree, notifyDisconnectedTree, notifyAttributeChanged } from './custom-elements';
import { getAllPropertyDefinitions } from '../rendering/css5/property-definitions';
import { expandShorthands } from '../rendering/css5/cascade';

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

// ── element.style live binding ──────────────────────────────────────────────
// `element.style` used to be a one-time snapshot: a plain object populated
// from computedStyle at wrap time, with no connection back to the DOM. Reading
// it looked right, but `el.style.background = 'red'` was a dead end — it set
// a property on that disconnected object and nothing else, so no real page's
// runtime style changes (toggling visibility, JS-driven color/layout changes,
// etc.) ever took visible effect. Fixed by making every property a live
// getter/setter: the getter reads the element's current computed value, and
// the setter writes through to the actual inline `style` attribute (so the
// next cascade recompute — e.g. after all scripts finish — sees it) and also
// updates computedStyle directly so layout/paint for *this* frame and any
// synchronous read-after-write in the same script see the change immediately.

function cssPropToJs(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function jsPropToCss(prop: string): string {
  if (prop === 'cssFloat') return 'float';
  return prop.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function parseStyleAttrText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of text.split(';')) {
    const i = part.indexOf(':');
    if (i === -1) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k && v) map.set(k, v);
  }
  return map;
}

function serializeStyleAttrText(map: Map<string, string>): string {
  return Array.from(map.entries()).map(([k, v]) => `${k}: ${v}`).join('; ');
}

// Shorthands aren't in the property registry (they're not real computed-style
// keys — `background` expands to `background-color`/`background-image`/etc.),
// so they need their own entries in the style object and their own expansion
// on write, matching what the cascade already does for inline declarations.
const STYLE_SHORTHAND_PROPS = new Set([
  'margin', 'padding', 'border', 'border-width', 'border-style', 'border-color',
  'border-radius', 'background', 'font', 'list-style', 'animation', 'overflow',
]);

/** Writes one CSS property through to the element's real `style` attribute and computedStyle. */
function setElementStyleProperty(el: DomElement, domTree: IDomTree, cssProp: string, value: string): void {
  const map = parseStyleAttrText(el.attributes.get('style') ?? '');
  if (value === '') map.delete(cssProp);
  else map.set(cssProp, value);
  domTree.setAttribute(el, 'style', serializeStyleAttrText(map));
  if (!el.computedStyle) return;
  if (value === '') { el.computedStyle.delete(cssProp); return; }
  if (STYLE_SHORTHAND_PROPS.has(cssProp)) {
    for (const decl of expandShorthands([{ property: cssProp, value, important: false }])) {
      el.computedStyle.set(decl.property, decl.value);
    }
  } else {
    el.computedStyle.set(cssProp, value);
  }
}

function buildStyleObject(el: DomElement, domTree: IDomTree): JSObject {
  const styleObj = createObject(null);
  const cssProps = new Set<string>(Object.keys(getAllPropertyDefinitions()));
  for (const k of STYLE_SHORTHAND_PROPS) cssProps.add(k);
  if (el.computedStyle) for (const k of el.computedStyle.keys()) cssProps.add(k);

  for (const cssProp of cssProps) {
    const jsProp = cssPropToJs(cssProp);
    styleObj.properties.set(jsProp, {
      value: undefined,
      writable: false,
      enumerable: true,
      configurable: true,
      getter: createNativeFunction(jsProp, () => el.computedStyle?.get(cssProp) ?? ''),
      setter: createNativeFunction(jsProp, (_thisArg, args) => {
        setElementStyleProperty(el, domTree, cssProp, toString(args[0]));
      }),
    });
  }

  styleObj.properties.set('cssFloat', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('cssFloat', () => el.computedStyle?.get('float') ?? ''),
    setter: createNativeFunction('cssFloat', (_thisArg, args) => {
      setElementStyleProperty(el, domTree, 'float', toString(args[0]));
    }),
  });

  styleObj.properties.set('setProperty', {
    value: createNativeFunction('setProperty', (_thisArg, args) => {
      setElementStyleProperty(el, domTree, jsPropToCss(toString(args[0])), args[1] === undefined ? '' : toString(args[1]));
    }),
    writable: true, enumerable: false, configurable: true,
  });
  styleObj.properties.set('getPropertyValue', {
    value: createNativeFunction('getPropertyValue', (_thisArg, args) => el.computedStyle?.get(jsPropToCss(toString(args[0]))) ?? ''),
    writable: true, enumerable: false, configurable: true,
  });
  styleObj.properties.set('removeProperty', {
    value: createNativeFunction('removeProperty', (_thisArg, args) => {
      const cssProp = jsPropToCss(toString(args[0]));
      const old = el.computedStyle?.get(cssProp) ?? '';
      setElementStyleProperty(el, domTree, cssProp, '');
      return old;
    }),
    writable: true, enumerable: false, configurable: true,
  });

  return styleObj;
}

// ── element.classList (DOMTokenList) ────────────────────────────────────────
// classList was entirely unimplemented — `el.classList` was `undefined` for
// every element, so any script touching it (an extremely common DOM pattern)
// crashed. Backed by the same `class` attribute as className, read fresh on
// every call so `add`/`remove`/`toggle` calls made through one captured
// reference are immediately visible to the next.

function classTokens(el: DomElement): string[] {
  return (getAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
}

function setClassTokens(el: DomElement, domTree: IDomTree, tokens: string[]): void {
  domTree.setAttribute(el, 'class', tokens.join(' '));
}

function buildClassList(el: DomElement, domTree: IDomTree): JSObject {
  const listObj = createObject(null);
  listObj.properties.set('length', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('length', () => classTokens(el).length),
  });
  listObj.properties.set('value', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('value', () => classTokens(el).join(' ')),
    setter: createNativeFunction('value', (_t, args) => setClassTokens(el, domTree, toString(args[0]).split(/\s+/).filter(Boolean))),
  });
  listObj.properties.set('add', {
    value: createNativeFunction('add', (_t, args) => {
      const tokens = classTokens(el);
      for (const a of args) { const t = toString(a); if (!tokens.includes(t)) tokens.push(t); }
      setClassTokens(el, domTree, tokens);
    }),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('remove', {
    value: createNativeFunction('remove', (_t, args) => {
      const toRemove = new Set(args.map(toString));
      setClassTokens(el, domTree, classTokens(el).filter(t => !toRemove.has(t)));
    }),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('contains', {
    value: createNativeFunction('contains', (_t, args) => classTokens(el).includes(toString(args[0]))),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('toggle', {
    value: createNativeFunction('toggle', (_t, args) => {
      const token = toString(args[0]);
      const tokens = classTokens(el);
      const has = tokens.includes(token);
      const force = args.length > 1 ? toBoolean(args[1]) : undefined;
      const shouldHave = force === undefined ? !has : force;
      if (shouldHave !== has) {
        setClassTokens(el, domTree, shouldHave ? [...tokens, token] : tokens.filter(t => t !== token));
      }
      return shouldHave;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('replace', {
    value: createNativeFunction('replace', (_t, args) => {
      const oldToken = toString(args[0]);
      const newToken = toString(args[1]);
      const tokens = classTokens(el);
      const idx = tokens.indexOf(oldToken);
      if (idx === -1) return false;
      tokens[idx] = newToken;
      setClassTokens(el, domTree, [...new Set(tokens)]);
      return true;
    }),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('item', {
    value: createNativeFunction('item', (_t, args) => classTokens(el)[toNumber(args[0])] ?? null),
    writable: true, enumerable: false, configurable: true,
  });
  listObj.properties.set('toString', {
    value: createNativeFunction('toString', () => classTokens(el).join(' ')),
    writable: true, enumerable: false, configurable: true,
  });
  return listObj;
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

  // createDocumentFragment — a detached container node for batch DOM
  // building (real code, e.g. jQuery's own feature-detection scratch code,
  // does createDocumentFragment().appendChild(...)/.cloneNode()/etc.).
  // ponytail: modeled as a plain detached element (tagName
  // "#document-fragment") reusing the existing element machinery, which
  // covers appendChild/removeChild/cloneNode/children/querySelector for
  // free — not a spec-accurate DocumentFragment (real nodeType 11, and
  // appending IT into a live element should move its children in rather
  // than insert the fragment itself). Upgrade if real code depends on
  // either of those specifically.
  docObj.properties.set('createDocumentFragment', {
    value: createNativeFunction('createDocumentFragment', () => {
      const el = makeElement('#document-fragment', null);
      return wrapElement(el, domTree);
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

  // currentScript — the <script> element whose own source is synchronously
  // executing right now, or null outside of that window. Real self-
  // configuring embed scripts (analytics tags, widgets) read this to find
  // their own data-* attributes. Defaults to null here; the page-load
  // orchestrator (page-renderer.ts) sets/resets this property directly
  // around each script's runJS() call, since it's the only place that knows
  // which <script> element is currently executing.
  docObj.properties.set('currentScript', {
    value: null,
    writable: true, enumerable: true, configurable: true,
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

      eventFlags(evt).__stopPropagation = false;
      eventFlags(evt).__stopImmediate = false;
      eventFlags(evt).__defaultPrevented = false;

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

/** Walks up .parent to see whether `node` is actually reachable from the real document root. */
function isNodeConnected(node: DomNode, domTree: IDomTree): boolean {
  let cur: DomNode | null = node;
  while (cur && cur.nodeType !== 'document') cur = cur.parent;
  return cur !== null && cur === domTree.getDocument();
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

  // name / type (reflected IDL attributes — always mirror the content
  // attribute, unlike value/checked which diverge from theirs after the
  // user or script touches them). Missing entirely before: `input.name =
  // 'x'` was just an ad-hoc JS property invisible to anything inspecting
  // the real element (getAttribute, form-walking code, FormData, ...).
  obj.properties.set('name', {
    value: getAttr(el, 'name') ?? '',
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get name', () => getAttr(el, 'name') ?? ''),
    setter: createNativeFunction('set name', (_t, args) => domTree.setAttribute(el, 'name', toString(args[0]))),
  });
  obj.properties.set('type', {
    value: getAttr(el, 'type') ?? '',
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get type', () => getAttr(el, 'type') ?? (el.tagName === 'input' ? 'text' : '')),
    setter: createNativeFunction('set type', (_t, args) => domTree.setAttribute(el, 'type', toString(args[0]))),
  });

  // classList (live DOMTokenList backed by the same class attribute)
  obj.properties.set('classList', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get classList', () => buildClassList(el, domTree)),
  });

  // dataset (DOMStringMap over data-* attributes, rebuilt fresh on each read
  // so it reflects whatever data-* attributes exist at access time)
  obj.properties.set('dataset', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get dataset', () => {
      const ds = createObject(null);
      for (const attrName of el.attributes.keys()) {
        if (!attrName.startsWith('data-')) continue;
        const camel = attrName.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        ds.properties.set(camel, {
          value: undefined, writable: false, enumerable: true, configurable: true,
          getter: createNativeFunction(camel, () => el.attributes.get(attrName) ?? ''),
          setter: createNativeFunction(camel, (_t2, a2) => { domTree.setAttribute(el, attrName, toString(a2[0])); }),
        });
      }
      return ds;
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

  // children/childNodes/parentNode/firstChild/lastChild — these were plain
  // snapshots taken once at wrap-time, so any DOM mutation after the first
  // wrap (appendChild, innerHTML, insertBefore, ...) never showed up here
  // for any already-held reference to this element. Live getters instead.
  const wrapChild = (c: DomNode): JSValue => c.nodeType === 'element' ? wrapElement(c as DomElement, domTree) : wrapTextNode(c);
  obj.properties.set('children', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get children', () => createArray(
      el.children.filter((c): c is DomElement => c.nodeType === 'element').map(c => wrapElement(c, domTree))
    )),
  });
  obj.properties.set('childNodes', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get childNodes', () => createArray(el.children.map(wrapChild))),
  });
  obj.properties.set('parentNode', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get parentNode', () =>
      el.parent && el.parent.nodeType === 'element' ? wrapElement(el.parent as DomElement, domTree) : null),
  });
  obj.properties.set('firstChild', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get firstChild', () => el.children.length > 0 ? wrapChild(el.children[0]) : null),
  });
  obj.properties.set('lastChild', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get lastChild', () => el.children.length > 0 ? wrapChild(el.children[el.children.length - 1]) : null),
  });
  obj.properties.set('nextSibling', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get nextSibling', () => {
      const siblings = el.parent?.children ?? [];
      const idx = siblings.indexOf(el);
      return idx !== -1 && idx + 1 < siblings.length ? wrapChild(siblings[idx + 1]) : null;
    }),
  });
  obj.properties.set('previousSibling', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get previousSibling', () => {
      const siblings = el.parent?.children ?? [];
      const idx = siblings.indexOf(el);
      return idx > 0 ? wrapChild(siblings[idx - 1]) : null;
    }),
  });

  // innerHTML (live: the setter was a plain-value snapshot — assigning it
  // only overwrote this JS property and never touched the real DOM tree, so
  // nothing rendered and no query/traversal method ever saw the new content)
  obj.properties.set('innerHTML', {
    value: undefined, writable: false, enumerable: true, configurable: true,
    getter: createNativeFunction('get innerHTML', () => getInnerHTML(el)),
    setter: createNativeFunction('set innerHTML', (_t, args) => {
      for (const child of [...el.children]) domTree.removeChild(el, child);
      for (const node of domTree.parseFragment(toString(args[0]))) domTree.appendChild(el, node);
    }),
  });

  // style — a live view onto the element's real inline style (see
  // buildStyleObject's comment for why this can't be a plain snapshot).
  obj.properties.set('style', { value: buildStyleObject(el, domTree), writable: true, enumerable: true, configurable: true });

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

      const oldValue = el.attributes.get(name) ?? null;
      domTree.setAttribute(el, name, value);
      notifyAttributeChanged(obj, el.tagName, name, oldValue, value);
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
        if (isNodeConnected(el, domTree)) notifyConnectedTree(child);
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
        const wasConnected = isNodeConnected(el, domTree);
        domTree.removeChild(el, domNode);
        if (wasConnected) notifyDisconnectedTree(child);
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
        if (isNodeConnected(el, domTree)) notifyConnectedTree(newChild);
      }
      return args[0];
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // remove/append/prepend/before/after — modern child/sibling mutation
  // sugar over appendChild/insertBefore/removeChild; a JSValue arg that
  // isn't a wrapped DOM node is converted to a text node, per spec.
  const toInsertableNode = (val: JSValue): DomNode =>
    (typeof val === 'object' && val !== null && '__domNode' in val)
      ? (val as JSObject & { __domNode: DomNode }).__domNode
      : makeTextNode(toString(val), null);

  obj.properties.set('remove', {
    value: createNativeFunction('remove', () => {
      if (el.parent && el.parent.nodeType === 'element') {
        const wasConnected = isNodeConnected(el, domTree);
        domTree.removeChild(el.parent as DomElement, el);
        if (wasConnected) notifyDisconnectedTree(obj);
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('append', {
    value: createNativeFunction('append', (_t, args) => {
      for (const a of args) {
        const node = toInsertableNode(a);
        domTree.appendChild(el, node);
        if (isNodeConnected(el, domTree) && node.nodeType === 'element') notifyConnectedTree(wrapElement(node as DomElement, domTree));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('prepend', {
    value: createNativeFunction('prepend', (_t, args) => {
      const ref = el.children[0] ?? null;
      for (const a of args) {
        const node = toInsertableNode(a);
        domTree.insertBefore(el, node, ref);
        if (isNodeConnected(el, domTree) && node.nodeType === 'element') notifyConnectedTree(wrapElement(node as DomElement, domTree));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('before', {
    value: createNativeFunction('before', (_t, args) => {
      if (!el.parent || el.parent.nodeType !== 'element') return undefined;
      const parent = el.parent as DomElement;
      for (const a of args) {
        const node = toInsertableNode(a);
        domTree.insertBefore(parent, node, el);
        if (isNodeConnected(parent, domTree) && node.nodeType === 'element') notifyConnectedTree(wrapElement(node as DomElement, domTree));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('after', {
    value: createNativeFunction('after', (_t, args) => {
      if (!el.parent || el.parent.nodeType !== 'element') return undefined;
      const parent = el.parent as DomElement;
      const idx = parent.children.indexOf(el);
      const ref = idx !== -1 && idx + 1 < parent.children.length ? parent.children[idx + 1] : null;
      for (const a of args) {
        const node = toInsertableNode(a);
        domTree.insertBefore(parent, node, ref);
        if (isNodeConnected(parent, domTree) && node.nodeType === 'element') notifyConnectedTree(wrapElement(node as DomElement, domTree));
      }
      return undefined;
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
          ? toBoolean((opts as JSObject).properties?.get('capture')?.value ?? false)
          : false;
      const once = (opts && typeof opts === 'object' && typeof opts === 'object' && 'properties' in opts)
        ? toBoolean((opts as JSObject).properties?.get('once')?.value ?? false)
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
      eventFlags(evt).__stopPropagation = false;
      eventFlags(evt).__stopImmediate = false;
      eventFlags(evt).__defaultPrevented = false;

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

      // ── CAPTURE PHASE: root → parent-of-target ──
      evt.properties.set('eventPhase', { value: 1, writable: true, enumerable: true, configurable: false });
      for (let i = ancestors.length - 1; i >= 0; i--) {
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
      }

      // Cleanup
      evt.properties.set('currentTarget', { value: null, writable: true, enumerable: true, configurable: false });
      evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
      cleanupDomOnceListeners(el);
      for (const ancestor of ancestors) cleanupDomOnceListeners(ancestor);

      return !eventFlags(evt).__defaultPrevented;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // matches (checks the element itself, not its descendants)
  obj.properties.set('matches', {
    value: createNativeFunction('matches', (_this, args) => domTree.matches(el, toString(args[0]))),
    writable: true, enumerable: true, configurable: true,
  });

  // closest (walks up from the element itself through ancestors)
  obj.properties.set('closest', {
    value: createNativeFunction('closest', (_this, args) => {
      const sel = toString(args[0]);
      let cur: DomElement | null = el;
      while (cur) {
        if (domTree.matches(cur, sel)) return wrapElement(cur, domTree);
        cur = cur.parent && cur.parent.nodeType === 'element' ? cur.parent as DomElement : null;
      }
      return null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // querySelector/querySelectorAll (scoped to this element's descendants)
  obj.properties.set('querySelector', {
    value: createNativeFunction('querySelector', (_this, args) => {
      const found = domTree.querySelector(toString(args[0]), el);
      return found ? wrapElement(found, domTree) : null;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('querySelectorAll', {
    value: createNativeFunction('querySelectorAll', (_this, args) => createArray(domTree.querySelectorAll(toString(args[0]), el).map(e => wrapElement(e, domTree)))),
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

  // getElementsByTagName (scoped to this element's descendants) — was
  // missing entirely (only document.getElementsByTagName existed), so any
  // real code calling it on a plain element — like jQuery's own detached-
  // div feature-detection scratch node, `div.getElementsByTagName("a")` —
  // silently called nothing and got `undefined` back.
  obj.properties.set('getElementsByTagName', {
    value: createNativeFunction('getElementsByTagName', (_this, args) => {
      const tag = toString(args[0]).toLowerCase();
      const result: DomElement[] = [];
      const queue: DomNode[] = [...el.children];
      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node.nodeType === 'element' && (tag === '*' || (node as DomElement).tagName === tag)) {
          result.push(node as DomElement);
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

  // ── Web Animations API: getAnimations() ──
  obj.properties.set('getAnimations', {
    value: createNativeFunction('getAnimations', () => {
      const anims = elementAnimations.get(el.domId) ?? [];
      return createArray(anims.filter(a => a.playState !== 'idle' && a.playState !== 'finished').map(a => wrapAnimation(a)));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  offerElementForUpgrade(obj, el.tagName);
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
