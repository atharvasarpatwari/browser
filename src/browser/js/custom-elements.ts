// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ELEMENTS — window.customElements, the extendable HTMLElement class,
// and element upgrade (construction + connected/disconnected/attribute
// lifecycle callbacks).
// ─────────────────────────────────────────────────────────────────────────────
//
// Nova's DOM wrapper (wrapElement in dom-bindings.ts) gives every element its
// own flat set of own properties rather than a shared HTMLElement.prototype
// chain — so "upgrading" an element to a custom class means: swap its
// .prototype to the class's prototype (so the class's own methods/getters
// resolve normally), then run the class's constructor with `this` bound to
// the already-existing wrapped object, via callJSFunction — which already
// knows how to run either a native or a real closure/class-method body
// (including any super() call inside it, resolved through the constructor's
// own closure exactly as it is for any other class in this engine).

import type { JSValue, JSObject, JSFunction } from './values';
import { createObject, createArray, createNativeFunction, toString, callJSFunction, Environment } from './values';
import type { EventLoop } from './event-loop';
import { createWiredPromise, fulfillPromise } from './promise';

interface CustomElementDefinition {
  name: string;
  ctor: JSObject; // a `type: 'class'` object
  observedAttributes: Set<string>;
}

const registry = new Map<string, CustomElementDefinition>();
/** Elements wrapped before their tag was defined, so define() can upgrade them retroactively. */
const pendingByTag = new Map<string, Set<JSObject>>();
/** Guards against re-running a constructor if an element is somehow offered for upgrade twice. */
const upgradedElements = new WeakSet<JSObject>();
const whenDefinedWaiters = new Map<string, Array<() => void>>();

function isArrayObject(v: JSValue): v is JSObject {
  return typeof v === 'object' && v !== null && (v as JSObject).type === 'array';
}

function jsArrayToStrings(v: JSValue): string[] {
  if (!isArrayObject(v)) return [];
  const len = Number(v.properties.get('length')?.value ?? 0);
  const out: string[] = [];
  for (let i = 0; i < len; i++) out.push(toString(v.properties.get(String(i))?.value as JSValue));
  return out;
}

function readObservedAttributes(ctor: JSObject): Set<string> {
  const desc = ctor.properties.get('observedAttributes');
  if (!desc) return new Set();
  const raw = desc.getter ? callJSFunction(desc.getter as JSFunction, ctor, []) : desc.value;
  return new Set(jsArrayToStrings(raw as JSValue));
}

/** Look up a method through the prototype chain (own properties take precedence, matching normal JS lookup). */
function findMethod(obj: JSObject, name: string): JSFunction | undefined {
  let cur: JSObject | null = obj;
  while (cur) {
    const desc = cur.properties.get(name);
    if (desc) {
      const v = desc.getter ? callJSFunction(desc.getter as JSFunction, obj, []) : desc.value;
      return (v && typeof v === 'object' && (v as JSFunction).type === 'closure') ? v as JSFunction : undefined;
    }
    cur = cur.prototype;
  }
  return undefined;
}

function upgradeElement(obj: JSObject, def: CustomElementDefinition): void {
  if (upgradedElements.has(obj)) return;
  upgradedElements.add(obj);
  if (def.ctor.prototype) obj.prototype = def.ctor.prototype;
  const ctorFn = def.ctor.properties.get('constructor')?.value;
  if (ctorFn && typeof ctorFn === 'object' && (ctorFn as JSFunction).type === 'closure') {
    callJSFunction(ctorFn as JSFunction, obj, []);
  }
}

/** Walk an element and its descendants (as wrapped JS objects), depth-first. */
function walkElementTree(root: JSValue, visit: (obj: JSObject) => void): void {
  if (typeof root !== 'object' || root === null) return;
  const obj = root as JSObject;
  visit(obj);
  const children = obj.properties.get('children')?.value;
  if (isArrayObject(children)) {
    const len = Number(children.properties.get('length')?.value ?? 0);
    for (let i = 0; i < len; i++) walkElementTree(children.properties.get(String(i))?.value as JSValue, visit);
  }
}

function upgradeSubtree(root: JSValue): void {
  walkElementTree(root, (obj) => {
    const tag = obj.properties.get('tagName')?.value;
    if (typeof tag === 'string') {
      const def = registry.get(tag.toLowerCase());
      if (def) upgradeElement(obj, def);
    }
  });
}

/** Fire connectedCallback across an entire (now-connected) subtree, including the root. */
export function notifyConnectedTree(root: JSValue): void {
  walkElementTree(root, notifyConnected);
}

