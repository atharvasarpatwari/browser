import { test, _electron as electron } from '@playwright/test';
import type { Page } from '@playwright/test';
import http from 'node:http';

const GREEN = '#00ff00';
const RED = '#ff0000';
const GREY = '#808080';

/** Each fixture's script calls mark(i, cond) per assertion into a fixed grid of squares. */
function harnessHtml(bodyScript: string, count: number): string {
  const squares = Array.from({ length: count }, (_, i) => {
    const col = i % 10, row = Math.floor(i / 10);
    const x = 10 + col * 25, y = 10 + row * 25;
    return `<div id="t${i}" style="position:absolute;left:${x}px;top:${y}px;width:20px;height:20px;background:${GREY};"></div>`;
  }).join('\n');
  return `<!doctype html><html><body style="margin:0;position:relative;">
${squares}
<div id="lab"></div>
<script>
  function mark(i, ok) { document.getElementById('t'+i).style.background = ok ? '${GREEN}' : '${RED}'; }
${bodyScript}
</script>
</body></html>`;
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector('.content-area canvas') as HTMLCanvasElement | null;
    if (!c) return 'NO_CANVAS';
    const ctx = c.getContext('2d');
    if (!ctx) return 'NO_CTX';
    const scaleX = c.width / c.clientWidth;
    const scaleY = c.height / c.clientHeight;
    const d = ctx.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data;
    return `#${d[0].toString(16).padStart(2, '0')}${d[1].toString(16).padStart(2, '0')}${d[2].toString(16).padStart(2, '0')}`;
  }, [x, y] as const);
}

interface Case { name: string; html: string; labels: string[] }

