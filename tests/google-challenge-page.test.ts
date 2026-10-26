/**
 * Google's results URL first serves a JS challenge page (tests/fixtures/google-search-2026). Nova
 * used to show its <noscript> fallback ("Please click here…") and its scripts died on parser and
 * object-model bugs, so the page never got past the challenge.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';

type El = { tagName?: string; children?: El[]; nextSibling?: El | null };
const tagsUnder = (n: El | undefined): string[] => (n?.children ?? []).flatMap((c) => (c.tagName ? [c.tagName, ...tagsUnder(c)] : []));

describe('noscript with scripting on', () => {
  it('is raw text: its markup does not spill into the page', () => {
    const doc = (new HtmlParser().parse('<html><body><noscript><style>p{}</style><meta http-equiv="refresh" content="0;url=/x"><div>Please click</div></noscript><p>after</p></body></html>') as unknown as { document: El }).document;
    const body = tagsUnder(doc);
    expect(body).toContain('noscript');
    expect(body).toContain('p');
    expect(body).not.toContain('div');
    expect(body).not.toContain('meta');
  });
});

describe('Google challenge page', () => {
  it('runs its scripts without errors and does not show the noscript fallback', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ')); });
    const paint = new PaintEngine();
    const renderer = new PageRenderer({ htmlParser: new HtmlParser(), domTree: new DomTree(), cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: paint,
      resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
      prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
    renderer.setViewport(424, 800, 1);
    try {
      await renderer.render({ url: 'https://www.google.com/search?q=nova%20browser', statusCode: 200, contentType: 'text/html', body: readFileSync('tests/fixtures/google-search-2026/index.html', 'utf8'), headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
    } finally {
      spy.mockRestore();
    }
    expect(errors.filter((e) => e.includes('[ScriptEngine]'))).toEqual([]);
    const texts = paint.compositeFrame().filter((c) => c.type === 'fillText').map((c) => c.params[0] as string).join(' ');
    expect(texts).not.toContain('Please click');
  }, 30_000);
});
