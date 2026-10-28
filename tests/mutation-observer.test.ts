/**
 * MutationObserver reports DOM changes (it was a stub that never called back).
 * See doc/2026-10-28-nova-android-1.35-*.md.
 */
import { describe, expect, it } from 'vitest';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { toString } from '../src/browser/js/values';

/** Runs the script, drains microtasks, and returns String(out). */
const run = (src: string) => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body><div id="box" class="a"><p id="p">hi</p></div></body></html>') as unknown as { document: never }).document);
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc as never, domTree as never, eventLoop);
  const r = runJS('var out = []; ' + src, { document: doc, domTree, eventLoop, globalEnv: env } as never);
  if (r.error) throw new Error('script error: ' + r.error.message);
  eventLoop.runWithInterpreter(() => eventLoop.runAll());
  return toString(env.get('out'));
};

describe('MutationObserver', () => {
  it('reports childList changes, batched into one callback per microtask', () => {
    expect(run(`
      var box = document.getElementById("box");
      new MutationObserver(function(records){ out.push(records.length + ":" + records.map(function(r){ return r.type + "+" + r.addedNodes.length + "-" + r.removedNodes.length; }).join(",")); })
        .observe(box, { childList: true });
      box.appendChild(document.createElement("span"));
      box.removeChild(document.getElementById("p"));
      out.push("sync");`)).toBe('sync,2:childList+1-0,childList+0-1');
  });

  it('subtree, attributes with a filter and old values', () => {
    expect(run(`
      new MutationObserver(function(rs){ rs.forEach(function(r){ out.push(r.type + ":" + r.attributeName + ":" + r.oldValue + ":" + r.target.id); }); })
        .observe(document.body, { subtree: true, attributeFilter: ["class"], attributeOldValue: true });
      var p = document.getElementById("p");
      p.setAttribute("class", "x");
      p.setAttribute("title", "ignored");
      document.getElementById("box").classList.add("b");`)).toBe('attributes:class:null:p,attributes:class:a:box');
  });

  it('without subtree, changes deeper down are not reported', () => {
    expect(run(`
      new MutationObserver(function(rs){ out.push("called " + rs.length); }).observe(document.body, { childList: true });
      document.getElementById("p").appendChild(document.createElement("b"));
      out.push("done");`)).toBe('done');
  });

  it('characterData on a text node, takeRecords and disconnect', () => {
    expect(run(`
      var t = document.getElementById("p").firstChild;
      var mo = new MutationObserver(function(rs){ out.push("cb " + rs.length); });
      mo.observe(t, { characterData: true, characterDataOldValue: true });
      t.textContent = "bye";
      var taken = mo.takeRecords();
      out.push(taken.length + ":" + taken[0].type + ":" + taken[0].oldValue);
      mo.disconnect();
      t.textContent = "again";`)).toBe('1:characterData:hi');
  });

  it('text nodes are live and keep their identity', () => {
    expect(run(`
      var p = document.getElementById("p"), t = p.firstChild;
      t.data = "changed";
      out.push(p.textContent, t === p.firstChild, t.length, t.parentNode === p, t.nodeName);`)).toBe('changed,true,7,true,#text');
  });

  it('observing document with subtree sees everything; bad options throw', () => {
    expect(run(`
      new MutationObserver(function(rs){ out.push(rs[0].type); }).observe(document, { childList: true, subtree: true });
      document.body.appendChild(document.createElement("i"));
      try { new MutationObserver(function(){}).observe(document.body, {}); } catch (e) { out.push(e instanceof TypeError); }`)).toBe('true,childList');
  });
});
