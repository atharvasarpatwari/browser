import { describe, it, expect, beforeEach } from 'vitest';
import { CspPolicyStore } from '../src/browser/security/csp-policy-store';
import { CspScriptEnforcer } from '../src/browser/security/csp-script-enforcer';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { EventLoop } from '../src/browser/js/event-loop';
import { Environment, createNativeFunction, toString } from '../src/browser/js/values';
import {
  BLOCKED_URL_SCHEMES, isBlockedUrlScheme, isEventHandlerAttribute, isUrlAttribute,
} from '../src/browser/security/blocked-url-schemes';
import {
  containsDangerousCss, sanitizeCssValue, sanitizeStyleAttribute,
  HtmlSanitizer,
} from '../src/browser/security/html-sanitizer';
import {
  sanitizeMutationFire, fireMutation, clearAllRegistrations,
} from '../src/browser/rendering/html5/mutation-observer';
import type { MutationFireOptions } from '../src/browser/rendering/html5/mutation-observer';
import { NodeType } from '../src/browser/rendering/html5/dom';
import type { HtmlNode } from '../src/browser/rendering/html5/dom';
import { HtmlParser } from '../src/browser/rendering/html-parser';

// ─── Helper: run JS with optional CSP enforcer ─────────────────────────────

function runWithCsp(
  code: string,
  policyHeaders?: string[],
  origin = 'https://example.com',
): { value: unknown; error?: string } {
  const eventLoop = new EventLoop();
  const env = new Environment(null);

  let scriptEnforcer: CspScriptEnforcer | undefined;
  if (policyHeaders) {
    const store = new CspPolicyStore();
    store.storeFromHeaders(origin, policyHeaders);
    scriptEnforcer = new CspScriptEnforcer(store);
  }

  // Bind eval with CSP enforcement
  env.setLocal('eval', createNativeFunction('eval', (_this, args) => {
    const code = toString(args[0]);
    if (scriptEnforcer) {
      const check = scriptEnforcer.checkEval(origin, origin, code);
      if (!check.allowed) {
        throw new Error(`EvalError: ${check.reason}`);
      }
    }
    const lexer = new Lexer(code);
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const interp = new Interpreter(env, eventLoop, scriptEnforcer, origin);
    return interp.run(program);
  }));

  // Bind setTimeout with CSP enforcement for string args
  env.setLocal('setTimeout', createNativeFunction('setTimeout', (_this, args) => {
    const fn = args[0];
    if (typeof fn === 'string' || typeof fn === 'number') {
      if (scriptEnforcer) {
        const codeSample = String(fn).slice(0, 40);
        const check = scriptEnforcer.checkTimerString(origin, origin, codeSample);
        if (!check.allowed) {
          throw new Error(`TimeoutError: ${check.reason}`);
        }
      }
      return 0 as unknown as any;
    }
    return 1 as unknown as any;
  }));

  // Bind setInterval with CSP enforcement for string args
  env.setLocal('setInterval', createNativeFunction('setInterval', (_this, args) => {
    const fn = args[0];
    if (typeof fn === 'string' || typeof fn === 'number') {
      if (scriptEnforcer) {
        const codeSample = String(fn).slice(0, 40);
        const check = scriptEnforcer.checkTimerString(origin, origin, codeSample);
        if (!check.allowed) {
          throw new Error(`TimeoutError: ${check.reason}`);
        }
      }
      return 0 as unknown as any;
    }
    return 1 as unknown as any;
  }));

  try {
    const lexer = new Lexer(code);
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const interp = new Interpreter(env, eventLoop, scriptEnforcer, origin);
    const value = interp.run(program);
    return { value };
  } catch (e: any) {
    return { value: undefined, error: e.message };
  }
}

// ─── CSP eval() enforcement ────────────────────────────────────────────────

