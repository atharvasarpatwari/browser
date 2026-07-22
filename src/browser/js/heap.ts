// ─────────────────────────────────────────────────────────────────────────────
// HEAP — Object allocation tracking and memory accounting
// Tracks all allocated JS objects for GC integration.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSObject, JSFunction, JSValue } from './values';

// ── GC Header ────────────────────────────────────────────────────────────────

/**
 * Every GC-managed object gets a header with collection metadata.
 * Stored as hidden properties on the object itself.
 */
export interface GCHeader {
  /** Unique allocation ID */
  id: number;
  /** Mark bit for tracing phase */
  marked: boolean;
  /** Allocation size in bytes (approximate) */
  size: number;
  /** Generation: 0 = young (nursery), 1 = old (tenured) */
  generation: 0 | 1;
  /** Whether this object has been promoted to old generation */
  promoted: boolean;
  /** Finalizer callback, if registered */
  finalizer?: (obj: JSObject | JSFunction) => void;
  /** Weak reference back-pointer for cleanup */
  weakRefs: Set<WeakRef<object>>;
}

// ── Size estimation ──────────────────────────────────────────────────────────

/** Approximate memory size of a JSValue in bytes */
function estimateValueSize(val: JSValue): number {
  if (val === null || val === undefined || typeof val === 'boolean') return 8;
  if (typeof val === 'number') return 8;
  if (typeof val === 'string') return 16 + val.length * 2;
  if (typeof val === 'bigint') return 24;
  if (typeof val === 'object') return estimateObjectSize(val as JSObject);
  if (typeof val === 'function') return 48;
  return 8;
}

/** Approximate memory size of a JSObject in bytes */
function estimateObjectSize(obj: JSObject): number {
  let size = 64; // base overhead
  // Properties map — only for objects, not functions
  if (obj.properties) {
    size += 32; // map overhead
    for (const [, desc] of obj.properties) {
      size += 24; // entry overhead
      size += estimateValueSize(desc.value);
    }
  }
  return size;
}

// ── Heap ─────────────────────────────────────────────────────────────────────

export interface HeapStats {
  /** Total number of allocated objects */
  objectCount: number;
  /** Total allocated bytes (estimated) */
  allocatedBytes: number;
  /** Number of young generation objects */
  youngCount: number;
  /** Number of old generation objects */
  oldCount: number;
  /** Number of collections performed */
  collections: number;
  /** Total bytes freed by collections */
  freedBytes: number;
  /** Total collection time in ms */
  collectionTimeMs: number;
}

export class Heap {
  private objects = new Map<number, GCHeader & { ref: JSObject | JSFunction }>();
  private nextId = 1;
  private _allocatedBytes = 0;
  private _collections = 0;
  private _freedBytes = 0;
  private _collectionTimeMs = 0;

  /** Threshold for triggering young generation collection (bytes) */
  youngThreshold = 128 * 1024; // 128KB

  /** Threshold for triggering old generation collection (bytes) */
  oldThreshold = 1024 * 1024; // 1MB

  /** Young generation nursery size before promotion */
  nurseryMaxSize = 64 * 1024; // 64KB

  /**
   * Allocate a new object on the heap.
   * Returns the object with GC metadata attached.
   */
  allocate<T extends JSObject | JSFunction>(obj: T): T {
    const size = estimateObjectSize(obj);
    const header: GCHeader & { ref: T } = {
      id: this.nextId++,
      marked: false,
      size,
      generation: 0,
      promoted: false,
      weakRefs: new Set(),
      ref: obj,
    };

    // Attach GC header as hidden properties
    (obj as Record<string, unknown>)['__gcId'] = header.id;
    (obj as Record<string, unknown>)['__gcHeader'] = header;

    this.objects.set(header.id, header as GCHeader & { ref: JSObject | JSFunction });
    this._allocatedBytes += size;

    return obj;
  }

  /**
   * Register an object that was created outside the heap (e.g., built-in objects).
   * This allows the GC to track and collect them.
   */
  register(obj: JSObject | JSFunction): void {
    if (this.objects.has(this.getId(obj))) return;

    const size = estimateObjectSize(obj);
    const header: GCHeader & { ref: JSObject | JSFunction } = {
      id: this.nextId++,
      marked: false,
      size,
      generation: 1, // registered objects are old generation by default
      promoted: true,
      weakRefs: new Set(),
      ref: obj,
    };

    (obj as Record<string, unknown>)['__gcId'] = header.id;
    (obj as Record<string, unknown>)['__gcHeader'] = header;
    this.objects.set(header.id, header as GCHeader & { ref: JSObject | JSFunction });
    this._allocatedBytes += size;
  }

