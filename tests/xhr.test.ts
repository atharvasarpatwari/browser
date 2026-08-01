// ─────────────────────────────────────────────────────────────────────────────
// XMLHttpRequest Tests — Constructor, open/send/abort, events, headers, CORS
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createXMLHttpRequestClass, UNSENT, OPENED, HEADERS_RECEIVED, LOADING, DONE } from '../src/browser/js/xhr';
import { createEventDispatcher, fireEvent, clearEventListeners } from '../src/browser/js/xhr-bindings';
import { EventLoop } from '../src/browser/js/event-loop';
import { Interpreter } from '../src/browser/js/interpreter';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import type { JSValue, JSObject, JSFunction } from '../src/browser/js/values';
import { createObject, createNativeFunction } from '../src/browser/js/values';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getProp(obj: JSObject, name: string): JSValue {
  return obj.properties.get(name)?.value;
}

function setProp(obj: JSObject, name: string, value: JSValue): void {
  obj.properties.set(name, { value, writable: true, enumerable: true, configurable: true });
}

function createTestEventLoop(): EventLoop {
  const el = new EventLoop();
  const interp = new Interpreter(undefined, el);
  return el;
}

function callJSFn(fn: JSFunction, thisArg: JSValue, args: JSValue[]): JSValue {
  return fn.nativeFn!(thisArg, args) as JSValue;
}

function buildXhr(el: EventLoop): JSObject {
  const ctor = createXMLHttpRequestClass(el);
  const fn = ctor.properties.get('nativeFn')?.value as JSFunction;
  return callJSFn(fn, ctor, []) as JSObject;
}

function callMethod(obj: JSObject, name: string, ...args: JSValue[]): JSValue {
  const fn = obj.properties.get(name)?.value as JSFunction;
  return callJSFn(fn, obj, args);
}

function callCtor(ctor: JSObject, ...args: JSValue[]): JSObject {
  const fn = ctor.properties.get('nativeFn')?.value as JSFunction;
  return callJSFn(fn, ctor, args) as JSObject;
}

async function drainAll(el: EventLoop): Promise<void> {
  for (let i = 0; i < 10; i++) {
    el.drainMicrotasks();
    await new Promise(r => setTimeout(r, 0));
  }
  el.drainMicrotasks();
}

// ── Mock helpers ─────────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

function mockFetch(
  responseBody: string,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {},
) {
  const { status = 200, statusText = 'OK', headers = {} } = init;
  const hdrs = new Headers(headers);
  const mockResponse = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: hdrs,
    text: () => Promise.resolve(responseBody),
  };
  globalThis.fetch = vi.fn(() => Promise.resolve(mockResponse)) as unknown as typeof globalThis.fetch;
}

function mockFetchReject(errorMsg: string) {
  globalThis.fetch = vi.fn(() => Promise.reject(new Error(errorMsg))) as unknown as typeof globalThis.fetch;
}

