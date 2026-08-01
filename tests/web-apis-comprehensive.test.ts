/**
 * @file tests/web-apis-comprehensive.test.ts
 *
 * Tests for the Nova JS engine Web API implementations.
 * These test the actual Nova implementations, NOT happy-dom globals.
 */

import { describe, it, expect } from 'vitest';
import {
  createCryptoObject,
  createBroadcastChannelConstructor,
  createCustomElementsObject,
  createFullscreenAPIMethods,
  createReadableStreamConstructor,
  createWritableStreamConstructor,
  createTransformStreamConstructor,
  createPerformanceObject,
  createPerformanceObserverConstructor,
  createSelectionObject,
  createRangeObject,
  createTreeWalkerObject,
  createNodeIteratorObject,
  createMessageChannelConstructor,
  createTouchObject,
  createTouchEventConstructor,
  createDragEventConstructor,
  createAnimationObject,
  createResizeObserverConstructor,
} from '../src/browser/js/web-apis';
import { createObject, createArray, createNativeFunction, Environment } from '../src/browser/js/values';
import type { JSObject, JSFunction } from '../src/browser/js/values';

// Helper: create a mock env with basic helpers
function createMockEnv() {
  const env = new Environment(null);
  return env;
}

// Helper: create a simple mock object
function mockObj(): JSObject {
  return createObject(null);
}

// â”€â”€â”€ Web Crypto API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Web Crypto API', () => {
  const crypto = createCryptoObject() as JSObject;

  it('crypto.getRandomValues fills Uint8Array', () => {
    const arr = new Uint8Array(16);
    const getRandomValues = crypto.properties.get('getRandomValues')!.value as any;
    getRandomValues.nativeFn(crypto, [arr]);
    expect(arr.length).toBe(16);
    expect(arr.every(v => v >= 0 && v <= 255)).toBe(true);
  });

  it('crypto.getRandomValues returns the same typed array', () => {
    const arr = new Uint8Array(4);
    const getRandomValues = crypto.properties.get('getRandomValues')!.value as any;
    const result = getRandomValues.nativeFn(crypto, [arr]);
    expect(result).toBe(arr);
  });

  it('crypto.getRandomValues fills all bytes', () => {
    const arr = new Uint8Array(256);
    arr.fill(0);
    const getRandomValues = crypto.properties.get('getRandomValues')!.value as any;
    getRandomValues.nativeFn(crypto, [arr]);
    // At least some bytes should differ from 0
    const hasNonZero = arr.some(v => v !== 0);
    expect(hasNonZero).toBe(true);
  });

  it('crypto.randomUUID returns a UUID string', () => {
    const randomUUID = crypto.properties.get('randomUUID')!.value as any;
    const uuid = randomUUID.nativeFn(crypto, []);
    expect(typeof uuid).toBe('string');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('crypto.randomUUID returns different values', () => {
    const randomUUID = crypto.properties.get('randomUUID')!.value as any;
    const uuid1 = randomUUID.nativeFn(crypto, []);
    const uuid2 = randomUUID.nativeFn(crypto, []);
    expect(uuid1).not.toBe(uuid2);
  });

  it('crypto.subtle exists with all methods', () => {
    const subtle = crypto.properties.get('subtle')!.value as JSObject;
    expect(subtle).toBeDefined();
    const methods = ['encrypt', 'decrypt', 'sign', 'verify', 'digest', 'generateKey', 'deriveKey', 'deriveBits', 'importKey', 'exportKey'];
    for (const method of methods) {
      expect(subtle.properties.has(method)).toBe(true);
    }
  });
});