const CASES: Case[] = [
  {
    name: 'core-js',
    labels: [
      'classList.add/remove/toggle/contains',
      'classList.replace',
      'classList.toggle(force)',
      'Array.prototype.flat(2)',
      'Array.prototype.includes(NaN)',
      'Array.prototype.find/findIndex',
      'Array.prototype.some/every',
      'Array.from(iterable, mapFn)',
      'Object.entries/fromEntries roundtrip',
      'Object.assign merge',
      'String.padStart/padEnd',
      'String.replaceAll',
      'String.prototype.at negative index',
      'JSON.stringify/parse roundtrip w/ nested',
      'JSON.stringify replacer function',
      'RegExp exec named groups',
      'String.matchAll',
      'String.replace with function callback',
      'Array.prototype.sort stability',
      'Number.isInteger/isFinite edge cases',
    ],
    html: harnessHtml(`
      try {
        var el = document.createElement('div');
        el.classList.add('a','b');
        el.classList.remove('a');
        el.classList.toggle('c');
        mark(0, el.classList.contains('b') && !el.classList.contains('a') && el.classList.contains('c'));
      } catch(e) { }

      try {
        var el2 = document.createElement('div');
        el2.classList.add('x');
        el2.classList.replace('x','y');
        mark(1, el2.classList.contains('y') && !el2.classList.contains('x'));
      } catch(e) { }

      try {
        var el3 = document.createElement('div');
        el3.classList.toggle('z', true);
        el3.classList.toggle('z', true);
        mark(2, el3.classList.contains('z'));
      } catch(e) { }

      try {
        mark(3, JSON.stringify([1,[2,[3,[4]]]].flat(2)) === JSON.stringify([1,2,3,[4]]));
      } catch(e) { }

      try {
        mark(4, [NaN].includes(NaN) === true && [1,2,3].includes(4) === false);
      } catch(e) { }

      try {
        var found = [1,2,3,4].find(function(n){ return n > 2; });
        var idx = [1,2,3,4].findIndex(function(n){ return n > 2; });
        mark(5, found === 3 && idx === 2);
      } catch(e) { }

      try {
        mark(6, [1,2,3].some(function(n){return n===2;}) === true && [1,2,3].every(function(n){return n>0;}) === true);
      } catch(e) { }

      try {
        var mapped = Array.from([1,2,3], function(n){ return n*2; });
        mark(7, JSON.stringify(mapped) === JSON.stringify([2,4,6]));
      } catch(e) { }

      try {
        var obj = {a:1,b:2};
        var entries = Object.entries(obj);
        var back = Object.fromEntries(entries);
        mark(8, back.a === 1 && back.b === 2);
      } catch(e) { }

      try {
        var merged = Object.assign({}, {a:1}, {b:2}, {a:3});
        mark(9, merged.a === 3 && merged.b === 2);
      } catch(e) { }

      try {
        mark(10, '5'.padStart(3,'0') === '005' && '5'.padEnd(3,'0') === '500');
      } catch(e) { }

      try {
        mark(11, 'a-b-a-b'.replaceAll('a','X') === 'X-b-X-b');
      } catch(e) { }

      try {
        mark(12, 'hello'.at(-1) === 'o');
      } catch(e) { }

      try {
        var src = {a:1, b:[1,2,{c:3}], d:null};
        var round = JSON.parse(JSON.stringify(src));
        mark(13, round.b[2].c === 3 && round.d === null);
      } catch(e) { }

      try {
        var out = JSON.stringify({a:1,b:2,c:3}, function(k,v){ return k==='b' ? undefined : v; });
        mark(14, out === '{"a":1,"c":3}');
      } catch(e) { }

      try {
        var m = /(?<year>\\d{4})-(?<month>\\d{2})/.exec('2026-09');
        mark(15, m.groups.year === '2026' && m.groups.month === '09');
      } catch(e) { }

      try {
        var all = Array.from('a1b2c3'.matchAll(/[a-z](\\d)/g), function(m){ return m[1]; });
        mark(16, JSON.stringify(all) === JSON.stringify(['1','2','3']));
      } catch(e) { }

      try {
        var replaced = 'a1b2'.replace(/\\d/g, function(m){ return String(Number(m)*2); });
        mark(17, replaced === 'a2b4');
      } catch(e) { }

      try {
        var pairs = [[1,'b'],[1,'a'],[0,'c']];
        pairs.sort(function(p,q){ return p[0]-q[0]; });
        mark(18, pairs[1][1] === 'b' && pairs[2][1] === 'a');
      } catch(e) { }

      try {
        mark(19, Number.isInteger(5.0) === true && Number.isInteger(5.5) === false && Number.isFinite(Infinity) === false);
      } catch(e) { }
    `, 20),
  },
  {
    name: 'dom-and-events',
    labels: [
      'querySelectorAll length + querySelector first match',
      'closest() walks ancestors',
      'matches() selector check',
      'insertBefore places node correctly',
      'cloneNode(true) deep-copies children',
      'append/prepend/before/after order',
      'event bubbling order (child before parent)',
      'capturing phase fires before bubbling',
      'stopPropagation halts bubbling',
      'addEventListener once removes itself',
      'removeEventListener stops future calls',
      'preventDefault sets defaultPrevented',
      'custom event detail payload',
      'dataset reflects data-* attributes',
      'getAttribute/setAttribute/removeAttribute',
      'document.cookie is always a string (never undefined) and round-trips a value set through it',
      'customElements.define() accepts a real class extending HTMLElement (real Cloudflare/Astro code), not just a plain function',
      'document.currentScript is the real, currently-executing <script> element (real self-configuring embed-script pattern, e.g. Fathom/Plausible analytics reading their own data-* attributes) and is null once the script finishes',
      'a plain element\'s getElementsByTagName (not just document\'s) finds descendants, including the "*" wildcard (real jQuery feature-detection code builds a detached scratch div then calls div.getElementsByTagName), and document.createDocumentFragment() supports appendChild/removeChild/cloneNode (also real jQuery feature-detection code)',
      'document/element nodeType and nodeName are real values (real jQuery Sizzle selector engine reads documentElement.nodeName to decide HTML vs XML, and silently disabled all its optimized selector matching without this — "$(\'.class\')" matched nothing), element.ownerDocument resolves to the real document (real jQuery buildFragment reads it to call createDocumentFragment()), and appending a real DocumentFragment moves its children in rather than inserting the fragment itself',
    ],
    html: harnessHtml(`
      var lab = document.getElementById('lab');
      lab.innerHTML = '<div class="grp"><span class="x">1</span><span class="x">2</span><span class="y">3</span></div>';

      try {
        var all = lab.querySelectorAll('.x');
        var first = lab.querySelector('.x');
        mark(0, all.length === 2 && first.textContent === '1');
      } catch(e) { }

      try {
        var leaf = lab.querySelector('.y');
        var found = leaf.closest('.grp');
        mark(1, found === lab.querySelector('.grp'));
      } catch(e) { }

      try {
        mark(2, lab.querySelector('.y').matches('span.y') === true && lab.querySelector('.y').matches('.x') === false);
      } catch(e) { }

      try {
        var p = document.createElement('div');
        var a = document.createElement('span'); a.id='a';
        var b = document.createElement('span'); b.id='b';
        p.appendChild(b);
        p.insertBefore(a, b);
        mark(3, p.firstChild === a && p.lastChild === b);
      } catch(e) { }

      try {
        var orig = document.createElement('div');
        orig.innerHTML = '<span>inner</span>';
        var clone = orig.cloneNode(true);
        mark(4, clone.children.length === 1 && clone.children[0].textContent === 'inner' && clone !== orig);
      } catch(e) { }

      try {
        var box = document.createElement('div');
        var mid = document.createElement('i'); mid.id='mid';
        box.appendChild(mid);
        var before = document.createElement('b'); before.id='before';
        var after = document.createElement('u'); after.id='after';
        mid.before(before);
        mid.after(after);
        mark(5, box.children[0].id==='before' && box.children[1].id==='mid' && box.children[2].id==='after');
      } catch(e) { }

      try {
        var order = [];
        var outer = document.createElement('div');
        var inner = document.createElement('span');
        outer.appendChild(inner);
        document.body.appendChild(outer);
        outer.addEventListener('click', function(){ order.push('outer'); });
        inner.addEventListener('click', function(){ order.push('inner'); });
        inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        mark(6, order[0] === 'inner' && order[1] === 'outer');
        outer.remove();
      } catch(e) { }

      try {
        var order2 = [];
        var outer2 = document.createElement('div');
        var inner2 = document.createElement('span');
        outer2.appendChild(inner2);
        document.body.appendChild(outer2);
        outer2.addEventListener('click', function(){ order2.push('outer-capture'); }, true);
        inner2.addEventListener('click', function(){ order2.push('inner-bubble'); });
        inner2.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        mark(7, order2[0] === 'outer-capture' && order2[1] === 'inner-bubble');
        outer2.remove();
      } catch(e) { }

      try {
        var outerFired = false;
        var outer3 = document.createElement('div');
        var inner3 = document.createElement('span');
        outer3.appendChild(inner3);
        document.body.appendChild(outer3);
        outer3.addEventListener('click', function(){ outerFired = true; });
        inner3.addEventListener('click', function(e){ e.stopPropagation(); });
        inner3.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        mark(8, outerFired === false);
        outer3.remove();
      } catch(e) { }

      try {
        var count = 0;
        var t = document.createElement('div');
        t.addEventListener('click', function(){ count++; }, { once: true });
        t.dispatchEvent(new MouseEvent('click'));
        t.dispatchEvent(new MouseEvent('click'));
        mark(9, count === 1);
      } catch(e) { }

      try {
        var count2 = 0;
        var t2 = document.createElement('div');
        function handler(){ count2++; }
        t2.addEventListener('click', handler);
        t2.dispatchEvent(new MouseEvent('click'));
        t2.removeEventListener('click', handler);
        t2.dispatchEvent(new MouseEvent('click'));
        mark(10, count2 === 1);
      } catch(e) { }

      try {
        var ev = new Event('submit', { cancelable: true });
        var t3 = document.createElement('form');
        t3.addEventListener('submit', function(e){ e.preventDefault(); });
        t3.dispatchEvent(ev);
        mark(11, ev.defaultPrevented === true);
      } catch(e) { }

      try {
        var payload = null;
        var t4 = document.createElement('div');
        t4.addEventListener('myevent', function(e){ payload = e.detail; });
        t4.dispatchEvent(new CustomEvent('myevent', { detail: { x: 42 } }));
        mark(12, payload && payload.x === 42);
      } catch(e) { }

      try {
        var t5 = document.createElement('div');
        t5.setAttribute('data-user-id', '7');
        mark(13, t5.dataset.userId === '7');
      } catch(e) { }

      try {
        var t6 = document.createElement('div');
        t6.setAttribute('title', 'hi');
        var has1 = t6.getAttribute('title') === 'hi';
        t6.removeAttribute('title');
        mark(14, has1 && t6.getAttribute('title') === null);
      } catch(e) { }

      try {
        // Reproduces a real Wikipedia gap: document.cookie.match(...) — a
        // real browser always returns a string here, even with no cookies
        // set, since a huge amount of real-world code reads it unconditionally.
        var wasString = typeof document.cookie === 'string';
        var noMatch = document.cookie.match(/(?:^|; )nonexistent=([^;]+)/) === null;
        document.cookie = 'novaTest=hello';
        var roundTrip = document.cookie.indexOf('novaTest=hello') !== -1;
        mark(15, wasString && noMatch && roundTrip);
      } catch(e) { }

      try {
        // Reproduces a real Cloudflare/Astro gap: customElements.define()'s
        // validity check only accepted objects with type: 'function' —
        // a real ES6 class (type: 'class', needed because a custom element
        // must extend HTMLElement, which requires a real super() call)
        // was rejected as "Custom element constructor must be a function"
        // even though it's the near-universal real-world way to define one.
        class NovaTestEl extends HTMLElement {
          connectedCallback() { this.setAttribute('hydrated', 'true'); }
        }
        customElements.define('nova-test-el', NovaTestEl);
        mark(16, customElements.get('nova-test-el') === NovaTestEl);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting vuejs.org: document.currentScript
        // was never implemented at all, so real self-configuring embed
        // scripts (Fathom/Plausible/etc. analytics tags reading their own
        // data-* attributes off their own <script> tag) crashed trying to
        // read a property off it — "Cannot read properties of null".
        var duringExec = document.currentScript;
        var isScriptDuringExec = duringExec !== null && duringExec.tagName === 'SCRIPT';
        setTimeout(function() {
          var nullAfterSync = document.currentScript === null;
          mark(17, isScriptDuringExec && nullAfterSync);
        }, 0);
      } catch(e) { }

      try {
        // Reproduces two real gaps found continuing the jQuery bisection:
        // (1) only document.getElementsByTagName existed — a plain element
        // (e.g. jQuery's own detached scratch div used for feature
        // detection) had no getElementsByTagName at all, and even
        // document's version never matched the "*" wildcard tag. (2)
        // document.createDocumentFragment() didn't exist at all, so real
        // feature-detection code building a fragment to test cloning/
        // checkbox-state-preservation crashed immediately.
        var scratch = document.createElement('div');
        scratch.innerHTML = "<a href='/a'>a</a><input type='checkbox'/>";
        var starCount = scratch.getElementsByTagName('*').length;
        var anchor = scratch.getElementsByTagName('a')[0];
        var tagOk = starCount === 2 && anchor && anchor.tagName.toLowerCase() === 'a';

        var frag = document.createDocumentFragment();
        var fchild = document.createElement('span');
        frag.appendChild(fchild);
        var addedOk = frag.children.length === 1;
        frag.removeChild(fchild);
        var removedOk = frag.children.length === 0;
        frag.appendChild(document.createElement('span'));
        var cloneOk = frag.cloneNode(true).children.length === 1;

        mark(18, tagOk && addedOk && removedOk && cloneOk);
      } catch(e) { }

      try {
        // Reproduces the real gap that unblocked real jQuery's entire
        // Sizzle selector engine: document.nodeType/nodeName and
        // element.nodeType/nodeName didn't exist at all. Sizzle's own
        // isXML() check reads documentElement.nodeName !== "HTML" to
        // decide whether a document is HTML or XML — with nodeName always
        // undefined, every document looked like XML, so Sizzle
        // permanently disabled its getElementsByClassName/
        // getElementsByTagName-based fast paths and "$('.some-class')"
        // silently matched nothing.
        var docNodeOk = document.nodeType === 9 && document.nodeName === '#document';
        var elNodeOk = document.documentElement.nodeType === 1 && document.documentElement.nodeName === 'HTML';

        // Reproduces the real gap in jQuery's own buildFragment(): it
        // resolves the owning document via el.ownerDocument || el before
        // calling .createDocumentFragment() on it — with ownerDocument
        // missing entirely, that call landed on the element itself and
        // crashed. Also verifies a real DocumentFragment, once appended,
        // moves its children into the target instead of inserting the
        // fragment node itself.
        var ownerDocOk = document.createElement('div').ownerDocument === document;
        var target = document.createElement('div');
        var frag = document.createDocumentFragment();
        frag.appendChild(document.createElement('span'));
        frag.appendChild(document.createElement('b'));
        target.appendChild(frag);
        var fragFlattenOk = target.children.length === 2 && frag.children.length === 0;

        mark(19, docNodeOk && elNodeOk && ownerDocOk && fragFlattenOk);
      } catch(e) { }
    `, 20),
  },
  {
    name: 'async-and-collections',
    labels: [
      'Set dedups values',
      'Map preserves insertion order iteration',
      'Map.get/has/delete',
      'Promise.all resolves in order',
      'Promise.allSettled reports mixed results',
      'Promise.race resolves with fastest',
      'async/await try-catch catches rejection',
      'microtask runs before macrotask (setTimeout 0)',
      'setTimeout with args passthrough',
      'clearTimeout cancels pending call',
    ],
    html: harnessHtml(`
      try {
        var s = new Set([1,2,2,3,3,3]);
        mark(0, s.size === 3 && s.has(2));
      } catch(e) { }

      try {
        var m = new Map();
        m.set('b', 2); m.set('a', 1); m.set('c', 3);
        var keys = Array.from(m.keys());
        mark(1, keys[0]==='b' && keys[1]==='a' && keys[2]==='c');
      } catch(e) { }

      try {
        var m2 = new Map([['x',1]]);
        var had = m2.has('x');
        m2.delete('x');
        mark(2, had === true && m2.get('x') === undefined && m2.has('x') === false);
      } catch(e) { }

      window.__asyncDone = false;
      Promise.all([
        new Promise(function(res){ setTimeout(function(){ res(1); }, 30); }),
        new Promise(function(res){ setTimeout(function(){ res(2); }, 10); }),
        Promise.resolve(3),
      ]).then(function(vals){
        mark(3, vals[0]===1 && vals[1]===2 && vals[2]===3);
      }).catch(function(){ mark(3, false); });

      Promise.allSettled([
        Promise.resolve(1),
        Promise.reject('err'),
      ]).then(function(results){
        mark(4, results[0].status==='fulfilled' && results[0].value===1 && results[1].status==='rejected' && results[1].reason==='err');
      }).catch(function(){ mark(4, false); });

      Promise.race([
        new Promise(function(res){ setTimeout(function(){ res('slow'); }, 40); }),
        new Promise(function(res){ setTimeout(function(){ res('fast'); }, 5); }),
      ]).then(function(v){ mark(5, v === 'fast'); }).catch(function(){ mark(5, false); });

      (async function(){
        try {
          await Promise.reject(new Error('boom'));
          mark(6, false);
        } catch(e) {
          mark(6, e.message === 'boom');
        }
      })();

      (function(){
        var order = [];
        setTimeout(function(){ order.push('macro'); mark(7, order[0]==='micro' && order[1]==='macro'); }, 0);
        Promise.resolve().then(function(){ order.push('micro'); });
      })();

      (function(){
        setTimeout(function(a, b){ mark(8, a === 'x' && b === 42); }, 10, 'x', 42);
      })();

      (function(){
        var fired = false;
        var id = setTimeout(function(){ fired = true; }, 10);
        clearTimeout(id);
        setTimeout(function(){ mark(9, fired === false); }, 50);
      })();
    `, 10),
  },
  {
    name: 'language-features',
    labels: [
      'generator function + for-of drains yielded values',
      'yield* delegates into a sub-iterable',
      'for-of iterates a Map as [key, value] pairs',
      'for-of iterates a Set',
      'for-of iterates a custom Symbol.iterator object',
      'function rest parameter',
      'function default parameter',
      'function destructured object param with nested default',
      'function destructured array param',
      'arrow function destructured object param',
      'arrow function rest parameter',
      'arrow function destructured param with outer default',
      'URL parses hostname/pathname/search/hash',
      'URLSearchParams get/has via URL.searchParams',
      'FormData reads real form control values',
      'TextEncoder/TextDecoder round-trip',
      'Array.prototype.toSorted does not mutate the original',
      'Array.prototype.with returns a copy with one index replaced',
      'Object.groupBy partitions by callback result',
      'Symbol used as a computed object-literal key is retrievable',
      'malformed URL throws a catchable TypeError',
      'relative URL resolves against a base (path, dot-dot, protocol-relative)',
      'malformed regex literal throws a catchable SyntaxError',
      'identifier with a \\uXXXX escape (e.g. minified ɵprov-style names) is read as one decoded name',
      'a plain object property literally named "get" with a non-trivial value (found in real YouTube code) is not misread as a getter accessor',
      'real getter/setter accessors, a shorthand "get" property, and a method literally named "get" all still work after that fix',
      'eval() no longer permanently breaks getter/setter access for the rest of the script afterward',
      'a ternary immediately followed by leading-dot decimals ("cond?.9:.75") is not misread as optional chaining',
      'the real-world "find the true global object" feature-detection pattern (globalThis/window/self, checking .Math identity) succeeds instead of throwing',
      'window, self, and globalThis are the same object, and mirror real built-ins beyond just Math',
      'a regex literal whose pattern contains an escaped slash and a backreference (a real closing-tag matcher) parses and matches correctly',
      'more escaped-slash regex shapes work, and an ordinary regex with none is unaffected',
      'a top-level var/function declaration is immediately visible as a window property, and a window property assignment is visible as a bare identifier (real global-object semantics, not two independent copies)',
      'window.performance.timing exists with real PerformanceTiming fields (legacy API still read by real-world page-load beacons)',
      'a regex literal whose pattern starts with "=" (e.g. matching a query-string assignment) is not misread as the /= divide-assign operator, and real /= still works',
      '"as" works as a plain identifier/object-key/destructuring-rename everywhere (real React polymorphic-component code), not just as an import/export specifier keyword',
      'let/const destructuring (object, array, nested, rest, defaults) actually binds its names — a bare let/const {a} or [a] silently bound nothing at all',
      'for-of with a destructured loop variable (let, const, and var) binds the real pattern each iteration instead of a variable literally named "undefined"',
      'window.matchMedia() returns a real MediaQueryList-shaped object whose .matches reflects the real CSS engine\'s own media-query evaluation',
      'a native engine error (a real TDZ violation) is catchable by a guest try/catch, not just a guest-thrown Error',
      'a try/finally with no catch handler still runs its finally block before a native error propagates',
      'let/const/class declared in a bare {}, if, while, or do-while block does not leak outside that block, and var still correctly hoists all the way out',
      'new URL(relative, base) accepts a real URL object or window.location as the base (real SvelteKit bootstrap code), and String(location)/template-literal interpolation of location both yield the real href',
      'for (const x of/in ...) no longer throws "Assignment to constant variable" on the first iteration, and for (let x of/in ...) gives each closure its own per-iteration binding instead of the last value',
      'for await (x of iterable) parses and awaits each value (a plain value passes through unchanged, a resolved Promise is unwrapped)',
      'a destructured object-pattern property with a non-identifier string key and a default value (e.g. real minified React/Emotion prop-forwarding code) actually parses',
      'a regex literal as the very first statement of an if/while/for/switch body parses correctly instead of being misread as division (division right after those headers is unaffected when something comes between the closing paren and the slash)',
      'a reserved word (class, get, set, as, await, default, new) works as a destructuring property key (e.g. real minified React/Figma code renaming a "class" prop), not just a plain identifier',
      'top-level this is the real global object (window/globalThis), not undefined (real Angular.dev dark-mode-detection code reads this.document at the top of an inline script), and a plain non-strict function call falls back to it the same way',
      '"use strict" is correctly detected both as a function-level directive and a program-level directive that propagates to every function in the file (including ones nested inside it), so a strict function call\'s this correctly stays undefined instead of falling back to the global object',
      'Array.prototype is a real object exposing the same methods a real array instance has (real jQuery code reads Array.prototype.push/.slice directly), and Array.prototype.findLast/findLastIndex both work (real cloudflare.com beacon code)',
      'new a.b.c(args) constructs the full member-expression chain, not (new a.b).c(args) — a real jQuery core-factory pattern (jQuery = function(a,b){return new jQuery.fn.init(a,b);}) misparsed this way recursed into its own constructor forever',
      'an empty statement (a bare ";") as an if/for-in/for-of body no longer crashes the engine — real jQuery 1.8.2 uses "for(d in obj);" (isPlainObject) to leave a variable set to the last enumerable key, relying on exactly this shape',
      'assigning a numeric array index at or past the current length (arr[arr.length] = x, the "push without .push()" idiom real jQuery.map uses internally) correctly grows .length, for plain assignment, compound assignment, and ++/--',
      'a ternary whose branches are bare (unparenthesized) assignment expressions parses correctly (cond ? a=x : a=y), not as a ConditionalExpression used as an invalid assignment target — real jQuery\'s own per-element data-cache ID assignment is written exactly this way, and the misparse silently broke .on()/.trigger() and anything else built on jQuery\'s internal data() cache',
      'Array.prototype.slice resolves a negative start/end index relative to the array\'s length instead of clamping it to 0 — jQuery\'s own .last() is implemented as .slice(-1), and the clamp bug made it silently return the entire, unfiltered collection instead of just the final element',
      'HTML parsing never adds a bogus empty-string-keyed attribute to a parsed tag (the tokenizer\'s per-tag attribute flush ran unconditionally even when there was nothing left to commit)',
    ],
    html: harnessHtml(`
      try {
        function* gen() { yield 1; yield 2; yield 3; }
        var out = [];
        for (var v of gen()) out.push(v);
        mark(0, JSON.stringify(out) === JSON.stringify([1,2,3]));
      } catch(e) { }

      try {
        function* inner() { yield 'a'; yield 'b'; }
        function* outer() { yield 1; yield* inner(); yield 2; }
        var out2 = [];
        for (var v2 of outer()) out2.push(v2);
        mark(1, JSON.stringify(out2) === JSON.stringify([1,'a','b',2]));
      } catch(e) { }

      try {
        var m = new Map([['x',1],['y',2]]);
        var out3 = [];
        for (var pair of m) out3.push(pair[0] + ':' + pair[1]);
        mark(2, JSON.stringify(out3) === JSON.stringify(['x:1','y:2']));
      } catch(e) { }

      try {
        var s = new Set([1,2,3]);
        var out4 = [];
        for (var v4 of s) out4.push(v4);
        mark(3, JSON.stringify(out4) === JSON.stringify([1,2,3]));
      } catch(e) { }

      try {
        var custom = { [Symbol.iterator]: function() {
          var i = 0;
          return { next: function() { return i < 3 ? {value: i++, done:false} : {value:undefined, done:true}; } };
        }};
        var out5 = [];
        for (var v5 of custom) out5.push(v5);
        mark(4, JSON.stringify(out5) === JSON.stringify([0,1,2]));
      } catch(e) { }

      try {
        function withRest(a, ...rest) { return a + ':' + rest.join(','); }
        mark(5, withRest(1,2,3,4) === '1:2,3,4');
      } catch(e) { }

      try {
        function withDefault(a, b = 10) { return a + b; }
        mark(6, withDefault(5) === 15 && withDefault(5, 1) === 6);
      } catch(e) { }

      try {
        function withObjDestructure({x, y = 100}) { return x + y; }
        mark(7, withObjDestructure({x: 1}) === 101 && withObjDestructure({x: 1, y: 2}) === 3);
      } catch(e) { }

      try {
        function withArrDestructure([a, , b]) { return a + b; }
        mark(8, withArrDestructure([1, 99, 2]) === 3);
      } catch(e) { }

      try {
        var arrowObj = ({a, b}) => a + b;
        mark(9, arrowObj({a: 3, b: 4}) === 7);
      } catch(e) { }

      try {
        var arrowRest = (...args) => args.length;
        mark(10, arrowRest(1,2,3) === 3);
      } catch(e) { }

      try {
        var arrowNested = (a, {b, c = 5} = {}) => a + b + c;
        mark(11, arrowNested(1, {b: 2}) === 8);
      } catch(e) { }

      try {
        var u = new URL('https://example.com:8080/path?a=1&b=2#hash');
        mark(12, u.hostname === 'example.com' && u.pathname === '/path' && u.search === '?a=1&b=2' && u.hash === '#hash' && u.port === '8080');
      } catch(e) { }

      try {
        var u2 = new URL('https://example.com/?a=1&b=2');
        mark(13, u2.searchParams.get('a') === '1' && u2.searchParams.has('b') === true && u2.searchParams.get('c') === null);
      } catch(e) { }

      try {
        var form = document.createElement('form');
        var inp = document.createElement('input');
        inp.name = 'username'; inp.value = 'bob';
        form.appendChild(inp);
        var fd = new FormData(form);
        mark(14, fd.get('username') === 'bob' && fd.get('missing') === null);
      } catch(e) { }

      try {
        var enc = new TextEncoder();
        var bytes = enc.encode('hi');
        var dec = new TextDecoder();
        mark(15, dec.decode(bytes) === 'hi' && bytes.length === 2);
      } catch(e) { }

      try {
        var orig = [3,1,2];
        var sorted = orig.toSorted();
        mark(16, JSON.stringify(sorted) === JSON.stringify([1,2,3]) && JSON.stringify(orig) === JSON.stringify([3,1,2]));
      } catch(e) { }

      try {
        mark(17, JSON.stringify([1,2,3].with(1, 99)) === JSON.stringify([1,99,3]));
      } catch(e) { }

      try {
        var grouped = Object.groupBy([1,2,3,4], function(n){ return n % 2 === 0 ? 'even' : 'odd'; });
        mark(18, JSON.stringify(grouped.odd) === JSON.stringify([1,3]) && JSON.stringify(grouped.even) === JSON.stringify([2,4]));
      } catch(e) { }

      try {
        var key = Symbol('mykey');
        var withSymKey = { [key]: 'value1' };
        mark(19, withSymKey[key] === 'value1');
      } catch(e) { }

      try {
        var threw = false;
        try { new URL('not a valid url'); } catch(e2) { threw = e2 instanceof TypeError; }
        mark(20, threw === true);
      } catch(e) { }

      try {
        var r1 = new URL('/other/path', 'https://example.com/a/b/c').pathname === '/other/path';
        var r2 = new URL('../up', 'https://example.com/a/b/c').pathname === '/a/up';
        var r3 = new URL('//other.com/x', 'https://example.com/a/b').hostname === 'other.com';
        mark(21, r1 && r2 && r3);
      } catch(e) { }

      try {
        // A malformed regex can't be written directly here without risking
        // the outer script's own lexer misreading past an unterminated
        // character class — round-trip it through eval() instead, same as
        // it was root-caused with.
        var regexThrew = false;
        try { eval('/[unclosed/'); } catch(e3) { regexThrew = e3 instanceof SyntaxError; }
        mark(22, regexThrew === true);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting YouTube's bundle: a lone
        // backslash isn't a valid identifier char on its own, so a name
        // written as \\u0275prov (Angular-style minified internal props)
        // needs the \\uXXXX escape decoded into the property name, not
        // read as a stray token followed by a separate "u0275prov" ident.
        var escHolder = {};
        escHolder.\\u0275prov = 'ok';
        mark(23, escHolder.\\u0275prov === 'ok');
      } catch(e) { }

      try {
        // Reproduces a second real gap found bisecting YouTube's bundle:
        // "get"/"set" only introduce an accessor when a real key follows —
        // "{ get: expr }" is a plain property literally named "get", not a
        // getter. The parser used to always consume "get" as the accessor
        // keyword and hand the next token (even a bare ":") to the property-
        // key parser, which silently swallowed it and cascaded into garbage
        // a token at a time — this exact shape appears inside a real
        // Object.defineProperty() call in YouTube's own minified code.
        var ajmStub = { has: function() { return false; } };
        var withGetProp = { set: function(v) { this._v = v; }, get: ajmStub.has('x') ? void 0 : function() { return 42; } };
        mark(24, typeof withGetProp.get === 'function' && withGetProp.get() === 42);
      } catch(e) { }

      try {
        // Same fix must not break the real, common cases: a genuine getter/
        // setter accessor, a shorthand property literally named "get", and
        // a method literally named "get" (no accessor at all).
        var realGetter = { get x() { return 7; } };
        var setTarget = null;
        var realSetter = { set x(v) { setTarget = v; } };
        realSetter.x = 9;
        var get = 5;
        var shorthandGet = { get };
        var methodNamedGet = { get() { return 3; } };
        mark(25, realGetter.x === 7 && setTarget === 9 && shorthandGet.get === 5 && methodNamedGet.get() === 3);
      } catch(e) { }

      try {
        // Reproduces a third real gap found bisecting YouTube's bundle:
        // Interpreter.run() unconditionally reset the global JS-function
        // caller to null in its own finally block instead of restoring
        // whatever caller was registered before it ran. eval() creates a
        // nested Interpreter and calls run() on it — once that nested
        // run() finished, the OUTER script's own interpreter registration
        // was wiped even though the outer script was still executing, so
        // every getter/setter access (and anything else relying on that
        // global registration) after the first eval() call anywhere in the
        // page permanently broke with "No JS interpreter registered".
        var evalRan = false;
        try { eval('1+1'); evalRan = true; } catch(e0) { }
        var afterEval = { get x() { return 11; } };
        var afterEvalValue = afterEval.x;
        mark(26, evalRan === true && afterEvalValue === 11);
      } catch(e) { }

      try {
        // Reproduces a fourth real gap found bisecting YouTube's bundle:
        // "?." is only the optional-chaining operator when NOT followed by
        // a decimal digit (spec: OptionalChainingPunctuator :: ?.
        // [lookahead ∉ DecimalDigit]) — "cond?.9:.75" is the ternary
        // "cond ? .9 : .75", not "cond?.9" (an invalid numeric property
        // access) followed by a stray ":.75". The lexer used to always
        // treat "?" + "." as "?." regardless of what followed.
        var flag = false;
        var ternaryWithLeadingDotLiterals = (flag?.9:.75) * 2;
        var realOptionalChainOnNull = (null)?.missing;
        var obj = { prop: 5 };
        var realOptionalChainOnValue = obj?.prop;
        mark(27, ternaryWithLeadingDotLiterals === 1.5 && realOptionalChainOnNull === undefined && realOptionalChainOnValue === 5);
      } catch(e) { }

      try {
        // Reproduces a fifth real gap found bisecting YouTube's bundle: the
        // "Cannot find global object" error wasn't a Nova bug throwing that
        // text — it's real, hardcoded application-level text FOUR of
        // YouTube's own real scripts throw as their own fallback when their
        // "find the true global object" feature-detection fails. That
        // detection pattern is extremely common across real-world libraries:
        // check globalThis, then window, then self, then global, accepting
        // the first one whose .Math === the real global Math (identity, to
        // rule out a fake/proxy object) — and throw if none qualify. Nova's
        // window was a bare object nothing ever copied built-ins onto, so
        // window.Math !== Math, and self/globalThis didn't exist at all, so
        // every candidate failed and the library's own throw fired for real.
        var trueGlobal = (function(a){
          a = [typeof globalThis=="object"&&globalThis, a, typeof window=="object"&&window, typeof self=="object"&&self];
          for (var b = 0; b < a.length; ++b) { var c = a[b]; if (c && c.Math == Math) return c; }
          throw Error("Cannot find global object");
        })(this);
        mark(28, typeof trueGlobal === 'object' && trueGlobal.Math === Math);
      } catch(e) { }

      try {
        // The fix (mirror every global onto window; alias self/globalThis
        // to it) must hold for window/self/globalThis's OWN identity too,
        // and for other real built-ins beyond Math, not just satisfy the
        // one check above by coincidence.
        mark(29, window.Math === Math && self === window && globalThis === window && window.Array === Array && window.JSON === JSON);
      } catch(e) { }

      try {
        // Reproduces a sixth real gap found bisecting YouTube's bundle: a
        // regex literal's pattern/flags were extracted by naively splitting
        // the raw "/pattern/flags" text on '/' — which breaks the instant
        // the pattern itself contains an escaped slash, since split() has
        // no concept of escaping and cuts there too, leaving a dangling
        // backslash at the end of the "pattern" half. Real-world regexes
        // escape slashes constantly (paths, URLs, and here: matching a full
        // script-or-style element pair with a backreference to the tag
        // name in the closing tag).
        var re = /\\x3c(script|style)([\\s\\S]*?)\\x3e([\\s\\S]*?)\\x3c\\/\\1\\x3e/ig;
        // Escaped slashes here too — a literal closing-script-tag substring
        // in this HTML page's own inline script would end the tag early,
        // same real-world gotcha the \\x3c/\\x3e hex escapes in the pattern
        // above exist to dodge in the first place.
        var matches = '<script>a<\\/script><style>b<\\/style>'.match(re);
        mark(30, matches !== null && matches.length === 2);
      } catch(e) { }

      try {
        // A few more escaped-slash shapes, to make sure the fix is general
        // and not just tuned to the one pattern above.
        var pathRe = /\\/a\\/b\\/c/;
        var noEscapeRe = /^[a-z]+$/i;
        mark(31, pathRe.test('/a/b/c') && noEscapeRe.test('Hello'));
      } catch(e) { }

      try {
        // Reproduces a real YouTube gap: "var ytcfg = {...}; window.ytcfg.set(...)"
        // in consecutive statements — a top-level var must be the SAME
        // storage as the window property, not a one-time copy taken at
        // setup, and vice versa for a direct window.foo assignment.
        var ytcfgLike = { set: function(v) { return v; } };
        var viaWindow = window.ytcfgLike.set(7) === 7;
        window.viaAssignment = { flag: true };
        var viaBareRead = viaAssignment.flag === true;
        mark(32, viaWindow && viaBareRead);
      } catch(e) { }

      try {
        var t = window.performance.timing;
        mark(33, typeof t.navigationStart === 'number' && typeof t.responseStart === 'number' && typeof t.loadEventEnd === 'number');
      } catch(e) { }

      try {
        // Reproduces a real YouTube gap: the lexer checked "is the next
        // char '=' " before checking "are we in a position where / starts
        // a regex", so any regex whose pattern starts with '=' (a real
        // query-string-assignment matcher) got misread as the /= operator
        // and swallowed real code up to some unrelated later '/' as one
        // corrupted string/regex token — corruption that then cascaded
        // through the rest of the file.
        var eqRe = /=[a-z]+/;
        var m = 'x=foo&y=bar'.match(eqRe);
        var regexOk = m !== null && m[0] === '=foo';
        var n = 10;
        n /= 2;
        mark(34, regexOk && n === 5);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting react.dev: 'as' was a hard
        // keyword token (leftover from unimplemented import/export
        // specifier renaming — nothing in the parser even reads that
        // token type), so using it as a plain identifier broke, most
        // commonly in exactly this real shape: a destructuring rename with
        // a default value, from a "polymorphic component" prop pattern.
        var asVar = 5;
        var asObjKey = { as: 'div' }.as === 'div';
        var { as: asRenamed = 'div' } = {};
        mark(35, asVar === 5 && asObjKey && asRenamed === 'div');
      } catch(e) { }

      try {
        // Reproduces a real, high-impact gap: let/const destructuring never
        // TDZ-predeclared its bound names, so destructPattern's leaf case
        // called env.initialize() on a binding that didn't exist yet — a
        // silent no-op. Every let {a} = obj / const [x] = arr bound
        // nothing at all; only var-based destructuring worked.
        let { a: objA, b: objB = 99 } = { a: 1 };
        let [arrX, , arrZ] = [10, 20, 30];
        const { rest0, ...restObj } = { rest0: 1, restA: 2, restB: 3 };
        let { nested: [nestedX, nestedY] } = { nested: [7, 8] };
        mark(36, objA === 1 && objB === 99 && arrX === 10 && arrZ === 30
          && restObj.restA === 2 && restObj.restB === 3
          && nestedX === 7 && nestedY === 8);
      } catch(e) { }

      try {
        // Reproduces a real gap: execForOf cast its loop variable straight
        // to Identifier and read .name unconditionally — a pattern has no
        // .name, so every destructured for-of loop variable, e.g.
        // for (let {a,b} of list), silently bound nothing for the
        // entire loop body, regardless of var/let/const.
        var sumLet = 0;
        for (let { a: fa, b: fb } of [{ a: 1, b: 2 }, { a: 3, b: 4 }]) sumLet += fa + fb;
        var sumVar = 0;
        for (var [fx, fy] of [[1, 2], [3, 4]]) sumVar += fx + fy;
        mark(37, sumLet === 10 && sumVar === 10);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting react.dev: window.matchMedia
        // didn't exist at all, so real dark-mode-detection code, e.g.
        // matchMedia('(prefers-color-scheme: dark)').matches, crashed
        // with "Cannot read properties of undefined".
        var mq = window.matchMedia('(prefers-color-scheme: dark)');
        var lightOk = window.matchMedia('(prefers-color-scheme: light)').matches === true;
        mq.addEventListener('change', function () {});
        mark(38, typeof mq === 'object' && mq.media === '(prefers-color-scheme: dark)'
          && mq.matches === false && lightOk);
      } catch(e) { }

      try {
        // Reproduces a real gap: a native (non-guest-thrown) engine error,
        // e.g. a real TDZ violation, unwound straight past a guest
        // try/catch instead of being caught by it — execTry only ever
        // treated a wrapped guest Error as catchable.
        var threw = false, isRefErr = false;
        try { let selfRef = selfRef + 1; } catch(e) { threw = true; isRefErr = e instanceof ReferenceError; }
        mark(39, threw && isRefErr);
      } catch(e) { }

      try {
        // Reproduces a related gap found while fixing the one above: a
        // native error with no catch handler present skipped the finally
        // block entirely (a guest-thrown throw statement never hit this,
        // since it flows through a different, signal-based path — only a
        // real native error takes the code path that used to throw
        // straight out of the whole try-statement handler before ever
        // reaching the finally logic below it).
        var finallyRan = false, escaped = false;
        try {
          try { let selfRef2 = selfRef2 + 1; } finally { finallyRan = true; }
        } catch(e) { escaped = e instanceof ReferenceError; }
        mark(40, finallyRan && escaped);
      } catch(e) { }

      try {
        // Reproduces a real gap: exec()'s BlockStatement case passed the
        // caller's own env straight through to execBlock() instead of a
        // fresh child scope — every bare {}, if, while, and do-while body
        // (anything reaching a block via plain exec()) wrote its let/const
        // bindings directly into the ENCLOSING scope, so they leaked out
        // and stayed visible after the block ended.
        { let blockLet = 'leaked'; }
        var bareBlockOk = typeof blockLet === 'undefined';

        if (true) { let ifLet = 'leaked'; }
        var ifBlockOk = typeof ifLet === 'undefined';

        while (true) { let whileLet = 'leaked'; break; }
        var whileBlockOk = typeof whileLet === 'undefined';

        do { let doLet = 'leaked'; } while (false);
        var doBlockOk = typeof doLet === 'undefined';

        // A fresh block scope must not break var's real function-scoping —
        // giving every block its own scope could wrongly trap a var
        // inside it unless the global scope is correctly recognized as the
        // var-hoisting boundary to walk up to.
        { var hoistedVar = 'hoisted'; }
        var varHoistOk = hoistedVar === 'hoisted';

        mark(41, bareBlockOk && ifBlockOk && whileBlockOk && doBlockOk && varHoistOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting svelte.dev: real SvelteKit
        // bootstrap code does new URL(".", location).pathname, coercing
        // location to a string as the URL constructor's base argument.
        // The generic toString() coercion had no case for a Location object
        // (no __type_override tag at all) or a URL object (tagged 'url' but
        // unhandled), so both fell through to the generic "[object Object]"
        // string, which a real URL constructor then rejects as invalid.
        var baseFromLocation = new URL('.', location).href === location.href.replace(/[^/]*$/, '');
        var otherUrl = new URL('https://example.com/a/b/');
        var baseFromUrlObj = new URL('c', otherUrl).href === 'https://example.com/a/b/c';
        var stringOk = String(location) === location.href;
        var templateOk = ('' + location) === location.href;
        mark(42, baseFromLocation && baseFromUrlObj && stringOk && templateOk);
      } catch(e) { }

      try {
        // Reproduces a real, high-impact gap: execForOf/execForIn reused one
        // shared binding across every iteration and updated it via a plain
        // assignment — which always throws "Assignment to constant
        // variable" for a const binding, so for (const x of arr) and
        // for (const k in obj), two of the most common for-loop shapes in
        // real code, threw on their very first iteration. Fixed by giving
        // let/const a real fresh per-iteration lexical binding, which also
        // fixes closures capturing the wrong (last) value under let.
        var constOfOk = false, constInOk = false;
        for (const x of [1, 2, 3]) { constOfOk = x === 1 || constOfOk; }
        for (const k in { a: 1 }) { constInOk = k === 'a'; }
        var closures = [];
        for (let x of [1, 2, 3]) closures.push(function () { return x; });
        var closureVals = closures.map(function (f) { return f(); });
        var closureOk = closureVals[0] === 1 && closureVals[1] === 2 && closureVals[2] === 3;
        mark(43, constOfOk && constInOk && closureOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting tailwindcss.com: "for
        // await" failed to parse at all ("Expected LParen, got Await").
        var awaitPlain = [], awaitPromise = [];
        async function drainPlain(t) { for await (const x of t) awaitPlain.push(x); }
        async function drainPromise(t) { for await (const x of t) awaitPromise.push(x); }
        drainPlain([1, 2, 3]);
        drainPromise([Promise.resolve('a'), Promise.resolve('b')]);
        mark(44, JSON.stringify(awaitPlain) === '[1,2,3]' && JSON.stringify(awaitPromise) === '["a","b"]');
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting figma.com: a destructuring
        // pattern's non-identifier-string-key branch (needed to rename a
        // property like "aria-hidden" to a valid binding name) never
        // checked for a trailing default value, so any such property WITH
        // a default ("aria-hidden":h=!0) failed to parse at all.
        function pick(t) {
          let { "aria-hidden": h = true, size: n = 24 } = t;
          return [h, n];
        }
        var picked1 = pick({ size: 10 });
        var picked2 = pick({ "aria-hidden": false });
        mark(45, picked1[0] === true && picked1[1] === 10 && picked2[0] === false && picked2[1] === 24);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting tailwindcss.com/figma.com: a
        // regex literal as the first statement of an if/while/for/switch
        // body was always lexed as division (no left operand exists there,
        // so real division is never actually valid in that exact position),
        // garbling every token after it until the parser hit unrelated
        // garbage deep in the file.
        var out = null;
        if (true) /^a/.test('abc') && (out = 'if-ok');
        var out2 = null;
        for (let e in { onClick: 1 }) /^(on)(?:Click)?$/.test(e) && (out2 = e);
        // Division right after the header close must remain division when
        // an operand comes between the ")" and the "/" — unaffected by the fix.
        var divOk = false;
        if (true) { let a = 10, b = 2; divOk = a / b === 5; }
        mark(46, out === 'if-ok' && out2 === 'onClick' && divOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting figma.com/tailwindcss.com:
        // parseObjectPattern's key dispatch only accepted a real Identifier
        // token as a plain key — a reserved word like "class" is lexed as
        // its own keyword token type, so {class: r} fell into the general-
        // expression fallback, which parsed "class" as the start of a
        // class expression and then choked expecting "{" instead of ":".
        var srcObj = { class: 'foo', get: 1, as: 2 };
        var { class: rc, get: rg, as: ra } = srcObj;
        mark(47, rc === 'foo' && rg === 1 && ra === 2);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting angular.dev: real bootstrap
        // code (a dark-mode-detection snippet) reads this.document at the
        // top of an inline script. The root global environment never had a
        // "this" binding at all, so top-level "this" evaluated to undefined
        // instead of the real global object — and every plain (non-strict)
        // function call's this-fallback, which reads that same binding,
        // inherited the same undefined instead of window.
        var thisIsWindow = this === window;
        function plainCall() { return this; }
        var plainCallOk = plainCall() === window;
        mark(48, thisIsWindow && plainCallOk);
      } catch(e) { }

      try {
        // Reproduces a real gap: lookaheadStrictDirective() checked the
        // CURRENT token for a "use strict" string literal, but every call
        // site invokes it with the function body's opening "{" still
        // current (right before parseBlock() consumes it) — so it always
        // saw "{", never a string, and "use strict" was silently ignored
        // everywhere. A program-level "use strict" (the far more common
        // real-world shape, e.g. all Babel-transpiled output) was never
        // even checked at all.
        function strictFn() { 'use strict'; return this; }
        var funcLevelOk = strictFn() === undefined;
        // eval() re-parses its argument as its own independent program, so
        // this exercises program-level "use strict" detection (parse()'s
        // own directive check) in isolation, without making the rest of
        // this shared harness script itself strict.
        var programLevelOk = eval("'use strict'; function inner(){ return this; } inner() === undefined;");
        mark(49, funcLevelOk && programLevelOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found bisecting python.org (jQuery) and
        // cloudflare.com (a beacon script): Array.prototype was never
        // exposed as a real object at all — real code reads it directly
        // (jQuery's own "j = Array.prototype.push" top-of-file idiom, and
        // the common array-like-borrowing pattern
        // "Array.prototype.slice.call(arguments)"). A separate, dormant,
        // never-reachable copy of the array methods existed here too, with
        // its own bug (wrong native-function calling convention) that only
        // surfaced once Array.prototype actually became reachable — fixed
        // by reusing the same, already-correct methods real array
        // instances get instead of maintaining two implementations.
        var protoIsObject = typeof Array.prototype === 'object' && Array.prototype !== null;
        var protoPushWorks = (function () {
          var arr = [1];
          Array.prototype.push.call(arr, 2, 3);
          return JSON.stringify(arr) === '[1,2,3]';
        })();
        var protoSliceWorks = Array.prototype.slice.call([1, 2, 3], 1).join(',') === '2,3';
        var findLastOk = [1, 2, 3, 4].findLast(function (x) { return x % 2 === 0; }) === 4
          && [1, 2, 3, 4].findLastIndex(function (x) { return x % 2 === 0; }) === 3;
        mark(50, protoIsObject && protoPushWorks && protoSliceWorks && findLastOk);
      } catch(e) { }

      try {
        // Reproduces a real, high-impact gap found continuing the jQuery
        // investigation: "new"'s callee is a MemberExpression grammar
        // production that can chain .prop/[expr] accesses but must NOT
        // swallow a following (...) call — that argument list belongs to
        // "new" itself. The shared Pratt precedence table groups Dot/
        // LBracket/LParen at one level, so the old parseExpression(18)
        // callee-parse couldn't consume ".Init" at all: "new p.Init(a,b)"
        // silently became "(new p()).Init(a,b)" — construct bare p with
        // NO arguments, then call the unrelated .Init as a plain method.
        // jQuery's own real core factory (p=function(a,b){return new
        // p.fn.init(a,b);}) hit exactly this shape on every call, and
        // since the misparse means calling p ends up constructing p AGAIN,
        // it recursed into itself forever ("Maximum call stack exceeded").
        var deep = { b: { c: function (x) { this.x = x; } } };
        var deepOk = new deep.b.c(5).x === 5;
        var bracketOk = new deep['b'].c(6).x === 6;
        var jQueryLike = function (a, b) { return new jQueryLike.fn.init(a, b); };
        jQueryLike.fn = jQueryLike.prototype = { init: function (a, b) { this.a = a; this.b = b; return this; } };
        jQueryLike.fn.init.prototype = jQueryLike.fn;
        var factoryResult = jQueryLike('x', 'y');
        var factoryOk = factoryResult.a === 'x' && factoryResult.b === 'y' && factoryResult instanceof jQueryLike;
        mark(51, deepOk && bracketOk && factoryOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found completing the jQuery investigation:
        // parseStatement() returns null for a bare ";" (empty statement)
        // rather than a dedicated AST node, and every single-statement
        // if/loop body reads it via a non-null assertion. exec()'s own
        // dispatch, and a separate let/const TDZ-hoisting pre-scan that
        // recurses into an if's branches, both read ".type" straight off
        // that value — a real "for(d in a);" (jQuery 1.8.2's own
        // isPlainObject, leaning on an empty for-in body to leave its
        // variable set to the last enumerable key) crashed the whole
        // engine on "Cannot read properties of null (reading 'type')".
        var forInVar;
        for (forInVar in { a: 1, b: 2, c: 3 });
        var forInOk = forInVar === 'c';

        var ifRan = false;
        if (true);
        if (false); else ifRan = true;

        var i = 0;
        for (; i < 3; i++);
        var forOk = i === 3;

        mark(52, forInOk && ifRan && forOk);
      } catch(e) { }

      try {
        // Reproduces a real, foundational gap found completing the jQuery
        // investigation: assigning a numeric array index never grew
        // .length at all, only real array methods (push, splice, ...) did.
        // jQuery's own internal Array.prototype.map alternative uses the
        // classic "g[g.length] = value" idiom to append without calling
        // .push() — with .length silently stuck at 0, every caller that
        // read it back afterward (a plain for-loop, JSON.stringify, a
        // spread) saw the array as empty even though the values were
        // really stored at their indices.
        var a = [];
        a[a.length] = 'x';
        a[a.length] = 'y';
        var pushIdiomOk = a.length === 2 && a[0] === 'x' && a[1] === 'y';

        var b = [];
        b[3] = 'z';
        var sparseOk = b.length === 4 && b[3] === 'z';

        var c = [];
        c[0] = 1;
        c[0] += 1;
        var compoundOk = c[0] === 2 && c.length === 1;

        var d = [];
        d[0] = 0;
        d[0]++;
        var incrementOk = d[0] === 1 && d.length === 1;

        var f = [1, 2, 3];
        f[1] = 'x';
        var withinBoundsOk = f.length === 3;

        mark(53, pushIdiomOk && sparseOk && compoundOk && incrementOk && withinBoundsOk);
      } catch(e) { }

      try {
        // Reproduces a real, high-impact parser gap found completing the
        // jQuery investigation: a ternary's alternate branch was parsed at
        // the ternary's own precedence instead of AssignmentExpression
        // precedence (real ECMAScript grammar: both branches of "?:" are
        // AssignmentExpressions), stopping one level too early right after
        // a bare identifier. "j ? x=5 : x=6" silently mis-parsed as
        // "(j ? (x=5) : x) = 6" — a ConditionalExpression used as an
        // assignment target, not even valid in real JS. Real jQuery's own
        // per-element data-cache ID assignment is written exactly this way
        // ("l||(j?a[h]=l=X:l=h)"), so this alone broke .on()/.trigger()
        // and anything else built on jQuery's internal data() cache.
        var x1;
        true ? x1 = 1 : x1 = 2;
        var bothBranchesOk = x1 === 1;

        var x2;
        false ? x2 = 1 : x2 = 2;
        var alternateOk = x2 === 2;

        var a, b;
        true ? a = b = 5 : a = b = 6;
        var chainedOk = a === 5 && b === 5;

        // Nested ternary chaining (right-associative) must still work.
        var classify = function (n) { return n < 0 ? 'neg' : n === 0 ? 'zero' : 'pos'; };
        var nestedOk = classify(-1) === 'neg' && classify(0) === 'zero' && classify(1) === 'pos';

        // A comma right after a ternary must stay a separate sequence
        // element, not get swallowed into the alternate branch.
        var c, d;
        c = true ? 1 : 2, d = 99;
        var commaBoundaryOk = c === 1 && d === 99;

        mark(54, bothBranchesOk && alternateOk && chainedOk && nestedOk && commaBoundaryOk);
      } catch(e) { }

      try {
        // Array.prototype.slice clamped a negative index straight to 0
        // instead of resolving it relative to the array's length, so
        // slice(-1) silently degraded into slice(0, length) — the whole
        // array. Real jQuery's .last() is written as this.slice(-1), so
        // every .last() call returned the entire, unfiltered collection.
        var arr = ['a', 'b', 'c', 'd', 'e'];
        var lastOne = arr.slice(-1).join(',') === 'e';
        var lastTwo = arr.slice(-2).join(',') === 'd,e';
        var negBoth = arr.slice(-3, -1).join(',') === 'c,d';
        var mixed = arr.slice(1, -1).join(',') === 'b,c,d';
        var beyondClampsToStart = arr.slice(-100).join(',') === 'a,b,c,d,e';
        mark(55, lastOne && lastTwo && negBoth && mixed && beyondClampsToStart);
      } catch(e) { }

      try {
        // The HTML tokenizer's attribute finalizer ran unconditionally one
        // extra time whenever a tag closed (on top of the per-attribute
        // calls made while tokenizing), to flush an attribute still being
        // built. With attrName already reset to '' by then, that extra
        // call added a bogus empty-string-keyed attribute to every single
        // parsed tag, whether or not it had real attributes.
        var el = document.getElementById('lab');
        el.innerHTML = '<span>plain</span>';
        var noBogusOnPlainTag = el.children[0].getAttribute('') === null;

        el.innerHTML = '<span class="a" id="b">attrs</span>';
        var realAttrsIntact = el.children[0].getAttribute('class') === 'a' && el.children[0].getAttribute('id') === 'b';
        var stillNoBogusAttr = el.children[0].getAttribute('') === null;

        mark(56, noBogusOnPlainTag && realAttrsIntact && stillNoBogusAttr);
      } catch(e) { }
    `, 57),
  },
  {
    name: 'class-features',
    labels: [
      'static field with initializer',
      'instance field with initializer referencing this',
      'instanceof works for a user-defined class and its subclass',
      'setter declared on a class works through assignment',
      'compound assignment (+=) invokes an inherited setter',
      'increment (++) invokes a getter/setter pair',
      'computed method name evaluates the key expression',
      'private field is stored and readable via a method',
      'private method is callable from an instance method',
      'custom toString() is used by template-literal interpolation',
      'custom valueOf()/Symbol.toPrimitive is used by + and unary +',
      '3-level super chain resolves each level correctly (no infinite recursion)',
      'independent class hierarchies in the same scope do not share super',
      'static super call resolves against the parent class, not its prototype',
      'getter/setter pair inherited two levels down',
      'a class method literally named "get"/"set" (real GitHub code) is not misread as an accessor, and a real getter with a computed key still works',
      'a compound-assignment concise arrow body as an object property value does not swallow the following property (real GitHub code), and &&=/||= work correctly',
      'Object.prototype.toString.call(x) returns the real [object Tag] format, respecting a class\'s own computed Symbol.toStringTag getter',
    ],
    html: harnessHtml(`
      try {
        class Counter { static count = 5; }
        mark(0, Counter.count === 5);
      } catch(e) { }

      try {
        class WithFields { x = 10; y = this.x * 2; }
        var wf = new WithFields();
        mark(1, wf.x === 10 && wf.y === 20);
      } catch(e) { }

      try {
        class Animal { constructor(n) { this.name = n; } }
        class Dog extends Animal {}
        var d = new Dog('Rex');
        mark(2, d instanceof Animal && d instanceof Dog);
      } catch(e) { }

      try {
        class Box {
          constructor(v) { this._v = v; }
          get value() { return this._v; }
          set value(v) { this._v = v; }
        }
        var b = new Box(1);
        b.value = 42;
        mark(3, b.value === 42);
      } catch(e) { }

      try {
        class Acc {
          get n() { return this._n || 0; }
          set n(v) { this._n = v; }
        }
        var a = new Acc();
        a.n = 10;
        a.n += 5;
        mark(4, a.n === 15);
      } catch(e) { }

      try {
        class Acc2 {
          get n() { return this._n || 0; }
          set n(v) { this._n = v; }
        }
        var a2 = new Acc2();
        a2.n = 10;
        a2.n++;
        mark(5, a2.n === 11);
      } catch(e) { }

      try {
        var methodName = 'dynamicMethod';
        class Dyn { [methodName]() { return 'called'; } }
        mark(6, new Dyn().dynamicMethod() === 'called');
      } catch(e) { }

      try {
        class PrivateBox {
          #value;
          constructor(v) { this.#value = v; }
          getValue() { return this.#value; }
        }
        mark(7, new PrivateBox(99).getValue() === 99);
      } catch(e) { }

      try {
        class PrivateCounter {
          #count = 0;
          #increment() { this.#count++; return this.#count; }
          tick() { return this.#increment(); }
        }
        var pc = new PrivateCounter();
        mark(8, pc.tick() === 1 && pc.tick() === 2);
      } catch(e) { }

      try {
        class Money {
          constructor(amt) { this.amt = amt; }
          toString() { return '$' + this.amt; }
        }
        var m = new Money(5);
        mark(9, \`Price: \${m}\` === 'Price: $5');
      } catch(e) { }

      try {
        class Temp {
          constructor(c) { this.c = c; }
          [Symbol.toPrimitive](hint) {
            if (hint === 'number') return this.c;
            return 'Temp(' + this.c + ')';
          }
        }
        var t = new Temp(20);
        mark(10, (+t === 20) && (t + '' === 'Temp(20)'));
      } catch(e) { }

      try {
        class A { greet() { return 'A'; } }
        class B extends A { greet() { return super.greet() + 'B'; } }
        class C extends B { greet() { return super.greet() + 'C'; } }
        mark(11, new C().greet() === 'ABC');
      } catch(e) { }

      try {
        class X1 { m() { return 'X1'; } }
        class Y1 extends X1 { m() { return super.m() + 'Y1'; } }
        class X2 { m() { return 'X2'; } }
        class Y2 extends X2 { m() { return super.m() + 'Y2'; } }
        mark(12, new Y1().m() === 'X1Y1' && new Y2().m() === 'X2Y2');
      } catch(e) { }

      try {
        class Base { static create() { return 'base'; } }
        class Derived extends Base { static create() { return super.create() + '-derived'; } }
        mark(13, Derived.create() === 'base-derived');
      } catch(e) { }

      try {
        class GA { get val() { return this._v || 0; } set val(v) { this._v = v; } }
        class GB extends GA {}
        class GC extends GB {}
        var gc = new GC();
        gc.val = 77;
        mark(14, gc.val === 77);
      } catch(e) { }

      try {
        // Reproduces a real GitHub gap: parseClassBody() unconditionally
        // treated get/set as accessor introducers, without the same
        // startsAccessorName() lookahead already applied to object literals
        // — so a class method literally named "get" (found in a real LRU
        // cache implementation) cascaded into nonsense a token at a time.
        class LRU {
          #e;
          constructor() { this.#e = new Map(); }
          get(k) { return this.#e.get(k); }
          set(k, v) { this.#e.set(k, v); return this; }
          get size() { return this.#e.size; }
          get [Symbol.toStringTag]() { return 'LRU'; }
        }
        var lru = new LRU();
        lru.set('a', 1);
        mark(15, lru.get('a') === 1 && lru.size === 1 && lru[Symbol.toStringTag] === 'LRU');
      } catch(e) { }

      try {
        // Reproduces a real GitHub gap: an assignment's right-hand side
        // parsed at (precedence - 1) instead of (precedence), which happens
        // to equal Comma's own precedence — so a compound-assignment
        // concise arrow body used as an object property value swallowed
        // the following comma-separated property along with it (real code:
        // "{ ready: () => n ||= new Promise(...), firstInteraction: ... }").
        var n = null;
        var obj = { ready: () => n ||= 5, other: () => 1 };
        var sameShapeOk = obj.ready() === 5 && obj.other() === 1;
        var m = 0;
        m &&= 99;
        var andAssignOk = m === 0;
        var p = 0;
        p ||= 7;
        var orAssignOk = p === 7;
        mark(16, sameShapeOk && andAssignOk && orAssignOk);
      } catch(e) { }

      try {
        // Reproduces a real gap found while verifying the class-body
        // get/set fix: Object.prototype had no real .prototype object at
        // all, so the classic type-tag idiom Object.prototype.toString.call(x)
        // was simply undefined instead of a working method — and even a
        // direct x.toString() call ignored a class's own Symbol.toStringTag.
        var plainOk = Object.prototype.toString.call({}) === '[object Object]';
        var arrOk = Object.prototype.toString.call([1,2]) === '[object Array]';
        class Tagged { get [Symbol.toStringTag]() { return 'MyTag'; } }
        var t = new Tagged();
        var tagOk = Object.prototype.toString.call(t) === '[object MyTag]' && t.toString() === '[object MyTag]';
        mark(17, plainOk && arrOk && tagOk);
      } catch(e) { }
    `, 18),
  },
  {
    name: 'prototype-and-function-methods',
    labels: [
      'for-in over an array visits only enumerable indices, not built-in methods',
      'for-in over a class instance visits only own fields, not methods',
      'classic function-prototype inheritance: inherited property, inherited method, instanceof',
      'Object.create-based subclassing with Parent.call(this, ...) forwarding',
      'Function.prototype.call invokes with the given this and args',
      'Function.prototype.apply invokes with the given this and an args array',
      'Function.prototype.bind presets this/args; new on a bound function still constructs the target',
      'Object.prototype.hasOwnProperty distinguishes own vs. inherited properties',
      'Object.getPrototypeOf returns the constructor\'s prototype object',
      'template literals decode escape sequences; String.raw sees the true unescaped text',
    ],
    html: harnessHtml(`
      try {
        var seen = [];
        for (var k in [10, 20, 30]) seen.push(k);
        mark(0, seen.join(',') === '0,1,2');
      } catch(e) { }

      try {
        class Pt { constructor(x, y) { this.x = x; this.y = y; } dist() { return this.x + this.y; } }
        var seen2 = [];
        for (var k2 in new Pt(1, 2)) seen2.push(k2);
        mark(1, seen2.join(',') === 'x,y');
      } catch(e) { }

      try {
        function Animal(name) { this.name = name; }
        Animal.prototype.speak = function() { return this.name + ' makes a sound'; };
        function Dog(name) { Animal.call(this, name); }
        Dog.prototype = Object.create(Animal.prototype);
        Dog.prototype.bark = function() { return this.name + ' barks'; };
        var d = new Dog('Rex');
        mark(2, d.speak() === 'Rex makes a sound' && d.bark() === 'Rex barks' && d instanceof Animal && d instanceof Dog);
      } catch(e) { }

      try {
        function Base(v) { this.v = v; }
        function Sub(v, w) { Base.call(this, v); this.w = w; }
        Sub.prototype = Object.create(Base.prototype);
        var s = new Sub(1, 2);
        mark(3, s.v === 1 && s.w === 2 && s instanceof Base);
      } catch(e) { }

      try {
        function greet(greeting) { return greeting + ', ' + this.name; }
        mark(4, greet.call({ name: 'Ann' }, 'Hi') === 'Hi, Ann');
      } catch(e) { }

      try {
        function sum3(a, b, c) { return this.label + ':' + (a + b + c); }
        mark(5, sum3.apply({ label: 'S' }, [1, 2, 3]) === 'S:6');
      } catch(e) { }

      try {
        function add(a, b) { return this.base + a + b; }
        var bound = add.bind({ base: 100 }, 1);
        function Greeter(g) { this.g = g; }
        var Bound = Greeter.bind(null, 'Hi');
        var g = new Bound();
        mark(6, bound(2) === 103 && g.g === 'Hi');
      } catch(e) { }

      try {
        function F() {}
        F.prototype.inherited = 1;
        var f = new F();
        f.own = 2;
        mark(7, f.hasOwnProperty('own') === true && f.hasOwnProperty('inherited') === false);
      } catch(e) { }

      try {
        function G() {}
        var g2 = new G();
        mark(8, Object.getPrototypeOf(g2) === G.prototype);
      } catch(e) { }

      try {
        var tmpl = \`a\\nb\`;
        var rawTag = String.raw\`a\\nb\`;
        // tmpl's \\n is a decoded (cooked) newline: 3 chars, real 0x0A in the middle.
        // rawTag's \\n stays as the literal 2-char escape sequence: 4 chars, a literal
        // backslash (charCode 92) at index 1. Checked by charCode, not a hand-escaped
        // string literal, since this file's own template literal already needs one
        // level of backslash-doubling and a second comparison string would need two.
        mark(9, tmpl.length === 3 && tmpl.charCodeAt(1) === 10 &&
          rawTag.length === 4 && rawTag.charCodeAt(1) === 92 && rawTag.charCodeAt(2) === 110);
      } catch(e) { }
    `, 10),
  },
  {
    name: 'static-blocks-array-from-new-target',
    labels: [
      'static block runs once with this bound to the class',
      'a class can reference its own name inside a static block/field initializer',
      'Array.from converts a string to a char array',
      'Array.from converts a plain array-like object',
      'Array.from converts a Set and a Map',
      'Array.from drains a generator',
      'new.target is the constructor when called with new',
      'new.target is undefined when the same function is called without new',
      'new.target stays the most-derived class through a super() call',
    ],
    html: harnessHtml(`
      try {
        class C {
          static sVal;
          static { this.sVal = 99; }
        }
        mark(0, C.sVal === 99);
      } catch(e) { }

      try {
        class Singleton {
          static instance = new Singleton();
          static { Singleton.ready = true; }
        }
        mark(1, Singleton.instance instanceof Singleton && Singleton.ready === true);
      } catch(e) { }

      try {
        mark(2, JSON.stringify(Array.from('abc')) === '["a","b","c"]');
      } catch(e) { }

      try {
        mark(3, JSON.stringify(Array.from({length: 3, 0: 'x', 1: 'y', 2: 'z'})) === '["x","y","z"]');
      } catch(e) { }

      try {
        var fromSet = Array.from(new Set([1, 2, 3]));
        var fromMap = Array.from(new Map([['a', 1], ['b', 2]]));
        mark(4, JSON.stringify(fromSet) === '[1,2,3]' && JSON.stringify(fromMap) === '[["a",1],["b",2]]');
      } catch(e) { }

      try {
        function* gen() { yield 1; yield 2; yield 3; }
        mark(5, JSON.stringify(Array.from(gen())) === '[1,2,3]');
      } catch(e) { }

      try {
        var sawNewTarget;
        function Foo() { sawNewTarget = new.target; }
        var inst = new Foo();
        mark(6, sawNewTarget === Foo);
      } catch(e) { }

      try {
        var sawPlainCallTarget = 'not set';
        function Bar() { sawPlainCallTarget = new.target; }
        Bar();
        mark(7, sawPlainCallTarget === undefined);
      } catch(e) { }

      try {
        var seenTarget = null;
        class Base { constructor() { seenTarget = new.target; } }
        class Derived extends Base {}
        new Derived();
        mark(8, seenTarget === Derived);
      } catch(e) { }
    `, 9),
  },
];

