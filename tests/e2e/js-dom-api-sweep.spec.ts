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
    `, 15),
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
