import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, type JSObject } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import {
  createHeadersClass, createResponseClass, createRequestClass,
  createAbortControllerClass, createFetchFn,
} from '../src/browser/js/fetch-api';

let _lastEventLoop: EventLoop | undefined;

function createTestEnv(mockFetch?: typeof globalThis.fetch) {
  const eventLoop = new EventLoop();
  _lastEventLoop = eventLoop;
  const interp = new Interpreter(undefined, eventLoop);
  const env = (interp as any).globalEnv as Environment;
  env.setLocal('Headers', createHeadersClass(eventLoop));
  env.setLocal('Response', createResponseClass(eventLoop));
  env.setLocal('Request', createRequestClass(eventLoop));
  env.setLocal('AbortController', createAbortControllerClass(eventLoop));
  env.setLocal('fetch', createFetchFn(eventLoop, mockFetch as any));
  return { interp, env, eventLoop };
}

async function run(source: string, mockFetch?: typeof globalThis.fetch) {
  const { interp, env, eventLoop } = createTestEnv(mockFetch);
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  interp.run(program);
  // Allow native Promise chains (platform fetch) to settle, then drain our microtasks
  await flushAll(eventLoop);
  return { env, eventLoop };
}

async function flushAll(el: EventLoop) {
  // Alternate: yield to Node event loop (processes native microtasks),
  // then drain our EventLoop microtasks. Repeat until stable.
  for (let i = 0; i < 20; i++) {
    const before = el.microtaskCount;
    await new Promise<void>(r => setTimeout(r, 0));
    el.drainMicrotasks();
    if (el.microtaskCount === 0 && i > 2) break;
  }
}

