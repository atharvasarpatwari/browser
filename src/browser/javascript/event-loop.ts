import type { IDisposable } from '../../app/dependency-container';

type TaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'idle';

interface Task {
  readonly id: string;
  readonly callback: () => Promise<void> | void;
  readonly priority: TaskPriority;
  readonly label: string;
  readonly addedAt: number;
  readonly timeoutMs: number | null;
}

interface Microtask {
  readonly callback: () => void;
  readonly label: string;
}

interface AnimationFrameCallback {
  readonly callback: (deltaTime: number) => void;
  readonly label: string;
}

type EventLoopEventType = 'taskProcessed' | 'microtaskProcessed' | 'frame' | 'idle';

interface EventLoopEvent {
  readonly kind: EventLoopEventType;
}

interface TaskProcessedEvent extends EventLoopEvent {
  readonly kind: 'taskProcessed';
  readonly taskId: string;
  readonly durationMs: number;
}

interface FrameEvent extends EventLoopEvent {
  readonly kind: 'frame';
  readonly frameNumber: number;
  readonly deltaTime: number;
}

interface IdleEvent extends EventLoopEvent {
  readonly kind: 'idle';
  readonly idleDuration: number;
}

type EventLoopEventUnion =
  | TaskProcessedEvent
  | FrameEvent
  | IdleEvent;

interface IEventLoop extends IDisposable {
  readonly isRunning: boolean;
  readonly taskCount: number;
  readonly microtaskCount: number;

  start(): void;
  stop(): void;
  enqueueTask(callback: () => Promise<void> | void, options?: TaskOptions): string;
  enqueueMicrotask(callback: () => void, label?: string): void;
  requestAnimationFrame(callback: (deltaTime: number) => void, label?: string): void;
  cancelAnimationFrame(callback: (deltaTime: number) => void): void;
  clear(): void;
  processNextTask(): Promise<boolean>;
  processAllMicrotasks(): void;

  on(type: EventLoopEventType, handler: (event: EventLoopEventUnion) => void): void;
  off(type: EventLoopEventType, handler: (event: EventLoopEventUnion) => void): void;
}

interface TaskOptions {
  readonly priority?: TaskPriority;
  readonly label?: string;
  readonly timeoutMs?: number;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  idle: 4,
};

let _taskSeq = 0;
function nextTaskId(): string {
  return `task-${(++_taskSeq).toString(36)}`;
}

class EventLoop implements IEventLoop {
  private readonly tasks: Task[] = [];
  private readonly microtasks: Microtask[] = [];
  private readonly animationCallbacks: AnimationFrameCallback[] = [];
  private readonly eventListeners = new Map<EventLoopEventType, Set<(e: EventLoopEventUnion) => void>>();
  private _running = false;
  private _frameCount = 0;
  private _lastFrameTime = 0;
  private _timerHandle: ReturnType<typeof setTimeout> | null = null;

  get isRunning(): boolean { return this._running; }
  get taskCount(): number { return this.tasks.length; }
  get microtaskCount(): number { return this.microtasks.length; }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._lastFrameTime = performance.now();
    this._timerHandle = setTimeout(() => this.loop(), 0);
  }

  stop(): void {
    this._running = false;
    if (this._timerHandle !== null) {
      clearTimeout(this._timerHandle);
      this._timerHandle = null;
    }
  }

  enqueueTask(callback: () => Promise<void> | void, options?: TaskOptions): string {
    const id = nextTaskId();
    const task: Task = {
      id,
      callback,
      priority: options?.priority ?? 'normal',
      label: options?.label ?? 'anonymous',
      addedAt: Date.now(),
      timeoutMs: options?.timeoutMs ?? null,
    };
    this.tasks.push(task);
    this.tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    return id;
  }

  enqueueMicrotask(callback: () => void, label = 'anonymous'): void {
    this.microtasks.push({ callback, label });
  }

  requestAnimationFrame(callback: (deltaTime: number) => void, label = 'anonymous'): void {
    this.animationCallbacks.push({ callback, label });
  }

  cancelAnimationFrame(callback: (deltaTime: number) => void): void {
    const idx = this.animationCallbacks.findIndex(cb => cb.callback === callback);
    if (idx !== -1) this.animationCallbacks.splice(idx, 1);
  }

  async processNextTask(): Promise<boolean> {
    this.processAllMicrotasks();

    const task = this.tasks.shift();
    if (!task) return false;

    const start = performance.now();
    try {
      await Promise.resolve(task.callback());
    } catch (err) {
      console.error(`[EventLoop] Task "${task.label}" threw:`, err);
    }

    const durationMs = performance.now() - start;
    this.emit({ kind: 'taskProcessed', taskId: task.id, durationMs });

    this.processAllMicrotasks();
    return true;
  }

  processAllMicrotasks(): void {
    while (this.microtasks.length > 0) {
      const mt = this.microtasks.shift()!;
      try {
        mt.callback();
      } catch (err) {
        console.error(`[EventLoop] Microtask "${mt.label}" threw:`, err);
      }
    }
  }

  clear(): void {
    this.tasks.length = 0;
    this.microtasks.length = 0;
    this.animationCallbacks.length = 0;
  }

  on(type: EventLoopEventType, handler: (event: EventLoopEventUnion) => void): void {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, new Set());
    this.eventListeners.get(type)!.add(handler);
  }

  off(type: EventLoopEventType, handler: (event: EventLoopEventUnion) => void): void {
    this.eventListeners.get(type)?.delete(handler);
  }

  private emit(event: EventLoopEventUnion): void {
    const handlers = this.eventListeners.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[EventLoop] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  private async loop(): Promise<void> {
    if (!this._running) return;

    const now = performance.now();
    const deltaTime = now - this._lastFrameTime;
    this._lastFrameTime = now;

    for (let i = 0; i < 5; i++) {
      const processed = await this.processNextTask();
      if (!processed) break;
    }

    this.processAllMicrotasks();

    if (this.animationCallbacks.length > 0) {
      this._frameCount++;
      this.emit({ kind: 'frame', frameNumber: this._frameCount, deltaTime });
      for (const acb of this.animationCallbacks) {
        try { acb.callback(deltaTime); } catch (err) {
          console.error(`[EventLoop] AnimationFrame "${acb.label}" threw:`, err);
        }
      }
    }

    if (this.tasks.length === 0 && this._running) {
      this.emit({ kind: 'idle', idleDuration: 16 });
    }

    this._timerHandle = setTimeout(() => this.loop(), 16);
  }

  dispose(): void {
    this.stop();
    this.clear();
    this.animationCallbacks.length = 0;
    this.eventListeners.clear();
  }
}

export { EventLoop };
export type { IEventLoop, Task, TaskPriority, EventLoopEventUnion, EventLoopEventType };