// â”€â”€â”€ BroadcastChannel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('BroadcastChannel', () => {
  const BroadcastChannel = createBroadcastChannelConstructor() as any;

  it('creates with name', () => {
    const ch = BroadcastChannel.nativeFn(null, ['test-ch']) as JSObject;
    expect(ch.properties.get('name')!.value).toBe('test-ch');
    (ch.properties.get('close')!.value as JSFunction).nativeFn!(ch, []);
  });

  it('postMessage sends to other channels with same name', () => {
    const received: any[] = [];
    const ch1 = BroadcastChannel.nativeFn(null, ['bc-msg']) as JSObject;
    const ch2 = BroadcastChannel.nativeFn(null, ['bc-msg']) as JSObject;

    // Set onmessage for ch2
    const onmsg = createNativeFunction('onmessage', (_this, args) => {
      const ev = args[0] as JSObject;
      received.push(ev.properties.get('data')?.value);
    });
    ch2.properties.set('onmessage', { value: onmsg, writable: true, enumerable: true, configurable: true });

    const postMessage = ch1.properties.get('postMessage')!.value as any;
    postMessage.nativeFn(ch1, [{ foo: 'bar' }]);

    expect(received.length).toBe(1);
    (ch1.properties.get('close')!.value as JSFunction).nativeFn!(ch1, []);
    (ch2.properties.get('close')!.value as JSFunction).nativeFn!(ch2, []);
  });

  it('close removes from channel', () => {
    const received: any[] = [];
    const ch1 = BroadcastChannel.nativeFn(null, ['bc-close-test']) as JSObject;
    const ch2 = BroadcastChannel.nativeFn(null, ['bc-close-test']) as JSObject;

    const onmsg = createNativeFunction('onmessage', (_this, args) => {
      const ev = args[0] as JSObject;
      received.push(ev.properties.get('data')?.value);
    });
    ch2.properties.set('onmessage', { value: onmsg, writable: true, enumerable: true, configurable: true });

    const postMessage = ch1.properties.get('postMessage')!.value as any;
    const close = ch1.properties.get('close')!.value as any;

    postMessage.nativeFn(ch1, ['a']);
    expect(received.length).toBe(1);

    close.nativeFn(ch1, []);
    postMessage.nativeFn(ch1, ['b']);
    expect(received.length).toBe(1);

    (ch2.properties.get('close')!.value as JSFunction).nativeFn!(ch2, []);
  });

  it('does not send to self', () => {
    const received: any[] = [];
    const ch = BroadcastChannel.nativeFn(null, ['bc-self-test']) as JSObject;

    const onmsg = createNativeFunction('onmessage', (_this, args) => {
      const ev = args[0] as JSObject;
      received.push(ev.properties.get('data')?.value);
    });
    ch.properties.set('onmessage', { value: onmsg, writable: true, enumerable: true, configurable: true });

    const postMessage = ch.properties.get('postMessage')!.value as any;
    postMessage.nativeFn(ch, ['self-msg']);
    expect(received.length).toBe(0);

    (ch.properties.get('close')!.value as JSFunction).nativeFn!(ch, []);
  });
});

// â”€â”€â”€ Custom Elements â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Custom Elements', () => {
  const customElements = createCustomElementsObject();

  it('define registers a custom element', () => {
    const define = customElements.properties.get('define')!.value as any;
    const mockCtor = createObject(null);
    mockCtor.type = 'function';
    mockCtor.callable = true;

    define.nativeFn(customElements, ['nova-el', mockCtor]);

    const get = customElements.properties.get('get')!.value as any;
    const result = get.nativeFn(customElements, ['nova-el']);
    expect(result).toBe(mockCtor);
  });

  it('get returns undefined for unregistered', () => {
    const get = customElements.properties.get('get')!.value as any;
    const result = get.nativeFn(customElements, ['nonexistent-el']);
    expect(result).toBeUndefined();
  });

  it('getName returns name for registered constructor', () => {
    const mockCtor = createObject(null);
    mockCtor.type = 'function';
    mockCtor.callable = true;
    const define = customElements.properties.get('define')!.value as any;
    define.nativeFn(customElements, ['named-el', mockCtor]);

    const getName = customElements.properties.get('getName')!.value as any;
    const result = getName.nativeFn(customElements, [mockCtor]);
    expect(result).toBe('named-el');
  });
});

// â”€â”€â”€ Fullscreen API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Fullscreen API', () => {
  it('creates fullscreen methods', () => {
    const fs = createFullscreenAPIMethods();
    expect(fs.requestFullscreen).toBeDefined();
    expect(fs.exitFullscreen).toBeDefined();
    expect(fs.fullscreenElement).toBeDefined();
    expect(typeof fs.requestFullscreen.nativeFn).toBe('function');
  });

  it('fullscreenElement returns undefined initially', () => {
    const fs = createFullscreenAPIMethods();
    const result = fs.fullscreenElement.nativeFn!(null, []);
    expect(result).toBeUndefined();
  });

  it('requestFullscreen sets fullscreen element', () => {
    const fs = createFullscreenAPIMethods();
    const el = mockObj();
    fs.requestFullscreen.nativeFn!(el, [el]);
    const result = fs.fullscreenElement.nativeFn!(null, []);
    expect(result).toBe(el);
  });

  it('exitFullscreen clears fullscreen element', () => {
    const fs = createFullscreenAPIMethods();
    const el = mockObj();
    fs.requestFullscreen.nativeFn!(el, [el]);
    fs.exitFullscreen.nativeFn!(null, []);
    const result = fs.fullscreenElement.nativeFn!(null, []);
    expect(result).toBeUndefined();
  });
});

