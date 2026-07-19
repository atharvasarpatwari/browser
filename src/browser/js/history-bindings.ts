import type { INavigationController } from '../navigation/navigation-controller';
import type { NavigationEntry } from '../navigation/navigation-controller';
import {
  type JSValue, type JSObject, type JSFunction,
  createObject, createNativeFunction, toNumber, toString, toBoolean,
  callJSFunction,
} from './values';

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY API & LOCATION BINDINGS
//
// Bridges NavigationController into JS as window.history and window.location.
// Fires popstate / hashchange events on window when the controller changes the
// active history entry.
// ─────────────────────────────────────────────────────────────────────────────

// ── Shared window listener map ──────────────────────────────────────────────

interface WindowListenerEntry {
  type: string;
  fn: JSFunction;
  once: boolean;
}

const windowListenerMap = new WeakMap<JSObject, WindowListenerEntry[]>();

function getWindowListeners(winObj: JSObject): WindowListenerEntry[] {
  let list = windowListenerMap.get(winObj);
  if (!list) {
    list = [];
    windowListenerMap.set(winObj, list);
  }
  return list;
}

function dispatchWindowEvent(winObj: JSObject, event: JSObject): void {
  const entries = getWindowListeners(winObj);
  const type = (event.properties.get('type')?.value ?? '') as string;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== type) continue;
    if ((event as any).__stopImmediate) break;
    try {
      callJSFunction(entry.fn, winObj, [event]);
    } catch { /* swallow */ }
    if (entry.once) entries.splice(i, 1);
    if ((event as any).__stopPropagation) break;
  }
}

// ── Event factories ─────────────────────────────────────────────────────────

