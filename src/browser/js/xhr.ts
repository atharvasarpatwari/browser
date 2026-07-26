import type { JSValue, JSObject, JSFunction } from './values';
import { createObject, createNativeFunction, toString, toNumber, toBoolean } from './values';
import type { EventLoop } from './event-loop';
import { createEventDispatcher, fireEvent, clearEventListeners } from './xhr-bindings';
import type { ICorsEngine, CorsRequest } from '../security/cors';
import { CorsMode, CorsCredentials } from '../security/cors';
import { parseOrigin } from '../security/origin-service';

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

/** Headers that XHR must block per the Fetch Standard. */
const XHR_RESTRICTED_HEADERS = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding',
  'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization',
  'proxy-connection',
]);

interface XhrState {
  readyState: number;
  status: number;
  statusText: string;
  responseText: string;
  response: string;
  responseType: string;
  timeout: number;
  withCredentials: boolean;
  method: string;
  url: string;
  async: boolean;
  requestHeaders: Map<string, string>;
  responseHeaders: Map<string, string>;
  aborted: boolean;
  sendFlag: boolean;
  mimeTypeOverride: string | null;
  pageOrigin: string;
}

const xhrStates = new WeakMap<JSObject, XhrState>();

function setProp(obj: JSObject, name: string, value: JSValue, writable = true, enumerable = true): void {
  obj.properties.set(name, { value, writable, enumerable, configurable: true });
}

function setReadyState(xhrObj: JSObject, state: XhrState, readyState: number): void {
  state.readyState = readyState;
  xhrObj.properties.set('readyState', { value: readyState, writable: true, enumerable: true, configurable: true });
  fireEvent(xhrObj, 'readystatechange');
}

function formatResponseHeaders(headers: Map<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of headers) {
    lines.push(`${key}: ${value}`);
  }
  return lines.sort().join('\r\n');
}

