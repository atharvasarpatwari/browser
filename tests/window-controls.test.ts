import { describe, it, expect, vi, afterEach } from 'vitest';
import { WindowControls } from '../src/platform/shared/window-controls';

describe('WindowControls', () => {
  let controls: WindowControls;

  afterEach(() => {
    controls?.dispose();
    vi.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('should initialize from window dimensions and DPI on start', () => {
      controls = new WindowControls();
      controls.start();
      expect(controls.devicePixelRatio).toBeGreaterThanOrEqual(1);
      expect(controls.innerWidth).toBeGreaterThanOrEqual(0);
      expect(controls.innerHeight).toBeGreaterThanOrEqual(0);
      expect(controls.isFullscreen).toBe(false);
    });

    it('should emit a debounced resize event', async () => {
      controls = new WindowControls();
      controls.start();
      const handler = vi.fn();
      controls.on('resize', handler);
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.kind).toBe('resize');
      expect(typeof event.data.width).toBe('number');
      expect(typeof event.data.height).toBe('number');
    });

    it('should not emit resize after stop()', async () => {
      controls = new WindowControls();
      controls.start();
      const handler = vi.fn();
      controls.on('resize', handler);
      controls.stop();
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('fullscreen', () => {
    it('should enter fullscreen on requestFullscreen', async () => {
      controls = new WindowControls();
      controls.start();
      const fsMock = vi.fn().mockResolvedValue(undefined);
      document.documentElement.requestFullscreen = fsMock;
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      const ok = await controls.enterFullscreen();
      expect(ok).toBe(true);
      expect(fsMock).toHaveBeenCalledTimes(1);
      controls.stop();
    });

    it('should exit fullscreen when already fullscreen', async () => {
      controls = new WindowControls();
      controls.start();
      const exitMock = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = exitMock;
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      window.dispatchEvent(new Event('fullscreenchange'));
      expect(controls.isFullscreen).toBe(true);
      const ok = await controls.exitFullscreen();
      expect(ok).toBe(true);
      expect(exitMock).toHaveBeenCalledTimes(1);
      controls.stop();
    });

    it('should toggle fullscreen state', async () => {
      controls = new WindowControls();
      controls.start();
      document.documentElement.requestFullscreen = vi.fn().mockResolvedValue(undefined);
      document.exitFullscreen = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: () => document.documentElement,
      });
      await controls.enterFullscreen();
      window.dispatchEvent(new Event('fullscreenchange'));
      expect(controls.isFullscreen).toBe(true);
      await controls.toggleFullscreen();
      expect(controls.isFullscreen).toBe(false);
      controls.stop();
    });
  });

  describe('high DPI scaling', () => {
    it('should convert CSS pixels to device pixels using DPR', () => {
      controls = new WindowControls();
      controls.start();
      const result = controls.cssToDevicePixels(100, 50);
      expect(result.width).toBe(Math.round(100 * controls.devicePixelRatio));
      expect(result.height).toBe(Math.round(50 * controls.devicePixelRatio));
    });

    it('should convert device pixels back to CSS pixels', () => {
      controls = new WindowControls();
      controls.start();
      const css = controls.deviceToCssPixels(200, 100);
      expect(css.width).toBe(Math.round(200 / controls.devicePixelRatio));
      expect(css.height).toBe(Math.round(100 / controls.devicePixelRatio));
    });

    it('should round-trip CSS -> device -> CSS', () => {
      controls = new WindowControls();
      controls.start();
      const device = controls.cssToDevicePixels(320, 240);
      const css = controls.deviceToCssPixels(device.width, device.height);
      expect(css.width).toBe(320);
      expect(css.height).toBe(240);
    });
  });
});
