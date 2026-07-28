import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PdfParser, PdfCanvasRenderer, PdfViewer, createPdfViewer,
  DEFAULT_PDF_RENDERER_CONFIG, type PdfDocument, type PdfDrawOp,
} from '../src/browser/pdf-viewer/pdf-renderer';

// ── PdfParser ──

describe('PdfParser', () => {
  it('throws on invalid header', () => {
    const data = new TextEncoder().encode('NOT-PDF');
    const parser = new PdfParser(data);
    expect(() => parser.parse()).toThrow('Invalid PDF');
  });

  it('parses minimal valid PDF', () => {
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>
endobj
xref
0 4
0000000000 65535 f 
trailer
<< /Size 4 /Root 1 0 R >>
startxref
200
%%EOF`;
    const parser = new PdfParser(new TextEncoder().encode(pdf));
    const doc = parser.parse();
    expect(doc.version).toBe('1.4');
    expect(doc.pageCount).toBe(1);
    expect(doc.pages[0].width).toBe(612);
    expect(doc.pages[0].height).toBe(792);
  });

  it('parses PDF with no pages (fallback)', () => {
    const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog >>
endobj
%%EOF`;
    const parser = new PdfParser(new TextEncoder().encode(pdf));
    const doc = parser.parse();
    expect(doc.pageCount).toBe(1); // fallback page
  });
});

// ── PdfCanvasRenderer ──

describe('PdfCanvasRenderer', () => {
  function mockCanvas(): any {
    const ctx = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      fillStyle: '',
      font: '',
    };
    return {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(ctx),
      _ctx: ctx,
    };
  }

  it('renders page to canvas', () => {
    const renderer = new PdfCanvasRenderer(DEFAULT_PDF_RENDERER_CONFIG);
    const canvas = mockCanvas();
    const page = {
      pageNumber: 1, width: 612, height: 792, rotation: 0,
      textContent: '', textSegments: [], images: [], drawOps: [],
    };
    renderer.renderPage(canvas, page, 1.5);
    expect(canvas.width).toBe(612 * 1.5);
    expect(canvas.height).toBe(792 * 1.5);
    expect(canvas._ctx.fillRect).toHaveBeenCalled();
  });

  it('renders rotated page', () => {
    const renderer = new PdfCanvasRenderer(DEFAULT_PDF_RENDERER_CONFIG);
    const canvas = mockCanvas();
    const page = {
      pageNumber: 1, width: 612, height: 792, rotation: 90,
      textContent: '', textSegments: [], images: [], drawOps: [],
    };
    renderer.renderPage(canvas, page, 1.0);
    expect(canvas.width).toBe(792); // swapped
    expect(canvas.height).toBe(612);
  });

  it('renders text segments', () => {
    const renderer = new PdfCanvasRenderer(DEFAULT_PDF_RENDERER_CONFIG);
    const canvas = mockCanvas();
    const page = {
      pageNumber: 1, width: 612, height: 792, rotation: 0,
      textContent: 'Hello', textSegments: [
        { text: 'Hello', x: 10, y: 20, fontSize: 12, fontFamily: 'serif', fontWeight: 'normal', color: '#000', width: 50, height: 14 },
      ], images: [], drawOps: [],
    };
    renderer.renderPage(canvas, page, 1.0);
    expect(canvas._ctx.fillText).toHaveBeenCalledWith('Hello', 10, 20);
  });

  it('handles null context gracefully', () => {
    const renderer = new PdfCanvasRenderer(DEFAULT_PDF_RENDERER_CONFIG);
    const canvas = { width: 0, height: 0, getContext: vi.fn().mockReturnValue(null) };
    const page = {
      pageNumber: 1, width: 612, height: 792, rotation: 0,
      textContent: '', textSegments: [], images: [], drawOps: [],
    };
    expect(() => renderer.renderPage(canvas as any, page, 1.0)).not.toThrow();
  });

  it('executes draw operations', () => {
    const renderer = new PdfCanvasRenderer(DEFAULT_PDF_RENDERER_CONFIG);
    const canvas = mockCanvas();
    const drawOps: PdfDrawOp[] = [
      { type: 'fill-rect', args: [0, 0, 100, 100] },
      { type: 'stroke-rect', args: [10, 10, 50, 50] },
      { type: 'set-color', args: ['#ff0000'] },
      { type: 'set-font', args: ['12px serif'] },
      { type: 'fill-text', args: ['test', 0, 0] },
      { type: 'move-to', args: [0, 0] },
      { type: 'line-to', args: [10, 10] },
      { type: 'stroke', args: [] },
      { type: 'fill', args: [] },
      { type: 'save', args: [] },
      { type: 'restore', args: [] },
    ];
    const page = {
      pageNumber: 1, width: 100, height: 100, rotation: 0,
      textContent: '', textSegments: [], images: [], drawOps,
    };
    renderer.renderPage(canvas, page, 1.0);
    expect(canvas._ctx.fillRect).toHaveBeenCalled();
    expect(canvas._ctx.strokeRect).toHaveBeenCalled();
    expect(canvas._ctx.fillText).toHaveBeenCalled();
  });
});