function createPopStateEvent(state: JSValue): JSObject {
  const evt = createObject(null);
  evt.properties.set('type',    { value: 'popstate', writable: false, enumerable: true, configurable: false });
  evt.properties.set('bubbles', { value: true, writable: false, enumerable: true, configurable: false });
  evt.properties.set('cancelable', { value: false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('state',   { value: state, writable: false, enumerable: true, configurable: false });
  evt.properties.set('stopPropagation', {
    value: createNativeFunction('stopPropagation', () => { (evt as any).__stopPropagation = true; return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopImmediatePropagation', {
    value: createNativeFunction('stopImmediatePropagation', () => {
      (evt as any).__stopPropagation = true;
      (evt as any).__stopImmediate = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return evt;
}

function createHashChangeEvent(oldURL: string, newURL: string): JSObject {
  const evt = createObject(null);
  evt.properties.set('type',    { value: 'hashchange', writable: false, enumerable: true, configurable: false });
  evt.properties.set('bubbles', { value: true, writable: false, enumerable: true, configurable: false });
  evt.properties.set('cancelable', { value: false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('oldURL',  { value: oldURL, writable: false, enumerable: true, configurable: false });
  evt.properties.set('newURL',  { value: newURL, writable: false, enumerable: true, configurable: false });
  evt.properties.set('stopPropagation', {
    value: createNativeFunction('stopPropagation', () => { (evt as any).__stopPropagation = true; return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  evt.properties.set('stopImmediatePropagation', {
    value: createNativeFunction('stopImmediatePropagation', () => {
      (evt as any).__stopPropagation = true;
      (evt as any).__stopImmediate = true;
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return evt;
}

// ── State serializer ─────────────────────────────────────────────────────────

/**
 * Recursively convert a JSValue into a plain JS value suitable for structured clone.
 * Converts JSObjects to plain objects by reading their properties Map.
 */
function jsValueToPlain(val: JSValue): unknown {
  if (val === undefined || val === null || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') {
    return val;
  }
  if (typeof val === 'object' && 'properties' in val) {
    const obj = val as JSObject;
    if (obj.type === 'array') {
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const arr: unknown[] = [];
      for (let i = 0; i < len; i++) {
        const elem = obj.properties.get(String(i))?.value;
        arr.push(jsValueToPlain(elem));
      }
      return arr;
    }
    const plain: Record<string, unknown> = {};
    for (const [k, desc] of obj.properties) {
      if (k === 'prototype' || k === '__domNode') continue;
      plain[k] = jsValueToPlain(desc.value);
    }
    return plain;
  }
  return val;
}

/**
 * Serialize an arbitrary state value into a JSON-safe JSValue.
 * Per WHATWG spec, history.state uses structured clone — for now we do JSON.
 */
function serializeState(state: JSValue): JSValue {
  if (state === undefined || state === null) return null;
  if (typeof state === 'string' || typeof state === 'number' || typeof state === 'boolean') return state;
  const plain = jsValueToPlain(state);
  try {
    return JSON.parse(JSON.stringify(plain)) as JSValue;
  } catch {
    return null;
  }
}

// ── HISTORY BINDING ──────────────────────────────────────────────────────────

/**
 * Create window.history — the History API binding.
 *
 * @param controller The NavigationController that owns this tab's history.
 * @param winObj     The window JSObject (used for event dispatch).
 */
export function createHistoryBinding(
  controller: INavigationController,
  winObj: JSObject,
): JSObject {
  const historyObj = createObject(null);

  // ── history.state (getter) ────────────────────────────────────────────────

  historyObj.properties.set('state', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get state', () => {
      const entry = controller.getCurrentEntry();
      return entry !== null ? serializeState(entry.state) : null;
    }),
  });

  // ── history.length (getter) ──────────────────────────────────────────────

  historyObj.properties.set('length', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get length', () => {
      return controller.historyLength;
    }),
  });

  // ── history.back() ────────────────────────────────────────────────────────

  historyObj.properties.set('back', {
    value: createNativeFunction('back', () => {
      const result = controller.back();
      if (result.success && result.entry) {
        dispatchWindowEvent(winObj, createPopStateEvent(serializeState(result.entry.state)));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── history.forward() ─────────────────────────────────────────────────────

  historyObj.properties.set('forward', {
    value: createNativeFunction('forward', () => {
      const result = controller.forward();
      if (result.success && result.entry) {
        dispatchWindowEvent(winObj, createPopStateEvent(serializeState(result.entry.state)));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── history.go(delta) ─────────────────────────────────────────────────────

  historyObj.properties.set('go', {
    value: createNativeFunction('go', (_this, args) => {
      const delta = args.length > 0 ? Math.trunc(toNumber(args[0])) : 0;
      const result = controller.go(delta);
      if (result.success && result.entry) {
        dispatchWindowEvent(winObj, createPopStateEvent(serializeState(result.entry.state)));
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── history.pushState(state, title, url) ──────────────────────────────────

  historyObj.properties.set('pushState', {
    value: createNativeFunction('pushState', (_this, args) => {
      const state = serializeState(args[0]);
      const title = args.length > 1 ? toString(args[1]) : '';
      const url   = args.length > 2 ? toString(args[2]) : undefined;
      controller.pushState(state, title, url);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── history.replaceState(state, title, url) ───────────────────────────────

  historyObj.properties.set('replaceState', {
    value: createNativeFunction('replaceState', (_this, args) => {
      const state = serializeState(args[0]);
      const title = args.length > 1 ? toString(args[1]) : '';
      const url   = args.length > 2 ? toString(args[2]) : undefined;
      controller.replaceState(state, title, url);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return historyObj;
}

// ── LOCATION BINDING ─────────────────────────────────────────────────────────

/**
 * Create window.location — the Location API binding.
 *
 * @param controller The NavigationController that owns this tab's history.
 * @param winObj     The window JSObject (used for hashchange event dispatch).
 */
export function createLocationBinding(
  controller: INavigationController,
  _winObj: JSObject,
): JSObject {
  const locationObj = createObject(null);

  const getParsedUrl = () => {
    const entry = controller.getCurrentEntry();
    return entry?.parsedUrl ?? null;
  };

  // ── href (getter + setter) ────────────────────────────────────────────────

  locationObj.properties.set('href', {
    value: undefined,
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get href', () => {
      return getParsedUrl()?.href ?? '';
    }),
    setter: createNativeFunction('set href', (_this, args) => {
      const url = toString(args[0]);
      controller.navigate(url);
      return undefined;
    }),
  });

  // ── origin (getter) ──────────────────────────────────────────────────────

  locationObj.properties.set('origin', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get origin', () => {
      return getParsedUrl()?.origin ?? '';
    }),
  });

  // ── protocol (getter) ────────────────────────────────────────────────────

  locationObj.properties.set('protocol', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get protocol', () => {
      return getParsedUrl()?.protocol ?? '';
    }),
  });

  // ── host (getter) ────────────────────────────────────────────────────────

  locationObj.properties.set('host', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get host', () => {
      return getParsedUrl()?.host ?? '';
    }),
  });

  // ── hostname (getter) ────────────────────────────────────────────────────

  locationObj.properties.set('hostname', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get hostname', () => {
      return getParsedUrl()?.hostname ?? '';
    }),
  });

  // ── port (getter) ────────────────────────────────────────────────────────

  locationObj.properties.set('port', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get port', () => {
      return getParsedUrl()?.port ?? '';
    }),
  });

  // ── pathname (getter) ────────────────────────────────────────────────────

  locationObj.properties.set('pathname', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get pathname', () => {
      return getParsedUrl()?.pathname ?? '/';
    }),
  });

  // ── search (getter) ──────────────────────────────────────────────────────

  locationObj.properties.set('search', {
    value: undefined,
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get search', () => {
      return getParsedUrl()?.search ?? '';
    }),
  });

  // ── hash (getter + setter) ────────────────────────────────────────────────

  locationObj.properties.set('hash', {
    value: undefined,
    writable: true, enumerable: true, configurable: true,
    getter: createNativeFunction('get hash', () => {
      return getParsedUrl()?.hash ?? '';
    }),
    setter: createNativeFunction('set hash', (_this, args) => {
      const newHash = toString(args[0]);
      const currentEntry = controller.getCurrentEntry();
      if (currentEntry === null) return undefined;
      const parsedUrl = currentEntry.parsedUrl;
      const base = parsedUrl.origin + parsedUrl.pathname + parsedUrl.search;
      const toURL = base + newHash;
      controller.navigate(toURL);
      return undefined;
    }),
  });

  // ── assign(url) ──────────────────────────────────────────────────────────

  locationObj.properties.set('assign', {
    value: createNativeFunction('assign', (_this, args) => {
      const url = toString(args[0]);
      controller.navigate(url);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── replace(url) ─────────────────────────────────────────────────────────

  locationObj.properties.set('replace', {
    value: createNativeFunction('replace', (_this, args) => {
      const url = toString(args[0]);
      controller.replace(url);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── reload() ─────────────────────────────────────────────────────────────

  locationObj.properties.set('reload', {
    value: createNativeFunction('reload', () => {
      controller.reload();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── toString() ───────────────────────────────────────────────────────────

  locationObj.properties.set('toString', {
    value: createNativeFunction('toString', () => {
      return getParsedUrl()?.href ?? '';
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return locationObj;
}

// ── WINDOW EVENT WIRING ──────────────────────────────────────────────────────

/**
 * Wire NavigationController events into window-level popstate / hashchange
 * and return a fully-populated window JSObject.
 *
 * @param controller The NavigationController for this tab.
 * @param winObj     The window JSObject (created by the caller).
 */
export function wireHistoryEvents(
  controller: INavigationController,
  winObj: JSObject,
): void {
  // ── popstate: fired on back() / forward() / go() ───────────────────────────
  //
  // pushState / replaceState do NOT fire popstate per WHATWG spec.
  // back/forward/go are synchronous and already call bus.emit('navigationCommitted')
  // before returning. We subscribe to the bus and dispatch when the entry changes.

  let lastEntryId: string | null = null;

  controller.on('navigationCommitted', (event) => {
    if (event.kind !== 'navigationCommitted') return;
    const entry = event.entry as NavigationEntry;
    if (lastEntryId === null) {
      lastEntryId = entry.id;
      return;
    }
    lastEntryId = entry.id;
    dispatchWindowEvent(winObj, createPopStateEvent(serializeState(entry.state)));
  });

  // ── hashchange: fired when a same-page hash jump occurs ────────────────────

  controller.on('hashChanged', (event) => {
    if (event.kind !== 'hashChanged') return;
    dispatchWindowEvent(winObj, createHashChangeEvent(
      (event as any).fromUrl,
      (event as any).toUrl,
    ));
  });
}

// ── WINDOW EVENT METHODS ─────────────────────────────────────────────────────

/**
 * Add addEventListener / removeEventListener / dispatchEvent on a window JSObject.
 */
export function bindWindowEvents(winObj: JSObject): void {
  winObj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1] as JSFunction;
      const once = args.length > 2 ? toBoolean(args[2]) : false;
      const entries = getWindowListeners(winObj);
      const dup = entries.find(e => e.type === type && e.fn === fn && !e.once);
      if (!dup) entries.push({ type, fn, once });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  winObj.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1] as JSFunction;
      const entries = getWindowListeners(winObj);
      const i = entries.findIndex(e => e.type === type && e.fn === fn);
      if (i !== -1) entries.splice(i, 1);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  winObj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_this, args) => {
      const evt = args[0] as JSObject;
      if (evt && typeof evt === 'object' && 'properties' in evt) {
        dispatchWindowEvent(winObj, evt);
      }
      return true;
    }),
    writable: true, enumerable: true, configurable: true,
  });
}
