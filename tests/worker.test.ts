/**
 * tests/worker.test.ts
 *
 * Tests for Web Worker implementation:
 * - Worker creation and execution
 * - postMessage / onmessage communication (main ↔ worker)
 * - Worker isolation (no DOM access)
 * - terminate() (from main thread and inside worker)
 * - Structured clone for message passing
 * - WorkerParentPort JSObject wrapper
 * - Error handling
 * - Console, Math, JSON in worker context
 * - Timers in workers
 * - Closures, classes, and complex computation in workers
 */

import { describe, it, expect } from 'vitest';
import {
  Worker, WorkerState, WorkerParentPort,
  createWorkerConstructor, structuredCloneJSValue,
} from '../src/browser/js/worker';
import {
  createObject, createArray, createNativeFunction, Environment,
  toNumber, toString,
} from '../src/browser/js/values';
import type { JSValue, JSObject, JSFunction } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { createGlobalEnv } from '../src/browser/js/index';

function getProp(obj: JSObject, key: string): JSValue | undefined {
  return obj.properties.get(key)?.value;
}

describe('Worker', () => {
  describe('creation and execution', () => {
    it('should create a worker with default name', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      expect(worker.name).toBe('Worker');
      expect(worker.state).toBe(WorkerState.Running);
    });

    it('should create a worker with custom name', () => {
      const worker = new Worker('var x = 1;', 'test.js', { name: 'MyWorker' });
      expect(worker.name).toBe('MyWorker');
    });

    it('should execute script on start', () => {
      const worker = new Worker('var x = 1 + 2;', 'test.js');
      worker.start();
      expect(worker.state).toBe(WorkerState.Running);
    });

    it('should have isolated event loop', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      expect(worker.getEventLoop()).toBeInstanceOf(EventLoop);
    });

    it('should have isolated interpreter', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      expect(worker.getInterpreter()).toBeDefined();
    });
  });

  describe('worker → main thread (postMessage from worker)', () => {
    it('should receive postMessage("hello") from worker', () => {
      const worker = new Worker('postMessage("hello");', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('hello');
    });

    it('should receive object data from worker', () => {
      const worker = new Worker('postMessage({a: 1, b: "two"});', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      const obj = receivedData as JSObject;
      expect(getProp(obj, 'a')).toBe(1);
      expect(getProp(obj, 'b')).toBe('two');
    });

    it('should receive array data from worker', () => {
      const worker = new Worker('postMessage([1, 2, 3]);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      const arr = receivedData as JSObject;
      expect(getProp(arr, '0')).toBe(1);
      expect(getProp(arr, '1')).toBe(2);
      expect(getProp(arr, '2')).toBe(3);
    });

    it('should receive null from worker', () => {
      const worker = new Worker('postMessage(null);', 'test.js');
      let receivedData: JSValue | undefined = 'sentinel';
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBeNull();
    });

    it('should receive undefined from worker', () => {
      const worker = new Worker('postMessage(undefined);', 'test.js');
      let receivedData: JSValue | undefined = 'sentinel';
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBeUndefined();
    });

    it('should receive number from worker', () => {
      const worker = new Worker('postMessage(42);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(42);
    });

    it('should receive boolean from worker', () => {
      const worker = new Worker('postMessage(true);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(true);
    });

    it('should deep clone nested objects', () => {
      const worker = new Worker('postMessage({nested: {x: 10}});', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      const nested = getProp(receivedData as JSObject, 'nested') as JSObject;
      expect(getProp(nested, 'x')).toBe(10);
    });

    it('should support multiple message listeners', () => {
      const worker = new Worker('postMessage(1);', 'test.js');
      let count1 = 0, count2 = 0;
      worker.addEventListener('message', () => { count1++; });
      worker.addEventListener('message', () => { count2++; });
      worker.start();
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('should removeEventListener', () => {
      const worker = new Worker('postMessage(1);', 'test.js');
      let count = 0;
      const listener = () => { count++; };
      worker.addEventListener('message', listener);
      worker.removeEventListener('message', listener);
      worker.start();
      expect(count).toBe(0);
    });

    it('should receive multiple messages', () => {
      const worker = new Worker('postMessage(1); postMessage(2); postMessage(3);', 'test.js');
      const received: JSValue[] = [];
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') received.push(event.data);
      });
      worker.start();
      expect(received).toEqual([1, 2, 3]);
    });

    it('should receive postMessage with no data', () => {
      const worker = new Worker('postMessage();', 'test.js');
      let receivedData: JSValue = 'sentinel';
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBeUndefined();
    });
  });

  describe('main thread → worker (postMessage from main)', () => {
    it('should send message to worker via onmessage', () => {
      const worker = new Worker(
        `self.onmessage = function(e) { postMessage(e.data * 2); };`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();

      worker.postMessage(5);
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBe(10);
    });

    it('should send string data to worker', () => {
      const worker = new Worker(
        `self.onmessage = function(e) { postMessage("got:" + e.data); };`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();

      worker.postMessage("hello");
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBe('got:hello');
    });

    it('should send object data to worker', () => {
      const worker = new Worker(
        `self.onmessage = function(e) { postMessage(e.data.x + e.data.y); };`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();

      const obj = createObject(null);
      obj.properties.set('x', { value: 3, writable: true, enumerable: true, configurable: true });
      obj.properties.set('y', { value: 4, writable: true, enumerable: true, configurable: true });
      worker.postMessage(obj);
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBe(7);
    });

    it('should send multiple messages to worker', () => {
      const worker = new Worker(
        `var total = 0;
         self.onmessage = function(e) {
           total += e.data;
           postMessage(total);
         };`,
        'test.js',
      );
      const received: JSValue[] = [];
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') received.push(event.data);
      });
      worker.start();

      worker.postMessage(10);
      worker.getEventLoop().drainMicrotasks();
      worker.postMessage(20);
      worker.getEventLoop().drainMicrotasks();
      worker.postMessage(30);
      worker.getEventLoop().drainMicrotasks();

      expect(received).toEqual([10, 30, 60]);
    });
  });

  describe('isolation', () => {
    it('should not have document access', () => {
      const worker = new Worker(
        `postMessage(typeof document);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('undefined');
    });

    it('should not have window access', () => {
      const worker = new Worker(
        `postMessage(typeof window);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('undefined');
    });

    it('should have console', () => {
      const worker = new Worker('console.log("test"); postMessage("ok");', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('ok');
    });

    it('should have Math', () => {
      const worker = new Worker('postMessage(Math.PI);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBeCloseTo(Math.PI);
    });

    it('should have JSON', () => {
      const worker = new Worker('postMessage(JSON.parse(JSON.stringify({a:1})).a);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(1);
    });

    it('should have parseInt and parseFloat', () => {
      const worker = new Worker('postMessage(parseInt("42") + parseFloat("3.14"));', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBeCloseTo(45.14);
    });

    it('should have self reference', () => {
      const worker = new Worker('postMessage(typeof self);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('object');
    });
  });

  describe('terminate', () => {
    it('should terminate from main thread', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      worker.start();
      expect(worker.state).toBe(WorkerState.Running);
      worker.terminate();
      expect(worker.state).toBe(WorkerState.Terminated);
    });

    it('should terminate from inside worker', () => {
      const worker = new Worker('close();', 'test.js');
      worker.start();
      expect(worker.state).toBe(WorkerState.Terminated);
    });

    it('should terminate via WorkerParentPort', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      const port = new WorkerParentPort(worker);
      worker.start();
      const terminateFn = getProp(port.getJSObject(), 'terminate') as JSFunction;
      terminateFn.nativeFn!(port.getJSObject(), []);
      expect(worker.state).toBe(WorkerState.Terminated);
    });
  });

  describe('structuredCloneJSValue', () => {
    it('should clone primitives', () => {
      expect(structuredCloneJSValue(42)).toBe(42);
      expect(structuredCloneJSValue('hello')).toBe('hello');
      expect(structuredCloneJSValue(true)).toBe(true);
      expect(structuredCloneJSValue(null)).toBeNull();
      expect(structuredCloneJSValue(undefined)).toBeUndefined();
    });

    it('should clone objects (deep)', () => {
      const obj = createObject(null);
      obj.properties.set('x', { value: 1, writable: true, enumerable: true, configurable: true });
      const cloned = structuredCloneJSValue(obj) as JSObject;
      expect(getProp(cloned, 'x')).toBe(1);
      expect(cloned).not.toBe(obj);
    });

    it('should clone arrays', () => {
      const arr = createArray([1, 2, 3]);
      const cloned = structuredCloneJSValue(arr) as JSObject;
      expect(getProp(cloned, '0')).toBe(1);
      expect(getProp(cloned, '1')).toBe(2);
      expect(getProp(cloned, '2')).toBe(3);
    });

    it('should deep clone nested objects', () => {
      const inner = createObject(null);
      inner.properties.set('a', { value: 10, writable: true, enumerable: true, configurable: true });
      const outer = createObject(null);
      outer.properties.set('nested', { value: inner, writable: true, enumerable: true, configurable: true });
      const cloned = structuredCloneJSValue(outer) as JSObject;
      const clonedInner = getProp(cloned, 'nested') as JSObject;
      expect(getProp(clonedInner, 'a')).toBe(10);
    });
  });

  describe('WorkerParentPort', () => {
    it('should create a port with JSObject', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      const port = new WorkerParentPort(worker);
      expect(port.getJSObject()).toBeDefined();
      expect(port.getJSObject().type).toBe('object');
    });

    it('should have postMessage method', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      const port = new WorkerParentPort(worker);
      expect(getProp(port.getJSObject(), 'postMessage')).toBeDefined();
    });

    it('should have terminate method', () => {
      const worker = new Worker('var x = 1;', 'test.js');
      const port = new WorkerParentPort(worker);
      expect(getProp(port.getJSObject(), 'terminate')).toBeDefined();
    });

    it('should forward postMessage to worker', () => {
      const worker = new Worker(
        `self.onmessage = function(e) { postMessage(e.data + 1); };`,
        'test.js',
      );
      const port = new WorkerParentPort(worker);
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();

      const postMsgFn = getProp(port.getJSObject(), 'postMessage') as JSFunction;
      postMsgFn.nativeFn!(port.getJSObject(), [10]);
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBe(11);
    });
  });

  describe('createWorkerConstructor', () => {
    it('should create a Worker constructor function', () => {
      const eventLoop = new EventLoop();
      const WorkerCtor = createWorkerConstructor(eventLoop);
      expect(WorkerCtor).toBeDefined();
      expect(WorkerCtor.isNative).toBe(true);
    });

    it('should create workers via constructor', () => {
      const eventLoop = new EventLoop();
      const WorkerCtor = createWorkerConstructor(eventLoop);
      const workerObj = WorkerCtor.nativeFn!(undefined, ['console.log("hello");']);
      expect(workerObj).toBeDefined();
      const jsObj = workerObj as JSObject;
      expect(getProp(jsObj, 'postMessage')).toBeDefined();
      expect(getProp(jsObj, 'terminate')).toBeDefined();
    });

    it('should throw if no script URL provided', () => {
      const eventLoop = new EventLoop();
      const WorkerCtor = createWorkerConstructor(eventLoop);
      expect(() => WorkerCtor.nativeFn!(undefined, [])).toThrow();
    });

    it('should accept custom script loader', () => {
      const eventLoop = new EventLoop();
      const loader = (url: string) => `postMessage("loaded:${url}");`;
      const WorkerCtor = createWorkerConstructor(eventLoop, undefined, loader);
      const workerObj = WorkerCtor.nativeFn!(undefined, ['http://example.com/worker.js']);
      expect(workerObj).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors gracefully', () => {
      const worker = new Worker('function { invalid syntax', 'test.js');
      worker.start();
      expect(worker.state).toBe(WorkerState.Errored);
    });

    it('should emit error events', () => {
      const worker = new Worker('function { invalid', 'test.js');
      let errorReceived = false;
      worker.addEventListener('error', () => { errorReceived = true; });
      worker.start();
      expect(errorReceived).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty script', () => {
      const worker = new Worker('', 'test.js');
      worker.start();
      expect(worker.state).toBe(WorkerState.Running);
    });

    it('should handle nested function calls', () => {
      const worker = new Worker(
        `function add(a, b) { return a + b; }
         postMessage(add(3, 4));`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(7);
    });

    it('should handle complex computation', () => {
      const worker = new Worker(
        `var sum = 0;
         for (var i = 0; i < 100; i++) { sum += i; }
         postMessage(sum);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(4950);
    });

    it('should handle closures', () => {
      const worker = new Worker(
        `function makeCounter() {
           var count = 0;
           return function() { count++; return count; };
         }
         var counter = makeCounter();
         postMessage(counter());
         postMessage(counter());
         postMessage(counter());`,
        'test.js',
      );
      const received: JSValue[] = [];
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') received.push(event.data);
      });
      worker.start();
      expect(received).toEqual([1, 2, 3]);
    });

    it('should handle string concatenation', () => {
      const worker = new Worker('postMessage("Hello" + " " + "World");', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('Hello World');
    });

    it('should handle conditional logic', () => {
      const worker = new Worker(
        `var x = 10;
         if (x > 5) { postMessage("big"); } else { postMessage("small"); }`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('big');
    });

    it('should handle try-catch', () => {
      const worker = new Worker(
        `try { throw new Error("oops"); } catch(e) { postMessage(e.message); }`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('oops');
    });

    it('should handle object property access', () => {
      const worker = new Worker(
        `var obj = { name: "Nova", version: 1, active: true };
         postMessage(obj.name + ":" + obj.version);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('Nova:1');
    });

    it('should handle array indexing', () => {
      const worker = new Worker(
        `var arr = [[1, 2], [3, 4]];
         postMessage(arr[0][0] + arr[1][1]);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(5);
    });

    it('should handle map', () => {
      const worker = new Worker(
        `var nums = [1, 2, 3, 4, 5];
         var doubled = nums.map(function(x) { return x * 2; });
         postMessage(doubled[2]);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(6);
    });

    it('should handle class definitions', () => {
      const worker = new Worker(
        `class Point {
           constructor(x, y) { this.x = x; this.y = y; }
           distance() { return Math.sqrt(this.x * this.x + this.y * this.y); }
         }
         var p = new Point(3, 4);
         postMessage(p.distance());`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe(5);
    });

    it('should handle setTimeout in worker', () => {
      const worker = new Worker(
        `setTimeout(function() { postMessage(42); }, 10);`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      // Timer fires async — not immediately
      expect(receivedData).toBeUndefined();
    });

    it('should handle bidirectional communication', () => {
      const worker = new Worker(
        `self.onmessage = function(e) {
           var result = e.data * 3;
           postMessage(result);
         };`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();

      worker.postMessage(7);
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBe(21);
    });

    it('should not deliver messages after terminate', () => {
      const worker = new Worker(
        `self.onmessage = function(e) { postMessage(e.data); };`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      worker.terminate();

      worker.postMessage(99);
      worker.getEventLoop().drainMicrotasks();

      expect(receivedData).toBeUndefined();
    });
  });

  describe('Worker in global env', () => {
    it('should be available as a constructor in global env', () => {
      const eventLoop = new EventLoop();
      const doc = { createElement: () => ({}), createTextNode: () => ({}), children: [] } as any;
      const domTree = { querySelector: () => null, getElementById: () => null, insertBefore: () => {}, removeChild: () => {} } as any;
      const env = createGlobalEnv(doc, domTree, eventLoop);
      const workerCtor = env.get('Worker');
      expect(workerCtor).toBeDefined();
    });
  });

  describe('Promise in workers', () => {
    it('should have Promise available in worker scope', () => {
      const worker = new Worker('postMessage(typeof Promise);', 'test.js');
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      expect(receivedData).toBe('function');
    });

    it('should resolve Promise.resolve inside a worker', () => {
      const worker = new Worker(
        `Promise.resolve(42).then(function(v) { postMessage(v); });`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      worker.getEventLoop().drainMicrotasks();
      expect(receivedData).toBe(42);
    });

    it('should reject Promise.reject inside a worker', () => {
      const worker = new Worker(
        `Promise.reject("err").catch(function(e) { postMessage(e); });`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      worker.getEventLoop().drainMicrotasks();
      expect(receivedData).toBe('err');
    });

    it('should chain .then handlers on Promise in worker', () => {
      const worker = new Worker(
        `Promise.resolve(1).then(function(v) { return v + 1; }).then(function(v) { postMessage(v); });`,
        'test.js',
      );
      let receivedData: JSValue | undefined;
      worker.addEventListener('message', (event) => {
        if (event.type === 'message') receivedData = event.data;
      });
      worker.start();
      worker.getEventLoop().drainMicrotasks();
      expect(receivedData).toBe(2);
    });
  });
});
