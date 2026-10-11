import type { IDisposable } from '../../app/dependency-container';
import { Bm25Index } from './bm25-index';
import type { IndexableDocument, IndexMutation, PersistedDoc, SearchHit, SearchOptions } from './bm25-index';
import type { IIndexStorage } from './archive-storage';
import { COMPACT_AT, META_ID, RESTORE_SLICE, decodeMeta, decodeShard, encodeMeta, encodeShard, parseShardId, shardId, shardOf } from './archive-shards';

/** Lets input and painting run before the next slice of a long task: a macrotask, so unlike a promise it really yields, and unlike a timer it neither waits nor is throttled. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => { port1.close(); resolve(); };
    port2.postMessage(null);
  });
}

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
  /** How a long task gives the event loop a turn (tests count these). Defaults to a message-channel macrotask. */
  readonly yieldTask?: () => Promise<void>;
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
 *
 * Persistence is incremental (see archive-shards.ts): a save writes the newest shard, which is held whole in memory,
 * and a small meta record, in one atomic batch that needs no read first — so it costs the same at 10,000 pages as at
 * 100, and still works as the window closes. Pages removed from older shards become tombstones that a background
 * pass drops from those shards.
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
  /** Shards whose pages are all held here (the newest, and any it outgrew since the last save): written without being read. */
  private readonly open = new Map<number, PersistedDoc[]>();
  /** Open shards that changed since they were written. */
  private readonly unsaved = new Set<number>();
  /** Sequence numbers of pages removed from shards not held here; dropped from those shards in the background. */
  private readonly removed = new Set<number>();
  /** A legacy snapshot was imported and still has to be written as shards. */
  private migrating = false;
  private compacting = false;
  /** Bumped by `clear()`: background work that began earlier never writes after it, and a load it overtook is discarded. */
  private epoch = 0;
  /** While the archive is being restored new pages wait here (indexing them now would put them in an index that is about to be replaced). */
  private loading = false;
  private readonly heldDuringLoad: IndexableDocument[] = [];
  private readonly yieldTask: () => Promise<void>;
  private readonly now: () => number;
  private readonly maxDocuments: number;
  private readonly minRevisitMs: number;
  private readonly saveDelayMs: number;

  constructor(private readonly deps: ArchiveDeps) {
    this.now = deps.now ?? Date.now;
    this.maxDocuments = deps.maxDocuments ?? 10_000;
    this.minRevisitMs = deps.minRevisitMs ?? 6 * 60 * 60 * 1000;
    this.saveDelayMs = deps.saveDelayMs ?? 5000;
    this.yieldTask = deps.yieldTask ?? nextTask;
    this.index.observe(this.onMutation);
  }

  /**
   * Restores the persisted index, one shard per turn of the event loop, so a large archive never blocks input. An
   * archive written before sharding is imported (and rewritten as shards by the first save). Corrupt or unreadable
   * data yields an empty archive, or skips just the damaged shard.
   */
  async load(): Promise<void> {
    const epoch = this.epoch;
    this.loading = true;
    this.resetShards();
    try {
      const ids = await this.deps.storage.list();
      const shards = ids.map(parseShardId).filter((n): n is number => n !== null).sort((a, b) => a - b);
      this.index = shards.length > 0 || ids.includes(META_ID) ? await this.restore(shards) : await this.importLegacy();
    } catch (err) {
      this.index = new Bm25Index();
      this.resetShards();
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    if (epoch !== this.epoch) { // clear() ran while this was loading: what was read is the archive that was just wiped
      this.index = new Bm25Index();
      this.resetShards();
      this.lastError = null; // whatever the load tripped over was the wiping
    }
    this.index.observe(this.onMutation);
    this.loading = false;
    this.loaded = true;
    const held = this.heldDuringLoad.splice(0);
    for (const page of held) this.indexNow(page);
    if (held.length === 0) {
      if (this.unsaved.size > 0 || this.migrating) this.markDirty();
      else this.emit();
    }
    if (this.removed.size >= COMPACT_AT) void this.compact();
  }

  private resetShards(): void {
    this.open.clear();
    this.unsaved.clear();
    this.removed.clear();
    this.migrating = false;
  }

  private async restore(shards: readonly number[]): Promise<Bm25Index> {
    const index = new Bm25Index();
    const meta = decodeMeta(await this.deps.storage.read(META_ID));
    for (const seq of meta?.removed ?? []) this.removed.add(seq);
    let unreadable = 0;
    let lastShard = -1;
    let lastLive: PersistedDoc[] = [];
    let highest = -1;
    for (const shard of shards) {
      const raw = await this.deps.storage.read(shardId(shard)); // each read is a task of its own: the loop yields between shards
      const docs = raw === null ? null : decodeShard(raw);
      if (!docs) { unreadable++; continue; }
      lastShard = shard;
      lastLive = docs.filter((d) => !this.removed.has(d[6]));
      for (const doc of docs) highest = Math.max(highest, doc[6]);
      for (let i = 0; i < lastLive.length; i++) {
        index.addPersisted(lastLive[i]!);
        if ((i + 1) % RESTORE_SLICE === 0) await this.yieldTask(); // a slice of work at a time: parsing a shard and restoring a slice each fit in a frame
      }
    }
    // New pages must be numbered above every page ever stored — removed ones included, which are only tombstones now —
    // or a save could overwrite an older shard, or a new page could be swallowed by a tombstone. The saved counter
    // covers pages whose records are already gone; the highest number seen covers a missing or stale meta record.
    index.reserveSeq(Math.max(meta?.next ?? 0, highest + 1));
    // The shard the next pages go to is held whole; its tombstoned pages are dropped by rewriting it with the next save.
    const tail = shardOf(index.nextSeq);
    if (lastShard === tail) {
      this.open.set(tail, lastLive);
      const purged = [...this.removed].filter((seq) => shardOf(seq) === tail);
      for (const seq of purged) this.removed.delete(seq);
      if (purged.length > 0) this.unsaved.add(tail);
    }
    if (unreadable > 0) this.lastError = `${unreadable} archive shard${unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'was' : 'were'} skipped`;
    return index;
  }

  private async importLegacy(): Promise<Bm25Index> {
    const raw = await this.deps.storage.loadLegacy();
    if (raw === null) return new Bm25Index();
    const index = Bm25Index.fromSnapshot(JSON.parse(raw));
    this.migrating = index.size > 0;
    return index;
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
    if (this.loading) { this.heldDuringLoad.push(doc); return true; } // indexed as soon as the archive is restored
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
    this.epoch++;
    this.index.clear(); // the observer empties the shard bookkeeping too
    this.migrating = false;
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

  /** Writes what changed now. Never throws; failures are reported through `stats().lastError`. */
  async flush(): Promise<void> {
    this.cancel('save');
    if (!this.dirty) return;
    this.dirty = false;
    try {
      if (this.migrating) await this.migrate();
      else await this.save();
      this.lastSavedAt = this.now();
      this.lastError = null;
    } catch (err) {
      this.dirty = true;
      this.lastError = err instanceof Error ? err.message : String(err);
    }
    this.emit();
    if (this.removed.size >= COMPACT_AT) void this.compact();
  }

  /** The open shards that changed plus the meta record, in one atomic batch. Nothing is read first, so this is safe as the window closes. */
  private async save(): Promise<void> {
    const written = [...this.unsaved];
    const changes: Array<[string, string | null]> = written.map((shard) => {
      const docs = this.open.get(shard) ?? [];
      return [shardId(shard), docs.length > 0 ? encodeShard(docs) : null];
    });
    changes.push([META_ID, encodeMeta({ next: this.index.nextSeq, removed: [...this.removed] })]);
    this.unsaved.clear();
    try {
      await this.deps.storage.commit(changes);
    } catch (err) {
      for (const shard of written) this.unsaved.add(shard);
      throw err;
    }
    // Written shards older than the newest will not be added to again: let them go (removals from them are tombstones now).
    const newest = Math.max(...this.open.keys());
    for (const shard of [...this.open.keys()]) if (shard < newest && !this.unsaved.has(shard)) this.open.delete(shard);
  }

  /**
   * The first save after a legacy snapshot was imported: every page is written as shards and the snapshot dropped in
   * one atomic batch (a failure leaves the snapshot, and the next save tries again). The only save that costs
   * O(archive), and it happens once.
   */
  private async migrate(): Promise<void> {
    const byShard = new Map<number, PersistedDoc[]>();
    for (const doc of this.index.toPersisted()) {
      const shard = shardOf(doc[6]);
      const docs = byShard.get(shard) ?? [];
      docs.push(doc);
      byShard.set(shard, docs);
    }
    const changes: Array<[string, string | null]> = [...byShard].map(([shard, docs]) => [shardId(shard), encodeShard(docs)]);
    changes.push([META_ID, encodeMeta({ next: this.index.nextSeq, removed: [] })]);
    // The index is the truth from here on: whatever was queued for an incremental save is superseded.
    this.open.clear();
    this.unsaved.clear();
    this.removed.clear();
    if (byShard.size > 0) {
      const newest = Math.max(...byShard.keys());
      this.open.set(newest, byShard.get(newest)!);
    }
    await this.deps.storage.commit(changes, true);
    this.migrating = false;
  }

  /**
   * Drops removed pages from the older shards that still hold them. Background and best-effort: if it is cut short
   * nothing is lost, the tombstones are still there and the next pass repeats it.
   */
  private async compact(): Promise<void> {
    if (this.compacting) return;
    this.compacting = true;
    const epoch = this.epoch;
    try {
      const gone = new Map<number, Set<number>>();
      for (const seq of this.removed) {
        const shard = shardOf(seq);
        if (this.open.has(shard)) continue;
        const seqs = gone.get(shard) ?? new Set<number>();
        seqs.add(seq);
        gone.set(shard, seqs);
      }
      const changes: Array<[string, string | null]> = [];
      for (const [shard, seqs] of gone) {
        const raw = await this.deps.storage.read(shardId(shard));
        const keep = (raw === null ? [] : decodeShard(raw) ?? []).filter((d) => !seqs.has(d[6]));
        changes.push([shardId(shard), keep.length > 0 ? encodeShard(keep) : null]);
      }
      if (changes.length === 0 || epoch !== this.epoch) return;
      await this.deps.storage.commit(changes);
      for (const seqs of gone.values()) for (const seq of seqs) this.removed.delete(seq);
      this.markDirty(); // the shorter tombstone list is written with the next save
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      this.compacting = false;
    }
  }

  /** Keeps the shard bookkeeping in step with the index. */
  private readonly onMutation = (mutation: IndexMutation): void => {
    if (mutation.type === 'clear') {
      this.open.clear();
      this.unsaved.clear();
      this.removed.clear();
      return;
    }
    if (mutation.type === 'add') {
      const shard = shardOf(mutation.doc[6]);
      const docs = this.open.get(shard) ?? [];
      docs.push(mutation.doc);
      this.open.set(shard, docs);
      this.unsaved.add(shard);
      return;
    }
    const shard = shardOf(mutation.seq);
    const docs = this.open.get(shard);
    if (!docs) { this.removed.add(mutation.seq); return; } // an older shard, not held here: a tombstone
    const at = docs.findIndex((d) => d[6] === mutation.seq);
    if (at >= 0) { docs.splice(at, 1); this.unsaved.add(shard); }
  };

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