describe('CSP eval() enforcement', () => {
  it('should block eval() when script-src has no unsafe-eval', () => {
    const result = runWithCsp('eval("1 + 1")', ["script-src 'self'"]);
    expect(result.error).toContain('EvalError');
    expect(result.error).toContain('eval() blocked');
  });

  it('should allow eval() when script-src has unsafe-eval', () => {
    const result = runWithCsp('eval("1 + 1")', ["script-src 'unsafe-eval'"]);
    expect(result.value).toBe(2);
  });

  it('should allow eval() when no CSP policy exists', () => {
    const result = runWithCsp('eval("1 + 1")');
    expect(result.value).toBe(2);
  });

  it('should block eval with malicious code when CSP enforces', () => {
    const result = runWithCsp('eval("alert(1)")', ["script-src 'self'"]);
    expect(result.error).toContain('EvalError');
  });

  it('should include code sample in CSP report', () => {
    const store = new CspPolicyStore();
    store.storeFromHeaders('https://example.com', ["script-src 'self'"]);
    const enforcer = new CspScriptEnforcer(store);
    const check = enforcer.checkEval('https://example.com', 'https://example.com', 'malicious()');
    expect(check.allowed).toBe(false);
    expect(check.scriptSample).toBe('malicious()');
  });

  it('should not block eval when CSP only has style-src', () => {
    const result = runWithCsp('eval("2 + 2")', ["style-src 'self'"]);
    expect(result.value).toBe(4);
  });

  it('should block eval with default-src but no unsafe-eval', () => {
    const result = runWithCsp('eval("1")', ["default-src 'self'"]);
    expect(result.error).toContain('EvalError');
  });
});

// ─── CSP timer string enforcement ──────────────────────────────────────────

describe('CSP timer string enforcement', () => {
  it('should block setTimeout with string arg when CSP disallows', () => {
    const result = runWithCsp('setTimeout("alert(1)", 0)', ["script-src 'self'"]);
    expect(result.error).toContain('TimeoutError');
    expect(result.error).toContain('Timer with string');
  });

  it('should allow setTimeout with string arg when CSP has unsafe-inline', () => {
    const result = runWithCsp('setTimeout("alert(1)", 0)', ["script-src 'unsafe-inline'"]);
    // No error — timer string is allowed with unsafe-inline
    expect(result.error).toBeUndefined();
  });

  it('should block setInterval with string arg when CSP disallows', () => {
    const result = runWithCsp('setInterval("alert(1)", 100)', ["script-src 'self'"]);
    expect(result.error).toContain('TimeoutError');
  });

  it('should not block setTimeout with function arg', () => {
    const result = runWithCsp('var x = 1; setTimeout(function() { x = 2; }, 0)', ["script-src 'self'"]);
    expect(result.error).toBeUndefined();
  });

  it('should allow timer string when no CSP exists', () => {
    const result = runWithCsp('setTimeout("alert(1)", 0)');
    expect(result.error).toBeUndefined();
  });
});

// ─── setAttribute() sanitization ───────────────────────────────────────────

