

export interface PerfSnapshot {
  timestamp: number;
  cpuPercent: number;
  fps: number;
  jsHeapSizeMB: number;
  domNodeCount: number;
  activeHandlers: number;
}

export type PerfEventType = 'snapshotAdded' | 'recordingStateChanged' | 'cleared';

export interface PerfEvent {
  kind: PerfEventType;
  snapshot?: PerfSnapshot;
  recording?: boolean;
}

export type PerfEventHandler = (event: PerfEvent) => void;

export class PerformanceProfiler {
  private snapshots: PerfSnapshot[] = [];
  private recording = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<PerfEventHandler>();

  private collectSnapshot(): PerfSnapshot {
    return {
      timestamp: Date.now(),
      cpuPercent: 0,
      fps: 60,
      jsHeapSizeMB: 0,
      domNodeCount: 0,
      activeHandlers: 0,
    };
  }

  startRecording(intervalMs = 500): void {
    if (this.recording) return;
    this.recording = true;
    this.emit({ kind: 'recordingStateChanged', recording: true });
    this.intervalId = setInterval(() => {
      const snap = this.collectSnapshot();
      this.snapshots.push(snap);
      this.emit({ kind: 'snapshotAdded', snapshot: snap });
    }, intervalMs);
  }

  stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.emit({ kind: 'recordingStateChanged', recording: false });
  }

  isRecording(): boolean { return this.recording; }

  getSnapshots(): PerfSnapshot[] { return [...this.snapshots]; }

  clear(): void {
    this.stopRecording();
    this.snapshots = [];
    this.emit({ kind: 'cleared' });
  }

  exportTimeline(): object {
    return {
      version: '1.0',
      tool: 'NovaBrowser Performance',
      snapshots: this.snapshots,
    };
  }

  addSnapshot(overrides?: Partial<PerfSnapshot>): void {
    const snap = { ...this.collectSnapshot(), ...overrides };
    this.snapshots.push(snap);
    this.emit({ kind: 'snapshotAdded', snapshot: snap });
  }

  onEvent(handler: PerfEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: PerfEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
