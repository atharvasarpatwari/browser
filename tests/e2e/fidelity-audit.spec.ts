import { test, expect, _electron as electron, type Page } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// Fidelity Audit — Track A
//
// Renders a set of crafted fixture pages through the Nova engine pipeline
// (loopback HTTP so no external network is needed) and captures, per fixture:
//   canvas pixel stats (non-white ratio, color clusters), load time, window vs
//   canvas size, console errors, page errors, and a screenshot.
//
// Output: fidelity-report/report.json + report.md + shots/<name>.png
// ---------------------------------------------------------------------------

const OUT_DIR = path.resolve(process.cwd(), 'fidelity-report');
const SHOT_DIR = path.join(OUT_DIR, 'shots');

// --- PNG builder (deterministic checkerboard; no binary committed) ---------
const CRC_TABLE: number[] = (() => {
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = rowStart + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const checkerPng = makePng(16, 16, (x, y) => {
  if (x < 8 && y < 8) return [255, 0, 0, 255];
  if (x >= 8 && y < 8) return [0, 170, 0, 255];
  if (x < 8 && y >= 8) return [0, 0, 255, 255];
  return [255, 220, 0, 255];
});

// --- Fixtures --------------------------------------------------------------
interface Fixture {
  name: string;
  html: string;
  settleMs: number;
  captureTwoFrames?: boolean;
}

const FIXTURES: Fixture[] = [
  {
    name: 'blank',
    html: `<!doctype html><html><head><title>Blank</title></head><body style="background:#fff;margin:0;"></body></html>`,
    settleMs: 500,
  },
  {
    name: 'basic',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Basic</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;color:#111;">
<h1>Nova Fidelity — Basic</h1>
<p>This is a paragraph with <b>bold</b>, <i>italic</i>, and <a href="#">a link</a>.</p>
<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>
<div style="background:#ff0;padding:8px;border:2px solid #333;">Colored box</div>
<table border="1"><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'images',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Images</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Image fixture</h2>
<img src="__BASE__/img/checker.png" width="120" height="80" style="border:1px solid #000;">
<div style="width:200px;height:100px;background-image:url('__BASE__/img/checker.png');background-size:cover;border:1px solid #333;"></div>
<div style="width:200px;height:60px;overflow:hidden;border:1px solid #00a;">
  <img src="__BASE__/img/checker.png" style="width:200px;height:60px;object-fit:cover;">
</div>
</body></html>`,
    settleMs: 2000,
  },
  {
    name: 'layout',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Layout</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Layout</h2>
<div style="display:flex;gap:12px;margin-bottom:16px;">
  <div style="flex:1;background:#fee;height:80px;">flex 1</div>
  <div style="flex:2;background:#efe;height:80px;">flex 2</div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px;">
  <div style="background:#eef;">g1</div><div style="background:#fef;">g2</div><div style="background:#ffe;">g3</div>
</div>
<div style="float:left;width:80px;height:80px;background:#f80;margin-right:8px;"></div>
<p style="margin:0;">Text wraps around the floated box to the right of it and continues below after the float clears naturally.</p>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'overflow',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Overflow</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Overflow</h2>
<div style="width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;border:1px solid #999;padding:4px;">This is a very long single-line text that should be truncated with an ellipsis at the end.</div>
<div style="width:200px;word-break:break-all;border:1px solid #999;padding:4px;margin-top:8px;">Supercalifragilisticexpialidociousantidisestablishmentarianism</div>
<div style="height:120px;overflow:scroll;border:1px solid #666;margin-top:8px;">
  <div style="height:400px;background:#dfd;">Scrollable tall content inside a fixed-height container.</div>
</div>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'forms',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Forms</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Forms</h2>
<form action="__BASE__/fixtures/forms-done.html" method="get">
  <label>Text: <input type="text" name="q" style="border:1px solid #999;padding:4px;"></label><br>
  <label>Check: <input type="checkbox" name="c" checked></label><br>
  <label>Option: <input type="radio" name="r" value="1"> 1</label>
  <label><input type="radio" name="r" value="2" checked> 2</label><br>
  <select name="s"><option>One</option><option selected>Two</option></select><br>
  <textarea rows="2" cols="20" name="t"></textarea><br>
  <button type="submit" style="margin-top:8px;padding:6px 12px;">Submit</button>
</form>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'fonts',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Fonts</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Typography</h2>
<p style="font-weight:700;">Bold weight text</p>
<p style="font-style:italic;">Italic text</p>
<p style="text-transform:uppercase;">uppercase transform</p>
<p style="text-align:center;color:#00a;">Centered blue</p>
<p style="line-height:2;letter-spacing:2px;">Wide letter spacing with generous line height.</p>
<p style="font-size:28px;font-family:Georgia,serif;">Serif headline at 28px</p>
<p style="text-decoration:underline;">Underlined text</p>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'animation',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Animation</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Animation</h2>
<style>
@keyframes pulse { from { opacity: 1; } to { opacity: 0.2; } }
@keyframes slide { from { transform: translateX(0); } to { transform: translateX(60px); } }
.anim { width:100px;height:100px;background:#f00;animation:pulse 1s linear infinite; }
.slide { width:100px;height:40px;background:#0a0;animation:slide 1s linear infinite; margin-top:12px; }
</style>
<div class="anim"></div>
<div class="slide"></div>
</body></html>`,
    settleMs: 1600,
    captureTwoFrames: true,
  },
  {
    name: 'media',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Media</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Media query</h2>
<style>@media (max-width: 1000px) { #box { background:#a00; } }</style>
<div id="box" style="width:200px;height:80px;background:#0a0;color:#fff;padding:8px;">Wide layout</div>
<p>If the engine viewport is &le;1000px the box above is red (else green).</p>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'iframe',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Iframe</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Iframe</h2>
<iframe src="__BASE__/fixtures/iframe-child.html" width="400" height="200" style="border:1px solid #333;"></iframe>
<p>Below is an embedded page.</p>
</body></html>`,
    settleMs: 2000,
  },
  {
    name: 'anchors',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Anchors</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2>Anchors</h2>
<p style="height:900px;">Scroll space above the anchor target.</p>
<h3 id="target" style="background:#ffd;">Anchor target</h3>
<p><a href="#target">Jump to target</a></p>
</body></html>`,
    settleMs: 900,
  },
  {
    name: 'script',
    html: `<!doctype html><html><head><meta charset="utf-8"><title>Script</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;">
<h2 id="head">Script</h2>
<p id="out">before</p>
<script>
  document.title = 'Script Ran';
  document.getElementById('out').textContent = 'after: ' + (1 + 2);
  try { localStorage.setItem('fid', '1'); } catch (e) { console.error('localStorage: ' + e.message); }
</script>
</body></html>`,
    settleMs: 900,
  },
];

const FORMS_DONE = `<!doctype html><html><head><meta charset="utf-8"><title>Form Submitted</title></head>
<body style="font-family:system-ui,sans-serif;margin:24px;background:#efe;">
<h2>Form submitted OK</h2>
<p>This page is reached after a successful form submission.</p>
</body></html>`;

const IFRAME_CHILD = `<!doctype html><html><head><meta charset="utf-8"><title>Iframe child</title></head>
<body style="font-family:system-ui,sans-serif;margin:0;background:#ddeeff;">
<h3>Inside iframe</h3>
<p>Embedded page content with a distinctive light-blue background.</p>
</body></html>`;

// --- Pixel stats -----------------------------------------------------------
interface CanvasStats {
  width: number;
  height: number;
  context: string;
  opaqueRatio: number;
  nonWhiteRatio: number;
  colorClusters: number;
  topColors: Array<{ hex: string; count: number }>;
}

async function canvasStats(page: Page): Promise<CanvasStats | null> {
  return page.evaluate(() => {
    const c = document.querySelector('.content-area canvas') as HTMLCanvasElement | null;
    if (!c) return null;
    const ctx = c.getContext('2d');
    if (!ctx) return { width: c.width, height: c.height, context: 'missing', opaqueRatio: 0, nonWhiteRatio: 0, colorClusters: 0, topColors: [] };
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const total = d.length / 4;
    let alphaPx = 0;
    let nonWhite = 0;
    const seen = new Set<number>();
    const histogram = new Map<number, number>();
    const step = Math.max(1, Math.floor(total / 262144));
    for (let i = 0; i < d.length; i += step * 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const a = d[i + 3];
      if (a > 0) {
        alphaPx++;
        const q = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
        if (r < 245 || g < 245 || b < 245) nonWhite++;
        seen.add(q);
        histogram.set(q, (histogram.get(q) ?? 0) + 1);
      }
    }
    const topColors = [...histogram.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([q, count]) => {
        const toHex = (v: number): string => (v * 8).toString(16).padStart(2, '0');
        const hex = `#${toHex((q >> 10) & 31)}${toHex((q >> 5) & 31)}${toHex(q & 31)}`;
        return { hex, count };
      });
    return {
      width: c.width,
      height: c.height,
      context: 'ok',
      opaqueRatio: +(alphaPx / total).toFixed(4),
      nonWhiteRatio: +(nonWhite / total).toFixed(4),
      colorClusters: seen.size,
      topColors,
    };
  });
}

async function windowSize(page: Page): Promise<{ w: number; h: number }> {
  return page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}

async function waitForNewCanvas(page: Page, prev: unknown): Promise<boolean> {
  try {
    await page.waitForFunction(
      (prevEl) => {
        const c = document.querySelector('.content-area canvas');
        return !!c && c !== prevEl;
      },
      prev,
      { timeout: 30_000 },
    );
    return true;
  } catch {
    return false;
  }
}

interface FixtureResult {
  name: string;
  url: string;
  status: 'rendered' | 'no-canvas' | 'error';
  loadMs: number;
  committedUrl: string;
  canvas: CanvasStats | null;
  window: { w: number; h: number } | null;
  contentText: string;
  frameDeltaClusters: number | null;
  consoleErrors: string[];
  pageErrors: string[];
  screenshot: string;
}

// --- Report -----------------------------------------------------------------
function mdRow(r: FixtureResult): string {
  const c = r.canvas;
  return [
    `| ${r.name} | ${r.status} | ${r.loadMs}ms |`,
    c ? `${c.width}x${c.height} | ${c.nonWhiteRatio} | ${c.colorClusters}` : '- | - | -',
    `| ${r.committedUrl.slice(0, 60)} | ${r.consoleErrors.length}/${r.pageErrors.length} |`,
    r.frameDeltaClusters !== null ? `| animΔ=${r.frameDeltaClusters} |` : '| |',
  ].join(' ');
}

function reportMarkdown(results: FixtureResult[]): string {
  const lines: string[] = [];
  lines.push('# Nova Fidelity Audit Report');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| fixture | status | load | canvas | non-white | clusters | url | console/page errs | anim |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of results) lines.push(mdRow(r));
  lines.push('');
  return lines.join('\n');
}

function writeReport(results: FixtureResult[]): void {
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), reportMarkdown(results), 'utf8');
}