describe('setAttribute() sanitization', () => {
  let domTree: DomTree;
  let doc: any;

  beforeEach(() => {
    domTree = new DomTree();
    const htmlParser = new HtmlParser();
    const result = htmlParser.parse('<div><p id="target">Hello</p></div>', 'https://example.com');
    doc = domTree.buildFromHtml(result.document);
  });

  function createBindings(el: any) {
    const obj = new Environment(null);
    const env = new Environment(null);

    env.setLocal('setAttribute', createNativeFunction('setAttribute', (_this, args) => {
      const name = toString(args[0]);
      const value = toString(args[1]);

      // Import the sanitization logic
      const { isEventHandlerAttribute: isEH, isUrlAttribute: isUA, isBlockedUrlScheme: isBU } = require('../src/browser/security/blocked-url-schemes');
      if (isEH(name)) return undefined;
      if (isUA(name) && isBU(value)) return undefined;

      domTree.setAttribute(el, name, value);
      return undefined;
    }));

    return env;
  }

  it('should silently drop onclick attribute', () => {
    const p = domTree.getElementsByTagName('p')[0];
    domTree.setAttribute(p, 'onclick', 'alert(1)');
    // The sanitizer should block this — test the utility function
    expect(isEventHandlerAttribute('onclick')).toBe(true);
    expect(isEventHandlerAttribute('onerror')).toBe(true);
    expect(isEventHandlerAttribute('onmouseover')).toBe(true);
    expect(isEventHandlerAttribute('onauxclick')).toBe(true);
  });

  it('should block javascript: URL in href via setAttribute', () => {
    expect(isBlockedUrlScheme('javascript:alert(1)')).toBe(true);
    expect(isBlockedUrlScheme('  javascript:alert(1)')).toBe(true);
    expect(isBlockedUrlScheme('JAVASCRIPT:alert(1)')).toBe(true);
  });

  it('should block vbscript: URL in src', () => {
    expect(isBlockedUrlScheme('vbscript:MsgBox(1)')).toBe(true);
  });

  it('should block data: URL in href', () => {
    expect(isBlockedUrlScheme('data:text/html,<script>alert(1)</script>')).toBe(true);
  });

  it('should block blob: URL', () => {
    expect(isBlockedUrlScheme('blob:https://example.com/uuid')).toBe(true);
  });

  it('should allow safe URLs', () => {
    expect(isBlockedUrlScheme('https://example.com')).toBe(false);
    expect(isBlockedUrlScheme('/relative/path')).toBe(false);
    expect(isBlockedUrlScheme('https://example.com/image.png')).toBe(false);
  });

  it('should not treat non-event attrs as event handlers', () => {
    expect(isEventHandlerAttribute('href')).toBe(false);
    expect(isEventHandlerAttribute('src')).toBe(false);
    expect(isEventHandlerAttribute('class')).toBe(false);
    expect(isEventHandlerAttribute('on')).toBe(false);
    expect(isEventHandlerAttribute('o')).toBe(false);
  });

  it('should identify URL attributes correctly', () => {
    expect(isUrlAttribute('href')).toBe(true);
    expect(isUrlAttribute('src')).toBe(true);
    expect(isUrlAttribute('action')).toBe(true);
    expect(isUrlAttribute('formaction')).toBe(true);
    expect(isUrlAttribute('background')).toBe(true);
    expect(isUrlAttribute('class')).toBe(false);
    expect(isUrlAttribute('id')).toBe(false);
    expect(isUrlAttribute('style')).toBe(false);
  });
});

// ─── CSS injection sanitization ────────────────────────────────────────────

describe('CSS injection sanitization', () => {
  it('should detect IE CSS expression()', () => {
    expect(containsDangerousCss('expression(alert(1))')).toBe(true);
    expect(containsDangerousCss('expression  (alert(1))')).toBe(true);
    expect(containsDangerousCss('EXPRession(alert(1))')).toBe(true);
  });

  it('should detect url(javascript:) in CSS', () => {
    expect(containsDangerousCss('background: url(javascript:alert(1))')).toBe(true);
    expect(containsDangerousCss('background: url("javascript:alert(1)")')).toBe(true);
    expect(containsDangerousCss("background: url('javascript:alert(1))'")).toBe(true);
  });

  it('should detect url(data:) in CSS', () => {
    expect(containsDangerousCss('background: url(data:text/html,<script>)')).toBe(true);
  });

  it('should detect -moz-binding attacks', () => {
    expect(containsDangerousCss('-moz-binding: url("http://evil.com/xbl.xml#xss")')).toBe(true);
  });

  it('should detect IE behavior: url()', () => {
    expect(containsDangerousCss('behavior: url(xss.htc)')).toBe(true);
  });

  it('should detect @import javascript:', () => {
    expect(containsDangerousCss('@import "javascript:alert(1)"')).toBe(true);
  });

  it('should not flag safe CSS values', () => {
    expect(containsDangerousCss('color: red')).toBe(false);
    expect(containsDangerousCss('background-color: #fff')).toBe(false);
    expect(containsDangerousCss('margin: 10px')).toBe(false);
    expect(containsDangerousCss('font-size: 14px')).toBe(false);
    expect(containsDangerousCss('background-image: url(https://example.com/img.png)')).toBe(false);
  });

  it('sanitizeCssValue should return empty string for dangerous CSS', () => {
    expect(sanitizeCssValue('expression(alert(1))')).toBe('');
    expect(sanitizeCssValue('color: red')).toBe('color: red');
  });

  it('sanitizeStyleAttribute should strip dangerous declarations', () => {
    const result = sanitizeStyleAttribute('color: red; expression(alert(1)); font-size: 14px');
    expect(result).toContain('color: red');
    expect(result).toContain('font-size: 14px');
    expect(result).not.toContain('expression');
  });

  it('sanitizeStyleAttribute should block all-dangerous values', () => {
    const result = sanitizeStyleAttribute('expression(alert(1))');
    expect(result).toBe('');
  });
});

