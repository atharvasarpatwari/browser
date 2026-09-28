/**
 * Real JS-engine bindings for the previously-unreachable permission-gated
 * Web APIs (navigator.geolocation, window.Notification, navigator.clipboard).
 * All the actual permission/prompt/state logic already lives in the
 * well-tested `PermissionGatedWebApis` facade — this file is purely the glue
 * that exposes it to interpreted page scripts, plus the two small
 * engine-supplied backends (position, clipboard) that facade needs.
 */
import { createObject, createNativeFunction, toString, toNumber, callJSFunction, setGlobalCaller, makeErrorObject, JSError, type JSValue, type JSObject, type JSFunction } from './values';
import { createPromiseObj, fulfillPromise, rejectPromise } from './promise';
import type { EventLoop } from './event-loop';
import {
  PermissionGatedWebApis,
  GeolocationPositionError,
  type PermissionPrompt,
  type PositionSource,
  type PositionOptions,
  type GeolocationPosition,
  type ClipboardBackend,
  type NotificationOptions,
} from '../web-apis/web-apis-permissions';

// ponytail: no real GPS/IP-geolocation on desktop — fixed default location
// (San Francisco), replace with an IP-based lookup or OS location API if
// real geolocation is ever needed.
const defaultPositionSource: PositionSource = {
  async getPosition(): Promise<GeolocationPosition> {
    return {
      coords: {
        latitude: 37.7749, longitude: -122.4194, accuracy: 100,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      },
      timestamp: Date.now(),
    };
  },
  subscribe(_options, onUpdate) {
    void this.getPosition({}).then(onUpdate);
    return () => {};
  },
};

// PageRenderer/the JS engine run in the same Electron renderer process as
// the rest of the app (no IPC boundary), so the real OS clipboard is just
// the ordinary DOM Web Clipboard API — same approach already used by the
// host chrome itself (browser-window.ts's "copy link address").
const defaultClipboardBackend: ClipboardBackend = {
  read: () => navigator.clipboard.readText(),
  write: (text: string) => navigator.clipboard.writeText(text),
};

function positionToJs(pos: GeolocationPosition): JSObject {
  const coords = createObject(null);
  for (const [k, v] of Object.entries(pos.coords)) {
    coords.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
  }
  const obj = createObject(null);
  obj.properties.set('coords', { value: coords, writable: false, enumerable: true, configurable: false });
  obj.properties.set('timestamp', { value: pos.timestamp, writable: false, enumerable: true, configurable: false });
  return obj;
}

const GEO_ERROR_CODES: Record<string, number> = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

function geoErrorToJs(err: GeolocationPositionError): JSObject {
  const obj = createObject(null);
  const code = GEO_ERROR_CODES[err.code] ?? 0;
  obj.properties.set('code', { value: code, writable: false, enumerable: true, configurable: false });
  obj.properties.set('message', { value: err.message, writable: false, enumerable: true, configurable: false });
  obj.properties.set('PERMISSION_DENIED', { value: 1, writable: false, enumerable: true, configurable: false });
  obj.properties.set('POSITION_UNAVAILABLE', { value: 2, writable: false, enumerable: true, configurable: false });
  obj.properties.set('TIMEOUT', { value: 3, writable: false, enumerable: true, configurable: false });
  return obj;
}

function parsePositionOptions(arg: JSValue): PositionOptions {
  if (typeof arg !== 'object' || arg === null) return {};
  const o = arg as JSObject;
  const get = (name: string): JSValue => o.properties.get(name)?.value;
  const opts: PositionOptions = {};
  if (get('enableHighAccuracy') !== undefined) opts.enableHighAccuracy = Boolean(get('enableHighAccuracy'));
  if (get('timeout') !== undefined) opts.timeout = toNumber(get('timeout'));
  if (get('maximumAge') !== undefined) opts.maximumAge = toNumber(get('maximumAge'));
  return opts;
}

function asCallback(arg: JSValue): JSFunction | undefined {
  return typeof arg === 'object' && arg !== null && (arg as JSFunction).type === 'closure'
    ? (arg as JSFunction)
    : undefined;
}

