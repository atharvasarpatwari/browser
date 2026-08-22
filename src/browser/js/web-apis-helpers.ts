/**
 * @file src/browser/js/web-apis-helpers.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared helpers used across the extracted Web API modules
 * (web-apis-wasm, web-apis-gpu, web-apis-xr).
 *
 * - createPromiseLike: wraps a native value in a JSObject with .then/.catch
 * - toJSValueShallow: converts a plain native value into a JSValue
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createObject, createNativeFunction,
  callJSFunction,
} from './values';
import type { JSValue, JSObject, JSFunction } from './values';

function createPromiseLike(value: unknown): JSObject {
  const normalized = toJSValueShallow(value);
  const p = createObject(null);
  p.properties.set('then', {
    value: createNativeFunction('then', (_t, a) => {
      const onFulfilled = a[0];
      if (onFulfilled !== undefined && onFulfilled !== null) {
        if (typeof onFulfilled === 'function') {
          (onFulfilled as (value: unknown) => void)(normalized);
        } else if (typeof onFulfilled === 'object' && ((onFulfilled as JSFunction).type === 'closure' || (onFulfilled as JSFunction).isNative)) {
          const fn = onFulfilled as JSFunction;
          if (fn.isNative) {
            callJSFunction(fn, normalized, []);
          } else {
            callJSFunction(fn, undefined, [normalized]);
          }
        }
      }
      return createPromiseLike(undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });
  p.properties.set('catch', {
    value: createNativeFunction('catch', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  return p;
}

/** Convert a native value (possibly a plain object literal) into a JSValue. */
function toJSValueShallow(val: unknown): JSValue {
  if (val === null || val === undefined
    || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string' || typeof val === 'bigint') {
    return val as JSValue;
  }
  if (typeof val === 'object') {
    const asObj = val as Record<string, unknown>;
    if ('properties' in asObj && typeof (asObj as unknown as JSObject).properties?.get === 'function') return val as JSValue;
    const obj = createObject(null);
    for (const [k, v] of Object.entries(asObj)) {
      obj.properties.set(k, { value: toJSValueShallow(v), writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }
  return undefined;
}

export { createPromiseLike, toJSValueShallow };
