export interface HeapSnapshot {
  id: string;
  timestamp: number;
  totalHeapSize: number;
  usedHeapSize: number;
  heapLimit: number;
  nodeCount: number;
  gcCount: number;
}

export interface GCEvent {
  timestamp: number;
  durationMs: number;
  freedBytes: number;
  type: 'minor' | 'major' | 'full';
}

export type MemEventType = 'snapshotAdded' | 'gcEvent' | 'cleared';

export interface MemEvent {
  kind: MemEventType;
  snapshot?: HeapSnapshot;
  gc?: GCEvent;
}

export type MemEventHandler = (event: MemEvent) => void;

export class MemoryProfiler {
  private snapshots: HeapSnapshot[] = [];
  private gcEvents: GCEvent[] = [];
  private handlers = new Set<MemEventHandler>();
  private snapshotCounter = 0;

  takeSnapshot(overrides?: Partial<HeapSnapshot>): HeapSnapshot {
    this.snapshotCounter++;
    const snap: HeapSnapshot = {
      id: `heap-${this.snapshotCounter}`,
      timestamp: Date.now(),
      totalHeapSize: 0,
      usedHeapSize: 0,
      heapLimit: 0,
      nodeCount: 0,
      gcCount: this.gcEvents.length,
      ...overrides,
    };
    this.snapshots.push(snap);
    this.emit({ kind: 'snapshotAdded', snapshot: snap });
    return snap;
  }

  recordGCEvent(overrides?: Partial<GCEvent>): GCEvent {
    const ev: GCEvent = {
      timestamp: Date.now(),
      durationMs: 0,
      freedBytes: 0,
      type: 'minor',
      ...overrides,
    };
    this.gcEvents.push(ev);
    this.emit({ kind: 'gcEvent', gc: ev });
    return ev;
  }

  getSnapshots(): HeapSnapshot[] { return [...this.snapshots]; }

  getGCEvents(): GCEvent[] { return [...this.gcEvents]; }

  getSnapshot(id: string): HeapSnapshot | undefined {
    return this.snapshots.find(s => s.id === id);
  }

  compareSnapshots(idA: string, idB: string): { deltaTotal: number; deltaUsed: number; deltaNodes: number } | null {
    const a = this.getSnapshot(idA);
    const b = this.getSnapshot(idB);
    if (!a || !b) return null;
    return {
      deltaTotal: b.totalHeapSize - a.totalHeapSize,
      deltaUsed: b.usedHeapSize - a.usedHeapSize,
      deltaNodes: b.nodeCount - a.nodeCount,
    };
  }

  getAllocatedBytes(): number {
    if (this.snapshots.length < 2) return 0;
    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];
    return Math.max(0, last.usedHeapSize - first.usedHeapSize);
  }

  clear(): void {
    this.snapshots = [];
    this.gcEvents = [];
    this.snapshotCounter = 0;
    this.emit({ kind: 'cleared' });
  }

  onEvent(handler: MemEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: MemEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
