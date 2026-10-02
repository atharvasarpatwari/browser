/**
 * Regression test for a real bug found while working on the DevTools Console:
 * page-renderer.ts's executeAllScripts() called runJS() once per <script>
 * tag without ever passing a shared `globalEnv`, so each script silently got
 * its own fresh, isolated global environment — a variable or function
 * defined in one <script> tag was invisible to every other <script> tag on
 * the same page, which breaks the overwhelming majority of real multi-script
 * websites (a library script + a script that uses it, a config script + a
 * main script, etc.).
 *
 * This exercises the exact mechanism the fix uses — one createGlobalEnv()
 * call shared across multiple runJS() calls — the same shape
 * executeAllScripts() now follows for blocking/defer/async scripts alike.
 */
import { describe, it, expect } from 'vitest';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';

function makeDocAndTree() {
  const parsed = new HtmlParser().parse('<html><body></body></html>');
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml(parsed.document);
  return { doc, domTree };
}

describe('shared global environment across multiple <script> tags', () => {
  it('a variable declared in one script is visible in a later script when a shared globalEnv is passed', () => {
    const { doc, domTree } = makeDocAndTree();
    const eventLoop = new EventLoop();
    const globalEnv = createGlobalEnv(doc, domTree, eventLoop);

    const first = runJS('var sharedCounter = 1; function increment() { sharedCounter++; }', { document: doc, domTree, eventLoop, globalEnv });
    expect(first.error).toBeUndefined();

    const second = runJS('increment(); increment(); var result = sharedCounter;', { document: doc, domTree, eventLoop, globalEnv });
    expect(second.error).toBeUndefined();
    expect(globalEnv.get('result')).toBe(3);
  });

  it('two separate environments (the old, buggy shape) genuinely do not see each other\'s state', () => {
    const { doc, domTree } = makeDocAndTree();
    const eventLoop = new EventLoop();
    // Two distinct environments, one per "script" — exactly what runJS()
    // built internally every time before the fix, since it always fell
    // back to creating its own when none was passed.
    const firstEnv = createGlobalEnv(doc, domTree, eventLoop);
    const secondEnv = createGlobalEnv(doc, domTree, eventLoop);

    const first = runJS('var isolated = 1; function bump() { isolated++; }', { document: doc, domTree, eventLoop, globalEnv: firstEnv });
    expect(first.error).toBeUndefined();
    expect(firstEnv.get('isolated')).toBe(1);

    const second = runJS('var sawIsolated = typeof isolated; var sawBump = typeof bump;', { document: doc, domTree, eventLoop, globalEnv: secondEnv });
    expect(second.error).toBeUndefined();
    expect(secondEnv.get('sawIsolated')).toBe('undefined');
    expect(secondEnv.get('sawBump')).toBe('undefined');
  });

  it('classes, not just var/function, are shared across scripts with a shared globalEnv', () => {
    const { doc, domTree } = makeDocAndTree();
    const eventLoop = new EventLoop();
    const globalEnv = createGlobalEnv(doc, domTree, eventLoop);

    runJS('class Widget { constructor(n) { this.n = n; } double() { return this.n * 2; } }', { document: doc, domTree, eventLoop, globalEnv });
    const result = runJS('var w = new Widget(21); var doubled = w.double();', { document: doc, domTree, eventLoop, globalEnv });

    expect(result.error).toBeUndefined();
    expect(globalEnv.get('doubled')).toBe(42);
  });
});
