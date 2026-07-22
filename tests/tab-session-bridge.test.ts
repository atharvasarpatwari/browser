import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TabSessionBridge } from '../src/browser/tabs/tab-session-bridge';
import { TabManager } from '../src/browser/tabs/tab-manager';
import { TabContextManager, TabContextState } from '../src/browser/engine/tab-context';

describe('TabSessionBridge', () => {
  let tabManager: TabManager;
  let contextManager: TabContextManager;
  let bridge: TabSessionBridge;

  beforeEach(() => {
    tabManager = new TabManager();
    contextManager = new TabContextManager();
    bridge = new TabSessionBridge(tabManager, contextManager);
  });

  describe('construction', () => {
    it('should create with tab manager and context manager', () => {
      expect(bridge).toBeDefined();
      bridge.dispose();
    });

    it('should create contexts for existing tabs', () => {
      tabManager.createTab();
      tabManager.createTab();
      const fresh = new TabSessionBridge(tabManager, contextManager);
      expect(fresh.getAllMappings().size).toBe(2);
      fresh.dispose();
    });

    it('should have no mappings for empty manager', () => {
      expect(bridge.getAllMappings().size).toBe(0);
    });
  });

  describe('lifecycle sync', () => {
    it('should auto-create context when tab is created', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id);
      expect(ctx).not.toBeNull();
      expect(ctx!.state).toBe(TabContextState.Idle);
    });

    it('should destroy context when tab is removed', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id);
      const ctxId = ctx!.id;
      tabManager.removeTab(tab.id);
      expect(bridge.getContextForTab(tab.id)).toBeNull();
      expect(contextManager.getContext(ctxId)).toBeNull();
    });

    it('should return context for existing tab', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id);
      expect(ctx).not.toBeNull();
      expect(ctx!.id).toBeTruthy();
    });

    it('should return null for unknown tab', () => {
      expect(bridge.getContextForTab('nonexistent')).toBeNull();
    });
  });

  describe('bidirectional mapping', () => {
    it('should return tab ID for context ID', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id)!;
      expect(bridge.getTabForContext(ctx.id)).toBe(tab.id);
    });

    it('should return null for unknown context', () => {
      expect(bridge.getTabForContext('nonexistent')).toBeNull();
    });

    it('should return correct map from getAllMappings', () => {
      const tab1 = tabManager.createTab();
      const tab2 = tabManager.createTab();
      const mappings = bridge.getAllMappings();
      expect(mappings.size).toBe(2);
      expect(mappings.has(tab1.id)).toBe(true);
      expect(mappings.has(tab2.id)).toBe(true);
    });
  });

  describe('event forwarding', () => {
    it('should forward tab URL change to context setLoading', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id)!;
      tab.setUrl('https://example.com');
      expect(ctx.state).toBe(TabContextState.Loading);
    });

    it('should forward tab title change to context setActive', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id)!;
      tab.setUrl('https://example.com');
      tab.setTitle('Example');
      expect(ctx.state).toBe(TabContextState.Active);
    });

    it('should emit tabContextCrashed on bridge when context crashes', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id)!;
      const handler = vi.fn();
      bridge.on('tabContextCrashed', handler);
      ctx.crash(new Error('test crash'), 'script', 'https://example.com');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabContextCrashed',
          tabId: tab.id,
          contextId: ctx.id,
        })
      );
    });

    it('should emit tabContextCreated on new tab', () => {
      const handler = vi.fn();
      bridge.on('tabContextCreated', handler);
      const tab = tabManager.createTab();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabContextCreated',
          tabId: tab.id,
        })
      );
    });
  });

  describe('isTabAlive', () => {
    it('should return true for active tab', () => {
      const tab = tabManager.createTab();
      expect(bridge.isTabAlive(tab.id)).toBe(true);
    });

    it('should return false for disposed context', () => {
      const tab = tabManager.createTab();
      const ctx = bridge.getContextForTab(tab.id)!;
      ctx.dispose();
      expect(bridge.isTabAlive(tab.id)).toBe(false);
    });

    it('should return false for unknown tab', () => {
      expect(bridge.isTabAlive('nonexistent')).toBe(false);
    });
  });

  describe('dispose', () => {
    it('should clear all mappings', () => {
      tabManager.createTab();
      tabManager.createTab();
      expect(bridge.getAllMappings().size).toBe(2);
      bridge.dispose();
      expect(bridge.getAllMappings().size).toBe(0);
    });

    it('should stop events after dispose', () => {
      const handler = vi.fn();
      bridge.on('tabContextCreated', handler);
      bridge.dispose();
      tabManager.createTab();
      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit tabContextDestroyed on tab removal', () => {
      const tab = tabManager.createTab();
      const handler = vi.fn();
      bridge.on('tabContextDestroyed', handler);
      tabManager.removeTab(tab.id);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'tabContextDestroyed',
          tabId: tab.id,
        })
      );
    });
  });
});
