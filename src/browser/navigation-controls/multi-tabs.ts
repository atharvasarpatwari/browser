import type { IDisposable } from '../../app/dependency-container';

interface TabInfo {
  readonly id: string;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  groupId: string | null;
  index: number;
}

interface TabManagerFacade {
  getAllTabs(): TabInfo[];
  getTab(id: string): TabInfo | null;
  getActiveTab(): TabInfo | null;
  createTab(url?: string, pinned?: boolean): TabInfo;
  removeTab(id: string): boolean;
  activateTab(id: string): boolean;
  moveTab(id: string, newIndex: number): boolean;
  setPinned(id: string, pinned: boolean): boolean;
  setGroup(id: string, groupId: string | null): boolean;
  get count(): number;
  get activeTabId(): string | null;
  onEvent(handler: MultiTabsEventHandler): () => void;
}

type MultiTabsEventKind = 'created' | 'removed' | 'activated' | 'moved' | 'pinned' | 'groupChanged' | 'updated';
interface MultiTabsEvent {
  readonly kind: MultiTabsEventKind;
  readonly tab: TabInfo;
}

type MultiTabsEventHandler = (event: MultiTabsEvent) => void;

interface ITabSessionLike {
  readonly id: string;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  audible: boolean;
  muted: boolean;
  pinned: boolean;
  groupId: string | null;
}

interface ITabManagerLike {
  readonly tabs: readonly ITabSessionLike[];
  readonly activeTabId: string | null;
  readonly activeTab: ITabSessionLike | null;
  readonly count: number;
  createTab(url?: string, pinned?: boolean, index?: number): ITabSessionLike;
  removeTab(tabId: string): boolean;
  activateTab(tabId: string): boolean;
  moveTab(tabId: string, newIndex: number): boolean;
  setTabPinned(tabId: string, pinned: boolean): boolean;
  setTabGroup(tabId: string, groupId: string | null): boolean;
  getTab(tabId: string): ITabSessionLike | null;
  getTabIndex(tabId: string): number;
  on(type: string, handler: (...args: unknown[]) => void): void;
  off(type: string, handler: (...args: unknown[]) => void): void;
}

class MultiTabs implements IDisposable {
  private manager: ITabManagerLike;
  private handlers = new Set<MultiTabsEventHandler>();
  private boundHandlers: Array<() => void> = [];

  constructor(manager: ITabManagerLike) {
    this.manager = manager;
    this.wireEvents();
  }

  get count(): number { return this.manager.count; }
  get activeTabId(): string | null { return this.manager.activeTabId; }

  getAllTabs(): TabInfo[] {
    return this.manager.tabs.map((t, i) => this.toTabInfo(t, i));
  }

  getTab(id: string): TabInfo | null {
    const tab = this.manager.getTab(id);
    if (!tab) return null;
    return this.toTabInfo(tab, this.manager.getTabIndex(id));
  }

  getActiveTab(): TabInfo | null {
    const tab = this.manager.activeTab;
    if (!tab) return null;
    return this.toTabInfo(tab, this.manager.getTabIndex(tab.id));
  }

  createTab(url?: string, pinned?: boolean): TabInfo {
    const tab = this.manager.createTab(url, pinned);
    return this.toTabInfo(tab, this.manager.getTabIndex(tab.id));
  }

  removeTab(id: string): boolean {
    return this.manager.removeTab(id);
  }

  activateTab(id: string): boolean {
    return this.manager.activateTab(id);
  }

  moveTab(id: string, newIndex: number): boolean {
    return this.manager.moveTab(id, newIndex);
  }

  setPinned(id: string, pinned: boolean): boolean {
    return this.manager.setTabPinned(id, pinned);
  }

  setGroup(id: string, groupId: string | null): boolean {
    return this.manager.setTabGroup(id, groupId);
  }

  onEvent(handler: MultiTabsEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: MultiTabsEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  private toTabInfo(tab: ITabSessionLike, index: number): TabInfo {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      loading: tab.loading,
      audible: tab.audible,
      muted: tab.muted,
      pinned: tab.pinned,
      groupId: tab.groupId,
      index,
    };
  }

  private wireEvents(): void {
    const events: Array<{ type: string; handler: (...args: unknown[]) => void }> = [
      { type: 'tabCreated', handler: (e: unknown) => {
        const ev = e as { tab?: ITabSessionLike };
        if (ev?.tab) this.emit({ kind: 'created', tab: this.toTabInfo(ev.tab, this.manager.getTabIndex(ev.tab.id)) });
      }},
      { type: 'tabRemoved', handler: (e: unknown) => {
        const ev = e as { tabId?: string };
        if (ev?.tabId) {
          const t = this.manager.getTab(ev.tabId);
          if (t) this.emit({ kind: 'removed', tab: this.toTabInfo(t, this.manager.getTabIndex(t.id)) });
        }
      }},
      { type: 'tabActivated', handler: (e: unknown) => {
        const ev = e as { tabId?: string };
        if (ev?.tabId) {
          const t = this.manager.getTab(ev.tabId);
          if (t) this.emit({ kind: 'activated', tab: this.toTabInfo(t, this.manager.getTabIndex(t.id)) });
        }
      }},
      { type: 'tabMoved', handler: (e: unknown) => {
        const ev = e as { tabId?: string };
        if (ev?.tabId) {
          const t = this.manager.getTab(ev.tabId);
          if (t) this.emit({ kind: 'moved', tab: this.toTabInfo(t, this.manager.getTabIndex(t.id)) });
        }
      }},
      { type: 'tabPinned', handler: (e: unknown) => {
        const ev = e as { tabId?: string; pinned?: boolean };
        if (ev?.tabId) {
          const t = this.manager.getTab(ev.tabId);
          if (t) this.emit({ kind: 'pinned', tab: this.toTabInfo(t, this.manager.getTabIndex(t.id)) });
        }
      }},
      { type: 'tabGroupChanged', handler: (e: unknown) => {
        const ev = e as { tabId?: string };
        if (ev?.tabId) {
          const t = this.manager.getTab(ev.tabId);
          if (t) this.emit({ kind: 'groupChanged', tab: this.toTabInfo(t, this.manager.getTabIndex(t.id)) });
        }
      }},
    ];

    for (const { type, handler } of events) {
      this.manager.on(type, handler);
      this.boundHandlers.push(() => this.manager.off(type, handler));
    }
  }

  dispose(): void {
    for (const unbind of this.boundHandlers) unbind();
    this.boundHandlers.length = 0;
    this.handlers.clear();
  }
}

export { MultiTabs };
export type { TabInfo, TabManagerFacade, MultiTabsEvent, MultiTabsEventKind, MultiTabsEventHandler, ITabSessionLike, ITabManagerLike };
