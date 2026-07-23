/**
 * @file src/browser/js/websocket-api.ts
 *
 * WebSocket API — provides the `WebSocket` class for JavaScript.
 *
 * Follows the WHATWG WebSocket specification:
 *   https://html.spec.whatwg.org/multipage/web-sockets.html
 *
 * ReadyState constants:
 *   CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3
 *
 * Events: open, message, error, close
 */

import type { JSValue, JSObject, JSFunction } from './values';
import {
  createObject, createNativeFunction,
  toString, callJSFunction,
} from './values';
import type { EventLoop } from './event-loop';
import type { CspResourceEnforcer } from '../security/csp-resource-enforcer';

// ── ReadyState Constants ──────────────────────────────────────────────────────

const CONNECTING = 0;
const OPEN       = 1;
const CLOSING    = 2;
const CLOSED     = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function setProp(obj: JSObject, name: string, value: JSValue, writable = true, enumerable = true): void {
  obj.properties.set(name, { value, writable, enumerable, configurable: true });
}

function getProp(obj: JSObject, name: string): JSValue | undefined {
  return obj.properties.get(name)?.value;
}

function createEventObject(type: string, extra?: Record<string, JSValue>): JSObject {
  const e = createObject(null);
  e.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  e.properties.set('bubbles', { value: false, writable: false, enumerable: true, configurable: false });
  e.properties.set('cancelable', { value: false, writable: false, enumerable: true, configurable: false });
  e.properties.set('timestamp', { value: Date.now(), writable: false, enumerable: true, configurable: false });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      e.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
    }
  }
  return e;
}

function createMessageEvent(data: string | ArrayBuffer | ArrayBufferView, origin: string, lastEventId: string): JSObject {
  const e = createEventObject('message');
  e.properties.set('data', { value: data, writable: false, enumerable: true, configurable: false });
  e.properties.set('origin', { value: origin, writable: false, enumerable: true, configurable: false });
  e.properties.set('lastEventId', { value: lastEventId, writable: false, enumerable: true, configurable: false });
  e.properties.set('source', { value: null, writable: false, enumerable: true, configurable: false });
  e.properties.set('ports', { value: null, writable: false, enumerable: true, configurable: false });
  return e;
}

// ── Platform WebSocket ────────────────────────────────────────────────────────

/**
 * A thin adapter over the native WebSocket API.
 * In a real browser this is globalThis.WebSocket.
 * For testing / non-browser environments, we accept a factory override.
 */
type WebSocketFactory = (url: string, protocols?: string | string[]) => PlatformWebSocket;

interface PlatformWebSocket {
  readonly readyState: number;
  readonly url: string;
  readonly protocol: string;
  readonly bufferedAmount: number;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, handler: (ev: any) => void): void;
  removeEventListener(type: string, handler: (ev: any) => void): void;
  set onopen(handler: ((ev: any) => void) | null);
  set onmessage(handler: ((ev: any) => void) | null);
  set onerror(handler: ((ev: any) => void) | null);
  set onclose(handler: ((ev: any) => void) | null);
}

let platformWebSocketFactory: WebSocketFactory = (url, protocols) => {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return new globalThis.WebSocket(url, protocols) as any;
  }
  throw new Error('WebSocket is not available in this environment');
};

function setPlatformWebSocketFactory(factory: WebSocketFactory): void {
  platformWebSocketFactory = factory;
}

// ── CSP Check ─────────────────────────────────────────────────────────────────

const BLOCKED_SCHEMES = new Set(['javascript:', 'vbscript:', 'data:']);

function isBlockedScheme(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (trimmed.startsWith(scheme)) return true;
  }
  return false;
}

function isSecureUrl(url: string): boolean {
  return url.startsWith('wss://') || url.startsWith('https://');
}

// ── WebSocket Class Factory ───────────────────────────────────────────────────

/**
 * Create the WebSocket constructor for the JS global environment.
 */
