/**
 * @file tests/page-loader.test.ts
 *
 * Tests for the PageLoader class that wraps IResourceLoader and implements
 * the IPageLoader interface for loading web pages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageLoader } from '../src/browser/engine/page-loader';
import type { IResourceLoader, ResourceLoadResult } from '../src/browser/networking/resource-loader';
import type { IPageLoader } from '../src/browser/engine/browser-engine';

// ── Mock ResourceLoader ─────────────────────────────────────────────────────

function createMockResourceLoader(): IResourceLoader {
  return {
    loadResource: vi.fn(),
    loadBatch: vi.fn(),
    loadStylesheet: vi.fn(),
    loadScript: vi.fn(),
    loadImage: vi.fn(),
    getPriority: vi.fn(),
    setMaxConcurrent: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispose: vi.fn(),
  };
}

function createMockLoadResult(overrides?: Partial<ResourceLoadResult>): ResourceLoadResult {
  return {
    url: 'https://example.com',
    kind: 'document',
    statusCode: 200,
    contentType: 'text/html',
    body: '<html><body>Hello</body></html>',
    bodyBinary: null,
    headers: new Map([['content-type', 'text/html']]),
    loadedAt: Date.now(),
    durationMs: 100,
    fromCache: false,
    error: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('PageLoader', () => {
  let mockLoader: IResourceLoader;
  let pageLoader: PageLoader;

  beforeEach(() => {
    mockLoader = createMockResourceLoader();
    pageLoader = new PageLoader(mockLoader);
  });

  describe('constructor', () => {
    it('should create a PageLoader implementing IPageLoader', () => {
      expect(pageLoader).toBeDefined();
      expect(typeof pageLoader.load).toBe('function');
      expect(typeof pageLoader.dispose).toBe('function');
    });
  });

  describe('load()', () => {
    it('should load a page successfully', async () => {
      const mockResult = createMockLoadResult();
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      const result = await pageLoader.load('https://example.com', signal);

      expect(result.url).toBe('https://example.com');
      expect(result.statusCode).toBe(200);
      expect(result.contentType).toBe('text/html');
      expect(result.body).toBe('<html><body>Hello</body></html>');
      expect(result.headers).toBe(mockResult.headers);
      expect(result.loadedAt).toBe(mockResult.loadedAt);
    });

    it('should call loadResource with correct parameters', async () => {
      const mockResult = createMockLoadResult();
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      await pageLoader.load('https://example.com/page', signal);

      expect(mockLoader.loadResource).toHaveBeenCalledWith(
        'https://example.com/page',
        'document',
        { signal }
      );
    });

    it('should map ResourceLoadResult to PageLoadResult correctly', async () => {
      const mockResult = createMockLoadResult({
        url: 'https://different.com',
        statusCode: 404,
        contentType: 'text/plain',
        body: 'Not Found',
        headers: new Map([['x-custom', 'value']]),
        loadedAt: 1234567890,
      });
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      const result = await pageLoader.load('https://different.com', signal);

      expect(result.url).toBe('https://different.com');
      expect(result.statusCode).toBe(404);
      expect(result.contentType).toBe('text/plain');
      expect(result.body).toBe('Not Found');
      expect(result.headers.get('x-custom')).toBe('value');
      expect(result.loadedAt).toBe(1234567890);
    });

    it('should propagate abort signals', async () => {
      const controller = new AbortController();
      const mockResult = createMockLoadResult();
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        })
      );

      const loadPromise = pageLoader.load('https://example.com', controller.signal);
      controller.abort();

      await expect(loadPromise).rejects.toThrow('Aborted');
    });

    it('should handle network errors gracefully', async () => {
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network error')
      );

      const signal = new AbortController().signal;
      await expect(pageLoader.load('https://example.com', signal)).rejects.toThrow(
        'Failed to load page from https://example.com: Network error'
      );
    });

    it('should handle non-Error thrown values', async () => {
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockRejectedValue('string error');

      const signal = new AbortController().signal;
      await expect(pageLoader.load('https://example.com', signal)).rejects.toThrow(
        'Failed to load page from https://example.com: string error'
      );
    });

    it('should re-throw AbortError as-is', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockRejectedValue(abortError);

      const signal = new AbortController().signal;
      await expect(pageLoader.load('https://example.com', signal)).rejects.toBe(abortError);
    });

    it('should return correct PageLoadResult structure', async () => {
      const mockResult = createMockLoadResult();
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      const result = await pageLoader.load('https://example.com', signal);

      expect(result).toHaveProperty('url');
      expect(result).toHaveProperty('statusCode');
      expect(result).toHaveProperty('contentType');
      expect(result).toHaveProperty('body');
      expect(result).toHaveProperty('headers');
      expect(result).toHaveProperty('loadedAt');
      expect(Object.keys(result)).toHaveLength(6);
    });

    it('should handle different HTTP status codes', async () => {
      const mockResult = createMockLoadResult({ statusCode: 500 });
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      const result = await pageLoader.load('https://example.com', signal);

      expect(result.statusCode).toBe(500);
    });

    it('should handle empty body', async () => {
      const mockResult = createMockLoadResult({ body: '' });
      (mockLoader.loadResource as ReturnType<typeof vi.fn>).mockResolvedValue(mockResult);

      const signal = new AbortController().signal;
      const result = await pageLoader.load('https://example.com', signal);

      expect(result.body).toBe('');
    });
  });

  describe('dispose()', () => {
    it('should dispose the loader', () => {
      pageLoader.dispose();
      // Should not throw when called multiple times
      expect(() => pageLoader.dispose()).not.toThrow();
    });

    it('should throw when loading after disposal', async () => {
      pageLoader.dispose();

      const signal = new AbortController().signal;
      await expect(pageLoader.load('https://example.com', signal)).rejects.toThrow(
        'PageLoader has been disposed'
      );
    });
  });

  describe('interface compliance', () => {
    it('should satisfy IPageLoader interface', () => {
      const loader: IPageLoader = pageLoader;
      expect(loader.load).toBeDefined();
      expect(typeof loader.load).toBe('function');
    });
  });
});
