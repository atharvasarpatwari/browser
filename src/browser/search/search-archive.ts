import type { IDisposable } from '../../app/dependency-container';
import { Bm25Index } from './bm25-index';
import type { IndexableDocument, SearchHit, SearchOptions } from './bm25-index';
import type { IIndexStorage } from './archive-storage';

interface ArchiveDeps {
  readonly storage: IIndexStorage;
  /** The user's "index pages I visit" setting. Indexing only; an existing archive stays searchable. */
  isEnabled(): boolean;
  isIncognito(): boolean;
  readonly now?: () => number;
  /** Oldest pages are evicted beyond this many. */
  readonly maxDocuments?: number;
  /** An unchanged page re-visited within this window is not re-indexed. */
  readonly minRevisitMs?: number;
  readonly saveDelayMs?: number;
}

interface ArchiveStats {
  readonly documents: number;
  readonly terms: number;
  readonly pending: number;
  readonly loaded: boolean;
  readonly lastSavedAt: number | null;
  readonly lastError: string | null;
}

type ArchiveChangeHandler = () => void;

const INDEXABLE_URL = /^https?:\/\//i;

/**
 * The user's personal full-text archive of visited pages. Gating (setting, incognito, URL scheme)
 * lives in `enqueue`; indexing runs one page per timer tick so a heavy page never blocks input;
 * persistence is debounced and best-effort (a storage failure never breaks search).
 */
class PersonalSearchArchive implements IDisposable {
  private index = new Bm25Index();
  private readonly queue: IndexableDocument[] = [];
  private readonly handlers = new Set<ArchiveChangeHandler>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private dirty = false;
  private lastSavedAt: number | null = null;
  private lastError: string | null = null;
  private readonly now: () => number;
  private readonly maxDocuments: number;
  private readonly minRevisitMs: number;
  private readonly saveDelayMs: number;

  constructor(private readonly deps: ArchiveDeps) {
    this.now = deps.now ?? Date.now;
    this.maxDocuments = deps.maxDocuments ?? 10_000;
    this.minRevisitMs = deps.minRevisitMs ?? 6 * 60 * 60 * 1000;
    this.saveDelayMs = deps.saveDelayMs ?? 5000;
  }

  /** Restores the persisted index. Corrupt or unreadable data yields an empty archive. */
  async load(): Promise<void> {
    try {
      const raw = await this.deps.storage.load();
      this.index = raw ? Bm25Index.fromSnapshot(JSON.parse(raw)) : new Bm25Index();
    } catch (err) {
      this.index = new Bm25Index();
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.loaded = true;
    this.emit();
  }

  get isLoaded(): boolean { return this.loaded; }

  /** Whether a page at `url` may be indexed right now (setting, incognito, http(s) only). */
  canIndex(url: string): boolean {
    return INDEXABLE_URL.test(url) && this.deps.isEnabled() && !this.deps.isIncognito();
  }

  /** Queues a page for background indexing. Returns false when it was rejected up front. */
  enqueue(doc: IndexableDocument): boolean {
    if (!this.canIndex(doc.url)) return false;
    this.queue.push(doc);
    this.scheduleDrain();
    return true;
  }

  /** Synchronous indexing; returns true when the index changed. */
  indexNow(doc: IndexableDocument): boolean {
    if (!this.canIndex(doc.url)) return false;
    const existing = this.index.getRecord(doc.url);
    if (existing && existing.hash === Bm25Index.hashOf(doc) && this.now() - existing.visitedAt < this.minRevisitMs) {
      return false;
    }
    if (!this.index.upsert(doc)) return false;
    if (this.index.size > this.maxDocuments) this.index.removeOldest(this.index.size - this.maxDocuments);
    this.markDirty();
    return true;
  }

  search(query: string, options?: SearchOptions): SearchHit[] {
    return this.index.search(query, options);
  }

  has(url: string): boolean { return this.index.has(url); }

  remove(url: string): boolean {
    const removed = this.index.remove(url);
    if (removed) this.markDirty();
    return removed;
  }

  /** Forgets everything, in memory and in storage. */
  async clear(): Promise<void> {
    this.queue.length = 0;
    this.index.clear();
    this.dirty = false;
    this.cancel('save');
    try {
      await this.deps.storage.clear();
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.emit();
  }

  /** Writes the index now. Never throws; failures are reported through `stats().lastError`. */
  async flush(): Promise<void> {
    this.cancel('save');
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.deps.storage.save(JSON.stringify(this.index.toSnapshot()));
      this.lastSavedAt = this.now();
      this.lastError = null;
    } catch (err) {
      this.dirty = true;
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.emit();
  }

  stats(): ArchiveStats {
    return {
      documents: this.index.size,
      terms: this.index.termCount,
      pending: this.queue.length,
      loaded: this.loaded,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError,
    };
  }

  onChange(handler: ArchiveChangeHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  dispose(): void {
    this.queue.length = 0;
    this.cancel('drain');
    this.cancel('save');
    this.handlers.clear();
  }

  private scheduleDrain(): void {
    if (this.drainTimer) return;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      const next = this.queue.shift();
      if (next) this.indexNow(next);
      if (this.queue.length > 0) this.scheduleDrain();
      else this.emit();
    }, 0);
  }

  private markDirty(): void {
    this.dirty = true;
    this.emit();
    this.cancel('save');
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.flush(); }, this.saveDelayMs);
  }

  private cancel(which: 'drain' | 'save'): void {
    const key = which === 'drain' ? 'drainTimer' : 'saveTimer';
    if (this[key]) { clearTimeout(this[key]!); this[key] = null; }
  }

  private emit(): void {
    for (const h of this.handlers) {
      try { h(); } catch { /* a listener must not break indexing */ }
    }
  }
}

export { PersonalSearchArchive };
export type { ArchiveDeps, ArchiveStats };
