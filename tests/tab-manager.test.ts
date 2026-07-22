import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabManager } from '../src/browser/tabs/tab-manager';
import type { TabManagerEventUnion } from '../src/browser/tabs/tab-manager';

describe('TabManager', () => {
  let manager: TabManager;

  beforeEach(() => {
    manager = new TabManager();
  });

  describe('Creation', () => {
    it('createTab returns ITabSession with valid ID', () => {
      const tab = manager.createTab();
      expect(tab).toBeDefined();
      expect(typeof tab.id).toBe('string');
      expect(tab.id.length).toBeGreaterThan(0);
    });

    it('createTab with default URL about:blank', () => {
      const tab = manager.createTab();
      expect(tab.url).toBe('about:blank');
    });

    it('createTab with custom URL', () => {
      const tab = manager.createTab('https://example.com');
      expect(tab.url).toBe('https://example.com');
    });

    it('createTab auto-activates new tab', () => {
      const tab = manager.createTab();
      expect(manager.activeTabId).toBe(tab.id);
    });
  });

  describe('Removal', () => {
    it('removeTab returns true for existing tab', () => {
      const tab = manager.createTab();
      expect(manager.removeTab(tab.id)).toBe(true);
    });

    it('removeTab returns false for non-existent tab', () => {
      expect(manager.removeTab('non-existent-id')).toBe(false);
    });

    it('removeTab activates adjacent tab when active tab removed', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      expect(manager.activeTabId).toBe(tab2.id);
      manager.removeTab(tab2.id);
      expect(manager.activeTabId).toBe(tab1.id);
    });

    it('removeTab last tab leaves empty manager', () => {
      const tab = manager.createTab();
      manager.removeTab(tab.id);
      expect(manager.count).toBe(0);
      expect(manager.activeTabId).toBeNull();
      expect(manager.tabs).toEqual([]);
    });
  });

  describe('Activation', () => {
    it('activateTab returns true and sets activeTabId', () => {
      const tab = manager.createTab();
      manager.createTab();
      expect(manager.activateTab(tab.id)).toBe(true);
      expect(manager.activeTabId).toBe(tab.id);
    });

    it('activateTab returns false for non-existent tab', () => {
      manager.createTab();
      expect(manager.activateTab('ghost-id')).toBe(false);
    });

    it('activateTab same tab returns true (no-op)', () => {
      const tab = manager.createTab();
      expect(manager.activateTab(tab.id)).toBe(true);
      expect(manager.activeTabId).toBe(tab.id);
    });

    it('activateTab emits tabActivated with previousTabId', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      const handler = vi.fn();
      manager.on('tabActivated', handler);
      manager.activateTab(tab1.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabActivated',
          tabId: tab1.id,
          previousTabId: tab2.id,
        })
      );
    });
  });

  describe('Ordering', () => {
    it('moveTab reorders correctly', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      const tab3 = manager.createTab();
      manager.moveTab(tab3.id, 0);
      expect(manager.getTabIndex(tab3.id)).toBe(0);
      expect(manager.getTabIndex(tab1.id)).toBe(1);
      expect(manager.getTabIndex(tab2.id)).toBe(2);
    });

    it('moveTab to beginning', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      manager.moveTab(tab2.id, 0);
      expect(manager.tabs[0].id).toBe(tab2.id);
      expect(manager.tabs[1].id).toBe(tab1.id);
    });

    it('moveTab to end', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      manager.moveTab(tab1.id, 1);
      expect(manager.tabs[0].id).toBe(tab2.id);
      expect(manager.tabs[1].id).toBe(tab1.id);
    });
  });

  describe('Pinning', () => {
    it('setTabPinned pins tab and moves to front', () => {
      manager.createTab();
      const tab2 = manager.createTab();
      manager.setTabPinned(tab2.id, true);
      expect(manager.tabs[0].id).toBe(tab2.id);
      expect(manager.tabs[0].pinned).toBe(true);
    });

    it('setTabPinned unpins tab', () => {
      const tab = manager.createTab();
      manager.setTabPinned(tab.id, true);
      expect(tab.pinned).toBe(true);
      manager.setTabPinned(tab.id, false);
      expect(tab.pinned).toBe(false);
    });

    it('getPinnedTabs returns only pinned tabs', () => {
      const tab1 = manager.createTab();
      manager.createTab();
      manager.setTabPinned(tab1.id, true);
      const pinned = manager.getPinnedTabs();
      expect(pinned.length).toBe(1);
      expect(pinned[0].id).toBe(tab1.id);
    });
  });

  describe('Groups', () => {
    it('setTabGroup sets groupId', () => {
      const tab = manager.createTab();
      manager.setTabGroup(tab.id, 'work');
      expect(manager.getTab(tab.id)?.groupId).toBe('work');
    });

    it('getAllTabsInGroup returns correct tabs', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      const tab3 = manager.createTab();
      manager.setTabGroup(tab1.id, 'g1');
      manager.setTabGroup(tab3.id, 'g1');
      const group = manager.getAllTabsInGroup('g1');
      expect(group.length).toBe(2);
      expect(group.map(t => t.id)).toContain(tab1.id);
      expect(group.map(t => t.id)).toContain(tab3.id);
      expect(group.map(t => t.id)).not.toContain(tab2.id);
    });
  });

  describe('Events', () => {
    it('tabCreated event fires with correct data', () => {
      const handler = vi.fn();
      manager.on('tabCreated', handler);
      const tab = manager.createTab();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabCreated',
          tab,
          index: 0,
        })
      );
    });

    it('tabRemoved event fires with wasActive flag', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      const tab3 = manager.createTab();
      manager.activateTab(tab1.id);
      const handler = vi.fn();
      manager.on('tabRemoved', handler);
      manager.removeTab(tab1.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabRemoved',
          tabId: tab1.id,
          wasActive: true,
        })
      );
      handler.mockClear();
      manager.activateTab(tab3.id);
      manager.removeTab(tab2.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabRemoved',
          tabId: tab2.id,
          wasActive: false,
        })
      );
    });

    it('tabMoved event fires with from/to indices', () => {
      const tab1 = manager.createTab();
      manager.createTab();
      const handler = vi.fn();
      manager.on('tabMoved', handler);
      manager.moveTab(tab1.id, 1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabMoved',
          tabId: tab1.id,
          fromIndex: 0,
          toIndex: 1,
        })
      );
    });
  });

  describe('Lookup', () => {
    it('getTab returns correct tab', () => {
      const tab = manager.createTab();
      expect(manager.getTab(tab.id)).toBe(tab);
    });

    it('getTab returns null for unknown ID', () => {
      expect(manager.getTab('unknown')).toBeNull();
    });

    it('getTabIndex returns correct index', () => {
      const tab1 = manager.createTab();
      const tab2 = manager.createTab();
      expect(manager.getTabIndex(tab1.id)).toBe(0);
      expect(manager.getTabIndex(tab2.id)).toBe(1);
      expect(manager.getTabIndex('unknown')).toBe(-1);
    });
  });

  describe('Dispose', () => {
    it('dispose clears all tabs', () => {
      manager.createTab();
      manager.createTab();
      manager.createTab();
      manager.dispose();
      expect(manager.count).toBe(0);
      expect(manager.tabs).toEqual([]);
    });

    it('dispose resets activeTabId', () => {
      manager.createTab();
      expect(manager.activeTabId).not.toBeNull();
      manager.dispose();
      expect(manager.activeTabId).toBeNull();
    });
  });
});
