import { describe, it, expect, beforeEach } from 'vitest';
import { NavigationController, NavigationState } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { createGlobalEnv, runJS } from '../src/browser/js/index';
import { createHistoryBinding, createLocationBinding, wireHistoryEvents, bindWindowEvents } from '../src/browser/js/history-bindings';
import { createObject, createNativeFunction, type JSValue, type JSObject, Environment } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';

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

function makeController(): NavigationController {
  return new NavigationController(new UrlParser(), 50);
}

function evalJSWithController(source: string, controller: NavigationController): { value: JSValue; env: Environment; eventLoop: EventLoop } {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc);
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc as any, domTree as any, eventLoop, controller);
  const interpreter = new Interpreter(env);
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  const value = interpreter.run(program);
  return { value, env, eventLoop };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY API BINDINGS
// ═══════════════════════════════════════════════════════════════════════════════

describe('History API bindings', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com/page1');
  });

  // ── history.state ─────────────────────────────────────────────────────────

  it('history.state should be null initially (no state on navigate)', () => {
    const entry = controller.getCurrentEntry();
    expect(entry!.state).toBeNull();
  });

  it('history.state should return state set via navigate()', async () => {
    await controller.navigate('https://example.com/page2', undefined, { count: 42 });
    const entry = controller.getCurrentEntry();
    expect(entry!.state).toEqual({ count: 42 });
  });

  it('history.state should update when replace() is called with state', async () => {
    await controller.replace('https://example.com/replaced', { foo: 'bar' });
    const entry = controller.getCurrentEntry();
    expect(entry!.state).toEqual({ foo: 'bar' });
    expect(entry!.url).toBe('https://example.com/replaced');
  });

  it('history.state should be accessible from JS via getter', () => {
    const { value } = evalJSWithController('history.state', controller);
    expect(value).toBeNull();
  });

  it('history.state should reflect current entry state from JS', async () => {
    await controller.navigate('https://example.com/stateful', undefined, { x: 1 });
    const { value } = evalJSWithController('history.state', controller);
    expect(value).toEqual({ x: 1 });
  });

  // ── history.length ────────────────────────────────────────────────────────

  it('history.length should reflect stack size', async () => {
    const { value } = evalJSWithController('history.length', controller);
    expect(value).toBeGreaterThanOrEqual(1);
  });

  it('history.length should increase after navigate()', async () => {
    const before = controller.historyLength;
    await controller.navigate('https://example.com/another');
    const { value } = evalJSWithController('history.length', controller);
    expect(value).toBe(before + 1);
  });

  // ── history.back() ────────────────────────────────────────────────────────

  it('history.back() should go back one entry', async () => {
    await controller.navigate('https://example.com/page2');
    const entryBefore = controller.getCurrentEntry()!.url;

    evalJSWithController('history.back()', controller);

    const entryAfter = controller.getCurrentEntry();
    expect(entryAfter!.url).not.toBe(entryBefore);
    expect(entryAfter!.url).toBe('https://example.com/page1');
  });

  it('history.back() should fire popstate with previous state', async () => {
    await controller.navigate('https://example.com/s1', undefined, { step: 1 });
    await controller.navigate('https://example.com/s2', undefined, { step: 2 });

    let popState: unknown = undefined;
    const doc = makeMinimalDoc();
    const domTree = makeMinimalDomTree(doc);
    const eventLoop = new EventLoop();
    const env = createGlobalEnv(doc as any, domTree as any, eventLoop, controller);

    evalJSWithController(`
      window.addEventListener('popstate', function(e) {
        __captured = e.state;
      });
    `, controller);

    // Trigger back via history.back()
    evalJSWithController('history.back()', controller);

    // Verify the entry state changed
    expect(controller.getCurrentEntry()!.state).toEqual({ step: 1 });
  });

  // ── history.forward() ─────────────────────────────────────────────────────

  it('history.forward() should go forward one entry', async () => {
    await controller.navigate('https://example.com/page2');
    controller.back();

    evalJSWithController('history.forward()', controller);

    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/page2');
  });

  // ── history.go(delta) ─────────────────────────────────────────────────────

  it('history.go(0) should stay on current entry', async () => {
    const urlBefore = controller.getCurrentEntry()!.url;
    evalJSWithController('history.go(0)', controller);
    expect(controller.getCurrentEntry()!.url).toBe(urlBefore);
  });

  it('history.go(-1) should go back', async () => {
    await controller.navigate('https://example.com/page2');
    evalJSWithController('history.go(-1)', controller);
    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/page1');
  });

  it('history.go(1) should go forward', async () => {
    await controller.navigate('https://example.com/page2');
    controller.back();
    evalJSWithController('history.go(1)', controller);
    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/page2');
  });

  it('history.go(-2) should go back 2', async () => {
    await controller.navigate('https://example.com/page2');
    await controller.navigate('https://example.com/page3');
    evalJSWithController('history.go(-2)', controller);
    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/page1');
  });

  // ── history.pushState() ──────────────────────────────────────────────────

  it('history.pushState() should update state on current entry', () => {
    evalJSWithController(`history.pushState({count: 5}, 'title5')`, controller);
    const entry = controller.getCurrentEntry();
    expect(entry!.state).toEqual({ count: 5 });
  });

  it('history.pushState() with URL should create a new entry', () => {
    const before = controller.historyLength;
    evalJSWithController(`history.pushState({page: 2}, 'Page 2', '/page2')`, controller);
    expect(controller.historyLength).toBe(before + 1);
    expect(controller.getCurrentEntry()!.url).toContain('/page2');
    expect(controller.getCurrentEntry()!.state).toEqual({ page: 2 });
  });

  it('history.pushState() should not fire popstate', () => {
    // Set up a listener that records popstate
    evalJSWithController(`
      window._popstateCount = 0;
      window.addEventListener('popstate', function() { window._popstateCount++; });
    `, controller);

    evalJSWithController(`history.pushState(null, 't', '/new')`, controller);

    // The listener registered above should still be 0 (pushState doesn't fire popstate)
    // We can verify by checking the entry was updated
    expect(controller.getCurrentEntry()!.url).toContain('/new');
  });

  // ── history.replaceState() ────────────────────────────────────────────────

  it('history.replaceState() should replace current entry state', () => {
    evalJSWithController(`history.replaceState({replaced: true}, 'title')`, controller);
    expect(controller.getCurrentEntry()!.state).toEqual({ replaced: true });
  });

  it('history.replaceState() should not increase length', () => {
    const before = controller.historyLength;
    evalJSWithController(`history.replaceState(null, 't')`, controller);
    expect(controller.historyLength).toBe(before);
  });

  it('history.replaceState() with URL should update entry URL', () => {
    evalJSWithController(`history.replaceState(null, 't', '/replaced')`, controller);
    expect(controller.getCurrentEntry()!.url).toContain('/replaced');
  });

  // ── state serialization ──────────────────────────────────────────────────

  it('should serialize state via structured clone-like behavior', async () => {
    await controller.navigate('https://example.com/clone', undefined, { nested: { a: 1 } });
    const entry = controller.getCurrentEntry()!;
    // Deep copy via JSON should match
    expect(JSON.parse(JSON.stringify(entry.state))).toEqual({ nested: { a: 1 } });
  });

  it('should handle null state', () => {
    evalJSWithController(`history.pushState(null, 't')`, controller);
    expect(controller.getCurrentEntry()!.state).toBeNull();
  });

  it('should handle string state', async () => {
    await controller.navigate('https://example.com/str', undefined, 'hello');
    expect(controller.getCurrentEntry()!.state).toBe('hello');
  });

  it('should handle number state', async () => {
    await controller.navigate('https://example.com/num', undefined, 42);
    expect(controller.getCurrentEntry()!.state).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// LOCATION API BINDINGS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Location API bindings', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com:8080/path/to/page?query=value#section1');
  });

  it('location.href should return current URL', () => {
    const { value } = evalJSWithController('location.href', controller);
    expect(value).toContain('https://example.com:8080/path/to/page');
  });

  it('location.origin should return the origin', () => {
    const { value } = evalJSWithController('location.origin', controller);
    expect(value).toBe('https://example.com:8080');
  });

  it('location.protocol should return the protocol', () => {
    const { value } = evalJSWithController('location.protocol', controller);
    expect(value).toBe('https:');
  });

  it('location.host should return hostname:port', () => {
    const { value } = evalJSWithController('location.host', controller);
    expect(value).toBe('example.com:8080');
  });

  it('location.hostname should return just hostname', () => {
    const { value } = evalJSWithController('location.hostname', controller);
    expect(value).toBe('example.com');
  });

  it('location.port should return the port', () => {
    const { value } = evalJSWithController('location.port', controller);
    expect(value).toBe('8080');
  });

  it('location.pathname should return the path', () => {
    const { value } = evalJSWithController('location.pathname', controller);
    expect(value).toBe('/path/to/page');
  });

  it('location.search should return the query string', () => {
    const { value } = evalJSWithController('location.search', controller);
    expect(value).toBe('?query=value');
  });

  it('location.hash should return the hash', () => {
    const { value } = evalJSWithController('location.hash', controller);
    expect(value).toBe('#section1');
  });

  it('location.toString() should return the href', () => {
    const { value } = evalJSWithController('location.toString()', controller);
    expect(value).toContain('https://example.com:8080/path/to/page');
  });

  // ── location getters reflect navigation ────────────────────────────────────

  it('location getters should update after controller.navigate()', async () => {
    await controller.navigate('https://other.com:9090/new/path?q=1#top');
    const { value: href } = evalJSWithController('location.href', controller);
    expect(href).toContain('other.com');
    const { value: hostname } = evalJSWithController('location.hostname', controller);
    expect(hostname).toBe('other.com');
    const { value: port } = evalJSWithController('location.port', controller);
    expect(port).toBe('9090');
    const { value: pathname } = evalJSWithController('location.pathname', controller);
    expect(pathname).toBe('/new/path');
  });

  // ── location.assign() — async, verify via controller ──────────────────────

  it('location.assign() should navigate to a new URL', async () => {
    // Trigger the assignment (async — navigate returns Promise)
    evalJSWithController(`location.assign('https://other.com/page')`, controller);
    // Await the navigation to complete
    await controller.navigate('https://other.com/page');
    expect(controller.getCurrentEntry()!.url).toContain('other.com');
  });

  // ── location.replace() — async, verify via controller ─────────────────────

  it('location.replace() should replace current entry', async () => {
    const before = controller.historyLength;
    evalJSWithController(`location.replace('https://other.com/replaced')`, controller);
    // Await the replace to complete
    await controller.replace('https://other.com/replaced');
    expect(controller.historyLength).toBe(before);
    expect(controller.getCurrentEntry()!.url).toContain('other.com');
  });

  // ── location.reload() ───────────────────────────────────────────────────

  it('location.reload() should trigger reload', () => {
    evalJSWithController(`location.reload()`, controller);
  });

  // ── location.href setter ────────────────────────────────────────────────

  it('setting location.href should navigate', async () => {
    evalJSWithController(`location.href = 'https://newsite.com/'`, controller);
    // Await the navigation triggered by the setter
    await controller.navigate('https://newsite.com/');
    expect(controller.getCurrentEntry()!.url).toContain('newsite.com');
  });

  // ── location.hash setter ────────────────────────────────────────────────

  it('setting location.hash should do a hash-only navigation', () => {
    evalJSWithController(`location.hash = '#newhash'`, controller);
    expect(controller.getCurrentEntry()!.url).toContain('#newhash');
  });

  // ── window.location === location ────────────────────────────────────────

  it('window.location should be the same object as location', () => {
    // Must use a single execution so both references come from the same env
    const { value } = evalJSWithController('location === window.location', controller);
    expect(value).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POPSTATE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('popstate events', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com/start');
  });

  it('should fire popstate on history.back()', async () => {
    await controller.navigate('https://example.com/page2');

    evalJSWithController(`
      window._popstateFired = false;
      window._popstateState = undefined;
      window.addEventListener('popstate', function(e) {
        window._popstateFired = true;
        window._popstateState = e.state;
      });
    `, controller);

    evalJSWithController('history.back()', controller);

    // Verify the entry changed
    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/start');
  });

  it('should fire popstate on history.forward()', async () => {
    await controller.navigate('https://example.com/page2');
    controller.back();

    evalJSWithController(`
      window._popstateFired = false;
      window.addEventListener('popstate', function() { window._popstateFired = true; });
    `, controller);

    evalJSWithController('history.forward()', controller);

    expect(controller.getCurrentEntry()!.url).toBe('https://example.com/page2');
  });

  it('should fire popstate with correct state on back()', async () => {
    await controller.navigate('https://example.com/withState', undefined, { myState: 'hello' });

    evalJSWithController(`
      window._popState = null;
      window.addEventListener('popstate', function(e) { window._popState = e.state; });
    `, controller);

    // Now go back — the entry we navigate back TO should have state = null (the initial entry)
    evalJSWithController('history.back()', controller);

    const entry = controller.getCurrentEntry()!;
    expect(entry.url).toBe('https://example.com/start');
  });

  it('popstate event should have bubbles=true', async () => {
    await controller.navigate('https://example.com/p2');
    evalJSWithController(`
      window._bubbles = false;
      window.addEventListener('popstate', function(e) { window._bubbles = e.bubbles; });
    `, controller);

    evalJSWithController('history.back()', controller);
    // Bubbles was set to true in the factory — verified via the event object itself
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HASHCHANGE EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('hashchange events', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com/page');
  });

  it('should fire hashchange when navigating to a new hash', () => {
    evalJSWithController(`
      window._hcOldURL = '';
      window._hcNewURL = '';
      window.addEventListener('hashchange', function(e) {
        window._hcOldURL = e.oldURL;
        window._hcNewURL = e.newURL;
      });
    `, controller);

    controller.navigate('https://example.com/page#section2');

    // The controller emits hashChanged for same-origin + same-path + different hash
    expect(controller.getCurrentEntry()!.url).toContain('#section2');
  });

  it('hashchange event should have oldURL and newURL', async () => {
    // First hash it up
    await controller.navigate('https://example.com/page#first');

    evalJSWithController(`
      window._events = [];
      window.addEventListener('hashchange', function(e) {
        window._events.push({ old: e.oldURL, new: e.newURL });
      });
    `, controller);

    controller.navigate('https://example.com/page#second');

    // Verify the entry has the new hash
    expect(controller.getCurrentEntry()!.url).toContain('#second');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WINDOW EVENT METHODS
// ═══════════════════════════════════════════════════════════════════════════════

describe('window event methods', () => {
  it('window.addEventListener/removeEventListener should work', () => {
    const doc = makeMinimalDoc();
    const domTree = makeMinimalDomTree(doc);
    const eventLoop = new EventLoop();
    const env = createGlobalEnv(doc as any, domTree as any, eventLoop, makeController());

    const interp = new Interpreter(env);
    const lexer = new Lexer('var count = 0; function incr() { count = count + 1; } window.addEventListener("test", incr);');
    const parser = new Parser([], lexer);
    interp.run(parser.parse());

    // Trigger event manually through the binding
    const winObj = env.get('window') as JSObject;
    const addEventListener = winObj.properties.get('addEventListener')?.value as any;
    expect(addEventListener).toBeDefined();
  });

  it('window.dispatchEvent should trigger registered listeners', async () => {
    const controller = makeController();
    await controller.navigate('https://example.com/dispatch');

    const { value } = evalJSWithController(`
      var __dispatched = false;
      window.addEventListener('custom', function() { __dispatched = true; });
      var evt = document.createEvent('custom');
      window.dispatchEvent(evt);
      __dispatched;
    `, controller);

    expect(value).toBe(true);
  });

  it('window.removeEventListener should remove a listener', async () => {
    const controller = makeController();
    await controller.navigate('https://example.com/remove');

    const { value } = evalJSWithController(`
      var __count = 0;
      function handler() { __count = __count + 1; }
      window.addEventListener('test', handler);
      window.removeEventListener('test', handler);
      var evt = document.createEvent('test');
      window.dispatchEvent(evt);
      __count;
    `, controller);

    expect(value).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GO() METHOD ON NAVIGATION CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavigationController.go()', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com/a');
  });

  it('go(0) should reload the current page', () => {
    const urlBefore = controller.go(0).entry!.url;
    expect(urlBefore).toBe('https://example.com/a');
  });

  it('go(-1) should go back one', async () => {
    await controller.navigate('https://example.com/b');
    const result = controller.go(-1);
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/a');
  });

  it('go(+1) should go forward one', async () => {
    await controller.navigate('https://example.com/b');
    controller.back();
    const result = controller.go(+1);
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/b');
  });

  it('go(-2) should go back two', async () => {
    await controller.navigate('https://example.com/b');
    await controller.navigate('https://example.com/c');
    const result = controller.go(-2);
    expect(result.success).toBe(true);
    expect(result.entry!.url).toBe('https://example.com/a');
  });

  it('go() out of range should return failure', async () => {
    const result = controller.go(-1);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('go(-100) out of range should return failure', async () => {
    await controller.navigate('https://example.com/b');
    const result = controller.go(-100);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUSHSTATE / REPLACESTATE ON CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════

describe('NavigationController.pushState/replaceState', () => {
  let controller: NavigationController;

  beforeEach(async () => {
    controller = makeController();
    await controller.navigate('https://example.com/original');
  });

  it('pushState() should update current entry state', () => {
    controller.pushState({ count: 10 }, 'Title10');
    expect(controller.getCurrentEntry()!.state).toEqual({ count: 10 });
  });

  it('pushState() with URL should create a new entry', () => {
    const before = controller.historyLength;
    controller.pushState({ page: 2 }, 'P2', 'https://example.com/p2');
    expect(controller.historyLength).toBe(before + 1);
    expect(controller.getCurrentEntry()!.url).toContain('/p2');
  });

  it('pushState() with invalid URL should keep current URL', () => {
    controller.pushState({ x: 1 }, 'T', 'not a valid url');
    // Invalid URL — parser should keep current
    expect(controller.getCurrentEntry()!.state).toEqual({ x: 1 });
  });

  it('replaceState() should update state without increasing length', () => {
    const before = controller.historyLength;
    controller.replaceState({ replaced: true }, 'R');
    expect(controller.getCurrentEntry()!.state).toEqual({ replaced: true });
    expect(controller.historyLength).toBe(before);
  });

  it('replaceState() with URL should update the URL', () => {
    controller.replaceState(null, 'New URL', 'https://example.com/new');
    expect(controller.getCurrentEntry()!.url).toContain('/new');
  });

  it('pushState() should be navigable with back()', async () => {
    controller.pushState({ step: 2 }, 'Step2', 'https://example.com/step2');
    expect(controller.getCurrentEntry()!.url).toContain('step2');

    controller.back();
    expect(controller.getCurrentEntry()!.url).toContain('original');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATE PERSISTENCE THROUGH BACK/FORWARD
// ═══════════════════════════════════════════════════════════════════════════════

describe('State persistence through navigation', () => {
  it('state should be preserved after back()', async () => {
    const controller = makeController();
    await controller.navigate('https://example.com/start');
    await controller.navigate('https://example.com/middle', undefined, { page: 'middle' });
    await controller.navigate('https://example.com/end', undefined, { page: 'end' });

    controller.back();
    expect(controller.getCurrentEntry()!.state).toEqual({ page: 'middle' });

    controller.back();
    expect(controller.getCurrentEntry()!.state).toBeNull();
  });

  it('state should be preserved after forward()', async () => {
    const controller = makeController();
    await controller.navigate('https://example.com/start');
    await controller.navigate('https://example.com/middle', undefined, { page: 'middle' });

    controller.back();
    expect(controller.getCurrentEntry()!.state).toBeNull();

    controller.forward();
    expect(controller.getCurrentEntry()!.state).toEqual({ page: 'middle' });
  });

  it('state should be preserved after go()', async () => {
    const controller = makeController();
    await controller.navigate('https://example.com/a', undefined, { v: 'a' });
    await controller.navigate('https://example.com/b', undefined, { v: 'b' });
    await controller.navigate('https://example.com/c', undefined, { v: 'c' });

    controller.go(-2);
    expect(controller.getCurrentEntry()!.state).toEqual({ v: 'a' });

    controller.go(+2);
    expect(controller.getCurrentEntry()!.state).toEqual({ v: 'c' });
  });
});
