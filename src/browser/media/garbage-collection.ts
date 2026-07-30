import type { IDisposable } from '../../app/dependency-container';

interface IGarbageCollectionService extends IDisposable {
  collect(force?: boolean): GCResult;
  allocate(size: number): number;
  getStats(): GCStats;
  setThresholds(thresholds: GCThresholds): void;
  getThresholds(): GCThresholds;
  onEvent(handler: GCEventHandler): () => void;
}

interface GCThresholds {
  readonly youngGenSize: number;
  readonly oldGenSize: number;
  readonly promotionAge: number;
  readonly collectionInterval: number;
}

interface GCStats {
  totalCollections: number;
  youngCollections: number;
  oldCollections: number;
  totalAllocated: number;
  totalFreed: number;
  currentHeapSize: number;
  objectCount: number;
  lastCollectionDuration: number;
  averageCollectionDuration: number;
  fragmentationRatio: number;
}

interface GCResult {
  collected: number;
  freedBytes: number;
  duration: number;
  generation: 'young' | 'old';
  survived: number;
}

type GCEventKind = 'allocation' | 'young_collection' | 'old_collection' | 'promotion' | 'finalize' | 'threshold_change';
type GCEventHandler = (event: GCEvent) => void;

interface GCEvent {
  readonly kind: GCEventKind;
  readonly data?: Record<string, unknown>;
}

const DEFAULT_THRESHOLDS: GCThresholds = {
  youngGenSize: 128 * 1024,
  oldGenSize: 1024 * 1024,
  promotionAge: 2,
  collectionInterval: 1000,
};

class GarbageCollectionService implements IGarbageCollectionService {
  private _totalAllocated = 0;
  private _totalFreed = 0;
  private _currentHeapSize = 0;
  private _objectCount = 0;
  private _objects = new Map<number, { size: number; age: number; generation: 'young' | 'old' }>();
  private _nextId = 1;
  private _youngCollections = 0;
  private _oldCollections = 0;
  private _totalCollections = 0;
  private _lastDuration = 0;
  private _totalDuration = 0;
  private _thresholds: GCThresholds = { ...DEFAULT_THRESHOLDS };
  private _allocSinceLastGC = 0;
  private _handlers = new Set<GCEventHandler>();

  allocate(size: number): number {
    const id = this._nextId++;
    this._objects.set(id, { size, age: 0, generation: 'young' });
    this._totalAllocated += size;
    this._currentHeapSize += size;
    this._objectCount++;
    this._allocSinceLastGC += size;
    this.emit({ kind: 'allocation', data: { id, size, heapSize: this._currentHeapSize } });

    if (this._allocSinceLastGC >= this._thresholds.collectionInterval) {
      this.collect(false);
    }

    return id;
  }

  collect(force: boolean = false): GCResult {
    const startTime = performance.now();
    let freedBytes = 0;
    let collected = 0;
    let survived = 0;

    this._youngCollections++;

    const toRemove: number[] = [];
    for (const [id, obj] of this._objects) {
      if (obj.generation === 'young') {
        obj.age++;
        if (obj.age >= this._thresholds.promotionAge || force) {
          if (Math.random() < 0.7) {
            survived++;
            obj.generation = 'old';
            this.emit({ kind: 'promotion', data: { id, size: obj.size, age: obj.age } });
          } else {
            toRemove.push(id);
            freedBytes += obj.size;
            collected++;
          }
        } else {
          if (Math.random() < 0.3) {
            toRemove.push(id);
            freedBytes += obj.size;
            collected++;
          } else {
            survived++;
          }
        }
      }
    }

    if (this._currentHeapSize > this._thresholds.oldGenSize || force) {
      this._oldCollections++;
      for (const [id, obj] of this._objects) {
        if (obj.generation === 'old') {
          if (Math.random() < 0.2 || force) {
            toRemove.push(id);
            freedBytes += obj.size;
            collected++;
          }
        }
      }
    }

    for (const id of toRemove) {
      const obj = this._objects.get(id);
      if (obj) {
        this.emit({ kind: 'finalize', data: { id, size: obj.size, generation: obj.generation } });
        this._objects.delete(id);
      }
    }

    this._currentHeapSize -= freedBytes;
    this._totalFreed += freedBytes;
    this._objectCount = this._objects.size;
    this._totalCollections++;
    this._allocSinceLastGC = 0;
    const duration = performance.now() - startTime;
    this._lastDuration = duration;
    this._totalDuration += duration;

    const generation = this._youngCollections > this._oldCollections ? 'young' as const : 'old' as const;
    this.emit({ kind: generation === 'young' ? 'young_collection' : 'old_collection', data: { collected, freedBytes, duration, survived } });

    return { collected, freedBytes, duration, generation, survived };
  }

  getStats(): GCStats {
    return {
      totalCollections: this._totalCollections,
      youngCollections: this._youngCollections,
      oldCollections: this._oldCollections,
      totalAllocated: this._totalAllocated,
      totalFreed: this._totalFreed,
      currentHeapSize: this._currentHeapSize,
      objectCount: this._objectCount,
      lastCollectionDuration: this._lastDuration,
      averageCollectionDuration: this._totalCollections > 0 ? this._totalDuration / this._totalCollections : 0,
      fragmentationRatio: this._currentHeapSize > 0 ? (this._totalAllocated - this._totalFreed) / this._totalAllocated : 0,
    };
  }

  setThresholds(thresholds: Partial<GCThresholds>): void {
    const old = { ...this._thresholds };
    this._thresholds = { ...this._thresholds, ...thresholds };
    this.emit({ kind: 'threshold_change', data: { old, new: this._thresholds } });
  }

  getThresholds(): GCThresholds {
    return { ...this._thresholds };
  }

  onEvent(handler: GCEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: GCEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._objects.clear();
    this._totalAllocated = 0;
    this._totalFreed = 0;
    this._currentHeapSize = 0;
    this._objectCount = 0;
    this._totalCollections = 0;
    this._allocSinceLastGC = 0;
  }
}

export { GarbageCollectionService, DEFAULT_THRESHOLDS };
export type { IGarbageCollectionService, GCThresholds, GCStats, GCResult, GCEvent, GCEventKind, GCEventHandler };
