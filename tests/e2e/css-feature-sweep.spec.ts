import { test, _electron as electron } from '@playwright/test';
import type { Page } from '@playwright/test';
import http from 'node:http';

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

const CASES: Array<{ name: string; html: string; checks: Array<{ x: number; y: number; expect: string; label: string }> }> = [
  {
    name: 'custom-properties',
    html: `<!doctype html><html><body style="margin:0;">
      <style>
        :root { --box-color: #ff0000; --fallback-test: var(--undefined-var, #00ff00); }
        .a { width:100px;height:60px;background:var(--box-color); }
        .b { width:100px;height:60px;background:var(--fallback-test); margin-top:5px; }
        .c { width:100px;height:60px;background:var(--box-color, #0000ff); margin-top:5px; }
      </style>
      <div class="a"></div><div class="b"></div><div class="c"></div>
    </body></html>`,
    checks: [
      { x: 50, y: 30, expect: '#ff0000', label: 'custom property direct value' },
      { x: 50, y: 95, expect: '#00ff00', label: 'var() fallback used when undefined' },
      { x: 50, y: 160, expect: '#ff0000', label: 'var() with fallback ignored when defined' },
    ],
  },
  {
    name: 'calc-clamp',
    html: `<!doctype html><html><body style="margin:0;">
      <div style="width:calc(50px + 50px);height:60px;background:#f00;"></div>
      <div style="width:clamp(50px, 200px, 300px);height:60px;background:#0f0;margin-top:5px;"></div>
      <div style="width:min(300px, 80px);height:60px;background:#00f;margin-top:5px;"></div>
    </body></html>`,
    checks: [
      { x: 95, y: 30, expect: '#ff0000', label: 'calc(50px+50px) width=100 — inside box' },
      { x: 150, y: 30, expect: '#ffffff', label: 'calc(50px+50px) width=100 — clearly outside' },
      { x: 199, y: 95, expect: '#00ff00', label: 'clamp(min,val,max) picks 200px — inside' },
      { x: 75, y: 160, expect: '#0000ff', label: 'min(300px,80px)=80px — inside' },
      { x: 150, y: 160, expect: '#ffffff', label: 'min(300px,80px)=80px — clearly outside' },
    ],
  },
  {
    name: 'grid-template-areas',
    html: `<!doctype html><html><body style="margin:0;">
      <div style="display:grid;grid-template-columns:100px 100px;grid-template-rows:50px 50px;grid-template-areas:'hd hd' 'sb ct';width:200px;height:100px;">
        <div style="grid-area:hd;background:#f00;"></div>
        <div style="grid-area:sb;background:#0f0;"></div>
        <div style="grid-area:ct;background:#00f;"></div>
      </div>
    </body></html>`,
    checks: [
      { x: 100, y: 25, expect: '#ff0000', label: 'grid-area hd spans both columns row1' },
      { x: 50, y: 75, expect: '#00ff00', label: 'grid-area sb in row2 col1' },
      { x: 150, y: 75, expect: '#0000ff', label: 'grid-area ct in row2 col2' },
    ],
  },
  {
    name: 'selectors-has-is-where',
    html: `<!doctype html><html><body style="margin:0;">
      <style>
        div { background:#fff; width:100px; height:40px; }
        div:has(> span.mark) { background:#f00; }
        .grp1, .grp2 { background: #ccc; }
        :is(.grp1, .grp2).active { background:#0f0; }
        :where(.w1, .w2) { color: red; }
      </style>
      <div id="d1"><span class="mark">x</span></div>
      <div id="d2">no mark</div>
      <div class="grp1 active" style="margin-top:5px;"></div>
    </body></html>`,
    checks: [
      { x: 50, y: 20, expect: '#ff0000', label: ':has(> span.mark) matched (d1)' },
      { x: 50, y: 60, expect: '#ffffff', label: ':has() correctly did not match d2' },
      { x: 50, y: 125, expect: '#00ff00', label: ':is(.grp1,.grp2).active matched' },
    ],
  },
  {
    name: 'nesting',
    html: `<!doctype html><html><body style="margin:0;">
      <style>
        .parent {
          width: 100px; height: 40px; background: #fff;
          & .child { background: #f00; width: 100px; height: 40px; }
          &.active { background: #00f; }
        }
      </style>
      <div class="parent"><div class="child"></div></div>
      <div class="parent active" style="margin-top:5px;"></div>
    </body></html>`,
    checks: [
      { x: 50, y: 20, expect: '#ff0000', label: 'nested & .child selector matched' },
      { x: 50, y: 65, expect: '#0000ff', label: 'nested &.active selector matched' },
    ],
  },
  {
    name: 'cascade-layers',
    html: `<!doctype html><html><body style="margin:0;">
      <style>
        @layer base, override;
        @layer base { .box { background: #f00; width:100px;height:60px; } }
        @layer override { .box { background: #00f; } }
      </style>
      <div class="box"></div>
    </body></html>`,
    checks: [
      { x: 50, y: 30, expect: '#0000ff', label: '@layer override beats @layer base regardless of source order' },
    ],
  },
  {
    name: 'logical-properties',
    html: `<!doctype html><html><body style="margin:0;">
      <div style="margin-inline-start:20px;width:100px;height:40px;background:#f00;"></div>
      <div style="padding-block:10px;width:100px;background:#0f0;margin-top:5px;">
        <div style="width:100%;height:20px;background:#00f;"></div>
      </div>
    </body></html>`,
    checks: [
      { x: 19, y: 20, expect: '#ffffff', label: 'margin-inline-start pushes box right (outside)' },
      { x: 70, y: 20, expect: '#ff0000', label: 'margin-inline-start pushes box right (inside)' },
      { x: 50, y: 55, expect: '#00ff00', label: 'padding-block top padding visible' },
    ],
  },
  {
    name: 'aspect-ratio',
    html: `<!doctype html><html><body style="margin:0;">
      <div style="width:100px;aspect-ratio:2/1;background:#f00;"></div>
    </body></html>`,
    checks: [
      { x: 50, y: 45, expect: '#ff0000', label: 'aspect-ratio 2/1 with width:100 gives height:50 — inside' },
      { x: 50, y: 90, expect: '#ffffff', label: 'aspect-ratio 2/1 with width:100 gives height:50 — clearly outside' },
    ],
  },
];

test('CSS feature sweep against real fixtures', async () => {
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
    await page.waitForTimeout(1200);

    console.log(`\n=== ${c.name} ===`);
    for (const check of c.checks) {
      const actual = await pixelAt(page, check.x, check.y);
      const ok = actual.toLowerCase() === check.expect.toLowerCase();
      console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${check.label} — expected ${check.expect}, got ${actual}`);
      if (!ok) failures.push(`${c.name}: ${check.label} (expected ${check.expect}, got ${actual})`);
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
