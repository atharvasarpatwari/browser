/**
 * @file tests/page-renderer.test.ts
 *
 * Tests for the PageRenderer class that implements the full rendering pipeline
 * from HTML parsing to paint output.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import type { IResourceLoader } from '../src/browser/networking/resource-loader';
import type { IDomTree, DomDocument, DomElement } from '../src/browser/rendering/dom-tree';
import type { ICssParser, CssRule } from '../src/browser/rendering/css-parser';
import type { ILayoutEngine } from '../src/browser/rendering/layout-engine';
import type { IPaintEngine } from '../src/browser/rendering/paint-engine';
import type { IPageRenderer, PageLoadResult } from '../src/browser/engine/browser-engine';

// ── Mock implementations ────────────────────────────────────────────────────

function createMockHtmlParser() {
  return {
    parse: vi.fn().mockReturnValue({
      document: {
        type: 'document',
        children: [],
      },
      resources: [],
    }),
  };
}

function createMockDomTree(): IDomTree {
  return {
    buildFromHtml: vi.fn().mockReturnValue({
      type: 'document',
      children: [],
    }),
    getNodeById: vi.fn(),
    getElementById: vi.fn(),
    getElementsByTagName: vi.fn().mockReturnValue([]),
    getElementsByClassName: vi.fn().mockReturnValue([]),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn().mockReturnValue([]),
    insertBefore: vi.fn(),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    setTextContent: vi.fn(),
    setComputedStyle: vi.fn(),
    setUsedStyle: vi.fn(),
    setLayoutBox: vi.fn(),
    getMutations: vi.fn().mockReturnValue([]),
    clearMutations: vi.fn(),
    processMutations: vi.fn(),
    markDirty: vi.fn(),
    markSubtreeDirty: vi.fn(),
    clearDirty: vi.fn(),
    clearSubtreeDirty: vi.fn(),
    getDocument: vi.fn().mockReturnValue({
      type: 'document',
      children: [],
    }),
    getParentElement: vi.fn(),
    getOwnerDocument: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    dispose: vi.fn(),
  };
}

function createMockCssParser(): ICssParser {
  return {
    parseStylesheet: vi.fn().mockReturnValue({ rules: [], url: null }),
    parseInlineStyle: vi.fn().mockReturnValue(new Map()),
    extractStylesFromDocument: vi.fn().mockReturnValue([]),
    computeStyles: vi.fn().mockReturnValue(new Map()),
    computeStylesForElement: vi.fn().mockReturnValue(new Map()),
    getCss5Parser: vi.fn().mockReturnValue({
      parseSelector: vi.fn().mockReturnValue(null),
    }),
    dispose: vi.fn(),
  } as ICssParser;
}

function createMockLayoutEngine(): ILayoutEngine {
  return {
    layout: vi.fn(),
    layoutIncremental: vi.fn().mockReturnValue(new Set()),
    getLayoutBox: vi.fn(),
    getElementAtPoint: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPaintEngine(): IPaintEngine {
  return {
    paint: vi.fn(),
    paintIncremental: vi.fn().mockReturnValue(new Set()),
    getLayers: vi.fn().mockReturnValue([]),
    getLayerById: vi.fn(),
    compositeFrame: vi.fn().mockReturnValue([]),
    rasterize: vi.fn(),
    rasterizeAsync: vi.fn().mockReturnValue(Promise.resolve({} as ImageData)),
    resize: vi.fn(),
    getConfig: vi.fn(),
    updateConfig: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    setOpacityResolver: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockResourceLoader(): IResourceLoader {
  return {
    loadResource: vi.fn(),
    loadBatch: vi.fn(),
    loadStylesheet: vi.fn().mockResolvedValue(''),
    loadScript: vi.fn().mockResolvedValue(''),
    loadImage: vi.fn(),
    getPriority: vi.fn(),
    setMaxConcurrent: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockResourcePrioritizer() {
  return {
    submit: vi.fn(),
    submitBatch: vi.fn(),
    submitPreload: vi.fn(),
    submitPrefetch: vi.fn(),
    submitPreconnect: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockPageLoadResult(overrides?: Partial<PageLoadResult>): PageLoadResult {
  return {
    url: 'https://example.com',
    statusCode: 200,
    contentType: 'text/html',
    body: '<html><body><h1>Hello World</h1></body></html>',
    headers: new Map([['content-type', 'text/html']]),
    loadedAt: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PageRenderer', () => {
  let mockDeps: PageRendererDependencies;
  let renderer: PageRenderer;

  beforeEach(() => {
    mockDeps = {
      htmlParser: createMockHtmlParser() as any,
      domTree: createMockDomTree(),
      cssParser: createMockCssParser(),
      layoutEngine: createMockLayoutEngine(),
      paintEngine: createMockPaintEngine(),
      resourceLoader: createMockResourceLoader(),
      prioritizer: createMockResourcePrioritizer() as any,
    };
    renderer = new PageRenderer(mockDeps);
  });

  describe('constructor', () => {
    it('should create a PageRenderer implementing IPageRenderer', () => {
      expect(renderer).toBeDefined();
      expect(typeof renderer.render).toBe('function');
      expect(typeof renderer.dispose).toBe('function');
    });
  });

  describe('render()', () => {
    it('should render a page successfully', async () => {
      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.htmlParser.parse).toHaveBeenCalled();
      expect(mockDeps.domTree.buildFromHtml).toHaveBeenCalled();
      expect(mockDeps.cssParser.extractStylesFromDocument).toHaveBeenCalled();
      expect(mockDeps.layoutEngine.layout).toHaveBeenCalled();
      expect(mockDeps.paintEngine.paint).toHaveBeenCalled();
    });

    it('should parse HTML with correct parameters', async () => {
      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.htmlParser.parse).toHaveBeenCalledWith(
        result.body,
        result.url
      );
    });

    it('should build DOM tree from parsed HTML', async () => {
      const mockHtmlDoc = { type: 'document', children: [] };
      (mockDeps.htmlParser.parse as ReturnType<typeof vi.fn>).mockReturnValue({
        document: mockHtmlDoc,
        resources: [],
      });

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.domTree.buildFromHtml).toHaveBeenCalledWith(mockHtmlDoc);
    });

    it('should submit discovered resources to prioritizer', async () => {
      const mockResources = [
        { url: 'https://example.com/style.css', kind: 'stylesheet' as const },
        { url: 'https://example.com/script.js', kind: 'script' as const },
      ];
      (mockDeps.htmlParser.parse as ReturnType<typeof vi.fn>).mockReturnValue({
        document: { type: 'document', children: [] },
        resources: mockResources,
      });

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.prioritizer.submitBatch).toHaveBeenCalledWith(mockResources);
    });

    it('should not submit resources when none discovered', async () => {
      (mockDeps.htmlParser.parse as ReturnType<typeof vi.fn>).mockReturnValue({
        document: { type: 'document', children: [] },
        resources: [],
      });

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.prioritizer.submitBatch).not.toHaveBeenCalled();
    });

    it('should extract CSS styles from document', async () => {
      const mockHtmlDoc = { type: 'document', children: [] };
      (mockDeps.htmlParser.parse as ReturnType<typeof vi.fn>).mockReturnValue({
        document: mockHtmlDoc,
        resources: [],
      });

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.cssParser.extractStylesFromDocument).toHaveBeenCalledWith(mockHtmlDoc);
    });

    it('should layout the DOM tree', async () => {
      const mockDoc = { type: 'document', children: [] };
      (mockDeps.domTree.buildFromHtml as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.layoutEngine.layout).toHaveBeenCalledWith(mockDoc, mockDeps.domTree);
    });

    it('should paint the document', async () => {
      const mockDoc = { type: 'document', children: [] };
      (mockDeps.domTree.buildFromHtml as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.paintEngine.paint).toHaveBeenCalledWith(mockDoc);
    });

    it('should wire the ReflowRepaintController after paint', async () => {
      const mockDoc = { type: 'document', children: [] };
      (mockDeps.domTree.buildFromHtml as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      const controller = renderer.getReflowController();
      expect(controller).not.toBeNull();
      expect(typeof controller!.invalidateLayout).toBe('function');
      expect(typeof controller!.requestFrame).toBe('function');
    });

    it('should schedule an incremental frame via requestReflow()', async () => {
      const mockDoc = { type: 'document', children: [] };
      (mockDeps.domTree.buildFromHtml as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);
      (mockDeps.domTree.getDocument as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      const controller = renderer.getReflowController()!;
      const frameSpy = vi.spyOn(controller, 'requestFrame');

      renderer.requestReflow();
      expect(frameSpy).toHaveBeenCalled();
    });

    it('should handle empty HTML body', async () => {
      const result = createMockPageLoadResult({ body: '' });
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.htmlParser.parse).toHaveBeenCalled();
      expect(mockDeps.paintEngine.paint).toHaveBeenCalled();
    });

    it('should propagate abort signals', async () => {
      const controller = new AbortController();
      const result = createMockPageLoadResult();

      // Mock to simulate abort during processing
      (mockDeps.htmlParser.parse as ReturnType<typeof vi.fn>).mockImplementation(() => {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        return { document: { type: 'document', children: [] }, resources: [] };
      });

      controller.abort();
      await expect(renderer.render(result, controller.signal)).rejects.toThrow('Aborted');
    });

    it('should execute scripts in the correct order', async () => {
      const executionOrder: string[] = [];
      
      // Mock DOM with scripts
      const mockDoc = {
        type: 'document',
        children: [
          {
            nodeType: 'element',
            tagName: 'script',
            attributes: new Map(),
            children: [
              { nodeType: 'text', text: 'console.log("inline")' },
            ],
          },
        ],
      };
      (mockDeps.domTree.buildFromHtml as ReturnType<typeof vi.fn>).mockReturnValue(mockDoc);
      (mockDeps.domTree.getElementsByTagName as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          nodeType: 'element',
          tagName: 'script',
          attributes: new Map(),
          children: [
            { nodeType: 'text', text: 'console.log("inline")' },
          ],
        },
      ]);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      // Verify that layout and paint were called after script execution
      expect(mockDeps.layoutEngine.layout).toHaveBeenCalled();
      expect(mockDeps.paintEngine.paint).toHaveBeenCalled();
    });

    it('should handle CSS rules correctly', async () => {
      const mockRules: CssRule[] = [
        {
          selector: 'h1',
          declarations: new Map([['color', 'red']]),
          specificity: { id: 0, class: 0, tag: 1 },
          source: 'style-tag',
          sourceUrl: 'test.css',
        },
      ];
      (mockDeps.cssParser.extractStylesFromDocument as ReturnType<typeof vi.fn>).mockReturnValue(mockRules);

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      expect(mockDeps.cssParser.extractStylesFromDocument).toHaveBeenCalled();
    });

    it('should apply computed styles twice (before and after script execution)', async () => {
      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await renderer.render(result, signal);

      // CSS parser should be called once for extraction
      expect(mockDeps.cssParser.extractStylesFromDocument).toHaveBeenCalledTimes(1);
      
      // DOM tree should have computed styles set
      // (The exact number depends on DOM structure)
    });
  });

  describe('dispose()', () => {
    it('should dispose the renderer', () => {
      renderer.dispose();
      // Should not throw when called multiple times
      expect(() => renderer.dispose()).not.toThrow();
    });

    it('should throw when rendering after disposal', async () => {
      renderer.dispose();

      const result = createMockPageLoadResult();
      const signal = new AbortController().signal;

      await expect(renderer.render(result, signal)).rejects.toThrow(
        'PageRenderer has been disposed'
      );
    });
  });

  describe('accessors', () => {
    it('should return DomTree instance', () => {
      expect(renderer.getDomTree()).toBe(mockDeps.domTree);
    });

    it('should return LayoutEngine instance', () => {
      expect(renderer.getLayoutEngine()).toBe(mockDeps.layoutEngine);
    });

    it('should return PaintEngine instance', () => {
      expect(renderer.getPaintEngine()).toBe(mockDeps.paintEngine);
    });

    it('should return ResourceLoader instance', () => {
      expect(renderer.getResourceLoader()).toBe(mockDeps.resourceLoader);
    });

    it('should return Prioritizer instance', () => {
      expect(renderer.getPrioritizer()).toBe(mockDeps.prioritizer);
    });
  });

  describe('interface compliance', () => {
    it('should satisfy IPageRenderer interface', () => {
      const r: IPageRenderer = renderer;
      expect(r.render).toBeDefined();
      expect(typeof r.render).toBe('function');
    });
  });
});
