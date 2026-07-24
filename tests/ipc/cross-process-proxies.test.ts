import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CrossProcessPageLoader } from '../../src/common/ipc/cross-process-page-loader';
import { CrossProcessPageRenderer } from '../../src/common/ipc/cross-process-page-renderer';
import type { IChannel } from '../../src/common/ipc/channel';

describe('CrossProcessPageLoader', () => {
  let mockChannel: IChannel;
  let loader: CrossProcessPageLoader;

  beforeEach(() => {
    mockChannel = {
      request: vi.fn(),
      subscribe: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    } as any;
    loader = new CrossProcessPageLoader(mockChannel);
  });

  describe('load', () => {
    it('should send load-page request to channel', async () => {
      const expectedResult = { success: true, title: 'Example', url: 'https://example.com' };
      (mockChannel.request as any).mockResolvedValue(expectedResult);

      const result = await loader.load('https://example.com');

      expect(mockChannel.request).toHaveBeenCalledWith('load-page', { url: 'https://example.com' });
      expect(result).toEqual(expectedResult);
    });

    it('should handle load errors', async () => {
      (mockChannel.request as any).mockRejectedValue(new Error('Network error'));

      await expect(loader.load('https://example.com')).rejects.toThrow('Network error');
    });
  });

  describe('loadHTML', () => {
    it('should send load-html request to channel', async () => {
      const expectedResult = { success: true, title: 'Test', url: 'about:blank' };
      (mockChannel.request as any).mockResolvedValue(expectedResult);

      const result = await loader.loadHTML('<h1>Hello</h1>', 'https://test.com');

      expect(mockChannel.request).toHaveBeenCalledWith('load-html', {
        html: '<h1>Hello</h1>',
        baseUrl: 'https://test.com',
      });
      expect(result).toEqual(expectedResult);
    });

    it('should handle optional baseUrl', async () => {
      const expectedResult = { success: true, title: 'Test', url: 'about:blank' };
      (mockChannel.request as any).mockResolvedValue(expectedResult);

      await loader.loadHTML('<h1>Hello</h1>');

      expect(mockChannel.request).toHaveBeenCalledWith('load-html', {
        html: '<h1>Hello</h1>',
        baseUrl: undefined,
      });
    });
  });

  describe('progress', () => {
    it('should subscribe to load-progress channel', () => {
      const handler = vi.fn();
      loader.onProgress(handler);

      expect(mockChannel.subscribe).toHaveBeenCalledWith('load-progress', expect.any(Function));
    });

    it('should unsubscribe from progress channel', () => {
      const unsubscribe = vi.fn();
      (mockChannel.subscribe as any).mockReturnValue(unsubscribe);

      const handler = vi.fn();
      loader.onProgress(handler);
      loader.offProgress(handler);

      // Note: The actual unsubscription happens when the same handler reference is removed
    });
  });

  describe('abort', () => {
    it('should send abort-load message', () => {
      loader.abort();
      expect(mockChannel.send).toHaveBeenCalledWith('abort-load', {});
    });
  });

  describe('dispose', () => {
    it('should clean up subscriptions', () => {
      const unsubscribe = vi.fn();
      (mockChannel.subscribe as any).mockReturnValue(unsubscribe);

      const handler = vi.fn();
      loader.onProgress(handler);
      loader.dispose();

      // After dispose, the loader should be cleaned up
    });
  });
});

describe('CrossProcessPageRenderer', () => {
  let mockChannel: IChannel;
  let renderer: CrossProcessPageRenderer;

  beforeEach(() => {
    mockChannel = {
      request: vi.fn(),
      subscribe: vi.fn(),
      send: vi.fn(),
      dispose: vi.fn(),
    } as any;
    renderer = new CrossProcessPageRenderer(mockChannel);
  });

  describe('render', () => {
    it('should send render-page request to channel', async () => {
      (mockChannel.request as any).mockResolvedValue(undefined);

      await renderer.render({ document: 'test' });

      expect(mockChannel.request).toHaveBeenCalledWith('render-page', { document: { document: 'test' } });
    });

    it('should handle render errors', async () => {
      (mockChannel.request as any).mockRejectedValue(new Error('Render failed'));

      await expect(renderer.render({})).rejects.toThrow('Render failed');
    });
  });

  describe('getLayoutTreeAsync', () => {
    it('should send get-layout-tree request to channel', async () => {
      const layoutTree = { width: 1024, height: 768 };
      (mockChannel.request as any).mockResolvedValue(layoutTree);

      const result = await renderer.getLayoutTreeAsync();

      expect(mockChannel.request).toHaveBeenCalledWith('get-layout-tree', {});
      expect(result).toEqual(layoutTree);
    });
  });

  describe('getLayoutTree (sync)', () => {
    it('should throw error for sync operation', () => {
      expect(() => renderer.getLayoutTree()).toThrow('getLayoutTree() is not supported in cross-process mode');
    });
  });

  describe('render complete', () => {
    it('should subscribe to render-complete channel', () => {
      const handler = vi.fn();
      renderer.onRenderComplete(handler);

      expect(mockChannel.subscribe).toHaveBeenCalledWith('render-complete', expect.any(Function));
    });

    it('should unsubscribe from render-complete channel', () => {
      const unsubscribe = vi.fn();
      (mockChannel.subscribe as any).mockReturnValue(unsubscribe);

      const handler = vi.fn();
      renderer.onRenderComplete(handler);
      renderer.offRenderComplete(handler);

      // Note: The actual unsubscription happens when the same handler reference is removed
    });
  });

  describe('dispose', () => {
    it('should clean up subscriptions', () => {
      const unsubscribe = vi.fn();
      (mockChannel.subscribe as any).mockReturnValue(unsubscribe);

      const handler = vi.fn();
      renderer.onRenderComplete(handler);
      renderer.dispose();

      // After dispose, the renderer should be cleaned up
    });
  });
});
