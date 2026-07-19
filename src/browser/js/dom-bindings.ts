import type { DomDocument, DomElement, DomNode, DomTextNode, IDomTree } from '../rendering/dom-tree';
import {
  type JSValue, type JSObject, type JSFunction,
  createObject, createArray, createNativeFunction,
  toNumber, toString, toBoolean,
  Environment,
  callJSFunction,
} from './values';

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

  // setAttribute
  obj.properties.set('setAttribute', {
    value: createNativeFunction('setAttribute', (_this, args) => {
      const name = toString(args[0]);
      const value = toString(args[1]);
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
      const ancestors: DomNode[] = [];
      let cur: DomNode | null = el.parent;
      while (cur) {
        if (cur.nodeType === 'element') ancestors.push(cur);
        cur = cur.parent;
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

export function createEventObject(type: string, target: JSValue, options?: { bubbles?: boolean; cancelable?: boolean }): JSObject {
  const evt = createObject(null);
  evt.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  evt.properties.set('target', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('currentTarget', { value: target, writable: true, enumerable: true, configurable: false });
  evt.properties.set('eventPhase', { value: 0, writable: true, enumerable: true, configurable: false });
  evt.properties.set('bubbles', { value: options?.bubbles ?? false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('cancelable', { value: options?.cancelable ?? false, writable: false, enumerable: true, configurable: false });
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
