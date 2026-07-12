import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Toolbar, ToolbarEventBus } from '../src/ui/components/toolbar/toolbar';

describe('Toolbar', () => {
  let toolbar: Toolbar;

  beforeEach(() => {
    toolbar = new Toolbar();
  });

  it('should have correct initial state', () => {
    expect(toolbar.state.canGoBack).toBe(false);
    expect(toolbar.state.canGoForward).toBe(false);
    expect(toolbar.state.loading).toBe(false);
    expect(toolbar.state.shieldEnabled).toBe(true);
  });

  it('setCanGoBack should update state', () => {
    toolbar.setCanGoBack(true);
    expect(toolbar.state.canGoBack).toBe(true);
    toolbar.setCanGoBack(false);
    expect(toolbar.state.canGoBack).toBe(false);
  });

  it('setCanGoForward should update state', () => {
    toolbar.setCanGoForward(true);
    expect(toolbar.state.canGoForward).toBe(true);
  });

  it('setLoading should update state', () => {
    toolbar.setLoading(true);
    expect(toolbar.state.loading).toBe(true);
    toolbar.setLoading(false);
    expect(toolbar.state.loading).toBe(false);
  });

  it('setShieldEnabled should update state', () => {
    toolbar.setShieldEnabled(false);
    expect(toolbar.state.shieldEnabled).toBe(false);
  });

  it('toggleShield should flip shield state', () => {
    expect(toolbar.state.shieldEnabled).toBe(true);
    toolbar.toggleShield();
    expect(toolbar.state.shieldEnabled).toBe(false);
    toolbar.toggleShield();
    expect(toolbar.state.shieldEnabled).toBe(true);
  });

  it('goBack should emit back event', () => {
    const handler = vi.fn();
    toolbar.on('back', handler);
    toolbar.goBack();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('goForward should emit forward event', () => {
    const handler = vi.fn();
    toolbar.on('forward', handler);
    toolbar.goForward();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('reload should emit reload event', () => {
    const handler = vi.fn();
    toolbar.on('reload', handler);
    toolbar.reload();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stop should emit stop event', () => {
    const handler = vi.fn();
    toolbar.on('stop', handler);
    toolbar.stop();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('toggleShield should emit shieldToggle event', () => {
    const handler = vi.fn();
    toolbar.on('shieldToggle', handler);
    toolbar.toggleShield();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'shieldToggle', enabled: false })
    );
  });

  it('showMenu should emit menuClick event', () => {
    const handler = vi.fn();
    toolbar.on('menuClick', handler);
    toolbar.showMenu();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('addBookmark should emit bookmarkAdd event', () => {
    const handler = vi.fn();
    toolbar.on('bookmarkAdd', handler);
    toolbar.addBookmark();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose should clean up', () => {
    const handler = vi.fn();
    toolbar.on('back', handler);
    toolbar.dispose();
    toolbar.goBack();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('ToolbarEventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new ToolbarEventBus();
    const handler = vi.fn();
    bus.on('back', handler);
    bus.emit({ kind: 'back' });
    expect(handler).toHaveBeenCalledTimes(1);
    bus.dispose();
  });

  it('should not call handlers for other event types', () => {
    const bus = new ToolbarEventBus();
    const handler = vi.fn();
    bus.on('forward', handler);
    bus.emit({ kind: 'back' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('off should remove a handler', () => {
    const bus = new ToolbarEventBus();
    const handler = vi.fn();
    bus.on('reload', handler);
    bus.off('reload', handler);
    bus.emit({ kind: 'reload' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('dispose should clear all channels', () => {
    const bus = new ToolbarEventBus();
    const handler = vi.fn();
    bus.on('stop', handler);
    bus.dispose();
    bus.emit({ kind: 'stop' });
    expect(handler).not.toHaveBeenCalled();
  });
});
