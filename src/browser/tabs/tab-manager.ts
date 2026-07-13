import type { IDisposable } from '../../app/dependency-container';
import type { ITabSession } from './tab-session';
import { TabSession } from './tab-session';

type TabManagerEventType =
  | 'tabCreated' | 'tabRemoved' | 'tabActivated'
  | 'tabMoved' | 'tabPinned' | 'tabGroupChanged';

interface TabManagerEvent {
  readonly kind: TabManagerEventType;
}

interface TabCreatedEvent extends TabManagerEvent {
  readonly kind: 'tabCreated';
  readonly tab: ITabSession;
  readonly index: number;
}

interface TabRemovedEvent extends TabManagerEvent {
  readonly kind: 'tabRemoved';
  readonly tabId: string;
  readonly wasActive: boolean;
}

interface TabActivatedEvent extends TabManagerEvent {
  readonly kind: 'tabActivated';
  readonly tabId: string;
  readonly previousTabId: string | null;
}

interface TabMovedEvent extends TabManagerEvent {
  readonly kind: 'tabMoved';
  readonly tabId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
}

interface TabPinnedEvent extends TabManagerEvent {
  readonly kind: 'tabPinned';
  readonly tabId: string;
  readonly pinned: boolean;
}

interface TabGroupChangedEvent extends TabManagerEvent {
  readonly kind: 'tabGroupChanged';
  readonly tabId: string;
  readonly groupId: string | null;
}

type TabManagerEventUnion =
  | TabCreatedEvent
  | TabRemovedEvent
  | TabActivatedEvent
  | TabMovedEvent
  | TabPinnedEvent
  | TabGroupChangedEvent;

interface ITabManager extends IDisposable {
  readonly tabs: readonly ITabSession[];
  readonly activeTabId: string | null;
  readonly activeTab: ITabSession | null;
  readonly count: number;

  createTab(url?: string, pinned?: boolean, index?: number): ITabSession;
  removeTab(tabId: string): boolean;
  activateTab(tabId: string): boolean;
  moveTab(tabId: string, newIndex: number): boolean;
  setTabPinned(tabId: string, pinned: boolean): boolean;
  setTabGroup(tabId: string, groupId: string | null): boolean;
  getTab(tabId: string): ITabSession | null;
  getTabIndex(tabId: string): number;
  getAllTabsInGroup(groupId: string): readonly ITabSession[];
  getPinnedTabs(): readonly ITabSession[];
  on(type: TabManagerEventType, handler: (event: TabManagerEventUnion) => void): void;
  off(type: TabManagerEventType, handler: (event: TabManagerEventUnion) => void): void;
}

type TabManagerEventHandler = (event: TabManagerEventUnion) => void;

class TabManagerEventBus {
  private readonly channels = new Map<TabManagerEventType, Set<TabManagerEventHandler>>();

  on(type: TabManagerEventType, handler: TabManagerEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabManagerEventType, handler: TabManagerEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabManagerEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class TabManager implements ITabManager {
  private readonly _tabs: ITabSession[] = [];
  private _activeTabId: string | null = null;
  private readonly bus = new TabManagerEventBus();

  get tabs(): readonly ITabSession[] { return [...this._tabs]; }
  get activeTabId(): string | null { return this._activeTabId; }
  get activeTab(): ITabSession | null {
    return this._activeTabId ? this.getTab(this._activeTabId) : null;
  }
  get count(): number { return this._tabs.length; }

  createTab(url?: string, pinned = false, index?: number): ITabSession {
    const tab = new TabSession(url);
    tab.setPinned(pinned);

    if (pinned) {
      const pinCount = this._tabs.filter(t => t.pinned).length;
      const insertAt = index !== undefined ? index : pinCount;
      this._tabs.splice(insertAt, 0, tab);
      this.bus.emit({ kind: 'tabCreated', tab, index: insertAt });
    } else if (index !== undefined && index >= 0 && index < this._tabs.length) {
      this._tabs.splice(index, 0, tab);
      this.bus.emit({ kind: 'tabCreated', tab, index });
    } else {
      this._tabs.push(tab);
      this.bus.emit({ kind: 'tabCreated', tab, index: this._tabs.length - 1 });
    }

    this.activateTab(tab.id);
    return tab;
  }

  removeTab(tabId: string): boolean {
    const index = this.getTabIndex(tabId);
    if (index === -1) return false;

    const tab = this._tabs[index]!;
    const wasActive = this._activeTabId === tabId;

    this._tabs.splice(index, 1);
    tab.dispose();

    if (wasActive) {
      const newActive = this._tabs[Math.min(index, this._tabs.length - 1)];
      this._activeTabId = newActive?.id ?? null;
    }

    this.bus.emit({ kind: 'tabRemoved', tabId, wasActive });
    return true;
  }

  activateTab(tabId: string): boolean {
    const tab = this.getTab(tabId);
    if (!tab) return false;
    const previousTabId = this._activeTabId;
    if (previousTabId === tabId) return true;
    this._activeTabId = tabId;
    this.bus.emit({ kind: 'tabActivated', tabId, previousTabId });
    return true;
  }

  moveTab(tabId: string, newIndex: number): boolean {
    const fromIndex = this.getTabIndex(tabId);
    if (fromIndex === -1) return false;

    const [tab] = this._tabs.splice(fromIndex, 1);
    this._tabs.splice(newIndex, 0, tab!);
    this.bus.emit({ kind: 'tabMoved', tabId, fromIndex, toIndex: newIndex });
    return true;
  }

  setTabPinned(tabId: string, pinned: boolean): boolean {
    const tab = this.getTab(tabId);
    if (!tab) return false;
    tab.setPinned(pinned);

    if (pinned) {
      const fromIndex = this.getTabIndex(tabId);
      this._tabs.splice(fromIndex, 1);
      const pinCount = this._tabs.filter(t => t.pinned).length;
      this._tabs.splice(pinCount, 0, tab);
    }

    this.bus.emit({ kind: 'tabPinned', tabId, pinned });
    return true;
  }

  setTabGroup(tabId: string, groupId: string | null): boolean {
    const tab = this.getTab(tabId);
    if (!tab) return false;
    tab.setGroupId(groupId);
    this.bus.emit({ kind: 'tabGroupChanged', tabId, groupId });
    return true;
  }

  getTab(tabId: string): ITabSession | null {
    return this._tabs.find(t => t.id === tabId) ?? null;
  }

  getTabIndex(tabId: string): number {
    return this._tabs.findIndex(t => t.id === tabId);
  }

  getAllTabsInGroup(groupId: string): readonly ITabSession[] {
    return this._tabs.filter(t => t.groupId === groupId);
  }

  getPinnedTabs(): readonly ITabSession[] {
    return this._tabs.filter(t => t.pinned);
  }

  on(type: TabManagerEventType, handler: TabManagerEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabManagerEventType, handler: TabManagerEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    for (const tab of this._tabs) tab.dispose();
    this._tabs.length = 0;
    this._activeTabId = null;
    this.bus.dispose();
  }
}

export { TabManager, TabManagerEventBus };
export type { ITabManager, TabManagerEventUnion, TabManagerEventType };
