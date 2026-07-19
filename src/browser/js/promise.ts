// ─────────────────────────────────────────────────────────────────────────────
// PROMISE — Full Promise/A+ implementation with microtask integration
// ─────────────────────────────────────────────────────────────────────────────

import type { JSValue, JSObject, JSFunction } from './values';
import {
  createObject, createArray, createNativeFunction,
  toBoolean, toString, callJSFunction,
} from './values';
import type { EventLoop } from './event-loop';

// ── Internal state per promise ───────────────────────────────────────────────

interface PromiseReaction {
  onFulfilled: JSValue;
  onRejected: JSValue;
  promise: JSObject;
}

interface PromiseState {
  state: 'pending' | 'fulfilled' | 'rejected';
  result: JSValue;
  reactions: PromiseReaction[];
}

const promiseStates = new WeakMap<JSObject, PromiseState>();

export function isPromiseObject(val: JSValue): boolean {
  if (typeof val !== 'object' || val === null) return false;
  return promiseStates.has(val as JSObject);
}

function getState(p: JSObject): PromiseState {
  return promiseStates.get(p)!;
}

// ── Promise object factory ──────────────────────────────────────────────────

export function createPromiseObj(eventLoop: EventLoop): JSObject {
  const p = createObject(null);
  const state: PromiseState = { state: 'pending', result: undefined, reactions: [] };
  promiseStates.set(p, state);

  p.properties.set('then', {
    value: createPromiseProtoThen(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  p.properties.set('catch', {
    value: createPromiseProtoCatch(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  p.properties.set('finally', {
    value: createPromiseProtoFinally(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  p.properties.set('constructor', {
    value: createPromiseConstructor(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  return p;
}

// ── FulfillPromise / RejectPromise ──────────────────────────────────────────

export function fulfillPromise(promise: JSObject, value: JSValue): void {
  const state = getState(promise);
  if (state.state !== 'pending') return;
  state.state = 'fulfilled';
  state.result = value;
  for (const reaction of state.reactions) {
    enqueueReactionReaction(reaction);
  }
  state.reactions.length = 0;
}

export function rejectPromise(promise: JSObject, reason: JSValue): void {
  const state = getState(promise);
  if (state.state !== 'pending') return;
  state.state = 'rejected';
  state.result = reason;
  for (const reaction of state.reactions) {
    enqueueReactionReaction(reaction);
  }
  state.reactions.length = 0;
}

// ── Thenable resolution ─────────────────────────────────────────────────────

function resolvePromise(promise: JSObject, x: JSValue, eventLoop: EventLoop): void {
  if (x === promise) {
    rejectPromise(promise, new TypeError('Promise resolved with itself'));
    return;
  }

  if (typeof x === 'object' && x !== null) {
    const xObj = x as JSObject;

    // If x is a native Promise (tracked in our WeakMap)
    if (isPromiseObject(x)) {
      const xState = getState(xObj);
      if (xState.state === 'pending') {
        // Chain: x is a pending promise — enqueue a microtask to check again
        const reaction: PromiseReaction = {
          onFulfilled: createNativeFunction('onFulfilled', (_this, args) => {
            resolvePromise(promise, args[0], eventLoop);
            return undefined;
          }),
          onRejected: createNativeFunction('onRejected', (_this, args) => {
            rejectPromise(promise, args[0]);
            return undefined;
          }),
          promise,
        };
        xState.reactions.push(reaction);
      } else if (xState.state === 'fulfilled') {
        resolvePromise(promise, xState.result, eventLoop);
      } else {
        rejectPromise(promise, xState.result);
      }
      return;
    }

    // Check for thenable
    let then: JSValue = undefined;
    try {
      const desc = xObj.properties.get('then');
      if (desc) {
        then = desc.getter
          ? callJSFunction(desc.getter, x, [])
          : desc.value;
      } else if (xObj.prototype) {
        let proto: JSObject | null = xObj.prototype;
        while (proto) {
          const protoDesc = proto.properties.get('then');
          if (protoDesc) {
            then = protoDesc.getter
              ? callJSFunction(protoDesc.getter, x, [])
              : protoDesc.value;
            break;
          }
          proto = proto.prototype;
        }
      }
    } catch {
      rejectPromise(promise, new TypeError('Error reading thenable'));
      return;
    }

    if (typeof then !== 'object' || then === null || (then as JSFunction).type !== 'closure') {
      fulfillPromise(promise, x);
      return;
    }

    let resolving = false;
    const resolve = createNativeFunction('resolve', (_th, args) => {
      if (resolving) return undefined;
      resolving = true;
      resolvePromise(promise, args[0], eventLoop);
      return undefined;
    });
    const reject = createNativeFunction('reject', (_th, args) => {
      if (resolving) return undefined;
      resolving = true;
      rejectPromise(promise, args[0]);
      return undefined;
    });

    eventLoop.enqueueMicrotask(() => {
      try {
        callJSFunction(then as JSFunction, x, [resolve, reject]);
      } catch (err) {
        if (!resolving) {
          resolving = true;
          rejectPromise(promise, err instanceof Error ? err.message : String(err));
        }
      }
    });
    return;
  }

  fulfillPromise(promise, x);
}

// ── Enqueue reaction handler ────────────────────────────────────────────────

function enqueueReactionReaction(reaction: PromiseReaction): void {
  // reaction.promise is the downstream promise we need to settle
  // We enqueue a microtask that runs the appropriate handler
  // and uses the result to settle the downstream promise
  const { promise: downstream } = reaction;

  // We need the eventLoop reference — it's captured in the closure of the
  // native functions that created this reaction. We store it on the downstream.
  const evLoop = promiseEventLoops.get(downstream);
  if (!evLoop) return;

  evLoop.enqueueMicrotask(() => {
    const state = getState(downstream);
    // The downstream should still be pending at this point
    if (state.state !== 'pending') return;

    // Determine which handler to call based on the upstream state
    // We find the upstream promise by checking what state the downstream was observing
    // Actually, the reaction was enqueued by a specific upstream. Let's track it.
    const upstream = reactionUpstreams.get(reaction);
    if (!upstream) return;
    const upstreamState = getState(upstream);

    const handler = upstreamState.state === 'fulfilled' ? reaction.onFulfilled : reaction.onRejected;

    if (handler === undefined || handler === null) {
      // No handler — propagate
      if (upstreamState.state === 'fulfilled') {
        fulfillPromise(downstream, upstreamState.result);
      } else {
        rejectPromise(downstream, upstreamState.result);
      }
      return;
    }

    if (typeof handler !== 'object' || handler === null || (handler as JSFunction).type !== 'closure') {
      // Not a function — propagate
      if (upstreamState.state === 'fulfilled') {
        fulfillPromise(downstream, upstreamState.result);
      } else {
        rejectPromise(downstream, upstreamState.result);
      }
      return;
    }

    try {
      const result = callJSFunction(handler as JSFunction, undefined, [upstreamState.result]);
      resolvePromise(downstream, result, evLoop);
    } catch (err) {
      rejectPromise(downstream, err instanceof Error ? err.message : String(err));
    }
  });
}

// WeakMap linking promise objects to their event loop (for microtask enqueuing)
const promiseEventLoops = new WeakMap<JSObject, EventLoop>();
// WeakMap linking reactions to their upstream promise
const reactionUpstreams = new WeakMap<PromiseReaction, JSObject>();

/** Create a promise with its event loop reference properly wired. */
export function createWiredPromise(eventLoop: EventLoop): JSObject {
  const p = createPromiseObj(eventLoop);
  promiseEventLoops.set(p, eventLoop);
  return p;
}

// ── .then() ─────────────────────────────────────────────────────────────────

function createPromiseProtoThen(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('then', (_this, args) => {
    if (typeof _this !== 'object' || _this === null || !isPromiseObject(_this)) {
      throw new TypeError('Object is not a Promise');
    }
    const upstream = _this as JSObject;
    const onFulfilled = args[0] !== undefined && args[0] !== null ? args[0] : undefined;
    const onRejected = args[1] !== undefined && args[1] !== null ? args[1] : undefined;

    if (onFulfilled !== undefined && typeof onFulfilled !== 'object') {
      throw new TypeError('Promise.then: first argument is not a function');
    }
    if (onRejected !== undefined && typeof onRejected !== 'object') {
      throw new TypeError('Promise.then: second argument is not a function');
    }

    const downstream = createPromiseObj(eventLoop);
    promiseEventLoops.set(downstream, eventLoop);

    const reaction: PromiseReaction = {
      onFulfilled: onFulfilled as JSValue,
      onRejected: onRejected as JSValue,
      promise: downstream,
    };
    reactionUpstreams.set(reaction, upstream);

    const upstreamState = getState(upstream);
    if (upstreamState.state === 'pending') {
      upstreamState.reactions.push(reaction);
    } else {
      enqueueReactionReaction(reaction);
    }

    return downstream;
  });
}

// ── .catch() ────────────────────────────────────────────────────────────────

function createPromiseProtoCatch(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('catch', (_this, args) => {
    if (typeof _this !== 'object' || _this === null || !isPromiseObject(_this)) {
      throw new TypeError('Object is not a Promise');
    }
    return callJSFunction(
      createPromiseProtoThen(eventLoop),
      _this,
      [undefined, args[0]],
    );
  });
}

// ── .finally() ──────────────────────────────────────────────────────────────

function createPromiseProtoFinally(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('finally', (_this, args) => {
    if (typeof _this !== 'object' || _this === null || !isPromiseObject(_this)) {
      throw new TypeError('Object is not a Promise');
    }
    const onFinally = args[0];
    const thenFn = createPromiseProtoThen(eventLoop);

    // Wrap onFinally to preserve value/re-throw
    const wrapper = createNativeFunction('wrapper', (_th, _a) => {
      const result = callJSFunction(onFinally as JSFunction, undefined, []);
      return promiseResolveValue(eventLoop, result);
    });

    return callJSFunction(thenFn, _this, [wrapper, wrapper]);
  });
}

// ── Promise constructor ─────────────────────────────────────────────────────

export function createPromiseConstructor(eventLoop: EventLoop): JSValue {
  const ctorFn = createNativeFunction('Promise', (_this, args) => {
    const executor = args[0];
    if (typeof executor !== 'object' || executor === null || (executor as JSFunction).type !== 'closure') {
      throw new TypeError('Promise constructor: argument is not a function');
    }

    const promise = createPromiseObj(eventLoop);
    promiseEventLoops.set(promise, eventLoop);

    const resolve = createNativeFunction('resolve', (_th, resolveArgs) => {
      resolvePromise(promise, resolveArgs[0], eventLoop);
      return undefined;
    });

    const reject = createNativeFunction('reject', (_th, rejectArgs) => {
      rejectPromise(promise, rejectArgs[0]);
      return undefined;
    });

    try {
      callJSFunction(executor as JSFunction, undefined, [resolve, reject]);
    } catch (err) {
      rejectPromise(promise, err instanceof Error ? err.message : String(err));
    }

    return promise;
  });

  // Wrap in a callable JSObject so we can attach .prototype and static methods
  const ctor = createObject(null);
  ctor.type = 'function';
  ctor.callable = true;
  ctor.nativeFn = ctorFn.nativeFn;

  // Set up Promise.prototype
  const promiseProto = createObject(null);
  promiseProto.properties.set('then', {
    value: createPromiseProtoThen(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  promiseProto.properties.set('catch', {
    value: createPromiseProtoCatch(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  promiseProto.properties.set('finally', {
    value: createPromiseProtoFinally(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  promiseProto.properties.set('constructor', {
    value: ctor,
    writable: true, enumerable: false, configurable: true,
  });
  ctor.properties.set('prototype', {
    value: promiseProto,
    writable: false, enumerable: false, configurable: false,
  });

  // Static methods
  ctor.properties.set('resolve', {
    value: createPromiseResolveFn(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  ctor.properties.set('reject', {
    value: createPromiseRejectFn(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  ctor.properties.set('all', {
    value: createPromiseAllFn(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  ctor.properties.set('race', {
    value: createPromiseRaceFn(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });
  ctor.properties.set('allSettled', {
    value: createPromiseAllSettledFn(eventLoop),
    writable: true, enumerable: false, configurable: true,
  });

  return ctor;
}

// ── Promise.resolve() ───────────────────────────────────────────────────────

function promiseResolveValue(eventLoop: EventLoop, x: JSValue): JSObject {
  if (isPromiseObject(x)) return x as JSObject;
  const p = createPromiseObj(eventLoop);
  promiseEventLoops.set(p, eventLoop);
  fulfillPromise(p, x);
  return p;
}

function createPromiseResolveFn(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('resolve', (_this, args) => {
    return promiseResolveValue(eventLoop, args[0]);
  });
}

// ── Promise.reject() ────────────────────────────────────────────────────────

function createPromiseRejectFn(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('reject', (_this, args) => {
    const r = args[0];
    const p = createPromiseObj(eventLoop);
    promiseEventLoops.set(p, eventLoop);
    rejectPromise(p, r);
    return p;
  });
}

// ── Promise.all() ───────────────────────────────────────────────────────────

function createPromiseAllFn(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('all', (_this, args) => {
    const promisesArg = args[0];
    const promisesArr = (typeof promisesArg === 'object' && promisesArg !== null && (promisesArg as JSObject).type === 'array')
      ? promisesArg as JSObject
      : createArray([]);

    const len = Number(promisesArr.properties.get('length')?.value ?? 0);
    if (len === 0) {
      const p = createPromiseObj(eventLoop);
      promiseEventLoops.set(p, eventLoop);
      fulfillPromise(p, createArray([]));
      return p;
    }

    const resultArr = createArray([]);
    let remaining = len;
    let rejected = false;

    const allPromise = createPromiseObj(eventLoop);
    promiseEventLoops.set(allPromise, eventLoop);

    for (let i = 0; i < len; i++) {
      const item = promisesArr.properties.get(String(i))?.value;
      const resolved = isPromiseObject(item) ? item : promiseResolveValue(eventLoop, item);

      const idx = i;
      const onFulfilled = createNativeFunction('onFulfilled', (_th, fArgs) => {
        if (rejected) return undefined;
        resultArr.properties.set(String(idx), {
          value: fArgs[0], writable: true, enumerable: true, configurable: true,
        });
        resultArr.properties.set('length', { value: len, writable: true, enumerable: false, configurable: false });
        remaining--;
        if (remaining === 0) {
          fulfillPromise(allPromise, resultArr);
        }
        return undefined;
      });
      const onRejected = createNativeFunction('onRejected', (_th, rArgs) => {
        if (rejected) return undefined;
        rejected = true;
        rejectPromise(allPromise, rArgs[0]);
        return undefined;
      });

      callJSFunction(
        (resolved as JSObject).properties.get('then')?.value as JSFunction,
        resolved,
        [onFulfilled, onRejected],
      );
    }

    return allPromise;
  });
}

// ── Promise.race() ──────────────────────────────────────────────────────────

function createPromiseRaceFn(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('race', (_this, args) => {
    const promisesArg = args[0];
    const promisesArr = (typeof promisesArg === 'object' && promisesArg !== null && (promisesArg as JSObject).type === 'array')
      ? promisesArg as JSObject
      : createArray([]);

    const len = Number(promisesArr.properties.get('length')?.value ?? 0);
    if (len === 0) {
      const p = createPromiseObj(eventLoop);
      promiseEventLoops.set(p, eventLoop);
      return p; // never settles
    }

    const racePromise = createPromiseObj(eventLoop);
    promiseEventLoops.set(racePromise, eventLoop);

    for (let i = 0; i < len; i++) {
      const item = promisesArr.properties.get(String(i))?.value;
      const resolved = isPromiseObject(item) ? item : promiseResolveValue(eventLoop, item);

      const onFulfilled = createNativeFunction('onFulfilled', (_th, fArgs) => {
        fulfillPromise(racePromise, fArgs[0]);
        return undefined;
      });
      const onRejected = createNativeFunction('onRejected', (_th, rArgs) => {
        rejectPromise(racePromise, rArgs[0]);
        return undefined;
      });

      callJSFunction(
        (resolved as JSObject).properties.get('then')?.value as JSFunction,
        resolved,
        [onFulfilled, onRejected],
      );
    }

    return racePromise;
  });
}

// ── Promise.allSettled() ────────────────────────────────────────────────────

function createPromiseAllSettledFn(eventLoop: EventLoop): JSFunction {
  return createNativeFunction('allSettled', (_this, args) => {
    const promisesArg = args[0];
    const promisesArr = (typeof promisesArg === 'object' && promisesArg !== null && (promisesArg as JSObject).type === 'array')
      ? promisesArg as JSObject
      : createArray([]);

    const len = Number(promisesArr.properties.get('length')?.value ?? 0);
    if (len === 0) {
      const p = createPromiseObj(eventLoop);
      promiseEventLoops.set(p, eventLoop);
      fulfillPromise(p, createArray([]));
      return p;
    }

    const resultArr = createArray([]);
    let remaining = len;

    const allPromise = createPromiseObj(eventLoop);
    promiseEventLoops.set(allPromise, eventLoop);

    for (let i = 0; i < len; i++) {
      const item = promisesArr.properties.get(String(i))?.value;
      const resolved = isPromiseObject(item) ? item : promiseResolveValue(eventLoop, item);

      const idx = i;
      const onFulfilled = createNativeFunction('onFulfilled', (_th, fArgs) => {
        const obj = createObject(null);
        obj.properties.set('status', { value: 'fulfilled', writable: false, enumerable: true, configurable: false });
        obj.properties.set('value', { value: fArgs[0], writable: false, enumerable: true, configurable: false });
        resultArr.properties.set(String(idx), {
          value: obj, writable: true, enumerable: true, configurable: true,
        });
        resultArr.properties.set('length', { value: len, writable: true, enumerable: false, configurable: false });
        remaining--;
        if (remaining === 0) fulfillPromise(allPromise, resultArr);
        return undefined;
      });
      const onRejected = createNativeFunction('onRejected', (_th, rArgs) => {
        const obj = createObject(null);
        obj.properties.set('status', { value: 'rejected', writable: false, enumerable: true, configurable: false });
        obj.properties.set('reason', { value: rArgs[0], writable: false, enumerable: true, configurable: false });
        resultArr.properties.set(String(idx), {
          value: obj, writable: true, enumerable: true, configurable: true,
        });
        resultArr.properties.set('length', { value: len, writable: true, enumerable: false, configurable: false });
        remaining--;
        if (remaining === 0) fulfillPromise(allPromise, resultArr);
        return undefined;
      });

      callJSFunction(
        (resolved as JSObject).properties.get('then')?.value as JSFunction,
        resolved,
        [onFulfilled, onRejected],
      );
    }

    return allPromise;
  });
}
