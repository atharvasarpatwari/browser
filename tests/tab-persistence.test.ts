import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  TabPersistenceManager,
  MemoryStore,
} from '../src/browser/tabs/tab-persistence';
import { TabManager } from '../src/browser/tabs/tab-manager';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('should return null when empty', () => {
    expect(store.read()).toBeNull();
  });

  it('should store and retrieve data', () => {
    store.write('{"test":true}');
    expect(store.read()).toBe('{"test":true}');
  });

  it('should clear data', () => {
    store.write('data');
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe('TabPersistenceManager', () => {
  let manager: TabManager;
  let store: MemoryStore;
  let persistence: TabPersistenceManager;

  beforeEach(() => {
    manager = new TabManager();
    store = new MemoryStore();
    persistence = new TabPersistenceManager(store);
  });

  afterEach(() => {
    persistence.dispose();
    manager.dispose();
    vi.useRealTimers();
  });

  describe('saveNow', () => {
    it('should save all tabs as TabSessionState array', () => {
      manager.createTab('https://a.com');
      manager.createTab('https://b.com');
      persistence.startAutoSave(manager);
      persistence.saveNow();

      const raw = store.read()!;
      const data = JSON.parse(raw);
      expect(data.tabs).toHaveLength(2);
      expect(data.tabs[0].url).toBe('https://a.com');
      expect(data.tabs[1].url).toBe('https://b.com');
    });

    it('should save activeTabId', () => {
      const tab = manager.createTab();
      persistence.startAutoSave(manager);
      persistence.saveNow();

      const data = JSON.parse(store.read()!);
      expect(data.activeTabId).toBe(tab.id);
    });

    it('should write version: 1', () => {
      manager.createTab();
      persistence.startAutoSave(manager);
      persistence.saveNow();

      const data = JSON.parse(store.read()!);
      expect(data.version).toBe(1);
    });

    it('should include savedAt timestamp', () => {
      const before = Date.now();
      manager.createTab();
      persistence.startAutoSave(manager);
      persistence.saveNow();

      const data = JSON.parse(store.read()!);
      expect(data.savedAt).toBeGreaterThanOrEqual(before);
      expect(data.savedAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('restoreTabs', () => {
    it('should return null when no data', () => {
      expect(persistence.restoreTabs()).toBeNull();
    });

    it('should return null when data is stale (>24h)', () => {
      const staleData = {
        version: 1,
        tabs: [{ id: 't1', url: 'https://a.com', title: 'A' }],
        activeTabId: 't1',
        savedAt: Date.now() - 25 * 60 * 60 * 1000,
      };
      store.write(JSON.stringify(staleData));
      expect(persistence.restoreTabs()).toBeNull();
    });

    it('should return valid data when recent', () => {
      const recentData = {
        version: 1,
        tabs: [
          { id: 't1', url: 'https://a.com', title: 'A', pinned: false, groupId: null },
          { id: 't2', url: 'https://b.com', title: 'B', pinned: true, groupId: 'g1' },
        ],
        activeTabId: 't2',
        savedAt: Date.now() - 1000,
      };
      store.write(JSON.stringify(recentData));
      const result = persistence.restoreTabs();
      expect(result).not.toBeNull();
      expect(result!.tabs).toHaveLength(2);
      expect(result!.activeTabId).toBe('t2');
    });

    it('should validate version number', () => {
      const badVersion = { version: 2, tabs: [], activeTabId: null, savedAt: Date.now() };
      store.write(JSON.stringify(badVersion));
      expect(persistence.restoreTabs()).toBeNull();
    });
  });

  describe('auto-save', () => {
    it('should auto-save on tabCreated', () => {
      persistence.startAutoSave(manager);
      manager.createTab();
      const data = JSON.parse(store.read()!);
      expect(data.tabs).toHaveLength(1);
    });

    it('should auto-save on tabRemoved', () => {
      const tab = manager.createTab();
      persistence.startAutoSave(manager);
      manager.createTab();
      manager.removeTab(tab.id);
      const data = JSON.parse(store.read()!);
      expect(data.tabs).toHaveLength(1);
    });

    it('should auto-save on tabActivated', () => {
      const tab1 = manager.createTab();
      manager.createTab();
      persistence.startAutoSave(manager);
      const handler = vi.fn();
      persistence.on?.('save', handler);
      manager.activateTab(tab1.id);
      const data = JSON.parse(store.read()!);
      expect(data.activeTabId).toBe(tab1.id);
    });

    it('should auto-save on tabMoved', () => {
      manager.createTab();
      manager.createTab();
      persistence.startAutoSave(manager);
      const tabs = manager.tabs;
      manager.moveTab(tabs[1].id, 0);
      const data = JSON.parse(store.read()!);
      expect(data.tabs).toHaveLength(2);
    });

    it('should debounce titleChanged events', () => {
      vi.useFakeTimers();
      const mgr = new TabManager();
      const store2 = new MemoryStore();
      const p = new TabPersistenceManager(store2);
      p.startAutoSave(mgr);
      const tab = mgr.createTab();
      const afterCreate = store2.read()!;
      tab.setTitle('Title 1');
      tab.setTitle('Title 2');
      tab.setTitle('Title 3');
      expect(store2.read()).toBe(afterCreate);
      vi.advanceTimersByTime(500);
      const data = JSON.parse(store2.read()!);
      expect(data.tabs[0].title).toBe('Title 3');
      p.dispose();
      mgr.dispose();
    });
  });

  describe('clear and dispose', () => {
    it('should clearSaved remove stored data', () => {
      manager.createTab();
      persistence.startAutoSave(manager);
      persistence.saveNow();
      expect(store.read()).not.toBeNull();
      persistence.clearSaved();
      expect(store.read()).toBeNull();
    });

    it('should stopAutoSave stop saves', () => {
      persistence.startAutoSave(manager);
      persistence.saveNow();
      persistence.stopAutoSave();
      const raw = store.read();
      manager.createTab();
      expect(store.read()).toBe(raw);
    });

    it('should dispose clean up', () => {
      persistence.startAutoSave(manager);
      persistence.dispose();
      manager.createTab();
      expect(store.read()).toBeNull();
    });

    it('should not error on double dispose', () => {
      persistence.startAutoSave(manager);
      persistence.dispose();
      expect(() => persistence.dispose()).not.toThrow();
    });
  });
});
