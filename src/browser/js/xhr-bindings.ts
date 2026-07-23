import type { JSValue, JSObject, JSFunction } from './values';
import { createObject, createNativeFunction, toString } from './values';

const eventListeners = new WeakMap<JSObject, Map<string, Set<JSFunction>>>();

function getListeners(obj: JSObject): Map<string, Set<JSFunction>> {
  let map = eventListeners.get(obj);
  if (!map) {
    map = new Map();
    eventListeners.set(obj, map);
  }
  return map;
}

function createEventObject(type: string, target: JSObject): JSObject {
  const evt = createObject(null);
  evt.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  evt.properties.set('target', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('currentTarget', { value: target, writable: false, enumerable: true, configurable: false });
  evt.properties.set('bubbles', { value: false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('cancelable', { value: false, writable: false, enumerable: true, configurable: false });
  evt.properties.set('timeStamp', { value: Date.now(), writable: false, enumerable: true, configurable: false });
  return evt;
}

export function createEventDispatcher(obj: JSObject): void {
  const listeners = getListeners(obj);

  obj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1];
      if (fn === undefined || fn === null) return undefined;
      const isCallable = typeof fn === 'function' || (typeof fn === 'object' && fn !== null && 'nativeFn' in fn);
      if (!isCallable) return undefined;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const type = toString(args[0]);
      const fn = args[1];
      const set = listeners.get(type);
      if (set) set.delete(fn as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  obj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_this, args) => {
      const evtObj = args[0] as JSObject;
      if (!evtObj || typeof evtObj !== 'object') return true;
      const type = toString(evtObj.properties.get('type')?.value ?? '');
      const set = listeners.get(type);
      if (set) {
        for (const fn of set) {
          try { invokeJSFunction(fn, obj, [evtObj]); } catch { /* swallow */ }
        }
      }
      const onProp = obj.properties.get('on' + type);
      if (onProp) {
        try { invokeJSFunction(onProp.value, obj, [evtObj]); } catch { /* swallow */ }
      }
      return true;
    }),
    writable: true, enumerable: true, configurable: true,
  });
}

function invokeJSFunction(fn: unknown, thisArg: JSValue, args: JSValue[]): void {
  if (typeof fn === 'function') {
    fn(thisArg, args);
  } else if (fn && typeof fn === 'object' && 'nativeFn' in fn && typeof (fn as JSFunction).nativeFn === 'function') {
    (fn as JSFunction).nativeFn!(thisArg, args);
  }
}

export function fireEvent(obj: JSObject, type: string, eventObj?: JSObject): void {
  const evt = eventObj ?? createEventObject(type, obj);
  const set = getListeners(obj).get(type);
  if (set) {
    for (const fn of set) {
      try { invokeJSFunction(fn, obj, [evt]); } catch { /* swallow */ }
    }
  }
  const onProp = obj.properties.get('on' + type);
  if (onProp) {
    try { invokeJSFunction(onProp.value, obj, [evt]); } catch { /* swallow */ }
  }
}

export function clearEventListeners(obj: JSObject): void {
  eventListeners.delete(obj);
}
