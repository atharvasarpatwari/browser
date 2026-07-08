import type { IDisposable } from '../../app/dependency-container';

interface HistoryEntry {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly visitTime: number;
  readonly visitCount: number;
  readonly typedCount: number;
  readonly lastVisitTime: number;
}

interface HistoryQuery {
  readonly query?: string;
  readonly fromTime?: number;
  readonly toTime?: number;
  readonly maxResults?: number;
  readonly offset?: number;
}

interface HistoryQueryResult {
  readonly entries: readonly HistoryEntry[];
  readonly totalCount: number;
  readonly hasMore: boolean;
}

interface IHistoryStore extends IDisposable {
  addVisit(url: string, title: string, typed: boolean): Promise<HistoryEntry>;
  query(options: HistoryQuery): Promise<HistoryQueryResult>;
  getRecent(maxResults?: number): Promise<readonly HistoryEntry[]>;
  getFrecents(maxResults?: number): Promise<readonly HistoryEntry[]>;
  deleteEntry(id: string): Promise<boolean>;
  deleteRange(fromTime: number, toTime: number): Promise<number>;
  deleteAll(): Promise<void>;
  getEntryByUrl(url: string): Promise<HistoryEntry | null>;
  readonly totalEntries: number;
}

let _idSeq = 0;
function nextHistoryId(): string {
  return `hist-${Date.now()}-${(++_idSeq).toString(36)}`;
}

class InMemoryHistoryStore implements IHistoryStore {
  private readonly entries = new Map<string, HistoryEntry>();
  private readonly urlIndex = new Map<string, string>();

  async addVisit(url: string, title: string, typed: boolean): Promise<HistoryEntry> {
    const existingId = this.urlIndex.get(url);
    if (existingId) {
      const existing = this.entries.get(existingId)!;
      const updated: HistoryEntry = {
        ...existing,
        title,
        visitCount: existing.visitCount + 1,
        typedCount: existing.typedCount + (typed ? 1 : 0),
        lastVisitTime: Date.now(),
      };
      this.entries.set(existingId, updated);
      return updated;
    }

    const id = nextHistoryId();
    const entry: HistoryEntry = {
      id,
      url,
      title,
      visitTime: Date.now(),
      visitCount: 1,
      typedCount: typed ? 1 : 0,
      lastVisitTime: Date.now(),
    };
    this.entries.set(id, entry);
    this.urlIndex.set(url, id);
    return entry;
  }

  async query(options: HistoryQuery): Promise<HistoryQueryResult> {
    let filtered = [...this.entries.values()];

    if (options.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter(
        e => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
      );
    }

    if (options.fromTime !== undefined) {
      filtered = filtered.filter(e => e.lastVisitTime >= options.fromTime!);
    }
    if (options.toTime !== undefined) {
      filtered = filtered.filter(e => e.lastVisitTime <= options.toTime!);
    }

    filtered.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

    const totalCount = filtered.length;
    const offset = options.offset ?? 0;
    const limit = options.maxResults ?? 50;
    const page = filtered.slice(offset, offset + limit);

    return {
      entries: page,
      totalCount,
      hasMore: offset + limit < totalCount,
    };
  }

  async getRecent(maxResults = 50): Promise<readonly HistoryEntry[]> {
    const sorted = [...this.entries.values()]
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    return sorted.slice(0, maxResults);
  }

  async getFrecents(maxResults = 50): Promise<readonly HistoryEntry[]> {
    const scored = [...this.entries.values()]
      .map(e => ({ entry: e, score: e.visitCount * 0.3 + e.typedCount * 0.7 }))
      .sort((a, b) => b.score - a.score || b.entry.lastVisitTime - a.entry.lastVisitTime);
    return scored.slice(0, maxResults).map(s => s.entry);
  }

  async deleteEntry(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.urlIndex.delete(entry.url);
    return this.entries.delete(id);
  }

  async deleteRange(fromTime: number, toTime: number): Promise<number> {
    let deleted = 0;
    for (const [id, entry] of this.entries) {
      if (entry.lastVisitTime >= fromTime && entry.lastVisitTime <= toTime) {
        this.urlIndex.delete(entry.url);
        this.entries.delete(id);
        deleted++;
      }
    }
    return deleted;
  }

  async deleteAll(): Promise<void> {
    this.entries.clear();
    this.urlIndex.clear();
  }

  async getEntryByUrl(url: string): Promise<HistoryEntry | null> {
    const id = this.urlIndex.get(url);
    return id ? (this.entries.get(id) ?? null) : null;
  }

  get totalEntries(): number {
    return this.entries.size;
  }

  dispose(): void {
    this.entries.clear();
    this.urlIndex.clear();
  }
}

export { InMemoryHistoryStore };
export type { IHistoryStore, HistoryEntry, HistoryQuery, HistoryQueryResult };