export function createWebSocketClass(
  eventLoop: EventLoop,
  resourceEnforcer?: CspResourceEnforcer,
  pageOrigin?: string,
): JSObject {
  const proto = createObject(null);

  // ── ReadyState constants ────────────────────────────────────────────────
  proto.properties.set('CONNECTING', { value: CONNECTING, writable: false, enumerable: false, configurable: false });
  proto.properties.set('OPEN',       { value: OPEN,       writable: false, enumerable: false, configurable: false });
  proto.properties.set('CLOSING',    { value: CLOSING,    writable: false, enumerable: false, configurable: false });
  proto.properties.set('CLOSED',     { value: CLOSED,     writable: false, enumerable: false, configurable: false });

  // ── addEventListener(type, fn) ─────────────────────────────────────────
  proto.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const wsObj = _this as JSObject;
      const type = toString(args[0]);
      const fn = args[1];
      if (fn === undefined || fn === null) return undefined;
      if (typeof fn !== 'object' || fn === null || (fn as any).type !== 'closure') return undefined;
      if (!wsObj.__wsEventHandlers) wsObj.__wsEventHandlers = new Map<string, Set<JSFunction>>();
      let set = wsObj.__wsEventHandlers.get(type);
      if (!set) {
        set = new Set();
        wsObj.__wsEventHandlers.set(type, set);
      }
      set.add(fn as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── removeEventListener(type, fn) ──────────────────────────────────────
  proto.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const wsObj = _this as JSObject;
      const type = toString(args[0]);
      const fn = args[1];
      const set = wsObj.__wsEventHandlers?.get(type);
      if (set) set.delete(fn as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── send(data) ──────────────────────────────────────────────────────────
  proto.properties.set('send', {
    value: createNativeFunction('send', (_this, args) => {
      const wsObj = _this as JSObject;
      const native = wsObj.__wsNative as PlatformWebSocket | undefined;
      const state = wsObj.__wsState as number | undefined;

      if (state !== OPEN) {
        throw new Error("Failed to execute 'send' on 'WebSocket': The WebSocket is not open.");
      }

      const data = args[0];
      let formattedData: string | ArrayBufferLike | Blob | ArrayBufferView;

      if (data === null || data === undefined) {
        formattedData = '';
      } else if (typeof data === 'string') {
        formattedData = data;
      } else if (typeof data === 'number') {
        formattedData = String(data);
      } else if (typeof data === 'boolean') {
        formattedData = String(data);
      } else if (typeof data === 'object' && data !== null && '__domNode' in data) {
        // DOM node — convert to string
        formattedData = '[object Object]';
      } else if (typeof data === 'object' && data !== null && 'properties' in data) {
        // JSObject — try to convert to JSON-like string
        formattedData = '[object Object]';
      } else {
        formattedData = String(data);
      }

      try {
        native!.send(formattedData);
      } catch (err) {
        throw new Error(`Failed to execute 'send' on 'WebSocket': ${err instanceof Error ? err.message : String(err)}`);
      }

      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── close([code[, reason]]) ─────────────────────────────────────────────
  proto.properties.set('close', {
    value: createNativeFunction('close', (_this, args) => {
      const wsObj = _this as JSObject;
      const native = wsObj.__wsNative as PlatformWebSocket | undefined;
      const state = wsObj.__wsState as number | undefined;

      if (state === CLOSED) {
        return undefined;
      }
      if (state === CLOSING) {
        return undefined;
      }

      // Set state to CLOSING immediately per spec
      wsObj.__wsState = CLOSING;
      setProp(wsObj, 'readyState', CLOSING, false, false);

      const code = args[0] !== undefined ? Number(args[0]) : undefined;
      const reason = args[1] !== undefined ? toString(args[1]) : undefined;

      try {
        native!.close(code, reason);
      } catch {
        // Ignore — native may already be closed
      }

      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Properties (set per instance in constructor) ────────────────────────
  // url, readyState, bufferedAmount, protocol, extensions — read-only
  // binaryType — writable
  // onopen, onmessage, onerror, onclose — writable event handlers

  // ── Constructor function ────────────────────────────────────────────────
  const nativeFn = createNativeFunction('WebSocket', (_this, args) => {
    if (args.length < 1) {
      throw new TypeError("Failed to construct 'WebSocket': 1 argument required, but only 0 present.");
    }

    const url = toString(args[0]);
    const protocols = args[1];

    // Parse protocols
    let parsedProtocols: string | string[] | undefined;
    if (protocols !== undefined && protocols !== null) {
      if (typeof protocols === 'string') {
        parsedProtocols = protocols;
      } else if (Array.isArray(protocols)) {
        parsedProtocols = protocols.map(p => toString(p));
      } else {
        parsedProtocols = toString(protocols);
      }
    }

    // Validate URL scheme
    const lowerUrl = url.toLowerCase();
    if (!lowerUrl.startsWith('ws://') && !lowerUrl.startsWith('wss://')) {
      throw new DOMException(
        `Failed to construct 'WebSocket': The URL '${url}' is invalid.`,
        'SyntaxError',
      );
    }

    // Block restricted schemes
    if (isBlockedScheme(url)) {
      throw new DOMException(
        `Failed to construct 'WebSocket': The URL '${url}' is invalid.`,
        'SyntaxError',
      );
    }

    // CSP check
    if (resourceEnforcer && pageOrigin) {
      const check = resourceEnforcer.checkWebSocket(url, pageOrigin, pageOrigin);
      if (!check.allowed) {
        throw new DOMException(
          `Failed to construct 'WebSocket': Refused to connect to '${url}': ${check.reason ?? 'Content Security Policy blocks this connection'}`,
          'SecurityError',
        );
      }
    }

    // Create the JS object
    const wsObj = createObject(proto);
    wsObj.__wsNative = null;
    wsObj.__wsState = CONNECTING;
    wsObj.__wsEventHandlers = new Map<string, Set<JSFunction>>();
    wsObj.__wsUrl = url;
    wsObj.__wsProtocol = '';

    // Set instance properties
    setProp(wsObj, 'url', url, false, false);
    setProp(wsObj, 'readyState', CONNECTING, false, false);
    setProp(wsObj, 'bufferedAmount', 0, false, false);
    setProp(wsObj, 'protocol', '', false, false);
    setProp(wsObj, 'extensions', '', false, false);
    setProp(wsObj, 'binaryType', 'blob', true, false);
    setProp(wsObj, 'onopen', null, true, false);
    setProp(wsObj, 'onmessage', null, true, false);
    setProp(wsObj, 'onerror', null, true, false);
    setProp(wsObj, 'onclose', null, true, false);

    // Create native WebSocket
    let nativeWs: PlatformWebSocket;
    try {
      nativeWs = platformWebSocketFactory(url, parsedProtocols);
    } catch (err) {
      wsObj.__wsState = CLOSED;
      setProp(wsObj, 'readyState', CLOSED, false, false);

      // Fire error + close events asynchronously
      eventLoop.enqueueMicrotask(() => {
        emitEvent(wsObj, 'error', createEventObject('error'));
        emitEvent(wsObj, 'close', createCloseEvent(1006, 'Connection failed', false));
      });

      return wsObj;
    }

    wsObj.__wsNative = nativeWs;
    wsObj.__wsProtocol = nativeWs.protocol ?? '';

    // ── Wire native → JS events ───────────────────────────────────────────

    nativeWs.addEventListener('open', () => {
      wsObj.__wsState = OPEN;
      wsObj.__wsProtocol = nativeWs.protocol ?? '';
      setProp(wsObj, 'readyState', OPEN, false, false);
      setProp(wsObj, 'protocol', wsObj.__wsProtocol, false, false);

      eventLoop.enqueueMicrotask(() => {
        emitEvent(wsObj, 'open', createEventObject('open'));
      });
    });

    nativeWs.addEventListener('message', (ev: any) => {
      if (wsObj.__wsState !== OPEN) return;

      const data = typeof ev.data === 'string' ? ev.data : '[Binary Data]';
      const origin = typeof location !== 'undefined' ? location.origin : '*';

      eventLoop.enqueueMicrotask(() => {
        const msgEvent = createMessageEvent(data, origin, '');
        emitEvent(wsObj, 'message', msgEvent);
      });
    });

    nativeWs.addEventListener('error', (ev: any) => {
      eventLoop.enqueueMicrotask(() => {
        emitEvent(wsObj, 'error', createEventObject('error'));
      });
    });

    nativeWs.addEventListener('close', (ev: any) => {
      const code = ev.code ?? 1006;
      const reason = ev.reason ?? '';
      const wasClean = ev.wasClean ?? false;

      wsObj.__wsState = CLOSED;
      setProp(wsObj, 'readyState', CLOSED, false, false);

      eventLoop.enqueueMicrotask(() => {
        const closeEvent = createCloseEvent(code, reason, wasClean);
        emitEvent(wsObj, 'close', closeEvent);
      });
    });

    return wsObj;
  });

  // Wrap in a callable JSObject so we can attach .prototype and static methods
  const ctor = createObject(null);
  ctor.type = 'function';
  ctor.callable = true;
  ctor.nativeFn = nativeFn.nativeFn;

  // Set prototype on constructor
  ctor.properties.set('prototype', { value: proto, writable: false, enumerable: false, configurable: false });
  ctor.properties.set('CONNECTING', { value: CONNECTING, writable: false, enumerable: false, configurable: false });
  ctor.properties.set('OPEN',       { value: OPEN,       writable: false, enumerable: false, configurable: false });
  ctor.properties.set('CLOSING',    { value: CLOSING,    writable: false, enumerable: false, configurable: false });
  ctor.properties.set('CLOSED',     { value: CLOSED,     writable: false, enumerable: false, configurable: false });

  return ctor;
}

// ── Event Emitter ─────────────────────────────────────────────────────────────

function emitEvent(wsObj: JSObject, type: string, eventObj: JSObject): void {
  // Fire the onX handler property
  const handlerProp = wsObj.properties.get(`on${type}`);
  if (handlerProp && handlerProp.value !== null && handlerProp.value !== undefined) {
    const handler = handlerProp.value as any;
    if (typeof handler === 'object' && handler !== null && 'type' in handler && handler.type === 'closure') {
      // It's a JS function object
      try {
        callJSFunction(handler, wsObj, [eventObj]);
      } catch (err) {
        console.error(`[WebSocket] on${type} handler threw:`, err);
      }
    }
  }

  // Fire addEventListener handlers
  const handlers = wsObj.__wsEventHandlers?.get(type);
  if (handlers) {
    for (const handler of handlers) {
      try {
        callJSFunction(handler, wsObj, [eventObj]);
      } catch (err) {
        console.error(`[WebSocket] ${type} handler threw:`, err);
      }
    }
  }
}

function createCloseEvent(code: number, reason: string, wasClean: boolean): JSObject {
  const e = createEventObject('close');
  e.properties.set('code',      { value: code,      writable: false, enumerable: true, configurable: false });
  e.properties.set('reason',    { value: reason,    writable: false, enumerable: true, configurable: false });
  e.properties.set('wasClean',  { value: wasClean,  writable: false, enumerable: true, configurable: false });
  return e;
}

// ── DOMException polyfill ─────────────────────────────────────────────────────

class DOMException extends Error {
  constructor(message?: string, name?: string) {
    super(message);
    this.name = name ?? 'DOMException';
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export { setPlatformWebSocketFactory, emitEvent, createCloseEvent, createMessageEvent };
