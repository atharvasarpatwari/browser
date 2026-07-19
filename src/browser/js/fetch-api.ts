// ─────────────────────────────────────────────────────────────────────────────
// FETCH API — Headers, Response, Request, AbortController, fetch()
// ─────────────────────────────────────────────────────────────────────────────

import type { JSValue, JSObject, JSFunction } from './values';
import {
  createObject, createArray, createNativeFunction,
  toString, toNumber, callJSFunction,
} from './values';
import type { EventLoop } from './event-loop';
import { createWiredPromise, fulfillPromise, rejectPromise } from './promise';
import type { CspResourceEnforcer } from '../security/csp-resource-enforcer';

// ── Helpers ──────────────────────────────────────────────────────────────────

type PlatformFetch = (url: string | Request, init?: Record<string, unknown>) => Promise<globalThis.Response>;

let platformFetchRef: PlatformFetch = globalThis.fetch.bind(globalThis);

function setPlatformFetch(fn: PlatformFetch): void {
  platformFetchRef = fn;
}

const BLOCKED_FETCH_SCHEMES = new Set(['javascript:', 'vbscript:', 'data:']);

const RESTRICTED_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding',
  'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization',
  'proxy-connection',
]);

function isBlockedScheme(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  for (const scheme of BLOCKED_FETCH_SCHEMES) {
    if (trimmed.startsWith(scheme)) return true;
  }
  return false;
}

function validateHeaders(headers: Map<string, string>): void {
  for (const name of headers.keys()) {
    if (RESTRICTED_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`Refused to set unsafe header '${name}'`);
    }
  }
}

function setProp(obj: JSObject, name: string, value: JSValue, writable = true, enumerable = true): void {
  obj.properties.set(name, { value, writable, enumerable, configurable: true });
}

function getProp(obj: JSObject, name: string): JSValue | undefined {
  return obj.properties.get(name)?.value;
}

function jsObjToMap(obj: JSObject): Map<string, string> {
  const map = new Map<string, string>();
  for (const [k, desc] of obj.properties) {
    if (typeof desc.value === 'string') {
      map.set(k.toLowerCase(), desc.value);
    }
  }
  return map;
}

// ── Internal state ───────────────────────────────────────────────────────────

interface HeadersInternal { map: Map<string, string> }
interface ResponseInternal {
  body: string;
  status: number;
  statusText: string;
  headers: HeadersInternal;
  url: string;
  redirected: boolean;
  type: string;
  bodyUsed: boolean;
}
interface RequestInternal {
  url: string;
  method: string;
  headers: HeadersInternal;
  body: string | null;
  signal: JSObject | null;
  bodyUsed: boolean;
}
interface AbortSignalInternal {
  aborted: boolean;
  reason: JSValue;
}
interface AbortControllerInternal {
  aborted: boolean;
  reason: JSValue;
  signal: JSObject;
}

const headersState = new WeakMap<JSObject, HeadersInternal>();
const responseState = new WeakMap<JSObject, ResponseInternal>();
const requestState = new WeakMap<JSObject, RequestInternal>();
const signalState = new WeakMap<JSObject, AbortSignalInternal>();
const controllerState = new WeakMap<JSObject, AbortControllerInternal>();

// ── Headers class ────────────────────────────────────────────────────────────

