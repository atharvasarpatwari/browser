import { describe, it, expect, beforeEach } from 'vitest';
import { runJS, createGlobalEnv, createObject } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';
import { setPlatformWebSocketFactory } from '../src/browser/js/websocket-api';

function makeMinimalDoc() {
  return {
    domId: 'doc-1', nodeType: 'document' as const, parent: null,
    children: [], htmlElement: null, headElement: null, bodyElement: null,
  };
}

function makeMinimalDomTree(doc: any) {
  return {
    buildFromHtml: () => doc, getNodeById: () => null, getElementById: () => null,
    getElementsByTagName: () => [], querySelector: () => null, querySelectorAll: () => [],
    insertBefore: () => {}, appendChild: () => {}, removeChild: () => {},
    setAttribute: () => {}, removeAttribute: () => {}, setTextContent: () => {},
    setComputedStyle: () => {}, setLayoutBox: () => {}, getMutations: () => [],
    clearMutations: () => {}, getDocument: () => doc, dispose: () => {},
  };
}

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  protocol: string = '';
  readyState: number = MockWebSocket.CONNECTING;
  bufferedAmount: number = 0;
  binaryType: string = 'blob';
  extensions: string = '';
  onopen: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  private _listeners = new Map<string, Set<(ev: any) => void>>();
  private _sent: (string | ArrayBufferLike | ArrayBufferView)[] = [];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this._emit('open', { type: 'open' });
    }, 0);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error("The WebSocket is not open.");
    }
    this._sent.push(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) return;
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      this._emit('close', { type: 'close', code: code ?? 1000, reason: reason ?? '', wasClean: true });
    }, 0);
  }

  addEventListener(type: string, handler: (ev: any) => void): void {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (ev: any) => void): void {
    this._listeners.get(type)?.delete(handler);
  }

  _simulateMessage(data: string | any): void { this._emit('message', { type: 'message', data }); }
  _simulateError(): void { this._emit('error', { type: 'error' }); }
  _simulateClose(code: number, reason: string, wasClean: boolean): void {
    this.readyState = MockWebSocket.CLOSED;
    this._emit('close', { type: 'close', code, reason, wasClean });
  }
  _getSent(): (string | ArrayBufferLike | ArrayBufferView)[] { return [...this._sent]; }

  private _emit(type: string, ev: any): void {
    const handler = this[`on${type}` as keyof MockWebSocket] as ((ev: any) => void) | null;
    if (handler) handler(ev);
    const listeners = this._listeners.get(type);
    if (listeners) { for (const h of listeners) h(ev); }
  }
}

function createTestEnv() {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc);
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc as any, domTree as any, eventLoop);
  return { env, eventLoop };
}

function runInEnv(code: string, env: any, eventLoop: EventLoop) {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc);
  return runJS(code, { document: doc as any, domTree: domTree as any, eventLoop, globalEnv: env });
}

