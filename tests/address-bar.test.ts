import { describe, it, expect, vi } from 'vitest';
import { AddressBar, AddressBarEventBus } from '../src/ui/components/address-bar/address-bar';

describe('AddressBar', () => {
  const bar = new AddressBar();

  it('should have initial empty state', () => {
    const state = bar.state;
    expect(state.value).toBe('');
    expect(state.focused).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.secure).toBe(false);
    expect(state.hostname).toBe('');
  });

  it('setValue should update state and emit events', () => {
    const bar2 = new AddressBar();
    const handler = vi.fn();
    bar2.on('inputChanged', handler);

    bar2.setValue('hello');

    const state = bar2.state;
    expect(state.value).toBe('hello');
    expect(handler).toHaveBeenCalled();
  });

  it('setLoading should update loading state', () => {
    bar.setLoading(true);
    expect(bar.state.loading).toBe(true);
    bar.setLoading(false);
    expect(bar.state.loading).toBe(false);
  });

  it('setSecure should update secure state', () => {
    bar.setSecure(true);
    expect(bar.state.secure).toBe(true);
    bar.setSecure(false);
    expect(bar.state.secure).toBe(false);
  });

  it('setSuggestions should update suggestions', () => {
    const suggestions = ['https://example.com', 'https://google.com'];
    bar.setSuggestions(suggestions);
    expect(bar.state.suggestions).toEqual(suggestions);
  });

  it('focus should set focused to true and emit focus event', () => {
    const bar2 = new AddressBar();
    const handler = vi.fn();
    bar2.on('focus', handler);
    bar2.focus();
    expect(bar2.state.focused).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it('blur should set focused to false and emit blur event', () => {
    const bar2 = new AddressBar();
    const handler = vi.fn();
    bar2.on('blur', handler);
    bar2.focus();
    bar2.blur();
    expect(bar2.state.focused).toBe(false);
    expect(handler).toHaveBeenCalled();
  });

  it('clear should reset value and suggestions', () => {
    bar.setValue('test');
    bar.setSuggestions(['a', 'b']);
    bar.clear();
    expect(bar.state.value).toBe('');
    expect(bar.state.suggestions).toEqual([]);
  });

  it('should emit navigate event for valid URL', () => {
    const bar2 = new AddressBar();
    const navigateHandler = vi.fn();
    bar2.on('navigate', navigateHandler);
    bar2.setValue('https://example.com');
    expect(navigateHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'navigate' })
    );
  });

  it('on/off should manage event handlers', () => {
    const bar2 = new AddressBar();
    const handler = vi.fn();
    bar2.on('focus', handler);
    bar2.focus();
    expect(handler).toHaveBeenCalledTimes(1);
    bar2.off('focus', handler);
    bar2.focus();
    bar2.focus();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose should clean up', () => {
    const bar2 = new AddressBar();
    bar2.setValue('test');
    bar2.setSuggestions(['a']);
    bar2.dispose();
    expect(bar2.state.suggestions).toEqual([]);
  });
});

describe('AddressBarEventBus', () => {
  const bus = new AddressBarEventBus();

  it('should emit events to registered handlers', () => {
    const handler = vi.fn();
    bus.on('focus', handler);
    bus.emit({ kind: 'focus' });
    expect(handler).toHaveBeenCalledWith({ kind: 'focus' });
  });

  it('should not call handlers for other event types', () => {
    const handler = vi.fn();
    bus.on('blur', handler);
    bus.emit({ kind: 'focus' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off should remove a handler', () => {
    const handler = vi.fn();
    bus.on('blur', handler);
    bus.off('blur', handler);
    bus.emit({ kind: 'blur' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should not throw when emitting to unregistered type', () => {
    expect(() => bus.emit({ kind: 'navigate', url: 'http://example.com' } as any)).not.toThrow();
  });

  it('dispose should clear all channels', () => {
    const b = new AddressBarEventBus();
    const handler = vi.fn();
    b.on('focus', handler);
    b.dispose();
    b.emit({ kind: 'focus' });
    expect(handler).not.toHaveBeenCalled();
  });
});
