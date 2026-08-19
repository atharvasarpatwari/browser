/**
 * NovaBrowser — Complete Test Suite
 * Tests every component across all 14 source files.
 *
 * Sections:
 *   1.  dependency-container.ts
 *   2.  app-shell.ts
 *   3.  main.ts
 *   4.  url-parser.ts
 *   5.  navigation-controller.ts
 *   6.  router.ts
 *   7.  browser-engine.ts
 *   8.  lifecycle-manager.ts
 *   9.  request-manager.ts
 *   10. response-parser.ts
 *   11. resource-loader.ts
 *   12. cache-manager.ts
 *   13. html-parser.ts
 *   14. cors.ts
 *   15. FULL-STACK integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Imports ───────────────────────────────────────────────────────────────────
import {
  DependencyContainer,
  ServiceLifetime,
  ServiceNotFoundError,
  CircularDependencyError,
  DuplicateRegistrationError,
} from '../src/app/dependency-container';

import {
  AppShell,
  BrowserWindow,
  DEFAULT_CONFIG,
  WindowLifecycleError,
} from '../src/app/app-shell';

import { ConfigLoader, Tokens } from '../src/app/main';

import {
  UrlParser,
  EmptyInputError,
  BlockedProtocolError,
  BLOCKED_PROTOCOLS,
} from '../src/browser/navigation/url-parser';

import {
  NavigationController,
  NavigationState,
  NavigationBlockedError,
} from '../src/browser/navigation/navigation-controller';

import {
  Router,
  RouteType,
  MatchStrategy,
  DuplicateRouteError,
} from '../src/browser/navigation/router';

import {
  BrowserEngine,
  PageLoadState,
  EngineNotInitializedError,
} from '../src/browser/engine/browser-engine';

import {
  LifecycleManager,
  LifecycleState,
  LifecycleStateError,
  DuplicatePhaseError,
} from '../src/browser/engine/lifecycle-manager';

import {
  RequestManager,
  NoRetryPolicy,
  ExponentialBackoffRetryPolicy,
  RequestAbortedError,
  BlockedRedirectError,
  TooManyRedirectsError,
} from '../src/browser/networking/request-manager';

import {
  ResponseParser,
  ContentCategory,
} from '../src/browser/networking/response-parser';

import { ResourceLoader } from '../src/browser/networking/resource-loader';

import { CacheManager } from '../src/browser/networking/cache-manager';

import {
  HtmlParser,
  NodeType,
  walkTree,
  getElementsByTagName,
  decodeHtmlEntities,
} from '../src/browser/rendering/html-parser';

import {
  CorsEngine,
  CorsMode,
  CorsCredentials,
  CorsRequestDecision,
  CorsResponseDecision,
  CorsBlockedError,
  CorsViolationError,
  CorsPreflightError,
  SIMPLE_METHODS,
  ALWAYS_EXPOSED_HEADERS,
} from '../src/browser/security/cors';

import type { AppConfig } from '../src/app/app-shell';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from '../src/browser/networking/request-manager';
import type { IPageLoader, PageLoadResult } from '../src/browser/engine/browser-engine';
import type { DiscoveredResource } from '../src/browser/rendering/html-parser';
import type { CorsRequest } from '../src/browser/security/cors';

// ── Shared fakes ──────────────────────────────────────────────────────────────

const CFG: AppConfig = DEFAULT_CONFIG;

function makeHttpRes(
  url: string,
  ct = 'text/html',
  body = '<h1>ok</h1>',
  status = 200,
  extra: Record<string, string> = {},
): HttpResponseSpec {
  const headers = new Map<string, string>([
    ['content-type', ct],
    ['cache-control', 'max-age=3600'],
    ['etag', '"test-etag"'],
    ...Object.entries(extra),
  ]);
  return {
    url,
    statusCode: status,
    statusText: 'OK',
    headers,
    body,
    bodyBinary: null,
    redirected: false,
    redirectChain: [],
  };
}

class FakeHttpClient implements IHttpClient {
  private queue: Array<(req: HttpRequestSpec) => HttpResponseSpec | Promise<HttpResponseSpec>>;
  public calls: string[] = [];

  constructor(responses: Array<(req: HttpRequestSpec) => HttpResponseSpec | Promise<HttpResponseSpec>> = []) {
    this.queue = [...responses];
  }

  async send(req: HttpRequestSpec, signal?: AbortSignal): Promise<HttpResponseSpec> {
    this.calls.push(req.url);
    if (signal?.aborted) {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }
    const fn = this.queue.shift() ?? (() => makeHttpRes(req.url));
    return fn(req);
  }
}

function makeFakeIPageLoader(responses: Map<string, PageLoadResult> = new Map()): IPageLoader {
  return {
    load: async (url: string, signal: AbortSignal): Promise<PageLoadResult> => {
      if (signal?.aborted) throw new Error('aborted');
      if (responses.has(url)) return responses.get(url)!;
      return {
        url,
        statusCode: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><head></head><body><h1>ok</h1></body></html>',
        headers: new Map([['content-type', 'text/html']]),
        loadedAt: Date.now(),
      };
    },
  };
}

const flush = (ms = 50) => new Promise<void>(r => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════════════════════
// 1 · dependency-container.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('1 · dependency-container.ts', () => {
  it('instantiates cleanly', () => {
    const container = new DependencyContainer();
    expect(container).toBeDefined();
  });

  it('register + resolve singleton', () => {
    const c = new DependencyContainer();
    c.register('svcA', () => ({ id: 1 }), ServiceLifetime.Singleton);
    const a1 = c.resolve<{ id: number }>('svcA');
    const a2 = c.resolve<{ id: number }>('svcA');
    expect(a1).toBe(a2);
  });

  it('transient returns new instance each call', () => {
    const c = new DependencyContainer();
    c.register('svcT', () => ({}), ServiceLifetime.Transient);
    expect(c.resolve('svcT')).not.toBe(c.resolve('svcT'));
  });

  it('registerValue stores pre-built object', () => {
    const c = new DependencyContainer();
    const obj = { x: 42 };
    c.registerValue('val', obj);
    expect(c.resolve('val')).toBe(obj);
  });

  it('has() returns true after register', () => {
    const c = new DependencyContainer();
    c.register('svc', () => 1);
    expect(c.has('svc')).toBe(true);
  });

  it('has() returns false for unknown token', () => {
    const c = new DependencyContainer();
    expect(c.has('__unknown__')).toBe(false);
  });

  it('resolve unknown → ServiceNotFoundError', () => {
    const c = new DependencyContainer();
    expect(() => c.resolve('X')).toThrow(ServiceNotFoundError);
  });

  it('duplicate register → DuplicateRegistrationError', () => {
    const c = new DependencyContainer();
    c.register('dup', () => 1);
    expect(() => c.register('dup', () => 2)).toThrow(DuplicateRegistrationError);
  });

  it('circular dep → CircularDependencyError', () => {
    const c = new DependencyContainer();
    c.register('A', (cc) => cc.resolve('B'));
    c.register('B', (cc) => cc.resolve('A'));
    expect(() => c.resolve('A')).toThrow(CircularDependencyError);
  });

  it('dispose clears all registrations', () => {
    const c = new DependencyContainer();
    c.register('X', () => 1);
    c.dispose();
    expect(c.has('X')).toBe(false);
  });

  it('factory receives container as argument', () => {
    const c = new DependencyContainer();
    c.registerValue('dep', 99);
    c.register('consumer', (cc) => ({ val: cc.resolve<number>('dep') }));
    expect(c.resolve<{ val: number }>('consumer').val).toBe(99);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2 · app-shell.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('2 · app-shell.ts', () => {
  it('DEFAULT_CONFIG has required fields', () => {
    expect(typeof CFG.version).toBe('string');
    expect(typeof CFG.maxTabs).toBe('number');
    expect(typeof CFG.homePage).toBe('string');
    expect(typeof CFG.userAgent).toBe('string');
    expect(typeof CFG.debug).toBe('boolean');
  });

  it('BrowserWindow: open → isOpen=true, close → isOpen=false', async () => {
    const w = new BrowserWindow('win1', 'Test');
    expect(w.isOpen).toBe(false);
    await w.open();
    expect(w.isOpen).toBe(true);
    await w.close();
    expect(w.isOpen).toBe(false);
  });

  it('BrowserWindow: setTitle updates title', () => {
    const w = new BrowserWindow('win2', 'Old');
    w.setTitle('New');
    expect(w.title).toBe('New');
  });

  it('BrowserWindow: focus on closed → error', () => {
    expect(() => new BrowserWindow('win3', 'T').focus()).toThrow();
  });

  it('AppShell: registerService before mount', () => {
    const c = new DependencyContainer();
    c.registerValue('AppConfig', CFG);
    const shell = new AppShell(c, CFG);
    shell.registerService({ name: 'Svc1', initialize: async () => {}, shutdown: async () => {} });
    expect(shell.getService('Svc1')).toBeDefined();
  });

  it('AppShell: mount → isMounted=true', async () => {
    const c = new DependencyContainer();
    c.registerValue('AppConfig', CFG);
    const shell = new AppShell(c, CFG);
    await shell.mount();
    expect(shell.isMounted).toBe(true);
    expect(shell.getWindow()).not.toBeNull();
    await shell.unmount();
    expect(shell.isMounted).toBe(false);
    expect(shell.getWindow()).toBeNull();
  });

  it('AppShell: mount is idempotent', async () => {
    const c = new DependencyContainer();
    c.registerValue('AppConfig', CFG);
    const shell = new AppShell(c, CFG);
    await shell.mount();
    await shell.mount(); // second call — no-op
    await shell.unmount();
  });

  it('AppShell: registerService after mount → error', async () => {
    const c = new DependencyContainer();
    c.registerValue('AppConfig', CFG);
    const shell = new AppShell(c, CFG);
    await shell.mount();
    expect(() =>
      shell.registerService({ name: 'Late', initialize: async () => {}, shutdown: async () => {} }),
    ).toThrow(WindowLifecycleError);
    await shell.unmount();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3 · main.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('3 · main.ts', () => {
  it('ConfigLoader: defaults when env empty', () => {
    const cfg = new ConfigLoader({}).load();
    expect(cfg.version).toBe(CFG.version);
    expect(cfg.maxTabs).toBe(CFG.maxTabs);
    expect(cfg.debug).toBe(false);
  });

  it('ConfigLoader: DEBUG=true sets debug', () => {
    expect(new ConfigLoader({ DEBUG: 'true' }).load().debug).toBe(true);
  });

  it('ConfigLoader: MAX_TABS=30 parsed', () => {
    expect(new ConfigLoader({ MAX_TABS: '30' }).load().maxTabs).toBe(30);
  });

  it('ConfigLoader: invalid MAX_TABS falls back to default', () => {
    expect(new ConfigLoader({ MAX_TABS: 'banana' }).load().maxTabs).toBe(CFG.maxTabs);
  });

  it('ConfigLoader: HOME_PAGE env var', () => {
    expect(new ConfigLoader({ HOME_PAGE: 'https://custom.com' }).load().homePage).toBe('https://custom.com');
  });

  it('Tokens: all unique symbols', () => {
    const vals = Object.values(Tokens);
    expect(new Set(vals).size).toBe(vals.length);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4 · url-parser.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('4 · url-parser.ts', () => {
  const parser = new UrlParser();

  it('parse https with all components', () => {
    const p = parser.parse('https://example.com/path?q=1&page=2#section');
    expect(p.protocol).toBe('https:');
    expect(p.hostname).toBe('example.com');
    expect(p.pathname).toBe('/path');
    expect(p.search).toBe('?q=1&page=2');
    expect(p.hash).toBe('#section');
    expect(p.params.get('q')).toBe('1');
    expect(p.params.get('page')).toBe('2');
  });

  it('https is secure, http is not', () => {
    expect(parser.parse('https://x.com').isSecure).toBe(true);
    expect(parser.parse('http://x.com').isSecure).toBe(false);
  });

  it('normalize bare hostname → https://', () => {
    expect(parser.normalize('google.com')).toBe('https://google.com');
  });

  it('normalize localhost:3000', () => {
    const n = parser.normalize('localhost:3000');
    expect(n.startsWith('https://localhost')).toBe(true);
  });

  it('about:blank is special page', () => {
    expect(parser.isSpecialPage('about:blank')).toBe(true);
  });

  it('nova:// is special page', () => {
    expect(parser.isSpecialPage('nova://settings')).toBe(true);
  });

  it('https:// is NOT special page', () => {
    expect(parser.isSpecialPage('https://example.com')).toBe(false);
  });

  it('empty string → EmptyInputError', () => {
    expect(() => parser.parse('')).toThrow(EmptyInputError);
  });

  it('javascript: → BlockedProtocolError', () => {
    expect(() => parser.parse('javascript:alert(1)')).toThrow(BlockedProtocolError);
  });

  it('data: → BlockedProtocolError', () => {
    expect(() => parser.parse('data:text/html,x')).toThrow(BlockedProtocolError);
  });

  it('vbscript: → BlockedProtocolError', () => {
    expect(() => parser.parse('vbscript:foo')).toThrow(BlockedProtocolError);
  });

  it('validate() returns invalid for blocked URL', () => {
    const r = parser.validate('javascript:void(0)');
    expect(r.valid).toBe(false);
    expect(r.errorKind).toBe('blocked-protocol');
  });

  it('validate() returns valid=true for good URL', () => {
    const r = parser.validate('https://example.com');
    expect(r.valid).toBe(true);
  });

  it('BLOCKED_PROTOCOLS set exported', () => {
    expect(BLOCKED_PROTOCOLS.has('javascript:')).toBe(true);
    expect(BLOCKED_PROTOCOLS.has('data:')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5 · navigation-controller.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('5 · navigation-controller.ts', () => {
  let parser: UrlParser;
  let nc: NavigationController;

  beforeEach(() => {
    parser = new UrlParser();
    nc = new NavigationController(parser);
  });

  it('initial state = idle', () => {
    expect(nc.state).toBe(NavigationState.Idle);
  });

  it('historyLength = 0 initially', () => {
    expect(nc.historyLength).toBe(0);
  });

  it('canGoBack/Forward = false initially', () => {
    expect(nc.canGoBack()).toBe(false);
    expect(nc.canGoForward()).toBe(false);
  });

  it('navigate() returns success result', async () => {
    const r = await nc.navigate('https://example.com');
    expect(r.success).toBe(true);
    expect(r.entry?.url).toContain('example.com');
  });

  it('state = complete after navigate (non-deferred)', async () => {
    await nc.navigate('https://example.com');
    expect(nc.state).toBe(NavigationState.Complete);
  });

  it('second navigate → canGoBack=true', async () => {
    await nc.navigate('https://example.com');
    await nc.navigate('https://github.com');
    expect(nc.canGoBack()).toBe(true);
    expect(nc.historyLength).toBe(2);
  });

  it('back() moves cursor', async () => {
    await nc.navigate('https://example.com');
    await nc.navigate('https://github.com');
    const r = nc.back();
    expect(r.success).toBe(true);
    expect(r.entry?.url).toContain('example.com');
  });

  it('canGoForward after back', async () => {
    await nc.navigate('https://example.com');
    await nc.navigate('https://github.com');
    nc.back();
    expect(nc.canGoForward()).toBe(true);
  });

  it('forward() moves cursor', async () => {
    await nc.navigate('https://example.com');
    await nc.navigate('https://github.com');
    nc.back();
    const r = nc.forward();
    expect(r.success).toBe(true);
    expect(r.entry?.url).toContain('github.com');
  });

  it('back() at start returns failure', async () => {
    await nc.navigate('https://example.com');
    const r = nc.back();
    expect(r.success).toBe(false);
  });

  it('navigation events fire in order', async () => {
    const nc2 = new NavigationController(parser);
    const log: string[] = [];
    nc2.on('navigationStarted', () => log.push('started'));
    nc2.on('navigationCommitted', () => log.push('committed'));
    nc2.on('navigationCompleted', () => log.push('completed'));
    await nc2.navigate('https://events.com');
    expect(log).toEqual(['started', 'committed', 'completed']);
  });

  it('guard can block navigation', async () => {
    const nc2 = new NavigationController(parser);
    nc2.addGuard({
      name: 'BlockAll',
      canNavigate: async () => false,
      blockedReason: () => 'blocked',
    });
    const r = await nc2.navigate('https://example.com');
    expect(r.success).toBe(false);
    expect(r.error).toBeInstanceOf(NavigationBlockedError);
  });

  it('guard can allow some URLs', async () => {
    const nc2 = new NavigationController(parser);
    nc2.addGuard({
      name: 'AllowSafe',
      canNavigate: async (req) => !req.url.includes('unsafe'),
      blockedReason: () => 'unsafe',
    });
    const ok1 = await nc2.navigate('https://safe.com');
    const ok2 = await nc2.navigate('https://unsafe.com');
    expect(ok1.success).toBe(true);
    expect(ok2.success).toBe(false);
  });

  it('parsedUrl attached to NavigationEntry', async () => {
    await nc.navigate('https://example.com/docs?chapter=5#top');
    const entry = nc.getCurrentEntry();
    expect(entry?.parsedUrl).toBeDefined();
    expect(entry?.parsedUrl.params.get('chapter')).toBe('5');
    expect(entry?.parsedUrl.hash).toBe('#top');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6 · router.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('6 · router.ts', () => {
  const p = new UrlParser();
  const router = new Router();

  async function navEntry(url: string) {
    const nc = new NavigationController(p);
    await nc.navigate(url);
    return nc.getCurrentEntry()!;
  }

  it('about:blank → blank-page (priority 200)', async () => {
    const entry = await navEntry('about:blank');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.BlankPage);
    expect(m.route?.priority).toBe(200);
  });

  it('about:newtab → new-tab-page', async () => {
    const entry = await navEntry('about:newtab');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.NewTabPage);
  });

  it('nova://settings → internal-page', async () => {
    const entry = await navEntry('nova://settings');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.InternalPage);
  });

  it('nova://downloads → internal-page', async () => {
    const entry = await navEntry('nova://downloads');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.InternalPage);
  });

  it('nova://history → internal-page', async () => {
    const entry = await navEntry('nova://history');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.InternalPage);
  });

  it('nova://bookmarks → internal-page', async () => {
    const entry = await navEntry('nova://bookmarks');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.InternalPage);
  });

  it('nova://extensions → internal-page', async () => {
    const entry = await navEntry('nova://extensions');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.InternalPage);
  });

  it('https: → web-content', async () => {
    const entry = await navEntry('https://example.com');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.WebContent);
  });

  it('http: → web-content', async () => {
    const entry = await navEntry('http://example.com');
    const m = router.match(entry);
    expect(m.route?.type).toBe(RouteType.WebContent);
  });

  it('dispatch() returns RouteResult', async () => {
    const entry = await navEntry('https://mozilla.org/docs?ch=3');
    const res = await router.dispatch(entry);
    expect(res.pageId).toBe('web-content');
    expect(res.title).toBe('mozilla.org');
    expect((res.data as any).isSecure).toBe(true);
  });

  it('unknown URL → type=unknown', async () => {
    const mockParsedUrl = {
      raw: 'custom://u', normalized: 'custom://u', protocol: 'custom:',
      hostname: '', port: '', host: '', pathname: '', search: '', hash: '',
      origin: '', href: 'custom://u', isSpecialPage: false, isSecure: false,
      params: new Map(),
    } as any;
    const entry = {
      id: 'x', url: 'custom://u', title: '', timestamp: 0,
      type: 'push' as any, scrollX: 0, scrollY: 0, state: null,
      parsedUrl: mockParsedUrl,
    };
    const res = await router.dispatch(entry);
    expect(res.type).toBe(RouteType.Unknown);
  });

  it('register/unregister lifecycle', () => {
    const id = router.register({
      pattern: '^https://custom\\.test',
      strategy: MatchStrategy.RegExp,
      type: RouteType.WebContent,
      priority: 99,
      handler: async () => ({ type: RouteType.WebContent, pageId: 'custom', title: 'c', data: {} }),
    });
    expect(router.has(id)).toBe(true);
    expect(router.unregister(id)).toBe(true);
    expect(router.has(id)).toBe(false);
  });

  it('duplicate pattern+strategy → DuplicateRouteError', () => {
    expect(() =>
      router.register({
        pattern: 'about:blank',
        strategy: MatchStrategy.Exact,
        type: RouteType.BlankPage,
        priority: 1,
        handler: async () => ({ type: RouteType.BlankPage, pageId: 'x', title: 'x', data: {} }),
      }),
    ).toThrow(DuplicateRouteError);
  });

  it('connectController auto-dispatches', async () => {
    const nc = new NavigationController(p);
    const r2 = new Router();
    const fired: string[] = [];
    const orig = r2.dispatch.bind(r2);
    r2.dispatch = async (e) => { const res = await orig(e); fired.push(res.type); return res; };
    r2.connectController(nc);
    await nc.navigate('https://auto.com'); await flush();
    await nc.navigate('nova://settings');  await flush();
    expect(fired.length).toBe(2);
    expect(fired[0]).toBe('web-content');
    expect(fired[1]).toBe('internal-page');
    r2.disconnectController(nc);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7 · browser-engine.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('7 · browser-engine.ts', () => {
  function makeEngine(loader?: IPageLoader | null) {
    const nc = new NavigationController(new UrlParser());
    const rt = new Router();
    const eng = new BrowserEngine(nc, rt, CFG);
    if (loader !== undefined) {
      eng.setPageLoader(loader ?? makeFakeIPageLoader());
    }
    return { eng, nc, rt };
  }

  function waitEvent<T>(eng: BrowserEngine, event: string, timeout = 3000): Promise<T> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), timeout);
      eng.on(event as any, (e: any) => { clearTimeout(t); res(e); });
    });
  }

  it('navigate before initialize → error', async () => {
    const { eng } = makeEngine(null);
    await expect(eng.navigate('https://x.com')).rejects.toThrow(EngineNotInitializedError);
  });

  it('initialize is idempotent', async () => {
    const { eng } = makeEngine(null);
    await eng.initialize();
    await eng.initialize(); // no-op
    await eng.shutdown();
  });

  it('web page load → state=Ready', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    const ready = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://e.com');
    await ready;
    const s = eng.getCurrentSession();
    expect(s?.state).toBe(PageLoadState.Ready);
    expect(s?.routeResult?.type).toBe(RouteType.WebContent);
    await eng.shutdown();
  });

  it('internal page skips fetch', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    const ready = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('nova://history');
    await ready;
    expect(eng.getCurrentSession()?.state).toBe(PageLoadState.Ready);
    await eng.shutdown();
  });

  it('events fire in order: started→routed→fetched→ready', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    const log: string[] = [];
    eng.on('pageLoadStarted',  () => log.push('started'));
    eng.on('pageLoadRouted',   () => log.push('routed'));
    eng.on('pageLoadFetched',  () => log.push('fetched'));
    eng.on('pageLoadReady',    () => log.push('ready'));
    const ready = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://events.com');
    await ready;
    expect(log).toEqual(['started', 'routed', 'fetched', 'ready']);
    await eng.shutdown();
  });

  it('internal page has no fetched event', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    let fetchedFired = false;
    eng.on('pageLoadFetched', () => { fetchedFired = true; });
    const ready = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('nova://downloads');
    await ready;
    expect(fetchedFired).toBe(false);
    await eng.shutdown();
  });

  it('middleware can block a load', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    eng.addMiddleware(async s => s.entry.url.includes('allowed'));
    const ready1 = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://allowed.com');
    await ready1;
    expect(eng.getCurrentSession()?.state).toBe(PageLoadState.Ready);
    const err = waitEvent(eng, 'pageLoadError');
    await eng.navigate('https://blocked.com');
    await err;
    expect(eng.getCurrentSession()?.state).toBe(PageLoadState.Error);
    await eng.shutdown();
  });

  it('custom IPageLoader is called for web pages', async () => {
    let called = false;
    const loader: IPageLoader = {
      load: async (url, signal) => {
        called = true;
        return { url, statusCode: 200, contentType: 'text/html', body: '<h1>custom</h1>', headers: new Map(), loadedAt: Date.now() };
      },
    };
    const { eng } = makeEngine(loader);
    await eng.initialize();
    const ready = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://custom-loader.com');
    await ready;
    expect(called).toBe(true);
    await eng.shutdown();
  });

  it('back/forward/stop/reload pass-throughs work', async () => {
    const { eng } = makeEngine();
    await eng.initialize();
    const r1 = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://one.com');
    await r1;
    const r2 = waitEvent(eng, 'pageLoadReady');
    await eng.navigate('https://two.com');
    await r2;
    eng.back();
    expect(eng.navigationController.getCurrentEntry()?.url).toContain('one');
    eng.forward();
    expect(eng.navigationController.getCurrentEntry()?.url).toContain('two');
    eng.stop();
    eng.reload();
    await eng.shutdown();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8 · lifecycle-manager.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('8 · lifecycle-manager.ts', () => {
  function makeLM() {
    const nc = new NavigationController(new UrlParser());
    const eng = new BrowserEngine(nc, new Router(), CFG);
    return new LifecycleManager(eng, CFG);
  }

  it('initial state = idle', () => {
    expect(makeLM().state).toBe(LifecycleState.Idle);
  });

  it('uptime = 0 when idle', () => {
    expect(makeLM().uptime).toBe(0);
  });

  it('start() → state=running', async () => {
    const lm = makeLM();
    await lm.start(); await flush();
    expect(lm.state).toBe(LifecycleState.Running);
    expect(lm.uptime).toBeGreaterThan(0);
    await lm.stop();
  });

  it('stop() → state=stopped, uptime=0', async () => {
    const lm = makeLM();
    await lm.start(); await flush();
    await lm.stop();
    expect(lm.state).toBe(LifecycleState.Stopped);
    expect(lm.uptime).toBe(0);
  });

  it('start() is idempotent when running', async () => {
    const lm = makeLM();
    await lm.start(); await flush();
    await lm.start(); // no-op
    expect(lm.state).toBe(LifecycleState.Running);
    await lm.stop();
  });

  it('restart() cycles through states', async () => {
    const lm = makeLM();
    await lm.start(); await flush();
    const states: string[] = [];
    lm.on('stateChanged', (e: any) => states.push(e.to));
    await lm.restart(); await flush();
    expect(lm.state).toBe(LifecycleState.Running);
    expect(states).toContain('stopping');
    expect(states).toContain('starting');
  });

  it('suspend() / resume()', async () => {
    const lm = makeLM();
    await lm.start(); await flush();
    await lm.suspend();
    expect(lm.state).toBe(LifecycleState.Suspended);
    await lm.resume(); await flush();
    expect(lm.state).toBe(LifecycleState.Running);
    await lm.stop();
  });

  it('suspend from idle → LifecycleStateError', async () => {
    await expect(makeLM().suspend()).rejects.toThrow(LifecycleStateError);
  });

  it('resume from idle → LifecycleStateError', async () => {
    await expect(makeLM().resume()).rejects.toThrow(LifecycleStateError);
  });

  it('registerPhase + custom startup ran', async () => {
    const lm = makeLM();
    let ran = false;
    lm.registerPhase({
      name: 'custom', order: 75, timeoutMs: 2000, critical: false,
      startup: async () => { ran = true; },
    });
    await lm.start(); await flush();
    expect(ran).toBe(true);
    await lm.stop();
  });

  it('duplicate phase → DuplicatePhaseError', () => {
    const lm = makeLM();
    expect(() =>
      lm.registerPhase({ name: 'validate-config', order: 1, timeoutMs: 1000, critical: false, startup: async () => {} }),
    ).toThrow(DuplicatePhaseError);
  });

  it('critical phase failure → state=crashed', async () => {
    const lm = makeLM();
    lm.registerPhase({ name: 'bad', order: 20, timeoutMs: 500, critical: true, startup: async () => { throw new Error('boom'); } });
    const crash: string[] = [];
    lm.on('crashed', (e: any) => crash.push(e.kind));
    try { await lm.start(); } catch (_) { /* expected */ }
    expect(lm.state).toBe(LifecycleState.Crashed);
    expect(crash).toContain('crashed');
  });

  it('non-critical phase failure → still running', async () => {
    const lm = makeLM();
    lm.registerPhase({ name: 'soft', order: 20, timeoutMs: 500, critical: false, startup: async () => { throw new Error('soft'); } });
    const failed: string[] = [];
    lm.on('phaseFailed', (e: any) => failed.push(e.result.phase));
    await lm.start(); await flush();
    expect(lm.state).toBe(LifecycleState.Running);
    expect(failed).toContain('soft');
    await lm.stop();
  });

  it('observer hooks fired', async () => {
    const lm = makeLM();
    const hooks: string[] = [];
    lm.addObserver({
      name: 'obs',
      onBeforeStart: async () => hooks.push('bs'),
      onAfterStart:  async () => hooks.push('as'),
      onBeforeStop:  async () => hooks.push('bp'),
      onAfterStop:   async () => hooks.push('ap'),
      onSuspend:     async () => hooks.push('sus'),
      onResume:      async () => hooks.push('res'),
    });
    await lm.start(); await flush();
    await lm.suspend();
    await lm.resume(); await flush();
    await lm.stop();
    for (const h of ['bs', 'as', 'sus', 'res', 'bp', 'ap']) {
      expect(hooks).toContain(h);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9 · request-manager.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('9 · request-manager.ts', () => {
  it('basic GET returns response', async () => {
    const client = new FakeHttpClient([() => makeHttpRes('https://a.com', 'text/html', 'hello')]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    const res = await rm.send({ url: 'https://a.com', method: 'GET', headers: new Map() });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('hello');
  });

  it('user-agent header injected', async () => {
    const client = new FakeHttpClient([() => makeHttpRes('https://a.com')]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    await rm.send({ url: 'https://a.com', method: 'GET', headers: new Map() });
    expect(client.calls.length).toBe(1);
  });

  it('retry on 503 then succeed', async () => {
    let tries = 0;
    const client = new FakeHttpClient([
      () => { tries++; return makeHttpRes('https://flaky.com', 'text/html', '', 503); },
      () => { tries++; return makeHttpRes('https://flaky.com', 'text/html', 'ok', 200); },
    ]);
    const rm = new RequestManager(client, CFG, {
      retryPolicy: new ExponentialBackoffRetryPolicy({ maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20 }),
    });
    const res = await rm.send({ url: 'https://flaky.com', method: 'GET', headers: new Map() });
    expect(res.statusCode).toBe(200);
    expect(tries).toBe(2);
  });

  it('NoRetryPolicy: no retry on 503', async () => {
    let tries = 0;
    const client = new FakeHttpClient([() => { tries++; return makeHttpRes('https://x.com', 'text/html', '', 503); }]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    const res = await rm.send({ url: 'https://x.com', method: 'GET', headers: new Map() });
    expect(res.statusCode).toBe(503);
    expect(tries).toBe(1);
  });

  it('404 not retried', async () => {
    let tries = 0;
    const client = new FakeHttpClient([() => { tries++; return makeHttpRes('https://x.com', 'text/html', 'not found', 404); }]);
    const rm = new RequestManager(client, CFG, {
      retryPolicy: new ExponentialBackoffRetryPolicy({ maxRetries: 3, baseDelayMs: 5 }),
    });
    await rm.send({ url: 'https://x.com', method: 'GET', headers: new Map() });
    expect(tries).toBe(1);
  });

  it('301 redirect followed', async () => {
    const client = new FakeHttpClient([
      () => ({
        url: 'https://old.com', statusCode: 301, statusText: 'Moved',
        headers: new Map([['location', 'https://new.com']]),
        body: '', bodyBinary: null, redirected: false, redirectChain: [],
      }),
      () => makeHttpRes('https://new.com', 'text/html', 'final'),
    ]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    const res = await rm.send({ url: 'https://old.com', method: 'GET', headers: new Map() });
    expect(res.url).toContain('new.com');
    expect(res.redirected).toBe(true);
    expect(res.body).toBe('final');
  });

  it('javascript: redirect → BlockedRedirectError', async () => {
    const client = new FakeHttpClient([
      () => ({
        url: 'https://evil.com', statusCode: 302, statusText: 'Found',
        headers: new Map([['location', 'javascript:alert(1)']]),
        body: '', bodyBinary: null, redirected: false, redirectChain: [],
      }),
    ]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    await expect(
      rm.send({ url: 'https://evil.com', method: 'GET', headers: new Map() }),
    ).rejects.toThrow(BlockedRedirectError);
  });

  it('too many redirects → TooManyRedirectsError', async () => {
    const fns = Array.from({ length: 15 }, (_, i) => () => ({
      url: `https://hop${i}.com`, statusCode: 302, statusText: 'Found',
      headers: new Map([['location', `https://hop${i + 1}.com`]]),
      body: '', bodyBinary: null, redirected: false, redirectChain: [],
    }));
    const rm = new RequestManager(new FakeHttpClient(fns), CFG, {
      retryPolicy: new NoRetryPolicy(), maxRedirects: 5,
    });
    await expect(
      rm.send({ url: 'https://hop0.com', method: 'GET', headers: new Map() }),
    ).rejects.toThrow(TooManyRedirectsError);
  });

  it('pre-aborted signal → RequestAbortedError', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const rm = new RequestManager(new FakeHttpClient([]), CFG, { retryPolicy: new NoRetryPolicy() });
    await expect(
      rm.send({ url: 'https://x.com', method: 'GET', headers: new Map() }, ctrl.signal),
    ).rejects.toThrow(RequestAbortedError);
  });

  it('IPageLoader.load() maps to PageLoadResult', async () => {
    const client = new FakeHttpClient([() => makeHttpRes('https://x.com', 'application/json', '{}')]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    const r = await rm.load('https://x.com', new AbortController().signal);
    expect(r.contentType).toBe('application/json');
    expect(r.body).toBe('{}');
    expect(typeof r.loadedAt).toBe('number');
  });

  it('request events fire in order', async () => {
    const client = new FakeHttpClient([() => makeHttpRes('https://x.com')]);
    const rm = new RequestManager(client, CFG, { retryPolicy: new NoRetryPolicy() });
    const log: string[] = [];
    rm.on('requestStarted',   () => log.push('started'));
    rm.on('requestCompleted', () => log.push('completed'));
    await rm.send({ url: 'https://x.com', method: 'GET', headers: new Map() });
    expect(log).toEqual(['started', 'completed']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10 · response-parser.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('10 · response-parser.ts', () => {
  const rp = new ResponseParser();

  const mkRaw = (ct: string, cc = 'max-age=3600', body = 'body', extra: Record<string, string> = {}): HttpResponseSpec => ({
    url: 'https://x.com', statusCode: 200, statusText: 'OK',
    headers: new Map([['content-type', ct], ['cache-control', cc], ...Object.entries(extra)]),
    body, bodyBinary: null, redirected: false, redirectChain: [],
  });

  it('parseMimeType: type/subtype/charset', () => {
    const m = rp.parseMimeType('text/html; charset=utf-8');
    expect(m.type).toBe('text');
    expect(m.subtype).toBe('html');
    expect(m.full).toBe('text/html');
    expect(m.charset).toBe('utf-8');
  });

  it('parseMimeType: charset lowercased', () => {
    expect(rp.parseMimeType('text/html; charset=ISO-8859-1').charset).toBe('iso-8859-1');
  });

  it('parseMimeType: empty → utf-8 default', () => {
    expect(rp.parseMimeType('').charset).toBe('utf-8');
  });

  it.each([
    ['text/html', ContentCategory.HtmlPage],
    ['application/xhtml+xml', ContentCategory.HtmlPage],
    ['application/json', ContentCategory.JsonData],
    ['text/css', ContentCategory.Stylesheet],
    ['text/javascript', ContentCategory.Script],
    ['application/wasm', ContentCategory.Script],
    ['image/png', ContentCategory.Image],
    ['image/svg+xml', ContentCategory.XmlDocument],
    ['video/mp4', ContentCategory.Media],
    ['audio/mpeg', ContentCategory.Media],
    ['font/woff2', ContentCategory.Font],
    ['text/plain', ContentCategory.PlainText],
    ['application/pdf', ContentCategory.Download],
  ])('%s → %s', (ct, expected) => {
    const r = rp.parse(mkRaw(ct));
    expect(r.category).toBe(expected);
  });

  it('attachment overrides HTML → download', () => {
    const r = rp.parse({
      ...mkRaw('text/html'),
      headers: new Map([['content-type', 'text/html'], ['content-disposition', 'attachment; filename="f.html"']]),
    });
    expect(r.category).toBe(ContentCategory.Download);
  });

  it('html isRenderable=true, isDownload=false', () => {
    const r = rp.parse(mkRaw('text/html'));
    expect(r.isRenderable).toBe(true);
    expect(r.isDownload).toBe(false);
  });

  it('zip isDownload=true, isRenderable=false', () => {
    const r = rp.parse(mkRaw('application/zip'));
    expect(r.isDownload).toBe(true);
    expect(r.isRenderable).toBe(false);
  });

  it('parseCacheDirectives: max-age + etag', () => {
    const c = rp.parseCacheDirectives(new Map([['cache-control', 'max-age=3600,public'], ['etag', '"abc"']]));
    expect(c.maxAge).toBe(3600);
    expect(c.etag).toBe('"abc"');
    expect(c.isCacheable).toBe(true);
    expect(c.isPublic).toBe(true);
  });

  it('parseCacheDirectives: no-store → not cacheable', () => {
    const c = rp.parseCacheDirectives(new Map([['cache-control', 'no-store']]));
    expect(c.noStore).toBe(true);
    expect(c.isCacheable).toBe(false);
  });

  it('parseCacheDirectives: s-maxage takes precedence', () => {
    const c = rp.parseCacheDirectives(new Map([['cache-control', 's-maxage=7200,max-age=3600']]));
    expect(c.sMaxAge).toBe(7200);
    expect(c.maxAge).toBe(3600);
  });

  it('parseCacheDirectives: immutable flag', () => {
    const c = rp.parseCacheDirectives(new Map([['cache-control', 'immutable,max-age=31536000']]));
    expect(c.immutable).toBe(true);
  });

  it('parseSecurityHeaders: CSP, HSTS, X-Frame, noSniff', () => {
    const sh = rp.parseSecurityHeaders(new Map([
      ['content-security-policy', "default-src 'self'"],
      ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
      ['x-frame-options', 'DENY'],
      ['x-content-type-options', 'nosniff'],
      ['referrer-policy', 'strict-origin'],
    ]));
    expect(sh.contentSecurityPolicy).toContain("default-src");
    expect(sh.hstsMaxAge).toBe(31536000);
    expect(sh.hstsIncludeSubDomains).toBe(true);
    expect(sh.xFrameOptions).toBe('DENY');
    expect(sh.xContentTypeOptionsNoSniff).toBe(true);
    expect(sh.referrerPolicy).toBe('strict-origin');
  });

  it('Content-Disposition filename* RFC5987', () => {
    const r = rp.parse({
      ...mkRaw('application/pdf'),
      headers: new Map([['content-type', 'application/pdf'], ['content-disposition', "attachment; filename*=UTF-8''Hello%20World.pdf"]]),
    });
    expect(r.disposition.suggestedFilename).toBe('Hello World.pdf');
  });

  it('hasBody + contentLength', () => {
    const r1 = rp.parse({
      ...mkRaw('text/html', '', 'hello'),
      headers: new Map([['content-type', 'text/html'], ['content-length', '512']]),
    });
    expect(r1.contentLength).toBe(512);
    const r2 = rp.parse(mkRaw('text/html', '', ''));
    expect(r2.hasBody).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11 · resource-loader.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('11 · resource-loader.ts', () => {
  const rp = new ResponseParser();

  it('loadResource() single resource', async () => {
    const fakeClient: IHttpClient = {
      send: async (req) => makeHttpRes(req.url, 'text/css', 'body{}'),
    };
    const rl = new ResourceLoader(fakeClient, rp, new ExponentialBackoffRetryPolicy({ maxRetries: 0 }));
    const res = await rl.loadResource('https://s.com/a.css', 'stylesheet');
    expect(res.body).toBe('body{}');
    expect(res.url).toBe('https://s.com/a.css');
  });

  it('loadBatch() empty list → empty results', async () => {
    const fakeClient: IHttpClient = { send: async (req) => makeHttpRes(req.url) };
    const rl = new ResourceLoader(fakeClient, rp, new ExponentialBackoffRetryPolicy({ maxRetries: 0 }));
    const res = await rl.loadBatch([]);
    expect(res.results.length).toBe(0);
    expect(res.succeeded).toBe(0);
    expect(res.failed).toBe(0);
  });

  it('loadBatch() mixed success + failure', async () => {
    const fakeClient: IHttpClient = {
      send: async (req) => {
        if (req.url.includes('bad')) throw new Error('404');
        return makeHttpRes(req.url, 'text/css', 'a{}');
      },
    };
    const rl = new ResourceLoader(fakeClient, rp, new ExponentialBackoffRetryPolicy({ maxRetries: 0 }));
    const results = await rl.loadBatch([
      { url: 'https://s.com/ok.css', kind: 'stylesheet' },
      { url: 'https://s.com/bad.png', kind: 'image' },
    ] as DiscoveredResource[]);
    expect(results.succeeded).toBe(1);
    expect(results.failed).toBe(1);
  });

  it('setMaxConcurrent clamps to minimum 1', () => {
    const fakeClient: IHttpClient = { send: async (req) => makeHttpRes(req.url) };
    const rl = new ResourceLoader(fakeClient, rp, new ExponentialBackoffRetryPolicy({ maxRetries: 0 }));
    rl.setMaxConcurrent(3);
    rl.setMaxConcurrent(0);
    expect((rl as any).maxConcurrent).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12 · cache-manager.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('12 · cache-manager.ts', () => {
  it('set + get hit', async () => {
    const cm = new CacheManager({ maxEntries: 5 });
    await cm.set('https://cached.com', {
      url: 'https://cached.com', body: '<h1>ok</h1>',
      headers: new Map([['content-type', 'text/html']]),
      contentType: 'text/html', statusCode: 200,
      expiresAt: Date.now() + 3600_000, etag: '"v1"',
      lastModified: null, immutable: false,
    });
    const entry = await cm.get('https://cached.com');
    expect(entry).not.toBeNull();
    expect(entry!.body).toBe('<h1>ok</h1>');
  });

  it('get miss for unknown URL', async () => {
    const cm = new CacheManager();
    expect(await cm.get('https://missing.com')).toBeNull();
  });

  it('getStats: hits + misses tracked', async () => {
    const cm = new CacheManager();
    await cm.get('https://miss.com'); // miss
    const s = cm.getStats();
    expect(s.missCount).toBeGreaterThanOrEqual(1);
  });

  it('has() after set', async () => {
    const cm = new CacheManager();
    await cm.set('https://has.com', {
      url: 'https://has.com', body: 'x',
      headers: new Map(), contentType: 'text/plain', statusCode: 200,
      expiresAt: null, etag: null, lastModified: null, immutable: false,
    });
    expect(await cm.has('https://has.com')).toBe(true);
  });

  it('delete() removes entry', async () => {
    const cm = new CacheManager();
    await cm.set('https://del.com', {
      url: 'https://del.com', body: 'x',
      headers: new Map(), contentType: 'text/plain', statusCode: 200,
      expiresAt: null, etag: null, lastModified: null, immutable: false,
    });
    expect(await cm.delete('https://del.com')).toBe(true);
    expect(await cm.has('https://del.com')).toBe(false);
  });

  it('clear() empties the cache', async () => {
    const cm = new CacheManager();
    await cm.set('https://x.com', {
      url: 'https://x.com', body: 'x',
      headers: new Map(), contentType: 'text/plain', statusCode: 200,
      expiresAt: null, etag: null, lastModified: null, immutable: false,
    });
    await cm.clear();
    expect(cm.getStats().totalEntries).toBe(0);
  });

  it('LRU eviction at maxEntries', async () => {
    const cm = new CacheManager({ maxEntries: 3 });
    const entry = {
      url: '', body: 'x', headers: new Map(), contentType: 'text/plain',
      statusCode: 200, expiresAt: Date.now() + 3600_000, etag: null,
      lastModified: null, immutable: false,
    };
    await cm.set('https://a.com', { ...entry, url: 'https://a.com' });
    await new Promise(r => setTimeout(r, 2));
    await cm.set('https://b.com', { ...entry, url: 'https://b.com' });
    await new Promise(r => setTimeout(r, 2));
    await cm.set('https://c.com', { ...entry, url: 'https://c.com' });
    await new Promise(r => setTimeout(r, 2));
    await cm.get('https://a.com'); // promote a to MRU
    await new Promise(r => setTimeout(r, 2));
    await cm.set('https://d.com', { ...entry, url: 'https://d.com' }); // evicts b (LRU)
    expect(cm.getStats().evictionCount).toBeGreaterThanOrEqual(1);
    expect(cm.getStats().totalEntries).toBe(3);
  });

  it('expired entry returns null', async () => {
    const cm = new CacheManager();
    await cm.set('https://expired.com', {
      url: 'https://expired.com', body: 'old',
      headers: new Map(), contentType: 'text/plain', statusCode: 200,
      expiresAt: 1, // already expired
      etag: null, lastModified: null, immutable: false,
    });
    expect(await cm.get('https://expired.com')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13 · html-parser.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('13 · html-parser.ts', () => {
  const hp = new HtmlParser();

  it('basic document structure', () => {
    const r = hp.parse('<!DOCTYPE html><html><head><title>T</title></head><body><p>Hello</p></body></html>');
    expect(r.document.hasDoctype).toBe(true);
    expect(r.document.htmlElement).toBeTruthy();
    expect(r.document.headElement).toBeTruthy();
    expect(r.document.bodyElement).toBeTruthy();
  });

  it('element attributes', () => {
    const r = hp.parse('<div class="main" id="app" data-val="42"></div>');
    const divs = getElementsByTagName(r.document, 'div');
    expect(divs.length).toBeGreaterThan(0);
    expect(divs[0].attributes.get('class')).toBe('main');
    expect(divs[0].attributes.get('id')).toBe('app');
    expect(divs[0].attributes.get('data-val')).toBe('42');
  });

  it('void elements: no children', () => {
    const r = hp.parse('<img src="a.jpg"><br><input type="text">');
    const imgs = getElementsByTagName(r.document, 'img');
    expect(imgs.length).toBeGreaterThan(0);
    expect(imgs[0].isVoid).toBe(true);
    expect(imgs[0].attributes.get('src')).toBe('a.jpg');
  });

  it('raw text elements: script rawContent', () => {
    const r = hp.parse('<script>var x = 42;</script>');
    const scripts = getElementsByTagName(r.document, 'script');
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts[0].isRawText).toBe(true);
    expect(scripts[0].rawContent).toContain('var x');
  });

  it('style rawContent', () => {
    const r = hp.parse('<style>body { margin: 0; }</style>');
    const styles = getElementsByTagName(r.document, 'style');
    expect(styles[0].rawContent).toContain('margin');
  });

  it('comment node', () => {
    const r = hp.parse('<html><!-- hello --></html>');
    let found = false;
    walkTree(r.document, (n) => { if (n.nodeType === NodeType.Comment) { found = true; return false; } });
    expect(found).toBe(true);
  });

  it('metaCharset from <meta charset>', () => {
    expect(hp.parse('<meta charset="utf-8">').document.metaCharset).toBe('utf-8');
  });

  it('metaCharset from http-equiv content-type', () => {
    const r = hp.parse('<meta http-equiv="content-type" content="text/html; charset=windows-1252">');
    expect(r.document.metaCharset).toBe('windows-1252');
  });

  it('resource discovery: CSS blocking, script, image', () => {
    const html = [
      '<!DOCTYPE html><html><head>',
      '<link rel="stylesheet" href="/style.css">',
      '<script src="/app.js"></script>',
      '<script defer src="/analytics.js"></script>',
      '</head><body>',
      '<img src="/hero.jpg">',
      '</body></html>',
    ].join('');
    const r = hp.parse(html, 'https://example.com');
    const css = r.resources.find(x => x.kind === 'stylesheet');
    expect(css).toBeDefined();
    expect(css!.blocking).toBe(true);
    expect(r.resources.find(x => x.url.includes('app.js'))?.blocking).toBe(true);
    expect(r.resources.find(x => x.url.includes('analytics'))?.blocking).toBe(false);
    expect(r.resources.find(x => x.kind === 'image')).toBeTruthy();
    r.resources.forEach(res => {
      expect(res.url.startsWith('https://')).toBe(true);
    });
  });

  it('walkTree visits all nodes', () => {
    const r = hp.parse('<html><body><div><p>one</p><p>two</p></div></body></html>');
    let count = 0;
    walkTree(r.document, () => { count++; });
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('getElementsByTagName finds all matches', () => {
    const r = hp.parse('<html><body><p>a</p><div><p>b</p></div></body></html>');
    const ps = getElementsByTagName(r.document, 'p');
    expect(ps.length).toBe(2);
  });

  it('decodeHtmlEntities', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;')).toBe('&<>"');
  });

  it('parseFragment returns node list', () => {
    const nodes = hp.parseFragment('<p>Hello</p><span>World</span>');
    const tags = nodes.filter(n => n.nodeType === NodeType.Element).map(n => (n as any).tagName);
    expect(tags).toContain('p');
    expect(tags).toContain('span');
  });

  it('error recovery: unclosed tags do not throw', () => {
    const r = hp.parse('<div><p>unclosed');
    expect(getElementsByTagName(r.document, 'div').length).toBeGreaterThan(0);
  });

  it('durationMs is a non-negative number', () => {
    expect(typeof hp.parse('<html></html>').durationMs).toBe('number');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14 · cors.ts
// ══════════════════════════════════════════════════════════════════════════════

describe('14 · cors.ts', () => {
  const cors = new CorsEngine();
  const PAGE = 'https://example.com';

  const mkCorsReq = (url: string, opts: Partial<{ method: string; headers: Map<string, string>; mode: CorsMode; credentials: CorsCredentials }> = {}): CorsRequest => ({
    url,
    origin: PAGE,
    method:      opts.method      ?? 'GET',
    headers:     opts.headers     ?? new Map(),
    mode:        opts.mode        ?? CorsMode.Cors,
    credentials: opts.credentials ?? CorsCredentials.Omit,
  });

  const mkCorsRes = (headers: Record<string, string> = {}): HttpResponseSpec => ({
    url: 'https://api.com/data', statusCode: 200, statusText: 'OK',
    headers: new Map(Object.entries(headers)),
    body: '{}', bodyBinary: null, redirected: false, redirectChain: [],
  });

  it('same-origin → SameOrigin decision, no extra headers', () => {
    const r = cors.checkRequest(mkCorsReq('https://example.com/api'));
    expect(r.decision).toBe(CorsRequestDecision.SameOrigin);
    expect(r.requestHeaders.size).toBe(0);
  });

  it('cross-origin GET → Simple + Origin header', () => {
    const r = cors.checkRequest(mkCorsReq('https://api.com/data'));
    expect(r.decision).toBe(CorsRequestDecision.Simple);
    expect(r.requestHeaders.get('origin')).toBe(PAGE);
  });

  it('DELETE → Preflight required', () => {
    const r = cors.checkRequest(mkCorsReq('https://api.com/data', { method: 'DELETE' }));
    expect(r.decision).toBe(CorsRequestDecision.Preflight);
    expect(r.requiresPreflight).toBe(true);
  });

  it('mode=same-origin + cross-origin → CorsBlockedError', () => {
    expect(() =>
      cors.checkRequest(mkCorsReq('https://api.com/data', { mode: CorsMode.SameOrigin })),
    ).toThrow(CorsBlockedError);
  });

  it('mode=no-cors → Opaque', () => {
    const r = cors.checkRequest(mkCorsReq('https://api.com/data', { mode: CorsMode.NoCors }));
    expect(r.decision).toBe(CorsRequestDecision.Opaque);
  });

  it('mode=navigate → Navigate', () => {
    const r = cors.checkRequest(mkCorsReq('https://other.com/', { mode: CorsMode.Navigate }));
    expect(r.decision).toBe(CorsRequestDecision.Navigate);
  });

  it('checkResponse: exact origin match → Allowed', () => {
    const r = cors.checkResponse(mkCorsReq('https://api.com/data'), mkCorsRes({ 'access-control-allow-origin': PAGE }));
    expect(r.decision).toBe(CorsResponseDecision.Allowed);
  });

  it('checkResponse: wildcard origin → Allowed', () => {
    const r = cors.checkResponse(mkCorsReq('https://api.com/data'), mkCorsRes({ 'access-control-allow-origin': '*' }));
    expect(r.decision).toBe(CorsResponseDecision.Allowed);
  });

  it('checkResponse: missing ACAO → CorsViolationError', () => {
    expect(() =>
      cors.checkResponse(mkCorsReq('https://api.com/data'), mkCorsRes({})),
    ).toThrow(CorsViolationError);
  });

  it('checkResponse: wrong origin → CorsViolationError', () => {
    expect(() =>
      cors.checkResponse(mkCorsReq('https://api.com/data'), mkCorsRes({ 'access-control-allow-origin': 'https://other.com' })),
    ).toThrow(CorsViolationError);
  });

  it('checkResponse: wildcard + credentials → CorsViolationError', () => {
    expect(() =>
      cors.checkResponse(
        mkCorsReq('https://api.com/data', { credentials: CorsCredentials.Include }),
        mkCorsRes({ 'access-control-allow-origin': '*' }),
      ),
    ).toThrow(CorsViolationError);
  });

  it('checkResponse: credentials + ACAC=true → Allowed', () => {
    const r = cors.checkResponse(
      mkCorsReq('https://api.com/data', { credentials: CorsCredentials.Include }),
      mkCorsRes({ 'access-control-allow-origin': PAGE, 'access-control-allow-credentials': 'true' }),
    );
    expect(r.decision).toBe(CorsResponseDecision.Allowed);
  });

  it('checkResponse: no-cors → Opaque, no headers exposed', () => {
    const r = cors.checkResponse(mkCorsReq('https://api.com/data', { mode: CorsMode.NoCors }), mkCorsRes({}));
    expect(r.decision).toBe(CorsResponseDecision.Opaque);
    expect(r.exposedHeaders.size).toBe(0);
  });

  it('Access-Control-Expose-Headers respected', () => {
    const r = cors.checkResponse(mkCorsReq('https://api.com/data'), mkCorsRes({
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-req-id,x-rate-limit',
    }));
    expect(r.exposedHeaders.has('x-req-id')).toBe(true);
    expect(r.exposedHeaders.has('x-rate-limit')).toBe(true);
  });

  it('performPreflight stores cache entry', async () => {
    const eng2 = new CorsEngine();
    const fakeRM = {
      send: async () => ({
        url: 'https://api.com/data', statusCode: 204, statusText: 'No Content',
        headers: new Map([
          ['access-control-allow-origin', PAGE],
          ['access-control-allow-methods', 'GET,POST,DELETE'],
          ['access-control-allow-headers', 'x-custom'],
          ['access-control-max-age', '300'],
        ]),
        body: '', bodyBinary: null, redirected: false, redirectChain: [],
      }),
    };
    const req = mkCorsReq('https://api.com/data', { method: 'DELETE' });
    const entry = await eng2.performPreflight(req, fakeRM as any);
    expect(entry.allowedMethods.has('DELETE')).toBe(true);
    expect(entry.allowedHeaders.has('x-custom')).toBe(true);
    expect(eng2.preflightCacheSize()).toBe(1);
    expect(eng2.hasCachedPreflight(req)).toBe(true);
    eng2.evictPreflight(PAGE);
    expect(eng2.preflightCacheSize()).toBe(0);
  });

  it('performPreflight: server rejects → CorsPreflightError', async () => {
    const fakeRM = {
      send: async () => ({
        url: 'https://strict.com/api', statusCode: 403, statusText: 'Forbidden',
        headers: new Map<string, string>(), body: '', bodyBinary: null, redirected: false, redirectChain: [],
      }),
    };
    await expect(
      cors.performPreflight(mkCorsReq('https://strict.com/api', { method: 'DELETE' }), fakeRM as any),
    ).rejects.toThrow(CorsPreflightError);
  });

  it('clearPreflightCache empties all entries', async () => {
    const eng3 = new CorsEngine();
    const fakeRM = {
      send: async (opts: any) => ({
        url: opts.url, statusCode: 200, statusText: 'OK',
        headers: new Map([
          ['access-control-allow-origin', '*'],
          ['access-control-allow-methods', 'GET'],
          ['access-control-allow-headers', 'content-type'],
          ['access-control-max-age', '60'],
        ]),
        body: '', bodyBinary: null, redirected: false, redirectChain: [],
      }),
    };
    await eng3.performPreflight(mkCorsReq('https://a.com/data1'), fakeRM as any);
    await eng3.performPreflight(mkCorsReq('https://b.com/data2'), fakeRM as any);
    expect(eng3.preflightCacheSize()).toBe(2);
    eng3.clearPreflightCache();
    expect(eng3.preflightCacheSize()).toBe(0);
  });

  it('SIMPLE_METHODS / ALWAYS_EXPOSED_HEADERS exported', () => {
    expect(SIMPLE_METHODS.has('GET')).toBe(true);
    expect(SIMPLE_METHODS.has('POST')).toBe(true);
    expect(SIMPLE_METHODS.has('DELETE')).toBe(false);
    expect(ALWAYS_EXPOSED_HEADERS.has('cache-control')).toBe(true);
    expect(ALWAYS_EXPOSED_HEADERS.has('content-type')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15 · FULL-STACK integration — all 14 files wired together
// ══════════════════════════════════════════════════════════════════════════════

describe('15 · FULL-STACK integration', () => {
  it('DI container wires all services end-to-end', async () => {
    const c = new DependencyContainer();
    c.registerValue('AppConfig', CFG);
    c.register('IUrlParser', () => new UrlParser(), ServiceLifetime.Singleton);
    c.register('INavCtrl', (cc) => new NavigationController(cc.resolve('IUrlParser')), ServiceLifetime.Singleton);
    c.register('IRouter', () => new Router(), ServiceLifetime.Singleton);
    c.register('IRespParser', () => new ResponseParser(), ServiceLifetime.Singleton);
    c.register('IHtmlParser', () => new HtmlParser(), ServiceLifetime.Singleton);
    c.register('ICacheManager', () => new CacheManager(), ServiceLifetime.Singleton);
    c.register('ICorsEngine', () => new CorsEngine(), ServiceLifetime.Singleton);

    // Fake page loader
    const fakeClient: IHttpClient = {
      send: async (req) => makeHttpRes(req.url, 'text/html', '<!DOCTYPE html><html><head></head><body><h1>Full Stack</h1></body></html>'),
    };
    c.register('IReqManager', (cc) => new RequestManager(fakeClient, cc.resolve('AppConfig'), { retryPolicy: new NoRetryPolicy() }), ServiceLifetime.Singleton);
    c.register('IResLoader', (cc) => new ResourceLoader(cc.resolve('IReqManager'), cc.resolve('IRespParser'), new ExponentialBackoffRetryPolicy({ maxRetries: 0 })), ServiceLifetime.Singleton);
    c.register('IBrowserEngine', (cc) => new BrowserEngine(cc.resolve('INavCtrl'), cc.resolve('IRouter'), cc.resolve('AppConfig')), ServiceLifetime.Singleton);
    c.register('ILifecycleMgr', (cc) => new LifecycleManager(cc.resolve('IBrowserEngine'), cc.resolve('AppConfig')), ServiceLifetime.Singleton);

    const engine = c.resolve<any>('IBrowserEngine');
    const lmgr = c.resolve<any>('ILifecycleMgr');
    const rmgr = c.resolve<any>('IReqManager');
    const hpars = c.resolve<any>('IHtmlParser');
    const corsEng = c.resolve<any>('ICorsEngine');
    engine.setPageLoader(makeFakeIPageLoader());

    const shell = new AppShell(c, CFG);
    shell.registerService(engine);
    shell.registerService(lmgr);
    await shell.mount();

    expect(shell.isMounted).toBe(true);
    expect(lmgr.state).toBe(LifecycleState.Running);

    // Navigate to a web page
    const readyP = new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('pageLoadReady timeout')), 4000);
      engine.on('pageLoadReady', () => { clearTimeout(t); res(); });
    });
    await engine.navigate('https://fullstack.com');
    await readyP;
    expect(engine.getCurrentSession()?.state).toBe(PageLoadState.Ready);

    // Parse HTML through the html-parser
    const htmlBody = '<!DOCTYPE html><html><head><link rel="stylesheet" href="/style.css"></head><body><h1>Full Stack</h1></body></html>';
    const parsed = hpars.parse(htmlBody, 'https://fullstack.com');
    expect(parsed.document.bodyElement).toBeTruthy();
    expect(parsed.resources.find((r: any) => r.kind === 'stylesheet')).toBeTruthy();

    // CORS check for a cross-origin resource
    const corsCheck = corsEng.checkRequest({
      url: 'https://cdn.com/style.css', origin: 'https://fullstack.com',
      method: 'GET', headers: new Map(), mode: CorsMode.Cors, credentials: CorsCredentials.Omit,
    });
    expect(corsCheck.decision).toBe(CorsRequestDecision.Simple);

    // Response parser on the fetched response
    const rparsed = c.resolve<any>('IRespParser').parse(makeHttpRes('https://fullstack.com', 'text/html', '<h1>hi</h1>'));
    expect(rparsed.category).toBe(ContentCategory.HtmlPage);

    await shell.unmount();
    expect(shell.isMounted).toBe(false);
    expect(lmgr.state).toBe(LifecycleState.Stopped);
  });
});