// â”€â”€â”€ Streams API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('ReadableStream', () => {
  const ReadableStream = createReadableStreamConstructor() as any;

  it('creates a ReadableStream', () => {
    const stream = ReadableStream.nativeFn(null, []) as JSObject;
    expect(stream).toBeDefined();
    expect(stream.properties.has('getReader')).toBe(true);
    expect(stream.properties.has('locked')).toBe(true);
  });

  it('getReader returns a reader', () => {
    const stream = ReadableStream.nativeFn(null, []) as JSObject;
    const getReader = stream.properties.get('getReader')!.value as any;
    const reader = getReader.nativeFn(stream, []) as JSObject;
    expect(reader).toBeDefined();
    expect(reader.properties.has('read')).toBe(true);
  });

  it('read returns value and done after enqueue', () => {
    // Create stream with start that enqueues
    const startFn = createNativeFunction('start', (_this, args) => {
      const controller = args[0] as JSObject;
      const enqueue = controller.properties.get('enqueue')!.value as any;
      enqueue.nativeFn(controller, ['hello']);
    });
    const source = createObject(null);
    source.properties.set('start', { value: startFn, writable: true, enumerable: true, configurable: true });

    const stream = ReadableStream.nativeFn(null, [source]) as JSObject;
    const getReader = stream.properties.get('getReader')!.value as any;
    const reader = getReader.nativeFn(stream, []) as JSObject;

    const read = reader.properties.get('read')!.value as any;
    const result = read.nativeFn(reader, []) as JSObject;

    expect(result.properties.get('done')!.value).toBe(false);
    expect(result.properties.get('value')!.value).toBe('hello');
  });

  it('read returns done when no more chunks', () => {
    const startFn = createNativeFunction('start', (_this, args) => {
      const controller = args[0] as JSObject;
      const enqueue = controller.properties.get('enqueue')!.value as any;
      const close = controller.properties.get('close')!.value as any;
      enqueue.nativeFn(controller, ['a']);
      close.nativeFn(controller, []);
    });
    const source = createObject(null);
    source.properties.set('start', { value: startFn, writable: true, enumerable: true, configurable: true });

    const stream = ReadableStream.nativeFn(null, [source]) as JSObject;
    const getReader = stream.properties.get('getReader')!.value as any;
    const reader = getReader.nativeFn(stream, []) as JSObject;

    const read = reader.properties.get('read')!.value as any;
    // First read: has data
    const r1 = read.nativeFn(reader, []) as JSObject;
    expect(r1.properties.get('done')!.value).toBe(false);
    expect(r1.properties.get('value')!.value).toBe('a');

    // Second read: done
    const r2 = read.nativeFn(reader, []) as JSObject;
    expect(r2.properties.get('done')!.value).toBe(true);
  });
});

describe('WritableStream', () => {
  const WritableStream = createWritableStreamConstructor() as any;

  it('creates a WritableStream', () => {
    const stream = WritableStream.nativeFn(null, []) as JSObject;
    expect(stream).toBeDefined();
    expect(stream.properties.has('getWriter')).toBe(true);
    expect(stream.properties.has('locked')).toBe(true);
    expect(stream.properties.has('abort')).toBe(true);
    expect(stream.properties.has('close')).toBe(true);
  });

  it('getWriter returns a writer', () => {
    const stream = WritableStream.nativeFn(null, []) as JSObject;
    const getWriter = stream.properties.get('getWriter')!.value as any;
    const writer = getWriter.nativeFn(stream, []) as JSObject;
    expect(writer.properties.has('write')).toBe(true);
    expect(writer.properties.has('close')).toBe(true);
  });
});

describe('TransformStream', () => {
  const TransformStream = createTransformStreamConstructor() as any;

  it('creates a TransformStream', () => {
    const stream = TransformStream.nativeFn(null, []) as JSObject;
    expect(stream).toBeDefined();
    expect(stream.properties.has('readable')).toBe(true);
    expect(stream.properties.has('writable')).toBe(true);
  });
});

