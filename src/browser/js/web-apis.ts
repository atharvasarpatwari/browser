/**
 * @file src/browser/js/web-apis.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Standard Web APIs for the Nova JS engine's global environment:
 *
 * - Web Crypto API (crypto.getRandomValues, crypto.randomUUID, crypto.subtle)
 * - BroadcastChannel (cross-tab / cross-context messaging)
 * - Custom Elements (customElements.define/get/getName/upgrade)
 * - Fullscreen API (requestFullscreen, exitFullscreen, fullscreenchange/error)
 * - Streams API (ReadableStream, WritableStream, TransformStream)
 * - Performance API (performance.mark, performance.measure, getEntries)
 * - PerformanceObserver
 * - Selection API (window.getSelection, Selection)
 * - ResizeObserver (constructor wired to global)
 * - MessageChannel / MessagePort (cross-context messaging)
 * - Touch events (TouchEvent, Touch, TouchList)
 * - DragEvent
 * - Web Animations API (Element.animate, KeyframeEffect, Animation)
 * - TreeWalker / NodeIterator / Range (wired to global)
 * - navigator.vibrate()
 * - document.elementFromPoint / elementsFromPoint
 * - WebAssembly (Module, Instance, Memory, Table, Global, compile, instantiate, validate)
 * - WebGPU (GPU, GPUAdapter, GPUDevice, GPUBuffer, GPUTexture, GPURenderPipeline)
 * - WebXR (XRSystem, XRSession, XRFrame, XRReferenceSpace, XRView)
 * - View Transitions (document.startViewTransition)
 * - Navigation API (Navigation, NavigationDestination, NavigationTransition)
 * - Compression Streams (CompressionStream, DecompressionStream)
 * - Scheduler API (scheduler.postTask, scheduler.yield)
 * - Shared Storage API (sharedStorage, SharedStorage)
 * - Fenced Frames (FencedFrameConfig, HTMLFencedFrameElement)
 * - AI APIs (AITextSession, AILanguageModel, AILanguageModelFactory)
 * - Speculation Rules (HTMLSpeculationRulesElement, SpeculationRules)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  createObject, createArray, createNativeFunction,
  toString, toNumber, toBoolean,
  callJSFunction,
} from './values';
import type { JSValue, JSObject, JSFunction, JSObjectWithMeta } from './values';
import {
  createWebAssemblyObject, createWebAssemblyModuleStatic,
  createWebAssemblyInstanceConstructor, createWebAssemblyMemoryConstructor,
  createWebAssemblyTableConstructor, createWebAssemblyGlobalConstructor,
  createWebAssemblyTagConstructor, createWebAssemblyExceptionConstructor,
} from './web-apis-wasm';
import { createGPUObject } from './web-apis-gpu';
import { createXRSystemObject } from './web-apis-xr';

export {
  createWebAssemblyObject, createWebAssemblyModuleStatic,
  createWebAssemblyInstanceConstructor, createWebAssemblyMemoryConstructor,
  createWebAssemblyTableConstructor, createWebAssemblyGlobalConstructor,
  createWebAssemblyTagConstructor, createWebAssemblyExceptionConstructor,
} from './web-apis-wasm';
export { createGPUObject } from './web-apis-gpu';
export { createXRSystemObject } from './web-apis-xr';

// Node-only crypto helpers with a browser (Web Crypto) fallback so this module
// can load under Vite without triggering the node:crypto externalization error.
function getRandomBytes(len: number): Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.randomBytes(len);
  } catch {
    const out = new Uint8Array(len);
    globalThis.crypto.getRandomValues(out);
    return out;
  }
}

function getRandomUUID(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.randomUUID();
  } catch {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WEAK MAPS for cross-instance state
// ─────────────────────────────────────────────────────────────────────────────

/** WeakMap keyed by native event target objects → listeners array */
const listenerMap = new WeakMap<JSObject, Array<{ type: string; fn: JSFunction; options: any }>>();

/** Interface for native JS TypedArrays from the host */
interface NativeTypedArrayLike {
  length: number;
  BYTES_PER_ELEMENT: number;
  [index: number]: number;
}