function mockFetchNetworkError() {
  globalThis.fetch = vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof globalThis.fetch;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Constructor & Defaults
// ═══════════════════════════════════════════════════════════════════════════════

describe('XMLHttpRequest', () => {
  let el: EventLoop;

  beforeEach(() => {
    el = createTestEventLoop();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an XMLHttpRequest instance', () => {
      const xhr = buildXhr(el);
      expect(xhr).toBeDefined();
      expect(typeof xhr).toBe('object');
    });

    it('should have readyState UNSENT (0) initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'readyState')).toBe(UNSENT);
    });

    it('should have status 0 initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'status')).toBe(0);
    });

    it('should have empty statusText initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'statusText')).toBe('');
    });

    it('should have empty responseText initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'responseText')).toBe('');
    });

    it('should have empty response initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'response')).toBe('');
    });

    it('should have empty responseURL initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'responseURL')).toBe('');
    });

    it('should have empty responseType initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'responseType')).toBe('');
    });

    it('should have timeout 0 initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'timeout')).toBe(0);
    });

    it('should have withCredentials false initially', () => {
      const xhr = buildXhr(el);
      expect(getProp(xhr, 'withCredentials')).toBe(false);
    });
  });

  describe('static constants', () => {
    it('should have UNSENT = 0 on constructor', () => {
      const ctor = createXMLHttpRequestClass(el);
      expect(getProp(ctor, 'UNSENT')).toBe(0);
    });

    it('should have OPENED = 1 on constructor', () => {
      const ctor = createXMLHttpRequestClass(el);
      expect(getProp(ctor, 'OPENED')).toBe(1);
    });

    it('should have HEADERS_RECEIVED = 2 on constructor', () => {
      const ctor = createXMLHttpRequestClass(el);
      expect(getProp(ctor, 'HEADERS_RECEIVED')).toBe(2);
    });

    it('should have LOADING = 3 on constructor', () => {
      const ctor = createXMLHttpRequestClass(el);
      expect(getProp(ctor, 'LOADING')).toBe(3);
    });

    it('should have DONE = 4 on constructor', () => {
      const ctor = createXMLHttpRequestClass(el);
      expect(getProp(ctor, 'DONE')).toBe(4);
    });
  });

  describe('open()', () => {
    it('should set readyState to OPENED', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(getProp(xhr, 'readyState')).toBe(OPENED);
    });

    it('should set method and url', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'POST', 'https://example.com/api');
      callMethod(xhr, 'send');
      expect(globalThis.fetch).toBeDefined();
    });

    it('should default to GET method', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', undefined, 'https://example.com');
      expect(getProp(xhr, 'readyState')).toBe(OPENED);
    });

    it('should uppercase the method', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'post', 'https://example.com');
      expect(getProp(xhr, 'readyState')).toBe(OPENED);
    });

    it('should set responseURL to the url', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(getProp(xhr, 'responseURL')).toBe('https://example.com');
    });

    it('should fire readystatechange event on open', () => {
      const xhr = buildXhr(el);
      let rsCount = 0;
      setProp(xhr, 'onreadystatechange', (() => { rsCount++; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(rsCount).toBe(1);
    });

    it('should reset state on re-open', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://a.com');
      callMethod(xhr, 'open', 'POST', 'https://b.com');
      expect(getProp(xhr, 'readyState')).toBe(OPENED);
    });
  });

  describe('setRequestHeader()', () => {
    it('should throw if readyState is not OPENED', () => {
      const xhr = buildXhr(el);
      expect(() => callMethod(xhr, 'setRequestHeader', 'Content-Type', 'text/plain')).toThrow();
    });

    it('should not throw after open()', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(() => callMethod(xhr, 'setRequestHeader', 'X-Custom', 'value')).not.toThrow();
    });
  });

  describe('send()', () => {
    it('should throw if readyState is not OPENED', () => {
      const xhr = buildXhr(el);
      expect(() => callMethod(xhr, 'send')).toThrow();
    });

    it('should fire loadstart event', async () => {
      mockFetch('hello');
      const xhr = buildXhr(el);
      let loadStartFired = false;
      setProp(xhr, 'onloadstart', (() => { loadStartFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(loadStartFired).toBe(true);
    });

    it('should transition through readyState changes', async () => {
      mockFetch('hello', { headers: { 'x-test': '1' } });
      const xhr = buildXhr(el);
      const states: number[] = [];
      setProp(xhr, 'onreadystatechange', (() => {
        states.push(getProp(xhr, 'readyState') as number);
      }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(states).toContain(OPENED);
      expect(states).toContain(HEADERS_RECEIVED);
      expect(states).toContain(LOADING);
      expect(states).toContain(DONE);
    });

    it('should set responseText and response on success', async () => {
      mockFetch('hello world');
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(getProp(xhr, 'responseText')).toBe('hello world');
      expect(getProp(xhr, 'response')).toBe('hello world');
    });

    it('should set status and statusText on success', async () => {
      mockFetch('ok', { status: 201, statusText: 'Created' });
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'POST', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(getProp(xhr, 'status')).toBe(201);
      expect(getProp(xhr, 'statusText')).toBe('Created');
    });

    it('should fire onload event', async () => {
      mockFetch('ok');
      const xhr = buildXhr(el);
      let loadFired = false;
      setProp(xhr, 'onload', (() => { loadFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(loadFired).toBe(true);
    });

    it('should fire onloadend event on success', async () => {
      mockFetch('ok');
      const xhr = buildXhr(el);
      let loadEndFired = false;
      setProp(xhr, 'onloadend', (() => { loadEndFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(loadEndFired).toBe(true);
    });

    it('should fire error event on network failure', async () => {
      mockFetchReject('network error');
      const xhr = buildXhr(el);
      let errorFired = false;
      setProp(xhr, 'onerror', (() => { errorFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(errorFired).toBe(true);
    });

    it('should set status to 0 on network error', async () => {
      mockFetchReject('network error');
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(getProp(xhr, 'status')).toBe(0);
    });

    it('should transition to DONE on network error', async () => {
      mockFetchReject('network error');
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(getProp(xhr, 'readyState')).toBe(DONE);
    });

    it('should fire onloadend on error', async () => {
      mockFetchReject('network error');
      const xhr = buildXhr(el);
      let loadEndFired = false;
      setProp(xhr, 'onloadend', (() => { loadEndFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(loadEndFired).toBe(true);
    });

    it('should send request headers', async () => {
      mockFetch('ok');
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'POST', 'https://example.com');
      callMethod(xhr, 'setRequestHeader', 'Content-Type', 'application/json');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(globalThis.fetch).toBeDefined();
    });
  });

  describe('abort()', () => {
    it('should reset readyState to UNSENT', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(getProp(xhr, 'readyState')).toBe(OPENED);
      callMethod(xhr, 'abort');
      expect(getProp(xhr, 'readyState')).toBe(UNSENT);
    });

    it('should reset status to 0', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'abort');
      expect(getProp(xhr, 'status')).toBe(0);
    });

    it('should reset responseText and response', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'abort');
      expect(getProp(xhr, 'responseText')).toBe('');
      expect(getProp(xhr, 'response')).toBe('');
    });

    it('should fire readystatechange event', () => {
      const xhr = buildXhr(el);
      let rsFired = false;
      setProp(xhr, 'onreadystatechange', (() => { rsFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'abort');
      expect(rsFired).toBe(true);
    });

    it('should fire abort event', () => {
      const xhr = buildXhr(el);
      let abortFired = false;
      setProp(xhr, 'onabort', (() => { abortFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'abort');
      expect(abortFired).toBe(true);
    });

    it('should fire loadend event', () => {
      const xhr = buildXhr(el);
      let loadEndFired = false;
      setProp(xhr, 'onloadend', (() => { loadEndFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'abort');
      expect(loadEndFired).toBe(true);
    });

    it('should prevent in-flight fetch from completing', async () => {
      mockFetch('hello');
      const xhr = buildXhr(el);
      let loadFired = false;
      let abortFired = false;
      setProp(xhr, 'onload', (() => { loadFired = true; }) as unknown as JSFunction);
      setProp(xhr, 'onabort', (() => { abortFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      callMethod(xhr, 'abort');
      await drainAll(el);
      expect(abortFired).toBe(true);
      expect(loadFired).toBe(false);
    });
  });

  describe('getResponseHeader()', () => {
    it('should return null before HEADERS_RECEIVED', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      const result = callMethod(xhr, 'getResponseHeader', 'Content-Type');
      expect(result).toBe(null);
    });

    it('should return header value after response', async () => {
      mockFetch('ok', { headers: { 'content-type': 'text/html' } });
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      const ct = callMethod(xhr, 'getResponseHeader', 'Content-Type');
      expect(ct).toBe('text/html');
    });

    it('should return null for non-existent header', async () => {
      mockFetch('ok', { headers: { 'x-test': '1' } });
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      const result = callMethod(xhr, 'getResponseHeader', 'X-Missing');
      expect(result).toBe(null);
    });
  });

  describe('getAllResponseHeaders()', () => {
    it('should return empty string before HEADERS_RECEIVED', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      const result = callMethod(xhr, 'getAllResponseHeaders');
      expect(result).toBe('');
    });

    it('should return formatted headers after response', async () => {
      mockFetch('ok', { headers: { 'x-a': '1', 'x-b': '2' } });
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      const all = callMethod(xhr, 'getAllResponseHeaders') as string;
      expect(all).toContain('x-a: 1');
      expect(all).toContain('x-b: 2');
    });
  });

  describe('overrideMimeType()', () => {
    it('should not throw', () => {
      const xhr = buildXhr(el);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(() => callMethod(xhr, 'overrideMimeType', 'text/plain')).not.toThrow();
    });
  });

  describe('event listeners (addEventListener)', () => {
    it('should support addEventListener for readystatechange', () => {
      const xhr = buildXhr(el);
      let called = false;
      const fn = createNativeFunction('listener', () => { called = true; });
      callMethod(xhr, 'addEventListener', 'readystatechange', fn);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(called).toBe(true);
    });

    it('should support removeEventListener', () => {
      const xhr = buildXhr(el);
      let callCount = 0;
      const fn = createNativeFunction('listener', () => { callCount++; });
      callMethod(xhr, 'addEventListener', 'load', fn);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      const count1 = callCount;
      callMethod(xhr, 'removeEventListener', 'load', fn);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(callCount).toBe(count1);
    });

    it('should fire onreadystatechange via addEventListener', () => {
      const xhr = buildXhr(el);
      const fired: string[] = [];
      const fn = createNativeFunction('listener', () => { fired.push('rs'); });
      callMethod(xhr, 'addEventListener', 'readystatechange', fn);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(fired).toContain('rs');
    });

    it('should fire both onreadystatechange and addEventListener callback', () => {
      const xhr = buildXhr(el);
      const events: string[] = [];
      const fn = createNativeFunction('listener', () => { events.push('listener'); });
      setProp(xhr, 'onreadystatechange', (() => { events.push('onprop'); }) as unknown as JSFunction);
      callMethod(xhr, 'addEventListener', 'readystatechange', fn);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      expect(events).toContain('listener');
      expect(events).toContain('onprop');
    });
  });

  describe('multiple XHR instances', () => {
    it('should be independent', async () => {
      mockFetch('response-a');
      const xhr1 = buildXhr(el);
      const xhr2 = buildXhr(el);
      let load1 = false;
      let load2 = false;
      setProp(xhr1, 'onload', (() => { load1 = true; }) as unknown as JSFunction);
      setProp(xhr2, 'onload', (() => { load2 = true; }) as unknown as JSFunction);
      callMethod(xhr1, 'open', 'GET', 'https://a.com');
      callMethod(xhr2, 'open', 'GET', 'https://b.com');
      callMethod(xhr1, 'send');
      callMethod(xhr2, 'send');
      await drainAll(el);
      expect(load1).toBe(true);
      expect(load2).toBe(true);
    });
  });

  describe('writable properties', () => {
    it('should allow setting responseType', () => {
      const xhr = buildXhr(el);
      setProp(xhr, 'responseType', 'json');
      expect(getProp(xhr, 'responseType')).toBe('json');
    });

    it('should allow setting timeout', () => {
      const xhr = buildXhr(el);
      setProp(xhr, 'timeout', 5000);
      expect(getProp(xhr, 'timeout')).toBe(5000);
    });

    it('should allow setting withCredentials', () => {
      const xhr = buildXhr(el);
      setProp(xhr, 'withCredentials', true);
      expect(getProp(xhr, 'withCredentials')).toBe(true);
    });
  });

  describe('error handler on network failure', () => {
    it('should handle TypeError (fetch network error)', async () => {
      mockFetchNetworkError();
      const xhr = buildXhr(el);
      let errorFired = false;
      setProp(xhr, 'onerror', (() => { errorFired = true; }) as unknown as JSFunction);
      callMethod(xhr, 'open', 'GET', 'https://example.com');
      callMethod(xhr, 'send');
      await drainAll(el);
      expect(errorFired).toBe(true);
    });
  });
});
