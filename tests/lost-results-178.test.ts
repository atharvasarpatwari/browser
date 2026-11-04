/**
 * 1.78: bugs found by auditing ESLint's "assigned a value but never used" warnings in src/, where a
 * computed value nobody reads can be a lost result. Block-in-inline content overlapped what followed
 * it (the block's end was discarded); canvas fill() was always evenodd; radial-gradient shape and size
 * were parsed and ignored; the meta charset prescan needed http-equiv before content.
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { CanvasRenderingContext2D } from '../src/browser/rendering/canvas/canvas-context';
import { parseGradient, evaluateGradient } from '../src/browser/rendering/css-gradients';
import { prescanMetaCharset } from '../src/browser/rendering/html5/encoding';

async function page(body: string) {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<html><body style="margin:0;font:16px/20px sans-serif">${body}</body></html>` } as never, new AbortController().signal);
  const box = (id: string) => layout.getLayoutBox(domTree.getElementById(id)!.domId)!;
  return { box, r };
}
const alphaAt = (c: CanvasRenderingContext2D, x: number, y: number) => c.getImageData(x, y, 1, 1).data[3]!;
const enc = (s: string) => new TextEncoder().encode(s);

it('1.78 lost-result fixes: block-in-inline, canvas fill rule, radial shape/size, meta charset order', async () => {
  const check = (name: string, ok: boolean, info = '') => expect(ok, `${name} ${info}`).toBe(true);

  // 1. block inside an inline: what follows must start below the block.
  {
    const { box, r } = await page('<a id="a" href="#">before<div id="d" style="height:50px">card</div>after</a><div id="n" style="height:10px"></div>');
    check('block-in-inline: next block below the block', box('n').y >= box('d').y + 50, `d.y=${box('d').y} n.y=${box('n').y}`);
    r.dispose();
  }
  {
    const { box, r } = await page('<span id="s"><div id="d" style="height:40px">x</div></span><p id="p" style="margin:0">after</p>');
    check('block-in-span: following p below', box('p').y >= 40, `d=${box('d').y},${box('d').height} p.y=${box('p').y}`);
    r.dispose();
  }
  // 2. canvas fill rules
  {
    const c = new CanvasRenderingContext2D(40, 20);
    c.fillStyle = '#000';
    c.beginPath(); c.rect(0, 0, 30, 20); c.rect(10, 0, 30, 20); c.fill();
    check('canvas nonzero: overlap of two same-direction rects is filled', alphaAt(c, 20, 10) > 0, `alpha=${alphaAt(c, 20, 10)}`);
    const e = new CanvasRenderingContext2D(40, 20);
    e.fillStyle = '#000';
    e.beginPath(); e.rect(0, 0, 30, 20); e.rect(10, 0, 30, 20); e.fill('evenodd');
    check('canvas evenodd: overlap is a hole', alphaAt(e, 20, 10) === 0 && alphaAt(e, 5, 10) > 0, `hole=${alphaAt(e, 20, 10)} side=${alphaAt(e, 5, 10)}`);
    const t = new CanvasRenderingContext2D(40, 40);
    t.fillStyle = '#000';
    t.beginPath(); t.moveTo(20, 2); t.lineTo(38, 38); t.lineTo(2, 38); t.closePath(); t.fill();
    let rows = 0; for (let y = 3; y < 37; y++) if (alphaAt(t, 20, y) > 0) rows++;
    check('canvas triangle: every row through the apex column filled', rows >= 33, `rows=${rows}`);
  }
  // 3. radial gradient shape / size
  {
    const g = parseGradient('radial-gradient(circle, #000 0%, #fff 100%)')!;
    // A circle in a 200x100 box: points at equal distance from the centre get the same colour.
    const a = evaluateGradient(g, 100 + 40, 50, 200, 100), b = evaluateGradient(g, 100, 50 + 40, 200, 100);
    check('radial circle: equal distance → equal colour', Math.abs(a.r - b.r) <= 2, `h=${a.r} v=${b.r}`);
    const cs = parseGradient('radial-gradient(circle closest-side, #000 0%, #fff 100%)')!;
    const edge = evaluateGradient(cs, 100, 50 + 49, 200, 100);
    check('radial closest-side: reaches the last stop at the nearest side', edge.r >= 245, `r=${edge.r}`);
    const fs = parseGradient('radial-gradient(ellipse farthest-side, #000 0%, #fff 100%)')!;
    const right = evaluateGradient(fs, 199, 50, 200, 100);
    check('radial farthest-side: last stop at the side', right.r >= 245, `r=${right.r}`);
  }
  // 4. meta charset, attribute order
  check('meta charset: http-equiv then content', prescanMetaCharset(enc('<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">')) === 'windows-1252');
  check('meta charset: content then http-equiv', prescanMetaCharset(enc('<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">')) === 'windows-1252',
    String(prescanMetaCharset(enc('<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">'))));
  check('meta charset attr', prescanMetaCharset(enc('<meta charset="shift_jis">')) === 'shift_jis', String(prescanMetaCharset(enc('<meta charset="shift_jis">'))));

}, 120000);
