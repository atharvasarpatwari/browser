import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabStrip, TabStripEventBus } from '../src/ui/components/tab-strip/tab-strip';
import { TabManager } from '../src/browser/tabs/tab-manager';

describe('TabStrip', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  it('should have empty initial state with no tabs', () => {
    const strip = new TabStrip(manager);
    expect(strip.state.tabs).toEqual([]);
    expect(strip.state.activeTabId).toBeNull();
    strip.dispose();
  });

  it('should reflect tabs from manager after sync', () => {
    manager.createTab();
    const strip = new TabStrip(manager);
    expect(strip.state.tabs.length).toBe(1);
    expect(strip.state.activeTabId).toBeTruthy();
    strip.dispose();
  });

  it('should update when a new tab is created', () => {
    const strip = new TabStrip(manager);
    manager.createTab();
    strip.syncWithManager();
    expect(strip.state.tabs.length).toBe(1);
    strip.dispose();
  });

  it('should update when a tab is removed', () => {
    const tab1 = manager.createTab();
    const tab2 = manager.createTab();
    const strip = new TabStrip(manager);
    expect(strip.state.tabs.length).toBe(2);
    manager.removeTab(tab1.id);
    strip.syncWithManager();
    expect(strip.state.tabs.length).toBe(1);
    strip.dispose();
  });

  it('should track active tab', () => {
    const tab1 = manager.createTab();
    const tab2 = manager.createTab();
    const strip = new TabStrip(manager);
    expect(strip.state.activeTabId).toBe(tab2.id);
    strip.selectTab(tab1.id);
    expect(strip.state.activeTabId).toBe(tab1.id);
    strip.dispose();
  });

  it('should emit tabSelected event on selectTab', () => {
    const tab = manager.createTab();
    const strip = new TabStrip(manager);
    const handler = vi.fn();
    strip.on('tabSelected', handler);
    strip.selectTab(tab.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tabSelected', tabId: tab.id })
    );
    strip.dispose();
  });

  it('should emit tabClosed event on closeTab', () => {
    const tab = manager.createTab();
    const strip = new TabStrip(manager);
    const handler = vi.fn();
    strip.on('tabClosed', handler);
    strip.closeTab(tab.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tabClosed', tabId: tab.id })
    );
    strip.dispose();
  });

  it('should emit newTabRequested event', () => {
    const strip = new TabStrip(manager);
    const handler = vi.fn();
    strip.on('newTabRequested', handler);
    strip.requestNewTab();
    expect(handler).toHaveBeenCalledTimes(1);
    strip.dispose();
  });

  it('should reflect tab data correctly', () => {
    const tab = manager.createTab();
    tab.setTitle('Test Title');
    const strip = new TabStrip(manager);
    const tabData = strip.state.tabs[0];
    expect(tabData.id).toBe(tab.id);
    expect(tabData.title).toBe('Test Title');
    expect(tabData.active).toBe(true);
    expect(tabData.loading).toBe(false);
    strip.dispose();
  });

  it('dispose should clean up', () => {
    const strip = new TabStrip(manager);
    const handler = vi.fn();
    strip.on('tabSelected', handler);
    strip.dispose();
    expect(strip.state.tabs).toEqual([]);
  });
});

describe('TabStripEventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new TabStripEventBus();
    const handler = vi.fn();
    bus.on('tabSelected', handler);
    bus.emit({ kind: 'tabSelected', tabId: 'tab-1' });
    expect(handler).toHaveBeenCalledWith({ kind: 'tabSelected', tabId: 'tab-1' });
    bus.dispose();
  });

  it('should not call handlers for other event types', () => {
    const bus = new TabStripEventBus();
    const handler = vi.fn();
    bus.on('tabClosed', handler);
    bus.emit({ kind: 'tabSelected', tabId: 'tab-1' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('off should remove a handler', () => {
    const bus = new TabStripEventBus();
    const handler = vi.fn();
    bus.on('newTabRequested', handler);
    bus.off('newTabRequested', handler);
    bus.emit({ kind: 'newTabRequested' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('dispose should clear all channels', () => {
    const bus = new TabStripEventBus();
    const handler = vi.fn();
    bus.on('tabSelected', handler);
    bus.dispose();
    bus.emit({ kind: 'tabSelected', tabId: 'tab-1' });
    expect(handler).not.toHaveBeenCalled();
  });
});