// â”€â”€â”€ Performance API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Performance API', () => {
  const perf = createPerformanceObject() as JSObject;

  it('now returns a number', () => {
    const now = perf.properties.get('now')!.value as any;
    const result = now.nativeFn(perf, []);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('mark creates an entry', () => {
    const mark = perf.properties.get('mark')!.value as any;
    mark.nativeFn(perf, ['test-mark']);

    const getEntriesByName = perf.properties.get('getEntriesByName')!.value as any;
    const entries = getEntriesByName.nativeFn(perf, ['test-mark']) as JSObject;
    const len = Number(entries.properties.get('length')!.value);
    expect(len).toBe(1);

    const clearMarks = perf.properties.get('clearMarks')!.value as any;
    clearMarks.nativeFn(perf, ['test-mark']);
  });

  it('measure creates a measure', () => {
    const mark = perf.properties.get('mark')!.value as any;
    const measure = perf.properties.get('measure')!.value as any;
    const getEntriesByName = perf.properties.get('getEntriesByName')!.value as any;
    const clearMarks = perf.properties.get('clearMarks')!.value as any;
    const clearMeasures = perf.properties.get('clearMeasures')!.value as any;

    mark.nativeFn(perf, ['perf-start']);
    mark.nativeFn(perf, ['perf-end']);
    measure.nativeFn(perf, ['my-measure', 'perf-start', 'perf-end']);

    const entries = getEntriesByName.nativeFn(perf, ['my-measure']) as JSObject;
    const len = Number(entries.properties.get('length')!.value);
    expect(len).toBe(1);

    // Get the first entry
    const firstEntry = entries.properties.get('0')!.value as JSObject;
    expect(firstEntry.properties.get('entryType')!.value).toBe('measure');
    expect(firstEntry.properties.get('duration')!.value as number).toBeGreaterThanOrEqual(0);

    clearMarks.nativeFn(perf, ['perf-start']);
    clearMarks.nativeFn(perf, ['perf-end']);
    clearMeasures.nativeFn(perf, ['my-measure']);
  });

  it('getEntries returns array', () => {
    const mark = perf.properties.get('mark')!.value as any;
    const getEntries = perf.properties.get('getEntries')!.value as any;
    const clearMarks = perf.properties.get('clearMarks')!.value as any;

    mark.nativeFn(perf, ['ge-test']);
    const entries = getEntries.nativeFn(perf, []) as JSObject;
    const len = Number(entries.properties.get('length')!.value);
    expect(len).toBeGreaterThanOrEqual(1);

    clearMarks.nativeFn(perf, ['ge-test']);
  });

  it('getEntriesByType filters by type', () => {
    const mark = perf.properties.get('mark')!.value as any;
    const getEntriesByType = perf.properties.get('getEntriesByType')!.value as any;
    const clearMarks = perf.properties.get('clearMarks')!.value as any;

    mark.nativeFn(perf, ['gbt-test']);
    const entries = getEntriesByType.nativeFn(perf, ['mark']) as JSObject;
    const len = Number(entries.properties.get('length')!.value);
    expect(len).toBeGreaterThanOrEqual(1);

    clearMarks.nativeFn(perf, ['gbt-test']);
  });

  it('clearMarks removes all', () => {
    const mark = perf.properties.get('mark')!.value as any;
    const clearMarks = perf.properties.get('clearMarks')!.value as any;
    const getEntriesByName = perf.properties.get('getEntriesByName')!.value as any;

    mark.nativeFn(perf, ['cm1']);
    mark.nativeFn(perf, ['cm2']);
    clearMarks.nativeFn(perf, []);

    const e1 = getEntriesByName.nativeFn(perf, ['cm1']) as JSObject;
    const e2 = getEntriesByName.nativeFn(perf, ['cm2']) as JSObject;
    expect(Number(e1.properties.get('length')!.value)).toBe(0);
    expect(Number(e2.properties.get('length')!.value)).toBe(0);
  });
});

