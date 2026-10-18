/**
 * Element APIs page scripts use every day, run through Nova's own interpreter. Before
 * 1.15: element querySelector(All)/insertAdjacentHTML/append/prepend/remove/closest
 * didn't exist, innerHTML couldn't be set, children/parentNode were stale snapshots,
 * matches() only matched the document's first hit, moving a node duplicated it, and
 * [...list] didn't spread.
 */
import { describe, expect, it } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

function page(html: string) {
  const hp = new HtmlParser();
  const domTree = new DomTree();
  domTree.buildFromHtml(hp.parse(html).document);
  const doc = domTree.getDocument() as never;
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc, domTree as never, eventLoop, undefined, undefined, undefined, undefined, 'https://example.com', hp as never);
  const run = (src: string): unknown => {
    const r = runJS(src, { document: doc, domTree: domTree as never, eventLoop, globalEnv: env, htmlParser: hp as never }) as { error?: { message: string }; value?: unknown };
    if (r.error) throw new Error(r.error.message);
    return r.value;
  };
  const body = () => domTree.getDocument()!.bodyElement as DomElement;
  const tags = () => body().children.filter((c): c is DomElement => c.nodeType === 'element').map((c) => c.tagName);
  return { run, tags, body };
}

describe('element tree APIs', () => {
  it('[...list] spreads, and spreading undefined throws', () => {
    const { run } = page('<html><body><p>a</p><p>b</p></body></html>');
    expect(run('[...document.querySelectorAll("p")].length')).toBe(2);
    expect(run('[1, ...[2, 3], ..."ab"].join(",")')).toBe('1,2,3,a,b');
    expect(() => run('[...undefined]')).toThrow(/not iterable/);
  });

  it('element.querySelector(All) is scoped to descendants', () => {
    const { run } = page('<html><body><p id="out">x</p><div id="d"><p>1</p><span><p>2</p></span></div></body></html>');
    expect(run('document.getElementById("d").querySelectorAll("p").length')).toBe(2);
    expect(run('document.getElementById("d").querySelector("p").textContent')).toBe('1');
    expect(run('document.getElementById("d").querySelector("#out")')).toBe(null);
  });

  it('children/parentNode/siblings are live after a change', () => {
    const { run } = page('<html><body><ul id="u"><li>a</li></ul></body></html>');
    expect(run('var u = document.getElementById("u"); u.children.length')).toBe(1);
    run('u.appendChild(document.createElement("li"))');
    expect(run('u.children.length')).toBe(2);
    expect(run('u.children[0].nextElementSibling === u.children[1]')).toBe(true);
    expect(run('u.lastElementChild.parentNode === u')).toBe(true);
  });

  it('insertAdjacentHTML inserts at all four positions, in order', () => {
    const { run, tags } = page('<html><body><div id="d"><b>mid</b></div></body></html>');
    run(`var d = document.getElementById("d");
      d.insertAdjacentHTML("beforebegin", "<h1>1</h1><h2>2</h2>");
      d.insertAdjacentHTML("afterend", "<h3>3</h3><h4>4</h4>");
      d.insertAdjacentHTML("afterbegin", "<i>first</i>");
      d.insertAdjacentHTML("beforeend", "<u>last</u>");`);
    expect(tags()).toEqual(['h1', 'h2', 'div', 'h3', 'h4']);
    expect(run('[...d.children].map(function (c) { return c.tagName; }).join(",")')).toBe('I,B,U');
  });

  it('innerHTML can be set, and reads back live', () => {
    const { run } = page('<html><body><div id="d">old</div></body></html>');
    run('document.getElementById("d").innerHTML = "<p class=x>new</p><p>two</p>"');
    expect(run('document.getElementById("d").children.length')).toBe(2);
    expect(run('document.getElementById("d").innerHTML')).toContain('new');
    expect(run('document.querySelectorAll("p.x").length')).toBe(1);
  });

  it('inserted HTML loses on* handlers and javascript: URLs, like setAttribute', () => {
    const { run } = page('<html><body><div id="d"></div></body></html>');
    run('document.getElementById("d").innerHTML = \'<a href="javascript:alert(1)" onclick="x()">x</a><img src="a.png" onerror="y()">\'');
    expect(run('var a = document.querySelector("#d a"); a.getAttribute("href") + "|" + a.getAttribute("onclick")')).toBe('null|null');
    expect(run('var im = document.querySelector("#d img"); im.getAttribute("src") + "|" + im.getAttribute("onerror")')).toBe('a.png|null');
  });

  it('append/prepend/before/after/remove/replaceChildren', () => {
    const { run, tags } = page('<html><body><main id="m"><p>p</p></main></body></html>');
    run(`var m = document.getElementById("m");
      m.append(document.createElement("footer"), "tail");
      m.prepend(document.createElement("header"));
      m.before(document.createElement("nav"));
      m.after(document.createElement("aside"));`);
    expect(tags()).toEqual(['nav', 'main', 'aside']);
    expect(run('[...m.children].map(function (c) { return c.tagName; }).join(",")')).toBe('HEADER,P,FOOTER');
    expect(run('m.textContent')).toContain('tail');
    run('document.querySelector("aside").remove()');
    expect(tags()).toEqual(['nav', 'main']);
    run('m.replaceChildren(document.createElement("section"))');
    expect(run('m.children.length + m.children[0].tagName')).toBe('1SECTION');
  });

  it('moving a node (prepend of an existing child) moves it instead of duplicating it', () => {
    const { run } = page('<html><body><p id="a">a</p><p id="b">b</p></body></html>');
    run('document.body.prepend(document.getElementById("b"))');
    expect(run('document.body.children.length')).toBe(2);
    expect(run('document.body.children[0].id')).toBe('b');
  });

  it('closest and matches work for any match, not just the first in the document', () => {
    const { run } = page('<html><body><div class="c"><p>1</p></div><div class="c"><p id="t">2</p></div></body></html>');
    expect(run('document.getElementById("t").closest(".c") === document.querySelectorAll(".c")[1]')).toBe(true);
    expect(run('document.querySelectorAll(".c")[1].matches(".c")')).toBe(true);
    expect(run('document.getElementById("t").closest("section")')).toBe(null);
  });

  it('lang/dir/title/hidden reflect their attributes', () => {
    const { run } = page('<html><body><p lang="fr">x</p></body></html>');
    expect(run('var p = document.querySelector("p"); p.lang')).toBe('fr');
    run('p.lang = "en"; p.dir = "rtl"; p.title = "t"; p.hidden = true');
    expect(run('[p.getAttribute("lang"), p.getAttribute("dir"), p.getAttribute("title"), p.hasAttribute("hidden")].join(",")')).toBe('en,rtl,t,true');
    run('p.hidden = false');
    expect(run('p.hidden')).toBe(false);
  });
});