function setMethod(obj: JSObject, name: string, fn: (thisArg: JSValue, args: JSValue[]) => JSValue | void): void {
  obj.properties.set(name, { value: createNativeFunction(name, fn), writable: true, enumerable: true, configurable: true });
}

/**
 * Invokes a page-script callback from HOST async code (a real `await`
 * chain in this file, not the interpreter's own synchronous dispatch).
 * `_globalCaller` (values.ts) is only set for the duration of a synchronous
 * interpreter-driven call (see PageRenderer.runDispatch) — by the time a
 * real Promise here resolves, it's already been reset to null, so calling
 * an interpreted closure directly would throw "No JS interpreter
 * registered". Re-establish it just for this call, same try/finally shape
 * as runDispatch.
 */
function invokeCallback(eventLoop: EventLoop, fn: JSFunction, args: JSValue[]): void {
  const interpreter = eventLoop.getInterpreter();
  if (interpreter) setGlobalCaller(interpreter);
  try {
    callJSFunction(fn, undefined, args);
  } finally {
    if (interpreter) setGlobalCaller(null);
  }
}

/** Settles a bridged Promise from host async code, then drains the page's
 *  microtask queue so any `.then()`/`await` reactions the script attached
 *  actually run — nothing else does this for a promise settled outside the
 *  interpreter's own synchronous dispatch cycle. */
function settle(eventLoop: EventLoop, promise: JSObject, ok: boolean, value: JSValue): void {
  if (ok) fulfillPromise(promise, value);
  else rejectPromise(promise, value);
  eventLoop.drainMicrotasks();
}

export function createGeolocationObject(webApis: PermissionGatedWebApis, eventLoop: EventLoop): JSObject {
  const geo = webApis.geolocation;
  const obj = createObject(null);

  setMethod(obj, 'getCurrentPosition', (_this, args) => {
    const onSuccess = asCallback(args[0]);
    const onError = asCallback(args[1]);
    const options = parsePositionOptions(args[2]);
    void geo.getCurrentPosition(
      (pos) => { if (onSuccess) invokeCallback(eventLoop, onSuccess, [positionToJs(pos)]); },
      (err) => { if (onError) invokeCallback(eventLoop, onError, [geoErrorToJs(err)]); },
      options,
    );
  });

  setMethod(obj, 'watchPosition', (_this, args) => {
    const onSuccess = asCallback(args[0]);
    const onError = asCallback(args[1]);
    const options = parsePositionOptions(args[2]);
    // watchPosition() is itself async (it awaits the permission prompt
    // before returning a real watch id) — real browsers return the id
    // synchronously, so callers assign it in a microtask window matching
    // how the id is used (only ever passed back into clearWatch later).
    let watchId = 0;
    const pending = geo.watchPosition(
      (pos) => { if (onSuccess) invokeCallback(eventLoop, onSuccess, [positionToJs(pos)]); },
      (err) => { if (onError) invokeCallback(eventLoop, onError, [geoErrorToJs(err)]); },
      options,
    );
    void pending.then((id) => { watchId = id; });
    return watchId;
  });

  setMethod(obj, 'clearWatch', (_this, args) => {
    geo.clearWatch(toNumber(args[0]));
  });

  return obj;
}

export function createClipboardObject(webApis: PermissionGatedWebApis, eventLoop: EventLoop): JSObject {
  const clipboard = webApis.clipboard;
  const obj = createObject(null);

  setMethod(obj, 'readText', () => {
    const p = createPromiseObj(eventLoop);
    clipboard.readText().then(
      (text) => settle(eventLoop, p, true, text),
      (err) => settle(eventLoop, p, false, makeErrorObject('Error', err instanceof Error ? err.message : String(err))),
    );
    return p;
  });

  setMethod(obj, 'writeText', (_this, args) => {
    const p = createPromiseObj(eventLoop);
    clipboard.writeText(toString(args[0])).then(
      () => settle(eventLoop, p, true, undefined),
      (err) => settle(eventLoop, p, false, makeErrorObject('Error', err instanceof Error ? err.message : String(err))),
    );
    return p;
  });

  return obj;
}

