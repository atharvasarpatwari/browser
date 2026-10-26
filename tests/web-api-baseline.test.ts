/**
 * Web platform APIs pages call on load. They were missing, and calling a missing function now
 * throws (as in browsers), so each gap would stop a page's script. See
 * doc/2026-10-26-nova-android-1.30-*.md.
 */
import { describe, expect, it, vi } from 'vitest';
import { runJS } from '../src/browser/js/index';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

const run = (src: string, html = '<html><body><div id="d" class="a b" data-user-id="7" style="color: red"><span>x</span></div></body></html>') => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse(html) as unknown as { document: never }).document);
  const r = runJS(src, { document: doc, domTree } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  return r.value;
};

async function paintedText(html: string, width = 424): Promise<string> {
  const paint = new PaintEngine();
  const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  renderer.setViewport(width, 800, 1);
  await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  return paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => c.params[0] as string).join(' ');
}

describe('element.style is live', () => {
  it('reads and writes the style attribute', () => {
    expect(run('var d = document.getElementById("d"); d.style.color')).toBe('red');
    expect(run('var d = document.getElementById("d"); d.style.backgroundColor = "blue"; d.getAttribute("style")')).toBe('color: red; background-color: blue');
    expect(run('var d = document.getElementById("d"); d.style.color = ""; String(d.getAttribute("style"))')).toBe('null');
    expect(run('var d = document.getElementById("d"); d.style.setProperty("--gap", "4px"); d.style.getPropertyValue("--gap") + "|" + d.style.removeProperty("color") + "|" + d.style.cssText')).toBe('4px|red|--gap: 4px');
    expect(run('var d = document.getElementById("d"); d.style.cssText = "display: none"; d.style.display')).toBe('none');
  });

  it('el.style.display = "none" hides the element on screen', async () => {
    const shown = await paintedText('<html><body><p id="m">Menu text</p><p>Other</p></body></html>');
    expect(shown).toContain('Menu');
    const hidden = await paintedText('<html><body><p id="m">Menu text</p><p>Other</p><script>document.getElementById("m").style.display = "none";</script></body></html>');
    expect(hidden).not.toContain('Menu');
    expect(hidden).toContain('Other');
  });
});

describe('classList and dataset', () => {
  it('classList edits the class attribute', () => {
    expect(run('var c = document.getElementById("d").classList; c.add("c"); c.remove("a"); [c.contains("b"), c.contains("a"), c.length, c.value].join("|")')).toBe('true|false|2|b c');
    expect(run('var c = document.getElementById("d").classList; [c.toggle("a"), c.toggle("z"), c.toggle("z", true), document.getElementById("d").className].join("|")')).toBe('false|true|true|b z');
    expect(run('var c = document.getElementById("d").classList; c.replace("a", "q") + "|" + [...c].join(",")')).toBe('true|q,b');
  });

  it('dataset maps data-* attributes', () => {
    expect(run('var d = document.getElementById("d"); d.dataset.userId + "|" + ("userId" in d.dataset)')).toBe('7|true');
    expect(run('var d = document.getElementById("d"); d.dataset.fooBar = "x"; d.getAttribute("data-foo-bar") + "|" + Object.keys(d.dataset).join(",")')).toBe('x|userId,fooBar');
  });
});

describe('element methods', () => {
  it('contains / click / focus / toggleAttribute / getElementsByTagName / replaceWith', () => {
    expect(run('var d = document.getElementById("d"); [d.contains(d.firstChild), d.contains(document.body), d.hasChildNodes()].join("|")')).toBe('true|false|true');
    expect(run('var d = document.getElementById("d"), n = 0; d.addEventListener("click", function(){ n++; }); d.click(); n')).toBe(1);
    expect(run('var d = document.getElementById("d"), r = []; d.addEventListener("focus", function(){ r.push("f"); }); d.focus(); r.join()')).toBe('f');
    expect(run('var d = document.getElementById("d"); [d.toggleAttribute("hidden"), d.hasAttribute("hidden"), d.toggleAttribute("hidden"), d.hasAttribute("hidden")].join("|")')).toBe('true|true|false|false');
    expect(run('document.getElementById("d").getElementsByTagName("span").length')).toBe(1);
    expect(run('var s = document.getElementById("d").firstChild; var p = document.createElement("p"); s.replaceWith(p); document.getElementById("d").firstChild.tagName')).toBe('P');
  });

  it('DocumentFragment inserts its children', () => {
    expect(run('var f = document.createDocumentFragment(); f.appendChild(document.createElement("i")); f.appendChild(document.createElement("b")); var d = document.getElementById("d"); d.appendChild(f); [d.children.length, d.lastChild.tagName, f.childNodes.length].join("|")')).toBe('3|B|0');
  });
});

