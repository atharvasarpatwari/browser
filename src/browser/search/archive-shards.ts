import type { PersistedDoc } from './bm25-index';

/**
 * How the archive is laid out in storage. Pages are grouped into shards by their sequence number (`seq`, which is
 * never reused or renumbered), 100 to a shard. Only the newest shard is ever rewritten as pages arrive; a page removed
 * from an older shard is recorded as a tombstone in `meta` and dropped from its shard later, in the background.
 *
 *   shard:00007   { v: 2, docs: PersistedDoc[] }   pages 700 … 799, in seq order
 *   meta          { v: 2, next, removed }          the next seq to hand out, and the seqs removed from older shards
 *
 * The size is what a load can swallow in one go: parsing a shard and restoring its pages each stay within a frame
 * (measured: ~3 ms and ~8 ms for 100 typical pages), and a save rewrites at most one shard.
 */
const SHARD_SIZE = 100;
/** A load yields to the event loop after restoring this many pages (~5 ms of work), so input and painting go on during it. */
const RESTORE_SLICE = 50;
/** Background cleanup of older shards starts once this many tombstones have piled up. */
const COMPACT_AT = 64;
const META_ID = 'meta';

const shardOf = (seq: number): number => Math.floor(seq / SHARD_SIZE);
const shardId = (shard: number): string => `shard:${String(shard).padStart(5, '0')}`;
function parseShardId(id: string): number | null {
  const match = /^shard:(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

interface ArchiveMeta {
  /** The seq the next page gets: persisted so a seq freed by a removal is never handed out again. */
  readonly next: number;
  readonly removed: readonly number[];
}

const encodeShard = (docs: readonly PersistedDoc[]): string => JSON.stringify({ v: 2, docs });
const encodeMeta = (meta: ArchiveMeta): string => JSON.stringify({ v: 2, ...meta });

function isPersistedDoc(d: unknown): d is PersistedDoc {
  if (!Array.isArray(d) || d.length !== 9) return false;
  if (typeof d[0] !== 'string' || typeof d[1] !== 'string' || typeof d[2] !== 'string' || typeof d[5] !== 'string') return false;
  if (!Number.isFinite(d[3]) || !Number.isFinite(d[4]) || !Number.isInteger(d[6]) || d[6] < 0) return false;
  const terms = d[7];
  const tfs = d[8];
  return Array.isArray(terms) && Array.isArray(tfs) && terms.length === tfs.length
    && terms.every((t) => typeof t === 'string') && tfs.every((n) => Number.isFinite(n));
}

/** The pages of a shard record, or `null` when it is not one (corrupt, a different version, or damaged pages). */
function decodeShard(raw: string): PersistedDoc[] | null {
  try {
    const data = JSON.parse(raw) as { v?: unknown; docs?: unknown };
    if (data.v !== 2 || !Array.isArray(data.docs) || !data.docs.every(isPersistedDoc)) return null;
    return data.docs as PersistedDoc[];
  } catch {
    return null;
  }
}

function decodeMeta(raw: string | null): ArchiveMeta | null {
  if (raw === null) return null;
  try {
    const data = JSON.parse(raw) as { v?: unknown; next?: unknown; removed?: unknown };
    if (data.v !== 2 || !Number.isInteger(data.next) || !Array.isArray(data.removed) || !data.removed.every(Number.isInteger)) return null;
    return { next: data.next as number, removed: data.removed as number[] };
  } catch {
    return null;
  }
}

export { SHARD_SIZE, RESTORE_SLICE, COMPACT_AT, META_ID, shardOf, shardId, parseShardId, encodeShard, encodeMeta, decodeShard, decodeMeta };
export type { ArchiveMeta };
