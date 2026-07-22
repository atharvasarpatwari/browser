import type { IDisposable } from '../../app/dependency-container';
import type { TabSessionState } from './tab-session';
import type { ITabManager } from './tab-manager';

const STORAGE_KEY = 'nova-tab-persistence';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEBOUNCE_MS = 500;

interface TabPersistenceData {
  readonly version: 1;
  readonly tabs: TabSessionState[];
  readonly activeTabId: string | null;
  readonly savedAt: number;
}

interface ITabPersistenceStore {
  read(): string | null;
  write(data: string): void;
  clear(): void;
}

class LocalStorageStore implements ITabPersistenceStore {
  read(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  write(data: string): void {
    try {
      localStorage.setItem(STORAGE_KEY, data);
    } catch {
      // storage unavailable or full
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // storage unavailable
    }
  }
}

class MemoryStore implements ITabPersistenceStore {
  private readonly data = new Map<string, string>();

  read(): string | null {
    return this.data.get(STORAGE_KEY) ?? null;
  }

  write(data: string): void {
    this.data.set(STORAGE_KEY, data);
  }

  clear(): void {
    this.data.delete(STORAGE_KEY);
  }
}

interface ITabPersistenceManager extends IDisposable {
  startAutoSave(tabManager: ITabManager): void;
  stopAutoSave(): void;
  restoreTabs(): TabPersistenceData | null;
  saveNow(): void;
  clearSaved(): void;
  dispose(): void;
}

class TabPersistenceManager implements ITabPersistenceManager {
  private _autoSaveActive = false;
  private _tabManager: ITabManager | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _tabTabHandlers = new Map<string, (event: any) => void>();
  private readonly _handlers = new Map<string, (event: any) => void>();
  private readonly _store: ITabPersistenceStore;

  constructor(store?: ITabPersistenceStore) {
    this._store = store ?? new LocalStorageStore();
  }

  startAutoSave(tabManager: ITabManager): void {
    if (this._autoSaveActive) return;
    this._autoSaveActive = true;
    this._tabManager = tabManager;

    const debouncedHandler = (_event: any) => this._scheduleDebouncedSave();

    const tabCreatedHandler = (event: any) => {
      if (event.kind === 'tabCreated') {
        const tab = event.tab;
        tab.on('titleChanged', debouncedHandler);
        tab.on('urlChanged', debouncedHandler);
        this._tabTabHandlers.set(tab.id, debouncedHandler);
      }
      this.saveNow();
    };

    const tabRemovedHandler = (event: any) => {
      if (event.kind === 'tabRemoved') {
        this._tabTabHandlers.delete(event.tabId);
      }
      this.saveNow();
    };

    this._handlers.set('tabCreated', tabCreatedHandler);
    this._handlers.set('tabRemoved', tabRemovedHandler);
    this._handlers.set('tabActivated', () => this.saveNow());
    this._handlers.set('tabMoved', () => this.saveNow());
    this._handlers.set('tabPinned', () => this.saveNow());

    tabManager.on('tabCreated', tabCreatedHandler);
    tabManager.on('tabRemoved', tabRemovedHandler);
    tabManager.on('tabActivated', this._handlers.get('tabActivated')!);
    tabManager.on('tabMoved', this._handlers.get('tabMoved')!);
    tabManager.on('tabPinned', this._handlers.get('tabPinned')!);

    for (const tab of tabManager.tabs) {
      tab.on('titleChanged', debouncedHandler);
      tab.on('urlChanged', debouncedHandler);
      this._tabTabHandlers.set(tab.id, debouncedHandler);
    }
  }

  stopAutoSave(): void {
    if (!this._autoSaveActive || !this._tabManager) return;
    this._autoSaveActive = false;

    for (const [type, handler] of this._handlers) {
      this._tabManager.off(type as any, handler);
    }
    this._handlers.clear();

    this._tabTabHandlers.clear();
    this._tabManager = null;

    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  restoreTabs(): TabPersistenceData | null {
    const raw = this._store.read();
    if (!raw) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object') return null;

    const data = parsed as Record<string, unknown>;
    if (data.version !== 1) return null;
    if (!Array.isArray(data.tabs)) return null;
    if (typeof data.savedAt !== 'number') return null;
    if (Date.now() - data.savedAt > MAX_AGE_MS) return null;

    return {
      version: 1,
      tabs: data.tabs as TabSessionState[],
      activeTabId: typeof data.activeTabId === 'string' ? data.activeTabId : null,
      savedAt: data.savedAt,
    };
  }

  saveNow(): void {
    if (!this._tabManager) return;

    const tabs = this._tabManager.tabs.map(tab => tab.getState());
    const payload: TabPersistenceData = {
      version: 1,
      tabs,
      activeTabId: this._tabManager.activeTabId,
      savedAt: Date.now(),
    };

    this._store.write(JSON.stringify(payload));
  }

  clearSaved(): void {
    this._store.clear();
  }

  dispose(): void {
    this.stopAutoSave();
  }

  private _scheduleDebouncedSave(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.saveNow();
    }, DEBOUNCE_MS);
  }
}

export { TabPersistenceManager, LocalStorageStore, MemoryStore };
export type { ITabPersistenceManager, ITabPersistenceStore, TabPersistenceData };