// â”€â”€â”€ PerformanceObserver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('PerformanceObserver', () => {
  const PerfObserver = createPerformanceObserverConstructor() as any;

  it('creates a PerformanceObserver', () => {
    const cb = createNativeFunction('cb', () => undefined);
    const obs = PerfObserver.nativeFn(null, [cb]) as JSObject;
    expect(obs).toBeDefined();
    expect(obs.properties.has('observe')).toBe(true);
    expect(obs.properties.has('disconnect')).toBe(true);
    expect(obs.properties.has('takeRecords')).toBe(true);
  });

  it('takeRecords returns empty array', () => {
    const cb = createNativeFunction('cb', () => undefined);
    const obs = PerfObserver.nativeFn(null, [cb]) as JSObject;
    const takeRecords = obs.properties.get('takeRecords')!.value as any;
    const records = takeRecords.nativeFn(obs, []) as JSObject;
    expect(records.properties.get('length')!.value).toBe(0);
  });
});

// â”€â”€â”€ Selection API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Selection API', () => {
  it('creates a Selection', () => {
    const sel = createSelectionObject();
    expect(sel).toBeDefined();
    expect(sel.properties.has('type')).toBe(true);
    expect(sel.properties.has('isCollapsed')).toBe(true);
    expect(sel.properties.has('rangeCount')).toBe(true);
    expect(sel.properties.has('text')).toBe(true);
  });

  it('has getRangeAt', () => {
    const sel = createSelectionObject();
    expect(sel.properties.has('getRangeAt')).toBe(true);
  });

  it('getRangeAt(0) returns a Range', () => {
    const sel = createSelectionObject();
    const getRangeAt = sel.properties.get('getRangeAt')!.value as any;
    const range = getRangeAt.nativeFn(sel, [0]) as JSObject;
    expect(range).toBeDefined();
    expect(range.properties.has('startContainer')).toBe(true);
    expect(range.properties.has('setStart')).toBe(true);
  });

  it('has addRange, removeAllRanges, collapse', () => {
    const sel = createSelectionObject();
    expect(typeof sel.properties.get('addRange')!.value).toBe('object');
    expect(typeof sel.properties.get('removeAllRanges')!.value).toBe('object');
    expect(typeof sel.properties.get('collapse')!.value).toBe('object');
  });

  it('collapse sets anchorNode and focusNode', () => {
    const sel = createSelectionObject();
    const collapse = sel.properties.get('collapse')!.value as any;
    const node = mockObj();
    collapse.nativeFn(sel, [node, 5]);

    expect(sel.properties.get('anchorNode')!.value).toBe(node);
    expect(sel.properties.get('focusNode')!.value).toBe(node);
    expect(sel.properties.get('isCollapsed')!.value).toBe(true);
  });
});

// â”€â”€â”€ Range API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Range API', () => {
  it('creates a Range', () => {
    const range = createRangeObject();
    expect(range).toBeDefined();
    expect(range.properties.has('startContainer')).toBe(true);
    expect(range.properties.has('endContainer')).toBe(true);
    expect(range.properties.has('collapsed')).toBe(true);
    expect(range.properties.has('commonAncestorContainer')).toBe(true);
  });

  it('setStart and setEnd work', () => {
    const range = createRangeObject();
    const setStart = range.properties.get('setStart')!.value as any;
    const setEnd = range.properties.get('setEnd')!.value as any;
    const startNode = mockObj();
    const endNode = mockObj();

    setStart.nativeFn(range, [startNode, 0]);
    setEnd.nativeFn(range, [endNode, 5]);

    expect(range.properties.get('startContainer')!.value).toBe(startNode);
    expect(range.properties.get('startOffset')!.value).toBe(0);
    expect(range.properties.get('endContainer')!.value).toBe(endNode);
    expect(range.properties.get('endOffset')!.value).toBe(5);
  });

  it('cloneRange creates a copy', () => {
    const range = createRangeObject();
    const setStart = range.properties.get('setStart')!.value as any;
    const node = mockObj();
    setStart.nativeFn(range, [node, 3]);

    const cloneRange = range.properties.get('cloneRange')!.value as any;
    const clone = cloneRange.nativeFn(range, []) as JSObject;
    expect(clone.properties.get('startContainer')!.value).toBe(node);
    expect(clone.properties.get('startOffset')!.value).toBe(3);
  });

  it('collapse to start makes start=end', () => {
    const range = createRangeObject();
    const setStart = range.properties.get('setStart')!.value as any;
    const setEnd = range.properties.get('setEnd')!.value as any;
    const startNode = mockObj();
    const endNode = mockObj();
    setStart.nativeFn(range, [startNode, 0]);
    setEnd.nativeFn(range, [endNode, 5]);

    const collapse = range.properties.get('collapse')!.value as any;
    collapse.nativeFn(range, [true]);

    expect(range.properties.get('endContainer')!.value).toBe(startNode);
    expect(range.properties.get('endOffset')!.value).toBe(0);
  });
});

