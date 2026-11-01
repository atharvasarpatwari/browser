/**
 * 1.67: a 60-case probe of DOM APIs page scripts rely on (45 passed): element geometry
 * (offsetWidth/clientWidth…), outerHTML/innerText, getAttributeNames, element nodeType,
 * compareDocumentPosition, :scope queries, select.selectedIndex/options, form.elements, FormData,
 * and void elements in innerHTML.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

const $ = (id: string) => `document.getElementById("${id}")`;
const CHECKS: Array<[string, string, string]> = [
  ['offsetWidth', `${$('box')}.offsetWidth`, '100'],
  ['offsetHeight', `${$('box')}.offsetHeight`, '50'],
  ['clientWidth', `${$('box')}.clientWidth`, '100'],
  ['getBoundingClientRect', `${$('box')}.getBoundingClientRect().width`, '100'],
  ['getComputedStyle width', `getComputedStyle(${$('box')}).width`, '100px'],
  ['getComputedStyle custom prop', `getComputedStyle(${$('box')}).getPropertyValue("--k").trim()`, '7'],
  ['style.setProperty custom', `(function(){ var e=${$('box')}; e.style.setProperty("--z","5"); return e.style.getPropertyValue("--z"); })()`, '5'],
  ['style.cssText', `(function(){ var e=document.createElement("p"); e.style.cssText="color: red; margin-top: 3px"; return e.style.marginTop; })()`, '3px'],
  ['style.removeProperty', `(function(){ var e=document.createElement("p"); e.style.color="red"; e.style.removeProperty("color"); return "[" + e.style.color + "]"; })()`, '[]'],
  ['classList.toggle force', `(function(){ var e=document.createElement("p"); e.classList.toggle("a", true); e.classList.toggle("a", true); return e.className; })()`, 'a'],
  ['classList.contains', `String(${$('box')}.classList.contains("b1"))`, 'true'],
  ['toggleAttribute', `(function(){ var e=document.createElement("p"); e.toggleAttribute("hidden"); return String(e.hasAttribute("hidden")); })()`, 'true'],
  ['replaceWith', `(function(){ var w=document.createElement("div"); var a=document.createElement("i"); w.appendChild(a); var b=document.createElement("b"); a.replaceWith(b); return w.innerHTML; })()`, '<b></b>'],
  ['append strings', `(function(){ var w=document.createElement("div"); w.append("x", document.createElement("i"), "y"); return w.innerHTML; })()`, 'x<i></i>y'],
  ['prepend', `(function(){ var w=document.createElement("div"); w.innerHTML="<b></b>"; w.prepend("a"); return w.innerHTML; })()`, 'a<b></b>'],
  ['before/after', `(function(){ var w=document.createElement("div"); var m=document.createElement("i"); w.appendChild(m); m.before("1"); m.after("2"); return w.innerHTML; })()`, '1<i></i>2'],
  ['remove', `(function(){ var w=document.createElement("div"); w.innerHTML="<i></i><b></b>"; w.firstChild.remove(); return w.innerHTML; })()`, '<b></b>'],
  ['replaceChildren', `(function(){ var w=document.createElement("div"); w.innerHTML="<i></i>"; w.replaceChildren("z"); return w.innerHTML; })()`, 'z'],
  ['cloneNode deep', `(function(){ var w=document.createElement("div"); w.innerHTML="<i>t</i>"; return w.cloneNode(true).innerHTML; })()`, '<i>t</i>'],
  ['outerHTML', `(function(){ var e=document.createElement("p"); e.id="q"; e.textContent="x"; return e.outerHTML; })()`, '<p id="q">x</p>'],
  ['innerText', `${$('txt')}.innerText.trim()`, 'Hello world'],
  ['textContent nested', `${$('txt')}.textContent`, 'Hello world'],
  ['entities', `(function(){ var e=document.createElement("p"); e.innerHTML="a &amp; b &lt;"; return e.textContent; })()`, 'a & b <'],
  ['insertAdjacentElement', `(function(){ var w=document.createElement("div"); var m=document.createElement("i"); w.appendChild(m); m.insertAdjacentElement("afterend", document.createElement("b")); return w.innerHTML; })()`, '<i></i><b></b>'],
  ['element siblings', `(function(){ var l=${$('list')}; return l.firstElementChild.nextElementSibling.textContent + l.lastElementChild.previousElementSibling.textContent + l.childElementCount; })()`, 'bb3'],
  ['parentElement', `${$('box')}.parentElement.tagName`, 'BODY'],
  ['getAttributeNames', `${$('box')}.getAttributeNames().join()`, 'id,class,style'],
  ['tagName uppercase', `document.createElement("div").tagName`, 'DIV'],
  ['nodeName text', `document.createTextNode("x").nodeName`, '#text'],
  ['nodeType', `document.createTextNode("x").nodeType + "," + ${$('box')}.nodeType`, '3,1'],
  ['querySelector escaped', `document.querySelector(".md\\\\:x").id`, 'esc'],
  ['querySelectorAll :scope >', `${$('list')}.querySelectorAll(":scope > li").length`, '3'],
  ['dataset set', `(function(){ var e=document.createElement("p"); e.dataset.fooBar="1"; return e.getAttribute("data-foo-bar"); })()`, '1'],
  ['id reflect', `(function(){ var e=document.createElement("p"); e.id="zz"; return e.getAttribute("id"); })()`, 'zz'],
  ['hidden reflect', `(function(){ var e=document.createElement("p"); e.hidden=true; return String(e.hasAttribute("hidden")); })()`, 'true'],
  ['input value', `(function(){ var i=document.createElement("input"); i.value="hi"; return i.value; })()`, 'hi'],
  ['input checked prop', `(function(){ var i=document.createElement("input"); i.type="checkbox"; i.checked=true; return String(i.checked); })()`, 'true'],
  ['select value', `${$('sel')}.value`, 'b'],
  ['select selectedIndex', `${$('sel')}.selectedIndex`, '1'],
  ['form elements', `${$('frm')}.elements.length`, '2'],
  ['FormData', `(function(){ var f=new FormData(${$('frm')}); return f.get("q"); })()`, 'v'],
  ['instanceof HTMLElement', `String(${$('box')} instanceof HTMLElement)`, 'true'],
  ['instanceof Element', `String(${$('box')} instanceof Element)`, 'true'],
  ['once + removeEventListener', `(function(){ var e=document.createElement("p"), n=0; function f(){ n++; } e.addEventListener("x", f); e.removeEventListener("x", f); e.addEventListener("y", function(){ n+=10; }, {once:true}); e.dispatchEvent(new Event("x")); e.dispatchEvent(new Event("y")); e.dispatchEvent(new Event("y")); return String(n); })()`, '10'],
  ['CustomEvent detail', `(function(){ var e=document.createElement("p"), d; e.addEventListener("c", function(ev){ d = ev.detail.v; }); e.dispatchEvent(new CustomEvent("c", { detail: { v: 4 } })); return String(d); })()`, '4'],
  ['stopImmediatePropagation', `(function(){ var e=document.createElement("p"), n=0; e.addEventListener("x", function(ev){ n++; ev.stopImmediatePropagation(); }); e.addEventListener("x", function(){ n++; }); e.dispatchEvent(new Event("x")); return String(n); })()`, '1'],
  ['currentTarget/target', `(function(){ var w=document.createElement("div"), c=document.createElement("i"), r=""; w.appendChild(c); w.addEventListener("x", function(ev){ r = ev.target.tagName + ">" + ev.currentTarget.tagName; }); c.dispatchEvent(new Event("x", { bubbles: true })); return r; })()`, 'I>DIV'],
  ['defaultPrevented', `(function(){ var e=document.createElement("p"); e.addEventListener("x", function(ev){ ev.preventDefault(); }); var ok = e.dispatchEvent(new Event("x", { cancelable: true })); return String(ok); })()`, 'false'],
  ['matchMedia', `String(matchMedia("(min-width: 500px)").matches)`, 'true'],
  ['innerWidth', `String(innerWidth)`, '600'],
  ['document.title set', `(function(){ document.title = "T2"; return document.title; })()`, 'T2'],
  ['Node.contains', `String(document.body.contains(${$('box')}))`, 'true'],
  ['compareDocumentPosition', `String(${$('box')}.compareDocumentPosition(${$('list')}) & 4)`, '4'],
  ['element.animate exists', `typeof ${$('box')}.animate`, 'function'],
  ['IntersectionObserver', `typeof IntersectionObserver`, 'function'],
  ['ResizeObserver', `typeof ResizeObserver`, 'function'],
  ['scrollIntoView', `typeof ${$('box')}.scrollIntoView`, 'function'],
];

const ASYNC = `
  window.__log = []; var __push = function (x) { __log.push(x); document.getElementById('out').setAttribute('data-async', __log.join(',')); };
  setTimeout(function () { __push("timeout"); }, 0);
  Promise.resolve().then(function () { __push("micro"); });
  queueMicrotask(function () { __push("qm"); });
  requestAnimationFrame(function () { __push("raf"); });
  (async function () { await null; __push("await"); })();
  var mo = new MutationObserver(function (recs) { __push("mo" + recs.length); });
  mo.observe(document.getElementById("list"), { childList: true });
  document.getElementById("list").appendChild(document.createElement("li"));
  __push("sync");
`;


async function run(scripts: string[]) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/page', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: `<html><head><title>T</title><style>#box{--k: 7}</style></head><body style="margin:0"><div id="box" class="b1" style="width:100px;height:50px"></div>
<p id="txt">Hello <b>world</b></p><ul id="list"><li>a</li><li>b</li><li>c</li></ul><i id="esc" class="md:x"></i>
<select id="sel"><option>a</option><option selected>b</option></select>
<form id="frm"><input name="q" value="v"><button>go</button></form>
<p id="out"></p>${scripts.map((s) => `<script>${s}</script>`).join('')}</body></html>` } as never, new AbortController().signal);
  for (let i = 0; i < 20; i++) await new Promise((res) => setTimeout(res, 5));
  return { out: domTree.getElementById('out')!, r };
}

describe('DOM APIs page scripts use', () => {
  it.each(CHECKS.map((c, i) => [c[0], i, c[2]] as const))('%s', async (_name, i, want) => {
    const [, expr] = CHECKS[i]!;
    const { out, r } = await run([`try { document.getElementById("out").setAttribute("data-r", String(${expr})); } catch (e) { document.getElementById("out").setAttribute("data-r", "THREW " + (e && e.message)); }`]);
    expect(out.attributes.get('data-r')).toBe(want);
    r.dispose();
  });

  it('runs sync code, then microtasks in order (Promise, queueMicrotask, await, MutationObserver), then timers', async () => {
    const { out, r } = await run([ASYNC]);
    expect(out.attributes.get('data-async')).toBe('sync,micro,qm,await,mo1,timeout');
    r.dispose();
  });

  it('innerHTML writes void elements without end tags', async () => {
    const { out, r } = await run(['var p = document.createElement("p"); p.innerHTML = "a<br>b<img alt=x>"; document.getElementById("out").setAttribute("data-r", p.innerHTML);']);
    expect(out.attributes.get('data-r')).toBe('a<br>b<img alt="x">');
    r.dispose();
  });
});