function mockResp(body: string, init?: { status?: number; statusText?: string; headers?: Record<string, string>; url?: string; redirected?: boolean }) {
  const h = new Map(Object.entries(init?.headers ?? {}));
  return {
    ok: (init?.status ?? 200) >= 200 && (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    url: init?.url ?? '',
    redirected: init?.redirected ?? false,
    type: 'default' as ResponseType,
    headers: {
      forEach: (cb: (v: string, k: string) => void) => h.forEach(cb),
      get: (name: string) => h.get(name.toLowerCase()) ?? null,
    },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as globalThis.Response;
}

describe('Headers', () => {
  it('should create empty Headers', async () => {
    const { env } = await run('var h = new Headers();');
    expect(env.get('h')).toBeDefined();
  });

  it('should create Headers from object', async () => {
    const { env } = await run(`var h = new Headers({ 'Content-Type': 'text/html', 'X-Custom': 'yes' }); var ct = h.get('content-type'); var xc = h.get('x-custom');`);
    expect(env.get('ct')).toBe('text/html');
    expect(env.get('xc')).toBe('yes');
  });

  it('should get/set/has/delete case-insensitively', async () => {
    const { env } = await run(`
      var h = new Headers();
      h.set('Content-Type', 'application/json');
      var has1 = h.has('content-type');
      var has2 = h.has('CONTENT-TYPE');
      var get1 = h.get('Content-Type');
      h.delete('content-type');
      var has3 = h.has('Content-Type');
    `);
    expect(env.get('has1')).toBe(true);
    expect(env.get('has2')).toBe(true);
    expect(env.get('get1')).toBe('application/json');
    expect(env.get('has3')).toBe(false);
  });

  it('should append with comma separator', async () => {
    const { env } = await run(`
      var h = new Headers();
      h.append('Accept', 'text/html');
      h.append('Accept', 'application/json');
      var val = h.get('accept');
    `);
    expect(env.get('val')).toBe('text/html, application/json');
  });

  it('should iterate entries', async () => {
    const { env } = await run(`var h = new Headers({ 'a': '1', 'b': '2' }); var entries = h.entries();`);
    const entries = env.get('entries') as JSObject;
    expect(entries.type).toBe('array');
    expect(Number(entries.properties.get('length')?.value ?? 0)).toBe(2);
  });

  it('should iterate keys and values', async () => {
    const { env } = await run(`var h = new Headers({ 'x': '1', 'y': '2' }); var keys = h.keys(); var vals = h.values();`);
    const keys = env.get('keys') as JSObject;
    const vals = env.get('vals') as JSObject;
    expect(Number(keys.properties.get('length')?.value ?? 0)).toBe(2);
    expect(Number(vals.properties.get('length')?.value ?? 0)).toBe(2);
  });

  it('should copy from another Headers instance', async () => {
    const { env } = await run(`
      var h1 = new Headers({ 'a': '1' });
      var h2 = new Headers(h1);
      h2.set('b', '2');
      var a = h1.get('a');
      var b = h1.get('b');
    `);
    expect(env.get('a')).toBe('1');
    expect(env.get('b')).toBe(null);
  });
});

describe('Response', () => {
  it('should create Response with body and status', async () => {
    const { env } = await run(`var r = new Response('hello', { status: 201, statusText: 'Created' }); var s = r.status; var st = r.statusText;`);
    expect(env.get('s')).toBe(201);
    expect(env.get('st')).toBe('Created');
  });

  it('should default to 200 OK', async () => {
    const { env } = await run(`var r = new Response('ok'); var status = r.status; var ok = r.ok;`);
    expect(env.get('status')).toBe(200);
    expect(env.get('ok')).toBe(true);
  });

  it('should have correct ok for error status', async () => {
    const { env } = await run(`var r = new Response('nf', { status: 404 }); var ok = r.ok;`);
    expect(env.get('ok')).toBe(false);
  });

  it('should parse JSON via json()', async () => {
    const { env } = await run(`
      var result = null;
      new Response('{"a":1,"b":"hello"}').json().then(function(v) { result = v; });
    `);
    const result = env.get('result') as JSObject;
    expect(result.properties.get('a')?.value).toBe(1);
    expect(result.properties.get('b')?.value).toBe('hello');
  });

  it('should return text via text()', async () => {
    const { env } = await run(`
      var result = '';
      new Response('hello world').text().then(function(v) { result = v; });
    `);
    expect(env.get('result')).toBe('hello world');
  });

  it('should clone Response', async () => {
    const { env } = await run(`
      var r1 = new Response('original', { status: 201 });
      var r2 = r1.clone();
      var s1 = r1.status;
      var s2 = r2.status;
    `);
    expect(env.get('s1')).toBe(201);
    expect(env.get('s2')).toBe(201);
  });

  it('should expose headers', async () => {
    const { env } = await run(`var r = new Response('ok', { headers: { 'x-test': 'value' } }); var val = r.headers.get('x-test');`);
    expect(env.get('val')).toBe('value');
  });

  it('should track bodyUsed', async () => {
    const { env } = await run(`
      var r = new Response('data');
      var bu1 = r.bodyUsed;
      r.text().then(function() {});
      var bu2 = r.bodyUsed;
    `);
    expect(env.get('bu1')).toBe(false);
    expect(env.get('bu2')).toBe(true);
  });

  it('should have default type, url, redirected', async () => {
    const { env } = await run(`var r = new Response(''); var t = r.type; var u = r.url; var red = r.redirected;`);
    expect(env.get('t')).toBe('default');
    expect(env.get('u')).toBe('');
    expect(env.get('red')).toBe(false);
  });
});

describe('Request', () => {
  it('should create Request with URL', async () => {
    const { env } = await run(`var r = new Request('https://example.com'); var url = r.url;`);
    expect(env.get('url')).toBe('https://example.com');
  });

  it('should default method to GET', async () => {
    const { env } = await run(`var r = new Request('https://example.com'); var m = r.method;`);
    expect(env.get('m')).toBe('GET');
  });

  it('should accept init with method/headers/body', async () => {
    const { env } = await run(`
      var r = new Request('https://example.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"k":"v"}'
      });
      var m = r.method;
      var ct = r.headers.get('content-type');
      var b = r.body;
    `);
    expect(env.get('m')).toBe('POST');
    expect(env.get('ct')).toBe('application/json');
    expect(env.get('b')).toBe('{"k":"v"}');
  });

  it('should clone Request', async () => {
    const { env } = await run(`
      var r1 = new Request('https://example.com', { method: 'POST' });
      var r2 = r1.clone();
      var u = r2.url;
      var m = r2.method;
    `);
    expect(env.get('u')).toBe('https://example.com');
    expect(env.get('m')).toBe('POST');
  });
});

describe('AbortController', () => {
  it('should create with signal.aborted=false', async () => {
    const { env } = await run(`var ac = new AbortController(); var ab = ac.signal.aborted;`);
    expect(env.get('ab')).toBe(false);
  });

  it('should set aborted=true on abort()', async () => {
    const { env } = await run(`var ac = new AbortController(); ac.abort(); var ab = ac.signal.aborted;`);
    expect(env.get('ab')).toBe(true);
  });

  it('should throw on throwIfAborted() after abort', async () => {
    const { env } = await run(`
      var threw = false;
      var ac = new AbortController();
      ac.abort();
      try { ac.signal.throwIfAborted(); } catch(e) { threw = true; }
    `);
    expect(env.get('threw')).toBe(true);
  });

  it('should not throw on throwIfAborted() before abort', async () => {
    const { env } = await run(`
      var threw = false;
      var ac = new AbortController();
      try { ac.signal.throwIfAborted(); } catch(e) { threw = true; }
    `);
    expect(env.get('threw')).toBe(false);
  });

  it('should fire abort event on signal', async () => {
    const { env } = await run(`
      var fired = false;
      var ac = new AbortController();
      ac.signal.addEventListener('abort', function() { fired = true; });
      ac.abort();
    `);
    expect(env.get('fired')).toBe(true);
  });

  it('should be idempotent (double abort)', async () => {
    const { env } = await run(`var ac = new AbortController(); ac.abort(); ac.abort(); var ok = true;`);
    expect(env.get('ok')).toBe(true);
  });
});

describe('fetch()', () => {
  let mf: ReturnType<typeof vi.fn>;
  beforeEach(() => { mf = vi.fn(); });

  it('should call platform fetch with correct URL', async () => {
    mf.mockResolvedValue(mockResp('ok'));
    await run(`fetch('https://example.com');`, mf);
    expect(mf).toHaveBeenCalledTimes(1);
    expect(mf).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ method: 'GET' }));
  });

  it('should send POST with body', async () => {
    mf.mockResolvedValue(mockResp('created'));
    await run(`fetch('https://example.com', { method: 'POST', body: 'data' });`, mf);
    expect(mf).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ method: 'POST', body: 'data' }));
  });

  it('should send custom headers', async () => {
    mf.mockResolvedValue(mockResp('ok'));
    await run(`fetch('https://example.com', { headers: { 'X-Test': 'yes' } });`, mf);
    expect(mf).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ headers: { 'x-test': 'yes' } }));
  });

  it('should return Response on success', async () => {
    mf.mockResolvedValue(mockResp('{"hello":"world"}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const { env } = await run(`
      var status = 0; var body = '';
      fetch('https://example.com').then(function(r) {
        status = r.status; return r.text();
      }).then(function(t) { body = t; });
    `, mf);
    expect(env.get('status')).toBe(200);
    expect(env.get('body')).toBe('{"hello":"world"}');
  });

  it('should reject on network error', async () => {
    mf.mockRejectedValue(new TypeError('Failed to fetch'));
    const { env } = await run(`var err = ''; fetch('https://example.com').catch(function(e) { err = e; });`, mf);
    expect(env.get('err')).toBe('Failed to fetch');
  });

  it('should handle JSON response', async () => {
    mf.mockResolvedValue(mockResp('{"x":42}', { headers: { 'content-type': 'application/json' } }));
    const { env } = await run(`
      var val = 0;
      fetch('https://api.test/data').then(function(r) { return r.json(); }).then(function(j) { val = j.x; });
    `, mf);
    expect(env.get('val')).toBe(42);
  });

  it('should handle abort via AbortController signal', async () => {
    mf.mockResolvedValue(mockResp('ok'));
    const { env } = await run(`
      var ac = new AbortController();
      var caught = false;
      fetch('https://example.com', { signal: ac.signal }).catch(function(e) { caught = true; });
      ac.abort();
    `, mf);
    expect(env.get('caught')).toBe(true);
  });

  it('should follow redirects', async () => {
    mf.mockResolvedValue(mockResp('final', { status: 200, url: 'https://example.com/final', redirected: true }));
    const { env } = await run(`
      var url = ''; var red = false;
      fetch('https://example.com/old').then(function(r) { url = r.url; red = r.redirected; });
    `, mf);
    expect(env.get('url')).toBe('https://example.com/final');
    expect(env.get('red')).toBe(true);
  });

  it('should reject on invalid URL', async () => {
    mf.mockRejectedValue(new TypeError('Invalid URL'));
    const { env } = await run(`var err = ''; fetch('not a valid url').catch(function(e) { err = e; });`, mf);
    expect(env.get('err')).toBe('Invalid URL');
  });

  it('should pass through Request object', async () => {
    mf.mockResolvedValue(mockResp('ok'));
    await run(`var r = new Request('https://example.com/api', { method: 'PUT', body: 'data' }); fetch(r);`, mf);
    expect(mf).toHaveBeenCalledWith('https://example.com/api', expect.objectContaining({ method: 'PUT', body: 'data' }));
  });
});