function parseNotificationOptions(arg: JSValue): NotificationOptions {
  if (typeof arg !== 'object' || arg === null) return {};
  const o = arg as JSObject;
  const get = (name: string): JSValue => o.properties.get(name)?.value;
  const options: NotificationOptions = {};
  if (get('body') !== undefined) options.body = toString(get('body'));
  if (get('icon') !== undefined) options.icon = toString(get('icon'));
  if (get('tag') !== undefined) options.tag = toString(get('tag'));
  if (get('silent') !== undefined) options.silent = Boolean(get('silent'));
  if (get('data') !== undefined) options.data = get('data');
  return options;
}

/** Wraps a (possibly null — permission never requested) NotificationInstance as a JS object. */
function wrapNotificationInstance(instance: ReturnType<PermissionGatedWebApis['notifications']['create']>, title: string, options: NotificationOptions, eventLoop: EventLoop): JSObject {
  const obj = createObject(null);
  obj.properties.set('title', { value: title, writable: false, enumerable: true, configurable: false });
  obj.properties.set('body', { value: options.body ?? '', writable: false, enumerable: true, configurable: false });
  obj.properties.set('tag', { value: options.tag ?? '', writable: false, enumerable: true, configurable: false });

  setMethod(obj, 'close', () => { instance?.close(); });
  setMethod(obj, 'addEventListener', (_this, args) => {
    const type = toString(args[0]);
    const handler = asCallback(args[1]);
    if (!handler || !instance) return;
    if (type === 'show' || type === 'click' || type === 'close' || type === 'error') {
      instance.on(type, () => invokeCallback(eventLoop, handler, [obj]));
    }
  });
  return obj;
}

export function createNotificationCtor(webApis: PermissionGatedWebApis, eventLoop: EventLoop): JSObject {
  const notifications = webApis.notifications;
  const ctor = createObject(null);
  // evalNew()'s "callable JSObject" constructor dispatch (interpreter.ts,
  // matching how `new Promise(...)` is constructed) reads .callable/.nativeFn
  // as DIRECT fields on the JSObject, not as entries in its .properties Map
  // — those are two separate things: .properties is what interpreted script
  // sees via normal property access, these direct fields are what `new`
  // itself inspects to decide how to construct.
  ctor.callable = true;
  ctor.nativeFn = (_this, args) => {
    const title = toString(args[0]);
    const options = parseNotificationOptions(args[1]);
    try {
      const instance = notifications.create(title, options);
      return wrapNotificationInstance(instance, title, options, eventLoop);
    } catch (err) {
      throw new JSError(makeErrorObject('Error', err instanceof Error ? err.message : String(err)));
    }
  };
  ctor.properties.set('nativeFn', {
    value: createNativeFunction('Notification', ctor.nativeFn),
    writable: false, enumerable: false, configurable: false,
  });

  setMethod(ctor, 'requestPermission', () => {
    const p = createPromiseObj(eventLoop);
    notifications.requestPermission().then((perm) => settle(eventLoop, p, true, perm));
    return p;
  });

  ctor.properties.set('permission', {
    value: notifications.permission(),
    writable: false, enumerable: true, configurable: false,
    getter: createNativeFunction('get permission', () => notifications.permission()),
  });

  return ctor;
}

export interface PermissionApiBindings {
  geolocation: JSObject;
  notifications: JSObject;
  clipboard: JSObject;
}

/**
 * Builds one PermissionGatedWebApis for this page load and returns the 3
 * JS-engine-bindable objects for it. Vibration is deliberately not wired
 * here — navigator.vibrate is already a correct hardcoded no-op (desktop
 * has no vibration hardware), so this facade's VibrationAPI goes unused.
 */
export function createPermissionApiBindings(
  eventLoop: EventLoop,
  origin: string,
  isSecureContext: boolean,
  promptUser?: PermissionPrompt,
): PermissionApiBindings {
  const webApis = new PermissionGatedWebApis({
    origin,
    promptUser: promptUser ?? (async () => 'denied'),
    positionSource: defaultPositionSource,
    clipboardBackend: defaultClipboardBackend,
    vibrationBackend: { vibrate: () => {}, cancel: () => {} },
    isSecureContext,
  });

  return {
    geolocation: createGeolocationObject(webApis, eventLoop),
    notifications: createNotificationCtor(webApis, eventLoop),
    clipboard: createClipboardObject(webApis, eventLoop),
  };
}
