import { describe, it, expect, beforeEach } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Environment, type JSValue } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { DomTree, type DomElement, type DomNode } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DamageTracker } from '../src/browser/rendering/damage-tracker';
import { FrameScheduler } from '../src/browser/rendering/frame-scheduler';
import { ReflowRepaintController } from '../src/browser/rendering/reflow-repaint-controller';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { LazyLoader } from '../src/browser/rendering/lazy-loader';
import { IntersectionObserver } from '../src/browser/rendering/intersection-observer';
import { clearAllRegistrations as clearMutationObservers } from '../src/browser/rendering/html5/mutation-observer';
import { ThirdPartySecurityManager } from '../src/browser/security/third-party-security';
import { PermissionManager } from '../src/browser/security/permission-manager';
import { InMemoryHistoryStore } from '../src/browser/storage/history-store';

function buildDom(html: string): { doc: ReturnType<DomTree['buildFromHtml']>; tree: DomTree } {
  const tree = new DomTree();
  const parser = new HtmlParser();
  const result = parser.parse(html);
  const doc = tree.buildFromHtml(result.document);
  return { doc, tree };
}

function runJS(source: string): { interp: Interpreter; value: JSValue } {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const value = interp.run(program);
  return { interp, value };
}

function findElement(root: DomNode, predicate: (n: DomNode) => boolean): DomNode | null {
  if (predicate(root)) return root;
  if ('children' in root) {
    for (const child of (root as DomElement).children) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERPRETER TIMER LEAK TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('Interpreter Timer Management', () => {
  it('should return increasing IDs from setTimeout', () => {
    const { interp } = runJS('');
    const env = interp['globalEnv'] as Environment;

    const id1 = evalJSWithEnv(interp, 'var fn = function(){}; setTimeout(fn, 100);');
    const id2 = evalJSWithEnv(interp, 'setTimeout(fn, 200);');
    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it('should actually cancel timer via clearTimeout', () => {
    const { interp } = runJS('');
    const env = interp['globalEnv'] as Environment;

    const id = evalJSWithEnv(interp, 'setTimeout(function(){}, 100);');
    evalJSWithEnv(interp, 'clearTimeout(' + id + ');');
    expect(interp.getTaskQueue().length).toBe(0);
  });

  it('should actually cancel interval via clearInterval', () => {
    const { interp } = runJS('');

    const id = evalJSWithEnv(interp, 'setInterval(function(){}, 10);');
    expect(interp.getTaskQueue().length).toBe(1);
    evalJSWithEnv(interp, 'clearInterval(' + id + ');');
    expect(interp.getTaskQueue().length).toBe(0);
  });

  it('should not grow task queue when timers are cleared', () => {
    const { interp } = runJS('');
    for (let i = 0; i < 10; i++) {
      const id = evalJSWithEnv(interp, 'setTimeout(function(){}, 1000);');
      evalJSWithEnv(interp, 'clearTimeout(' + id + ');');
    }
    expect(interp.getTaskQueue().length).toBe(0);
  });

  it('getTaskQueue should return current timer list', () => {
    const { interp } = runJS('');
    const queue = interp.getTaskQueue();
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.length).toBe(0);
  });

  it('clearOutput should clear all output', () => {
    const { interp } = runJS('');
    (interp as any).output = ['a', 'b', 'c'];
    interp.clearOutput();
    expect(interp.getOutput()).toEqual([]);
  });
});

function evalJSWithEnv(interp: Interpreter, source: string): JSValue {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  return interp.run(program);
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LOOP DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('EventLoop', () => {
  it('dispose should clear all pending tasks', () => {
    const loop = new EventLoop();
    loop.schedule(() => {}, 1000);
    loop.schedule(() => {}, 2000);
    loop.schedule(() => {}, 3000);
    expect(loop.pendingCount).toBe(3);
    loop.dispose();
    expect(loop.pendingCount).toBe(0);
  });

  it('dispose should clear RAF callbacks', () => {
    const loop = new EventLoop();
    loop.requestAnimationFrame(() => {});
    loop.requestAnimationFrame(() => {});
    loop.dispose();
    expect(loop.pendingCount).toBe(0);
  });

  it('clearTimer should remove specific timer', () => {
    const loop = new EventLoop();
    const id1 = loop.schedule(() => {}, 1000);
    const id2 = loop.schedule(() => {}, 2000);
    loop.clearTimer(id1);
    expect(loop.pendingCount).toBe(1);
    loop.clearTimer(id2);
    expect(loop.pendingCount).toBe(0);
  });

  it('dispose should set running to false', () => {
    const loop = new EventLoop();
    (loop as any).running = true;
    loop.dispose();
    expect(loop.running_).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPAINT CONTROLLER DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('ReflowRepaintController', () => {
  it('dispose should cancel pending frames', () => {
    const layoutEngine = new LayoutEngine();
    const paintEngine = new PaintEngine();
    const domTree = new DomTree();
    const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    ctrl.init({ children: [], htmlElement: null, bodyElement: null, headElement: null } as any);
    ctrl.dispose();
    expect(ctrl.isScheduled()).toBe(false);
  });

  it('dispose should prevent further frame requests', () => {
    const layoutEngine = new LayoutEngine();
    const paintEngine = new PaintEngine();
    const domTree = new DomTree();
    const ctrl = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    ctrl.dispose();
    ctrl.requestFrame();
    expect(ctrl.isScheduled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE TRACKER DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('DamageTracker', () => {
  it('dispose should clear all regions', () => {
    const dt = new DamageTracker();
    dt.addRect(0, 0, 100, 100);
    dt.addRect(200, 200, 50, 50);
    expect(dt.isEmpty()).toBe(false);
    dt.dispose();
    expect(dt.isEmpty()).toBe(true);
  });

  it('dispose should make count zero', () => {
    const dt = new DamageTracker();
    dt.addRect(0, 0, 10, 10);
    dt.addRect(5, 5, 10, 10);
    dt.dispose();
    expect(dt.count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRAME SCHEDULER DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('FrameScheduler', () => {
  it('dispose should cancel pending frame', () => {
    const fs = new FrameScheduler();
    fs.schedule(() => {});
    expect(fs.isScheduled()).toBe(true);
    fs.dispose();
    expect(fs.isScheduled()).toBe(false);
  });

  it('dispose is idempotent', () => {
    const fs = new FrameScheduler();
    fs.dispose();
    fs.dispose();
    expect(fs.isScheduled()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DOM TREE ID INDEX LEAK TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('DomTree idIndex cleanup', () => {
  it('removeChild should clean idIndex for elements with id', () => {
    const { doc, tree } = buildDom('<p id="test-p">Hello</p>');
    const body = doc.bodyElement!;
    const p = body.children[0] as DomElement;

    expect(tree.getElementById('test-p')).toBe(p);

    tree.removeChild(body, p);
    expect(tree.getElementById('test-p')).toBeNull();
  });

  it('removeChild should not affect idIndex for elements without id', () => {
    const { doc, tree } = buildDom('<p id="keep">Keep</p><div>No id</div>');
    const body = doc.bodyElement!;
    const div = tree.getElementsByTagName('div')[0] as DomElement;
    const p = tree.getElementById('keep')!;

    expect(p).toBeTruthy();
    expect(div).toBeTruthy();
    expect(div.attributes.has('id')).toBe(false);
    tree.removeChild(body, div);
    expect(tree.getElementById('keep')).toBe(p);
  });

  it('removeChild should not delete idIndex if different element has same id', () => {
    const { doc, tree } = buildDom('<p id="dup">First</p><p id="dup">Second</p>');
    const body = doc.bodyElement!;
    const first = body.children[0] as DomElement;
    const second = body.children[1] as DomElement;

    expect(tree.getElementById('dup')).toBeDefined();

    tree.removeChild(body, first);
    expect(tree.getElementById('dup')).toBe(second);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAZY LOADER DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('LazyLoader', () => {
  it('dispose should null domTree and document references', () => {
    const loader = new LazyLoader();
    const { doc, tree } = buildDom('<img loading="lazy" src="test.jpg">');
    loader.init(doc, tree);

    expect((loader as any).domTree).toBe(tree);
    expect((loader as any).document).toBe(doc);

    loader.dispose();

    expect((loader as any).domTree).toBeNull();
    expect((loader as any).document).toBeNull();
    expect((loader as any).observer).toBeNull();
  });

  it('dispose should clear pending elements', () => {
    const loader = new LazyLoader();
    const { doc, tree } = buildDom('<img loading="lazy" src="a.jpg"><img loading="lazy" src="b.jpg">');
    loader.init(doc, tree);

    const body = doc.bodyElement!;
    const imgs = body.children.filter(c => (c as DomElement).tagName === 'img');
    loader.observe(imgs[0] as DomElement);
    loader.observe(imgs[1] as DomElement);

    expect((loader as any).pendingElements.size).toBe(2);
    loader.dispose();
    expect((loader as any).pendingElements.size).toBe(0);
  });

  it('dispose should null scheduler', () => {
    const loader = new LazyLoader();
    const { doc, tree } = buildDom('<div></div>');
    loader.init(doc, tree);
    loader.dispose();
    expect((loader as any).scheduler).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INTERSECTION OBSERVER DISPOSE TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe('IntersectionObserver', () => {
  it('dispose should disconnect and clear observed elements', () => {
    const observer = new IntersectionObserver(() => {});
    const el = { nodeType: 'element', layoutBox: null } as any;

    observer.observe(el);
    expect(observer.active).toBe(true);

    observer.dispose();
    expect(observer.active).toBe(false);
  });

  it('dispose should null root and callback', () => {
    const cb = () => {};
    const observer = new IntersectionObserver(cb);
    observer.dispose();
    expect((observer as any).root).toBeNull();
    expect((observer as any).callback).toBeNull();
  });

  it('observe after dispose should be ignored', () => {
    const observer = new IntersectionObserver(() => {});
    observer.dispose();
    const el = { nodeType: 'element', layoutBox: null } as any;
    observer.observe(el);
    expect(observer.active).toBe(false);
  });

  it('dispose should cancel scheduler', () => {
    const observer = new IntersectionObserver(() => {});
    const el = { nodeType: 'element', layoutBox: null } as any;
    observer.observe(el);
    observer.dispose();
    expect((observer as any).scheduler).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MUTATION OBSERVER MODULE CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

describe('MutationObserver module cleanup', () => {
  beforeEach(() => {
    clearMutationObservers();
  });

  it('clearAllRegistrations should be callable without errors', () => {
    clearMutationObservers();
    expect(true).toBe(true);
  });

  it('clearAllRegistrations should be idempotent', () => {
    clearMutationObservers();
    clearMutationObservers();
    expect(true).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THIRD PARTY SECURITY SIZE CAP
// ─────────────────────────────────────────────────────────────────────────────

describe('ThirdPartySecurityManager', () => {
  it('should cap blocked requests at 5000', () => {
    const mgr = new ThirdPartySecurityManager();
    for (let i = 0; i < 6000; i++) {
      (mgr as any).recordBlocked('https://example.com', `https://track${i}.com/px.gif`, 'tracker', 'test');
    }
    expect(mgr.totalBlocked).toBeLessThanOrEqual(5000);
  });

  it('should keep most recent entries after cap', () => {
    const mgr = new ThirdPartySecurityManager();
    for (let i = 0; i < 5005; i++) {
      (mgr as any).recordBlocked('https://example.com', `https://track${i}.com/px.gif`, 'tracker', 'test');
    }
    const reqs = mgr.blockedRequests;
    expect(reqs[reqs.length - 1].url).toBe('https://track5004.com/px.gif');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION MANAGER SIZE CAP
// ─────────────────────────────────────────────────────────────────────────────

describe('PermissionManager', () => {
  it('should cap requests at maxEntries', async () => {
    const mgr = new PermissionManager({ maxEntries: 5000 });
    for (let i = 0; i < 6000; i++) {
      await mgr.request(`https://origin${i}.com`, 'midi');
    }
    expect(mgr.size).toBeLessThanOrEqual(5000);
  });

  it('should keep most recent requests after cap', async () => {
    const mgr = new PermissionManager({ maxEntries: 5000 });
    for (let i = 0; i < 5005; i++) {
      await mgr.request(`https://origin${i}.com`, 'midi');
    }
    expect(mgr.size).toBe(5000);
    expect(mgr.isGranted('https://origin5004.com', 'midi')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY STORE SIZE CAP
// ─────────────────────────────────────────────────────────────────────────────

describe('InMemoryHistoryStore', () => {
  it('should cap entries at MAX_ENTRIES (10000)', async () => {
    const store = new InMemoryHistoryStore();
    for (let i = 0; i < 10100; i++) {
      await store.addVisit(`https://page${i}.com`, `Page ${i}`, false);
    }
    expect(store.totalEntries).toBeLessThanOrEqual(10000);
  });

  it('should evict oldest entry when at capacity', async () => {
    const store = new InMemoryHistoryStore();
    for (let i = 0; i < 10000; i++) {
      await store.addVisit(`https://page${i}.com`, `Page ${i}`, false);
    }

    await store.addVisit('https://newpage.com', 'New Page', false);
    const { entries: after } = await store.query({ maxResults: 10000 });
    expect(after.some(e => e.url === 'https://newpage.com')).toBe(true);
    expect(store.totalEntries).toBeLessThanOrEqual(10000);
  });

  it('should not evict when under capacity', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://a.com', 'A', false);
    await store.addVisit('https://b.com', 'B', false);
    const { entries } = await store.query({});
    expect(entries.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT ENGINE FLOAT CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

describe('LayoutEngine floatContext cleanup', () => {
  it('should null floatContext after layout completes', () => {
    const engine = new LayoutEngine();
    const { doc } = buildDom('<div style="float:left;width:50px;height:50px"></div><p>Hello</p>');
    engine.layout(doc);
    expect((engine as any).floatContext).toBeNull();
  });

  it('should null floatContext after layout with no floats', () => {
    const engine = new LayoutEngine();
    const { doc } = buildDom('<p>Hello World</p>');
    engine.layout(doc);
    expect((engine as any).floatContext).toBeNull();
  });
});
