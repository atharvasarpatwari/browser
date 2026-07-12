import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StatusBar, StatusBarEventBus } from '../src/ui/components/status-bar/status-bar';

describe('StatusBar', () => {
  let bar: StatusBar;

  beforeEach(() => {
    bar = new StatusBar();
  });

  it('should have correct initial state', () => {
    expect(bar.state.statusText).toBe('Ready');
    expect(bar.state.url).toBe('');
    expect(bar.state.protocol).toBe('HTTPS');
    expect(bar.state.secure).toBe(true);
    expect(bar.state.zoom).toBe(100);
    expect(bar.state.blockedCount).toBe(0);
    expect(bar.state.hoverUrl).toBe('');
  });

  it('setStatus should update status text', () => {
    bar.setStatus('Loading...');
    expect(bar.state.statusText).toBe('Loading...');
  });

  it('setUrl should update url', () => {
    bar.setUrl('https://example.com');
    expect(bar.state.url).toBe('https://example.com');
  });

  it('setProtocol should update protocol', () => {
    bar.setProtocol('HTTP');
    expect(bar.state.protocol).toBe('HTTP');
  });

  it('setSecure should update secure state', () => {
    bar.setSecure(false);
    expect(bar.state.secure).toBe(false);
    bar.setSecure(true);
    expect(bar.state.secure).toBe(true);
  });

  it('setZoom should update zoom level', () => {
    bar.setZoom(150);
    expect(bar.state.zoom).toBe(150);
  });

  it('setBlockedCount should update blocked count', () => {
    bar.setBlockedCount(42);
    expect(bar.state.blockedCount).toBe(42);
  });

  it('setHoverUrl should update hover URL', () => {
    bar.setHoverUrl('https://hover.com');
    expect(bar.state.hoverUrl).toBe('https://hover.com');
  });

  it('dispose should clean up', () => {
    bar.dispose();
    expect(bar.state.statusText).toBe('Ready');
  });
});

describe('StatusBarEventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new StatusBarEventBus();
    const handler = vi.fn();
    bus.on('shieldClicked', handler);
    bus.emit({ kind: 'shieldClicked' });
    expect(handler).toHaveBeenCalledTimes(1);
    bus.dispose();
  });

  it('should not call handlers for other event types', () => {
    const bus = new StatusBarEventBus();
    const handler = vi.fn();
    bus.on('shieldClicked', handler);
    bus.emit({ kind: 'zoomChanged', zoom: 150 });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('off should remove a handler', () => {
    const bus = new StatusBarEventBus();
    const handler = vi.fn();
    bus.on('shieldClicked', handler);
    bus.off('shieldClicked', handler);
    bus.emit({ kind: 'shieldClicked' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('dispose should clear all channels', () => {
    const bus = new StatusBarEventBus();
    const handler = vi.fn();
    bus.on('shieldClicked', handler);
    bus.dispose();
    bus.emit({ kind: 'shieldClicked' });
    expect(handler).not.toHaveBeenCalled();
  });
});
