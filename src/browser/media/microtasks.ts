import type { IDisposable } from '../../app/dependency-container';

interface IMicrotaskService extends IDisposable {
  enqueue(fn: () => void, priority?: MicrotaskPriority): void;
  drain(): number;
  get pending(): number;
  getPendingCount(priority?: MicrotaskPriority): number;
  onEvent(handler: MicrotaskEventHandler): () => void;
}

type MicrotaskPriority = 'high' | 'normal';
type MicrotaskEventKind = 'enqueued' | 'executed' | 'drained' | 'error';
type MicrotaskEventHandler = (event: MicrotaskEvent) => void;

interface MicrotaskEvent {
  readonly kind: MicrotaskEventKind;
  readonly data?: Record<string, unknown>;
}

class MicrotaskService implements IMicrotaskService {
  private _highPriorityQueue: Array<() => void> = [];
  private _normalQueue: Array<() => void> = [];
  private _handlers = new Set<MicrotaskEventHandler>();

  enqueue(fn: () => void, priority: MicrotaskPriority = 'normal'): void {
    const queue = priority === 'high' ? this._highPriorityQueue : this._normalQueue;
    queue.push(fn);
    this.emit({ kind: 'enqueued', data: { priority, queueLength: queue.length } });
  }

  drain(): number {
    let count = 0;

    while (this._highPriorityQueue.length > 0) {
      const fn = this._highPriorityQueue.shift()!;
      try {
        fn();
        count++;
        this.emit({ kind: 'executed', data: { priority: 'high' } });
      } catch (e) {
        this.emit({ kind: 'error', data: { priority: 'high', message: String(e) } });
      }
    }

    while (this._normalQueue.length > 0) {
      const fn = this._normalQueue.shift()!;
      try {
        fn();
        count++;
        this.emit({ kind: 'executed', data: { priority: 'normal' } });
      } catch (e) {
        this.emit({ kind: 'error', data: { priority: 'normal', message: String(e) } });
      }
    }

    if (count > 0) {
      this.emit({ kind: 'drained', data: { count } });
    }
    return count;
  }

  get pending(): number {
    return this._highPriorityQueue.length + this._normalQueue.length;
  }

  getPendingCount(priority?: MicrotaskPriority): number {
    if (priority === 'high') return this._highPriorityQueue.length;
    if (priority === 'normal') return this._normalQueue.length;
    return this.pending;
  }

  onEvent(handler: MicrotaskEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: MicrotaskEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._highPriorityQueue = [];
    this._normalQueue = [];
  }
}

export { MicrotaskService };
export type { IMicrotaskService, MicrotaskPriority, MicrotaskEvent, MicrotaskEventKind, MicrotaskEventHandler };
