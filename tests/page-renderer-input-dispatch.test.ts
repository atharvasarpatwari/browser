/**
 * Real-pipeline coverage for PageRenderer's dispatch*Event methods added
 * alongside the pre-existing dispatchPointerEvent: only 'click' used to ever
 * reach page content — keyboard, wheel, dblclick and resize never did, even
 * though the DOM's own addEventListener/dispatchEvent machinery already
 * supported them. No mocks: a real PageRenderer renders real HTML+script,
 * and dispatch is verified by DOM mutations the script itself performs.
 */
import { describe, it, expect } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { ResourceLoader } from '../src/browser/networking/resource-loader';
import { ResourcePrioritizer } from '../src/browser/networking/resource-prioritizer';

function makeRenderer() {
  return new PageRenderer({
    htmlParser: new HtmlParser(),
    domTree: new DomTree(),
    cssParser: new CssParser(),
    layoutEngine: new LayoutEngine(),
    paintEngine: new PaintEngine(),
    resourceLoader: new ResourceLoader(),
    prioritizer: new ResourcePrioritizer(),
  });
}

async function render(renderer: PageRenderer, body: string): Promise<void> {
  await renderer.render({
    url: 'https://example.test/',
    statusCode: 200,
    contentType: 'text/html',
    body,
    headers: new Map(),
    loadedAt: Date.now(),
  }, new AbortController().signal);
}

function text(renderer: PageRenderer, id: string): string {
  const el = renderer.getDomTree()!.getElementById(id);
  const textNode = el?.children.find((c) => c.nodeType === 'text') as { text?: string } | undefined;
  return textNode?.text ?? '';
}

describe('PageRenderer — real keyboard/wheel/resize/dblclick dispatch', () => {
  it('dispatchKeyEvent delivers to the focused element, not just whatever was clicked last', async () => {
    const renderer = makeRenderer();
    await render(renderer, `
      <html><body>
        <input id="a">
        <div id="log"></div>
        <script>
          document.getElementById('a').focus();
          document.getElementById('a').addEventListener('keydown', function(e) {
            document.getElementById('log').textContent = 'key:' + e.key + ':' + e.ctrlKey;
          });
        </script>
      </body></html>
    `);

    const dispatched = renderer.dispatchKeyEvent('keydown', 'a', 'KeyA', { ctrlKey: true });

    expect(dispatched).toBe(true);
    expect(text(renderer, 'log')).toBe('key:a:true');
  });

  it('dispatchKeyEvent falls back to <body> when nothing is focused', async () => {
    const renderer = makeRenderer();
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          document.body.addEventListener('keydown', function(e) {
            document.getElementById('log').textContent = 'body-key:' + e.key;
          });
        </script>
      </body></html>
    `);

    const dispatched = renderer.dispatchKeyEvent('keydown', 'Enter', 'Enter');

    expect(dispatched).toBe(true);
    expect(text(renderer, 'log')).toBe('body-key:Enter');
  });

  it('dispatchResizeEvent reaches a window "resize" listener', async () => {
    const renderer = makeRenderer();
    await render(renderer, `
      <html><body>
        <div id="log"></div>
        <script>
          window.addEventListener('resize', function() {
            document.getElementById('log').textContent = 'resized';
          });
        </script>
      </body></html>
    `);

    const dispatched = renderer.dispatchResizeEvent();

    expect(dispatched).toBe(true);
    expect(text(renderer, 'log')).toBe('resized');
  });

  it('dispatchPointerEvent("dblclick") carries real coordinates via the MouseEvent-shaped object', async () => {
    const renderer = makeRenderer();
    await render(renderer, `
      <html><body>
        <div id="log">none</div>
        <script>
          document.body.addEventListener('dblclick', function(e) {
            document.getElementById('log').textContent = 'dblclick:' + e.clientX + ',' + e.clientY;
          });
        </script>
      </body></html>
    `);

    // (10, 10): inside <body>'s default 8px UA-stylesheet margin box, so it
    // actually lands on rendered content — (0,0)/(5,7) fall in the margin
    // itself and hit nothing, which is real layout behavior, not a test bug.
    const dispatched = renderer.dispatchPointerEvent('dblclick', 10, 10);

    expect(dispatched).toBe(true);
    expect(text(renderer, 'log')).toBe('dblclick:10,10');
  });

  it('dispatchWheelEvent carries deltaX/deltaY to a "wheel" listener', async () => {
    const renderer = makeRenderer();
    await render(renderer, `
      <html><body>
        <div id="log">none</div>
        <script>
          document.body.addEventListener('wheel', function(e) {
            document.getElementById('log').textContent = 'wheel:' + e.deltaY;
          });
        </script>
      </body></html>
    `);

    const dispatched = renderer.dispatchWheelEvent(10, 10, 0, 120);

    expect(dispatched).toBe(true);
    expect(text(renderer, 'log')).toBe('wheel:120');
  });

  it('returns false before any page has rendered', () => {
    const renderer = makeRenderer();
    expect(renderer.dispatchKeyEvent('keydown', 'a', 'KeyA')).toBe(false);
    expect(renderer.dispatchResizeEvent()).toBe(false);
    expect(renderer.dispatchWheelEvent(0, 0, 0, 0)).toBe(false);
  });
});
