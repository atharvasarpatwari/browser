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

  // addEventListener (document-level — store in closure for dispatchEvent)
  const docListeners = new Map<string, Array<{ fn: JSFunction; thisArg: JSValue }>>();
  docObj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const event = toString(args[0]);
      const fn = args[1] as JSFunction;
      if (!docListeners.has(event)) docListeners.set(event, []);
      docListeners.get(event)!.push({ fn, thisArg: _this });
      return undefined;
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

function wrapElement(el: DomElement, domTree: IDomTree): JSObject {
  const cached = elementCache.get(el);
  if (cached) return cached;

  const obj = createObject(null);

  // Store DOM reference on the JSObject
  (obj as JSObject & { __domNode: DomElement }).__domNode = el;

  // tagName (uppercase)
  obj.properties.set('tagName', {
    value: el.tagName.toUpperCase(),
    writable: false, enumerable: true, configurable: false,
  });

  // id (read from attributes)
  obj.properties.set('id', {
    value: getAttr(el, 'id') ?? '',
    writable: true, enumerable: true, configurable: true,
  });

  // className (read from class attribute)
  obj.properties.set('className', {
    value: getAttr(el, 'class') ?? '',
    writable: true, enumerable: true, configurable: true,
  });

  // textContent
  obj.properties.set('textContent', {
    value: getTextContent(el),
    writable: true, enumerable: true, configurable: true,
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

  // addEventListener
  const listeners = new Map<string, Array<{ fn: JSFunction; thisArg: JSValue }>>();
  obj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const event = toString(args[0]);
      const fn = args[1] as JSFunction;
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push({ fn, thisArg: _this });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // removeEventListener
  obj.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const event = toString(args[0]);
      const fn = args[1] as JSFunction;
      const arr = listeners.get(event);
      if (arr) {
        const idx = arr.findIndex(l => l.fn === fn);
        if (idx !== -1) arr.splice(idx, 1);
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // dispatchEvent
  obj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_this, args) => {
      const evt = args[0] as JSObject;
      const eventType = typeof evt === 'object' && evt !== null
        ? toString(evt.properties.get('type')?.value)
        : 'unknown';
      const arr = listeners.get(eventType);
      if (arr) {
        for (const l of arr) {
          try {
            callJSFunction(l.fn, l.thisArg, [evt]);
          } catch {
            // swallow event handler errors
          }
        }
      }
      return true;
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

  elementCache.set(el, obj);
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

export function createEventObject(type: string, target: JSValue): JSObject {
  const evt = createObject(null);
  evt.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  evt.properties.set('target', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('currentTarget', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('preventDefault', {
    value: createNativeFunction('preventDefault', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopPropagation', {
    value: createNativeFunction('stopPropagation', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  return evt;
}
