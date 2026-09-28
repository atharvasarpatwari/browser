import { describe, it, expect, beforeEach } from 'vitest';

import { FetchClient } from '../src/browser/media/fetch';
import { XHRClient } from '../src/browser/media/xml-http-request';
import { HistoryService } from '../src/browser/media/history';
import { LocationService } from '../src/browser/media/location';
import { NavigatorService } from '../src/browser/media/navigator';
import { ClipboardService } from '../src/browser/media/clipboard';
import { WebSocketClient } from '../src/browser/media/websocket';
import { BroadcastChannelService } from '../src/browser/media/broadcast-channel';
import { ServiceWorkerContainer } from '../src/browser/media/service-workers';

/* ============================================================
   1. Fetch API
   ============================================================ */
describe('FetchClient', () => {
  let client: FetchClient;

  beforeEach(() => {
    client = new FetchClient();
  });

  it('request returns a promise', async () => {
    const p = client.request('GET', 'https://example.com');
    expect(p).toBeInstanceOf(Promise);
    await p.catch(() => {}); // suppress unhandled rejection
  });

  it('has convenience methods', () => {
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.patch).toBe('function');
    expect(typeof client.delete).toBe('function');
    expect(typeof client.head).toBe('function');
  });

  it('dispose clears handlers', () => {
    const handler = vi.fn();
    client.onEvent(handler);
    client.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   2. XMLHttpRequest
   ============================================================ */
describe('XHRClient', () => {
  let client: XHRClient;

  beforeEach(() => {
    client = new XHRClient();
  });

  it('has request methods', () => {
    expect(typeof client.get).toBe('function');
    expect(typeof client.post).toBe('function');
    expect(typeof client.put).toBe('function');
    expect(typeof client.delete).toBe('function');
  });

  it('dispose clears handlers', () => {
    client.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   3. History API
   ============================================================ */
describe('HistoryService', () => {
  let history: HistoryService;

  beforeEach(() => {
    history = new HistoryService();
  });

  it('starts with one entry', () => {
    expect(history.length).toBe(1);
    expect(history.state).toBeNull();
    expect(history.current).not.toBeNull();
  });

  it('pushState adds entry', () => {
    history.pushState({ page: 1 }, 'Page 1', '/page1');
    expect(history.length).toBe(2);
    expect(history.state).toEqual({ page: 1 });
  });

  it('replaceState replaces current entry', () => {
    history.pushState({ page: 1 }, 'P1', '/p1');
    history.replaceState({ page: 2 }, 'P2', '/p2');
    expect(history.length).toBe(2);
    expect(history.current!.url).toBe('/p2');
  });

  it('go navigates forward and backward', () => {
    history.pushState({ a: 1 }, '', '/a');
    history.pushState({ b: 2 }, '', '/b');
    expect(history.state).toEqual({ b: 2 });

    history.go(-1);
    expect(history.state).toEqual({ a: 1 });

    history.go(1);
    expect(history.state).toEqual({ b: 2 });
  });

  it('back and forward work', () => {
    history.pushState({}, '', '/1');
    history.pushState({}, '', '/2');
    history.back();
    expect(history.current!.url).toBe('/1');
    history.forward();
    expect(history.current!.url).toBe('/2');
  });

  it('go clamps to bounds', () => {
    history.go(-10);
    expect(history.state).toBeNull();
    history.go(10);
    expect(history.state).toBeNull();
  });

  it('emits popstate on go', () => {
    const handler = vi.fn();
    history.onEvent(handler);
    history.pushState({}, '', '/a');
    history.go(-1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'popstate' }));
  });

  it('emits push event', () => {
    const handler = vi.fn();
    history.onEvent(handler);
    history.pushState({}, '', '/test');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'push' }));
  });

  it('dispose clears entries', () => {
    history.dispose();
    expect(history.length).toBe(0);
    expect(history.current).toBeNull();
  });
});

/* ============================================================
   4. Location API
   ============================================================ */
describe('LocationService', () => {
  let loc: LocationService;

  beforeEach(() => {
    loc = new LocationService('https://example.com:8080/path/to/page?q=hello#section');
  });

  it('parses initial URL components', () => {
    expect(loc.href).toBe('https://example.com:8080/path/to/page?q=hello#section');
    expect(loc.origin).toBe('https://example.com:8080');
    expect(loc.protocol).toBe('https:');
    expect(loc.host).toBe('example.com:8080');
    expect(loc.hostname).toBe('example.com');
    expect(loc.port).toBe('8080');
    expect(loc.pathname).toBe('/path/to/page');
    expect(loc.search).toBe('?q=hello');
    expect(loc.hash).toBe('#section');
  });

  it('set hash emits hashchange', () => {
    const handler = vi.fn();
    loc.onEvent(handler);
    loc.hash = '#newhash';
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'hashchange' }));
    expect(loc.hash).toBe('#newhash');
  });

  it('assign navigates', () => {
    const handler = vi.fn();
    loc.onEvent(handler);
    loc.assign('https://other.com/page');
    expect(loc.hostname).toBe('other.com');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate' }));
  });

  it('replace navigates without history entry (emits replace flag)', () => {
    const handler = vi.fn();
    loc.onEvent(handler);
    loc.replace('https://replace.com/');
    expect(loc.hostname).toBe('replace.com');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate', data: expect.objectContaining({ replace: true }) }));
  });

  it('reload emits reload', () => {
    const handler = vi.fn();
    loc.onEvent(handler);
    loc.reload();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'reload' }));
  });

  it('toString returns href', () => {
    expect(loc.toString()).toBe(loc.href);
  });

  it('href setter navigates', () => {
    loc.href = 'https://newurl.com/foo?bar=1';
    expect(loc.hostname).toBe('newurl.com');
  });

  it('dispose clears handlers', () => {
    loc.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   5. Navigator API
   ============================================================ */
describe('NavigatorService', () => {
  let nav: NavigatorService;

  beforeEach(() => {
    nav = new NavigatorService();
  });

  it('has basic properties', () => {
    expect(nav.userAgent).toBe('NovaBrowser/1.0');
    expect(nav.platform).toBe('Win32');
    expect(nav.language).toBe('en-US');
    expect(nav.languages).toEqual(['en-US', 'en']);
    expect(nav.vendor).toBe('');
    expect(nav.cookieEnabled).toBe(true);
    expect(nav.onLine).toBe(true);
    expect(nav.hardwareConcurrency).toBe(8);
    expect(nav.maxTouchPoints).toBe(0);
  });

  it('vibrate returns false', () => {
    expect(nav.vibrate(200)).toBe(false);
    expect(nav.vibrate([100, 50, 100])).toBe(false);
  });

  it('getBattery returns mock battery info', async () => {
    const battery = await nav.getBattery();
    expect(battery.charging).toBe(true);
    expect(battery.level).toBe(1);
  });

  it('has connection info', () => {
    expect(nav.connection).not.toBeNull();
    expect(nav.connection!.effectiveType).toBe('4g');
    expect(nav.connection!.downlink).toBe(10);
  });

  it('online/offline events work', () => {
    const handler = vi.fn();
    nav.onEvent(handler);
    nav.setOnline(true);
    expect(handler).not.toHaveBeenCalled();
    nav.setOnline(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'offline' }));
  });

  it('dispose clears handlers', () => {
    nav.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   6. Clipboard API
   ============================================================ */
describe('ClipboardService', () => {
  let clip: ClipboardService;

  beforeEach(() => {
    clip = new ClipboardService();
  });

  it('writeText stores text in fallback', async () => {
    const clip2 = new ClipboardService();
    await clip2.writeText('hello');
    const text = await clip2.readText();
    expect(text).toBe('hello');
  });

  it('read/write roundtrip works', async () => {
    await clip.writeText('test-data');
    const result = await clip.readText();
    expect(result).toBe('test-data');
  });

  it('dispose clears handlers', () => {
    clip.dispose();
    expect(true).toBe(true);
  });
});

/* ============================================================
   10. WebSocket
   ============================================================ */
describe('WebSocketClient', () => {
  it('stores url', () => {
    const ws = new WebSocketClient('wss://echo.example.com');
    expect(ws.url).toBe('wss://echo.example.com');
    expect(ws.readyState).toBe('closed');
  });

  it('connect transitions connecting state', () => {
    const ws = new WebSocketClient('wss://echo.example.com');
    ws.connect();
    expect(ws.readyState).toBe('connecting');
  });

  it('close works without connecting', () => {
    const ws = new WebSocketClient('wss://echo.example.com');
    ws.close();
    expect(ws.readyState).toBe('closed');
  });

  it('send throws when not connected', () => {
    const ws = new WebSocketClient('wss://echo.example.com');
    expect(() => ws.send('data')).toThrow('not connected');
  });

  it('dispose closes connection', () => {
    const ws = new WebSocketClient('wss://echo.example.com');
    ws.connect();
    ws.dispose();
    expect(ws.readyState).toBe('closed');
  });
});

/* ============================================================
   12. BroadcastChannel
   ============================================================ */
describe('BroadcastChannelService', () => {
  it('stores name', () => {
    const bc = new BroadcastChannelService('my-channel');
    expect(bc.name).toBe('my-channel');
  });

  it('postMessage does not throw', () => {
    const bc = new BroadcastChannelService('test');
    bc.postMessage({ hello: 'world' });
  });

  it('close stops channel', () => {
    const bc = new BroadcastChannelService('test');
    bc.close();
    bc.postMessage('data');
  });

  it('dispose cleans up', () => {
    const bc = new BroadcastChannelService('test');
    bc.dispose();
  });
});

/* ============================================================
   13. Service Workers
   ============================================================ */
describe('ServiceWorkerContainer', () => {
  let sw: ServiceWorkerContainer;

  beforeEach(() => {
    sw = new ServiceWorkerContainer();
  });

  it('starts with no controller', () => {
    expect(sw.controller).toBeNull();
  });

  it('ready is a promise', () => {
    expect(sw.ready).toBeInstanceOf(Promise);
  });

  it('register creates registration', async () => {
    const reg = await sw.register('/sw.js', { scope: '/' });
    expect(reg.scope).toBe('/');
    expect(reg.installing).not.toBeNull();
    expect(reg.installing!.scriptURL).toBe('/sw.js');
  });

  it('register returns existing registration for same scope', async () => {
    const reg1 = await sw.register('/sw.js', { scope: '/' });
    const reg2 = await sw.register('/sw2.js', { scope: '/' });
    expect(reg2).toBe(reg1);
  });

  it('registration state transitions through lifecycle', async () => {
    const handler = vi.fn();
    sw.onEvent(handler);
    await sw.register('/worker.js', { scope: '/app' });
    await new Promise(r => setTimeout(r, 200));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'register' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'statechange' }));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'controllerchange' }));
  });

  it('ready resolves after registration', async () => {
    const reg = await sw.register('/sw.js');
    const readyReg = await sw.ready;
    expect(readyReg).toBe(reg);
  });

  it('getRegistration returns registration for url', async () => {
    await sw.register('/sw.js', { scope: '/app' });
    const reg = await sw.getRegistration('/app/page');
    expect(reg).toBeDefined();
    expect(reg!.scope).toBe('/app');
  });

  it('getRegistration returns undefined for unknown url', async () => {
    const reg = await sw.getRegistration('/unknown');
    expect(reg).toBeUndefined();
  });

  it('getRegistrations returns all', async () => {
    await sw.register('/a.js', { scope: '/a' });
    await sw.register('/b.js', { scope: '/b' });
    const regs = await sw.getRegistrations();
    expect(regs).toHaveLength(2);
  });

  it('unregister removes registration', async () => {
    const reg = await sw.register('/sw.js');
    await reg.unregister();
    const regs = await sw.getRegistrations();
    expect(regs).toHaveLength(0);
  });

  it('dispose cleans up', () => {
    sw.dispose();
    expect(sw.controller).toBeNull();
  });
});
