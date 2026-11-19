import type { IDisposable } from '../../app/dependency-container';

interface HistoryEntryItem {
  readonly id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

interface IHistoryServiceWrapper extends IDisposable {
  getAll(): HistoryEntryItem[];
  search(query: string, maxResults?: number): HistoryEntryItem[];
  getRecent(maxResults?: number): HistoryEntryItem[];
  getFrecents(maxResults?: number): HistoryEntryItem[];
  getByUrl(url: string): HistoryEntryItem | null;
  deleteEntry(id: string): boolean;
  deleteAll(): void;
  get totalCount(): number;
  onEvent(handler: HistoryEventHandler): () => void;
}

type HistoryEventKind = 'added' | 'deleted' | 'cleared';
interface HistoryEvent {
  readonly kind: HistoryEventKind;
  readonly entry?: HistoryEntryItem;
}

type HistoryEventHandler = (event: HistoryEvent) => void;

interface HistoryEntryLike {
  readonly id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount: number;
  lastVisitTime: number;
}

interface HistoryServiceLike {
  query(options: { query?: string; maxResults?: number }): Promise<{ entries: readonly HistoryEntryLike[]; totalCount: number }>;
  getRecent(maxResults?: number): Promise<readonly HistoryEntryLike[]>;
  getFrecents(maxResults?: number): Promise<readonly HistoryEntryLike[]>;
  getEntryByUrl(url: string): Promise<HistoryEntryLike | null>;
  deleteEntry(id: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  on(type: string, handler: (...args: unknown[]) => void): void;
  off(type: string, handler: (...args: unknown[]) => void): void;
}

function toEntry(e: HistoryEntryLike): HistoryEntryItem {
  return {
    id: e.id, url: e.url, title: e.title, visitTime: e.visitTime,
    visitCount: e.visitCount, typedCount: e.typedCount, lastVisitTime: e.lastVisitTime,
  };
}

class HistoryServiceWrapper implements IHistoryServiceWrapper {
  private service: HistoryServiceLike;
  private handlers = new Set<HistoryEventHandler>();
  private boundHandlers: Array<() => void> = [];
  private _cached: HistoryEntryLike[] = [];

  constructor(service: HistoryServiceLike) {
    this.service = service;
    this.wireEvents();
    this.service.query({ maxResults: 100 }).then(r => { this._cached = [...r.entries]; }).catch(() => {});
  }

  get totalCount(): number { return this._cached.length; }

  getAll(): HistoryEntryItem[] { return this._cached.map(toEntry); }

  search(query: string, maxResults = 50): HistoryEntryItem[] {
    const q = query.toLowerCase();
    const results = this._cached.filter(e =>
      e.title.toLowerCase().includes(q) || e.url.toLowerCase().includes(q),
    );
    return results.slice(0, maxResults).map(toEntry);
  }

  getRecent(maxResults = 20): HistoryEntryItem[] {
    return [...this._cached].sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, maxResults).map(toEntry);
  }

  getFrecents(maxResults = 20): HistoryEntryItem[] {
    const scored = this._cached.map(e => ({
      entry: e,
      score: Math.min(e.visitCount, 100) * 0.3 + Math.min(e.typedCount, 50) * 0.7 +
        Math.max(0, 1 - (Date.now() - e.lastVisitTime) / (30 * 86400000)) * 10,
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, maxResults).map(s => toEntry(s.entry));
  }

  getByUrl(url: string): HistoryEntryItem | null {
    const found = this._cached.find(e => e.url === url);
    return found ? toEntry(found) : null;
  }

  deleteEntry(id: string): boolean {
    this.service.deleteEntry(id).then(() => {
      this._cached = this._cached.filter(e => e.id !== id);
    }).catch(() => {});
    return true;
  }

  deleteAll(): void {
    this.service.deleteAll().then(() => { this._cached = []; }).catch(() => {});
    this._cached = [];
  }

  private wireEvents(): void {
    const handler = () => {
      this.service.query({ maxResults: 100 }).then(r => { this._cached = [...r.entries]; }).catch(() => {});
    };
    this.service.on('entryAdded', handler);
    this.service.on('entriesDeleted', handler);
    this.service.on('cleared', handler);
    this.boundHandlers.push(
      () => this.service.off('entryAdded', handler),
      () => this.service.off('entriesDeleted', handler),
      () => this.service.off('cleared', handler),
    );
  }

  onEvent(handler: HistoryEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: HistoryEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    for (const unbind of this.boundHandlers) unbind();
    this.boundHandlers.length = 0;
    this.handlers.clear();
    this._cached = [];
  }
}

export { HistoryServiceWrapper };
export type { IHistoryServiceWrapper, HistoryEntryItem, HistoryEvent, HistoryEventKind, HistoryEventHandler, HistoryServiceLike, HistoryEntryLike };