describe('WebSocket API', () => {
  let env: any;
  let eventLoop: EventLoop;
  let mockWs: MockWebSocket | undefined;

  beforeEach(() => {
    const testEnv = createTestEnv();
    env = testEnv.env;
    eventLoop = testEnv.eventLoop;
    mockWs = undefined;
    setPlatformWebSocketFactory((url, protocols) => {
      mockWs = new MockWebSocket(url, protocols);
      return mockWs as any;
    });
  });

  // ── Synchronous tests (single runInEnv call) ─────────────────────────

  it('should create a WebSocket instance', () => {
    const r = runInEnv(`typeof new WebSocket('ws://localhost:8080');`, env, eventLoop);
    expect(r.value).toBe('object');
    expect(r.error).toBeUndefined();
  });

  it('should throw with no arguments', () => {
    const r = runInEnv(`new WebSocket();`, env, eventLoop);
    expect(r.error?.message).toContain('1 argument required');
  });

  it('should throw with http:// URL', () => {
    const r = runInEnv(`new WebSocket('http://localhost:8080');`, env, eventLoop);
    expect(r.error?.message).toContain('invalid');
  });

  it('should accept ws:// URL', () => {
    const r = runInEnv(`new WebSocket('ws://localhost:8080').url;`, env, eventLoop);
    expect(r.value).toBe('ws://localhost:8080');
  });

  it('should accept wss:// URL', () => {
    const r = runInEnv(`new WebSocket('wss://localhost:8080').url;`, env, eventLoop);
    expect(r.value).toBe('wss://localhost:8080');
  });

  it('should have CONNECTING=0, OPEN=1, CLOSING=2, CLOSED=3', () => {
    expect(runInEnv(`WebSocket.CONNECTING;`, env, eventLoop).value).toBe(0);
    expect(runInEnv(`WebSocket.OPEN;`, env, eventLoop).value).toBe(1);
    expect(runInEnv(`WebSocket.CLOSING;`, env, eventLoop).value).toBe(2);
    expect(runInEnv(`WebSocket.CLOSED;`, env, eventLoop).value).toBe(3);
  });

  it('should start with readyState=CONNECTING', () => {
    const r = runInEnv(`new WebSocket('ws://localhost:8080').readyState;`, env, eventLoop);
    expect(r.value).toBe(0);
  });

  it('should have binaryType="blob" by default', () => {
    const r = runInEnv(`new WebSocket('ws://localhost:8080').binaryType;`, env, eventLoop);
    expect(r.value).toBe('blob');
  });

  it('should allow setting binaryType', () => {
    const r = runInEnv(`
      const ws = new WebSocket('ws://localhost:8080');
      ws.binaryType = 'arraybuffer';
      ws.binaryType;
    `, env, eventLoop);
    expect(r.value).toBe('arraybuffer');
  });

  it('should set protocol to empty string initially', () => {
    const r = runInEnv(`new WebSocket('ws://localhost:8080').protocol;`, env, eventLoop);
    expect(r.value).toBe('');
  });

  it('should throw send() when not open', () => {
    const r = runInEnv(`
      const ws = new WebSocket('ws://localhost:8080');
      ws.send('hello');
    `, env, eventLoop);
    expect(r.error?.message).toContain('not open');
  });

  it('should not throw close() on already-closed socket', () => {
    const r = runInEnv(`
      const ws = new WebSocket('ws://localhost:8080');
      ws.close();
      ws.close();
    `, env, eventLoop);
    expect(r.error).toBeUndefined();
  });

  it('should set readyState to CLOSING after close()', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(); ws.readyState;`, env, eventLoop);
    expect(r.value).toBe(2);
  });

  it('should handle connection failure gracefully', () => {
    setPlatformWebSocketFactory(() => { throw new Error('Connection refused'); });
    const r = runInEnv(`var ws = new WebSocket('ws://localhost:8080'); ws.readyState;`, env, eventLoop);
    expect(r.value).toBe(3);
  });

  it('should pass protocols to native constructor', () => {
    runInEnv(`new WebSocket('ws://localhost:8080', 'chat');`, env, eventLoop);
    expect(mockWs).toBeDefined();
  });

  it('should pass protocol array to native constructor', () => {
    runInEnv(`new WebSocket('ws://localhost:8080', ['chat', 'binary']);`, env, eventLoop);
    expect(mockWs).toBeDefined();
  });

  it('should fire onopen asynchronously', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080'); false;`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.readyState;`, env, eventLoop);
    expect(r.value).toBe(1);
  });

  it('should receive messages via onmessage', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var received = '';
      ws.onmessage = function(ev) { received = ev.data; };
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateMessage('hello');
    eventLoop.drainMicrotasks();

    const r = runInEnv(`received;`, env, eventLoop);
    expect(r.value).toBe('hello');
  });

  it('should send data when open', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    runInEnv(`ws.send('test');`, env, eventLoop);
    expect(mockWs?._getSent()).toContain('test');
  });

  it('should fire onclose with code and reason', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var closeCode = 0;
      ws.onclose = function(ev) { closeCode = ev.code; };
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateClose(1000, 'Normal', true);
    eventLoop.drainMicrotasks();

    const r = runInEnv(`closeCode;`, env, eventLoop);
    expect(r.value).toBe(1000);
  });

  it('should fire onerror', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var gotError = false;
      ws.onerror = function() { gotError = true; };
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateError();
    eventLoop.drainMicrotasks();

    const r = runInEnv(`gotError;`, env, eventLoop);
    expect(r.value).toBe(true);
  });

  it('should support addEventListener', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var msg = '';
      ws.addEventListener('message', function(ev) { msg = ev.data; });
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateMessage('via addEventListener');
    eventLoop.drainMicrotasks();

    const r = runInEnv(`msg;`, env, eventLoop);
    expect(r.value).toBe('via addEventListener');
  });

  it('should have correct message event properties', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var msgType = '';
      var msgOrigin = '';
      ws.onmessage = function(ev) { msgType = ev.type; msgOrigin = ev.origin; };
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateMessage('data');
    eventLoop.drainMicrotasks();

    expect(runInEnv(`msgType;`, env, eventLoop).value).toBe('message');
    expect(runInEnv(`msgOrigin;`, env, eventLoop).value).toBeDefined();
  });

  it('should have correct close event properties', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var closeReason = '';
      var wasClean = false;
      ws.onclose = function(ev) { closeReason = ev.reason; wasClean = ev.wasClean; };
    `, env, eventLoop);

    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    mockWs!._simulateClose(4000, 'Custom reason', true);
    eventLoop.drainMicrotasks();

    expect(runInEnv(`closeReason;`, env, eventLoop).value).toBe('Custom reason');
    expect(runInEnv(`wasClean;`, env, eventLoop).value).toBe(true);
  });

  // ── Binary send tests ────────────────────────────────────────────────

  it('should send ArrayBuffer data as binary', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
    `, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    runInEnv(`
      ws.send({ __type_override: 'arraybuffer', __buffer: { raw: true } });
    `, env, eventLoop);

    const sent = mockWs!._getSent();
    expect(sent.length).toBe(1);
    expect(typeof sent[0]).not.toBe('string');
  });

  it('should send TypedArray data as its underlying buffer', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
    `, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    runInEnv(`
      ws.send({ __type_override: 'uint8array', __buffer: { raw: true } });
    `, env, eventLoop);

    const sent = mockWs!._getSent();
    expect(sent.length).toBe(1);
    expect(typeof sent[0]).not.toBe('string');
  });

  it('should send strings as text', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
    `, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    runInEnv(`ws.send('hello');`, env, eventLoop);
    expect(mockWs!._getSent()).toContain('hello');
  });

  // ── Binary receive tests ────────────────────────────────────────────

  it('should receive binary data as ArrayBuffer when binaryType is arraybuffer', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var receivedType = '';
      var receivedData = null;
      ws.binaryType = 'arraybuffer';
      ws.onmessage = function(ev) { receivedData = ev.data; receivedType = typeof ev.data; };
    `, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const buf = new ArrayBuffer(4);
    const binaryObj = createObject(null);
    binaryObj.properties.set('__binaryData', { value: true, writable: false, enumerable: false, configurable: false });
    binaryObj.properties.set('__buffer', { value: buf, writable: false, enumerable: false, configurable: false });
    mockWs!._simulateMessage(binaryObj);
    eventLoop.drainMicrotasks();

    const r = runInEnv(`receivedType;`, env, eventLoop);
    expect(r.value).toBe('object');
  });

  it('should receive binary data as-is when binaryType is blob', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080');
      var receivedData = null;
      ws.binaryType = 'blob';
      ws.onmessage = function(ev) { receivedData = ev.data; };
    `, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const buf = new ArrayBuffer(4);
    const binaryObj = createObject(null);
    binaryObj.properties.set('__binaryData', { value: true, writable: false, enumerable: false, configurable: false });
    binaryObj.properties.set('__buffer', { value: buf, writable: false, enumerable: false, configurable: false });
    mockWs!._simulateMessage(binaryObj);
    eventLoop.drainMicrotasks();

    const r = runInEnv(`typeof receivedData;`, env, eventLoop);
    expect(r.value).toBe('object');
  });

  // ── Close code validation tests ─────────────────────────────────────

  it('should throw DOMException SyntaxError for invalid close code 1005', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(1005);`, env, eventLoop);
    expect(r.error).toBeDefined();
    expect(r.error?.message).toContain('not allowed');
  });

  it('should throw DOMException SyntaxError for close code 1-999', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(500);`, env, eventLoop);
    expect(r.error).toBeDefined();
    expect(r.error?.message).toContain('not allowed');
  });

  it('should accept valid close code 1000', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(1000);`, env, eventLoop);
    expect(r.error).toBeUndefined();
  });

  it('should accept valid close code 3000', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(3000);`, env, eventLoop);
    expect(r.error).toBeUndefined();
  });

  it('should accept valid close code 4999', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(4999);`, env, eventLoop);
    expect(r.error).toBeUndefined();
  });

  it('should throw DOMException SyntaxError for close code 5000', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close(5000);`, env, eventLoop);
    expect(r.error).toBeDefined();
    expect(r.error?.message).toContain('not allowed');
  });

  it('should throw DOMException SyntaxError for close reason too long', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const longReason = 'x'.repeat(124);
    const r = runInEnv(`ws.close(1000, '${longReason}');`, env, eventLoop);
    expect(r.error).toBeDefined();
    expect(r.error?.message).toContain('too long');
  });

  it('should accept close with no code', async () => {
    runInEnv(`var ws = new WebSocket('ws://localhost:8080');`, env, eventLoop);
    await new Promise(resolve => setTimeout(resolve, 10));
    eventLoop.drainMicrotasks();

    const r = runInEnv(`ws.close();`, env, eventLoop);
    expect(r.error).toBeUndefined();
  });

  // ── Protocol deduplication test ─────────────────────────────────────

  it('should handle protocol array passed to constructor', async () => {
    runInEnv(`
      var ws = new WebSocket('ws://localhost:8080', ['chat', 'binary']);
    `, env, eventLoop);
    expect(mockWs).toBeDefined();
    expect(runInEnv(`typeof ws;`, env, eventLoop).value).toBe('object');
  });
});
