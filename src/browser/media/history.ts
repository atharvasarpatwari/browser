import type { IDisposable } from '../../app/dependency-container';

interface IHistoryService extends IDisposable {
  readonly length: number;
  readonly state: unknown;
  readonly current: HistoryEntry | null;
  pushState(state: unknown, title: string, url?: string): void;
  replaceState(state: unknown, title: string, url?: string): void;
  go(delta?: number): void;
  back(): void;
  forward(): void;
  onEvent(handler: HistoryEventHandler): () => void;
}

interface HistoryEntry {
  readonly state: unknown;
  readonly title: string;
  readonly url: string;
  readonly timestamp: number;
}

interface HistoryEvent {
  readonly kind: HistoryEventKind;
  readonly data?: Record<string, unknown>;
}

type HistoryEventKind = 'popstate' | 'hashchange' | 'push' | 'replace' | 'go';
type HistoryEventHandler = (event: HistoryEvent) => void;

class HistoryService implements IHistoryService {
  private _entries: HistoryEntry[] = [];
  private _index = -1;
  private _handlers = new Set<HistoryEventHandler>();

  constructor() {
    this.pushState(null, '', '/');
  }

  get length(): number { return this._entries.length; }
  get state(): unknown {
    return this._entries[this._index]?.state ?? null;
  }
  get current(): HistoryEntry | null {
    return this._entries[this._index] ?? null;
  }

  pushState(state: unknown, title: string, url?: string): void {
    const resolved = url ?? this._entries[this._index]?.url ?? '/';
    this._entries = this._entries.slice(0, this._index + 1);
    this._entries.push({ state, title, url: resolved, timestamp: Date.now() });
    this._index = this._entries.length - 1;
    this.emit({ kind: 'push', data: { url: resolved } });
  }

  replaceState(state: unknown, title: string, url?: string): void {
    const resolved = url ?? this._entries[this._index]?.url ?? '/';
    if (this._index >= 0) {
      this._entries[this._index] = { state, title, url: resolved, timestamp: Date.now() };
    }
    this.emit({ kind: 'replace', data: { url: resolved } });
  }

  go(delta?: number): void {
    if (delta === 0 || delta === undefined) return;
    const target = Math.max(0, Math.min(this._entries.length - 1, this._index + delta));
    if (target === this._index) return;
    this._index = target;
    const oldUrl = this._entries[this._index]?.url ?? '/';
    this.emit({ kind: 'go', data: { delta, url: oldUrl } });
    this.emit({ kind: 'popstate', data: { state: this.state, url: oldUrl } });
  }

  back(): void { this.go(-1); }
  forward(): void { this.go(1); }

  onEvent(handler: HistoryEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: HistoryEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._entries = [];
    this._index = -1;
  }
}

export { HistoryService };
export type { IHistoryService, HistoryEntry, HistoryEvent, HistoryEventKind, HistoryEventHandler };