/** Fire disconnectedCallback across an entire (now-removed) subtree, including the root. */
export function notifyDisconnectedTree(root: JSValue): void {
  walkElementTree(root, notifyDisconnected);
}

function defineElement(name: string, ctorObj: JSObject): void {
  const def: CustomElementDefinition = { name, ctor: ctorObj, observedAttributes: readObservedAttributes(ctorObj) };
  registry.set(name, def);

  const pending = pendingByTag.get(name);
  if (pending) {
    for (const obj of pending) upgradeElement(obj, def);
    pendingByTag.delete(name);
  }

  const waiters = whenDefinedWaiters.get(name);
  if (waiters) {
    whenDefinedWaiters.delete(name);
    for (const resolve of waiters) resolve();
  }
}

/**
 * Called from wrapElement() right before it returns a freshly-wrapped
 * element — the single choke point every element passes through regardless
 * of whether it came from the parser, createElement(), or cloneNode().
 */
export function offerElementForUpgrade(obj: JSObject, tagName: string): void {
  const name = tagName.toLowerCase();
  const def = registry.get(name);
  if (def) {
    upgradeElement(obj, def);
    return;
  }
  // Only track hyphenated (i.e. legally-a-custom-element) names as pending —
  // no point holding a reference to every <div> ever wrapped.
  if (!name.includes('-')) return;
  if (!pendingByTag.has(name)) pendingByTag.set(name, new Set());
  pendingByTag.get(name)!.add(obj);
}

/** Called from appendChild/insertBefore in dom-bindings.ts once a node is actually connected. */
export function notifyConnected(obj: JSObject): void {
  const fn = findMethod(obj, 'connectedCallback');
  if (fn) callJSFunction(fn, obj, []);
}

/** Called from removeChild in dom-bindings.ts. */
export function notifyDisconnected(obj: JSObject): void {
  const fn = findMethod(obj, 'disconnectedCallback');
  if (fn) callJSFunction(fn, obj, []);
}

/** Called from setAttribute in dom-bindings.ts — only fires for attributes the element actually observes. */
export function notifyAttributeChanged(
  obj: JSObject, tagName: string, attrName: string, oldValue: string | null, newValue: string | null,
): void {
  const def = registry.get(tagName.toLowerCase());
  if (!def || !def.observedAttributes.has(attrName)) return;
  const fn = findMethod(obj, 'attributeChangedCallback');
  if (fn) callJSFunction(fn, obj, [attrName, oldValue, newValue]);
}

export function createCustomElementRegistry(eventLoop: EventLoop): JSObject {
  const obj = createObject(null);

  obj.properties.set('define', {
    value: createNativeFunction('define', (_this, args) => {
      const name = toString(args[0]).toLowerCase();
      const ctor = args[1];
      if (!name.includes('-')) {
        throw new TypeError(`Failed to execute 'define' on 'CustomElementRegistry': "${name}" is not a valid custom element name (must contain a hyphen)`);
      }
      if (registry.has(name)) {
        throw new TypeError(`Failed to execute 'define' on 'CustomElementRegistry': the name "${name}" has already been used with this registry`);
      }
      if (typeof ctor !== 'object' || ctor === null) {
        throw new TypeError(`Failed to execute 'define' on 'CustomElementRegistry': parameter 2 is not a constructor`);
      }
      defineElement(name, ctor as JSObject);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      return registry.get(toString(args[0]).toLowerCase())?.ctor;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('whenDefined', {
    value: createNativeFunction('whenDefined', (_this, args) => {
      const name = toString(args[0]).toLowerCase();
      const p = createWiredPromise(eventLoop);
      if (registry.has(name)) {
        fulfillPromise(p, undefined);
      } else {
        if (!whenDefinedWaiters.has(name)) whenDefinedWaiters.set(name, []);
        whenDefinedWaiters.get(name)!.push(() => fulfillPromise(p, undefined));
      }
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('upgrade', {
    value: createNativeFunction('upgrade', (_this, args) => {
      upgradeSubtree(args[0]);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

/** window.HTMLElement — the only real base every custom element class can `extends`. */
export function createHTMLElementClass(): JSObject {
  const proto = createObject(null);
  const ctorFn: JSFunction = {
    type: 'closure', properties: new Map(), name: 'HTMLElement', params: [], isNative: false,
    body: { type: 'BlockStatement', body: [] },
    closure: new Environment(), async: false, generator: false, isArrow: false,
  };
  proto.properties.set('constructor', { value: ctorFn, writable: true, enumerable: false, configurable: true });

  const classObj: JSObject = { type: 'class', properties: new Map(), prototype: proto, callable: true };
  classObj.properties.set('constructor', { value: ctorFn, writable: true, enumerable: true, configurable: true });
  return classObj;
}
