/**
 * security-runtime-enforcement.test.ts
 * Integration tests for the runtime security wiring: live CSP header
 * ingestion via PageRenderer, CORS engine attachment to the JS engine
 * (fetch global), and secure-context gating of permission APIs.
 *
 * Run with: npx vitest run security-runtime-enforcement.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import type { IResourceLoader } from '../src/browser/networking/resource-loader';
import type { IDomTree } from '../src/browser/rendering/dom-tree';
import type { ICssParser } from '../src/browser/rendering/css-parser';
import type { ILayoutEngine } from '../src/browser/rendering/layout-engine';
import type { IPaintEngine } from '../src/browser/rendering/paint-engine';
import type { PageLoadResult } from '../src/browser/engine/browser-engine';
import { createCspEnforcement } from '../src/browser/security/csp-enforcement';
import { CorsEngine } from '../src/browser/security/cors';
import { createGlobalEnv, Interpreter, EventLoop, Lexer, Parser } from '../src/browser/js/index';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { isSecureContextUrl, isSecureContextOrigin } from '../src/browser/security/secure-context';
import {
  PermissionStore,
  PermissionGatedWebApis,
  type PermissionPrompt,
} from '../src/browser/web-apis/web-apis-permissions';

// ── Mock helpers (mirror tests/page-renderer.test.ts) ───────────────────────

function createMockHtmlParser() {
  return {
    parse: vi.fn().mockReturnValue({ document: { type: 'document', children: [] }, resources: [] }),
  };
}

function createMockDomTree(): IDomTree {
  return {
    buildFromHtml: vi.fn().mockReturnValue({ type: 'document', children: [] }),
    getNodeById: vi.fn(),
    getElementById: vi.fn(),
    getElementsByTagName: vi.fn().mockReturnValue([]),
    getElementsByClassName: vi.fn().mockReturnValue([]),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn().mockReturnValue([]),
    insertBefore: vi.fn(),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    setTextContent: vi.fn(),
    setComputedStyle: vi.fn(),
    setUsedStyle: vi.fn(),
    setLayoutBox: vi.fn(),
    getMutations: vi.fn().mockReturnValue([]),
    clearMutations: vi.fn(),
    processMutations: vi.fn(),
    markDirty: vi.fn(),
    markSubtreeDirty: vi.fn(),
    clearDirty: vi.fn(),
    clearSubtreeDirty: vi.fn(),
    getDocument: vi.fn().mockReturnValue({ type: 'document', children: [] }),
    getParentElement: vi.fn(),
    getOwnerDocument: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
  };
}

function createMockCssParser(): ICssParser {
  return {
    parseStylesheet: vi.fn().mockReturnValue({ rules: [], url: null }),
    parseInlineStyle: vi.fn().mockReturnValue(new Map()),
    extractStylesFromDocument: vi.fn().mockReturnValue([]),
    computeStyles: vi.fn().mockReturnValue(new Map()),
    computeStylesForElement: vi.fn().mockReturnValue(new Map()),
    getCss5Parser: vi.fn().mockReturnValue({ parseSelector: vi.fn().mockReturnValue(null) }),
    dispose: vi.fn(),
  } as ICssParser;
}

function createMockLayoutEngine(): ILayoutEngine {
  return {
    layout: vi.fn(),
    layoutIncremental: vi.fn().mockReturnValue(new Set()),
    getLayoutBox: vi.fn(),
    getElementAtPoint: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPaintEngine(): IPaintEngine {
  return {
    paint: vi.fn(),
    paintIncremental: vi.fn().mockReturnValue(new Set()),
    getLayers: vi.fn().mockReturnValue([]),
    getLayerById: vi.fn(),
    compositeFrame: vi.fn().mockReturnValue([]),
    rasterize: vi.fn(),
    rasterizeAsync: vi.fn().mockReturnValue(Promise.resolve({} as ImageData)),
    resize: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setOpacityResolver: vi.fn(),
    setTransformResolver: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockResourceLoader(): IResourceLoader {
  return {
    loadResource: vi.fn(),
    loadBatch: vi.fn(),
    loadStylesheet: vi.fn().mockResolvedValue(''),
    loadScript: vi.fn().mockResolvedValue(''),
    loadImage: vi.fn(),
    getPriority: vi.fn(),
    setMaxConcurrent: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPageLoadResult(overrides?: Partial<PageLoadResult>): PageLoadResult {
  return {
    url: 'https://example.com',
    statusCode: 200,
    contentType: 'text/html',
    body: '<html><body><h1>Hello</h1></body></html>',
    headers: new Map([['content-type', 'text/html']]),
    loadedAt: Date.now(),
    ...overrides,
  };
}

function buildRendererDeps(overrides?: Partial<PageRendererDependencies>): PageRendererDependencies {
  return {
    htmlParser: createMockHtmlParser() as any,
    domTree: createMockDomTree(),
    cssParser: createMockCssParser(),
    layoutEngine: createMockLayoutEngine(),
    paintEngine: createMockPaintEngine(),
    resourceLoader: createMockResourceLoader(),
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } as any,
    ...overrides,
  };
}

// ── JS execution helpers ─────────────────────────────────────────────────────

function makeDom() {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml({ type: 'document', children: [] } as never);
  return { domTree, doc };
}

function mockResponse(body: string, headers: Record<string, string> = {}) {
  const h = new Map(Object.entries(headers));
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: '',
    redirected: false,
    type: 'default' as ResponseType,
    headers: {
      forEach: (cb: (v: string, k: string) => void) => h.forEach((value, key) => cb(value, key.toLowerCase() === 'content-type' ? 'content-type' : key)),
      get: (name: string) => h.get(name.toLowerCase()) ?? null,
    },
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as globalThis.Response;
}

interface JsEnvOpts {
  pageOrigin?: string;
  platformFetch?: typeof globalThis.fetch;
  corsEngine?: CorsEngine;
}

function makeJsEnv(opts: JsEnvOpts = {}) {
  const { domTree, doc } = makeDom();
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(
    doc, domTree, eventLoop, undefined,
    opts.platformFetch, undefined, undefined, opts.pageOrigin,
    undefined, undefined, opts.corsEngine,
  );
  return {
    doc, domTree,
    interp: new Interpreter(env, eventLoop),
    env, eventLoop,
  };
}

async function runJs(source: string, opts: JsEnvOpts = {}) {
  const { interp, env, eventLoop } = makeJsEnv(opts);
  const program = new Parser([], new Lexer(source)).parse();
  interp.run(program);
  for (let i = 0; i < 20; i++) {
    await new Promise<void>(r => setTimeout(r, 0));
    eventLoop.drainMicrotasks();
    if (eventLoop.microtaskCount === 0 && i > 2) break;
  }
  return { env, eventLoop };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Live CSP header ingestion via PageRenderer
// ─────────────────────────────────────────────────────────────────────────────

describe('CSP live header ingestion (PageRenderer)', () => {
  it('stores Content-Security-Policy headers keyed by document origin', async () => {
    const csp = createCspEnforcement();
    const renderer = new PageRenderer(buildRendererDeps({
      scriptEnforcer: csp.scriptEnforcer,
      resourceEnforcer: csp.resourceEnforcer,
      policyStore: csp.policyStore,
    }));
    const result = createMockPageLoadResult({
      url: 'https://example.com/docs/intro.html',
      headers: new Map([
        ['content-type', 'text/html'],
        ['content-security-policy', "script-src 'none'; connect-src 'self'"],
      ]),
    });

    await renderer.render(result, new AbortController().signal);

    expect(csp.policyStore.hasPolicy('https://example.com')).toBe(true);
    expect(csp.policyStore.getEnforcePolicy('https://example.com')).not.toBeNull();
  });

  it('the ingested policy actually blocks inline scripts and cross-site fetches on that origin', async () => {
    const csp = createCspEnforcement();
    const renderer = new PageRenderer(buildRendererDeps({
      scriptEnforcer: csp.scriptEnforcer,
      resourceEnforcer: csp.resourceEnforcer,
      policyStore: csp.policyStore,
    }));
    const result = createMockPageLoadResult({
      url: 'https://example.com/app',
      headers: new Map([
        ['content-type', 'text/html'],
        ['content-security-policy', "script-src 'none'; connect-src 'self'"],
      ]),
    });

    await renderer.render(result, new AbortController().signal);

    const inline = csp.scriptEnforcer.checkInlineScript('alert(1)', 'https://example.com', 'https://example.com/app');
    expect(inline.allowed).toBe(false);

    const sameSite = csp.resourceEnforcer.checkFetch('https://example.com/api', 'https://example.com', 'https://example.com/app', 'GET');
    expect(sameSite.allowed).toBe(true);

    const cross = csp.resourceEnforcer.checkFetch('https://evil.example.com/api', 'https://example.com', 'https://example.com/app', 'GET');
    expect(cross.allowed).toBe(false);
  });

  it('a report-only header is not enforced (empty enforce policy, populated report-only policy)', async () => {
    const csp = createCspEnforcement();
    const renderer = new PageRenderer(buildRendererDeps({
      scriptEnforcer: csp.scriptEnforcer,
      resourceEnforcer: csp.resourceEnforcer,
      policyStore: csp.policyStore,
    }));
    const result = createMockPageLoadResult({
      headers: new Map([
        ['content-type', 'text/html'],
        ['content-security-policy-report-only', "script-src 'none'"],
      ]),
    });

    await renderer.render(result, new AbortController().signal);

    const enforce = csp.policyStore.getEnforcePolicy('https://example.com');
    const reportOnly = csp.policyStore.getReportOnlyPolicy('https://example.com');

    expect(reportOnly).not.toBeNull();
    expect(reportOnly?.directives.size ?? 0).toBeGreaterThan(0);
    // Empty enforce policy must not block any inline script.
    const inline = csp.scriptEnforcer.checkInlineScript('alert(1)', 'https://example.com', 'https://example.com/app');
    expect(inline.allowed).toBe(true);
  });

  it('tolerates opaque origins without throwing', async () => {
    const csp = createCspEnforcement();
    const renderer = new PageRenderer(buildRendererDeps({
      scriptEnforcer: csp.scriptEnforcer,
      resourceEnforcer: csp.resourceEnforcer,
      policyStore: csp.policyStore,
    }));
    const result = createMockPageLoadResult({
      url: 'about:blank',
      headers: new Map([
        ['content-type', 'text/html'],
        ['content-security-policy', "script-src 'none'"],
      ]),
    });

    await expect(renderer.render(result, new AbortController().signal)).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CORS engine attached to the JS engine (fetch global)
// ─────────────────────────────────────────────────────────────────────────────

describe('CORS engine attached to the JS engine', () => {
  it('cross-origin fetch without ACAO header resolves to an opaque response', async () => {
    const engine = new CorsEngine();
    const mockFetch = vi.fn().mockResolvedValue(mockResponse('{"ok":true}'));
    const pageOrigin = 'https://example.com';

    const { env } = await runJs(
      'var _out = ""; var _err = ""; fetch("https://api.example.com/data").then(function (r) { _out = r.type; }, function (e) { _err = e.message; })',
      { platformFetch: mockFetch as any, pageOrigin, corsEngine: engine },
    );

    expect(env.get('_err')).toBe('');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/data',
      expect.objectContaining({ headers: expect.objectContaining({ origin: pageOrigin }) }),
    );
    expect(env.get('_out')).toBe('opaque');
  });

  it('cross-origin fetch with matching ACAO header is exposed as default', async () => {
    const engine = new CorsEngine();
    const pageOrigin = 'https://example.com';
    const mockFetch = vi.fn().mockResolvedValue(
      mockResponse('{"ok":true}', { 'access-control-allow-origin': pageOrigin }),
    );

    const { env } = await runJs(
      'var _out = ""; var _err = ""; fetch("https://api.example.com/data").then(function (r) { _out = r.type; }, function (e) { _err = e.message; })',
      { platformFetch: mockFetch as any, pageOrigin, corsEngine: engine },
    );

    expect(env.get('_err')).toBe('');
    expect(env.get('_out')).toBe('default');
  });

  it('same-origin fetch is untouched by CORS', async () => {
    const engine = new CorsEngine();
    const pageOrigin = 'https://example.com';
    const mockFetch = vi.fn().mockResolvedValue(mockResponse('{"ok":true}'));

    const { env } = await runJs(
      'var _out = ""; var _err = ""; fetch("https://example.com/data").then(function (r) { _out = r.type; }, function (e) { _err = e.message; })',
      { platformFetch: mockFetch as any, pageOrigin, corsEngine: engine },
    );

    expect(env.get('_err')).toBe('');
    expect(env.get('_out')).toBe('default');
    expect(mockFetch).not.toHaveBeenCalledWith(
      'https://example.com/data',
      expect.objectContaining({ headers: expect.objectContaining({ origin: pageOrigin }) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Secure context gating
// ─────────────────────────────────────────────────────────────────────────────

describe('isSecureContextUrl', () => {
  it('treats https/wss as secure', () => {
    expect(isSecureContextUrl('https://example.com')).toBe(true);
    expect(isSecureContextUrl('wss://socket.example.com')).toBe(true);
  });

  it('treats http/ws as insecure', () => {
    expect(isSecureContextUrl('http://example.com')).toBe(false);
    expect(isSecureContextUrl('ws://socket.example.com')).toBe(false);
    expect(isSecureContextUrl('http://example.com/about')).toBe(false);
  });

  it('treats localhost and loopback as secure regardless of scheme', () => {
    expect(isSecureContextUrl('http://localhost:8080')).toBe(true);
    expect(isSecureContextUrl('http://localhost')).toBe(true);
    expect(isSecureContextUrl('http://127.0.0.1:3000')).toBe(true);
    expect(isSecureContextUrl('http://127.8.9.1')).toBe(true);
    expect(isSecureContextUrl('http://[::1]:5173')).toBe(true);
  });

  it('treats .localhost and custom secure schemes as secure', () => {
    expect(isSecureContextUrl('http://app.localhost')).toBe(true);
    expect(isSecureContextUrl('nova://app')).toBe(true);
    expect(isSecureContextUrl('file:///c:/page.html')).toBe(true);
  });
});

describe('isSecureContextOrigin', () => {
  it('parses origins from full URLs and bare origins', () => {
    expect(isSecureContextOrigin('https://example.com/path')).toBe(true);
    expect(isSecureContextOrigin('http://example.com')).toBe(false);
    expect(isSecureContextOrigin('http://localhost:5173')).toBe(true);
  });
});

describe('window.isSecureContext reflects page origin', () => {
  it('is true for a secure https page origin', async () => {
    const { env } = await runJs('var _secure = window.isSecureContext; var _envSecure = isSecureContext;', {
      pageOrigin: 'https://example.com',
    });
    expect(env.get('_secure')).toBe(true);
    expect(env.get('_envSecure')).toBe(true);
  });

  it('is false for an insecure http page origin', async () => {
    const { env } = await runJs('var _secure = window.isSecureContext;', {
      pageOrigin: 'http://example.com',
    });
    expect(env.get('_secure')).toBe(false);
  });

  it('is true for http localhost', async () => {
    const { env } = await runJs('var _secure = window.isSecureContext;', {
      pageOrigin: 'http://localhost:8080',
    });
    expect(env.get('_secure')).toBe(true);
  });
});

describe('PermissionStore secure-context predicate', () => {
  it('denies every request without prompting when the predicate reports insecure', async () => {
    const prompt = vi.fn<PermissionPrompt>().mockResolvedValue('granted');
    const store = new PermissionStore(prompt, () => false);

    expect(store.query('http://example.com', 'geolocation')).toBe('denied');
    await store.request('http://example.com', 'geolocation');
    await store.request('http://example.com', 'vibrate');
    expect(prompt).not.toHaveBeenCalled();
  });

  it('applies the predicate per permission name', async () => {
    const prompt = vi.fn<PermissionPrompt>().mockResolvedValue('granted');
    const store = new PermissionStore(prompt, (name) => name !== 'geolocation');

    expect(store.query('http://example.com', 'geolocation')).toBe('denied');
    expect(store.query('http://example.com', 'vibrate')).toBe('prompt');
    await store.request('http://example.com', 'vibrate');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('defaults to secure when no predicate is provided', () => {
    const store = new PermissionStore(async () => 'granted');
    expect(store.query('http://example.com', 'geolocation')).toBe('prompt');
  });
});

describe('PermissionGatedWebApis.isSecureContext=false', () => {
  function buildInsecureApis() {
    const promptUser: PermissionPrompt = vi.fn().mockResolvedValue('granted');
    const apis = new PermissionGatedWebApis({
      origin: 'http://example.com',
      promptUser,
      isSecureContext: false,
      positionSource: {
        getPosition: vi.fn().mockResolvedValue({ coords: { latitude: 0, longitude: 0 }, timestamp: Date.now() }),
        subscribe: vi.fn(),
      },
      clipboardBackend: { read: vi.fn().mockResolvedValue(''), write: vi.fn() },
      vibrationBackend: { vibrate: vi.fn(), cancel: vi.fn() },
    });
    return { promptUser, apis };
  }

  it('geolocation is denied without prompting', async () => {
    const { promptUser, apis } = buildInsecureApis();

    await apis.permissions.request('http://example.com', 'geolocation');
    expect(promptUser).not.toHaveBeenCalled();
    expect(apis.permissions.query('http://example.com', 'geolocation')).toBe('denied');
  });

  it('geolocation API reports PERMISSION_DENIED via onError', async () => {
    const { apis } = buildInsecureApis();
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await apis.geolocation.getCurrentPosition(onSuccess, onError);

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('notifications and clipboard are denied on insecure contexts too', async () => {
    const { apis } = buildInsecureApis();

    expect(apis.permissions.query('http://example.com', 'notifications')).toBe('denied');
    expect(apis.permissions.query('http://example.com', 'clipboard-read')).toBe('denied');
    expect(apis.permissions.query('http://example.com', 'clipboard-write')).toBe('denied');
  });

  it('non-powerful permissions (vibrate) still prompt on insecure contexts', async () => {
    const { promptUser, apis } = buildInsecureApis();

    expect(apis.permissions.query('http://example.com', 'vibrate')).toBe('prompt');
    await apis.permissions.request('http://example.com', 'vibrate');
    expect(promptUser).toHaveBeenCalledTimes(1);
  });
});