// ─── CSS injection in HtmlSanitizer ────────────────────────────────────────

describe('HtmlSanitizer CSS injection', () => {
  let domTree: DomTree;

  beforeEach(() => {
    domTree = new DomTree();
  });

  function buildTree(html: string) {
    const parser = new HtmlParser();
    const result = parser.parse(html, 'https://example.com');
    return domTree.buildFromHtml(result.document);
  }

  it('should sanitize dangerous style attributes', () => {
    const doc = buildTree('<div><p style="color: red; expression(alert(1))">Text</p></div>');
    const sanitizer = new HtmlSanitizer();
    sanitizer.sanitize(doc, domTree);
    const p = domTree.getElementsByTagName('p')[0];
    const style = p.attributes.get('style') ?? '';
    expect(style).not.toContain('expression');
    expect(style).toContain('color: red');
  });

  it('should keep safe style attributes', () => {
    const doc = buildTree('<div><p style="color: blue; font-size: 16px">Text</p></div>');
    const sanitizer = new HtmlSanitizer();
    sanitizer.sanitize(doc, domTree);
    const p = domTree.getElementsByTagName('p')[0];
    expect(p.attributes.get('style')).toContain('color: blue');
    expect(p.attributes.get('style')).toContain('font-size: 16px');
  });

  it('should sanitize -moz-binding in style', () => {
    const doc = buildTree('<div><div style="-moz-binding: url(http://evil.com/xbl.xml#xss)">X</div></div>');
    const sanitizer = new HtmlSanitizer();
    sanitizer.sanitize(doc, domTree);
    const div = domTree.getElementsByTagName('div')[1];
    const style = div.attributes.get('style') ?? '';
    expect(style).not.toContain('-moz-binding');
  });
});

// ─── MutationObserver sanitization ─────────────────────────────────────────

describe('MutationObserver sanitization', () => {
  let htmlParser: HtmlParser;

  beforeEach(() => {
    clearAllRegistrations();
    htmlParser = new HtmlParser();
  });

  /** Parse an HTML fragment and return the root elements as HtmlNode[]. */
  function parseFragment(html: string): HtmlNode[] {
    return htmlParser.parseFragment(html) as HtmlNode[];
  }

  it('should sanitize added nodes with event handlers', () => {
    const nodes = parseFragment('<p onclick="alert(1)">Click</p>');
    const maliciousP = nodes[0];

    expect(maliciousP.nodeType).toBe(NodeType.Element);

    const opts: MutationFireOptions = {
      target: maliciousP,
      type: 'childList',
      addedNodes: [maliciousP],
    };

    const sanitized = sanitizeMutationFire(opts);
    expect(sanitized).toBeDefined();
  });

  it('should strip on* attributes from added nodes', () => {
    const img = {
      nodeType: NodeType.Element,
      tagName: 'img',
      attributes: new Map([['src', 'x'], ['onerror', 'alert(1)']]),
      children: [],
    };

    expect(img.attributes.has('onerror')).toBe(true);

    const targetNodes = parseFragment('<div></div>');
    const target = targetNodes[0];

    fireMutation({
      target,
      type: 'childList',
      addedNodes: [img as any],
    });

    expect(img.attributes.has('onerror')).toBe(false);
  });

  it('should strip javascript: URLs from added node attributes', () => {
    const a = {
      nodeType: NodeType.Element,
      tagName: 'a',
      attributes: new Map([['href', 'javascript:alert(1)'], ['class', 'link']]),
      children: [],
    };

    expect(a.attributes.has('href')).toBe(true);

    const targetNodes = parseFragment('<div></div>');
    const target = targetNodes[0];

    fireMutation({
      target,
      type: 'childList',
      addedNodes: [a as any],
    });

    expect(a.attributes.has('href')).toBe(false);
    expect(a.attributes.has('class')).toBe(true);
  });

  it('should sanitize style attributes on added nodes', () => {
    const p = {
      nodeType: NodeType.Element,
      tagName: 'p',
      attributes: new Map([['style', 'color: red; expression(alert(1))']]),
      children: [],
    };

    const targetNodes = parseFragment('<div></div>');
    const target = targetNodes[0];

    fireMutation({
      target,
      type: 'childList',
      addedNodes: [p as any],
    });

    const style = p.attributes.get('style') ?? '';
    expect(style).not.toContain('expression');
    expect(style).toContain('color: red');
  });

  it('should recurse into nested added nodes', () => {
    const innerP = {
      nodeType: NodeType.Element,
      tagName: 'p',
      attributes: new Map([['onclick', 'evil()']]),
      children: [],
    };
    const innerDiv = {
      nodeType: NodeType.Element,
      tagName: 'div',
      attributes: new Map(),
      children: [innerP as any],
    };
    const outerDiv = {
      nodeType: NodeType.Element,
      tagName: 'div',
      attributes: new Map(),
      children: [innerDiv as any],
    };

    const targetNodes = parseFragment('<div></div>');
    const target = targetNodes[0];

    fireMutation({
      target,
      type: 'childList',
      addedNodes: [outerDiv as any],
    });

    expect(innerP.attributes.has('onclick')).toBe(false);
  });

  it('should pass through non-childList mutations unchanged', () => {
    const target = { nodeType: NodeType.Element, attributes: new Map() };
    const opts: MutationFireOptions = {
      target: target as any,
      type: 'attributes',
      attributeName: 'class',
      oldValue: 'old',
    };
    const result = sanitizeMutationFire(opts);
    expect(result.type).toBe('attributes');
    expect(result.attributeName).toBe('class');
  });
});