// ── PdfViewer ──

describe('PdfViewer', () => {
  let viewer: PdfViewer;

  beforeEach(() => {
    viewer = createPdfViewer();
  });

  it('starts with no document', () => {
    expect(viewer.getDocument()).toBeUndefined();
    expect(viewer.getPageCount()).toBe(0);
    expect(viewer.getCurrentPage()).toBe(1); // default page number
  });

  it('loads valid PDF buffer', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
5 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    const handler = vi.fn();
    viewer.onEvent(handler);
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    expect(viewer.getDocument()).toBeDefined();
    expect(viewer.getPageCount()).toBe(3);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'document-loaded' }));
  });

  it('emits error for invalid PDF', () => {
    const handler = vi.fn();
    viewer.onEvent(handler);
    viewer.loadFromBuffer(new TextEncoder().encode('garbage'));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('page navigation works', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    expect(viewer.getCurrentPage()).toBe(1);
    viewer.nextPage();
    expect(viewer.getCurrentPage()).toBe(2);
    viewer.nextPage();
    expect(viewer.getCurrentPage()).toBe(2); // clamped
    viewer.previousPage();
    expect(viewer.getCurrentPage()).toBe(1);
    viewer.previousPage();
    expect(viewer.getCurrentPage()).toBe(1); // clamped
  });

  it('goToPage clamps to valid range', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    viewer.goToPage(100);
    expect(viewer.getCurrentPage()).toBe(1);
    viewer.goToPage(0);
    expect(viewer.getCurrentPage()).toBe(1);
  });

  it('zoom controls work', () => {
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.defaultScale);
    viewer.zoomIn();
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.defaultScale + DEFAULT_PDF_RENDERER_CONFIG.scaleStep);
    viewer.zoomOut();
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.defaultScale);
    viewer.resetZoom();
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.defaultScale);
  });

  it('setScale clamps to min/max', () => {
    viewer.setScale(0.01);
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.minScale);
    viewer.setScale(100);
    expect(viewer.getScale()).toBe(DEFAULT_PDF_RENDERER_CONFIG.maxScale);
  });

  it('search returns empty for no document', () => {
    expect(viewer.search('hello')).toEqual([]);
  });

  it('search returns empty for empty query', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    expect(viewer.search('')).toEqual([]);
  });

  it('getMetadata returns undefined for no document', () => {
    expect(viewer.getMetadata()).toBeUndefined();
  });

  it('dispose clears document', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    viewer.dispose();
    expect(viewer.getDocument()).toBeUndefined();
  });

  it('unsubscribe stops events', () => {
    const handler = vi.fn();
    const unsub = viewer.onEvent(handler);
    unsub();
    const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj
%%EOF`;
    viewer.loadFromBuffer(new TextEncoder().encode(pdf));
    expect(handler).not.toHaveBeenCalled();
  });
});

// ── Default Config ──

describe('DEFAULT_PDF_RENDERER_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_PDF_RENDERER_CONFIG.defaultScale).toBeGreaterThan(0);
    expect(DEFAULT_PDF_RENDERER_CONFIG.minScale).toBeLessThan(DEFAULT_PDF_RENDERER_CONFIG.maxScale);
    expect(DEFAULT_PDF_RENDERER_CONFIG.scaleStep).toBeGreaterThan(0);
    expect(DEFAULT_PDF_RENDERER_CONFIG.renderQuality).toBeGreaterThanOrEqual(1);
  });
});
