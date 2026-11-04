/**
 * 1.82, seen on Wikipedia: "As of 2026 / , the most used". A text run that starts at an inline
 * element boundary was free to start a new line, even with a comma that UAX #14 never lets start one.
 */
import { expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function lines(html: string, width: number): Promise<string[]> {
  const domTree = new DomTree(); const layout = new LayoutEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: layout, paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(800, 600, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0, body: `<!doctype html><html><body style="margin:0;font:16px/20px sans-serif"><p id="p" style="margin:0;width:${width}px">${html}</p></body></html>` } as never, new AbortController().signal);
  const p = domTree.getElementById('p')!;
  const runs: Array<{ y: number; x: number; text: string }> = [];
  const collect = (n: any) => { const b = layout.getLayoutBox(n.domId); for (const t of b?.textRuns ?? []) runs.push({ y: Math.round(t.y), x: Math.round(t.x), text: t.text }); for (const c of n.children ?? []) if (c.nodeType === 'element') collect(c); };
  collect(p);
  const byY = new Map<number, string[]>();
  for (const t of runs.sort((a, b) => a.y - b.y || a.x - b.x)) byY.set(t.y, [...(byY.get(t.y) ?? []), t.text]);
  r.dispose();
  return [...byY.values()].map((l) => l.join(''));
}

const starts = (ls: string[]) => ls.some((l) => /^\s*[,.;:!?)]/.test(l));

it('a comma after an inline element stays with the previous word', async () => {
  const html = 'The most <span>As of 2026</span><sup style="display:none">[update]</sup><span></span><link rel="x">, the most used browsers';
  for (let w = 60; w <= 200; w += 2) expect(starts(await lines(html, w)), `w=${w}`).toBe(false);
  const ls = await lines(html, 92);
  expect(ls[1]!.startsWith('2026,')).toBe(true);
}, 120000);

it('a single word that cannot break overflows instead of leaving the comma alone', async () => {
  const ls = await lines('<span>Unbreakableword</span>, rest', 40);
  expect(ls[0]!.startsWith('Unbreakableword,')).toBe(true);
});

it('a break after a space at an element boundary is still allowed', async () => {
  const ls = await lines('<span>alpha beta</span> gamma delta', 80);
  expect(ls.length).toBeGreaterThan(1);
  expect(starts(ls)).toBe(false);
});
