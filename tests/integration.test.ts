import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement, DomNode, DomDocument, IDomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import type { CssRule } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { LazyLoader } from '../src/browser/rendering/lazy-loader';
import { ReflowRepaintController } from '../src/browser/rendering/reflow-repaint-controller';
import { runJS } from '../src/browser/js/index';
import { EventLoop as JsEventLoop } from '../src/browser/js/event-loop';

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyComputedStylesSimple(
  domTree: IDomTree,
  cssParser: CssParser,
  rules: readonly CssRule[],
): void {
  const doc = domTree.getDocument();
  if (!doc) return;

  const walk = (nodes: readonly DomNode[]) => {
    for (const node of nodes) {
      if (node.nodeType !== 'element') continue;
      const el = node as DomElement;

      // Compute styles for this element
      const computed = cssParser.computeStylesForElement(
        el.tagName,
        el.attributes,
        rules,
      );
      domTree.setComputedStyle(el, computed);

      walk(el.children);
    }
  };
  walk(doc.children);
}

function executeInlineScriptsSimple(
  domTree: IDomTree,
  doc: DomDocument,
): string[] {
  const scripts = domTree.getElementsByTagName('script');
  if (scripts.length === 0) return [];

  const errors: string[] = [];
  const eventLoop = new JsEventLoop();

  for (const script of scripts) {
    if (script.attributes.has('src')) continue;

    let source = '';
    for (const child of script.children) {
      if (child.nodeType === 'text') {
        source += (child as unknown as { text: string }).text;
      }
    }
    source = source.trim();
    if (source === '') continue;

    const result = runJS(source, { document: doc, domTree, eventLoop });
    if (result.error) errors.push(result.error.message);
  }
  return errors;
}

function renderFullPipeline(html: string, css: string = ''): {
  imageData: ImageData;
  domTree: DomTree;
  doc: ReturnType<DomTree['buildFromHtml']>;
} {
  const htmlParser = new HtmlParser();
  const domTree = new DomTree();
  const cssParser = new CssParser();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();

  // 1. Parse HTML
  const parseResult = htmlParser.parse(`<style>${css}</style>${html}`, 'https://example.com');
  const htmlDoc = parseResult.document;

  // 2. Build DOM tree
  const doc = domTree.buildFromHtml(htmlDoc);

  // 3. Extract and apply CSS
  const rules = cssParser.extractStylesFromDocument(htmlDoc);
  applyComputedStylesSimple(domTree, cssParser, rules);

  // 4. Execute inline scripts
  executeInlineScriptsSimple(domTree, doc);

  // 5. Re-apply styles after scripts
  applyComputedStylesSimple(domTree, cssParser, rules);

  // 6. Layout
  layoutEngine.layout(doc, domTree);

  // 7. Lazy loading
  const lazyLoader = new LazyLoader();
  lazyLoader.init(doc, domTree);
  lazyLoader.scanForLazyElements(doc);
  lazyLoader.setViewport(1920, 1080);

  // 8. Paint + Rasterize (paint engine uses default 1920x1080)
  paintEngine.paint(doc);
  const imageData = paintEngine.rasterize();

  return { imageData, domTree, doc };
}

// ─── Full Pipeline Tests ────────────────────────────────────────────────────

describe('Full pipeline: HTML -> DOM -> CSS -> Layout -> Paint -> Rasterize', () => {
  it('produces valid ImageData from a simple page', () => {
    const { imageData } = renderFullPipeline('<p>Hello</p>');
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(1920);
    expect(imageData.height).toBe(1080);
    expect(imageData.data).toBeInstanceOf(Uint8ClampedArray);
    expect(imageData.data.length).toBe(1920 * 1080 * 4);
  });

  it('produces valid ImageData from styled content', () => {
    const css = 'body { background-color: #ff0000; }';
    const { imageData } = renderFullPipeline('<div>Red background</div>', css);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(1920);
    // Check that some pixels are red-ish (not all white)
    const data = imageData.data;
    let hasNonWhite = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        hasNonWhite = true;
        break;
      }
    }
    expect(hasNonWhite).toBe(true);
  });

  it('handles empty HTML gracefully', () => {
    const { imageData } = renderFullPipeline('');
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(1920);
  });

  it('handles complex nested HTML', () => {
    const html = `
      <div>
        <h1>Title</h1>
        <p>Paragraph with <strong>bold</strong> and <em>italic</em></p>
        <ul>
          <li>Item 1</li>
          <li>Item 2</li>
        </ul>
      </div>
    `;
    const { imageData } = renderFullPipeline(html);
    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(1920);
  });
});

// ─── ReflowRepaintController Integration ────────────────────────────────────

describe('ReflowRepaintController integration', () => {
  it('initializes with a document', () => {
    const htmlParser = new HtmlParser();
    const domTree = new DomTree();
    const layoutEngine = new LayoutEngine();
    const paintEngine = new PaintEngine();

    const parseResult = htmlParser.parse('<div>Test</div>', 'https://example.com');
    const doc = domTree.buildFromHtml(parseResult.document);

    const controller = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    controller.init(doc);
    expect(controller.isScheduled()).toBe(false);
    expect(controller.getFrameCount()).toBe(0);
  });

  it('processes a frame after invalidation', async () => {
    const htmlParser = new HtmlParser();
    const domTree = new DomTree();
    const layoutEngine = new LayoutEngine();
    const paintEngine = new PaintEngine();

    const parseResult = htmlParser.parse('<div>Test</div>', 'https://example.com');
    const doc = domTree.buildFromHtml(parseResult.document);

    const controller = new ReflowRepaintController(layoutEngine, paintEngine, domTree);
    controller.init(doc);

    // Initial layout
    layoutEngine.layout(doc, domTree);

    // Invalidate and schedule
    const el = doc.children[0];
    if (el) {
      controller.invalidateLayout(el);
      controller.requestFrame();
    }

    // Wait for microtask to flush
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(controller.getFrameCount()).toBeGreaterThanOrEqual(1);
  });
});

// ─── JS Engine + Pipeline Integration ───────────────────────────────────────

describe('JS engine + rendering pipeline', () => {
  it('executes inline script that modifies DOM', () => {
    const htmlParser = new HtmlParser();
    const domTree = new DomTree();
    const cssParser = new CssParser();
    const layoutEngine = new LayoutEngine();
    const paintEngine = new PaintEngine();

    const html = `
      <div id="target">Initial</div>
      <script>
        var el = document.getElementById('target');
        if (el) el.textContent = 'Modified';
      </script>
    `;
    const parseResult = htmlParser.parse(html, 'https://example.com');
    const htmlDoc = parseResult.document;
    const doc = domTree.buildFromHtml(htmlDoc);

    // Apply styles
    const rules = cssParser.extractStylesFromDocument(htmlDoc);
    applyComputedStylesSimple(domTree, cssParser, rules);

    // Execute inline scripts
    const errors = executeInlineScriptsSimple(domTree, doc);
    expect(errors).toHaveLength(0);

    // Re-apply styles after scripts
    applyComputedStylesSimple(domTree, cssParser, rules);

    // Layout + Paint + Rasterize
    layoutEngine.layout(doc, domTree);
    paintEngine.paint(doc);
    const imageData = paintEngine.rasterize();

    expect(imageData).toBeDefined();
    expect(imageData.width).toBe(1920);
  });
});