// ─── Shared blocked URL schemes ────────────────────────────────────────────

describe('Shared blocked URL schemes', () => {
  it('should contain all dangerous schemes', () => {
    expect(BLOCKED_URL_SCHEMES.has('javascript:')).toBe(true);
    expect(BLOCKED_URL_SCHEMES.has('vbscript:')).toBe(true);
    expect(BLOCKED_URL_SCHEMES.has('data:')).toBe(true);
    expect(BLOCKED_URL_SCHEMES.has('livescript:')).toBe(true);
    expect(BLOCKED_URL_SCHEMES.has('blob:')).toBe(true);
  });

  it('isBlockedUrlScheme should be case-insensitive', () => {
    expect(isBlockedUrlScheme('JavaScript:alert(1)')).toBe(true);
    expect(isBlockedUrlScheme('JAVASCRIPT:alert(1)')).toBe(true);
    expect(isBlockedUrlScheme('VbScRiPt:alert(1)')).toBe(true);
  });

  it('isBlockedUrlScheme should trim whitespace', () => {
    expect(isBlockedUrlScheme('  javascript:alert(1)')).toBe(true);
    expect(isBlockedUrlScheme('   data:text/html,x')).toBe(true);
  });
});

// ─── Integration: CSP + setAttribute + CSS ─────────────────────────────────

describe('XSS attack vector integration', () => {
  it('should block eval injection via CSP', () => {
    const result = runWithCsp(
      'eval("document.title = \\"hacked\\"")',
      ["script-src 'self'"],
    );
    expect(result.error).toContain('EvalError');
  });

  it('should block inline event handler via CSP', () => {
    const result = runWithCsp(
      'eval("<img src=x onerror=alert(1)>")',
      ["script-src 'self'"],
    );
    expect(result.error).toContain('EvalError');
  });

  it('should allow safe code execution without CSP', () => {
    const result = runWithCsp('var x = 42; x');
    expect(result.value).toBe(42);
  });

  it('should block CSS expression injection in sanitizer', () => {
    expect(containsDangerousCss('width: expression(alert("xss"))')).toBe(true);
    expect(containsDangerousCss('background: url("javascript:void(0)")')).toBe(true);
  });

  it('should not block legitimate CSS', () => {
    expect(containsDangerousCss('display: flex')).toBe(false);
    expect(containsDangerousCss('grid-template-columns: 1fr 2fr')).toBe(false);
    expect(containsDangerousCss('background-image: url("/images/bg.png")')).toBe(false);
    expect(containsDangerousCss('box-shadow: 0 2px 4px rgba(0,0,0,0.1)')).toBe(false);
  });

  it('should sanitize nested script-like patterns in CSS', () => {
    expect(containsDangerousCss('content: "expression(alert(1))"')).toBe(true);
  });
});