  /**
   * Get the GC header for an object.
   */
  getHeader(obj: JSObject | JSFunction): GCHeader | undefined {
    const id = this.getId(obj);
    return this.objects.get(id);
  }

  /**
   * Get the GC ID for an object.
   */
  getId(obj: JSObject | JSFunction): number {
    return (obj as Record<string, unknown>)['__gcId'] as number ?? 0;
  }

  /**
   * Check if an object is tracked by this heap.
   */
  has(obj: JSObject | JSFunction): boolean {
    return this.objects.has(this.getId(obj));
  }

  /**
   * Mark an object as reachable (used during tracing).
   */
  mark(obj: JSObject | JSFunction): void {
    const header = this.getHeader(obj);
    if (header) {
      header.marked = true;
    }
  }

  /**
   * Check if an object is marked.
   */
  isMarked(obj: JSObject | JSFunction): boolean {
    const header = this.getHeader(obj);
    return header?.marked ?? false;
  }

  /**
   * Clear all mark bits (start of collection cycle).
   */
  clearMarks(): void {
    for (const header of this.objects.values()) {
      header.marked = false;
    }
  }

  /**
   * Sweep unmarked objects — remove them from the heap.
   * Returns the list of swept (collected) objects.
   */
  sweep(): Array<JSObject | JSFunction> {
    const swept: Array<JSObject | JSFunction> = [];
    const toDelete: number[] = [];

    for (const [id, header] of this.objects) {
      if (!header.marked) {
        // Run finalizer if present
        if (header.finalizer) {
          try {
            header.finalizer(header.ref);
          } catch {
            // Finalizers should not throw
          }
        }

        // Notify weak references
        for (const weakRef of header.weakRefs) {
          weakRef.deref(); // just deref to trigger WeakRef cleanup
        }

        swept.push(header.ref);
        this._freedBytes += header.size;
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.objects.delete(id);
    }

    return swept;
  }

  /**
   * Promote surviving young objects to old generation.
   */
  promoteSurvivors(): void {
    for (const header of this.objects.values()) {
      if (header.generation === 0 && header.marked) {
        header.generation = 1;
        header.promoted = true;
      }
    }
  }

  /**
   * Get all young generation objects.
   */
  getYoungObjects(): Array<JSObject | JSFunction> {
    const young: Array<JSObject | JSFunction> = [];
    for (const header of this.objects.values()) {
      if (header.generation === 0) {
        young.push(header.ref);
      }
    }
    return young;
  }

  /**
   * Check if young generation collection should be triggered.
   */
  shouldCollectYoung(): boolean {
    let youngBytes = 0;
    for (const header of this.objects.values()) {
      if (header.generation === 0) {
        youngBytes += header.size;
      }
    }
    return youngBytes >= this.youngThreshold;
  }

  /**
   * Check if old generation collection should be triggered.
   */
  shouldCollectOld(): boolean {
    let oldBytes = 0;
    for (const header of this.objects.values()) {
      if (header.generation === 1) {
        oldBytes += header.size;
      }
    }
    return oldBytes >= this.oldThreshold;
  }

  /**
   * Record a collection cycle.
   */
  recordCollection(freedBytes: number, timeMs: number): void {
    this._collections++;
    this._freedBytes += freedBytes;
    this._collectionTimeMs += timeMs;
  }

  /**
   * Get current heap statistics.
   */
  getStats(): HeapStats {
    let youngCount = 0;
    let oldCount = 0;

    for (const header of this.objects.values()) {
      if (header.generation === 0) youngCount++;
      else oldCount++;
    }

    return {
      objectCount: this.objects.size,
      allocatedBytes: this._allocatedBytes,
      youngCount,
      oldCount,
      collections: this._collections,
      freedBytes: this._freedBytes,
      collectionTimeMs: this._collectionTimeMs,
    };
  }

  /**
   * Get all tracked objects (for root scanning).
   */
  getAllObjects(): Array<JSObject | JSFunction> {
    const result: Array<JSObject | JSFunction> = [];
    for (const header of this.objects.values()) {
      result.push(header.ref);
    }
    return result;
  }

  /**
   * Reset the heap — clear all tracking data.
   */
  reset(): void {
    this.objects.clear();
    this.nextId = 1;
    this._allocatedBytes = 0;
    this._collections = 0;
    this._freedBytes = 0;
    this._collectionTimeMs = 0;
  }
}

// ── Singleton heap ───────────────────────────────────────────────────────────

let _globalHeap: Heap | null = null;

export function getHeap(): Heap {
  if (!_globalHeap) {
    _globalHeap = new Heap();
  }
  return _globalHeap;
}

export function setHeap(heap: Heap): void {
  _globalHeap = heap;
}
