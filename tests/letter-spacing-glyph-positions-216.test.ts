/**
 * 2.16: letter-spaced text is painted one glyph at a time, each placed by the sum of the single-character widths,
 * while layout sizes the run from one whole-string measure. A real canvas measures a string narrower than the sum
 * of its characters (kerning, hinting at 1.7x), so painted words ran past the width layout gave them and ate the
 * space after them: "Ad BlockerTest" on the realme tablet. Glyphs are now placed by the measured text before them.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { getTextMeasurer, setTextMeasurer } from '../src/browser/rendering/formatting/text-measure';

const original = getTextMeasurer();
afterEach(() => setTextMeasurer(original));

// A string is narrower than the sum of its characters, as on a real canvas.
const width = (t: string, size: number): number => [...t].length * size * ([...t].length === 1 ? 0.6 : 0.5);
const fake = { measure: (t: string, size: number) => ({ width: width(t, size), height: size * 1.2, baseline: size * 0.8 }) };

it('letter-spaced glyphs sit where the measured text before them ends', async () => {
  setTextMeasurer(fake as never);
  const paint = new PaintEngine();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint, svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
    userStylesheet: () => '' } as never);
  r.setViewport(400, 300, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: '<html><body style="margin:0"><p style="margin:0;font-size:20px;letter-spacing:2px">Blocker</p></body></html>' } as never, new AbortController().signal);
  const glyphs = paint.compositeFrame().filter((c) => c.type === 'fillText' && String(c.params[0]).length === 1);
  r.dispose();
  expect(glyphs.map((g) => g.params[0]).join('')).toBe('Blocker');
  const x0 = Number(glyphs[0]!.params[1]);
  glyphs.forEach((g, i) => {
    const prefix = 'Blocker'.slice(0, i);
    const expected = x0 + (prefix ? width(prefix, 20) : 0) + i * 2;
    expect(Number(g.params[1])).toBeCloseTo(expected, 5);
  });
});