function buildXhrInstance(eventLoop: EventLoop, corsEngine?: ICorsEngine, pageOrigin?: string): JSObject {
  const obj = createObject(null);
  const state: XhrState = {
    readyState: UNSENT,
    status: 0,
    statusText: '',
    responseText: '',
    response: '',
    responseType: '',
    timeout: 0,
    withCredentials: false,
    method: '',
    url: '',
    async: true,
    requestHeaders: new Map(),
    responseHeaders: new Map(),
    aborted: false,
    sendFlag: false,
    mimeTypeOverride: null,
    pageOrigin: pageOrigin ?? '',
  };
  xhrStates.set(obj, state);
  createEventDispatcher(obj);

  // ReadyState constants (static)
  setProp(obj, 'UNSENT', UNSENT, false, false);
  setProp(obj, 'OPENED', OPENED, false, false);
  setProp(obj, 'HEADERS_RECEIVED', HEADERS_RECEIVED, false, false);
  setProp(obj, 'LOADING', LOADING, false, false);
  setProp(obj, 'DONE', DONE, false, false);

  // Read-only getters
  setProp(obj, 'readyState', UNSENT);
  setProp(obj, 'status', 0);
  setProp(obj, 'statusText', '');
  setProp(obj, 'responseText', '');
  setProp(obj, 'response', '');
  setProp(obj, 'responseURL', '');

  // Writable properties
  setProp(obj, 'responseType', '');
  setProp(obj, 'timeout', 0);
  setProp(obj, 'withCredentials', false);

  // Event handler properties
  setProp(obj, 'onreadystatechange', null);
  setProp(obj, 'onloadstart', null);
  setProp(obj, 'onload', null);
  setProp(obj, 'onloadend', null);
  setProp(obj, 'onerror', null);
  setProp(obj, 'onabort', null);
  setProp(obj, 'ontimeout', null);
  setProp(obj, 'onprogress', null);

  // open()
  setProp(obj, 'open', createNativeFunction('open', (_this, args) => {
    const method = toString(args[0] ?? 'GET').toUpperCase();
    const url = toString(args[1] ?? '');
    const asyncArg = args[2];
    const async = asyncArg === undefined ? true : toBoolean(asyncArg);

    state.method = method;
    state.url = url;
    state.async = async;
    state.readyState = OPENED;
    state.sendFlag = false;
    state.aborted = false;
    state.responseText = '';
    state.response = '';
    state.status = 0;
    state.statusText = '';
    state.responseHeaders.clear();
    state.requestHeaders.clear();

    obj.properties.set('readyState', { value: OPENED, writable: true, enumerable: true, configurable: true });
    obj.properties.set('responseURL', { value: url, writable: false, enumerable: true, configurable: true });
    fireEvent(obj, 'readystatechange');
    return undefined;
  }));

  // setRequestHeader()
  setProp(obj, 'setRequestHeader', createNativeFunction('setRequestHeader', (_this, args) => {
    if (state.readyState !== OPENED) {
      throw new Error("Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.");
    }
    const name = toString(args[0] ?? '');
    const value = toString(args[1] ?? '');
    // Block restricted headers per Fetch Standard
    if (XHR_RESTRICTED_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`Refused to set unsafe header '${name}'`);
    }
    state.requestHeaders.set(name.toLowerCase(), value);
    return undefined;
  }));

  // send()
  setProp(obj, 'send', createNativeFunction('send', (_this, args) => {
    if (state.readyState !== OPENED) {
      throw new Error("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.");
    }
    if (state.sendFlag) {
      throw new Error("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.");
    }

    const body = args[0] !== undefined && args[0] !== null ? toString(args[0]) : undefined;
    state.sendFlag = true;
    state.aborted = false;

    fireEvent(obj, 'loadstart');

    const headersObj: Record<string, string> = {};
    for (const [k, v] of state.requestHeaders) headersObj[k] = v;

    // ── CORS pre-request check ──────────────────────────────────────────
    let isOpaque = false;
    const requestOrigin = parseOrigin(state.url, state.pageOrigin);
    const isCrossOrigin = state.pageOrigin && requestOrigin !== state.pageOrigin;

    if (corsEngine && isCrossOrigin) {
      const credentials = state.withCredentials ? CorsCredentials.Include : CorsCredentials.SameOrigin;
      const corsReq: CorsRequest = {
        url: state.url,
        origin: state.pageOrigin,
        method: state.method,
        headers: new Map(Object.entries(headersObj).map(([k, v]) => [k.toLowerCase(), v])),
        mode: CorsMode.Cors,
        credentials,
      };
      try {
        const preCheck = corsEngine.checkRequest(corsReq);
        // Inject CORS request headers
        for (const [k, v] of preCheck.requestHeaders) {
          headersObj[k] = v;
        }
        if (preCheck.decision === 'opaque') {
          isOpaque = true;
        }
      } catch {
        // CORS blocked — fire error
        state.status = 0;
        state.statusText = '';
        obj.properties.set('status', { value: 0, writable: false, enumerable: true, configurable: true });
        obj.properties.set('statusText', { value: '', writable: false, enumerable: true, configurable: true });
        setReadyState(obj, state, DONE);
        fireEvent(obj, 'error');
        fireEvent(obj, 'loadend');
        return undefined;
      }
    } else if (isCrossOrigin) {
      // No CORS engine — inject Origin header for best-effort
      if (!headersObj['origin']) {
        headersObj['origin'] = state.pageOrigin;
      }
    }

    const fetchInit: Record<string, unknown> = {
      method: state.method,
      headers: headersObj,
    };
    if (body !== undefined) fetchInit.body = body;

    eventLoop.enqueueMicrotask(async () => {
      if (state.aborted) return;

      try {
        const response = await globalThis.fetch(state.url, fetchInit);
        if (state.aborted) return;

        state.status = response.status;
        state.statusText = response.statusText;
        obj.properties.set('status', { value: state.status, writable: false, enumerable: true, configurable: true });
        obj.properties.set('statusText', { value: state.statusText, writable: false, enumerable: true, configurable: true });

        // ── CORS post-response check ──────────────────────────────────
        if (corsEngine && isCrossOrigin && !isOpaque) {
          const credentials = state.withCredentials ? CorsCredentials.Include : CorsCredentials.SameOrigin;
          const corsReq: CorsRequest = {
            url: state.url,
            origin: state.pageOrigin,
            method: state.method,
            headers: new Map(Object.entries(headersObj).map(([k, v]) => [k.toLowerCase(), v])),
            mode: CorsMode.Cors,
            credentials,
          };
          const resHeadersMap = new Map<string, string>();
          response.headers.forEach((value: string, key: string) => {
            resHeadersMap.set(key.toLowerCase(), value);
          });
          try {
            corsEngine.checkResponse(corsReq, {
              statusCode: response.status,
              statusText: response.statusText,
              headers: resHeadersMap,
              body: '',
            });
          } catch {
            // CORS violation — make response opaque
            isOpaque = true;
          }
        }

        response.headers.forEach((value: string, key: string) => {
          state.responseHeaders.set(key.toLowerCase(), value);
        });

        setReadyState(obj, state, HEADERS_RECEIVED);

        const text = await response.text();
        if (state.aborted) return;

        // If opaque, hide body from script
        if (isOpaque) {
          state.responseText = '';
          state.response = '';
          obj.properties.set('responseText', { value: '', writable: false, enumerable: true, configurable: true });
          obj.properties.set('response', { value: '', writable: false, enumerable: true, configurable: true });
        } else {
          state.responseText = text;
          state.response = text;
          obj.properties.set('responseText', { value: text, writable: false, enumerable: true, configurable: true });
          obj.properties.set('response', { value: text, writable: false, enumerable: true, configurable: true });
        }

        setReadyState(obj, state, LOADING);
        setReadyState(obj, state, DONE);

        fireEvent(obj, 'load');
        fireEvent(obj, 'loadend');
      } catch (err) {
        if (state.aborted) {
          fireEvent(obj, 'abort');
          fireEvent(obj, 'loadend');
          return;
        }
        state.status = 0;
        state.statusText = '';
        obj.properties.set('status', { value: 0, writable: false, enumerable: true, configurable: true });
        obj.properties.set('statusText', { value: '', writable: false, enumerable: true, configurable: true });
        setReadyState(obj, state, DONE);
        fireEvent(obj, 'error');
        fireEvent(obj, 'loadend');
      }
    });

    return undefined;
  }));

  // abort()
  setProp(obj, 'abort', createNativeFunction('abort', (_this, _args) => {
    state.aborted = true;
    state.sendFlag = false;
    state.responseText = '';
    state.response = '';
    state.status = 0;
    state.statusText = '';
    state.readyState = UNSENT;
    obj.properties.set('readyState', { value: UNSENT, writable: true, enumerable: true, configurable: true });
    obj.properties.set('status', { value: 0, writable: false, enumerable: true, configurable: true });
    obj.properties.set('statusText', { value: '', writable: false, enumerable: true, configurable: true });
    obj.properties.set('responseText', { value: '', writable: false, enumerable: true, configurable: true });
    obj.properties.set('response', { value: '', writable: false, enumerable: true, configurable: true });
    fireEvent(obj, 'readystatechange');
    fireEvent(obj, 'abort');
    fireEvent(obj, 'loadend');
    return undefined;
  }));

  // getResponseHeader()
  setProp(obj, 'getResponseHeader', createNativeFunction('getResponseHeader', (_this, args) => {
    const name = toString(args[0] ?? '');
    if (state.readyState < HEADERS_RECEIVED) return null;
    return state.responseHeaders.get(name.toLowerCase()) ?? null;
  }));

  // getAllResponseHeaders()
  setProp(obj, 'getAllResponseHeaders', createNativeFunction('getAllResponseHeaders', (_this, _args) => {
    if (state.readyState < HEADERS_RECEIVED) return '';
    return formatResponseHeaders(state.responseHeaders);
  }));

  // overrideMimeType()
  setProp(obj, 'overrideMimeType', createNativeFunction('overrideMimeType', (_this, args) => {
    state.mimeTypeOverride = toString(args[0] ?? '');
    return undefined;
  }));

  // cleanup
  setProp(obj, '__cleanup', createNativeFunction('__cleanup', () => {
    clearEventListeners(obj);
    xhrStates.delete(obj);
    return undefined;
  }));

  return obj;
}

export function createXMLHttpRequestClass(eventLoop: EventLoop, corsEngine?: ICorsEngine, pageOrigin?: string): JSObject {
  const ctor = createObject(null);
  ctor.properties.set('callable', { value: true, writable: false, enumerable: false, configurable: false });

  ctor.properties.set('nativeFn', {
    value: createNativeFunction('XMLHttpRequest', (_this, _args) => {
      return buildXhrInstance(eventLoop, corsEngine, pageOrigin);
    }),
    writable: false, enumerable: false, configurable: false,
  });

  ctor.properties.set('prototype', {
    value: buildXhrInstance(eventLoop, corsEngine, pageOrigin),
    writable: false, enumerable: false, configurable: false,
  });

  // Static constants on constructor
  setProp(ctor, 'UNSENT', UNSENT, false, false);
  setProp(ctor, 'OPENED', OPENED, false, false);
  setProp(ctor, 'HEADERS_RECEIVED', HEADERS_RECEIVED, false, false);
  setProp(ctor, 'LOADING', LOADING, false, false);
  setProp(ctor, 'DONE', DONE, false, false);

  return ctor;
}

export { xhrStates, UNSENT, OPENED, HEADERS_RECEIVED, LOADING, DONE };