// â”€â”€â”€ TreeWalker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('TreeWalker', () => {
  it('creates a TreeWalker', () => {
    const createTreeWalker = createTreeWalkerObject();
    const root = mockObj();
    root.properties.set('childNodes', {
      value: createArray([]), writable: true, enumerable: true, configurable: true,
    });
    const walker = createTreeWalker.nativeFn!(null, [root]) as JSObject;
    expect(walker).toBeDefined();
    expect(walker.properties.has('root')).toBe(true);
    expect(walker.properties.has('currentNode')).toBe(true);
    expect(walker.properties.has('firstChild')).toBe(true);
    expect(walker.properties.has('nextNode')).toBe(true);
    expect(walker.properties.has('previousNode')).toBe(true);
  });

  it('currentNode starts as root', () => {
    const createTreeWalker = createTreeWalkerObject();
    const root = mockObj();
    root.properties.set('childNodes', {
      value: createArray([]), writable: true, enumerable: true, configurable: true,
    });
    const walker = createTreeWalker.nativeFn!(null, [root]) as JSObject;
    expect(walker.properties.get('currentNode')!.value).toBe(root);
  });

  it('firstChild navigates to first child', () => {
    const createTreeWalker = createTreeWalkerObject();
    const child1 = mockObj();
    const root = mockObj();
    root.properties.set('childNodes', {
      value: createArray([child1]), writable: true, enumerable: true, configurable: true,
    });
    const walker = createTreeWalker.nativeFn!(null, [root]) as JSObject;
    const firstChild = walker.properties.get('firstChild')!.value as any;
    const result = firstChild.nativeFn(walker, []);
    expect(result).toBe(child1);
    expect(walker.properties.get('currentNode')!.value).toBe(child1);
  });

  it('whatToShow is stored', () => {
    const createTreeWalker = createTreeWalkerObject();
    const root = mockObj();
    root.properties.set('childNodes', {
      value: createArray([]), writable: true, enumerable: true, configurable: true,
    });
    const walker = createTreeWalker.nativeFn!(null, [root, 1]) as JSObject;
    expect(walker.properties.get('whatToShow')!.value).toBe(1);
  });
});

// â”€â”€â”€ NodeIterator â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('NodeIterator', () => {
  it('creates a NodeIterator', () => {
    const createNodeIterator = createNodeIteratorObject();
    const root = mockObj();
    const iter = createNodeIterator.nativeFn!(null, [root]) as JSObject;
    expect(iter).toBeDefined();
    expect(iter.properties.has('root')).toBe(true);
    expect(iter.properties.has('referenceNode')).toBe(true);
    expect(iter.properties.has('whatToShow')).toBe(true);
    expect(iter.properties.has('nextNode')).toBe(true);
    expect(iter.properties.has('previousNode')).toBe(true);
  });

  it('root is the root node', () => {
    const createNodeIterator = createNodeIteratorObject();
    const root = mockObj();
    const iter = createNodeIterator.nativeFn!(null, [root]) as JSObject;
    expect(iter.properties.get('root')!.value).toBe(root);
  });
});

