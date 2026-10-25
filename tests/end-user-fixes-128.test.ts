/**
 * Fixes for root causes from the end-user test pass (doc/2026-10-21-nova-android-1.26-end-user-test-results.md):
 * RC-10 page titles, RC-11 history noise, RC-18 underline gaps, RC-19 "[object Object]" errors,
 * and host errors escaping page try/catch.
 */
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { HistoryService } from '../src/browser/history/history-service';
import { runJS } from '../src/browser/js/index';

async function render(body: string) {
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
  renderer.setViewport(800, 600, 1);
  await renderer.render({ url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  return { renderer, cmds: paintEngine.compositeFrame() };
}

describe('RC-10: the document title', () => {
  it('reads <title>, collapsing whitespace, and ignores an <svg><title>', async () => {
    const { renderer } = await render('<html><head><title>\n  Example   Domain \n</title></head><body><svg><title>icon</title></svg></body></html>');
    expect(renderer.getDocumentTitle()).toBe('Example Domain');
    const none = await render('<html><body><svg><title>only svg</title></svg><p>x</p></body></html>');
    expect(none.renderer.getDocumentTitle()).toBe('');
  });
});

describe('RC-11: history records completed web loads with their title', () => {
  function fakeController() {
    const handlers = new Map<string, Array<(e: unknown) => void>>();
    return {
      on: (t: string, h: (e: unknown) => void) => handlers.set(t, [...(handlers.get(t) ?? []), h]),
      off: vi.fn(),
      emit: (t: string, e: unknown) => (handlers.get(t) ?? []).forEach((h) => h(e)),
    };
  }

  it('not at commit, not about: pages, and with the real title', async () => {
    const history = new HistoryService();
    const ctl = fakeController();
    history.connectController(ctl as never);
    ctl.emit('navigationCommitted', { kind: 'navigationCommitted', entry: { url: 'https://example.com/', title: 'example.com' } });
    ctl.emit('navigationCompleted', { kind: 'navigationCompleted', entry: { url: 'about:newtab', title: 'New tab' }, elapsedMs: 1 });
    ctl.emit('navigationCompleted', { kind: 'navigationCompleted', entry: { url: 'https://example.com/', title: 'Example Domain' }, elapsedMs: 5 });
    await new Promise((r) => setTimeout(r, 0));
    const recent = await history.getRecent(10);
    expect(recent.map((e) => [e.url, e.title])).toEqual([['https://example.com/', 'Example Domain']]);
  });
});

describe('RC-18: a link underline runs across the spaces between its words', () => {
  it('the space inside one link is underlined; the space between two links is not', async () => {
    const { cmds } = await render('<p><a href="#">two words</a> <a href="#">next</a></p>');
    const rects = cmds.filter((c) => c.type === "fillRect").map((c) => c.params as number[]).filter((r) => r[3]! <= 3); // underlines only
    const texts = cmds.filter((c) => c.type === 'fillText').map((c) => ({ t: c.params[0] as string, x: c.params[1] as number, w: c.params[3] as number }));
    const two = texts.find((t) => t.t === 'two')!;
    const words = texts.find((t) => t.t === 'words')!;
    const next = texts.find((t) => t.t === 'next')!;
    const underlined = (x: number) => rects.some(([rx, , rw]) => x >= rx! && x <= rx! + rw!);
    expect(underlined(two.x + two.w + 1)).toBe(true);        // the gap inside "two words"
    expect(underlined(words.x + words.w + 1)).toBe(false);   // the gap between the two links
    expect(underlined(next.x + 1)).toBe(true);
  });
});

describe('page scripts: errors', () => {
  const run = (src: string) => {
    const domTree = new DomTree();
    const doc = domTree.buildFromHtml((new HtmlParser().parse('<html><body></body></html>') as unknown as { document: never }).document);
    return runJS(src, { document: doc, domTree } as never);
  };

  it('an engine-raised TypeError is caught by the page try/catch', () => {
    expect(run('var r = "none"; try { null.x; } catch (e) { r = e.name + ": " + e.message; } r').value)
      .toBe("TypeError: Cannot read properties of null (reading 'x')");
    expect(run('var out = []; try { try { undefined.y } finally { out.push("fin") } } catch (e) { out.push(e.name) } out.join(",")').value)
      .toBe('fin,TypeError');
  });

  it('an uncaught thrown error is reported as "Name: message", not [object Object] (RC-19)', () => {
    expect(run('throw new TypeError("x is not a function")').error?.message).toBe('TypeError: x is not a function');
    expect(run('throw { name: "Custom", message: "plain" }').error?.message).toBe('Custom: plain');
    expect(run('throw 42').error?.message).toBe('42');
  });
});
