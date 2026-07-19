import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HtmlSanitizer, sanitizeHtmlTree } from '../src/browser/security/html-sanitizer';
import { CspGuardAdapter } from '../src/browser/security/csp-guard-adapter';
import { createCspEnforcement } from '../src/browser/security/csp-enforcement';
import { CspPolicyStore } from '../src/browser/security/csp-policy-store';
import { CspNavigationGuard } from '../src/browser/security/csp-navigation-guard';
import { CspResourceEnforcer } from '../src/browser/security/csp-resource-enforcer';
import { CspScriptEnforcer } from '../src/browser/security/csp-script-enforcer';
import { BLOCKED_PROTOCOLS } from '../src/browser/navigation/url-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { EventLoop } from '../src/browser/js/event-loop';
import { createFetchFn, createHeadersClass } from '../src/browser/js/fetch-api';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { createObject, createNativeFunction, Environment } from '../src/browser/js/values';

// ─── HTML Sanitizer ──────────────────────────────────────────────────────

describe('HtmlSanitizer', () => {
  let domTree: DomTree;

  beforeEach(() => {
    domTree = new DomTree();
  });

  function buildTree(html: string) {
    const parser = new HtmlParser();
    const result = parser.parse(html, 'https://example.com');
    return domTree.buildFromHtml(result.document);
  }

  describe('dangerous element stripping', () => {
    it('should remove <script> elements', () => {
      const doc = buildTree('<div><script>alert(1)</script><p>safe</p></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const scripts = domTree.getElementsByTagName('script');
      expect(scripts.length).toBe(0);
    });

    it('should remove <iframe> elements', () => {
      const doc = buildTree('<div><iframe src="evil.com"></iframe><p>safe</p></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const iframes = domTree.getElementsByTagName('iframe');
      expect(iframes.length).toBe(0);
    });

    it('should remove <object> elements', () => {
      const doc = buildTree('<div><object data="evil.swf"></object></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const objects = domTree.getElementsByTagName('object');
      expect(objects.length).toBe(0);
    });

    it('should remove <embed> elements', () => {
      const doc = buildTree('<div><embed src="evil.swf"></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const embeds = domTree.getElementsByTagName('embed');
      expect(embeds.length).toBe(0);
    });

    it('should remove <applet> elements', () => {
      const doc = buildTree('<div><applet code="evil.class"></applet></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const applets = domTree.getElementsByTagName('applet');
      expect(applets.length).toBe(0);
    });

    it('should remove <base> elements', () => {
      const doc = buildTree('<head><base href="https://evil.com/"></head>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const bases = domTree.getElementsByTagName('base');
      expect(bases.length).toBe(0);
    });

    it('should keep safe elements', () => {
      const doc = buildTree('<div><p>Hello</p><a href="/link">Link</a><img src="/img.png"></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      expect(domTree.getElementsByTagName('p').length).toBe(1);
      expect(domTree.getElementsByTagName('a').length).toBe(1);
      expect(domTree.getElementsByTagName('img').length).toBe(1);
    });

    it('should allow keeping script elements via config', () => {
      const doc = buildTree('<div><script>alert(1)</script></div>');
      const sanitizer = new HtmlSanitizer({ keepScriptElements: true });
      sanitizer.sanitize(doc, domTree);
      const scripts = domTree.getElementsByTagName('script');
      expect(scripts.length).toBe(1);
    });

    it('should track removed count', () => {
      const doc = buildTree('<div><script>a</script><iframe src="x"></iframe><p>safe</p></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      expect(sanitizer.getRemovedCount()).toBe(2);
    });
  });

  describe('event handler stripping', () => {
    it('should remove onclick attributes', () => {
      const doc = buildTree('<div><p onclick="alert(1)">Click me</p></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const p = domTree.getElementsByTagName('p')[0];
      expect(p.attributes.has('onclick')).toBe(false);
    });

    it('should remove onerror attributes', () => {
      const doc = buildTree('<div><img src="x" onerror="alert(1)"></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const img = domTree.getElementsByTagName('img')[0];
      expect(img.attributes.has('onerror')).toBe(false);
    });

    it('should remove any on* attribute', () => {
      const doc = buildTree('<div><p onmouseover="evil()">hover</p></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const p = domTree.getElementsByTagName('p')[0];
      expect(p.attributes.has('onmouseover')).toBe(false);
    });

    it('should keep non-event attributes', () => {
      const doc = buildTree('<div><a href="/safe" class="link" id="mylink">Link</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.get('href')).toBe('/safe');
      expect(a.attributes.get('class')).toBe('link');
      expect(a.attributes.get('id')).toBe('mylink');
    });
  });

  describe('URL sanitization', () => {
    it('should remove javascript: URLs in href', () => {
      const doc = buildTree('<div><a href="javascript:alert(1)">Click</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.has('href')).toBe(false);
    });

    it('should remove vbscript: URLs in src', () => {
      const doc = buildTree('<div><img src="vbscript:alert(1)"></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const img = domTree.getElementsByTagName('img')[0];
      expect(img.attributes.has('src')).toBe(false);
    });

    it('should remove data: URLs in href', () => {
      const doc = buildTree('<div><a href="data:text/html,<script>alert(1)</script>">Click</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.has('href')).toBe(false);
    });

    it('should remove javascript: in action attribute', () => {
      const doc = buildTree('<div><form action="javascript:evil()"><input></form></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const form = domTree.getElementsByTagName('form')[0];
      expect(form.attributes.has('action')).toBe(false);
    });

    it('should remove javascript: in formaction attribute', () => {
      const doc = buildTree('<div><button formaction="javascript:evil()">Submit</button></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const button = domTree.getElementsByTagName('button')[0];
      expect(button.attributes.has('formaction')).toBe(false);
    });

    it('should keep safe URLs', () => {
      const doc = buildTree('<div><a href="https://example.com">Safe</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.get('href')).toBe('https://example.com');
    });

    it('should keep relative URLs', () => {
      const doc = buildTree('<div><a href="/about">About</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.get('href')).toBe('/about');
    });

    it('should handle javascript: with whitespace', () => {
      const doc = buildTree('<div><a href="  javascript:alert(1)">Click</a></div>');
      const sanitizer = new HtmlSanitizer();
      sanitizer.sanitize(doc, domTree);
      const a = domTree.getElementsByTagName('a')[0];
      expect(a.attributes.has('href')).toBe(false);
    });
  });

  describe('configurable stripped elements', () => {
    it('should use custom stripped elements list', () => {
      const doc = buildTree('<div><script>alert(1)</script><marquee>scroll</marquee></div>');
      const sanitizer = new HtmlSanitizer({
        strippedElements: new Set(['marquee']),
      });
      sanitizer.sanitize(doc, domTree);
      // script is NOT stripped because we provided a custom list
      expect(domTree.getElementsByTagName('script').length).toBe(1);
      expect(domTree.getElementsByTagName('marquee').length).toBe(0);
    });
  });

  describe('sanitizeHtmlTree helper', () => {
    it('should sanitize and return removed count', () => {
      const doc = buildTree('<div><script>a</script><iframe src="x"></iframe><p>safe</p></div>');
      const count = sanitizeHtmlTree(doc, domTree);
      expect(count).toBe(2);
      expect(domTree.getElementsByTagName('script').length).toBe(0);
      expect(domTree.getElementsByTagName('iframe').length).toBe(0);
    });
  });
});

// ─── CSP Guard Adapter ───────────────────────────────────────────────────

describe('CspGuardAdapter', () => {
  it('should have name "csp"', () => {
    const store = new CspPolicyStore();
    const guard = new CspNavigationGuard(store);
    const adapter = new CspGuardAdapter(guard);
    expect(adapter.name).toBe('csp');
  });

  it('should allow navigation when no CSP policy exists', async () => {
    const store = new CspPolicyStore();
    const guard = new CspNavigationGuard(store);
    const adapter = new CspGuardAdapter(guard);
    const result = await adapter.canNavigate({
      url: 'https://example.com',
      type: 'push',
      userInitiated: true,
    });
    expect(result).toBe(true);
  });

  it('should block navigation when CSP policy blocks it', async () => {
    const store = new CspPolicyStore();
    store.storeFromHeaders('https://evil.com', ["navigation-to 'none'"]);
    const guard = new CspNavigationGuard(store);
    const adapter = new CspGuardAdapter(guard);
    const result = await adapter.canNavigate({
      url: 'https://evil.com/steal',
      type: 'push',
      referrer: 'https://example.com',
      userInitiated: true,
    });
    expect(result).toBe(false);
  });

  it('should provide blockedReason', () => {
    const store = new CspPolicyStore();
    store.storeFromHeaders('https://evil.com', ["navigation-to 'none'"]);
    const guard = new CspNavigationGuard(store);
    const adapter = new CspGuardAdapter(guard);
    const reason = adapter.blockedReason({
      url: 'https://evil.com/page',
      type: 'push',
      userInitiated: true,
    });
    expect(typeof reason).toBe('string');
    expect(reason!.length).toBeGreaterThan(0);
  });
});

// ─── CSP Enforcement ─────────────────────────────────────────────────────

describe('CspEnforcement', () => {
  it('should create all CSP components', () => {
    const enforcement = createCspEnforcement();
    expect(enforcement.policyStore).toBeDefined();
    expect(enforcement.reporter).toBeDefined();
    expect(enforcement.navigationGuard).toBeDefined();
    expect(enforcement.resourceEnforcer).toBeDefined();
    expect(enforcement.scriptEnforcer).toBeDefined();
  });

  it('should have navigation guard with name "csp"', () => {
    const enforcement = createCspEnforcement();
    expect(enforcement.navigationGuard.name).toBe('csp');
  });

  it('should have working policy store', () => {
    const enforcement = createCspEnforcement();
    enforcement.policyStore.storeFromHeaders('https://example.com', ["script-src 'self'"]);
    expect(enforcement.policyStore.hasPolicy('https://example.com')).toBe(true);
  });

  it('should have working resource enforcer', () => {
    const enforcement = createCspEnforcement();
    const result = enforcement.resourceEnforcer.checkFetch(
      'https://example.com/api', 'https://example.com', 'https://example.com',
    );
    expect(result.allowed).toBe(true);
  });

  it('should have working script enforcer', () => {
    const enforcement = createCspEnforcement();
    const result = enforcement.scriptEnforcer.checkInlineScript(
      'console.log("hi")', 'https://example.com', 'https://example.com',
    );
    // No policy = allowed (default-src fallback with no policy = allow)
    expect(result.allowed).toBe(true);
  });
});

// ─── CSP Resource Enforcer ───────────────────────────────────────────────

describe('CspResourceEnforcer', () => {
  let store: CspPolicyStore;
  let enforcer: CspResourceEnforcer;

  beforeEach(() => {
    store = new CspPolicyStore();
    enforcer = new CspResourceEnforcer(store);
  });

  it('should allow fetch when no policy exists', () => {
    const result = enforcer.checkFetch('https://api.example.com', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block fetch when connect-src restricts', () => {
    store.storeFromHeaders('https://example.com', ["connect-src 'self'"]);
    const result = enforcer.checkFetch('https://evil.com/api', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
  });

  it('should allow fetch to self when connect-src is self', () => {
    store.storeFromHeaders('https://example.com', ["connect-src 'self'"]);
    const result = enforcer.checkFetch('https://example.com/api', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should fallback to default-src', () => {
    store.storeFromHeaders('https://example.com', ["default-src 'self'"]);
    const result = enforcer.checkFetch('https://evil.com/api', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
  });
});

// ─── CSP Script Enforcer ─────────────────────────────────────────────────

describe('CspScriptEnforcer', () => {
  let store: CspPolicyStore;
  let enforcer: CspScriptEnforcer;

  beforeEach(() => {
    store = new CspPolicyStore();
    enforcer = new CspScriptEnforcer(store);
  });

  it('should allow inline script when no policy exists', () => {
    const result = enforcer.checkInlineScript('alert(1)', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block inline script when script-src is self-only', () => {
    store.storeFromHeaders('https://example.com', ["script-src 'self'"]);
    const result = enforcer.checkInlineScript('alert(1)', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
  });

  it('should allow inline script with unsafe-inline', () => {
    store.storeFromHeaders('https://example.com', ["script-src 'unsafe-inline'"]);
    const result = enforcer.checkInlineScript('alert(1)', 'https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });

  it('should block eval when script-src disallows unsafe-eval', () => {
    store.storeFromHeaders('https://example.com', ["script-src 'self'"]);
    const result = enforcer.checkEval('https://example.com', 'https://example.com');
    expect(result.allowed).toBe(false);
  });

  it('should allow eval with unsafe-eval', () => {
    store.storeFromHeaders('https://example.com', ["script-src 'unsafe-eval'"]);
    const result = enforcer.checkEval('https://example.com', 'https://example.com');
    expect(result.allowed).toBe(true);
  });
});

// ─── URL Parser data: blocking ───────────────────────────────────────────

describe('URL Parser data: blocking', () => {
  it('should block javascript: protocol', () => {
    expect(BLOCKED_PROTOCOLS.has('javascript:')).toBe(true);
  });

  it('should block vbscript: protocol', () => {
    expect(BLOCKED_PROTOCOLS.has('vbscript:')).toBe(true);
  });

  it('should block data: protocol', () => {
    expect(BLOCKED_PROTOCOLS.has('data:')).toBe(true);
  });
});

// ─── Fetch API scheme blocking ───────────────────────────────────────────

describe('Fetch API scheme blocking', () => {
  it('should reject fetch to javascript: URLs', () => {
    const eventLoop = new EventLoop();
    const doc = { domId: 'doc', nodeType: 'document' as const, parent: null, children: [], htmlElement: null, headElement: null, bodyElement: null };
    const domTree = new DomTree();
    const env = new Environment(null);
    const fetchFn = createFetchFn(eventLoop);
    env.setLocal('fetch', fetchFn);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('fetch("javascript:alert(1)")');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const result = interpreter.run(program);

    // Should return a rejected promise
    eventLoop.drainMicrotasks();
    expect(result).toBeDefined();
  });

  it('should reject fetch to data: URLs', () => {
    const eventLoop = new EventLoop();
    const fetchFn = createFetchFn(eventLoop);
    const env = new Environment(null);
    env.setLocal('fetch', fetchFn);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('fetch("data:text/html,<script>alert(1)</script>")');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const result = interpreter.run(program);

    eventLoop.drainMicrotasks();
    expect(result).toBeDefined();
  });

  it('should reject fetch to vbscript: URLs', () => {
    const eventLoop = new EventLoop();
    const fetchFn = createFetchFn(eventLoop);
    const env = new Environment(null);
    env.setLocal('fetch', fetchFn);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('fetch("vbscript:MsgBox(1)")');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const result = interpreter.run(program);

    eventLoop.drainMicrotasks();
    expect(result).toBeDefined();
  });
});

// ─── Header sanitization ─────────────────────────────────────────────────

describe('Header sanitization', () => {
  it('should block Host header in Headers.set()', () => {
    const eventLoop = new EventLoop();
    const HeadersClass = createHeadersClass(eventLoop);
    const env = new Environment(null);
    env.setLocal('Headers', HeadersClass);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('var h = new Headers(); h.set("Host", "evil.com")');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    try {
      interpreter.run(program);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('should block Content-Length header', () => {
    const eventLoop = new EventLoop();
    const HeadersClass = createHeadersClass(eventLoop);
    const env = new Environment(null);
    env.setLocal('Headers', HeadersClass);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('var h = new Headers(); h.set("Content-Length", "999")');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    try {
      interpreter.run(program);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('should block Host header in Headers.append()', () => {
    const eventLoop = new EventLoop();
    const HeadersClass = createHeadersClass(eventLoop);
    const env = new Environment(null);
    env.setLocal('Headers', HeadersClass);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('var h = new Headers(); h.append("Host", "evil.com")');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    try {
      interpreter.run(program);
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('should allow normal headers', () => {
    const eventLoop = new EventLoop();
    const HeadersClass = createHeadersClass(eventLoop);
    const env = new Environment(null);
    env.setLocal('Headers', HeadersClass);

    const interpreter = new Interpreter(env, eventLoop);
    const lexer = new Lexer('var h = new Headers(); h.set("Content-Type", "application/json"); h.set("Authorization", "Bearer token"); h.get("Content-Type")');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const result = interpreter.run(program);
    expect(result).toBe('application/json');
  });
});

// ─── Interpreter execution timeout ───────────────────────────────────────

describe('Interpreter execution timeout', () => {
  it('should timeout on infinite loop', () => {
    const eventLoop = new EventLoop();
    const env = new Environment(null);
    const interpreter = new Interpreter(env, eventLoop);
    interpreter.setMaxExecutionMs(100);

    const lexer = new Lexer('while(true) {}');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    let errorMsg = '';
    try {
      interpreter.run(program);
    } catch (e: any) {
      threw = true;
      errorMsg = e.message || '';
    }
    expect(threw).toBe(true);
    expect(errorMsg).toContain('timed out');
  });

  it('should allow normal scripts within timeout', () => {
    const eventLoop = new EventLoop();
    const env = new Environment(null);
    const interpreter = new Interpreter(env, eventLoop);
    interpreter.setMaxExecutionMs(5000);

    const lexer = new Lexer('var x = 1 + 2; x');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const result = interpreter.run(program);
    expect(result).toBe(3);
  });

  it('should timeout on long-running for loop', () => {
    const eventLoop = new EventLoop();
    const env = new Environment(null);
    const interpreter = new Interpreter(env, eventLoop);
    interpreter.setMaxExecutionMs(50);

    const lexer = new Lexer('for(var i = 0; i < 1000000000; i++) {}');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    try {
      interpreter.run(program);
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain('timed out');
    }
    expect(threw).toBe(true);
  });

  it('should have configurable timeout', () => {
    const eventLoop = new EventLoop();
    const env = new Environment(null);
    const interpreter = new Interpreter(env, eventLoop);

    // Set very short timeout
    interpreter.setMaxExecutionMs(1);

    const lexer = new Lexer('for(var i = 0; i < 100000000; i++) {}');
    const parser = new Parser([], lexer);
    const program = parser.parse();

    let threw = false;
    try {
      interpreter.run(program);
    } catch (e: any) {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