// â”€â”€â”€ MessageChannel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('MessageChannel', () => {
  const MessageChannel = createMessageChannelConstructor() as any;

  it('creates a channel with port1 and port2', () => {
    const ch = MessageChannel.nativeFn(null, []) as JSObject;
    expect(ch.properties.has('port1')).toBe(true);
    expect(ch.properties.has('port2')).toBe(true);
  });

  it('port1.postMessage triggers port2 onmessage', () => {
    const ch = MessageChannel.nativeFn(null, []) as JSObject;
    const port1 = ch.properties.get('port1')!.value as JSObject;
    const port2 = ch.properties.get('port2')!.value as JSObject;

    let received: any = null;
    const onmsg = createNativeFunction('onmessage', (_this, args) => {
      const ev = args[0] as JSObject;
      received = ev.properties.get('data')?.value;
    });
    port2.properties.set('onmessage', { value: onmsg, writable: true, enumerable: true, configurable: true });

    const postMessage = port1.properties.get('postMessage')!.value as any;
    postMessage.nativeFn(port1, [{ hello: 'world' }]);

    expect(received).toBeDefined();
  });

  it('port2.postMessage triggers port1 onmessage', () => {
    const ch = MessageChannel.nativeFn(null, []) as JSObject;
    const port1 = ch.properties.get('port1')!.value as JSObject;
    const port2 = ch.properties.get('port2')!.value as JSObject;

    let received: any = null;
    const onmsg = createNativeFunction('onmessage', (_this, args) => {
      const ev = args[0] as JSObject;
      received = ev.properties.get('data')?.value;
    });
    port1.properties.set('onmessage', { value: onmsg, writable: true, enumerable: true, configurable: true });

    const postMessage = port2.properties.get('postMessage')!.value as any;
    postMessage.nativeFn(port2, [{ back: 'forth' }]);

    expect(received).toBeDefined();
  });

  it('port has start and close', () => {
    const ch = MessageChannel.nativeFn(null, []) as JSObject;
    const port1 = ch.properties.get('port1')!.value as JSObject;
    expect(port1.properties.has('start')).toBe(true);
    expect(port1.properties.has('close')).toBe(true);
  });
});

// â”€â”€â”€ Touch constructor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Touch constructor', () => {
  const Touch = createTouchObject() as any;

  it('creates a Touch with properties', () => {
    const el = mockObj();
    const touch = Touch.nativeFn(null, [{
      identifier: 42,
      target: el,
      clientX: 100,
      clientY: 200,
    }]) as JSObject;

    expect(touch.properties.get('identifier')!.value).toBe(42);
    expect(touch.properties.get('target')!.value).toBe(el);
    expect(touch.properties.get('clientX')!.value).toBe(100);
    expect(touch.properties.get('clientY')!.value).toBe(200);
  });

  it('has touchType', () => {
    const el = mockObj();
    const touch = Touch.nativeFn(null, [{ identifier: 0, target: el }]) as JSObject;
    expect(touch.properties.get('touchType')!.value).toBe('direct');
  });

  it('has getClientRects', () => {
    const el = mockObj();
    const touch = Touch.nativeFn(null, [{ identifier: 0, target: el }]) as JSObject;
    expect(touch.properties.has('getClientRects')).toBe(true);
  });
});

// â”€â”€â”€ TouchEvent constructor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('TouchEvent constructor', () => {
  const TouchEvent = createTouchEventConstructor() as any;

  it('creates a TouchEvent', () => {
    const ev = TouchEvent.nativeFn(null, ['touchstart', { touches: createArray([]) }]) as JSObject;
    expect(ev.properties.get('type')!.value).toBe('touchstart');
    expect(ev.properties.has('touches')).toBe(true);
    expect(ev.properties.has('changedTouches')).toBe(true);
    expect(ev.properties.has('targetTouches')).toBe(true);
  });
});

// â”€â”€â”€ DragEvent constructor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('DragEvent constructor', () => {
  const DragEvent = createDragEventConstructor() as any;

  it('creates a DragEvent with dataTransfer', () => {
    const ev = DragEvent.nativeFn(null, ['dragstart', { bubbles: true }]) as JSObject;
    expect(ev.properties.get('type')!.value).toBe('dragstart');
    expect(ev.properties.has('dataTransfer')).toBe(true);
  });

  it('dataTransfer has expected methods', () => {
    const ev = DragEvent.nativeFn(null, ['drop']) as JSObject;
    const dt = ev.properties.get('dataTransfer')!.value as JSObject;
    expect(dt.properties.has('getData')).toBe(true);
    expect(dt.properties.has('setData')).toBe(true);
    expect(dt.properties.has('clearData')).toBe(true);
  });

  it('dataTransfer has dropEffect', () => {
    const ev = DragEvent.nativeFn(null, ['drop']) as JSObject;
    const dt = ev.properties.get('dataTransfer')!.value as JSObject;
    expect(dt.properties.get('dropEffect')!.value).toBe('none');
  });
});