function getListeners(target: JSObject) {
  let list = listenerMap.get(target);
  if (!list) { list = []; listenerMap.set(target, list); }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB CRYPTO API
// ─────────────────────────────────────────────────────────────────────────────

export function createCryptoObject() {
  const cryptoObj = createObject(null);

  // crypto.getRandomValues(typedArray)
  cryptoObj.properties.set('getRandomValues', {
    value: createNativeFunction('getRandomValues', (_this, args) => {
      const typedArray = args[0];
      if (typeof typedArray !== 'object' || typedArray === null) {
        throw new TypeError('Argument must be a TypedArray');
      }
      // Handle native TypedArrays (real JS TypedArrays passed from host)
      const nativeTA = typedArray as unknown as NativeTypedArrayLike;
      if (typeof nativeTA.length === 'number' && typeof nativeTA.BYTES_PER_ELEMENT === 'number') {
        const len = nativeTA.length;
        const bytes = getRandomBytes(len);
        for (let i = 0; i < len; i++) nativeTA[i] = bytes[i];
        return typedArray;
      }
      // Handle JSObject-wrapped TypedArrays
      const obj = typedArray as JSObject;
      const lenProp = obj.properties.get('length');
      if (!lenProp) throw new TypeError('Argument must be a TypedArray');
      const len = Number(lenProp.value);
      const bytes = getRandomBytes(len);
      for (let i = 0; i < len; i++) {
        const existing = obj.properties.get(String(i));
        if (existing) {
          obj.properties.set(String(i), { value: bytes[i], writable: true, enumerable: true, configurable: true });
        }
      }
      return typedArray;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // crypto.randomUUID()
  cryptoObj.properties.set('randomUUID', {
    value: createNativeFunction('randomUUID', () => getRandomUUID()),
    writable: true, enumerable: true, configurable: true,
  });

  // SubtleCrypto stub (methods return rejected promises for unsupported ops)
  const subtleObj = createObject(null);
  const subtleMethods = [
    'encrypt', 'decrypt', 'sign', 'verify', 'digest',
    'generateKey', 'deriveKey', 'deriveBits',
    'importKey', 'exportKey', 'wrapKey', 'unwrapKey',
  ];
  for (const method of subtleMethods) {
    subtleObj.properties.set(method, {
      value: createNativeFunction(method, (_this, _args) => {
        const rejectObj = createObject(null);
        rejectObj.properties.set('then', {
          value: createNativeFunction('then', (_t, a) => {
            const onRejected = a[1];
            if (typeof onRejected === 'object' && onRejected !== null && (onRejected as JSFunction).type === 'closure') {
              callJSFunction(onRejected as JSFunction, undefined, [
                createNativeFunction('error', () => undefined),
              ]);
            }
            return rejectObj;
          }),
          writable: true, enumerable: true, configurable: true,
        });
        return rejectObj;
      }),
      writable: true, enumerable: true, configurable: true,
    });
  }
  cryptoObj.properties.set('subtle', { value: subtleObj, writable: false, enumerable: true, configurable: false });

  return cryptoObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// BROADCAST CHANNEL
// ─────────────────────────────────────────────────────────────────────────────

/** Shared channel registry for cross-tab messaging */
const broadcastChannels = new Map<string, Set<JSObject>>();

export function createBroadcastChannelConstructor() {
  return createNativeFunction('BroadcastChannel', (_this, args) => {
    const name = toString(args[0] ?? '');
    const channelObj = createObject(null);
    (channelObj as JSObjectWithMeta).__type_override = 'broadcastchannel';
    (channelObj as JSObjectWithMeta).__channelName = name;
    (channelObj as JSObjectWithMeta).__listeners = [] as Array<{ type: string; fn: JSFunction }>;
    (channelObj as JSObjectWithMeta).__closed = false;

    channelObj.properties.set('name', { value: name, writable: false, enumerable: true, configurable: false });
    channelObj.properties.set('onmessage', { value: undefined, writable: true, enumerable: true, configurable: true });
    channelObj.properties.set('onmessageerror', { value: undefined, writable: true, enumerable: true, configurable: true });

    // Register in shared set
    let set = broadcastChannels.get(name);
    if (!set) { set = new Set(); broadcastChannels.set(name, set); }
    set.add(channelObj);

    // postMessage — posts to all other channels with same name
    channelObj.properties.set('postMessage', {
      value: createNativeFunction('postMessage', (_t, a) => {
        if ((channelObj as JSObjectWithMeta).__closed) return undefined;
        const msg = a[0];
        const targetSet = broadcastChannels.get(name);
        if (!targetSet) return undefined;

        const cloned = deepCloneJS(msg);
        for (const ch of targetSet) {
          if (ch === channelObj) continue;
          const onmsg = ch.properties.get('onmessage')?.value;
          if (typeof onmsg === 'object' && onmsg !== null && (onmsg as JSFunction).type === 'closure') {
            const evObj = createObject(null);
            evObj.properties.set('data', { value: cloned, writable: false, enumerable: true, configurable: false });
            evObj.properties.set('origin', { value: '', writable: false, enumerable: true, configurable: false });
            evObj.properties.set('source', { value: channelObj, writable: false, enumerable: true, configurable: false });
            callJSFunction(onmsg as JSFunction, ch, [evObj]);
          }
        }
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // close — removes from shared set
    channelObj.properties.set('close', {
      value: createNativeFunction('close', () => {
        (channelObj as JSObjectWithMeta).__closed = true;
        const targetSet = broadcastChannels.get(name);
        if (targetSet) targetSet.delete(channelObj);
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // addEventListener / removeEventListener / dispatchEvent
    channelObj.properties.set('addEventListener', {
      value: createNativeFunction('addEventListener', (_t, a) => {
        const type = toString(a[0]);
        const fn = a[1] as JSFunction;
        ((channelObj as JSObjectWithMeta).__listeners ??= []).push({ type, fn });
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    channelObj.properties.set('removeEventListener', {
      value: createNativeFunction('removeEventListener', (_t, a) => {
        const type = toString(a[0]);
        const fn = a[1];
        const list = (channelObj as JSObjectWithMeta).__listeners ?? [];
        (channelObj as JSObjectWithMeta).__listeners = list.filter((l) => !(l.type === type && l.fn === fn));
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    channelObj.properties.set('dispatchEvent', {
      value: createNativeFunction('dispatchEvent', (_t, a) => {
        const ev = a[0] as JSObject;
        const type = toString(ev.properties.get('type')?.value ?? '');
        const list = (channelObj as JSObjectWithMeta).__listeners ?? [];
        for (const l of list) {
          if (l.type === type) callJSFunction(l.fn, channelObj, [ev]);
        }
        return true;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    return channelObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────

export function createCustomElementsObject() {
  const registry = new Map<string, JSFunction>();
  const obj = createObject(null);
  obj.properties.set('define', {
    value: createNativeFunction('define', (_this, args) => {
      const name = toString(args[0]);
      const ctor = args[1];
      if (typeof ctor !== 'object' || ctor === null || (ctor as JSObject).type !== 'function') {
        throw new TypeError('Custom element constructor must be a function');
      }
      registry.set(name, ctor as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      const name = toString(args[0]);
      return registry.get(name) ?? undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('getName', {
    value: createNativeFunction('getName', (_this, args) => {
      const ctor = args[0];
      if (typeof ctor === 'object' && ctor !== null) {
        for (const [name, fn] of registry) {
          if (fn === ctor) return name;
        }
      }
      return '';
    }),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('upgrade', {
    value: createNativeFunction('upgrade', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  obj.properties.set('whenDefined', {
    value: createNativeFunction('whenDefined', (_this, args) => {
      const name = toString(args[0]);
      const p = createObject(null);
      p.type = 'function';
      p.callable = true;
      p.nativeFn = (_t: unknown, a: unknown[]) => {
        const onFulfilled = a[0];
        if (typeof onFulfilled === 'object' && onFulfilled !== null && (onFulfilled as JSFunction).type === 'closure') {
          callJSFunction(onFulfilled as JSFunction, undefined, [undefined]);
        }
        return p;
      };
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return obj;
}

// ─────────────────────────────────────────────────────────────────────────────
// FULLSCREEN API
// ─────────────────────────────────────────────────────────────────────────────

export function createFullscreenAPIMethods() {
  const fullscreenElement = { current: undefined as JSValue | undefined };
  const fullscreenChangeCallbacks: JSFunction[] = [];

  const requestFullscreen = createNativeFunction('requestFullscreen', (_this) => {
    fullscreenElement.current = _this;
    for (const cb of fullscreenChangeCallbacks) {
      try { callJSFunction(cb, undefined, []); } catch { /* swallow */ }
    }
    return undefined;
  });

  const exitFullscreen = createNativeFunction('exitFullscreen', () => {
    fullscreenElement.current = undefined;
    for (const cb of fullscreenChangeCallbacks) {
      try { callJSFunction(cb, undefined, []); } catch { /* swallow */ }
    }
    return undefined;
  });

  const isFullscreen = createNativeFunction('fullscreenElement', () => fullscreenElement.current ?? undefined);

  return { requestFullscreen, exitFullscreen, fullscreenElement: isFullscreen, fullscreenChangeCallbacks };
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMS API
// ─────────────────────────────────────────────────────────────────────────────

export function createReadableStreamConstructor() {
  return createNativeFunction('ReadableStream', (_this, args) => {
    const underlyingSource = args[0] as JSObject | undefined;
    const streamObj = createObject(null);
    (streamObj as JSObjectWithMeta).__type_override = 'readablestream';
    (streamObj as JSObjectWithMeta).__chunks = [] as JSValue[];
    (streamObj as JSObjectWithMeta).__closed = false;
    (streamObj as JSObjectWithMeta).__underlyingSource = underlyingSource;

    streamObj.properties.set('locked', { value: false, writable: false, enumerable: true, configurable: false });

    // getReader()
    streamObj.properties.set('getReader', {
      value: createNativeFunction('getReader', () => {
        const readerObj = createObject(null);
        (readerObj as JSObjectWithMeta).__type_override = 'readablereader';
        readerObj.properties.set('read', {
          value: createNativeFunction('read', () => {
            const chunks = (streamObj as JSObjectWithMeta).__chunks ?? [];
            if (chunks.length > 0) {
              const value = chunks.shift() as JSValue;
              const result = createObject(null);
              result.properties.set('value', { value, writable: true, enumerable: true, configurable: true });
              result.properties.set('done', { value: false, writable: true, enumerable: true, configurable: true });
              return result;
            }
            const result = createObject(null);
            result.properties.set('value', { value: undefined, writable: true, enumerable: true, configurable: true });
            result.properties.set('done', { value: true, writable: true, enumerable: true, configurable: true });
            return result;
          }),
          writable: true, enumerable: true, configurable: true,
        });
        readerObj.properties.set('cancel', {
          value: createNativeFunction('cancel', () => { (streamObj as JSObjectWithMeta).__closed = true; return undefined; }),
          writable: true, enumerable: true, configurable: true,
        });
        readerObj.properties.set('releaseLock', {
          value: createNativeFunction('releaseLock', () => undefined),
          writable: true, enumerable: true, configurable: true,
        });
        return readerObj;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // pipeTo / pipeThrough (stubs)
    streamObj.properties.set('pipeTo', {
      value: createNativeFunction('pipeTo', () => createPromiseLike(undefined)),
      writable: true, enumerable: true, configurable: true,
    });
    streamObj.properties.set('pipeThrough', {
      value: createNativeFunction('pipeThrough', (_t, a) => a[0] ?? createObject(null)),
      writable: true, enumerable: true, configurable: true,
    });
    streamObj.properties.set('cancel', {
      value: createNativeFunction('cancel', () => { (streamObj as JSObjectWithMeta).__closed = true; return createPromiseLike(undefined); }),
      writable: true, enumerable: true, configurable: true,
    });
    streamObj.properties.set('tee', {
      value: createNativeFunction('tee', () => createArray([createObject(null), createObject(null)])),
      writable: true, enumerable: true, configurable: true,
    });

    // Enqueue chunks from underlyingSource.start
    if (underlyingSource && typeof underlyingSource === 'object') {
      const start = underlyingSource.properties.get('start');
      if (start && typeof start.value === 'object' && (start.value as JSFunction).type === 'closure') {
        const controllerObj = createObject(null);
        controllerObj.properties.set('enqueue', {
          value: createNativeFunction('enqueue', (_t, a) => { ((streamObj as JSObjectWithMeta).__chunks ??= []).push(a[0]); return undefined; }),
          writable: true, enumerable: true, configurable: true,
        });
        controllerObj.properties.set('close', {
          value: createNativeFunction('close', () => { (streamObj as JSObjectWithMeta).__closed = true; return undefined; }),
          writable: true, enumerable: true, configurable: true,
        });
        controllerObj.properties.set('error', {
          value: createNativeFunction('error', () => undefined),
          writable: true, enumerable: true, configurable: true,
        });
        try { callJSFunction(start.value as JSFunction, undefined, [controllerObj]); } catch { /* swallow */ }
      }
    }

    return streamObj;
  });
}

export function createWritableStreamConstructor() {
  return createNativeFunction('WritableStream', (_this, args) => {
    const streamObj = createObject(null);
    (streamObj as JSObjectWithMeta).__type_override = 'writablestream';
    streamObj.properties.set('locked', { value: false, writable: false, enumerable: true, configurable: false });
    streamObj.properties.set('abort', {
      value: createNativeFunction('abort', () => createPromiseLike(undefined)),
      writable: true, enumerable: true, configurable: true,
    });
    streamObj.properties.set('close', {
      value: createNativeFunction('close', () => createPromiseLike(undefined)),
      writable: true, enumerable: true, configurable: true,
    });
    streamObj.properties.set('getWriter', {
      value: createNativeFunction('getWriter', () => {
        const writerObj = createObject(null);
        writerObj.properties.set('write', {
          value: createNativeFunction('write', () => createPromiseLike(undefined)),
          writable: true, enumerable: true, configurable: true,
        });
        writerObj.properties.set('close', {
          value: createNativeFunction('close', () => createPromiseLike(undefined)),
          writable: true, enumerable: true, configurable: true,
        });
        writerObj.properties.set('abort', {
          value: createNativeFunction('abort', () => createPromiseLike(undefined)),
          writable: true, enumerable: true, configurable: true,
        });
        writerObj.properties.set('releaseLock', {
          value: createNativeFunction('releaseLock', () => undefined),
          writable: true, enumerable: true, configurable: true,
        });
        return writerObj;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    return streamObj;
  });
}

export function createTransformStreamConstructor() {
  return createNativeFunction('TransformStream', (_this, args) => {
    const streamObj = createObject(null);
    (streamObj as JSObjectWithMeta).__type_override = 'transformstream';
    streamObj.properties.set('readable', { value: createObject(null), writable: true, enumerable: true, configurable: true });
    streamObj.properties.set('writable', { value: createObject(null), writable: true, enumerable: true, configurable: true });
    return streamObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE API
// ─────────────────────────────────────────────────────────────────────────────

export function createPerformanceObject() {
  const perfObj = createObject(null);
  const marks = new Map<string, number>();
  const measures = new Map<string, number>();
  const entries: Array<{ name: string; entryType: string; startTime: number; duration: number }> = [];

  perfObj.properties.set('now', {
    value: createNativeFunction('now', () => performance.now()),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('mark', {
    value: createNativeFunction('mark', (_this, args) => {
      const name = toString(args[0] ?? '');
      const t = performance.now();
      marks.set(name, t);
      entries.push({ name, entryType: 'mark', startTime: t, duration: 0 });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('measure', {
    value: createNativeFunction('measure', (_this, args) => {
      const name = toString(args[0] ?? '');
      const startMark = toString(args[1] ?? '');
      const endMark = toString(args[2] ?? '');
      const start = marks.get(startMark) ?? performance.now();
      const end = marks.get(endMark) ?? performance.now();
      const dur = end - start;
      measures.set(name, dur);
      entries.push({ name, entryType: 'measure', startTime: start, duration: dur });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('getEntries', {
    value: createNativeFunction('getEntries', () => {
      return createArray(entries.map(e => {
        const obj = createObject(null);
        obj.properties.set('name', { value: e.name, writable: true, enumerable: true, configurable: true });
        obj.properties.set('entryType', { value: e.entryType, writable: true, enumerable: true, configurable: true });
        obj.properties.set('startTime', { value: e.startTime, writable: true, enumerable: true, configurable: true });
        obj.properties.set('duration', { value: e.duration, writable: true, enumerable: true, configurable: true });
        return obj;
      }));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('getEntriesByName', {
    value: createNativeFunction('getEntriesByName', (_this, args) => {
      const name = toString(args[0] ?? '');
      const filtered = entries.filter(e => e.name === name);
      return createArray(filtered.map(e => {
        const obj = createObject(null);
        obj.properties.set('name', { value: e.name, writable: true, enumerable: true, configurable: true });
        obj.properties.set('entryType', { value: e.entryType, writable: true, enumerable: true, configurable: true });
        obj.properties.set('startTime', { value: e.startTime, writable: true, enumerable: true, configurable: true });
        obj.properties.set('duration', { value: e.duration, writable: true, enumerable: true, configurable: true });
        return obj;
      }));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('getEntriesByType', {
    value: createNativeFunction('getEntriesByType', (_this, args) => {
      const type = toString(args[0] ?? '');
      const filtered = entries.filter(e => e.entryType === type);
      return createArray(filtered.map(e => {
        const obj = createObject(null);
        obj.properties.set('name', { value: e.name, writable: true, enumerable: true, configurable: true });
        obj.properties.set('entryType', { value: e.entryType, writable: true, enumerable: true, configurable: true });
        obj.properties.set('startTime', { value: e.startTime, writable: true, enumerable: true, configurable: true });
        obj.properties.set('duration', { value: e.duration, writable: true, enumerable: true, configurable: true });
        return obj;
      }));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('clearMarks', {
    value: createNativeFunction('clearMarks', (_this, args) => {
      const name = args[0] !== undefined ? toString(args[0]) : undefined;
      if (name) {
        marks.delete(name);
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].name === name && entries[i].entryType === 'mark') entries.splice(i, 1);
        }
      } else {
        marks.clear();
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].entryType === 'mark') entries.splice(i, 1);
        }
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('clearMeasures', {
    value: createNativeFunction('clearMeasures', (_this, args) => {
      const name = args[0] !== undefined ? toString(args[0]) : undefined;
      if (name) {
        measures.delete(name);
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].name === name && entries[i].entryType === 'measure') entries.splice(i, 1);
        }
      } else {
        measures.clear();
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].entryType === 'measure') entries.splice(i, 1);
        }
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  perfObj.properties.set('clearResourceTimings', {
    value: createNativeFunction('clearResourceTimings', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });

  return perfObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

export function createPerformanceObserverConstructor() {
  return createNativeFunction('PerformanceObserver', (_this, args) => {
    const callback = args[0] as JSFunction;
    const observerObj = createObject(null);

    observerObj.properties.set('observe', {
      value: createNativeFunction('observe', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });
    observerObj.properties.set('disconnect', {
      value: createNativeFunction('disconnect', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });
    observerObj.properties.set('takeRecords', {
      value: createNativeFunction('takeRecords', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });

    return observerObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM TREE HELPERS (for Range and Selection API)
// ─────────────────────────────────────────────────────────────────────────────

function domGetParent(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  const p = (node as JSObject).properties.get('parentNode')?.value;
  return (typeof p === 'object' && p !== null) ? p as JSObject : null;
}

function domGetChildNodes(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  return (node as JSObject).properties.get('childNodes')?.value as JSObject ?? null;
}

function domGetFirstChild(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  return (node as JSObject).properties.get('firstChild')?.value as JSObject ?? null;
}

function domGetLastChild(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  return (node as JSObject).properties.get('lastChild')?.value as JSObject ?? null;
}

function domGetNextSibling(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  return (node as JSObject).properties.get('nextSibling')?.value as JSObject ?? null;
}

function domGetPreviousSibling(node: JSValue): JSObject | null {
  if (typeof node !== 'object' || node === null) return null;
  return (node as JSObject).properties.get('previousSibling')?.value as JSObject ?? null;
}

function domGetNodeType(node: JSValue): string {
  if (typeof node !== 'object' || node === null) return '';
  const v = (node as JSObject).properties.get('nodeType')?.value;
  return typeof v === 'string' ? v : '';
}

function domGetTextContent(node: JSValue): string {
  if (typeof node !== 'object' || node === null) return '';
  const obj = node as JSObject;
  const tc = obj.properties.get('textContent')?.value;
  if (typeof tc === 'string') return tc;
  const data = obj.properties.get('data')?.value;
  if (typeof data === 'string') return data;
  const text = obj.properties.get('text')?.value;
  if (typeof text === 'string') return text;
  return '';
}

function domSetTextContent(node: JSValue, text: string): void {
  if (typeof node !== 'object' || node === null) return;
  const obj = node as JSObject;
  const tcProp = obj.properties.get('textContent');
  if (tcProp) {
    obj.properties.set('textContent', { value: text, writable: true, enumerable: true, configurable: true });
  }
  const dataProp = obj.properties.get('data');
  if (dataProp) {
    obj.properties.set('data', { value: text, writable: true, enumerable: true, configurable: true });
  }
  const textProp = obj.properties.get('text');
  if (textProp) {
    obj.properties.set('text', { value: text, writable: true, enumerable: true, configurable: true });
  }
}

function domGetChildIndex(node: JSValue): number {
  const parent = domGetParent(node);
  if (!parent) return 0;
  const children = domGetChildNodes(parent);
  if (!children) return 0;
  const len = Number(children.properties.get('length')?.value ?? 0);
  for (let i = 0; i < len; i++) {
    const child = children.properties.get(String(i))?.value;
    if (child === node) return i;
  }
  return 0;
}

function domGetAncestors(node: JSValue): JSObject[] {
  const result: JSObject[] = [];
  let current = node;
  while (typeof current === 'object' && current !== null) {
    result.push(current as JSObject);
    current = domGetParent(current);
  }
  return result;
}

function domGetCommonAncestor(nodeA: JSValue, nodeB: JSValue): JSObject | null {
  if (typeof nodeA !== 'object' || nodeA === null) return null;
  if (typeof nodeB !== 'object' || nodeB === null) return null;
  if (nodeA === nodeB) return nodeA as JSObject;
  const ancA = domGetAncestors(nodeA);
  const ancB = domGetAncestors(nodeB);
  let common: JSObject | null = null;
  for (let i = ancA.length - 1, j = ancB.length - 1; i >= 0 && j >= 0; i--, j--) {
    if (ancA[i] === ancB[j]) common = ancA[i];
    else break;
  }
  return common;
}

function domComparePosition(nodeA: JSObject, offsetA: number, nodeB: JSObject, offsetB: number): number {
  if (nodeA === nodeB) {
    if (offsetA < offsetB) return -1;
    if (offsetA > offsetB) return 1;
    return 0;
  }
  const ancA = domGetAncestors(nodeA);
  const ancB = domGetAncestors(nodeB);
  let commonIdx = -1;
  for (let i = ancA.length - 1, j = ancB.length - 1; i >= 0 && j >= 0; i--, j--) {
    if (ancA[i] === ancB[j]) commonIdx = i;
    else break;
  }
  if (commonIdx < 0) return 0;
  const common = ancA[commonIdx]!;
  const childA = commonIdx > 0 ? ancA[commonIdx - 1]! : nodeA;
  const childB = commonIdx > 0 ? ancB[commonIdx - 1]! : nodeB;
  const children = domGetChildNodes(common);
  if (!children) return 0;
  const len = Number(children.properties.get('length')?.value ?? 0);
  let idxA = -1, idxB = -1;
  for (let i = 0; i < len; i++) {
    const c = children.properties.get(String(i))?.value;
    if (c === childA) idxA = i;
    if (c === childB) idxB = i;
  }
  if (idxA < idxB) return -1;
  if (idxA > idxB) return 1;
  return 0;
}

function domGetNodeLength(node: JSObject): number {
  const nt = domGetNodeType(node);
  if (nt === 'text' || nt === 'comment') {
    return domGetTextContent(node).length;
  }
  const children = domGetChildNodes(node);
  if (!children) return 0;
  return Number(children.properties.get('length')?.value ?? 0);
}

function domGetChildAt(node: JSObject, index: number): JSValue {
  const children = domGetChildNodes(node);
  if (!children) return undefined;
  return children.properties.get(String(index))?.value;
}

function domRemoveChild(parent: JSObject, child: JSObject): void {
  const rm = parent.properties.get('removeChild')?.value;
  const fn = rm && typeof rm === 'object' ? (rm as JSFunction).nativeFn : undefined;
  if (fn) fn(parent, [child]);
}

function domInsertBefore(parent: JSObject, newChild: JSObject, refChild: JSObject | null): void {
  const ins = parent.properties.get('insertBefore')?.value;
  const fn = ins && typeof ins === 'object' ? (ins as JSFunction).nativeFn : undefined;
  if (fn) fn(parent, [newChild, refChild]);
}

function domAppendChild(parent: JSObject, child: JSObject): void {
  const app = parent.properties.get('appendChild')?.value;
  const fn = app && typeof app === 'object' ? (app as JSFunction).nativeFn : undefined;
  if (fn) fn(parent, [child]);
}

function domCloneNode(node: JSObject, deep: boolean): JSObject | null {
  const cl = node.properties.get('cloneNode')?.value;
  const fn = cl && typeof cl === 'object' ? (cl as JSFunction).nativeFn : undefined;
  if (fn) {
    const result = fn(node, [deep]);
    return (typeof result === 'object' && result !== null) ? result as JSObject : null;
  }
  return null;
}

function domCreateElement(tagName: string): JSObject | null {
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTION API
// ─────────────────────────────────────────────────────────────────────────────

export function createSelectionObject() {
  const selObj = createObject(null);
  (selObj as JSObjectWithMeta).__type_override = 'selection';
  const state: any = {
    anchorNode: undefined as JSValue,
    anchorOffset: 0,
    focusNode: undefined as JSValue,
    focusOffset: 0,
  };

  function updateSelProps(): void {
    const isCollapsed = state.anchorNode === state.focusNode && state.anchorOffset === state.focusOffset;
    const hasRange = state.anchorNode !== undefined;
    selObj.properties.set('anchorNode', { value: state.anchorNode, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('anchorOffset', { value: state.anchorOffset, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('focusNode', { value: state.focusNode, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('focusOffset', { value: state.focusOffset, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('isCollapsed', { value: isCollapsed, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('rangeCount', { value: hasRange ? 1 : 0, writable: false, enumerable: true, configurable: true });
    selObj.properties.set('type', { value: hasRange ? (isCollapsed ? 'Caret' : 'Range') : 'None', writable: false, enumerable: true, configurable: true });
    let text = '';
    if (hasRange && state.anchorNode && typeof state.anchorNode === 'object') {
      const tc = (state.anchorNode as JSObject).properties.get('textContent')?.value;
      if (typeof tc === 'string') text = tc;
    }
    selObj.properties.set('text', { value: text, writable: false, enumerable: true, configurable: true });
  }

  updateSelProps();

  selObj.properties.set('getRangeAt', {
    value: createNativeFunction('getRangeAt', (_this, args) => {
      const idx = toNumber(args[0]);
      if (idx !== 0) {
        const err = createObject(null);
        err.properties.set('name', { value: 'IndexSizeError', writable: true, enumerable: true, configurable: true });
        err.properties.set('message', { value: 'Index out of range', writable: true, enumerable: true, configurable: true });
        throw err;
      }
      const range = createRangeObject();
      if (state.anchorNode) {
        const setStart = range.properties.get('setStart')!.value as JSFunction;
        const setEnd = range.properties.get('setEnd')!.value as JSFunction;
        setStart.nativeFn?.(range, [state.anchorNode, state.anchorOffset]);
        setEnd.nativeFn?.(range, [state.focusNode, state.focusOffset]);
      }
      return range;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('addRange', {
    value: createNativeFunction('addRange', (_this, args) => {
      const range = args[0];
      if (typeof range !== 'object' || range === null) return undefined;
      const sc = (range as JSObject).properties.get('startContainer')?.value;
      const so = Number((range as JSObject).properties.get('startOffset')?.value ?? 0);
      const ec = (range as JSObject).properties.get('endContainer')?.value;
      const eo = Number((range as JSObject).properties.get('endOffset')?.value ?? 0);
      state.anchorNode = sc;
      state.anchorOffset = so;
      state.focusNode = ec;
      state.focusOffset = eo;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('removeRange', {
    value: createNativeFunction('removeRange', () => {
      state.anchorNode = undefined;
      state.anchorOffset = 0;
      state.focusNode = undefined;
      state.focusOffset = 0;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('removeAllRanges', {
    value: createNativeFunction('removeAllRanges', () => {
      state.anchorNode = undefined;
      state.anchorOffset = 0;
      state.focusNode = undefined;
      state.focusOffset = 0;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('collapse', {
    value: createNativeFunction('collapse', (_this, args) => {
      const node = args[0];
      const offset = args.length > 1 ? toNumber(args[1]) : 0;
      state.anchorNode = node;
      state.anchorOffset = offset;
      state.focusNode = node;
      state.focusOffset = offset;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('collapseToStart', {
    value: createNativeFunction('collapseToStart', () => {
      state.focusNode = state.anchorNode;
      state.focusOffset = state.anchorOffset;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('collapseToEnd', {
    value: createNativeFunction('collapseToEnd', () => {
      state.anchorNode = state.focusNode;
      state.anchorOffset = state.focusOffset;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('extend', {
    value: createNativeFunction('extend', (_this, args) => {
      const node = args[0];
      const offset = args.length > 1 ? toNumber(args[1]) : 0;
      state.focusNode = node;
      state.focusOffset = offset;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('setBaseAndExtent', {
    value: createNativeFunction('setBaseAndExtent', (_this, args) => {
      state.anchorNode = args[0];
      state.anchorOffset = toNumber(args[1]);
      state.focusNode = args[2];
      state.focusOffset = toNumber(args[3]);
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('selectAllChildren', {
    value: createNativeFunction('selectAllChildren', (_this, args) => {
      const node = args[0];
      if (typeof node !== 'object' || node === null) return undefined;
      state.anchorNode = node;
      state.anchorOffset = 0;
      state.focusNode = node;
      state.focusOffset = domGetNodeLength(node as JSObject);
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('deleteFromDocument', {
    value: createNativeFunction('deleteFromDocument', () => {
      if (!state.anchorNode || typeof state.anchorNode !== 'object') return undefined;
      const range = createRangeObject();
      const setStart = range.properties.get('setStart')!.value as JSFunction;
      const setEnd = range.properties.get('setEnd')!.value as JSFunction;
      if (setStart.nativeFn) setStart.nativeFn(range, [state.anchorNode, state.anchorOffset]);
      if (setEnd.nativeFn) setEnd.nativeFn(range, [state.focusNode, state.focusOffset]);
      const del = range.properties.get('deleteContents')!.value as JSFunction | undefined;
      if (del && typeof del === 'object' && del.nativeFn) {
        del.nativeFn(range, []);
      }
      state.anchorNode = undefined;
      state.anchorOffset = 0;
      state.focusNode = undefined;
      state.focusOffset = 0;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('containsNode', {
    value: createNativeFunction('containsNode', (_this, args) => {
      const node = args[0];
      if (!state.anchorNode || typeof node !== 'object' || node === null) return false;
      return domComparePosition(
        state.anchorNode as JSObject, state.anchorOffset,
        node as JSObject, 0,
      ) <= 0 && domComparePosition(
        node as JSObject, 0,
        state.focusNode as JSObject, state.focusOffset,
      ) <= 0;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('empty', {
    value: createNativeFunction('empty', () => {
      state.anchorNode = undefined;
      state.anchorOffset = 0;
      state.focusNode = undefined;
      state.focusOffset = 0;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('setPosition', {
    value: createNativeFunction('setPosition', (_this, args) => {
      const node = args[0];
      const offset = args.length > 1 ? toNumber(args[1]) : 0;
      state.anchorNode = node;
      state.anchorOffset = offset;
      state.focusNode = node;
      state.focusOffset = offset;
      updateSelProps();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  selObj.properties.set('toString', {
    value: createNativeFunction('toString', (_this) => {
      let text = '';
      if (state.anchorNode && typeof state.anchorNode === 'object') {
        const tc = (state.anchorNode as JSObject).properties.get('textContent')?.value;
        if (typeof tc === 'string') text = tc;
      }
      return text;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return selObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// RANGE API
// ─────────────────────────────────────────────────────────────────────────────

export function createRangeObject() {
  const rangeObj = createObject(null);
  (rangeObj as JSObjectWithMeta).__type_override = 'range';
  const state: any = {
    startContainer: undefined as JSValue,
    startOffset: 0,
    endContainer: undefined as JSValue,
    endOffset: 0,
  };

  function getSC(): JSObject | null {
    return (typeof state.startContainer === 'object' && state.startContainer !== null) ? state.startContainer as JSObject : null;
  }
  function getEC(): JSObject | null {
    return (typeof state.endContainer === 'object' && state.endContainer !== null) ? state.endContainer as JSObject : null;
  }

  const syncProps = (): void => {
    const collapsed = state.startContainer === state.endContainer && state.startOffset === state.endOffset;
    let common = state.startContainer;
    if (state.startContainer !== undefined && state.endContainer !== undefined && state.startContainer !== state.endContainer) {
      common = domGetCommonAncestor(state.startContainer, state.endContainer);
    }
    rangeObj.properties.set('startContainer', { value: state.startContainer, writable: false, enumerable: true, configurable: true });
    rangeObj.properties.set('startOffset', { value: state.startOffset, writable: false, enumerable: true, configurable: true });
    rangeObj.properties.set('endContainer', { value: state.endContainer, writable: false, enumerable: true, configurable: true });
    rangeObj.properties.set('endOffset', { value: state.endOffset, writable: false, enumerable: true, configurable: true });
    rangeObj.properties.set('collapsed', { value: collapsed, writable: false, enumerable: true, configurable: true });
    rangeObj.properties.set('commonAncestorContainer', { value: common, writable: false, enumerable: true, configurable: true });
  };
  (rangeObj as JSObjectWithMeta).__syncProps = syncProps;
  syncProps();

  function afterMutate(): void { syncProps(); }

  rangeObj.properties.set('setStart', {
    value: createNativeFunction('setStart', (_t, a) => {
      state.startContainer = a[0];
      state.startOffset = toNumber(a[1]);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('setEnd', {
    value: createNativeFunction('setEnd', (_t, a) => {
      state.endContainer = a[0];
      state.endOffset = toNumber(a[1]);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('setStartBefore', {
    value: createNativeFunction('setStartBefore', (_t, a) => {
      const node = a[0];
      const parent = domGetParent(node);
      if (!parent) { afterMutate(); return undefined; }
      state.startContainer = parent;
      state.startOffset = domGetChildIndex(node);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('setStartAfter', {
    value: createNativeFunction('setStartAfter', (_t, a) => {
      const node = a[0];
      const parent = domGetParent(node);
      if (!parent) { afterMutate(); return undefined; }
      state.startContainer = parent;
      state.startOffset = domGetChildIndex(node) + 1;
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('setEndBefore', {
    value: createNativeFunction('setEndBefore', (_t, a) => {
      const node = a[0];
      const parent = domGetParent(node);
      if (!parent) { afterMutate(); return undefined; }
      state.endContainer = parent;
      state.endOffset = domGetChildIndex(node);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('setEndAfter', {
    value: createNativeFunction('setEndAfter', (_t, a) => {
      const node = a[0];
      const parent = domGetParent(node);
      if (!parent) { afterMutate(); return undefined; }
      state.endContainer = parent;
      state.endOffset = domGetChildIndex(node) + 1;
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('selectNode', {
    value: createNativeFunction('selectNode', (_t, a) => {
      const node = a[0];
      const parent = domGetParent(node);
      if (!parent) { afterMutate(); return undefined; }
      state.startContainer = parent;
      state.startOffset = domGetChildIndex(node);
      state.endContainer = parent;
      state.endOffset = state.startOffset + 1;
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('selectNodeContents', {
    value: createNativeFunction('selectNodeContents', (_t, a) => {
      const node = a[0];
      if (typeof node !== 'object' || node === null) { afterMutate(); return undefined; }
      state.startContainer = node;
      state.startOffset = 0;
      state.endContainer = node;
      state.endOffset = domGetNodeLength(node as JSObject);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('collapse', {
    value: createNativeFunction('collapse', (_t, a) => {
      const toStart = toBoolean(a[0]);
      if (toStart) {
        state.endContainer = state.startContainer;
        state.endOffset = state.startOffset;
      } else {
        state.startContainer = state.endContainer;
        state.startOffset = state.endOffset;
      }
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('cloneContents', {
    value: createNativeFunction('cloneContents', () => {
      const docFrag = createObject(null);
      (docFrag as JSObjectWithMeta).__type_override = 'documentfragment';
      const appendChild = docFrag.properties.get('appendChild')?.value;
      if (state.startContainer === state.endContainer && state.startOffset === state.endOffset) {
        return docFrag;
      }
      if (state.startContainer === state.endContainer) {
        const sc = getSC();
        if (!sc) return docFrag;
        const nt = domGetNodeType(sc);
        if (nt === 'text' || nt === 'comment') {
          const text = domGetTextContent(sc);
          const cloned = domCloneNode(sc, false);
          if (cloned) {
            domSetTextContent(cloned, text.slice(state.startOffset, state.endOffset));
            const fn = appendChild && typeof appendChild === 'object' ? (appendChild as JSFunction).nativeFn : undefined;
            if (fn) {
              fn(docFrag, [cloned]);
            }
          }
          return docFrag;
        }
        const children = domGetChildNodes(sc);
        if (!children) return docFrag;
        const len = Number(children.properties.get('length')?.value ?? 0);
        for (let i = state.startOffset; i < state.endOffset && i < len; i++) {
          const child = children.properties.get(String(i))?.value;
          if (typeof child === 'object' && child !== null) {
            const cl = domCloneNode(child as JSObject, true);
            if (cl) {
              const fn = appendChild && typeof appendChild === 'object' ? (appendChild as JSFunction).nativeFn : undefined;
              if (fn) fn(docFrag, [cl]);
            }
          }
        }
        return docFrag;
      }
      return docFrag;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('deleteContents', {
    value: createNativeFunction('deleteContents', () => {
      if (state.startContainer === state.endContainer && state.startOffset === state.endOffset) { afterMutate(); return undefined; }
      if (state.startContainer === state.endContainer) {
        const sc = getSC();
        if (!sc) { afterMutate(); return undefined; }
        const nt = domGetNodeType(sc);
        if (nt === 'text' || nt === 'comment') {
          const text = domGetTextContent(sc);
          const newText = text.slice(0, state.startOffset) + text.slice(state.endOffset);
          domSetTextContent(sc, newText);
          state.endOffset = state.startOffset;
          afterMutate();
          return undefined;
        }
        const children = domGetChildNodes(sc);
        if (!children) { afterMutate(); return undefined; }
        const toRemove: JSObject[] = [];
        const len = Number(children.properties.get('length')?.value ?? 0);
        for (let i = state.startOffset; i < state.endOffset && i < len; i++) {
          const child = children.properties.get(String(i))?.value;
          if (typeof child === 'object' && child !== null) toRemove.push(child as JSObject);
        }
        for (const c of toRemove) {
          domRemoveChild(sc, c);
        }
        afterMutate();
        return undefined;
      }
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('extractContents', {
    value: createNativeFunction('extractContents', () => {
      const docFrag = createObject(null);
      (docFrag as JSObjectWithMeta).__type_override = 'documentfragment';
      const appendChild = docFrag.properties.get('appendChild')?.value;
      if (state.startContainer === state.endContainer && state.startOffset === state.endOffset) { afterMutate(); return docFrag; }
      if (state.startContainer === state.endContainer) {
        const sc = getSC();
        if (!sc) { afterMutate(); return docFrag; }
        const nt = domGetNodeType(sc);
        if (nt === 'text' || nt === 'comment') {
          const text = domGetTextContent(sc);
          const extracted = text.slice(state.startOffset, state.endOffset);
          const newText = text.slice(0, state.startOffset) + text.slice(state.endOffset);
          const cloned = domCloneNode(sc, false);
          if (cloned) {
            domSetTextContent(cloned, extracted);
            const fn = appendChild && typeof appendChild === 'object' ? (appendChild as JSFunction).nativeFn : undefined;
            if (fn) {
              fn(docFrag, [cloned]);
            }
          }
          domSetTextContent(sc, newText);
          state.endOffset = state.startOffset;
          afterMutate();
          return docFrag;
        }
        const children = domGetChildNodes(sc);
        if (!children) { afterMutate(); return docFrag; }
        const toRemove: JSObject[] = [];
        const len = Number(children.properties.get('length')?.value ?? 0);
        for (let i = state.startOffset; i < state.endOffset && i < len; i++) {
          const child = children.properties.get(String(i))?.value;
          if (typeof child === 'object' && child !== null) {
            toRemove.push(child as JSObject);
          }
        }
        for (const c of toRemove) {
          const cl = domCloneNode(c, true);
          if (cl) {
            const fn = appendChild && typeof appendChild === 'object' ? (appendChild as JSFunction).nativeFn : undefined;
            if (fn) fn(docFrag, [cl]);
          }
          domRemoveChild(sc, c);
        }
        state.endOffset = state.startOffset;
        afterMutate();
        return docFrag;
      }
      afterMutate();
      return docFrag;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('cloneRange', {
    value: createNativeFunction('cloneRange', () => {
      const clone = createRangeObject();
      const cloneState = (clone as JSObjectWithMeta).__rangeState;
      if (cloneState) {
        cloneState.startContainer = state.startContainer;
        cloneState.startOffset = state.startOffset;
        cloneState.endContainer = state.endContainer;
        cloneState.endOffset = state.endOffset;
      }
      (clone as JSObjectWithMeta).__syncProps?.();
      return clone;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('detach', {
    value: createNativeFunction('detach', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('isPointInRange', {
    value: createNativeFunction('isPointInRange', (_t, a) => {
      const node = a[0];
      const offset = toNumber(a[1]);
      if (typeof node !== 'object' || node === null) return false;
      if (!state.startContainer || !state.endContainer) return false;
      const sc = getSC(); const ec = getEC();
      if (!sc || !ec) return false;
      const startCmp = domComparePosition(sc, state.startOffset, node as JSObject, offset);
      const endCmp = domComparePosition(node as JSObject, offset, ec, state.endOffset);
      return startCmp <= 0 && endCmp <= 0;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('intersectsNode', {
    value: createNativeFunction('intersectsNode', (_t, a) => {
      const node = a[0];
      if (typeof node !== 'object' || node === null) return false;
      if (!state.startContainer || !state.endContainer) return false;
      const sc = getSC(); const ec = getEC();
      if (!sc || !ec) return false;
      const parent = domGetParent(node);
      if (!parent) return false;
      const idx = domGetChildIndex(node);
      const before = domComparePosition(sc, state.startOffset, node as JSObject, 0);
      const after = domComparePosition(node as JSObject, 0, ec, state.endOffset);
      return before <= 0 && after <= 0;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('compareBoundaryPoints', {
    value: createNativeFunction('compareBoundaryPoints', (_t, a) => {
      const how = toNumber(a[0]);
      const sourceRange = a[1] as JSObject;
      if (!sourceRange) return 0;
      const srcSC = sourceRange.properties.get('startContainer')?.value;
      const srcSO = Number(sourceRange.properties.get('startOffset')?.value ?? 0);
      const srcEC = sourceRange.properties.get('endContainer')?.value;
      const srcEO = Number(sourceRange.properties.get('endOffset')?.value ?? 0);
      const sc = getSC(); const ec = getEC();
      if (!sc || !ec) return 0;
      if (!srcSC || !srcEC) return 0;
      switch (how) {
        case 0: return domComparePosition(sc, state.startOffset, srcSC as JSObject, srcSO); // START_TO_START
        case 1: return domComparePosition(sc, state.startOffset, srcEC as JSObject, srcEO); // START_TO_END
        case 2: return domComparePosition(ec, state.endOffset, srcSC as JSObject, srcSO); // END_TO_START
        case 3: return domComparePosition(ec, state.endOffset, srcEC as JSObject, srcEO); // END_TO_END
        default: return 0;
      }
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('comparePoint', {
    value: createNativeFunction('comparePoint', (_t, a) => {
      const node = a[0];
      const offset = toNumber(a[1]);
      if (!state.startContainer || !state.endContainer) return 0;
      const sc = getSC(); const ec = getEC();
      if (!sc || !ec) return 0;
      if (typeof node !== 'object' || node === null) return 0;
      const beforeStart = domComparePosition(node as JSObject, offset, sc, state.startOffset);
      if (beforeStart < 0) return -1;
      const afterEnd = domComparePosition(ec, state.endOffset, node as JSObject, offset);
      if (afterEnd < 0) return 1;
      return 0;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('insertNode', {
    value: createNativeFunction('insertNode', (_t, a) => {
      const newNode = a[0];
      if (typeof newNode !== 'object' || newNode === null) { afterMutate(); return undefined; }
      if (!state.startContainer) { afterMutate(); return undefined; }
      const sc = getSC();
      if (!sc) { afterMutate(); return undefined; }
      const nt = domGetNodeType(sc);
      if (nt === 'text' || nt === 'comment') {
        const parent = domGetParent(sc);
        if (!parent) { afterMutate(); return undefined; }
        const idx = domGetChildIndex(sc);
        const text = domGetTextContent(sc);
        if (state.startOffset > 0 && state.startOffset < text.length) {
          const afterText = text.slice(state.startOffset);
          domSetTextContent(sc, text.slice(0, state.startOffset));
          const afterNode = domCloneNode(sc, false);
          if (afterNode) {
            domSetTextContent(afterNode, afterText);
            domInsertBefore(parent, afterNode, domGetNextSibling(sc));
          }
        }
        domInsertBefore(parent, newNode as JSObject, domGetNextSibling(sc));
        state.startContainer = parent;
        state.startOffset = idx;
        afterMutate();
        return undefined;
      }
      domInsertBefore(sc, newNode as JSObject, domGetChildAt(sc, state.startOffset) as JSObject | null);
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('surroundContents', {
    value: createNativeFunction('surroundContents', (_t, a) => {
      const newParent = a[0];
      if (typeof newParent !== 'object' || newParent === null) { afterMutate(); return undefined; }
      if (!state.startContainer || !state.endContainer) { afterMutate(); return undefined; }
      const sc = getSC(); const ec = getEC();
      if (!sc || !ec) { afterMutate(); return undefined; }
      if (sc !== ec) { afterMutate(); return undefined; }
      const nt = domGetNodeType(sc);
      if (nt === 'text' || nt === 'comment') { afterMutate(); return undefined; }
      const children = domGetChildNodes(sc);
      if (!children) { afterMutate(); return undefined; }
      const toMove: JSObject[] = [];
      const len = Number(children.properties.get('length')?.value ?? 0);
      for (let i = state.startOffset; i < state.endOffset && i < len; i++) {
        const child = children.properties.get(String(i))?.value;
        if (typeof child === 'object' && child !== null) toMove.push(child as JSObject);
      }
      for (const c of toMove) {
        domRemoveChild(sc, c);
        domAppendChild(newParent as JSObject, c);
      }
      domInsertBefore(sc, newParent as JSObject, domGetChildAt(sc, state.startOffset) as JSObject | null);
      state.startContainer = sc;
      state.startOffset = domGetChildIndex(newParent as JSObject);
      state.endContainer = sc;
      state.endOffset = state.startOffset + 1;
      afterMutate();
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('createContextualFragment', {
    value: createNativeFunction('createContextualFragment', () => {
      const frag = createObject(null);
      (frag as JSObjectWithMeta).__type_override = 'documentfragment';
      return frag;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rangeObj.properties.set('toString', {
    value: createNativeFunction('toString', () => {
      if (!state.startContainer || !state.endContainer) return '';
      if (state.startContainer === state.endContainer) {
        const nt = domGetNodeType(state.startContainer as JSObject);
        if (nt === 'text' || nt === 'comment') {
          return domGetTextContent(state.startContainer as JSObject).slice(state.startOffset, state.endOffset);
        }
        return '';
      }
      return '';
    }),
    writable: true, enumerable: true, configurable: true,
  });

  (rangeObj as JSObjectWithMeta).__rangeState = state;
  return rangeObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// TREE WALKER / NODE ITERATOR
// ─────────────────────────────────────────────────────────────────────────────

export function createTreeWalkerObject() {
  return createNativeFunction('createTreeWalker', (_this, args) => {
    const root = args[0];
    const whatToShow = args[1] !== undefined ? toNumber(args[1]) : 0xFFFFFFFF;
    const filter = args[2];

    const walkerObj = createObject(null);
    walkerObj.properties.set('root', { value: root, writable: false, enumerable: true, configurable: false });
    walkerObj.properties.set('whatToShow', { value: whatToShow, writable: false, enumerable: true, configurable: false });
    walkerObj.properties.set('filter', { value: filter, writable: false, enumerable: true, configurable: false });
    walkerObj.properties.set('currentNode', { value: root, writable: true, enumerable: true, configurable: true });

    walkerObj.properties.set('firstChild', {
      value: createNativeFunction('firstChild', (_this) => {
        const current = (walkerObj as JSObject).properties.get('currentNode')?.value as JSObject | undefined;
        if (!current) return null;
        const childrenDesc = current.properties.get('childNodes');
        const children = childrenDesc?.value;
        if (children && typeof children === 'object' && (children as JSObject).type === 'array') {
          const len = Number((children as JSObject).properties.get('length')?.value ?? 0);
          const first = (children as JSObject).properties.get('0')?.value;
          walkerObj.properties.set('currentNode', { value: first, writable: true, enumerable: true, configurable: true });
          return first;
        }
        return null;
      }),
      writable: true, enumerable: true, configurable: true,
    });
    walkerObj.properties.set('lastChild', { value: createNativeFunction('lastChild', () => null), writable: true, enumerable: true, configurable: true });
    walkerObj.properties.set('nextSibling', { value: createNativeFunction('nextSibling', () => null), writable: true, enumerable: true, configurable: true });
    walkerObj.properties.set('previousSibling', { value: createNativeFunction('previousSibling', () => null), writable: true, enumerable: true, configurable: true });
    walkerObj.properties.set('nextNode', { value: createNativeFunction('nextNode', () => null), writable: true, enumerable: true, configurable: true });
    walkerObj.properties.set('previousNode', { value: createNativeFunction('previousNode', () => null), writable: true, enumerable: true, configurable: true });
    walkerObj.properties.set('parentNode', { value: createNativeFunction('parentNode', () => null), writable: true, enumerable: true, configurable: true });

    return walkerObj;
  });
}

export function createNodeIteratorObject() {
  return createNativeFunction('createNodeIterator', (_this, args) => {
    const root = args[0];
    const whatToShow = args[1] !== undefined ? toNumber(args[1]) : 0xFFFFFFFF;
    const filter = args[2];

    const iterObj = createObject(null);
    iterObj.properties.set('root', { value: root, writable: false, enumerable: true, configurable: false });
    iterObj.properties.set('referenceNode', { value: root, writable: true, enumerable: true, configurable: true });
    iterObj.properties.set('pointerBeforeReferenceNode', { value: false, writable: true, enumerable: true, configurable: true });
    iterObj.properties.set('whatToShow', { value: whatToShow, writable: false, enumerable: true, configurable: false });
    iterObj.properties.set('filter', { value: filter, writable: false, enumerable: true, configurable: false });

    iterObj.properties.set('nextNode', { value: createNativeFunction('nextNode', () => null), writable: true, enumerable: true, configurable: true });
    iterObj.properties.set('previousNode', { value: createNativeFunction('previousNode', () => null), writable: true, enumerable: true, configurable: true });
    iterObj.properties.set('detach', { value: createNativeFunction('detach', () => undefined), writable: true, enumerable: true, configurable: true });

    return iterObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGE CHANNEL / MESSAGE PORT
// ─────────────────────────────────────────────────────────────────────────────

export function createMessageChannelConstructor() {
  return createNativeFunction('MessageChannel', () => {
    const port1 = createMessagePortObject();
    const port2 = createMessagePortObject();
    (port1 as JSObjectWithMeta).__remote = port2;
    (port2 as JSObjectWithMeta).__remote = port1;

    const channelObj = createObject(null);
    channelObj.properties.set('port1', { value: port1, writable: false, enumerable: true, configurable: false });
    channelObj.properties.set('port2', { value: port2, writable: false, enumerable: true, configurable: false });
    return channelObj;
  });
}

function createMessagePortObject() {
  const portObj = createObject(null);
  (portObj as JSObjectWithMeta).__type_override = 'messageport';
  (portObj as JSObjectWithMeta).__listeners = [] as Array<{ type: string; fn: JSFunction }>;
  (portObj as JSObjectWithMeta).__started = false;
  portObj.properties.set('onmessage', { value: undefined, writable: true, enumerable: true, configurable: true });
  portObj.properties.set('onmessageerror', { value: undefined, writable: true, enumerable: true, configurable: true });

  portObj.properties.set('postMessage', {
    value: createNativeFunction('postMessage', (_t, a) => {
      const remote = (portObj as JSObjectWithMeta).__remote;
      if (!remote) return undefined;
      const msg = deepCloneJS(a[0]);
      const onmsg = remote.properties.get('onmessage')?.value;
      if (typeof onmsg === 'object' && onmsg !== null && (onmsg as JSFunction).type === 'closure') {
        const evObj = createObject(null);
        evObj.properties.set('data', { value: msg, writable: false, enumerable: true, configurable: false });
        evObj.properties.set('origin', { value: '', writable: false, enumerable: true, configurable: false });
        evObj.properties.set('source', { value: portObj, writable: false, enumerable: true, configurable: false });
        evObj.properties.set('lastEventId', { value: '', writable: false, enumerable: true, configurable: false });
        callJSFunction(onmsg as JSFunction, remote, [evObj]);
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  portObj.properties.set('start', {
    value: createNativeFunction('start', () => { (portObj as JSObjectWithMeta).__started = true; return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  portObj.properties.set('close', {
    value: createNativeFunction('close', () => { (portObj as JSObjectWithMeta).__remote = undefined; return undefined; }),
    writable: true, enumerable: true, configurable: true,
  });
  portObj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_t, a) => {
      const type = toString(a[0]);
      const fn = a[1] as JSFunction;
      ((portObj as JSObjectWithMeta).__listeners ??= []).push({ type, fn });
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  portObj.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_t, a) => {
      const type = toString(a[0]);
      const fn = a[1];
      const list = (portObj as JSObjectWithMeta).__listeners ?? [];
      (portObj as JSObjectWithMeta).__listeners = list.filter((l) => !(l.type === type && l.fn === fn));
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  portObj.properties.set('dispatchEvent', {
    value: createNativeFunction('dispatchEvent', (_t, a) => {
      const ev = a[0] as JSObject;
      const type = toString(ev.properties.get('type')?.value ?? '');
      const list = (portObj as JSObjectWithMeta).__listeners ?? [];
      for (const l of list) {
        if (l.type === type) callJSFunction(l.fn, portObj, [ev]);
      }
      return true;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return portObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// TOUCH EVENTS
// ─────────────────────────────────────────────────────────────────────────────

export function createTouchObject() {
  return createNativeFunction('Touch', (_this, args) => {
    const touchObj = createObject(null);
    const opts = args[0] as JSObject | undefined;
    const props = ['identifier', 'target', 'clientX', 'clientY', 'pageX', 'pageY', 'screenX', 'screenY', 'radiusX', 'radiusY', 'rotationAngle', 'force'];
    // Handle both plain JS objects and JSObjects
    const getProp = (name: string) => {
      if (opts && typeof opts === 'object') {
        // Plain JS object
        if (name in opts) return (opts as unknown as Record<string, JSValue>)[name];
        // JSObject
        if (opts.properties && typeof opts.properties.get === 'function') {
          const desc = opts.properties.get(name);
          if (desc) return desc.value;
        }
      }
      return 0;
    };
    for (let i = 0; i < props.length; i++) {
      touchObj.properties.set(props[i], {
        value: getProp(props[i]),
        writable: false, enumerable: true, configurable: false,
      });
    }
    touchObj.properties.set('touchType', { value: 'direct', writable: false, enumerable: true, configurable: false });
    touchObj.properties.set('altitudeAngle', { value: Math.PI / 2, writable: false, enumerable: true, configurable: false });
    touchObj.properties.set('azimuthAngle', { value: 0, writable: false, enumerable: true, configurable: false });
    touchObj.properties.set('width', { value: 1, writable: false, enumerable: true, configurable: false });
    touchObj.properties.set('height', { value: 1, writable: false, enumerable: true, configurable: false });

    touchObj.properties.set('getClientRects', {
      value: createNativeFunction('getClientRects', () => createArray([])),
      writable: true, enumerable: true, configurable: true,
    });
    return touchObj;
  });
}

export function createTouchEventConstructor() {
  return createNativeFunction('TouchEvent', (_this, args) => {
    const type = toString(args[0] ?? '');
    const rawInit = args[1];
    const evObj = createObject(null);
    evObj.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
    evObj.properties.set('bubbles', { value: false, writable: true, enumerable: true, configurable: true });
    evObj.properties.set('cancelable', { value: false, writable: true, enumerable: true, configurable: true });
    evObj.properties.set('view', { value: undefined, writable: true, enumerable: true, configurable: true });

    // Helper to get property from either plain object or JSObject
    const getInitProp = (name: string): any => {
      if (rawInit && typeof rawInit === 'object') {
if (name in rawInit) return (rawInit as unknown as Record<string, JSValue>)[name];
    if ((rawInit as JSObject).properties && typeof (rawInit as JSObject).properties.get === 'function') {
      const desc = (rawInit as JSObject).properties.get(name);
          if (desc) return desc.value;
        }
      }
      return undefined;
    };

    const makeTouchArray = (name: string) => {
      const arr = getInitProp(name);
      if (arr) {
        if (Array.isArray(arr)) return createArray(arr.map(v => v));
        if (typeof arr === 'object' && arr.type === 'array') return arr;
      }
      return createArray([]);
    };

    evObj.properties.set('touches', { value: makeTouchArray('touches'), writable: false, enumerable: true, configurable: false });
    evObj.properties.set('targetTouches', { value: makeTouchArray('targetTouches'), writable: false, enumerable: true, configurable: false });
    evObj.properties.set('changedTouches', { value: makeTouchArray('changedTouches'), writable: false, enumerable: true, configurable: false });
    evObj.properties.set('altKey', { value: getInitProp('altKey') ?? false, writable: false, enumerable: true, configurable: false });
    evObj.properties.set('metaKey', { value: getInitProp('metaKey') ?? false, writable: false, enumerable: true, configurable: false });
    evObj.properties.set('ctrlKey', { value: getInitProp('ctrlKey') ?? false, writable: false, enumerable: true, configurable: false });
    evObj.properties.set('shiftKey', { value: getInitProp('shiftKey') ?? false, writable: false, enumerable: true, configurable: false });

    return evObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAG EVENT
// ─────────────────────────────────────────────────────────────────────────────

export function createDragEventConstructor() {
  return createNativeFunction('DragEvent', (_this, args) => {
    const type = toString(args[0] ?? '');
    const rawInit = args[1];
    const getInitProp = (name: string, defaultVal: any = undefined): any => {
      if (rawInit && typeof rawInit === 'object') {
if (name in rawInit) return (rawInit as unknown as Record<string, JSValue>)[name];
    if ((rawInit as JSObject).properties && typeof (rawInit as JSObject).properties.get === 'function') {
      const desc = (rawInit as JSObject).properties.get(name);
          if (desc) return desc.value;
        }
      }
      return defaultVal;
    };
    const evObj = createObject(null);
    evObj.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
    evObj.properties.set('bubbles', { value: getInitProp('bubbles', false), writable: true, enumerable: true, configurable: true });
    evObj.properties.set('cancelable', { value: getInitProp('cancelable', false), writable: true, enumerable: true, configurable: true });

    // DataTransfer
    const dtObj = createObject(null);
    dtObj.properties.set('dropEffect', { value: 'none', writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('effectAllowed', { value: 'uninitialized', writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('files', { value: createArray([]), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('types', { value: createArray([]), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('items', { value: createArray([]), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('getData', { value: createNativeFunction('getData', () => ''), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('setData', { value: createNativeFunction('setData', () => undefined), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('clearData', { value: createNativeFunction('clearData', () => undefined), writable: true, enumerable: true, configurable: true });
    dtObj.properties.set('setDragImage', { value: createNativeFunction('setDragImage', () => undefined), writable: true, enumerable: true, configurable: true });

    evObj.properties.set('dataTransfer', { value: dtObj, writable: true, enumerable: true, configurable: true });
    evObj.properties.set('clientX', { value: getInitProp('clientX', 0), writable: true, enumerable: true, configurable: true });
    evObj.properties.set('clientY', { value: getInitProp('clientY', 0), writable: true, enumerable: true, configurable: true });
    evObj.properties.set('screenX', { value: getInitProp('screenX', 0), writable: true, enumerable: true, configurable: true });
    evObj.properties.set('screenY', { value: getInitProp('screenY', 0), writable: true, enumerable: true, configurable: true });

    return evObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB ANIMATIONS API
// ─────────────────────────────────────────────────────────────────────────────

export function createAnimationObject() {
  const animObj = createObject(null);
  animObj.properties.set('playState', { value: 'running', writable: true, enumerable: true, configurable: true });
  animObj.properties.set('playbackRate', { value: 1, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('currentTime', { value: 0, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('startTime', { value: 0, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('finished', { value: true, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('pending', { value: false, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('onfinish', { value: undefined, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('oncancel', { value: undefined, writable: true, enumerable: true, configurable: true });
  animObj.properties.set('onremove', { value: undefined, writable: true, enumerable: true, configurable: true });

  animObj.properties.set('play', { value: createNativeFunction('play', () => animObj), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('pause', { value: createNativeFunction('pause', () => animObj), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('finish', { value: createNativeFunction('finish', () => undefined), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('cancel', { value: createNativeFunction('cancel', () => undefined), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('reverse', { value: createNativeFunction('reverse', () => animObj), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('commitStyles', { value: createNativeFunction('commitStyles', () => undefined), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('updatePlaybackRate', { value: createNativeFunction('updatePlaybackRate', () => undefined), writable: true, enumerable: true, configurable: true });
  animObj.properties.set('getAnimations', { value: createNativeFunction('getAnimations', () => createArray([animObj])), writable: true, enumerable: true, configurable: true });

  return animObj;
}

export function createElementAnimateMethod() {
  return createNativeFunction('animate', (_this, args) => {
    const animObj = createAnimationObject();
    return animObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE OBSERVER
// ─────────────────────────────────────────────────────────────────────────────

export function createResizeObserverConstructor() {
  return createNativeFunction('ResizeObserver', (_this, args) => {
    const callback = args[0] as JSFunction;
    const observerObj = createObject(null);

    observerObj.properties.set('observe', {
      value: createNativeFunction('observe', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });
    observerObj.properties.set('unobserve', {
      value: createNativeFunction('unobserve', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });
    observerObj.properties.set('disconnect', {
      value: createNativeFunction('disconnect', () => undefined),
      writable: true, enumerable: true, configurable: true,
    });

    return observerObj;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: createPromiseLike
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: deepCloneJS (for message passing)
// ─────────────────────────────────────────────────────────────────────────────

function deepCloneJS(val: JSValue): JSValue {
  if (val === null || val === undefined || typeof val === 'boolean' || typeof val === 'number' || typeof val === 'string') return val;
  if (typeof val === 'object') {
    const obj = val as JSObject;
    if (obj.type === 'array') {
      const len = Number(obj.properties.get('length')?.value ?? 0);
      const arr: JSValue[] = [];
      for (let i = 0; i < len; i++) arr.push(deepCloneJS(obj.properties.get(String(i))?.value));
      return createArray(arr);
    }
    // Handle JSObject (has .properties Map)
    if (obj.properties && typeof obj.properties.get === 'function') {
      const result = createObject(null);
      for (const [k, desc] of obj.properties) {
        result.properties.set(k, { value: deepCloneJS(desc.value), writable: desc.writable, enumerable: desc.enumerable, configurable: desc.configurable });
      }
      return result;
    }
    // Handle plain JS objects (no .properties Map)
    const result = createObject(null);
    for (const [k, v] of Object.entries(val as unknown as Record<string, unknown>)) {
      result.properties.set(k, { value: deepCloneJS(v as JSValue), writable: true, enumerable: true, configurable: true });
    }
    return result;
  }
  return val;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW TRANSITIONS API
// ─────────────────────────────────────────────────────────────────────────────

export function createViewTransitionsMethods(docBinding: any) {
  // document.startViewTransition(callback?) → ViewTransition
  docBinding.properties.set('startViewTransition', {
    value: createNativeFunction('startViewTransition', (_this, args) => {
      const callback = args[0];
      const vtObj = createObject(null);

      // ViewTransition.ready → Promise<void>
      vtObj.properties.set('ready', {
        value: createPromiseLike(undefined),
        writable: false, enumerable: true, configurable: true,
      });

      // ViewTransition.finished → Promise<void>
      vtObj.properties.set('finished', {
        value: createPromiseLike(undefined),
        writable: false, enumerable: true, configurable: true,
      });

      // ViewTransition.updateCallbackDone → Promise<void>
      vtObj.properties.set('updateCallbackDone', {
        value: createPromiseLike(undefined),
        writable: false, enumerable: true, configurable: true,
      });

      // ViewTransition.skipTransition()
      vtObj.properties.set('skipTransition', {
        value: createNativeFunction('skipTransition', () => undefined),
        writable: true, enumerable: true, configurable: true,
      });

      // ViewTransition.types → CSSViewTransitionRuleSet
      vtObj.properties.set('types', {
        value: createArray([]),
        writable: false, enumerable: true, configurable: true,
      });

      vtObj.properties.set('__type', { value: 'ViewTransition', writable: false, enumerable: false, configurable: false });

      // Execute callback synchronously if provided
      if (callback && typeof callback === 'object' && (callback as JSFunction).type === 'closure') {
        try { callJSFunction(callback as JSFunction, undefined, []); } catch {}
      }

      return vtObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION API
// ─────────────────────────────────────────────────────────────────────────────

export function createNavigationObject() {
  const navObj = createObject(null);
  let currentUrl = 'about:blank';
  const entries: JSObject[] = [];

  const entryObj = createObject(null);
  entryObj.properties.set('key', { value: 'default', writable: false, enumerable: true, configurable: false });
  entryObj.properties.set('id', { value: '1', writable: false, enumerable: true, configurable: false });
  entryObj.properties.set('index', { value: 0, writable: false, enumerable: true, configurable: false });
  entryObj.properties.set('url', { value: currentUrl, writable: false, enumerable: true, configurable: false });
  entryObj.properties.set('sameDocument', { value: true, writable: false, enumerable: true, configurable: false });
  entryObj.properties.set('getState', {
    value: createNativeFunction('getState', () => null),
    writable: true, enumerable: true, configurable: true,
  });
  entryObj.properties.set('getAllEntries', {
    value: createNativeFunction('getAllEntries', () => createArray(entries)),
    writable: true, enumerable: true, configurable: true,
  });
  entries.push(entryObj);

  // Navigation.canIntercept
  navObj.properties.set('canIntercept', {
    value: createNativeFunction('canIntercept', () => false),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.intercept(options?)
  navObj.properties.set('intercept', {
    value: createNativeFunction('intercept', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.scroll({focus}) → Promise<void>
  navObj.properties.set('scroll', {
    value: createNativeFunction('scroll', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.navigate(url, options?) → NavigationResult
  navObj.properties.set('navigate', {
    value: createNativeFunction('navigate', (_this, args) => {
      const url = toString(args[0] ?? '');
      const opts = args[1];
      currentUrl = url;

      const newEntry = createObject(null);
      newEntry.properties.set('key', { value: 'nav-' + Date.now(), writable: false, enumerable: true, configurable: false });
      newEntry.properties.set('id', { value: String(entries.length + 1), writable: false, enumerable: true, configurable: false });
      newEntry.properties.set('index', { value: entries.length, writable: false, enumerable: true, configurable: false });
      newEntry.properties.set('url', { value: url, writable: false, enumerable: true, configurable: false });
      newEntry.properties.set('sameDocument', { value: false, writable: false, enumerable: true, configurable: false });
      newEntry.properties.set('getState', {
        value: createNativeFunction('getState', () => {
          if (opts && typeof opts === 'object') {
if ('state' in opts) return (opts as Record<string, JSValue>).state;
    if ((opts as JSObject).properties?.get('state')?.value !== undefined) return (opts as JSObject).properties.get('state')!.value;
          }
          return null;
        }),
        writable: true, enumerable: true, configurable: true,
      });

      const resultObj = createObject(null);
      resultObj.properties.set('committed', { value: createPromiseLike(newEntry), writable: false, enumerable: true, configurable: true });
      resultObj.properties.set('finished', { value: createPromiseLike(newEntry), writable: false, enumerable: true, configurable: true });
      return resultObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.reload(options?) → NavigationResult
  navObj.properties.set('reload', {
    value: createNativeFunction('reload', () => {
      const resultObj = createObject(null);
      resultObj.properties.set('committed', { value: createPromiseLike(entryObj), writable: false, enumerable: true, configurable: true });
      resultObj.properties.set('finished', { value: createPromiseLike(entryObj), writable: false, enumerable: true, configurable: true });
      return resultObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.back() / Navigation.forward()
  navObj.properties.set('back', {
    value: createNativeFunction('back', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  navObj.properties.set('forward', {
    value: createNativeFunction('forward', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation.currentEntry
  navObj.properties.set('currentEntry', {
    value: entryObj,
    writable: false, enumerable: true, configurable: true,
  });

  // Navigation.currentEntryIndex
  navObj.properties.set('currentEntryIndex', {
    value: 0,
    writable: false, enumerable: true, configurable: true,
  });

  // Navigation.canGoBack / Navigation.canGoForward
  navObj.properties.set('canGoBack', { value: false, writable: false, enumerable: true, configurable: true });
  navObj.properties.set('canGoForward', { value: false, writable: false, enumerable: true, configurable: true });

  // Navigation.goTo(key) → NavigationResult
  navObj.properties.set('goTo', {
    value: createNativeFunction('goTo', (_this, args) => {
      const resultObj = createObject(null);
      resultObj.properties.set('committed', { value: createPromiseLike(undefined), writable: false, enumerable: true, configurable: true });
      resultObj.properties.set('finished', { value: createPromiseLike(undefined), writable: false, enumerable: true, configurable: true });
      return resultObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // Navigation traversal
  navObj.properties.set('updateCurrentEntry', {
    value: createNativeFunction('updateCurrentEntry', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });

  // Event handlers (onnavigate, onnavigatesuccess, onnavigateerror)
  navObj.properties.set('onnavigate', { value: undefined, writable: true, enumerable: true, configurable: true });
  navObj.properties.set('onnavigatesuccess', { value: undefined, writable: true, enumerable: true, configurable: true });
  navObj.properties.set('onnavigateerror', { value: undefined, writable: true, enumerable: true, configurable: true });

  navObj.properties.set('__type', { value: 'Navigation', writable: false, enumerable: false, configurable: false });
  return navObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPRESSION STREAMS API
// ─────────────────────────────────────────────────────────────────────────────

export function createCompressionStreamConstructor() {
  return createNativeFunction('CompressionStream', (_this, args) => {
    const format = toString(args[0] ?? 'gzip');
    const csObj = createObject(null);

    // CompressionStream.readable → ReadableStream
    const readableObj = createReadableStreamObject();
    csObj.properties.set('readable', { value: readableObj, writable: false, enumerable: true, configurable: true });

    // CompressionStream.writable → WritableStream
    const writableObj = createWritableStreamObject();
    csObj.properties.set('writable', { value: writableObj, writable: false, enumerable: true, configurable: true });

    csObj.properties.set('__type', { value: 'CompressionStream', writable: false, enumerable: false, configurable: false });
    csObj.properties.set('__format', { value: format, writable: false, enumerable: false, configurable: false });
    return csObj;
  });
}

export function createDecompressionStreamConstructor() {
  return createNativeFunction('DecompressionStream', (_this, args) => {
    const format = toString(args[0] ?? 'gzip');
    const dsObj = createObject(null);

    const readableObj = createReadableStreamObject();
    dsObj.properties.set('readable', { value: readableObj, writable: false, enumerable: true, configurable: true });

    const writableObj = createWritableStreamObject();
    dsObj.properties.set('writable', { value: writableObj, writable: false, enumerable: true, configurable: true });

    dsObj.properties.set('__type', { value: 'DecompressionStream', writable: false, enumerable: false, configurable: false });
    dsObj.properties.set('__format', { value: format, writable: false, enumerable: false, configurable: false });
    return dsObj;
  });
}

// Helper: create ReadableStream (stub)
function createReadableStreamObject() {
  const rsObj = createObject(null);
  rsObj.properties.set('__type', { value: 'ReadableStream', writable: false, enumerable: false, configurable: false });
  rsObj.properties.set('locked', { value: false, writable: false, enumerable: true, configurable: false });
  rsObj.properties.set('cancel', { value: createNativeFunction('cancel', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
  rsObj.properties.set('getReader', {
    value: createNativeFunction('getReader', () => {
      const readerObj = createObject(null);
      readerObj.properties.set('read', { value: createNativeFunction('read', () => createPromiseLike({ value: undefined, done: true })), writable: true, enumerable: true, configurable: true });
      readerObj.properties.set('releaseLock', { value: createNativeFunction('releaseLock', () => undefined), writable: true, enumerable: true, configurable: true });
      return readerObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  rsObj.properties.set('pipeTo', { value: createNativeFunction('pipeTo', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
  rsObj.properties.set('pipeThrough', { value: createNativeFunction('pipeThrough', (_t, a) => a[0] ?? createObject(null)), writable: true, enumerable: true, configurable: true });
  return rsObj;
}

// Helper: create WritableStream (stub)
function createWritableStreamObject() {
  const wsObj = createObject(null);
  wsObj.properties.set('__type', { value: 'WritableStream', writable: false, enumerable: false, configurable: false });
  wsObj.properties.set('locked', { value: false, writable: false, enumerable: true, configurable: false });
  wsObj.properties.set('abort', { value: createNativeFunction('abort', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
  wsObj.properties.set('close', { value: createNativeFunction('close', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
  wsObj.properties.set('getWriter', {
    value: createNativeFunction('getWriter', () => {
      const writerObj = createObject(null);
      writerObj.properties.set('write', { value: createNativeFunction('write', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
      writerObj.properties.set('close', { value: createNativeFunction('close', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
      writerObj.properties.set('abort', { value: createNativeFunction('abort', () => createPromiseLike(undefined)), writable: true, enumerable: true, configurable: true });
      writerObj.properties.set('releaseLock', { value: createNativeFunction('releaseLock', () => undefined), writable: true, enumerable: true, configurable: true });
      writerObj.properties.set('desiredSize', { value: null, writable: false, enumerable: true, configurable: false });
      return writerObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  return wsObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER API
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerObject() {
  const schedObj = createObject(null);

  // scheduler.postTask(callback, options?) → Promise
  schedObj.properties.set('postTask', {
    value: createNativeFunction('postTask', (_this, args) => {
      const callback = args[0];
      const opts = args[1];
      const getProp = (name: string, def: any) => {
        if (opts && typeof opts === 'object') {
if (name in opts) return (opts as unknown as Record<string, JSValue>)[name];
    if ((opts as JSObject).properties && typeof (opts as JSObject).properties.get === 'function') {
      const desc = (opts as JSObject).properties.get(name);
            if (desc) return desc.value;
          }
        }
        return def;
      };
      const priority = getProp('priority', 'user-visible') as string;
      const signal = getProp('signal', undefined) as JSObject | undefined;

      // Execute callback immediately (simplified)
      if (callback && typeof callback === 'object' && (callback as JSFunction).type === 'closure') {
        try { callJSFunction(callback as JSFunction, undefined, []); } catch {}
      }
      return createPromiseLike(undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // scheduler.yield() → Promise<void>
  schedObj.properties.set('yield', {
    value: createNativeFunction('yield', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // scheduler.currentTask
  schedObj.properties.set('currentTask', {
    value: createNativeFunction('currentTask', () => {
      const taskObj = createObject(null);
      taskObj.properties.set('priority', { value: 'user-visible', writable: false, enumerable: true, configurable: false });
      taskObj.properties.set('name', { value: '', writable: false, enumerable: true, configurable: false });
      return taskObj;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  schedObj.properties.set('__type', { value: 'Scheduler', writable: false, enumerable: false, configurable: false });
  return schedObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STORAGE API
// ─────────────────────────────────────────────────────────────────────────────

export function createSharedStorageObject() {
  const ssObj = createObject(null);

  // window.sharedStorage.selectURL(key, urls, options?) → Promise
  ssObj.properties.set('selectURL', {
    value: createNativeFunction('selectURL', (_this, args) => {
      const key = toString(args[0] ?? '');
      const urls = args[1];
      return createPromiseLike(createObject(null));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.set(key, value, options?) → Promise
  ssObj.properties.set('set', {
    value: createNativeFunction('set', (_this, args) => {
      return createPromiseLike(undefined);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.get(key) → Promise<string | null>
  ssObj.properties.set('get', {
    value: createNativeFunction('get', (_this, args) => {
      return createPromiseLike(null);
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.delete(key) → Promise
  ssObj.properties.set('delete', {
    value: createNativeFunction('delete', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.clear() → Promise
  ssObj.properties.set('clear', {
    value: createNativeFunction('clear', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.join() → Promise
  ssObj.properties.set('join', {
    value: createNativeFunction('join', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.run() → Promise
  ssObj.properties.set('run', {
    value: createNativeFunction('run', (_this, args) => {
      return createPromiseLike(createObject(null));
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // window.sharedStorage.resolveaidauction() → Promise
  ssObj.properties.set('resolveaidauction', {
    value: createNativeFunction('resolveaidauction', () => createPromiseLike(null)),
    writable: true, enumerable: true, configurable: true,
  });

  ssObj.properties.set('__type', { value: 'SharedStorage', writable: false, enumerable: false, configurable: false });
  return ssObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// FENCED FRAMES API
// ─────────────────────────────────────────────────────────────────────────────

export function createFencedFrameObject() {
  const ffObj = createObject(null);

  // FencedFrameConfig
  ffObj.properties.set('url', { value: 'about:blank', writable: false, enumerable: true, configurable: false });
  ffObj.properties.set('navigateTo', {
    value: createNativeFunction('navigateTo', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  ffObj.properties.set('adAuctionConfig', { value: null, writable: false, enumerable: true, configurable: false });
  ffObj.properties.set('deprecatedReplaceInURN', {
    value: createNativeFunction('deprecatedReplaceInURN', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });
  ffObj.properties.set('executeQuery', {
    value: createNativeFunction('executeQuery', () => createPromiseLike(createObject(null))),
    writable: true, enumerable: true, configurable: true,
  });
  ffObj.properties.set('getName', {
    value: createNativeFunction('getName', () => ''),
    writable: true, enumerable: true, configurable: true,
  });
  ffObj.properties.set('__type', { value: 'FencedFrameConfig', writable: false, enumerable: false, configurable: false });
  return ffObj;
}

export function createFenceObject() {
  const fenceObj = createObject(null);

  // Fence.report(name) → Promise
  fenceObj.properties.set('report', {
    value: createNativeFunction('report', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  // Fence.getJoiningOrigins() → Promise<string[]>
  fenceObj.properties.set('getJoiningOrigins', {
    value: createNativeFunction('getJoiningOrigins', () => createPromiseLike(createArray([]))),
    writable: true, enumerable: true, configurable: true,
  });

  // Fence.getSharedStorage() → Promise<SharedStorage>
  fenceObj.properties.set('getSharedStorage', {
    value: createNativeFunction('getSharedStorage', () => createPromiseLike(createSharedStorageObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // Fence.notifyEvent() → Promise
  fenceObj.properties.set('notifyEvent', {
    value: createNativeFunction('notifyEvent', () => createPromiseLike(undefined)),
    writable: true, enumerable: true, configurable: true,
  });

  fenceObj.properties.set('__type', { value: 'Fence', writable: false, enumerable: false, configurable: false });
  return fenceObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI APIs
// ─────────────────────────────────────────────────────────────────────────────

export function createAIAPIObject() {
  const aiObj = createObject(null);

  // window.ai.canCreateTextSession() → Promise<'no'|'after-download'|'readily'>
  aiObj.properties.set('canCreateTextSession', {
    value: createNativeFunction('canCreateTextSession', () => createPromiseLike('readily')),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.createTextSession(options?) → Promise<AITextSession>
  aiObj.properties.set('createTextSession', {
    value: createNativeFunction('createTextSession', () => createPromiseLike(createAITextSessionObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.defaultTextSession() → Promise<AITextSession>
  aiObj.properties.set('defaultTextSession', {
    value: createNativeFunction('defaultTextSession', () => createPromiseLike(createAITextSessionObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.createTextSessionForPrompt(prompt) → Promise<AITextSession>
  aiObj.properties.set('createTextSessionForPrompt', {
    value: createNativeFunction('createTextSessionForPrompt', () => createPromiseLike(createAITextSessionObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.canCreateLanguageModel() → Promise<'no'|'after-download'|'readily'>
  aiObj.properties.set('canCreateLanguageModel', {
    value: createNativeFunction('canCreateLanguageModel', () => createPromiseLike('readily')),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.languageModel() → Promise<AILanguageModel>
  aiObj.properties.set('languageModel', {
    value: createNativeFunction('languageModel', () => createPromiseLike(createAILanguageModelObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.assistant() → Promise<AIAssistant>
  aiObj.properties.set('assistant', {
    value: createNativeFunction('assistant', () => createPromiseLike(createAIAssistantObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.summarizer() → Promise<AISummarizer>
  aiObj.properties.set('summarizer', {
    value: createNativeFunction('summarizer', () => createPromiseLike(createAISummarizerObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.writer() → Promise<AIWriter>
  aiObj.properties.set('writer', {
    value: createNativeFunction('writer', () => createPromiseLike(createAIWriterObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.rewriter() → Promise<AIRewriter>
  aiObj.properties.set('rewriter', {
    value: createNativeFunction('rewriter', () => createPromiseLike(createAIRewriterObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.translator() → Promise<AITranslator>
  aiObj.properties.set('translator', {
    value: createNativeFunction('translator', () => createPromiseLike(createAITranslatorObject())),
    writable: true, enumerable: true, configurable: true,
  });

  // window.ai.languageModelFactory() → AILanguageModelFactory
  aiObj.properties.set('languageModelFactory', {
    value: (() => {
      const factoryObj = createObject(null);
      factoryObj.properties.set('create', {
        value: createNativeFunction('create', () => createPromiseLike(createAILanguageModelObject())),
        writable: true, enumerable: true, configurable: true,
      });
      return factoryObj;
    })(),
    writable: true, enumerable: true, configurable: true,
  });

  aiObj.properties.set('__type', { value: 'AI', writable: false, enumerable: false, configurable: false });
  return aiObj;
}

function createAITextSessionObject() {
  const sessObj = createObject(null);
  sessObj.properties.set('prompt', {
    value: createNativeFunction('prompt', (_this, args) => {
      return createPromiseLike('');
    }),
    writable: true, enumerable: true, configurable: true,
  });
  sessObj.properties.set('promptStreaming', {
    value: createNativeFunction('promptStreaming', (_this, args) => {
      return createReadableStreamObject();
    }),
    writable: true, enumerable: true, configurable: true,
  });
  sessObj.properties.set('maxTokens', { value: 8192, writable: false, enumerable: true, configurable: false });
  sessObj.properties.set('temperature', { value: 1.0, writable: false, enumerable: true, configurable: false });
  sessObj.properties.set('topK', { value: 1, writable: false, enumerable: true, configurable: false });
  sessObj.properties.set('oncontextoverflow', { value: undefined, writable: true, enumerable: true, configurable: true });
  sessObj.properties.set('clone', {
    value: createNativeFunction('clone', () => createPromiseLike(createAITextSessionObject())),
    writable: true, enumerable: true, configurable: true,
  });
  sessObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  sessObj.properties.set('execution', { value: createObject(null), writable: true, enumerable: true, configurable: true });
  sessObj.properties.set('__type', { value: 'AITextSession', writable: false, enumerable: false, configurable: false });
  return sessObj;
}

function createAILanguageModelObject() {
  const lmObj = createObject(null);
  lmObj.properties.set('prompt', {
    value: createNativeFunction('prompt', () => createPromiseLike('')),
    writable: true, enumerable: true, configurable: true,
  });
  lmObj.properties.set('promptStreaming', {
    value: createNativeFunction('promptStreaming', () => createReadableStreamObject()),
    writable: true, enumerable: true, configurable: true,
  });
  lmObj.properties.set('maxTokens', { value: 8192, writable: false, enumerable: true, configurable: false });
  lmObj.properties.set('temperature', { value: 1.0, writable: false, enumerable: true, configurable: false });
  lmObj.properties.set('topK', { value: 1, writable: false, enumerable: true, configurable: false });
  lmObj.properties.set('topP', { value: 1.0, writable: false, enumerable: true, configurable: false });
  lmObj.properties.set('clone', {
    value: createNativeFunction('clone', () => createPromiseLike(createAILanguageModelObject())),
    writable: true, enumerable: true, configurable: true,
  });
  lmObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  lmObj.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  lmObj.properties.set('__type', { value: 'AILanguageModel', writable: false, enumerable: false, configurable: false });
  return lmObj;
}

function createAIAssistantObject() {
  const asObj = createObject(null);
  asObj.properties.set('create', {
    value: createNativeFunction('create', () => createPromiseLike(createObject(null))),
    writable: true, enumerable: true, configurable: true,
  });
  asObj.properties.set('__type', { value: 'AIAssistant', writable: false, enumerable: false, configurable: false });
  return asObj;
}

function createAISummarizerObject() {
  const sumObj = createObject(null);
  sumObj.properties.set('summarize', {
    value: createNativeFunction('summarize', () => createPromiseLike('')),
    writable: true, enumerable: true, configurable: true,
  });
  sumObj.properties.set('summarizeStreaming', {
    value: createNativeFunction('summarizeStreaming', () => createReadableStreamObject()),
    writable: true, enumerable: true, configurable: true,
  });
  sumObj.properties.set('sharedContext', { value: '', writable: true, enumerable: true, configurable: true });
  sumObj.properties.set('format', { value: 'plain-text', writable: true, enumerable: true, configurable: true });
  sumObj.properties.set('length', { value: 'short', writable: true, enumerable: true, configurable: true });
  sumObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  sumObj.properties.set('__type', { value: 'AISummarizer', writable: false, enumerable: false, configurable: false });
  return sumObj;
}

function createAIWriterObject() {
  const wObj = createObject(null);
  wObj.properties.set('write', {
    value: createNativeFunction('write', () => createPromiseLike('')),
    writable: true, enumerable: true, configurable: true,
  });
  wObj.properties.set('writeStreaming', {
    value: createNativeFunction('writeStreaming', () => createReadableStreamObject()),
    writable: true, enumerable: true, configurable: true,
  });
  wObj.properties.set('sharedContext', { value: '', writable: true, enumerable: true, configurable: true });
  wObj.properties.set('tone', { value: 'neutral', writable: true, enumerable: true, configurable: true });
  wObj.properties.set('length', { value: 'short', writable: true, enumerable: true, configurable: true });
  wObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  wObj.properties.set('__type', { value: 'AIWriter', writable: false, enumerable: false, configurable: false });
  return wObj;
}

function createAIRewriterObject() {
  const rwObj = createObject(null);
  rwObj.properties.set('rewrite', {
    value: createNativeFunction('rewrite', () => createPromiseLike('')),
    writable: true, enumerable: true, configurable: true,
  });
  rwObj.properties.set('rewriteStreaming', {
    value: createNativeFunction('rewriteStreaming', () => createReadableStreamObject()),
    writable: true, enumerable: true, configurable: true,
  });
  rwObj.properties.set('sharedContext', { value: '', writable: true, enumerable: true, configurable: true });
  rwObj.properties.set('tone', { value: 'as-is', writable: true, enumerable: true, configurable: true });
  rwObj.properties.set('strength', { value: 'original', writable: true, enumerable: true, configurable: true });
  rwObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  rwObj.properties.set('__type', { value: 'AIRewriter', writable: false, enumerable: false, configurable: false });
  return rwObj;
}

function createAITranslatorObject() {
  const trObj = createObject(null);
  trObj.properties.set('translate', {
    value: createNativeFunction('translate', () => createPromiseLike('')),
    writable: true, enumerable: true, configurable: true,
  });
  trObj.properties.set('translateStreaming', {
    value: createNativeFunction('translateStreaming', () => createReadableStreamObject()),
    writable: true, enumerable: true, configurable: true,
  });
  trObj.properties.set('sourceLanguage', { value: 'auto', writable: true, enumerable: true, configurable: true });
  trObj.properties.set('targetLanguage', { value: 'en', writable: true, enumerable: true, configurable: true });
  trObj.properties.set('destroy', {
    value: createNativeFunction('destroy', () => undefined),
    writable: true, enumerable: true, configurable: true,
  });
  trObj.properties.set('__type', { value: 'AITranslator', writable: false, enumerable: false, configurable: false });
  return trObj;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPECULATION RULES API
// ─────────────────────────────────────────────────────────────────────────────

export function createSpeculationRulesObject() {
  const srObj = createObject(null);

  // Speculation rules configuration object
  srObj.properties.set('prerender', {
    value: (() => {
      const preObj = createObject(null);
      preObj.properties.set('urls', { value: createArray([]), writable: true, enumerable: true, configurable: true });
      preObj.properties.set('source', { value: 'list', writable: true, enumerable: true, configurable: true });
      preObj.properties.set('requires', { value: createArray([]), writable: true, enumerable: true, configurable: true });
      preObj.properties.set('eagerness', { value: 'immediate', writable: true, enumerable: true, configurable: true });
      return preObj;
    })(),
    writable: true, enumerable: true, configurable: true,
  });
  srObj.properties.set('prefetch', {
    value: (() => {
      const pfObj = createObject(null);
      pfObj.properties.set('urls', { value: createArray([]), writable: true, enumerable: true, configurable: true });
      pfObj.properties.set('source', { value: 'list', writable: true, enumerable: true, configurable: true });
      pfObj.properties.set('requires', { value: createArray([]), writable: true, enumerable: true, configurable: true });
      pfObj.properties.set('eagerness', { value: 'immediate', writable: true, enumerable: true, configurable: true });
      return pfObj;
    })(),
    writable: true, enumerable: true, configurable: true,
  });
  srObj.properties.set('prerenders', {
    value: createNativeFunction('prerenders', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });

  srObj.properties.set('__type', { value: 'SpeculationRules', writable: false, enumerable: false, configurable: false });
  return srObj;
}

// Register <script type="speculationrules"> handler
export function registerSpeculationRulesHandler(docBinding: any) {
  docBinding.properties.set('getSpeculationRules', {
    value: createNativeFunction('getSpeculationRules', () => createArray([])),
    writable: true, enumerable: true, configurable: true,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WIRE ALL Web APIs INTO GLOBAL ENVIRONMENT
// ─────────────────────────────────────────────────────────────────────────────

export function bindWebAPIs(env: any, docBinding?: any) {
  // Web Crypto API
  env.setLocal('crypto', createCryptoObject());

  // BroadcastChannel
  env.setLocal('BroadcastChannel', createBroadcastChannelConstructor());

  // Custom Elements
  env.setLocal('customElements', createCustomElementsObject());

  // ReadableStream / WritableStream / TransformStream
  env.setLocal('ReadableStream', createReadableStreamConstructor());
  env.setLocal('WritableStream', createWritableStreamConstructor());
  env.setLocal('TransformStream', createTransformStreamConstructor());

  // PerformanceObserver constructor
  env.setLocal('PerformanceObserver', createPerformanceObserverConstructor());

  // ResizeObserver constructor
  env.setLocal('ResizeObserver', createResizeObserverConstructor());

  // MessageChannel
  env.setLocal('MessageChannel', createMessageChannelConstructor());

  // Touch constructor (global)
  env.setLocal('Touch', createTouchObject());

  // TouchEvent constructor (global)
  env.setLocal('TouchEvent', createTouchEventConstructor());

  // DragEvent constructor (global)
  env.setLocal('DragEvent', createDragEventConstructor());

  // Selection API — window.getSelection returns this
  env.setLocal('Selection', createSelectionObject);

  // ── WebAssembly (WASM) ──
  env.setLocal('WebAssembly', createWebAssemblyObject());
  env.setLocal('Module', createWebAssemblyModuleStatic());
  env.setLocal('Instance', createWebAssemblyInstanceConstructor());
  env.setLocal('Memory', createWebAssemblyMemoryConstructor());
  env.setLocal('Table', createWebAssemblyTableConstructor());
  env.setLocal('Global', createWebAssemblyGlobalConstructor());
  env.setLocal('Tag', createWebAssemblyTagConstructor());
  env.setLocal('Exception', createWebAssemblyExceptionConstructor());

  // ── WebGPU ──
  env.setLocal('gpu', createGPUObject());

  // ── WebXR ──
  env.setLocal('xr', createXRSystemObject());

  // ── Compression Streams ──
  env.setLocal('CompressionStream', createCompressionStreamConstructor());
  env.setLocal('DecompressionStream', createDecompressionStreamConstructor());

  // ── Scheduler ──
  env.setLocal('scheduler', createSchedulerObject());

  // ── Shared Storage ──
  env.setLocal('sharedStorage', createSharedStorageObject());

  // ── Fenced Frames ──
  env.setLocal('Fence', createFenceObject());

  // ── AI APIs ──
  env.setLocal('ai', createAIAPIObject());

  // ── View Transitions + Navigation + Speculation Rules (document-bound) ──
  if (docBinding) {
    createViewTransitionsMethods(docBinding);
    registerSpeculationRulesHandler(docBinding);
    docBinding.properties.set('navigation', {
      value: createNavigationObject(),
      writable: true, enumerable: true, configurable: true,
    });
  } else {
    // Fallback: bind navigation to env
    env.setLocal('navigation', createNavigationObject());
  }
}