// --- The test ---------------------------------------------------------------
test('Nova fidelity audit over crafted fixtures', async () => {
  test.setTimeout(420_000);

  if (fs.existsSync(OUT_DIR)) fs.rmSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/img/checker.png')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(checkerPng);
      return;
    }
    if (url === '/fixtures/forms-done.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FORMS_DONE);
      return;
    }
    if (url === '/fixtures/iframe-child.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(IFRAME_CHILD);
      return;
    }
    const m = /^\/fixtures\/(.+)\.html$/.exec(url);
    if (m) {
      const fixture = FIXTURES.find((f) => f.name === m[1]);
      if (fixture) {
        const origin = `http://localhost:${port}`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fixture.html.replace(/__BASE__/g, origin));
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  let port = 0;
  await new Promise<void>((resolve) => server.listen(0, () => {
    port = (server.address() as { port: number }).port;
    resolve();
  }));

  const app = await electron.launch({ args: ['.'] });
  let page = await app.firstWindow();

  const results: FixtureResult[] = [];
  let consoleErrors: string[] = [];
  let pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));

  try {
    await page.locator('#browser-app').waitFor({ state: 'visible', timeout: 30_000 });
    const input = page.locator('.address-input');
    await input.waitFor({ state: 'visible', timeout: 30_000 });

    for (const fixture of FIXTURES) {
      if (process.env.AUDIT_FIXTURE && fixture.name !== process.env.AUDIT_FIXTURE) continue;
      // eslint-disable-next-line no-console
      console.log(`[fidelity] === ${fixture.name}`);
      consoleErrors = [];
      pageErrors = [];
      const url = `http://localhost:${port}/fixtures/${fixture.name}.html`;
      const t0 = Date.now();
      let result: FixtureResult;
      try {
        const prevCanvas = await page.evaluateHandle(() => document.querySelector('.content-area canvas'));
        await input.fill(url);
        await input.press('Enter');
        const rendered = await waitForNewCanvas(page, prevCanvas);
        const loadMs = Date.now() - t0;
        await page.waitForTimeout(fixture.settleMs);

        const canvas = await canvasStats(page);
        const win = await windowSize(page);
        const committedUrl = await input.inputValue();
        const contentText = await page.evaluate(() => {
          const el = document.querySelector('.content-area');
          return el ? (el.textContent || '').slice(0, 300) : '';
        });

        let frameDeltaClusters: number | null = null;
        if (fixture.captureTwoFrames && canvas) {
          await page.waitForTimeout(600);
          const second = await canvasStats(page);
          if (second) {
            // Two separate quantized-signature snapshots; a live animation changes them.
            const sig1 = JSON.stringify([canvas.nonWhiteRatio, canvas.colorClusters]);
            const sig2 = JSON.stringify([second.nonWhiteRatio, second.colorClusters]);
            frameDeltaClusters = sig1 === sig2 ? 0 : 1;
          }
        }

        let shot = '';
        if (canvas) {
          shot = path.join(SHOT_DIR, `${fixture.name}.png`);
          await page.locator('.content-area canvas').screenshot({ path: shot });
        }

        result = {
          name: fixture.name,
          url,
          status: canvas ? 'rendered' : rendered ? 'no-canvas' : 'error',
          loadMs,
          committedUrl,
          canvas,
          window: win,
          contentText,
          frameDeltaClusters,
          consoleErrors,
          pageErrors,
          screenshot: shot,
        };
      } catch (err) {
        result = {
          name: fixture.name,
          url,
          status: 'error',
          loadMs: Date.now() - t0,
          committedUrl: '',
          canvas: null,
          window: null,
          contentText: '',
          frameDeltaClusters: null,
          consoleErrors,
          pageErrors: [...pageErrors, `capture failed: ${String(err).slice(0, 200)}`],
          screenshot: '',
        };
        // Renderer/window may have died; try to re-acquire the app window.
        if (page.isClosed()) {
          try {
            page = await app.firstWindow();
          } catch {
            // app itself gone — stop collecting
            results.push(result);
            writeReport(results);
            throw err;
          }
        }
      }
      results.push(result);
      writeReport(results);
    }
  } finally {
    try {
      await app.close();
    } catch {
      // already closed
    }
    server.close();
  }

  const basic = results.find((r) => r.name === 'basic');
  if (basic) {
    expect(basic.canvas, `basic fixture must produce a canvas (content: ${basic.contentText || '-'})`).toBeTruthy();
    expect(basic.canvas?.colorClusters, 'basic fixture must render text/content (clusters > 1)').toBeGreaterThan(1);
  }

  const blank = results.find((r) => r.name === 'blank');
  if (blank) {
    expect(blank.canvas, 'blank fixture should have produced a canvas').toBeTruthy();
  }

  // Surface per-fixture findings in the run log for triage.
  for (const r of results) {
    const c = r.canvas;
    const detail = c
      ? `${c.width}x${c.height} nonWhite=${c.nonWhiteRatio} clusters=${c.colorClusters} top=${c.topColors.map((t) => `${t.hex}x${t.count}`).join(' ')}`
      : 'no canvas';
    // eslint-disable-next-line no-console
    console.log(`[fidelity] ${r.name}: ${r.status} load=${r.loadMs}ms ${detail} console=${r.consoleErrors.length} page=${r.pageErrors.length}`);
    for (const e of r.consoleErrors) console.log(`[fidelity]   console: ${e}`);
    for (const e of r.pageErrors) console.log(`[fidelity]   pageerror: ${e}`);
  }
});
