/**
 * End-to-end paint check on a copy of example.com at phone width — the page where the
 * Android build showed a box outline round every block, first letters clipped at the left
 * edge, a missing <h1>, and (traced here) a link box as tall as the page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import type { DomElement } from '../src/browser/rendering/dom-tree';

const PAGE = readFileSync(path.resolve(__dirname, 'fixtures/example-domain.html'), 'utf8');

async function renderAtPhoneWidth() {
  const domTree = new DomTree();
  const paintEngine = new PaintEngine();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine,
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
  } as unknown as PageRendererDependencies);
  renderer.setViewport(412, 800, 1);
  await renderer.render({
    url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: PAGE,
    headers: new Map([['content-type', 'text/html']]), loadedAt: Date.now(),
  }, new AbortController().signal);
  const texts = paintEngine.compositeFrame().filter((c) => c.type === 'fillText').map((c) => c.params as [string, number, number, number]);
  const all: DomElement[] = [];
  const walk = (n: DomElement) => { all.push(n); for (const c of n.children ?? []) if ((c as DomElement).tagName) walk(c as DomElement); };
  walk(domTree.getDocument()!.bodyElement as DomElement);
  return { texts, find: (tag: string) => all.find((n) => n.tagName.toLowerCase() === tag)!, paintEngine };
}

describe('example.com at phone width', () => {
  it('paints only body content: no <title>/<style> text', async () => {
    const { texts } = await renderAtPhoneWidth();
    const painted = texts.map((t) => t[0]).join('');
    expect(painted).toContain('Example');
    expect(painted).not.toContain('background-color');
    expect(painted.split('Example').length - 1).toBe(1); // the <h1>, not also the <title>
  });

  it('draws text inside its box, not at x=0', async () => {
    const { texts, find } = await renderAtPhoneWidth();
    const h1 = find('h1').layoutBox!;
    const [, x] = texts.find((t) => t[0] === 'Example')!;
    expect(h1.x).toBeGreaterThan(0);
    expect(x).toBeCloseTo(h1.x, 0);
  });

  it('draws no border where border-style is none', async () => {
    const { find } = await renderAtPhoneWidth();
    expect(find('div').computedStyle?.get('border-top-width')).toBe('0px');
    expect(find('a').layoutBox!.borderLeft).toBe(0);
  });

  it('gives the inline link a line-sized box, not one reaching from the top of the page', async () => {
    const { find } = await renderAtPhoneWidth();
    expect(find('a').layoutBox!.height).toBeLessThan(40);
  });

  it('collapses source indentation inside a paragraph to a single space', async () => {
    // Source: "You may use this" + newline + 4-space indent + "domain in literature"; same line at 412px.
    const { texts } = await renderAtPhoneWidth();
    const i = texts.findIndex((t) => t[0] === 'this');
    const [, thisX, thisY, thisW] = texts[i]!;
    const domain = texts.slice(i).find((t) => t[0] === 'domain')!;
    expect(domain[2]).toBe(thisY);
    expect(domain[1] - (thisX + thisW)).toBeLessThan(8); // one space at 16px, not five
  });
});
