import type { ISharedService } from '../../app/app-shell';
import type { IHistoryStore, HistoryEntry, HistoryQuery, HistoryQueryResult } from '../storage/history-store';
import { InMemoryHistoryStore } from '../storage/history-store';
import type { INavigationController, NavigationEvent } from '../navigation/navigation-controller';

type HistoryServiceEventType =
  | 'entryAdded' | 'entriesDeleted' | 'cleared';

interface HistoryServiceEvent {
  readonly kind: HistoryServiceEventType;
}

interface EntryAddedEvent extends HistoryServiceEvent {
  readonly kind: 'entryAdded';
  readonly entry: HistoryEntry;
}

interface EntriesDeletedEvent extends HistoryServiceEvent {
  readonly kind: 'entriesDeleted';
  readonly count: number;
}

interface ClearedEvent extends HistoryServiceEvent {
  readonly kind: 'cleared';
}

type HistoryServiceEventUnion =
  | EntryAddedEvent
  | EntriesDeletedEvent
  | ClearedEvent;

interface IHistoryService extends ISharedService {
  addVisit(url: string, title: string, typed?: boolean): Promise<HistoryEntry>;
  query(options: HistoryQuery): Promise<HistoryQueryResult>;
  getRecent(maxResults?: number): Promise<readonly HistoryEntry[]>;
  getFrecents(maxResults?: number): Promise<readonly HistoryEntry[]>;
  deleteEntry(id: string): Promise<boolean>;
  deleteRange(fromTime: number, toTime: number): Promise<number>;
  deleteAll(): Promise<void>;
  getEntryByUrl(url: string): Promise<HistoryEntry | null>;
  connectController(controller: INavigationController): void;
  disconnectController(controller: INavigationController): void;
  on(type: HistoryServiceEventType, handler: (event: HistoryServiceEventUnion) => void): void;
  off(type: HistoryServiceEventType, handler: (event: HistoryServiceEventUnion) => void): void;
  readonly totalEntries: number;
}

type HistoryServiceEventHandler = (event: HistoryServiceEventUnion) => void;

class HistoryServiceEventBus {
  private readonly channels = new Map<HistoryServiceEventType, Set<HistoryServiceEventHandler>>();

  on(type: HistoryServiceEventType, handler: HistoryServiceEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: HistoryServiceEventType, handler: HistoryServiceEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: HistoryServiceEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[HistoryService] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class HistoryService implements IHistoryService {
  readonly name = 'HistoryService';

  private readonly store: IHistoryStore;
  private readonly bus = new HistoryServiceEventBus();
  private readonly controllerListeners = new Map<INavigationController, (event: NavigationEvent) => void>();
  private _initialized = false;

  constructor(store: IHistoryStore = new InMemoryHistoryStore()) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const [controller, listener] of this.controllerListeners) {
      controller.off('navigationCommitted', listener);
    }
    this.controllerListeners.clear();
    this.bus.dispose();
    this._initialized = false;
  }

  async addVisit(url: string, title: string, typed = false): Promise<HistoryEntry> {
    const entry = await this.store.addVisit(url, title, typed);
    this.bus.emit({ kind: 'entryAdded', entry });
    return entry;
  }

  async query(options: HistoryQuery): Promise<HistoryQueryResult> {
    return this.store.query(options);
  }

  async getRecent(maxResults?: number): Promise<readonly HistoryEntry[]> {
    return this.store.getRecent(maxResults);
  }

  async getFrecents(maxResults?: number): Promise<readonly HistoryEntry[]> {
    return this.store.getFrecents(maxResults);
  }

  async deleteEntry(id: string): Promise<boolean> {
    const result = await this.store.deleteEntry(id);
    if (result) this.bus.emit({ kind: 'entriesDeleted', count: 1 });
    return result;
  }

  async deleteRange(fromTime: number, toTime: number): Promise<number> {
    const count = await this.store.deleteRange(fromTime, toTime);
    if (count > 0) this.bus.emit({ kind: 'entriesDeleted', count });
    return count;
  }

  async deleteAll(): Promise<void> {
    await this.store.deleteAll();
    this.bus.emit({ kind: 'cleared' });
  }

  async getEntryByUrl(url: string): Promise<HistoryEntry | null> {
    return this.store.getEntryByUrl(url);
  }

  connectController(controller: INavigationController): void {
    if (this.controllerListeners.has(controller)) return;

    const listener = (event: NavigationEvent): void => {
      if (event.kind === 'navigationCommitted') {
        void this.addVisit(event.entry.url, event.entry.title, false);
      }
    };

    this.controllerListeners.set(controller, listener);
    controller.on('navigationCommitted', listener);
  }

  disconnectController(controller: INavigationController): void {
    const listener = this.controllerListeners.get(controller);
    if (!listener) return;
    controller.off('navigationCommitted', listener);
    this.controllerListeners.delete(controller);
  }

  get totalEntries(): number {
    return this.store.totalEntries;
  }

  on(type: HistoryServiceEventType, handler: HistoryServiceEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: HistoryServiceEventType, handler: HistoryServiceEventHandler): void {
    this.bus.off(type, handler);
  }
}

export { HistoryService, HistoryServiceEventBus };
export type { IHistoryService, HistoryServiceEventUnion, HistoryServiceEventType };
