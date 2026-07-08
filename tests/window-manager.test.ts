import { describe, it, expect, vi } from 'vitest';
import { WindowManager } from '../src/platform/desktop/window-manager';

describe('WindowManager', () => {
  const wm = new WindowManager();

  it('should start with zero windows', () => {
    expect(wm.count).toBe(0);
    expect(wm.windows).toHaveLength(0);
    expect(wm.activeWindowId).toBeNull();
  });

  it('should create a window', () => {
    const win = wm.createWindow({ title: 'Test Window' });
    expect(win.id).toBeTruthy();
    expect(wm.count).toBe(1);
  });

  it('should return window info for a created window', () => {
    wm.createWindow({ title: 'Another' });
    const firstId = wm.windows[0]!.id;
    const info = wm.getWindowInfo(firstId);
    expect(info).not.toBeNull();
    expect(info!.title).toBe('Test Window');
  });

  it('should return null for non-existent window info', () => {
    expect(wm.getWindowInfo('nonexistent')).toBeNull();
  });

  it('should allow setting window bounds', () => {
    const id = wm.windows[0]!.id;
    const result = wm.setWindowBounds(id, { width: 800, height: 600 });
    expect(result).toBe(true);
    const info = wm.getWindowInfo(id);
    expect(info!.width).toBe(800);
    expect(info!.height).toBe(600);
  });

  it('should setWindowBounds return false for unknown window', () => {
    expect(wm.setWindowBounds('nope', { width: 100 })).toBe(false);
  });

  it('should minimize a window', () => {
    const id = wm.windows[0]!.id;
    expect(wm.minimizeWindow(id)).toBe(true);
    expect(wm.getWindowInfo(id)!.state).toBe('minimized');
  });

  it('should maximize a window', () => {
    const id = wm.windows[1]!.id;
    expect(wm.maximizeWindow(id)).toBe(true);
    expect(wm.getWindowInfo(id)!.state).toBe('maximized');
  });

  it('should restore a window', () => {
    const id = wm.windows[0]!.id;
    expect(wm.restoreWindow(id)).toBe(true);
    expect(wm.getWindowInfo(id)!.state).toBe('normal');
  });

  it('should minimize/maximize/restore return false for unknown window', () => {
    expect(wm.minimizeWindow('nope')).toBe(false);
    expect(wm.maximizeWindow('nope')).toBe(false);
    expect(wm.restoreWindow('nope')).toBe(false);
  });

  it('should getWindow return an IWindow for valid id', () => {
    const id = wm.windows[0]!.id;
    const win = wm.getWindow(id);
    expect(win).not.toBeNull();
    expect(win!.id).toBe(id);
  });

  it('should getWindow return null for invalid id', () => {
    expect(wm.getWindow('nope')).toBeNull();
  });

  it('should not activate a closed or non-existent window', () => {
    expect(wm.activateWindow('nope')).toBe(false);
  });

  it('should getWindowInfo return null for unknown id', () => {
    expect(wm.getWindowInfo('nope')).toBeNull();
  });

  it('should emit windowCreated on createWindow', () => {
    const wm2 = new WindowManager();
    const handler = vi.fn();
    wm2.on('windowCreated', handler);
    wm2.createWindow({ title: 'Event Test' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'windowCreated' })
    );
  });

  it('should allow subscribing and unsubscribing from events', () => {
    const wm3 = new WindowManager();
    const handler = vi.fn();
    wm3.on('windowCreated', handler);
    wm3.createWindow({ title: 'A' });
    expect(handler).toHaveBeenCalledTimes(1);
    wm3.off('windowCreated', handler);
    wm3.createWindow({ title: 'B' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit windowStateChanged on minimize', () => {
    const wm4 = new WindowManager();
    const handler = vi.fn();
    wm4.on('windowStateChanged', handler);
    const id = wm4.createWindow({}).id;
    wm4.minimizeWindow(id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'windowStateChanged', windowId: id })
    );
  });

  it('should emit windowBoundsChanged on setWindowBounds', () => {
    const wm5 = new WindowManager();
    const handler = vi.fn();
    wm5.on('windowBoundsChanged', handler);
    const id = wm5.createWindow({}).id;
    wm5.setWindowBounds(id, { x: 50 });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'windowBoundsChanged', windowId: id })
    );
  });

  it('closeWindow should remove the window', async () => {
    const wm6 = new WindowManager();
    const id = wm6.createWindow({}).id;
    expect(wm6.count).toBe(1);
    const result = await wm6.closeWindow(id);
    expect(result).toBe(true);
    expect(wm6.count).toBe(0);
  });

  it('closeWindow should return false for unknown id', async () => {
    const wm7 = new WindowManager();
    expect(await wm7.closeWindow('nope')).toBe(false);
  });

  it('dispose should close all windows', () => {
    const wm8 = new WindowManager();
    wm8.createWindow({});
    wm8.createWindow({});
    expect(wm8.count).toBe(2);
    wm8.dispose();
    expect(wm8.count).toBe(0);
  });
});