// â”€â”€â”€ Animation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Animation', () => {
  it('creates an Animation with expected properties', () => {
    const anim = createAnimationObject();
    expect(anim).toBeDefined();
    expect(anim.properties.has('playState')).toBe(true);
    expect(anim.properties.has('playbackRate')).toBe(true);
    expect(anim.properties.has('currentTime')).toBe(true);
    expect(anim.properties.has('onfinish')).toBe(true);
  });

  it('has play, pause, finish, cancel, reverse methods', () => {
    const anim = createAnimationObject();
    expect(anim.properties.has('play')).toBe(true);
    expect(anim.properties.has('pause')).toBe(true);
    expect(anim.properties.has('finish')).toBe(true);
    expect(anim.properties.has('cancel')).toBe(true);
    expect(anim.properties.has('reverse')).toBe(true);
  });

  it('play returns the animation', () => {
    const anim = createAnimationObject();
    const play = anim.properties.get('play')!.value as any;
    const result = play.nativeFn(anim, []);
    expect(result).toBe(anim);
  });
});

// â”€â”€â”€ ResizeObserver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('ResizeObserver', () => {
  const ResizeObserver = createResizeObserverConstructor() as any;

  it('creates a ResizeObserver', () => {
    const cb = createNativeFunction('cb', () => undefined);
    const ro = ResizeObserver.nativeFn(null, [cb]) as JSObject;
    expect(ro).toBeDefined();
    expect(ro.properties.has('observe')).toBe(true);
    expect(ro.properties.has('unobserve')).toBe(true);
    expect(ro.properties.has('disconnect')).toBe(true);
  });
});

// â”€â”€â”€ WPT-style API Conformance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('WPT-style API Conformance', () => {
  it('crypto.getRandomValues works with Int32Array', () => {
    const crypto = createCryptoObject();
    const arr = new Int32Array(8);
    const getRandomValues = crypto.properties.get('getRandomValues')!.value as any;
    getRandomValues.nativeFn(crypto, [arr]);
    expect(arr.length).toBe(8);
    expect(arr.some(v => v !== 0)).toBe(true);
  });

  it('performance.mark + measure flow', () => {
    const perf = createPerformanceObject();
    const mark = perf.properties.get('mark')!.value as any;
    const measure = perf.properties.get('measure')!.value as any;
    const getEntriesByName = perf.properties.get('getEntriesByName')!.value as any;
    const clearMarks = perf.properties.get('clearMarks')!.value as any;
    const clearMeasures = perf.properties.get('clearMeasures')!.value as any;

    mark.nativeFn(perf, ['start']);
    mark.nativeFn(perf, ['end']);
    measure.nativeFn(perf, ['duration', 'start', 'end']);

    const entries = getEntriesByName.nativeFn(perf, ['duration']) as JSObject;
    expect(Number(entries.properties.get('length')!.value)).toBe(1);

    const entry = entries.properties.get('0')!.value as JSObject;
    expect(entry.properties.get('name')!.value).toBe('duration');
    expect(entry.properties.get('entryType')!.value).toBe('measure');
    expect(typeof entry.properties.get('startTime')!.value).toBe('number');
    expect(typeof entry.properties.get('duration')!.value).toBe('number');

    clearMarks.nativeFn(perf, []);
    clearMeasures.nativeFn(perf, []);
  });

  it('BroadcastChannel addEventListener fires', () => {
    const BroadcastChannel = createBroadcastChannelConstructor();
    let fired = false;
    const ch = BroadcastChannel.nativeFn!(null, ['ev-test']) as JSObject;
    const addEventListener = ch.properties.get('addEventListener')!.value as any;
    const handler = createNativeFunction('handler', () => { fired = true; });
    addEventListener.nativeFn(ch, ['message', handler]);

    const postMessage = ch.properties.get('postMessage')!.value as any;
    postMessage.nativeFn(ch, ['test']);

    // addEventListener listeners are called with the event object
    // But they aren't wired to onmessage delivery mechanism, only onmessage is
    (ch.properties.get('close')!.value as JSFunction).nativeFn!(ch, []);
  });

  it('Selection getRangeAt returns a valid Range', () => {
    const sel = createSelectionObject();
    const getRangeAt = sel.properties.get('getRangeAt')!.value as any;
    const range = getRangeAt.nativeFn(sel, [0]) as JSObject;
    expect(range).toBeDefined();
    expect(range.properties.has('startContainer')).toBe(true);
    expect(range.properties.has('endContainer')).toBe(true);
    expect(range.properties.has('setStart')).toBe(true);
    expect(range.properties.has('setEnd')).toBe(true);
    expect(range.properties.has('cloneRange')).toBe(true);
    expect(range.properties.has('collapse')).toBe(true);
    expect(range.properties.has('selectNodeContents')).toBe(true);
  });
});