function buildHeadersInstance(eventLoop: EventLoop, internal: HeadersInternal): JSObject {
  const obj = createObject(null);
  headersState.set(obj, internal);

  obj.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      const name = toString(args[0]);
      return internal.map.get(name.toLowerCase()) ?? null;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('set', {
    value: createNativeFunction('set', (_this, args) => {
      const name = toString(args[0]);
      const value = toString(args[1]);
      if (RESTRICTED_HEADERS.has(name.toLowerCase())) {
        throw new TypeError(`Refused to set unsafe header '${name}'`);
      }
      internal.map.set(name.toLowerCase(), value);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('has', {
    value: createNativeFunction('has', (_this, args) => {
      const name = toString(args[0]);
      return internal.map.has(name.toLowerCase());
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('append', {
    value: createNativeFunction('append', (_this, args) => {
      const name = toString(args[0]);
      const value = toString(args[1]);
      if (RESTRICTED_HEADERS.has(name.toLowerCase())) {
        throw new TypeError(`Refused to set unsafe header '${name}'`);
      }
      const key = name.toLowerCase();
      const existing = internal.map.get(key);
      internal.map.set(key, existing ? `${existing}, ${value}` : value);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('delete', {
    value: createNativeFunction('delete', (_this, args) => {
      const name = toString(args[0]);
      internal.map.delete(name.toLowerCase());
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('entries', {
    value: createNativeFunction('entries', () => {
      const entries: JSObject[] = [];
      for (const [k, v] of internal.map) {
        const pair = createArray([k, v]);
        entries.push(pair);
      }
      return createArray(entries);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('keys', {
    value: createNativeFunction('keys', () => {
      return createArray([...internal.map.keys()] as JSValue[]);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('values', {
    value: createNativeFunction('values', () => {
      return createArray([...internal.map.values()] as JSValue[]);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('forEach', {
    value: createNativeFunction('forEach', (_this, args) => {
      const fn = args[0];
      if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
      for (const [k, v] of internal.map) {
        callJSFunction(fn as JSFunction, obj, [v, k, obj]);
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('toString', {
    value: createNativeFunction('toString', () => {
      const pairs: string[] = [];
      for (const [k, v] of internal.map) pairs.push(`${k}: ${v}`);
      return pairs.join(', ');
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

export function createHeadersClass(_eventLoop: EventLoop): JSObject {
  const ctor = createObject(null);
  ctor.callable = true;
  ctor.nativeFn = (_this, args) => {
    const internal: HeadersInternal = { map: new Map() };
    const init = args[0];

    if (init && typeof init === 'object' && (init as JSObject).type !== 'array') {
      const initObj = init as JSObject;
      if (headersState.has(initObj)) {
        const src = headersState.get(initObj)!;
        for (const [k, v] of src.map) internal.map.set(k, v);
      } else {
        for (const [k, desc] of initObj.properties) {
          if (typeof desc.value === 'string') {
            internal.map.set(k.toLowerCase(), desc.value);
          }
        }
      }
    }

    return buildHeadersInstance(_eventLoop, internal);
  };
  return ctor;
}

// ── Response class ───────────────────────────────────────────────────────────

function buildResponseInstance(eventLoop: EventLoop, internal: ResponseInternal): JSObject {
  const obj = createObject(null);
  responseState.set(obj, internal);

  // Read-only getters — use PropertyDescriptor getter field so values are live
  for (const [name, getter] of [
    ['ok', () => internal.status >= 200 && internal.status < 300],
    ['status', () => internal.status],
    ['statusText', () => internal.statusText],
    ['url', () => internal.url],
    ['redirected', () => internal.redirected],
    ['type', () => internal.type],
    ['bodyUsed', () => internal.bodyUsed],
  ] as const) {
    const nativeGetter = createNativeFunction(`${String(name)}_getter`, () => getter());
    obj.properties.set(name, {
      value: undefined, writable: false, enumerable: true, configurable: true,
      getter: nativeGetter,
    });
  }

  // Headers object
  const headersObj = buildHeadersInstance(eventLoop, internal.headers);
  obj.properties.set('headers', {
    value: headersObj, writable: false, enumerable: true, configurable: true,
  });

  // Body methods — return Promises
  obj.properties.set('json', {
    value: createNativeFunction('json', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      try {
        const parsed = JSON.parse(internal.body);
        // Convert parsed JSON to JSValue
        const jsVal = jsonToJsValue(parsed);
        fulfillPromise(p, jsVal);
      } catch (err) {
        rejectPromise(p, err instanceof Error ? err.message : String(err));
      }
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('text', {
    value: createNativeFunction('text', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      fulfillPromise(p, internal.body);
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('blob', {
    value: createNativeFunction('blob', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      fulfillPromise(p, internal.body);
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('arrayBuffer', {
    value: createNativeFunction('arrayBuffer', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      fulfillPromise(p, internal.body);
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('clone', {
    value: createNativeFunction('clone', () => {
      const clonedInternal: ResponseInternal = {
        body: internal.body,
        status: internal.status,
        statusText: internal.statusText,
        headers: { map: new Map(internal.headers.map) },
        url: internal.url,
        redirected: internal.redirected,
        type: internal.type,
        bodyUsed: false,
      };
      return buildResponseInstance(eventLoop, clonedInternal);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

function jsonToJsValue(val: unknown): JSValue {
  if (val === null || val === undefined) return val as JSValue;
  if (typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val as JSValue;
  if (Array.isArray(val)) return createArray(val.map(jsonToJsValue));
  if (typeof val === 'object') {
    const obj = createObject(null);
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      obj.properties.set(k, { value: jsonToJsValue(v), writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }
  return undefined;
}

export function createResponseClass(eventLoop: EventLoop): JSObject {
  const ctor = createObject(null);
  ctor.callable = true;
  ctor.nativeFn = (_this, args) => {
    const body = args[0] !== undefined && args[0] !== null ? toString(args[0]) : '';
    const init = args[1] as JSObject | undefined;

    let status = 200;
    let statusText = 'OK';
    const headersInternal: HeadersInternal = { map: new Map() };

    if (init && typeof init === 'object') {
      const s = init.properties.get('status');
      if (s) status = toNumber(s.value);
      const st = init.properties.get('statusText');
      if (st) statusText = toString(st.value);
      const h = init.properties.get('headers');
      if (h && typeof h.value === 'object' && h.value !== null) {
        if (headersState.has(h.value as JSObject)) {
          const src = headersState.get(h.value as JSObject)!;
          for (const [k, v] of src.map) headersInternal.map.set(k, v);
        } else {
          for (const [k, desc] of (h.value as JSObject).properties) {
            if (typeof desc.value === 'string') headersInternal.map.set(k.toLowerCase(), desc.value);
          }
        }
      }
    }

    const internal: ResponseInternal = {
      body, status, statusText, headers: headersInternal,
      url: '', redirected: false, type: 'default', bodyUsed: false,
    };
    return buildResponseInstance(eventLoop, internal);
  };

  // Static error method
  ctor.properties.set('error', {
    value: createNativeFunction('error', (_this, args) => {
      const eventLoop = args[0] as unknown as EventLoop;
      const internal: ResponseInternal = {
        body: '', status: 0, statusText: '', headers: { map: new Map() },
        url: '', redirected: false, type: 'error', bodyUsed: false,
      };
      return buildResponseInstance(eventLoop, internal);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // Static redirect method
  ctor.properties.set('redirect', {
    value: createNativeFunction('redirect', (_this, args) => {
      const url = toString(args[0]);
      const status = args[1] !== undefined ? toNumber(args[1]) : 302;
      const internal: ResponseInternal = {
        body: '', status, statusText: '', headers: { map: new Map() },
        url, redirected: false, type: 'default', bodyUsed: false,
      };
      return buildResponseInstance(_eventLoop, internal);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return ctor;
}

// ── Request class ────────────────────────────────────────────────────────────

function buildRequestInstance(eventLoop: EventLoop, internal: RequestInternal): JSObject {
  const obj = createObject(null);
  requestState.set(obj, internal);

  obj.properties.set('url', {
    value: internal.url, writable: false, enumerable: true, configurable: true,
  });
  obj.properties.set('method', {
    value: internal.method, writable: false, enumerable: true, configurable: true,
  });
  obj.properties.set('body', {
    value: internal.body, writable: false, enumerable: true, configurable: true,
  });
  obj.properties.set('signal', {
    value: internal.signal, writable: false, enumerable: true, configurable: true,
  });
  obj.properties.set('bodyUsed', {
    value: internal.bodyUsed, writable: false, enumerable: true, configurable: true,
  });

  const headersObj = buildHeadersInstance(eventLoop, internal.headers);
  obj.properties.set('headers', {
    value: headersObj, writable: false, enumerable: true, configurable: true,
  });

  obj.properties.set('json', {
    value: createNativeFunction('json', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      try {
        fulfillPromise(p, jsonToJsValue(JSON.parse(internal.body ?? '')));
      } catch (err) {
        rejectPromise(p, err instanceof Error ? err.message : String(err));
      }
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('text', {
    value: createNativeFunction('text', () => {
      if (internal.bodyUsed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, new TypeError('Body already used'));
        return p;
      }
      internal.bodyUsed = true;
      const p = createWiredPromise(eventLoop);
      fulfillPromise(p, internal.body ?? '');
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('clone', {
    value: createNativeFunction('clone', () => {
      const cloned: RequestInternal = {
        url: internal.url,
        method: internal.method,
        headers: { map: new Map(internal.headers.map) },
        body: internal.body,
        signal: internal.signal,
        bodyUsed: false,
      };
      return buildRequestInstance(eventLoop, cloned);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return obj;
}

export function createRequestClass(eventLoop: EventLoop): JSObject {
  const ctor = createObject(null);
  ctor.callable = true;
  ctor.nativeFn = (_this, args) => {
    const url = toString(args[0]);
    const init = args[1] as JSObject | undefined;

    let method = 'GET';
    let body: string | null = null;
    let signal: JSObject | null = null;
    const headersInternal: HeadersInternal = { map: new Map() };

    if (init && typeof init === 'object') {
      const m = init.properties.get('method');
      if (m) method = toString(m.value).toUpperCase();
      const b = init.properties.get('body');
      if (b) body = toString(b.value);
      const s = init.properties.get('signal');
      if (s && typeof s.value === 'object' && s.value !== null) signal = s.value as JSObject;
      const h = init.properties.get('headers');
      if (h && typeof h.value === 'object' && h.value !== null) {
        if (headersState.has(h.value as JSObject)) {
          const src = headersState.get(h.value as JSObject)!;
          for (const [k, v] of src.map) headersInternal.map.set(k, v);
        } else {
          for (const [k, desc] of (h.value as JSObject).properties) {
            if (typeof desc.value === 'string') headersInternal.map.set(k.toLowerCase(), desc.value);
          }
        }
      }
    }

    const internal: RequestInternal = {
      url, method, headers: headersInternal, body, signal, bodyUsed: false,
    };
    return buildRequestInstance(eventLoop, internal);
  };
  return ctor;
}

// DOMException shim (simplified)
function createDOMException(message: string, name: string): Error {
  const err = new Error(message);
  (err as any).name = name;
  return err;
}

// ── AbortController / AbortSignal ────────────────────────────────────────────

export function createAbortControllerClass(eventLoop: EventLoop): JSObject {
  const ctor = createObject(null);
  ctor.callable = true;
  ctor.nativeFn = (_this, _args) => {
    const ctrlObj = createObject(null);
    const signalObj = createObject(null);

    const sigInternal: AbortSignalInternal = { aborted: false, reason: undefined };
    signalState.set(signalObj, sigInternal);

    const ctrlInternal: AbortControllerInternal = {
      aborted: false, reason: undefined, signal: signalObj,
    };
    controllerState.set(ctrlObj, ctrlInternal);

    // AbortSignal properties
    signalObj.properties.set('aborted', {
      value: false, writable: false, enumerable: true, configurable: true,
    });
    signalObj.properties.set('reason', {
      value: undefined, writable: false, enumerable: true, configurable: true,
    });
    signalObj.properties.set('throwIfAborted', {
      value: createNativeFunction('throwIfAborted', () => {
        if (sigInternal.aborted) {
          throw createDOMException('The operation was aborted.', 'AbortError');
        }
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // Event listener support on signal
    const signalListeners = new Map<string, Set<JSFunction>>();
    signalObj.properties.set('addEventListener', {
      value: createNativeFunction('addEventListener', (_s, sArgs) => {
        const type = toString(sArgs[0]);
        const fn = sArgs[1];
        if (typeof fn !== 'object' || fn === null || (fn as JSFunction).type !== 'closure') return undefined;
        if (!signalListeners.has(type)) signalListeners.set(type, new Set());
        signalListeners.get(type)!.add(fn as JSFunction);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    signalObj.properties.set('removeEventListener', {
      value: createNativeFunction('removeEventListener', (_s, sArgs) => {
        const type = toString(sArgs[0]);
        const fn = sArgs[1];
        signalListeners.get(type)?.delete(fn as JSFunction);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // Store listener map on signal for abort dispatch
    (signalObj as any).__signalListeners = signalListeners;

    // AbortController.abort()
    ctrlObj.properties.set('abort', {
      value: createNativeFunction('abort', () => {
        if (sigInternal.aborted) return undefined;
        sigInternal.aborted = true;
        sigInternal.reason = createDOMException('The operation was aborted.', 'AbortError');
        ctrlInternal.aborted = true;
        ctrlInternal.reason = sigInternal.reason;

        // Update signal properties
        signalObj.properties.set('aborted', {
          value: true, writable: false, enumerable: true, configurable: true,
        });
        signalObj.properties.set('reason', {
          value: sigInternal.reason, writable: false, enumerable: true, configurable: true,
        });

        // Fire 'abort' event on signal
        const listeners = signalListeners.get('abort');
        if (listeners) {
          const evtObj = createObject(null);
          evtObj.properties.set('type', { value: 'abort', writable: false, enumerable: true, configurable: false });
          for (const fn of listeners) {
            try { callJSFunction(fn, signalObj, [evtObj]); } catch { /* swallow */ }
          }
        }

        // Call onabort if set
        const onAbort = signalObj.properties.get('onabort')?.value;
        if (onAbort && typeof onAbort === 'object' && (onAbort as JSFunction).type === 'closure') {
          const evtObj = createObject(null);
          evtObj.properties.set('type', { value: 'abort', writable: false, enumerable: true, configurable: false });
          try { callJSFunction(onAbort as JSFunction, signalObj, [evtObj]); } catch { /* swallow */ }
        }

        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    ctrlObj.properties.set('signal', {
      value: signalObj, writable: false, enumerable: true, configurable: true,
    });

    return ctrlObj;
  };
  return ctor;
}

// ── fetch() function ─────────────────────────────────────────────────────────

export function createFetchFn(
  eventLoop: EventLoop,
  platformFetch?: PlatformFetch,
  resourceEnforcer?: CspResourceEnforcer,
  pageOrigin?: string,
): JSFunction {
  const fetchFn = platformFetch ?? platformFetchRef;
  return createNativeFunction('fetch', (_this, args) => {
    const urlOrRequest = args[0];
    const init = args[1];

    let url: string;
    let method = 'GET';
    let headers: Record<string, string> = {};
    let body: string | undefined;
    let signalObj: JSObject | undefined;

    // Parse arguments
    if (urlOrRequest && typeof urlOrRequest === 'object' && requestState.has(urlOrRequest as JSObject)) {
      const reqInt = requestState.get(urlOrRequest as JSObject)!;
      url = reqInt.url;
      method = reqInt.method;
      for (const [k, v] of reqInt.headers.map) headers[k] = v;
      body = reqInt.body ?? undefined;
      if (reqInt.signal && signalState.has(reqInt.signal)) {
        const sigInt = signalState.get(reqInt.signal)!;
        if (sigInt.aborted) {
          const p = createWiredPromise(eventLoop);
          rejectPromise(p, createDOMException('The operation was aborted.', 'AbortError'));
          return p;
        }
        // We'd need a way to convert our signal to a real AbortSignal — skip for now
      }
    } else {
      url = toString(urlOrRequest);
    }

    if (init && typeof init === 'object' && (init as JSObject).type !== 'array') {
      const initObj = init as JSObject;
      const m = initObj.properties.get('method');
      if (m) method = toString(m.value).toUpperCase();
      const h = initObj.properties.get('headers');
      if (h && typeof h.value === 'object' && h.value !== null) {
        if (headersState.has(h.value as JSObject)) {
          const src = headersState.get(h.value as JSObject)!;
          for (const [k, v] of src.map) headers[k] = v;
        } else {
          for (const [k, desc] of (h.value as JSObject).properties) {
            if (typeof desc.value === 'string') headers[k.toLowerCase()] = desc.value;
          }
        }
      }
      const b = initObj.properties.get('body');
      if (b) body = toString(b.value);
      const s = initObj.properties.get('signal');
      if (s && typeof s.value === 'object' && s.value !== null && signalState.has(s.value as JSObject)) {
        signalObj = s.value as JSObject;
        const sigInt = signalState.get(signalObj)!;
        if (sigInt.aborted) {
          const p = createWiredPromise(eventLoop);
          rejectPromise(p, createDOMException('The operation was aborted.', 'AbortError'));
          return p;
        }
      }
    }

    // Validate URL scheme
    if (isBlockedScheme(url)) {
      const p = createWiredPromise(eventLoop);
      rejectPromise(p, `Blocked fetch to '${url}': prohibited URL scheme`);
      return p;
    }

    // Validate headers — block restricted headers
    try {
      const headerMap = new Map(Object.entries(headers));
      validateHeaders(headerMap);
    } catch (err) {
      const p = createWiredPromise(eventLoop);
      rejectPromise(p, err instanceof Error ? err.message : String(err));
      return p;
    }

    // CSP connect-src enforcement
    if (resourceEnforcer && pageOrigin) {
      const check = resourceEnforcer.checkFetch(url, pageOrigin, pageOrigin, method);
      if (!check.allowed) {
        const p = createWiredPromise(eventLoop);
        rejectPromise(p, `Refused to connect to '${url}' because it violates the Content Security Policy directive "connect-src"`);
        return p;
      }
    }

    // Build platform fetch init
    const platformInit: Record<string, unknown> = { method, headers };
    if (body !== undefined) platformInit.body = body;

    // Create and return a Promise
    const promise = createWiredPromise(eventLoop);

    // Check if signal was provided and store reference for abort checking
    const signalInternal = signalObj ? signalState.get(signalObj) : undefined;

    // Call platform fetch and bridge native Promise → our JS Promise
    Promise.resolve(fetchFn(url, platformInit)).then(
      (res: any) => {
        // Check if signal was aborted during fetch
        if (signalInternal?.aborted) {
          rejectPromise(promise, createDOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        try {
          const resHeaders: HeadersInternal = { map: new Map() };
          if (res?.headers?.forEach) {
            res.headers.forEach((value: string, key: string) => {
              resHeaders.map.set(key.toLowerCase(), value);
            });
          }
          const textFn = res?.text;
          if (typeof textFn === 'function') {
            Promise.resolve(textFn.call(res)).then(
              (text: string) => {
                fulfillPromise(promise, buildResponseInstance(eventLoop, {
                  body: text,
                  status: res.status ?? 200,
                  statusText: res.statusText ?? 'OK',
                  headers: resHeaders,
                  url: res.url ?? '',
                  redirected: res.redirected ?? false,
                  type: 'default',
                  bodyUsed: false,
                }));
              },
              (err: unknown) => {
                rejectPromise(promise, err instanceof Error ? err.message : String(err));
              }
            );
          } else {
            fulfillPromise(promise, buildResponseInstance(eventLoop, {
              body: '', status: res.status ?? 200, statusText: res.statusText ?? 'OK',
              headers: resHeaders, url: res.url ?? '', redirected: res.redirected ?? false,
              type: 'default', bodyUsed: false,
            }));
          }
        } catch (err) {
          rejectPromise(promise, err instanceof Error ? err.message : String(err));
        }
      },
      (err: unknown) => {
        rejectPromise(promise, err instanceof Error ? err.message : String(err));
      }
    );

    return promise;
  });
}

// Re-export for tests
export { setPlatformFetch };
export { headersState, responseState, requestState, signalState, controllerState };
