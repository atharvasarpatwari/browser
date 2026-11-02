/**
 * 1.74: a 70-case DOM / web API probe (56 passed first). Element queries missed detached subtrees
 * and <head>; reflected attributes (input.type, a.href and its URL parts, disabled…) and
 * document.head/forms were missing; timers ran in insertion order instead of due order; listener
 * `signal`, TextEncoder/TextDecoder and constraint validation were missing; localStorage.getItem
 * returned undefined for a missing key.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

// [expression run in the page (wrapped in an IIFE body if it starts with "{"), expected String() result]
const CASES: Array<[string, string]> = [
  // events
  ['{ let n = 0; const b = document.createElement("button"); b.addEventListener("click", () => n++, { once: true }); b.click(); b.click(); return n; }', '1'],
  ['{ const r = []; const p = document.getElementById("p"); const c = document.getElementById("c"); p.addEventListener("x", () => r.push("p")); c.addEventListener("x", () => r.push("c")); c.dispatchEvent(new Event("x", { bubbles: true })); return r.join(); }', 'c,p'],
  ['{ const r = []; const p = document.getElementById("p"); const c = document.getElementById("c"); p.addEventListener("y", () => r.push("p")); c.addEventListener("y", e => { r.push("c"); e.stopPropagation(); }); c.dispatchEvent(new Event("y", { bubbles: true })); return r.join(); }', 'c'],
  ['{ const r = []; const p = document.getElementById("p"); const c = document.getElementById("c"); p.addEventListener("z", () => r.push("cap"), true); c.addEventListener("z", () => r.push("tgt")); c.dispatchEvent(new Event("z", { bubbles: true })); return r.join(); }', 'cap,tgt'],
  ['{ const e = new Event("q", { cancelable: true }); document.body.addEventListener("q", ev => ev.preventDefault()); document.body.dispatchEvent(e); return e.defaultPrevented; }', 'true'],
  ['{ let d; document.addEventListener("hello", e => d = e.detail.v); document.dispatchEvent(new CustomEvent("hello", { detail: { v: 7 } })); return d; }', '7'],
  ['{ let t; const c = document.getElementById("c"); document.body.addEventListener("w", e => t = e.target.id + "/" + e.currentTarget.tagName); c.dispatchEvent(new Event("w", { bubbles: true })); return t; }', 'c/BODY'],
  ['{ let n = 0; const f = () => n++; const b = document.body; b.addEventListener("k", f); b.removeEventListener("k", f); b.dispatchEvent(new Event("k")); return n; }', '0'],
  ['{ let n = 0; const b = document.body; b.addEventListener("j", () => n++); b.addEventListener("j", e => e.stopImmediatePropagation()); b.addEventListener("j", () => n += 10); b.dispatchEvent(new Event("j")); return n; }', '1'],
  ['{ const ac = new AbortController(); let n = 0; document.body.addEventListener("m", () => n++, { signal: ac.signal }); ac.abort(); document.body.dispatchEvent(new Event("m")); return n + "," + ac.signal.aborted; }', '0,true'],
  // DOM tree manipulation
  ['{ const u = document.createElement("ul"); u.append("a", document.createElement("li")); u.prepend("z"); return u.childNodes.length + ":" + u.firstChild.textContent; }', '3:z'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<b>1</b><i>2</i>"; d.querySelector("i").before(document.createElement("hr")); return d.innerHTML; }', '<b>1</b><hr><i>2</i>'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<b>1</b>"; d.firstChild.after("t"); d.firstChild.replaceWith(document.createElement("em")); return d.innerHTML; }', '<em></em>t'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<p>x</p><p>y</p>"; d.replaceChildren(document.createElement("span")); return d.innerHTML; }', '<span></span>'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<p>x</p>"; d.querySelector("p").remove(); return d.childNodes.length; }', '0'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<p>x</p>"; d.insertAdjacentHTML("afterbegin", "<a></a>"); d.insertAdjacentHTML("beforeend", "<b></b>"); return d.innerHTML; }', '<a></a><p>x</p><b></b>'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<p class=\'k\'>x<b>y</b></p>"; const c = d.firstChild.cloneNode(true); const s = d.firstChild.cloneNode(false); return c.outerHTML + "|" + s.outerHTML; }', '<p class="k">x<b>y</b></p>|<p class="k"></p>'],
  ['{ const f = document.createDocumentFragment(); f.appendChild(document.createElement("i")); f.appendChild(document.createElement("b")); const d = document.createElement("div"); d.appendChild(f); return d.children.length + "," + f.childNodes.length; }', '2,0'],
  ['{ const t = document.createElement("template"); t.innerHTML = "<li>a</li><li>b</li>"; return t.content.childNodes.length + "," + t.childNodes.length; }', '2,0'],
  ['{ const d = document.createElement("div"); d.innerHTML = "<span></span>text<em></em>"; return d.children.length + "," + d.childNodes.length + "," + d.firstElementChild.nextElementSibling.tagName; }', '2,3,EM'],
  ['{ const d = document.createElement("div"); d.textContent = "<b>"; return d.innerHTML; }', '&lt;b&gt;'],
  ['{ const d = document.createElement("div"); d.innerHTML = "a <b>b</b> c"; return d.textContent; }', 'a b c'],
  ['{ const a = document.createElement("div"); const b = document.createElement("p"); a.appendChild(b); return a.contains(b) + "," + b.contains(a) + "," + (b.parentElement === a); }', 'true,false,true'],
  // attributes, classes, dataset, style
  ['{ const d = document.createElement("div"); d.classList.add("a", "b"); d.classList.toggle("a"); d.classList.toggle("c", true); d.classList.toggle("b", true); return d.className + "," + d.classList.contains("c"); }', 'b c,true'],
  ['{ const d = document.createElement("div"); d.classList.add("x"); d.classList.replace("x", "y"); return d.className + d.classList.length; }', 'y1'],
  ['{ const d = document.createElement("div"); d.dataset.userId = "5"; return d.getAttribute("data-user-id") + "," + d.dataset.userId; }', '5,5'],
  ['{ const d = document.createElement("div"); d.setAttribute("data-a-b", "1"); return d.dataset.aB + "," + ("aB" in d.dataset); }', '1,true'],
  ['{ const d = document.createElement("div"); d.toggleAttribute("hidden"); const a = d.hasAttribute("hidden"); d.toggleAttribute("hidden"); return a + "," + d.hasAttribute("hidden"); }', 'true,false'],
  ['{ const d = document.createElement("div"); d.style.setProperty("--x", "3px"); d.style.backgroundColor = "red"; return d.style.getPropertyValue("--x") + "|" + d.getAttribute("style").includes("background-color"); }', '3px|true'],
  ['{ const d = document.createElement("div"); d.style.cssText = "color: red; margin: 2px"; d.style.removeProperty("color"); return d.style.color + "|" + d.style.margin; }', '|2px'],
  ['{ const i = document.createElement("input"); i.value = "x"; return i.getAttribute("value") + "," + i.value; }', 'null,x'],
  ['{ const i = document.createElement("input"); i.type = "checkbox"; i.checked = true; return i.checked + "," + i.hasAttribute("checked"); }', 'true,false'],
  ['{ const a = document.createElement("a"); a.href = "/x?y=1#z"; return a.pathname + "|" + a.search + "|" + a.hash; }', '/x|?y=1|#z'],
  ['{ const d = document.createElement("div"); d.id = "q"; d.hidden = true; return d.outerHTML; }', '<div id="q" hidden=""></div>'],
  // selectors / traversal
  ['document.querySelectorAll("#list li").length', '3'],
  ['document.querySelector("#list li:nth-child(2)").textContent', 'two'],
  ['document.querySelector("#list li:last-child").textContent', 'three'],
  ['document.getElementById("c").closest("section").id', 'p'],
  ['document.getElementById("c").matches("section > div")', 'true'],
  ['[...document.querySelectorAll("#list li")].map(l => l.textContent).join()', 'one,two,three'],
  ['document.getElementById("list").querySelectorAll(":scope > li").length', '3'],
  ['document.querySelectorAll("li:not(.skip)").length', '2'],
  ['document.querySelector("input[name=email]").type', 'email'],
  ['document.documentElement.tagName + "," + document.head.tagName + "," + document.body.tagName', 'HTML,HEAD,BODY'],
  ['{ document.title = "T2"; return document.title; }', 'T2'],
  ['document.forms.length + "," + document.forms[0].elements.length', '1,2'],
  // forms
  ['{ const f = document.forms[0]; return new FormData(f).get("email"); }', 'a@b.c'],
  ['{ const s = document.querySelector("select"); return s.value + "," + s.selectedIndex + "," + s.options.length; }', 'b,1,2'],
  ['{ const s = document.querySelector("select"); s.value = "a"; return s.selectedIndex; }', '0'],
  ['document.querySelector("input[name=email]").checkValidity()', 'true'],
  // web APIs
  ['{ const u = new URL("https://ex.com:8080/a/b?x=1&y=2#h"); return u.hostname + "|" + u.port + "|" + u.searchParams.get("y") + "|" + u.origin; }', 'ex.com|8080|2|https://ex.com:8080'],
  ['{ const u = new URL("../c?q=1", "https://ex.com/a/b/"); return u.href; }', 'https://ex.com/a/c?q=1'],
  ['{ const p = new URLSearchParams("a=1&b=2&a=3"); p.append("c", "x y"); return p.getAll("a").join() + "|" + p.toString(); }', '1,3|a=1&b=2&a=3&c=x+y'],
  ['btoa("hi") + "," + atob("aGk=")', 'aGk=,hi'],
  ['new TextEncoder().encode("é").length', '2'],
  ['typeof crypto.randomUUID === "function" ? /^[0-9a-f-]{36}$/.test(crypto.randomUUID()) : "missing"', 'true'],
  ['{ localStorage.setItem("k", "v"); const r = localStorage.getItem("k"); localStorage.removeItem("k"); return r + "," + localStorage.getItem("k"); }', 'v,null'],
  ['typeof requestAnimationFrame + "," + typeof matchMedia("(min-width: 1px)").matches', 'function,boolean'],
  ['typeof window.innerWidth + "," + (window === globalThis) + "," + (self === window)', 'number,true,true'],
  ['{ const r = document.getElementById("c").getBoundingClientRect(); return typeof r.width + "," + (r.width > 0); }', 'number,true'],
  ['getComputedStyle(document.getElementById("c")).display', 'block'],
  ['{ const m = []; const o = new MutationObserver(rs => m.push(rs.length)); o.observe(document.body, { childList: true }); document.body.appendChild(document.createElement("hr")); return m.length + "," + typeof o.takeRecords; }', '0,function'],
  ['typeof IntersectionObserver + "," + typeof ResizeObserver', 'function,function'],
  ['navigator.userAgent.length > 0 && typeof navigator.language', 'string'],
];
const ASYNC: Array<[string, string]> = [
  ['new Promise(r => { const m = []; const o = new MutationObserver(rs => { m.push(rs[0].type); r(m.join()); }); o.observe(document.body, { attributes: true }); document.body.setAttribute("data-x", "1"); })', 'attributes'],
  ['new Promise(r => requestAnimationFrame(t => r(typeof t)))', 'number'],
  ['new Promise(r => { const log = []; setTimeout(() => log.push(2), 10); setTimeout(() => log.push(1), 0); setTimeout(() => r(log.join()), 30); })', '1,2'],
  ['fetch ? "fetch" : "none"', 'fetch'],
];

async function runAll(): Promise<{ sync: string[]; async: string[] }> {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 400, 1);
  const wrap = (c: string) => c.startsWith('{') ? `(function()${c})()` : `(${c})`;
  const put = (id: string, v: string) => `var p=document.createElement('p');p.id='${id}';p.textContent=${v};document.getElementById('out').appendChild(p);`;
  const sync = CASES.map(([c], i) => `<script>(function(){var v;try{v=String(${wrap(c)});}catch(e){v='THROW '+e;}${put('s' + i, 'v')}})();</script>`).join('');
  const asy = ASYNC.map(([c], i) => `<script>(function(){try{Promise.resolve(${c}).then(function(v){${put('a' + i, 'String(v)')}},function(e){${put('a' + i, "'REJECT '+e")}});}catch(e){${put('a' + i, "'THROW '+e")}}})();</script>`).join('');
  const fixture = `<section id="p"><div id="c" style="height:10px">c</div></section><ul id="list"><li>one</li><li class="skip">two</li><li>three</li></ul>
    <form><input name="email" type="email" value="a@b.c"><select name="s"><option value="a">A</option><option value="b" selected>B</option></select></form>`;
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><head><title>T</title></head><body>${fixture}<div id="out"></div>${sync}${asy}</body></html>` } as never, new AbortController().signal);
  await new Promise((res) => setTimeout(res, 800));
  const read = (id: string): string => { const el = domTree.getElementById(id); return el ? (el.children as any[]).map((t) => t.text ?? '').join('') : '<none>'; }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = { sync: CASES.map((_, i) => read('s' + i)), async: ASYNC.map((_, i) => read('a' + i)) };
  r.dispose();
  return res;
}

describe('DOM and web APIs (1.74 probe)', () => {
  let res: { sync: string[]; async: string[] };
  beforeAll(async () => { res = await runAll(); }, 120000);
  it.each(CASES.map(([c, want], i) => [c, want, i] as const))('%s', (_c, want, i) => { expect(res.sync[i]).toBe(want); });
  it.each(ASYNC.map(([c, want], i) => [c, want, i] as const))('async %s', (_c, want, i) => { expect(res.async[i]).toBe(want); });
});