describe('DOM interfaces', () => {
  it('instanceof and prototype polyfills', () => {
    expect(run('var d = document.getElementById("d"); [d instanceof HTMLElement, d instanceof Element, d instanceof Node, d instanceof HTMLDivElement, d instanceof HTMLInputElement, document instanceof Node].join("|")')).toBe('true|true|true|true|false|true');
    expect(run('HTMLElement.prototype.hello = function(){ return "hi " + this.tagName; }; document.getElementById("d").hello()')).toBe('hi DIV');
    expect(run('Node.ELEMENT_NODE + "|" + Node.TEXT_NODE')).toBe('1|3');
  });
});

describe('window and language built-ins', () => {
  it('viewport, matchMedia, getComputedStyle', () => {
    expect(run('[typeof innerWidth, innerWidth > 0, devicePixelRatio, screen.width === innerWidth].join("|")')).toBe('number|true|1|true');
    expect(run('[matchMedia("(min-width: 600px)").matches, matchMedia("(max-width: 600px)").matches, matchMedia("(prefers-color-scheme: dark)").matches, matchMedia("print").matches, matchMedia("screen and (orientation: landscape)").matches].join("|")')).toBe('true|false|false|false|true');
    expect(run('typeof getComputedStyle(document.getElementById("d")).getPropertyValue')).toBe('function');
    expect(run('scrollTo(0, 0); window.scrollBy(0, 10); confirm("x") + "|" + prompt("y") + "|" + scrollY')).toBe('false|null|0');
  });

  it('String / Number / Math / Reflect / console statics', () => {
    expect(run('String.fromCharCode(72, 105) + String.fromCodePoint(0x1F600).length + String.raw`a\\nb`')).toBe('Hi2a\\nb');
    expect(run('[Number.isInteger(5), Number.isInteger(5.5), Number.isNaN(NaN), Number.isFinite("5"), Number.parseInt("12px"), Number.EPSILON > 0, Number.MAX_SAFE_INTEGER].join("|")')).toBe('true|false|true|false|12|true|9007199254740991');
    expect(run('[Math.imul(3, 4), Math.clz32(1), Math.log1p(0)].join("|")')).toBe('12|31|0');
    expect(run('var o = { a: 1 }; [Reflect.has(o, "a"), Reflect.get(o, "a"), Reflect.ownKeys(o).join(), Reflect.set(o, "b", 2), o.b, typeof Reflect.construct].join("|")')).toBe('true|1|a|true|2|undefined');
    expect(run('console.time("t"); console.timeEnd("t"); console.group("g"); console.groupEnd(); console.debug("x"); "ok"')).toBe('ok');
    expect(run('escape("a b") + "|" + unescape("%41")')).toBe('a%20b|A');
  });

  it('Event, CustomEvent, URL, URLSearchParams, Image, MutationObserver', () => {
    expect(run('var d = document.getElementById("d"), got; d.addEventListener("ping", function(e){ got = e.detail.n; }); d.dispatchEvent(new CustomEvent("ping", { detail: { n: 3 } })); got')).toBe(3);
    expect(run('new Event("x", { bubbles: true }).bubbles')).toBe(true);
    expect(run('var u = new URL("/a/b?x=1&y=2#h", "https://ex.com/base"); [u.href, u.pathname, u.searchParams.get("y"), u.origin, String(u)].join("|")')).toBe('https://ex.com/a/b?x=1&y=2#h|/a/b|2|https://ex.com|https://ex.com/a/b?x=1&y=2#h');
    expect(run('var u = new URL("https://ex.com/"); u.searchParams.set("q", "a b"); u.hash = "top"; u.href')).toBe('https://ex.com/?q=a+b#top');
    expect(run('var p = new URLSearchParams({ a: "1", b: "2" }); p.append("a", "3"); p.getAll("a").join() + "|" + p.toString() + "|" + [...p.keys()].join()')).toBe('1,3|a=1&b=2&a=3|a,b,a');
    expect(run('var r; try { new URL("nope"); } catch (e) { r = e instanceof TypeError; } r')).toBe(true);
    expect(run('var i = new Image(10, 20); i.tagName + "|" + i.getAttribute("width")')).toBe('IMG|10');
    expect(run('var m = new MutationObserver(function(){}); m.observe(document.body, { childList: true }); m.disconnect(); m.takeRecords().length')).toBe(0);
  });

  it('new with spread arguments, and new on a non-constructor throws', () => {
    expect(run('function P(a, b){ this.s = a + b; } var args = [1, 2]; new P(...args).s')).toBe(3);
    expect(run('var r; try { new undefinedThing(); } catch (e) { r = e.message; } r')).toBe('undefinedThing is not a constructor');
  });
});
