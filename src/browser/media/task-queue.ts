import type { IDisposable } from '../../app/dependency-container';

interface ITaskQueueService extends IDisposable {
  schedule(fn: () => void, delay: number, recurring?: boolean): number;
  clearTimer(id: number): void;
  clearAll(): void;
  runOnce(now?: number): boolean;
  runAll(): void;
  get pending(): number;
  getPendingTasks(): readonly QueuedTask[];
  onEvent(handler: TaskQueueEventHandler): () => void;
}

interface QueuedTask {
  readonly id: number;
  readonly delay: number;
  scheduledAt: number;
  readonly recurring: boolean;
  readonly interval?: number;
}

type TaskQueueEventKind = 'scheduled' | 'executed' | 'cancelled' | 'cleared';
type TaskQueueEventHandler = (event: TaskQueueEvent) => void;

interface TaskQueueEvent {
  readonly kind: TaskQueueEventKind;
  readonly data?: Record<string, unknown>;
}

class TaskQueueService implements ITaskQueueService {
  private _nextId = 1;
  private _tasks: QueuedTask[] = [];
  private _callbacks = new Map<number, () => void>();
  private _handlers = new Set<TaskQueueEventHandler>();

  schedule(fn: () => void, delay: number, recurring = false): number {
    const id = this._nextId++;
    const task: QueuedTask = { id, delay: Math.max(0, delay), scheduledAt: Date.now(), recurring, interval: recurring ? delay : undefined };
    this._tasks.push(task);
    this._callbacks.set(id, fn);
    this.emit({ kind: 'scheduled', data: { id, delay, recurring } });
    return id;
  }

  clearTimer(id: number): void {
    this._tasks = this._tasks.filter(t => t.id !== id);
    this._callbacks.delete(id);
    this.emit({ kind: 'cancelled', data: { id } });
  }

  clearAll(): void {
    this._tasks = [];
    this._callbacks.clear();
    this.emit({ kind: 'cleared' });
  }

  runOnce(now: number = Date.now()): boolean {
    const idx = this._tasks.findIndex(t => now - t.scheduledAt >= t.delay);
    if (idx < 0) return this._tasks.length > 0;

    const task = this._tasks.splice(idx, 1)[0]!;
    const fn = this._callbacks.get(task.id);
    this._callbacks.delete(task.id);

    if (fn) {
      try { fn(); } catch { }
      this.emit({ kind: 'executed', data: { id: task.id } });
    }

    if (task.recurring && task.interval !== undefined) {
      task.scheduledAt = now;
      this._tasks.push(task);
      this._callbacks.set(task.id, fn!);
    }

    return this._tasks.length > 0;
  }

  runAll(): void {
    while (this.runOnce()) { }
  }

  get pending(): number {
    return this._tasks.length;
  }

  getPendingTasks(): readonly QueuedTask[] {
    return [...this._tasks];
  }

  onEvent(handler: TaskQueueEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: TaskQueueEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._tasks = [];
    this._callbacks.clear();
  }
}

export { TaskQueueService };
export type { ITaskQueueService, QueuedTask, TaskQueueEvent, TaskQueueEventKind, TaskQueueEventHandler };
