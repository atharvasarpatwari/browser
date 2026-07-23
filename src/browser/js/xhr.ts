import type { JSValue, JSObject, JSFunction } from './values';
import { createObject, createNativeFunction, toString, toNumber, toBoolean } from './values';
import type { EventLoop } from './event-loop';
import { createEventDispatcher, fireEvent, clearEventListeners } from './xhr-bindings';

const UNSENT = 0;
const OPENED = 1;
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

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

function buildXhrInstance(eventLoop: EventLoop): JSObject {
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

        response.headers.forEach((value: string, key: string) => {
          state.responseHeaders.set(key.toLowerCase(), value);
        });

        setReadyState(obj, state, HEADERS_RECEIVED);

        const text = await response.text();
        if (state.aborted) return;

        state.responseText = text;
        state.response = text;
        obj.properties.set('responseText', { value: text, writable: false, enumerable: true, configurable: true });
        obj.properties.set('response', { value: text, writable: false, enumerable: true, configurable: true });

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

export function createXMLHttpRequestClass(eventLoop: EventLoop): JSObject {
  const ctor = createObject(null);
  ctor.properties.set('callable', { value: true, writable: false, enumerable: false, configurable: false });

  ctor.properties.set('nativeFn', {
    value: createNativeFunction('XMLHttpRequest', (_this, _args) => {
      return buildXhrInstance(eventLoop);
    }),
    writable: false, enumerable: false, configurable: false,
  });

  ctor.properties.set('prototype', {
    value: buildXhrInstance(eventLoop),
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
