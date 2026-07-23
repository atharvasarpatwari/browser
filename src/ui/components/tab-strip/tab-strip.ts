import type { IDisposable } from '../../../app/dependency-container';
import type { ITabManager } from '../../../browser/tabs/tab-manager';

type TabStripEventType =
  | 'tabSelected' | 'tabClosed' | 'newTabRequested'
  | 'tabMoved' | 'tabPinned' | 'contextMenu';

interface TabStripEvent {
  readonly kind: TabStripEventType;
}

interface TabSelectedEvent extends TabStripEvent {
  readonly kind: 'tabSelected';
  readonly tabId: string;
}

interface TabClosedEvent extends TabStripEvent {
  readonly kind: 'tabClosed';
  readonly tabId: string;
}

interface NewTabRequestedEvent extends TabStripEvent {
  readonly kind: 'newTabRequested';
}

interface TabMovedEvent extends TabStripEvent {
  readonly kind: 'tabMoved';
  readonly tabId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
}

interface TabPinnedEvent extends TabStripEvent {
  readonly kind: 'tabPinned';
  readonly tabId: string;
  readonly pinned: boolean;
}

interface ContextMenuEvent extends TabStripEvent {
  readonly kind: 'contextMenu';
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
}

type TabStripEventUnion =
  | TabSelectedEvent
  | TabClosedEvent
  | NewTabRequestedEvent
  | TabMovedEvent
  | TabPinnedEvent
  | ContextMenuEvent;

interface TabStripTabData {
  readonly id: string;
  readonly title: string;
  readonly favicon: string | null;
  readonly loading: boolean;
  readonly pinned: boolean;
  readonly active: boolean;
}

interface TabStripState {
  readonly tabs: readonly TabStripTabData[];
  readonly activeTabId: string | null;
}

interface ITabStrip extends IDisposable {
  readonly state: TabStripState;
  syncWithManager(): void;
  on(type: TabStripEventType, handler: (event: TabStripEventUnion) => void): void;
  off(type: TabStripEventType, handler: (event: TabStripEventUnion) => void): void;
}

type TabStripEventHandler = (event: TabStripEventUnion) => void;

class TabStripEventBus {
  private readonly channels = new Map<TabStripEventType, Set<TabStripEventHandler>>();

  on(type: TabStripEventType, handler: TabStripEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: TabStripEventType, handler: TabStripEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: TabStripEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[TabStrip] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class TabStrip implements ITabStrip {
  private readonly manager: ITabManager;
  private readonly bus = new TabStripEventBus();
  private _tabs: TabStripTabData[] = [];
  private _activeTabId: string | null = null;
  private readonly _managerUnsubs: Array<() => void> = [];
  private _activeTabUnsubs: Array<() => void> = [];

  constructor(manager: ITabManager) {
    this.manager = manager;
    this.syncWithManager();
    this.wireManagerEvents();
  }

  get state(): TabStripState {
    return {
      tabs: [...this._tabs],
      activeTabId: this._activeTabId,
    };
  }

  syncWithManager(): void {
    this._tabs = this.manager.tabs.map(tab => {
      const s = tab.getState();
      return {
        id: s.id,
        title: s.title || s.url || 'New Tab',
        favicon: s.favicon,
        loading: s.loading,
        pinned: s.pinned,
        active: s.id === this.manager.activeTabId,
      };
    });
    this._activeTabId = this.manager.activeTabId;
  }

  private wireManagerEvents(): void {
    const onCreated = () => { this.syncWithManager(); };
    const onRemoved = () => { this.syncWithManager(); this.subscribeToActiveTab(); };
    const onActivated = (e: { kind: string; tabId: string }) => {
      if (e.kind === 'tabActivated') this._activeTabId = e.tabId;
      this.syncWithManager();
      this.subscribeToActiveTab();
    };
    const onMoved = (e: { kind: string; tabId: string; fromIndex: number; toIndex: number }) => {
      if (e.kind === 'tabMoved') {
        this.syncWithManager();
        this.bus.emit({ kind: 'tabMoved', tabId: e.tabId, fromIndex: e.fromIndex, toIndex: e.toIndex });
      }
    };
    const onPinned = (e: { kind: string; tabId: string; pinned: boolean }) => {
      if (e.kind === 'tabPinned') {
        this.syncWithManager();
        this.bus.emit({ kind: 'tabPinned', tabId: e.tabId, pinned: e.pinned });
      }
    };

    this.manager.on('tabCreated', onCreated);
    this.manager.on('tabRemoved', onRemoved);
    this.manager.on('tabActivated', onActivated);
    this.manager.on('tabMoved', onMoved);
    this.manager.on('tabPinned', onPinned);

    this._managerUnsubs.push(
      () => this.manager.off('tabCreated', onCreated),
      () => this.manager.off('tabRemoved', onRemoved),
      () => this.manager.off('tabActivated', onActivated),
      () => this.manager.off('tabMoved', onMoved),
      () => this.manager.off('tabPinned', onPinned),
    );

    this.subscribeToActiveTab();
  }

  /**
   * Subscribe to per-tab state changes (title, url, loading, favicon) on the
   * currently active tab so the tab strip re-renders when the active tab's
   * title or URL changes without a tab switch.
   */
  private subscribeToActiveTab(): void {
    for (const unsub of this._activeTabUnsubs) unsub();
    this._activeTabUnsubs.length = 0;

    const tab = this.manager.activeTab;
    if (!tab) return;

    const onTitleChanged = () => { this.syncWithManager(); };
    const onUrlChanged = () => { this.syncWithManager(); };
    const onLoadingChanged = () => { this.syncWithManager(); };
    const onFaviconChanged = () => { this.syncWithManager(); };

    tab.on('titleChanged', onTitleChanged);
    tab.on('urlChanged', onUrlChanged);
    tab.on('loadingStateChanged', onLoadingChanged);
    tab.on('faviconChanged', onFaviconChanged);

    this._activeTabUnsubs.push(
      () => tab.off('titleChanged', onTitleChanged),
      () => tab.off('urlChanged', onUrlChanged),
      () => tab.off('loadingStateChanged', onLoadingChanged),
      () => tab.off('faviconChanged', onFaviconChanged),
    );
  }

  selectTab(tabId: string): void {
    this.manager.activateTab(tabId);
    this.bus.emit({ kind: 'tabSelected', tabId });
  }

  closeTab(tabId: string): void {
    this.manager.removeTab(tabId);
    this.bus.emit({ kind: 'tabClosed', tabId });
  }

  requestNewTab(): void {
    this.bus.emit({ kind: 'newTabRequested' });
  }

  moveTab(tabId: string, toIndex: number): void {
    this.manager.moveTab(tabId, toIndex);
  }

  togglePin(tabId: string): void {
    const tab = this.manager.getTab(tabId);
    if (tab) {
      this.manager.setTabPinned(tabId, !tab.pinned);
    }
  }

  showContextMenu(tabId: string, x: number, y: number): void {
    this.bus.emit({ kind: 'contextMenu', tabId, x, y });
  }

  on(type: TabStripEventType, handler: TabStripEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: TabStripEventType, handler: TabStripEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    for (const unsub of this._managerUnsubs) unsub();
    this._managerUnsubs.length = 0;
    for (const unsub of this._activeTabUnsubs) unsub();
    this._activeTabUnsubs.length = 0;
    this.bus.dispose();
  }
}

export { TabStrip, TabStripEventBus };
export type {
  ITabStrip,
  TabStripState,
  TabStripTabData,
  TabStripEventUnion,
  TabStripEventType,
};
