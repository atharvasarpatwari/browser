/**
 * 2.10: script-engine bugs found by running a public ad-block test page in the engine.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function run(body: string, waitMs = 0) {
  const domTree = new DomTree();
  const loadScript = vi.fn().mockResolvedValue('');
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript, loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    userStylesheet: () => '' } as never);
  r.setViewport(400, 600, 1);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body><div id="o"></div>${body}</body></html>` } as never, new AbortController().signal);
  if (waitMs) await new Promise((f) => setTimeout(f, waitMs));
  const out = domTree.getElementById('o')?.attributes.get('data-r');
  const errorCount = errors.mock.calls.length;
  errors.mockRestore();
  r.dispose();
  return { out, errorCount, loadScript };
}
const report = (expr: string) => `document.getElementById('o').setAttribute('data-r', String(${expr}));`;

describe('script engine', () => {
  it('a callback still runs after a nested eval', async () => {
    // eval() ran a nested program whose end unregistered the interpreter: the forEach callback threw.
    const { out, errorCount } = await run(`<script>var n = 0; eval('1+1'); [1, 2, 3].forEach(function (x) { n += x; }); ${report('n')}</script>`);
    expect(out).toBe('6');
    expect(errorCount).toBe(0);
  });

  it('Object.defineProperty works on a function (webpack require.n)', async () => {
    const { out, errorCount } = await run(`<script>var f = function () { return 1; }; Object.defineProperty(f, 'a', { enumerable: true, get: function () { return 42; } }); ${report('f.a')}</script>`);
    expect(out).toBe('42');
    expect(errorCount).toBe(0);
  });

  it('data blocks are not run or fetched as scripts', async () => {
    const { out, errorCount, loadScript } = await run(
      `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"}]}</script>` +
      `<script type="text/template" src="/tpl.html"></script>` +
      `<script type="text/javascript">${report('"ran"')}</script>`);
    expect(out).toBe('ran');
    expect(errorCount).toBe(0); // the JSON block used to fail as JavaScript
    expect(loadScript).not.toHaveBeenCalled();
  });

  it('host classes are functions to typeof', async () => {
    const { out } = await run(`<script>${report('[typeof AbortController, typeof Headers, typeof new AbortController().signal].join()')}</script>`);
    expect(out).toBe('function,function,object');
  });
  it('a var declared after its use is local to the function (a11y-dialog pattern)', async () => {
    // `var o` was not hoisted, so `o = …` replaced the outer function o and the second call failed.
    const { out, errorCount } = await run(`<script>
      function o(t) { return o = [t, t], o.length; var o }
      var first = o(1), second = typeof o === 'function' ? o(2) : 'o is not a function';
      function keep(a) { var a; return a; }                 // var x; keeps a parameter
      function later() { var seen = typeof v; var v = 1; return seen; }
      ${report('[first, second, keep(7), later()].join()')}
    </script>`);
    expect(out).toBe('2,2,7,undefined');
    expect(errorCount).toBe(0);
  });

  it('IntersectionObserver entries carry their target element', async () => {
    const { out } = await run(`<div id="a" class="x">a</div><script>
      var seen = 'no callback';
      var io = new IntersectionObserver(function (entries) { entries.forEach(function (e) { seen = e.target && e.target.id; if (e.target) e.target.classList.add('done'); }); }, { root: null, threshold: 0 });
      io.observe(document.getElementById('a'));
      setTimeout(function () { ${report("seen + '|' + document.getElementById('a').className")} }, 300);
    </script>`, 1500);
    expect(out).toBe('a|x done'); // target was undefined: the callback threw on e.target.classList
  });

  it('an error in an event listener is reported, and later listeners still run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { out } = await run(`<script>
      document.addEventListener('DOMContentLoaded', function () { undefinedThing.classList.add('x'); });
      document.addEventListener('DOMContentLoaded', function () { ${report('"second ran"')} });
    </script>`);
    expect(out).toBe('second ran');
    expect(warn.mock.calls.some((c) => /Uncaught error in a DOMContentLoaded listener/.test(String(c[0])))).toBe(true);
    warn.mockRestore();
  });
  it('finally keeps the outcome, and a promise resolved with a pending promise settles', async () => {
    const { out } = await run(`<script>
      var r = [];
      function done() { ${report('r.join()')} }
      (async function () {
        // A then-handler that returns a promise still pending: the outer promise never settled.
        r.push('A ' + await Promise.resolve(1).then(function () { return new Promise(function (res) { setTimeout(function () { res(7); }, 20); }); }));
        try { var v = await Promise.resolve(5).finally(function () { r.push('fin'); }); r.push('B ' + v); } catch (e) { r.push('B caught'); }
        try { await Promise.reject(new TypeError('x')).finally(function () { r.push('fin'); }); r.push('C resolved'); } catch (e) { r.push('C caught ' + (e && e.name)); }
        done();
      })();
      setTimeout(done, 2500);
    </script>`, 3500);
    // finally() resolved both ways with its callback's result: a failed fetch(...).finally(...) looked successful.
    expect(out).toBe('A 7,fin,B 5,fin,C caught TypeError');
  }, 20000);
});