test('JS/DOM API sweep against real fixtures', async () => {
  test.setTimeout(120_000);

  const server = http.createServer((req, res) => {
    const m = /^\/(.+)$/.exec(req.url ?? '/');
    const name = m?.[1];
    const c = CASES.find((c) => c.name === name);
    if (c) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(c.html);
      return;
    }
    res.writeHead(404).end('not found');
  });
  let port = 0;
  await new Promise<void>((resolve) => server.listen(0, () => {
    port = (server.address() as { port: number }).port;
    resolve();
  }));

  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  const failures: string[] = [];

  for (const c of CASES) {
    await page.locator('.address-input').fill(`http://localhost:${port}/${c.name}`);
    await page.locator('.address-input').press('Enter');
    await page.waitForTimeout(1500);

    console.log(`\n=== ${c.name} ===`);
    for (let i = 0; i < c.labels.length; i++) {
      const col = i % 10, row = Math.floor(i / 10);
      const x = 10 + col * 25 + 10, y = 10 + row * 25 + 10;
      const actual = await pixelAt(page, x, y);
      const ok = actual.toLowerCase() === GREEN;
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${c.labels[i]} — got ${actual}`);
      if (!ok) failures.push(`${c.name}[${i}]: ${c.labels[i]} (got ${actual})`);
    }
  }

  console.log('\n=== SUMMARY ===');
  if (failures.length === 0) {
    console.log('All checks passed.');
  } else {
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(' - ' + f);
  }

  await app.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
